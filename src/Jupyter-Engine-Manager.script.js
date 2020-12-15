const DEFAULT_BASE_URL = JupyterEngineManager.DEFAULT_BASE_URL;
const DEFAULT_PROVIDER = JupyterEngineManager.DEFAULT_PROVIDER;
const DEFAULT_SPEC = JupyterEngineManager.DEFAULT_SPEC;

const ServerConnection = JupyterEngineManager.services.ServerConnection;
const Kernel = JupyterEngineManager.services.Kernel;
const baseToWsUrl = baseUrl =>
  (baseUrl.startsWith("https:") ? "wss:" : "ws:") +
  baseUrl
    .split(":")
    .slice(1)
    .join(":");

async function save_engine_config(engine_config) {
  let saved_engines = await api.getConfig("engines");
  try {
    saved_engines = saved_engines ? JSON.parse(saved_engines) : {};
  } catch (e) {
    saved_engines = {};
  }
  if (engine_config) {
    for (let k in saved_engines) {
      if (saved_engines[k].name === engine_config.name) {
        delete saved_engines[k];
      }
    }
    saved_engines[engine_config.url] = engine_config;
  }
  await api.setConfig("engines", JSON.stringify(saved_engines));
  return saved_engines;
}

const jserver = new JupyterEngineManager.JupyterServer();

async function setup() {
  await api.register({
    type: "engine-factory",
    name: "MyBinder-Engine",
    addEngine: addMyBinderEngine,
    async removeEngine(engine_config) {
      if (
        await api.confirm(
          `Do you really want to remove the engine ${engine_config.name}?`
        )
      ) {
        return await removeEngine(engine_config);
      }
    }
  });

  await api.register({
    type: "engine-factory",
    name: "Jupyter-Engine",
    addEngine: addJupyterEngine,
    async removeEngine(engine_config) {
      if (
        await api.confirm(
          `Do you really want to remove the engine ${engine_config.name}?`
        )
      ) {
        return await removeEngine(engine_config);
      }
    }
  });

  // create the binder plugin for the first time
  const temp = await api.getConfig("engines");
  if (!temp) {
    createEngine(
      {
        name: "MyBinder Engine",
        url: DEFAULT_BASE_URL,
        spec: DEFAULT_SPEC
      },
      true
    );
  }

  // restoring the plugin state
  let saved_engines = await save_engine_config();
  for (let url in saved_engines) {
    const config = saved_engines[url];
    loadEngine(config, true);
  }
  api.log("initialized");
}

async function addJupyterEngine() {
  // Connect to the notebook webserver.
  const description = `#### Jupyter Engine <sup>alpha</sup>
 
  This allows ImJoy run Python plugin via a [Jupyter](https://jupyter.org/) server. The easiest way to run Jupyter notebook is by using [Anaconda](https://docs.anaconda.com/anaconda/) or [Miniconda](https://docs.conda.io/en/latest/miniconda.html).  
  1. Install Jupyter server with command <code>pip install -U imjoy</code>
  2. Start a Jupyter server from your terminal (or Anaconda Prompt) with the command: <br><code>imjoy --jupyter</code>
  3. Copy and paste the provided URL in "Jupyter Notebook URL" below. **⚠️Important**: the URL needs to contain the connection token, e.g.: http://localhost:8888/?token=caac2d7f2e8e0...ad871fe
  4. Click "CONNECT TO JUPYTER"

**Note**: Due to security reasons, ImJoy cannot connect to remote notebook server served without <code>https</code>, for Chrome/Firefox, the only exception is the URL for localhost (127.0.0.1 or localhost, Safari can only be used with https URL).
`;
  const dialog = await api.showDialog({
    type: "imjoy/schema-io",
    name: "Connect to a Jupyter Engine",
    data: {
      id: 0,
      type: "form",
      schema: {
        fields: [
          {
            type: "input",
            inputType: "text",
            label: "Engine Name",
            model: "name"
          },
          {
            type: "input",
            inputType: "text",
            label: "Jupyter Notebook URL",
            hint:
              "A Jupyter notebook server url with token, e.g.: http://localhost:8888/?token=caac2d7f2e8e0...ad871fe",
            model: "nbUrl"
          }
        ]
      },
      data: {
        nbUrl: "",
        name: "Jupyter Notebook"
      },
      options: {
        validateAfterLoad: true,
        validateAfterChanged: true
      },
      description: description,
      buttons: [
        {
          label: "Connect to Jupyter",
          event_id: "add",
          class: "md-primary md-raised"
        }
      ]
    }
  });
  dialog.on("add", async config => {
    dialog.close();
    config.url = config.nbUrl.split("?")[0];
    config.disabled = false;
    createEngine(config, true);
  });
}

