import ContentsManager from "./JupyterContents";
import { Kernel, ServerConnection } from "@jupyterlab/services";
import BinderHub from "./BinderHub";
import { fixOverwrittenChars, fixConsole } from "./util";
import {
  util,
  DEFAULT_SPEC,
  DEFAULT_PROVIDER,
  DEFAULT_BASE_URL
} from "./index";

const baseToWsUrl = baseUrl =>
  (baseUrl.startsWith("https:") ? "wss:" : "ws:") +
  baseUrl
    .split(":")
    .slice(1)
    .join(":");

function normalizePath(path) {
  path = Array.prototype.join.apply(arguments, ["/"]);
  var sPath;
  while (sPath !== path) {
    sPath = n(path);
    path = n(sPath);
  }
  function n(s) {
    return s.replace(/\/+/g, "/").replace(/\w+\/+\.\./g, "");
  }
  return path.replace(/^\//, "").replace(/\/$/, "");
}

// converts HTML to text using Javascript
function html2text(html) {
  var tag = document.createElement("div");
  tag.innerHTML = html;

  return tag.innerText;
}

async function pingServer(url) {
  const response = await fetch(url);
  return response.status === 200;
}

export function executeCode(kernel, code) {
  return new Promise((resolve, reject) => {
    const execution = kernel.requestExecute({
      code: code
    });
    console.log(kernel, execution);
    execution.onIOPub = msg => {
      if (msg.msg_type === "stream") {
        if (msg.content.name === "stdout" || msg.content.name === "stderr") {
          let data = msg.content.text;
          data = util.fixOverwrittenChars(data);
          // escape ANSI & HTML specials in plaintext:
          data = util.fixConsole(data);
          // if error is detected
          if (data.includes('<span class="ansi-red-fg">ERROR:')) {
            reject(html2text(data));
          }
          data = html2text(data);
          // data = util.autoLinkUrls(data);
          api.showStatus(data);
          if (data.startsWith("ERROR:")) console.error(data);
          else if (data.startsWith("WARNING:")) console.warn(data);
          else console.log(data);
        }
      }
    };
    execution.done
      .then(reply => {
        if (reply.content.status !== "ok") {
          let error_msg = "";
          for (let data of reply.content.traceback) {
            data = fixOverwrittenChars(data);
            // escape ANSI & HTML specials in plaintext:
            data = fixConsole(data);
            // data = util.autoLinkUrls(data);
            data = html2text(data);
            // remove leading dash
            data = data.replace(/^-+|-+$/g, "");
            error_msg += data;
          }
          api.showStatus(error_msg);
          console.error(error_msg);
          reject(error_msg);
          return;
        }
        resolve(reply.content);
      })
      .catch(reject);
  });
}

function uploadFile(content_manager, file, path, display, progressbar) {
  return new Promise((resolve, reject) => {
    var filename = file.name;
    // change buttons, add a progress bar
    display("Uploading " + filename + "...");
    var parse_large_file = function(f) {
      // codes inspired by https://stackoverflow.com/a/28318964
      // 8MB chunk size chosen to match chunk sizes used by benchmark reference (AWS S3)
      var chunk_size = 1024 * 1024 * 8;
      var offset = 0;
      var chunk = 0;
      var chunk_reader = null;

      var large_reader_onload = function(event) {
        if (event.target.error == null) {
          offset += chunk_size;
          if (offset >= f.size) {
            chunk = -1;
          } else {
            chunk += 1;
          }
          // callback for handling reading: reader_onload in add_upload_button
          upload_file(event.target.result, chunk); // Do the upload
        } else {
          console.log("Read error: " + event.target.error);
        }
      };
      var on_error = function(event) {
        display("Failed to read file '" + file.name + "'");
        reject("Failed to read file '" + file.name + "'");
      };

      chunk_reader = function(_offset, _f) {
        var reader = new FileReader();
        var blob = _f.slice(_offset, chunk_size + _offset);
        // Load everything as ArrayBuffer
        reader.readAsArrayBuffer(blob);
        // Store the list item in the reader so we can use it later
        // to know which item it belongs to.
        reader.onload = large_reader_onload;
        reader.onerror = on_error;
      };

      // This approach avoids triggering multiple GC pauses for large files.
      // Borrowed from kanaka's answer at:
      // https://stackoverflow.com/questions/12710001/how-to-convert-uint8-array-to-base64-encoded-string
      var Uint8ToString = function(u8a) {
        var CHUNK_SZ = 0x8000;
        var c = [];
        for (var i = 0; i < u8a.length; i += CHUNK_SZ) {
          c.push(
            String.fromCharCode.apply(null, u8a.subarray(i, i + CHUNK_SZ))
          );
        }
        return c.join("");
      };

      // These codes to upload file in original class
      var upload_file = function(filedata, chunk) {
        var format = "text";
        if (filedata instanceof ArrayBuffer) {
          // base64-encode binary file data
          var buf = new Uint8Array(filedata);
          filedata = btoa(Uint8ToString(buf));
          format = "base64";
        }
        var model = { name: filename, path: path };

        // var name_and_ext = utils.splitext(filename);
        // var file_ext = name_and_ext[1];
        var content_type;
        // Treat everything as generic file
        model.type = "file";
        model.format = format;
        content_type = "application/octet-stream";

        model.chunk = chunk;
        model.content = filedata;

        var on_success = function() {
          if (offset < f.size) {
            // of to the next chunk
            chunk_reader(offset, f);
            // change progress bar and progress button
            var progress = (offset / f.size) * 100;
            progress = progress > 100 ? 100 : progress;
            display(`Uploading ${file.name} (${progress.toFixed(1)}%)...`);
            progressbar(progress);
          } else {
            display("Upload finished.");
            resolve();
          }
        };

        content_manager.save(path, model).then(on_success, on_error);
      };

      // now let's start the read with the first block
      chunk_reader(offset, f);
    };

    parse_large_file(file);
  });
}

export default class JupyterServer {
  constructor() {
    // this._kernelHeartbeat = this._kernelHeartbeat.bind(this)
    this.cached_servers = {};
    this.registered_file_managers = {};
    this.knownKernels = [];

    if (localStorage.jupyter_servers) {
      try {
        this.cached_servers = JSON.parse(localStorage.jupyter_servers);
        console.log("kernels loaded:", this.cached_servers);
        for (let k in this.cached_servers) {
          const { url, token } = this.cached_servers[k];
          // check if the server is alive, otherwise remove it
          const serverSettings = ServerConnection.makeSettings({
            baseUrl: url,
            wsUrl: baseToWsUrl(url),
            token: token
          });
          Kernel.getSpecs(serverSettings).catch(() => {
            delete this.cached_servers[k];
          });
        }
      } catch (e) {}
    }
    this.cached_kernels = {};
    if (localStorage.jupyter_kernels) {
      try {
        this.cached_kernels = JSON.parse(localStorage.jupyter_kernels);
        console.log("kernels loaded:", this.cached_kernels);
      } catch (e) {}
    }
    console.log(
      "cached servers: ",
      this.cached_servers,
      "cached kernels: ",
      this.cached_kernels
    );

    this._kernels = {};

    // Keep track of properties for debugging
    this.kernel = null;
    this._kernelHeartbeat();
  }

  async _kernelHeartbeat(seconds_between_check = 5) {
    for (let k in this.cached_kernels) {
      try {
        await this._getKernel(k);
        console.log("kernel is live: ", k);
      } catch (err) {
        console.log("Looks like the kernel died:", err.toString());
        console.log("Starting a new kernel...");
        delete this.cached_kernels[k];
      }
    }

    localStorage.jupyter_kernels = JSON.stringify(this.cached_kernels);
    setTimeout(this._kernelHeartbeat, seconds_between_check * 1000);
  }

  setupKernelCallbacks(kernel) {
    const _close_callbacks = [];
    kernel.statusChanged.connect(() => {
      // console.log('kernel status changed', kernel.status);
      if (kernel.status === "dead") {
        kernel.close();
      }
    });
    kernel.onClose = handler => {
      _close_callbacks.push(handler);
    };
    kernel.close = () => {
      for (let cb of _close_callbacks) {
        try {
          cb();
        } catch (e) {
          console.error(e);
        }
      }
      if (jserver._kernels[kernel.id])
        if (kernel.shutdown) {
          kernel.shutdown().finally(() => {
            delete jserver._kernels[kernel.id];
          });
        } else {
          delete jserver._kernels[kernel.id];
        }
    };
  }

  async _getKernel(key, serverSettings_) {
    if (!this.cached_kernels[key]) {
      throw "kernel not found: " + key;
    }
    const { baseUrl, token, kernelId } = this.cached_kernels[key];
    if (
      serverSettings_ &&
      (baseUrl !== serverSettings_.baseUrl || token !== serverSettings_.token)
    ) {
      throw "server settings mismatch.";
    }
    if (this._kernels[kernelId] && this._kernels[kernelId].status === "idle") {
      console.log("reusing a running kernel", kernelId);
      return this._kernels[kernelId];
    }
    const { serverSettings, kernelModel } = await this._getKernelModel(
      baseUrl,
      token,
      kernelId
    );
    const kernel = await Kernel.connectTo(kernelModel, serverSettings);
    this.setupKernelCallbacks(kernel);

    if (this._kernels[kernel.id]) {
      this._kernels[kernel.id].ready.then(this._kernels[kernel.id].shutdown);
    }
    this._kernels[kernel.id] = kernel;
    return kernel;
  }

  async _getKernelModel(baseUrl, token, kernelId) {
    const serverSettings = ServerConnection.makeSettings({
      baseUrl: baseUrl,
      wsUrl: baseToWsUrl(baseUrl),
      token: token
    });

    const kernelModel = await Kernel.findById(kernelId, serverSettings);
    return { serverSettings, kernelModel };
  }

  async startServer({
    name = null,
    spec = DEFAULT_SPEC,
    baseUrl = DEFAULT_BASE_URL,
    provider = DEFAULT_PROVIDER,
    nbUrl = false
  } = {}) {
    let serverSettings = null;
    let server_url = null,
      server_token = null;

    // clear cookie, so it will use token as authentication
    document.cookie = null;

    const config_str = JSON.stringify({ name, spec, baseUrl, provider, nbUrl });
    if (this.cached_servers[config_str]) {
      const { url, token } = this.cached_servers[config_str];
      server_url = url;
      server_token = token;
      try {
        // Connect to the notebook webserver.
        serverSettings = ServerConnection.makeSettings({
          baseUrl: url,
          wsUrl: baseToWsUrl(url),
          token: token
        });
        const kernelSpecs = await Kernel.getSpecs(serverSettings);
        console.log("reusing an existing server: ", url, kernelSpecs);
        api.log("Connected to an existing server: " + url);
      } catch (e) {
        console.log(
          "failed to reuse an existing server, will start another one."
        );
        delete this.cached_servers[config_str];
      }
    }

    if (!serverSettings) {
      const binder = new BinderHub({ spec, baseUrl, provider, nbUrl });
      binder.registerCallback("*", (oldState, newState, data) => {
        if (data.message !== undefined) {
          api.log(data.message);
          api.showStatus(data.message);
        } else {
          console.log(data);
        }
      });
      const { url, token } = await binder.startServer();
      server_url = url;
      server_token = token;

      api.log("New server started: " + url);

      // Connect to the notebook webserver.
      serverSettings = ServerConnection.makeSettings({
        baseUrl: url,
        wsUrl: baseToWsUrl(url),
        token: token
      });

      const kernelSpecs = await Kernel.getSpecs(serverSettings);

      this.cached_servers[config_str] = { url, token };
      localStorage.jupyter_servers = JSON.stringify(this.cached_servers);
    }

    if (!this.registered_file_managers[server_url]) {
      const contents = new ContentsManager({ serverSettings: serverSettings });
      const url = server_url;
      const token = server_token;
      let name = new URL(url);
      let _file_list = [];
      let fail_count = 20;
      name = name.pathname === "/" ? name.hostname : name.pathname;
      let enable_show_file_dialog = false;
      if (await pingServer(server_url + "elfinder" + "?token=" + token)) {
        enable_show_file_dialog = true;
      }
      await api.register({
        type: "file-manager",
        name: name,
        url: url,
        showFileDialog: enable_show_file_dialog
          ? async config => {
              const w = await api.showDialog({
                name: "File Manager " + name,
                src: server_url + "elfinder" + "?token=" + token,
                config: config
              });
              const selections = await w.getSelections(config);
              return selections;
            }
          : null,
        async listFiles(root, type, recursive) {
          root = normalizePath(root);
          const file_url = `${url}api/contents/${encodeURIComponent(
            root
          )}?token=${token}&${Math.random()
            .toString(36)
            .substr(2, 9)}`;
          const response = await fetch(file_url);
          const files = await response.json();
          files.children = files.content;
          _file_list = files.content;
          console.log("listing files", file_url, files);
          return files;
        },
        async removeFile(path, type, recursive) {
          path = normalizePath(path);
          await contents.delete(path);
        },
        getFileUrl(config) {
          // contents.getDownloadUrl(config.path)
          const path = normalizePath(config.path);
          return `${url}view/${encodeURIComponent(path)}?token=${token}`;
        },
        async createFolder(folder_name) {
          let root = ".";
          if (folder_name.includes("/")) {
            const p = folder_name.split("/");
            root = p.slice(0, p.length - 1).join("/");
            folder_name = p[p.length - 1];
          }
          const ret = await contents.newUntitled({
            path: root,
            type: "directory"
          });
          return await contents.rename(
            ret.path,
            normalizePath(root + "/" + folder_name)
          );
        },
        async putFile(file, path) {
          return await uploadFile(
            contents,
            file,
            path,
            api.showMessage,
            api.showProgress
          );
          // throw "File upload is not supported"
        },
        requestUploadUrl(config) {
          let path = normalizePath(config.path);
          const dir = normalizePath(config.dir);
          if (dir && !dir === ".") path = dir + "/" + path;
          if (path.startsWith("./")) path = path.slice(2);
          console.log("generating upload url: ", path);
          return `${url}api/contents/${encodeURIComponent(
            path
          )}?token=${token}`;
        },
        async heartbeat() {
          try {
            await Kernel.getSpecs(serverSettings);
            fail_count = 20;
          } catch (e) {
            fail_count--;
            if (fail_count <= 0) {
              console.log("Removing file manager.");
              api.unregister({
                type: "file-manager",
                url: url
              });
              delete this.registered_file_managers[url];
              return false;
            }
          }
          return true;
        }
      });

      this.registered_file_managers[url] = { url: url, contents: contents };
    }

    // localStorage.serverParams = JSON.stringify({ url, token })
    return serverSettings;
  }

  async startKernel(key, serverSettings, kernelSpecName) {
    try {
      // Start a kernel
      if (!kernelSpecName) {
        const kernelSpecs = await Kernel.getSpecs(serverSettings);
        kernelSpecName = kernelSpecs.default;
      }
      console.log("Starting kernel with spec: " + kernelSpecName);
      const kernel = await Kernel.startNew({
        name: kernelSpecName,
        serverSettings
      });
      api.showStatus("Waiting for kernel to start...");
      await kernel.ready;
      if (this.knownKernels.indexOf(kernel.name) < 0) {
        this.knownKernels.push(kernel.name);
        api.showStatus("Installing imjoy to the kernel...");
        await executeCode(kernel, "!python -m pip install -U imjoy");
      }
      this.setupKernelCallbacks(kernel);
      // Store the params in localStorage for later use
      // localStorage.kernelId = kernel.id
      if (this._kernels[kernel.id]) {
        this._kernels[kernel.id].shutdown();
      }
      this._kernels[kernel.id] = kernel;
      this.cached_kernels[key] = {
        baseUrl: serverSettings.baseUrl,
        token: serverSettings.token,
        kernelId: kernel.id
      };
      localStorage.jupyter_kernels = JSON.stringify(this.cached_kernels);

      api.log("Kernel started: " + kernel.id);
      return kernel;
    } catch (err) {
      console.error("Error in kernel initialization :(");
      throw err;
    }
  }

  installRequirements(kernel, reqs, conda_available) {
    return new Promise(async (resolve, reject) => {
      const commands = []; //'!python -m pip install --upgrade pip'
      if (!Array.isArray(reqs)) {
        reqs = [reqs];
      }
      for (let req of reqs) {
        if (req.includes(":")) {
          const req_parts = req.split(":");
          const typ = req_parts[0].trim();
          const libs_ = req_parts
            .slice(1)
            .join(":")
            .trim();
          const libs = [];
          for (let l of libs_.split(" ")) {
            if (l.trim()) {
              libs.push(l.trim());
            }
          }

          if (typ === "conda" && libs && conda_available)
            commands.push("!conda install -y " + libs.join(" "));
          else if (typ === "pip" && libs)
            commands.push("!python -m pip install " + libs.join(" "));
          else if (typ == "repo" && libs) {
            const temp = libs[0].split("/");
            const name = temp[temp.length - 1].replace(".git", "");
            commands.push(
              "!git clone --progress --depth=1 " +
                libs[0] +
                " " +
                (libs.length > 1 ? libs[1] : name)
            );
          } else if (typ === "cmd" && libs) commands.push("!" + libs.join(" ").trim());
          else if (typ.includes("+") || typ.includes("http"))
            commands.push(`!python -m pip install ${req}`);
          else throw `Unsupported requirement type: ${typ}`;
        } else {
          commands.push(`!python -m pip install ${req}`);
        }
      }

      let execution = kernel.requestExecute({ code: commands.join("\n") });
      api.log(
        `Installing requirements for kernel ${kernel.id}: ${JSON.stringify(
          commands
        )}`
      );
      execution.onIOPub = msg => {
        if (msg.msg_type === "stream") {
          if (msg.content.name === "stdout" || msg.content.name === "stderr") {
            let data = msg.content.text;
            data = util.fixOverwrittenChars(data);
            // escape ANSI & HTML specials in plaintext:
            data = util.fixConsole(data);
            // if Error is detected
            if (data.includes('<span class="ansi-red-fg">ERROR:')) {
              reject(html2text(data));
            }
            data = html2text(data);
            // data = util.autoLinkUrls(data);
            api.showStatus(data);
            if (data.startsWith("ERROR:")) console.error(data);
            else if (data.startsWith("WARNING:")) console.warn(data);
            else console.log(data);
          }
        }
      };
      execution.done
        .then(reply => {
          if (reply.content.status !== "ok") {
            let error_msg = "";
            for (let data of reply.content.traceback) {
              data = fixOverwrittenChars(data);
              // escape ANSI & HTML specials in plaintext:
              data = fixConsole(data);
              // data = util.autoLinkUrls(data);
              data = html2text(data);
              // remove leading dash
              data = data.replace(/^-+|-+$/g, "");
              error_msg += data;
            }
            api.showStatus(error_msg);
            console.error(error_msg);
            reject(error_msg);
          } else resolve();
        })
        .catch(reject);
    });
  }

  async killKernel(kernel) {
    if (kernel.close) return kernel.close();
    else return kernel.shutdown();
  }
}
