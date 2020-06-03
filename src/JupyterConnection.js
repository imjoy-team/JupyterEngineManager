import { util } from "./index";
import { executeCode } from "./JupyterServer";
import { put_buffers, remove_buffers, MessageEmitter } from "./util";

export default class JupyterConnection extends MessageEmitter {
  constructor(id, type, config, kernel) {
    super(config && config.debug);
    this._disconnected = false;
    this.id = id;
    this._failHandler = () => {};
    this._disconnectHandler = () => {};
    this._loggingHandler = () => {};
    this._messageHandler = () => {};
    this._initHandler = () => {};

    this.kernel = kernel;
    this.config = config;

    const config_ = {
      api_version: config.api_version,
      flags: config.flags,
      tag: config.tag,
      workspace: config.workspace,
      env: config.env,
      requirements: config.requirements,
      cmd: config.cmd,
      name: config.name,
      type: config.type,
      inputs: config.inputs,
      outputs: config.outputs
    };
    console.log("init_plugin...", config);
  }

  async connect() {
    try {
      await this.prepare_kernel(this.kernel, this.id);
      console.log("kernel prepared...");
      this.initializing = false;
      this._disconnected = false;
    } catch (e) {
      this._disconnected = true;
      console.error("failed to initialize plugin on the plugin engine", e);
      this._failHandler("failed to initialize plugin on the plugin engine");
      throw "failed to initialize plugin on the plugin engine";
    }
  }

  setup_comm(kernel, targetOrigin) {
    targetOrigin = targetOrigin || "*";
    const comm = kernel.connectToComm("imjoy_rpc");
    comm.open({});
    comm.onMsg = msg => {
      const data = msg.content.data;
      const buffer_paths = data.__buffer_paths__ || [];
      delete data.__buffer_paths__;
      put_buffers(data, buffer_paths, msg.buffers || []);
      if (data.type === "log" || data.type === "info") {
        console.log(data.message);
      } else if (data.type === "error") {
        console.error(data.message);
      } else {
        if (data.peer_id) {
          this._peer_id = data.peer_id;
        }
        this._fire(data.type, data);
      }
    };
    comm.onClose = msg => {
      console.log("comm closed, reconnecting", id, msg);
      this.reconnect();
      reject("Comm is closed");
    };
    return comm;
  }

  prepare_kernel(kernel, plugin_id) {
    return new Promise(async (resolve, reject) => {
      try {
        const client_id = plugin_id;
        console.log("connecting ImJoy worker...");
        api.showStatus(
          "Executing plugin script for " + this.config.name + "..."
        );
        for (let i = 0; i < this.config.scripts.length; i++) {
          if (this.config.scripts[i].attrs.lang === "python")
            await executeCode(kernel, this.config.scripts[i].content);
          else
            console.error(
              "unsupported script type: " + this.config.scripts[i].attrs.lang
            );
        }
        console.log("starting jupyter client ...", client_id);
        this.comm = this.setup_comm(kernel);
        api.showStatus(`${this.config.name} is ready.`);
        console.log("ImJoy worker connected...");
        resolve(this.comm);
      } catch (e) {
        console.error("Failed to prepare kernel: ", e);
        reject(e);
      }
    });
  }

  reconnect() {
    return new Promise(async (resolve, reject) => {
      console.log("reconnecting kernel...", this.kernel);
      try {
        const kernelModel = await Kernel.findById(
          this.kernel.id,
          this.kernel.serverSettings
        );
        const kernel = await Kernel.connectTo(
          kernelModel,
          this.kernel.serverSettings
        );
        await kernel.ready;
        this.kernel = kernel;
        console.log("kernel reconnected");
        this.prepare_kernel(kernel, this.id).then(comm => {
          console.log("comm reconnected", kernel, comm);
          // this.setup_comm(comm)
          resolve(comm);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  emit(data) {
    if (this.kernel.status !== "dead" && this.comm && !this.comm.isDisposed) {
      //console.log('message to plugin', this.secret,  data)
      data.peer_id = this._peer_id;
      const split = remove_buffers(data);
      split.state.__buffer_paths__ = split.buffer_paths;
      this.comm.send(split.state, {}, {}, split.buffers);
    } else {
      api.showMessage(
        "The jupyter kernel is disconnected, maybe try to reload the plugin?"
      );
      // this.reconnect().then(()=>{
      //   this.comm.send({
      //     type: "message",
      //     data: data,
      //   });
      // })
    }
  }

  execute(code) {
    return new Promise((resolve, reject) => {
      this._executeSCb = resolve;
      this._executeFCb = reject;
      this.send({
        type: "execute",
        code: code
      });
    });
  }

  disconnect() {
    if (!this._disconnected) {
      this._disconnected = true;
    }
    if (this._disconnectHandler) this._disconnectHandler();

    if (this.kernel) {
      console.log("shutting don kernel: ", this.kernel.id);
      jserver.killKernel(this.kernel);
      this.kernel = null;
    }
  }
}