async function addMyBinderEngine() {
  // Connect to the notebook webserver.
  const description = `### MyBinder Engine <sup>alpha</sup>
  You can run Python plugin in ImJoy via free Jupyter servers provided by [MyBinder.org](https://mybinder.org). 
  This engine runs remotely, so no local installation or setup is required. 
  However, the provided computation power is limited (e.g. only 1GB memory and no GPU support).

  To add a new MyBinder Engine, you can keep the default settings below and click "START ANOTHER BINDER ENGINE".
  To reduce the startup time, you can specify plugin specific <code>Specification</code> repository on Github according to [here](https://mybinder.readthedocs.io/en/latest/config_files.html#config-files). 

⚠️Note 1: This feature is still in development, and new features such as file uploading and terminal will be supported soon.
⚠️Note 2: You should **never** process sensitive data with MyBinder Engine ([more information](https://mybinder.readthedocs.io/en/latest/faq.html#how-secure-is-mybinder-org)).
`;
  const dialog = await api.showDialog({
    type: "imjoy/schema-io",
    name: "Start Another MyBinder Engine",
    data: {
      id: 0,
      type: "form",
      schema: {
        fields: [
          {
            type: "input",
            inputType: "text",
            label: "Engine Name",
            model: "name"
          },
          {
            type: "input",
            inputType: "text",
            label: "Specification",
            hint:
              "A github repo with configuration files, format: GITHUB_USER/GITHUB_REPO/BRANCH",
            model: "spec"
          },
          {
            type: "input",
            inputType: "text",
            label: "Binder URL",
            model: "url"
          }
        ]
      },
      data: {
        name: "New Binder Engine",
        url: DEFAULT_BASE_URL,
        spec: DEFAULT_SPEC
      },
      options: {
        validateAfterLoad: true,
        validateAfterChanged: true
      },
      description: description,
      buttons: [
        {
          label: "Start another Binder Engine",
          event_id: "add",
          class: "md-primary md-raised"
        }
      ]
    }
  });
  dialog.on("add", async config => {
    dialog.close();
    config.disabled = false;
    createEngine(config, true);
  });
}

async function pingServer(url) {
  const response = await fetch(url);
  return response.status === 200;
}

const registered_engines = {};

async function createEngine(engine_config, saveEngine) {
  // make sure we enable it
  engine_config.disabled = false;
  await loadEngine(engine_config, saveEngine);
}

