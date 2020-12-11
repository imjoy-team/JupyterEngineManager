import JupyterConnection from "./JupyterConnection";

export function setupPlugin(kernel, config, imjoy_interface, engine_utils) {
  return new Promise(async (resolve, reject) => {
    console.log("Kernel started:", kernel._id, config.name, kernel);
    const connection = new JupyterConnection(
      config.id,
      "native-python",
      config,
      kernel,
      imjoy_interface
    );
    connection.once("imjoyRPCReady", async data => {
      const config = data.config || {};
      let forwarding_functions = ["close", "on", "off", "emit"];
      if (["rpc-window", "window", "web-python-window"].includes(config.type)) {
        forwarding_functions = forwarding_functions.concat([
          "resize",
          "show",
          "hide",
          "refresh"
        ]);
      }
      let credential;
      if (config.credential_required) {
        if (!Array.isArray(config.credential_fields)) {
          throw new Error(
            "Please specify the `config.credential_fields` as an array of object."
          );
        }
        if (config.credential_handler) {
          credential = await config.credential_handler(
            config.credential_fields
          );
        } else {
          credential = {};
          for (let k in config.credential_fields) {
            credential[k.id] = window.prompt(k.label, k.value);
          }
        }
      }
      connection.emit({
        type: "initialize",
        config: {
          name: config.name,
          type: config.type,
          allow_execution: true,
          enable_service_worker: true,
          forwarding_functions: forwarding_functions,
          expose_api_globally: true,
          credential: credential
        },
        peer_id: data.peer_id
      });
    });

    const codecs = {};
    connection.on("initialized", async data => {
      if (data.error) {
        console.error("Plugin failed to initialize", data.error);
        throw new Error(data.error);
      }
      const pluginConfig = data.config;
      const imjoyRPC = await loadImJoyRPC({
        api_version: pluginConfig.api_version
      });
      console.log(`Using imjoy-rpc ${imjoyRPC.VERSION} for jupyter kernel.`);
      const site = new imjoyRPC.RPC(connection, config, codecs);
      site.on("disconnected", () => {
        console.log("disconnected.");
        connection.disconnect();
        engine_utils.terminatePlugin();
        reject("disconnected");
      });
      site.on("remoteIdle", () => {
        engine_utils.setPluginStatus({
          running: false
        });
      });
      site.on("remoteBusy", () => {
        engine_utils.setPluginStatus({
          running: true
        });
      });
      imjoy_interface.ENGINE_URL = kernel.serverSettings.baseUrl;
      imjoy_interface.FILE_MANAGER_URL = kernel.serverSettings.baseUrl;
      site.setInterface(imjoy_interface);
      site.once("remoteReady", function() {
        const remote_api = site.getRemote();
        remote_api.ENGINE_URL = kernel.serverSettings.baseUrl;
        remote_api.FILE_MANAGER_URL = kernel.serverSettings.baseUrl;
        imjoy_interface.log(
          `plugin ${config.name} (id=${config.id}) initialized.`
        );
        imjoy_interface.showStatus(`🎉Plugin "${config.name}" is ready.`);
        resolve(remote_api);
      });
      site.once("interfaceSetAsRemote", () => {
        site.requestRemote();
      });
      site.sendInterface();
    });

    await connection.connect();
  });
}
