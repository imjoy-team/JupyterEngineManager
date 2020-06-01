import {
    util
} from './index'

export default class JupyterConnection {
    constructor(id, type, config, kernel) {
        this._disconnected = false;
        this.id = id;
        this._failHandler = () => {};
        this._disconnectHandler = () => {};
        this._loggingHandler = () => {};
        this._messageHandler = () => {};
        this._initHandler = () => {};

        this.kernel = kernel;

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
            outputs: config.outputs,
        };

        console.log('init_plugin...', config)


    }
    async init() {
        try {
            const comm = await this.prepare_kernel(this.kernel, this.id)
            console.log('kernel prepared...')
            this.initializing = false;
            this._disconnected = false;
            await this.setup_comm(comm)
        } catch (e) {
            this._disconnected = true;
            console.error("failed to initialize plugin on the plugin engine", e);
            this._failHandler("failed to initialize plugin on the plugin engine");
            throw "failed to initialize plugin on the plugin engine";
        }
    }

    setup_comm(comm) {
        return new Promise((resolve, reject) => {
            this._initHandler = resolve
            this.comm = comm;
            comm.onMsg = msg => {
                var data = msg.content.data
                const buffer_paths = data.__buffer_paths__ || [];
                delete data.__buffer_paths__;
                util.put_buffers(data, buffer_paths, msg.buffers || []);
                if (["initialized",
                        "importSuccess",
                        "importFailure",
                        "executeSuccess",
                        "executeFailure"
                    ].includes(data.type)) {
                    this.handle_data_message(data)
                } else {
                    this.handle_data_message({
                        type: 'message',
                        data: data
                    })
                }
            }

            comm.onClose = msg => {
                console.log('comm closed, reconnecting', id, msg);
                this.reconnect()
                reject('Comm is closed');
            };
        })
    }

    handle_data_message(data) {
        if (data.type == "initialized") {
            this.supportBinaryBuffers = data.supportBinaryBuffers
            this.dedicatedThread = data.dedicatedThread;
            this._initHandler();
        } else if (data.type == "logging") {
            this._loggingHandler(data.details);
        } else if (data.type == "disconnected") {
            this._disconnectHandler(data.details);
        } else {
            switch (data.type) {
                case "message":
                    data = data.data
                    // console.log('message_from_plugin_'+this.secret, data)
                    if (data.type == "logging") {
                        this._loggingHandler(data.details);
                    } else if (data.type == "disconnected") {
                        this._disconnectHandler(data.details);
                    } else {
                        this._messageHandler(data);
                    }
                    break;
                    // case "importSuccess":
                    //   this._handleImportSuccess(m.url);
                    //   break;
                    // case "importFailure":
                    //   this._handleImportFailure(m.url, m.error);
                    //   break;
                case "executeSuccess":
                    this._executeSCb();
                    break;
                case "executeFailure":
                    this._executeFCb(data.error);
                    break;
            }
        }
    }

    execute_code(kernel, code) {
        return new Promise((resolve, reject) => {
            const execution = kernel.requestExecute({
                code: code
            })
            console.log(kernel, execution)
            execution.onIOPub = msg => {
                if (msg.msg_type == 'stream') {
                    if (msg.content.name == 'stdout') {
                        api.showStatus(msg.content.text)
                    }
                }
            }
            execution.done.then((reply) => {
                if (reply.content.status !== 'ok') {
                    let error_msg = ''
                    for (let data of reply.content.traceback) {
                        data = util.fixOverwrittenChars(data);
                        // escape ANSI & HTML specials in plaintext:
                        data = util.fixConsole(data);
                        // data = util.autoLinkUrls(data);
                        error_msg += data
                    }
                    api.showStatus(error_msg)
                    console.error(error_msg)
                    reject(error_msg)
                    return
                }
                resolve(reply.content)
            }).catch(reject)
        })
    }

    prepare_kernel(kernel, plugin_id) {
        return new Promise(async (resolve, reject) => {
            try {
                console.log('installing imjoy...')
                api.showStatus('Setting up ImJoy worker...')
                await this.execute_code(kernel, '!python -m pip install -U imjoy')
                const client_id = plugin_id;
                console.log('starting jupyter client ...', client_id)
                await this.execute_code(kernel, `from imjoy.workers.jupyter_client import JupyterClient;JupyterClient.recover_client("${client_id}")`)
                kernel.registerCommTarget(
                    'imjoy_comm_' + client_id,
                    function (comm, open_msg) {
                        //var config = open_msg.content.data
                        //pio.emit("message_from_plugin_" + id, {'type': 'init_plugin', 'id': config.id, 'config': config});       
                        resolve(comm)
                    }
                )
                console.log('connecting ImJoy worker...')
                const command = `from imjoy.workers.python_worker import PluginConnection as __plugin_connection__;__plugin_connection__.add_plugin("${plugin_id}", "${client_id}").start()`;
                await this.execute_code(kernel, command)
                api.showStatus('ImJoy worker is ready.')
                console.log('ImJoy worker connected...')
            } catch (e) {
                console.error('Failed to prepare kernel: ', e)
                reject(e)
            }
        });
    }

    reconnect() {
        return new Promise(async (resolve, reject) => {
            console.log('reconnecting kernel...', this.kernel)
            try {
                const kernelModel = await Kernel.findById(this.kernel.id, this.kernel.serverSettings)
                const kernel = await Kernel.connectTo(kernelModel, this.kernel.serverSettings)
                await kernel.ready
                this.kernel = kernel
                console.log('kernel reconnected')
                this.prepare_kernel(kernel, this.id).then((comm) => {
                    console.log('comm reconnected', kernel, comm)
                    // this.setup_comm(comm)
                    resolve(comm)
                })
            } catch (e) {
                reject(e)
            }

        })
    }

    send(data) {
        if (this.kernel.status !== 'dead' && this.comm && !this.comm.isDisposed) {
            //console.log('message to plugin', this.secret,  data)
            if (this.supportBinaryBuffers) {
                const split = util.remove_buffers(data);
                split.state.__buffer_paths__ = split.buffer_paths
                this.comm.send({
                    type: "message",
                    data: split.state
                }, {}, {}, split.buffers);
            } else {
                this.comm.send({
                    type: "message",
                    data: data
                });
            }

        } else {
            api.showMessage('The jupyter kernel is disconnected, maybe try to reload the plugin?')
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
            console.log('shutting don kernel: ', this.kernel.id)
            jserver.killKernel(this.kernel)
            this.kernel = null;
        };
    }

    onMessage(handler) {
        this._messageHandler = handler;
    }

    onDisconnect(handler) {
        this._disconnectHandler = handler;
    }

    onLogging(handler) {
        this._loggingHandler = handler;
    }

    onFailed(handler) {
        this._failHandler = handler;
    }
}