async function loadEngine(engine_config, saveEngine) {
  return new Promise(async (resolve, reject) => {
    const engine_kernels = {};
    let _connected = false;
    let initial_connection = !engine_config.disabled;
    const killPlugin = config => {
      for (let k in jserver._kernels) {
        const kernel = jserver._kernels[k];
        if (kernel.pluginName === config.name) {
          try {
            console.log("killing plugin", config.name);
            jserver.killKernel(kernel);
          } catch (e) {
            console.error(e);
          }
        }
      }
    };
    await api.register({
      type: "engine",
      pluginType: "native-python",
      factory: "Jupyter-Engine",
      icon: "🚀",
      name: engine_config.name,
      url: engine_config.url,
      config: engine_config,
      async connect() {
        // do not connect for the first time if the engine was disconnected
        if (!initial_connection) {
          initial_connection = true;
          return false;
        }
        if (engine_config.nbUrl) {
          const serverUrl = engine_config.nbUrl.split("?")[0];

          try {
            api.showMessage("Connecting to plugin engine " + serverUrl + "...");
            await jserver.startServer(engine_config);
            api.showMessage("🎉Connected to server " + serverUrl + ".");
          } catch (e) {
            if (e.toString().includes("403 Forbidden")) {
              console.error(e);
              api.showMessage(
                "Failed to connect to server " +
                  serverUrl +
                  ", maybe the token is wrong?"
              );
            } else {
              console.error(e);
              api.showMessage(
                "Failed to connect to plugin engine " + serverUrl + "."
              );
            }
            throw e;
          }
        } else {
          try {
            await pingServer(engine_config.url);
            api.showStatus("🎉Connected to MyBinder.");
          } catch (e) {
            console.error(e);
            api.showMessage("Failed to start server on MyBinder.org");
            throw e;
          }
        }
        _connected = true;
        resolve();
        return true;
      },
      async enable() {
        engine_config.disabled = false;
        if (saveEngine) await save_engine_config(engine_config);
      },
      async disable() {
        engine_config.disabled = true;
        if (saveEngine) await save_engine_config(engine_config);
      },
      async disconnect() {
        if (registered_engines[engine_config.name]) {
          for (let kernel of Object.values(
            registered_engines[engine_config.name].kernels
          )) {
            try {
              // TODO: handle allow-detach flag
              jserver.killKernel(kernel);
            } catch (e) {
              console.error(e);
            }
          }
          registered_engines[engine_config.name].kernels = [];
        }
        reject();
        _connected = false;
      },
      listPlugins: () => {},
      getPlugin: () => {},
      startPlugin: (config, imjoy_interface, engine_utils) => {
        return new Promise(async (resolve, reject) => {
          if (!_connected) {
            reject("Engine is disconnected.");
            return;
          }
          try {
            let kernel;
            let skipRequirements = false;
            // try to restore the previous kernel
            if (config.hot_reloading) {
              for (const kid of Object.keys(engine_kernels)) {
                if (
                  engine_kernels[kid].status !== "dead" &&
                  engine_kernels[kid].pluginName === config.name
                ) {
                  kernel = engine_kernels[kid];
                  console.log("Reusing an existing kernel: " + kernel.id);
                  break;
                }
              }
              if (
                kernel &&
                kernel.installedRequirements ===
                  JSON.stringify(config.requirements)
              ) {
                skipRequirements = true;
              }
            }
            if (!kernel) {
              try {
                killPlugin({
                  id: config.id,
                  name: config.name
                });
              } catch (e) {
                console.error(e);
              }

              let serverSettings,
                kernelSpecName = null;

              if (engine_config.nbUrl) {
                serverSettings = await jserver.startServer(
                  engine_config,
                  imjoy_interface
                );
              } else {
                try {
                  if (!localStorage.binder_confirmation_shown) {
                    const ret = await api.confirm({
                      title: "📌Notice: About to run plugin on mybinder.org",
                      content: `You are going to run <code>${config.name}</code> on a public cloud server provided by <a href="https://mybinder.org" target="_blank">MyBinder.org</a>, please be aware of the following: <br><br> 1. This feature is currently in development, more improvements will come soon; <br> 2. The computational resources provided by MyBinder.org are limited (e.g. 1GB memory, no GPU support); <br>3. Please do not use it to process sensitive data. <br><br> For more stable use, please setup your own <a href="https://jupyter.org/" target="_blank">Jupyter notebook</a>. <br> <br> If you encountered any issue, please report it on the <a href="https://github.com/oeway/ImJoy/issues" target="_blank">ImJoy repo</a>. <br><br> Do you want to continue? <br> (You won't see this message again if you select Yes)`,
                      confirm_text: "Yes"
                    });
                    if (!ret) {
                      reject("User canceled plugin execution.");
                      return;
                    }
                    localStorage.binder_confirmation_shown = true;
                  }
                } catch (e) {
                  console.error(e);
                }

                if (
                  imjoy_interface.TAG &&
                  imjoy_interface.TAG.includes("GPU")
                ) {
                  const ret = await api.confirm({
                    title: "📌Running plugin that requires GPU?",
                    content: `It seems you are trying to run a plugin with GPU tag, however, please notice that the server on MyBinder.org does NOT support GPU. <br><br> Do you want to continue?`,
                    confirm_text: "Yes"
                  });
                  if (!ret) {
                    reject("User canceled plugin execution.");
                    return;
                  }
                }
                let binderSpec = DEFAULT_SPEC;
                if (Array.isArray(config.env)) {
                  for (let e of config.env) {
                    if (e.type === "binder" && e.spec) {
                      binderSpec = e.spec;
                      kernelSpecName = e.kernel;
                      skipRequirements = e.skip_requirements;
                    }
                  }
                }
                console.log("Starting server with binder spec", binderSpec);
                engine_config.spec = binderSpec;
                serverSettings = await jserver.startServer(
                  engine_config,
                  imjoy_interface
                );
              }
              kernel = await jserver.startKernel(
                config.name,
                serverSettings,
                kernelSpecName,
                imjoy_interface
              );
              api.showMessage(
                "🎉 Jupyter Kernel started (" + serverSettings.baseUrl + ")"
              );
              kernel.pluginId = config.id;
              kernel.pluginName = config.name;
              engine_kernels[kernel.id] = kernel;
              kernel.onClose(() => {
                engine_utils.terminatePlugin();
              });
            }
            if (skipRequirements) {
              console.log("skipping requirements...");
            } else {
              await jserver.installRequirements(
                kernel,
                config.requirements,
                true,
                imjoy_interface
              );
              kernel.installedRequirements = JSON.stringify(
                config.requirements
              );
            }

            try {
              const plugin_api = await JupyterEngineManager.setupPlugin(
                kernel,
                config,
                imjoy_interface,
                engine_utils
              );
              resolve(plugin_api);
            } catch (e) {
              reject(e);
            }
          } catch (e) {
            console.error(e);
            api.showMessage(
              "Failed to start plugin " + config.name + ", " + e.toString()
            );
            reject(e);
          }
        });
      },
      getEngineConfig() {
        return {};
      },
      async getEngineStatus() {
        const kernels_info = [];
        // for(let k in jserver._kernels){
        //   const kernel = jserver._kernels[k]
        //   kernels_info.push({name: kernel.pluginName || kernel.name, pid: kernel.id})
        // }
        for (let k in jserver.cached_servers) {
          const { url, token } = jserver.cached_servers[k];
          // Connect to the notebook webserver.
          const serverSettings = ServerConnection.makeSettings({
            baseUrl: url,
            wsUrl: baseToWsUrl(url),
            token: token
          });
          try {
            const kernels = await Kernel.listRunning(serverSettings);
            for (let kernel of kernels) {
              kernels_info.push({
                name: engine_kernels[kernel.id]
                  ? engine_kernels[kernel.id].pluginName
                  : kernel.id,
                pid: kernel.id,
                baseUrl: url,
                wsUrl: baseToWsUrl(url),
                token: token
              });
            }
          } catch (e) {
            console.error("removing dead server:", e);
          }
        }
        return {
          plugin_processes: kernels_info
        };
        // return engine.updateEngineStatus()
      },
      killPlugin,
      async killPluginProcess(p) {
        // kernel.close()
        try {
          if (jserver._kernels[p.pid]) {
            jserver.killKernel(jserver._kernels[p.pid]);
          } else {
            const serverSettings = ServerConnection.makeSettings(p);
            const kernelModel = await Kernel.findById(p.pid, serverSettings);
            const kernel = await Kernel.connectTo(kernelModel, serverSettings);
            await kernel.shutdown();
          }
        } catch (e) {
          console.error(e);
        } finally {
          delete jserver._kernels[p.pid];
        }
        // return engine.killPluginProcess(p)
      },
      heartbeat() {
        return _connected;
      },
      async startTerminal() {
        if (Object.keys(jserver.cached_servers).length <= 0) {
          api.alert("No jupyter engine is currently running.");
          return;
        }
        // data-base-url="/user/oeway-imjoy-binder-image-8o8ztfkj/" data-ws-url="" data-ws-path="terminals/websocket/1"
        // ws_url = ws_url + base_url + ws_path;

        const buttons = [];
        let i = 0;
        for (let k in jserver.cached_servers) {
          const { url, token } = jserver.cached_servers[k];
          // Connect to the notebook webserver.
          const serverSettings = ServerConnection.makeSettings({
            baseUrl: url,
            wsUrl: baseToWsUrl(url),
            token: token
          });
          const ws_url = serverSettings.wsUrl + "terminals/websocket/1"; //'wss://hub-binder.mybinder.ovh/user/oeway-imjoy-binder-image-8o8ztfkj/terminals/websocket/1'
          let name = new URL(url);
          name = name.pathname === "/" ? name.hostname : name.pathname;
          buttons.push({
            label: name,
            event_id: k,
            ws_url: ws_url
          });
          i++;
        }
        const w = {
          name: "Terminal",
          type: "imjoy/terminal",
          config: {},
          w: 30,
          h: 15,
          standalone: false,
          data: {
            buttons: buttons
          }
        };
        const terminal_window = await api.createWindow(w);

        let terminal_started = false;

        const make_terminal = ws_url => {
          if (terminal_started) {
            api.alert(
              "Please open another terminal window if you want to switch server."
            );
            return;
          }
          // clear the buttons;
          terminal_window.emit("show_buttons", []);
          terminal_started = true;
          var ws = new WebSocket(ws_url);
          // Terminal.applyAddon(fit);
          // var term = new Terminal();
          ws.onopen = async event => {
            terminal_window.emit("write", "Connected to terminal\r\n");
            const write = data => {
              terminal_window.emit("write", data);
            };
            const disconnect = data => {
              terminal_window.emit("write", "\r\nDisconnected!\r\n");
            };

            terminal_window.on("fit", config => {
              // send the terminal size to the server.
              ws.send(
                JSON.stringify([
                  "set_size",
                  config["rows"],
                  config["cols"],
                  window.innerHeight,
                  window.innerWidth
                ])
              );
            });
            terminal_window.on("key", key => {
              ws.send(JSON.stringify(["stdin", key]));
            });

            terminal_window.on("paste", data => {
              ws.send(JSON.stringify(["stdin", data]));
            });

            ws.onmessage = function(event) {
              var json_msg = JSON.parse(event.data);
              switch (json_msg[0]) {
                case "stdout":
                case "stderr":
                  write(json_msg[1]);
                  break;
                case "disconnect":
                  write("\r\n\r\n[CLOSED]\r\n");
                  break;
              }
            };
          };
        };
        if (buttons.length == 1) {
          make_terminal(buttons[0].ws_url);
        } else {
          terminal_window.on("button_clicked", event => {
            make_terminal(event.ws_url);
          });
        }
      },
      about() {
        api.alert("An ImJoy Engine for Jupyter Servers.");
        console.log(jserver);
      }
    });

    registered_engines[engine_config.name] = {
      kernels: engine_kernels,
      disconnect: () => {
        for (let kernel of Object.values(
          registered_engines[engine_config.name].kernels
        )) {
          try {
            jserver.killKernel(kernel);
          } catch (e) {
            console.error(e);
          }
        }
        _connected = false;
      }
    };
  });
}

async function removeEngine(engine_config) {
  if (registered_engines[engine_config.name]) {
    registered_engines[engine_config.name].disconnect();
  }
  let saved_engines = await save_engine_config();
  delete saved_engines[engine_config.url];
  await api.setConfig("engines", JSON.stringify(saved_engines));
  return true;
}

api.export({
  setup,
  createEngine,
  removeEngine
});
