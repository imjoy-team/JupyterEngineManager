const DEFAULT_BASE_URL = 'https://mybinder.org'
const DEFAULT_PROVIDER = 'gh'
const DEFAULT_SPEC = 'oeway/imjoy-binder-image/master' 

const ContentsManager = JupyterEngineManager.ContentsManager
const debounce = JupyterEngineManager.debounce
const ServerConnection = JupyterEngineManager.services.ServerConnection
const Kernel = JupyterEngineManager.services.Kernel
const BinderHub = JupyterEngineManager.BinderHub
const util = JupyterEngineManager.util
const baseToWsUrl = baseUrl =>
  (baseUrl.startsWith('https:') ? 'wss:' : 'ws:') +
  baseUrl
    .split(':')
    .slice(1)
    .join(':')

function normalizePath(path){
  path = Array.prototype.join.apply(arguments,['/'])
  var sPath;
  while (sPath!==path) {
      sPath = n(path);
      path = n(sPath);
  }
  function n(s){return s.replace(/\/+/g,'/').replace(/\w+\/+\.\./g,'')}
  return path.replace(/^\//,'').replace(/\/$/,'');
}

async function save_engine_config(engine_config){
  let saved_engines = await api.getConfig('engines')
  try{
    saved_engines = saved_engines ? JSON.parse(saved_engines) : {}
  }
  catch(e){
    saved_engines = {}
  }
  if(engine_config){
    for(let k in saved_engines){
      if(saved_engines[k].name === engine_config.name){
        delete saved_engines[k];
      }
    }
    saved_engines[engine_config.url] = engine_config
  }
  await api.setConfig('engines', JSON.stringify(saved_engines))
  return saved_engines
}

class JupyterServer {
  constructor() {
    // this._kernelHeartbeat = this._kernelHeartbeat.bind(this)
    this.cached_servers = {}
    this.registered_file_managers = {}

    if(localStorage.jupyter_servers){
      try{
        this.cached_servers = JSON.parse(localStorage.jupyter_servers)
        console.log('kernels loaded:', this.cached_servers)
        for(let k in this.cached_servers){
          const {url, token} = this.cached_servers[k]
          // check if the server is alive, otherwise remove it
          const serverSettings = ServerConnection.makeSettings({
            baseUrl: url,
            wsUrl: baseToWsUrl(url),
            token: token,
          })
          Kernel.getSpecs(serverSettings).catch(()=>{
            delete this.cached_servers[k]
          })
        }
      }
      catch(e){
      }
    }
    this.cached_kernels = {}
    if(localStorage.jupyter_kernels){
      try{
        this.cached_kernels = JSON.parse(localStorage.jupyter_kernels)
        console.log('kernels loaded:', this.cached_kernels)
      }
      catch(e){
      }
    }
    console.log('cached servers: ', this.cached_servers, 'cached kernels: ', this.cached_kernels)

    this._kernels = {}
    
    
    // Keep track of properties for debugging
    this.kernel = null
    this._kernelHeartbeat()
  }

  async _kernelHeartbeat(seconds_between_check = 5){
    for(let k in this.cached_kernels){
      try {
        await this._getKernel(k)
        console.log('kernel is live: ', k)
      } catch (err) {
        console.log('Looks like the kernel died:', err.toString())
        console.log('Starting a new kernel...')
        delete this.cached_kernels[k]
      }
    }
   
    localStorage.jupyter_kernels = JSON.stringify(this.cached_kernels)
    setTimeout(this._kernelHeartbeat, seconds_between_check * 1000)
  }

  setupKernelCallbacks(kernel){
    const _close_callbacks = []
    kernel.statusChanged.connect(() => {
      // console.log('kernel status changed', kernel.status);
      if(kernel.status === 'dead'){
        kernel.close()
      }
    });
    kernel.onClose = (handler)=>{
      _close_callbacks.push(handler);
    }
    kernel.close =() =>{
      for(let cb of _close_callbacks){
        try{
          cb()
        }
        catch(e){
          console.error(e)
        }
      }
      if(jserver._kernels[kernel.id])
      if(kernel.shutdown){
        kernel.shutdown().finally(()=>{
          delete jserver._kernels[kernel.id]
        })
      }
      else{
        delete jserver._kernels[kernel.id]
      }
    }
  }

  async _getKernel(key, serverSettings_) {
    if(!this.cached_kernels[key]){
      throw "kernel not found: "+key
    }
    const { baseUrl, token, kernelId } =  this.cached_kernels[key]
    if(serverSettings_ && (baseUrl !== serverSettings_.baseUrl || token !== serverSettings_.token)){
      throw "server settings mismatch."
    }
    if(this._kernels[kernelId] && this._kernels[kernelId].status === 'idle'){
      console.log('reusing a running kernel', kernelId)
      return this._kernels[kernelId]
    }
    const { serverSettings, kernelModel } = await this._getKernelModel(baseUrl, token, kernelId)
    const kernel = await Kernel.connectTo(kernelModel, serverSettings)
    this.setupKernelCallbacks(kernel);

    if(this._kernels[kernel.id]){
      this._kernels[kernel.id].ready.then(this._kernels[kernel.id].shutdown)
    }
    this._kernels[kernel.id] = kernel
    return kernel
  }

  async _getKernelModel(baseUrl, token, kernelId) {
    const serverSettings = ServerConnection.makeSettings({
      baseUrl: baseUrl,
      wsUrl: baseToWsUrl(baseUrl),
      token: token,
    })

    const kernelModel = await Kernel.findById(kernelId, serverSettings)
    return { serverSettings, kernelModel }
  }

  async getOrStartKernel(key, serverSettings, requirements) {
    try {
      const kernel = await this._getKernel(key, serverSettings)
      console.log('Connected to cached kernel.')
      return kernel
    } catch (err) {
      console.log(
        'No cached kernel, starting kernel a new kernel:',
        err.toString(),
      )
      const kernel = await this.startKernel(key, serverSettings)
      await this.installRequirements(kernel, requirements, true);

      return kernel
    }
  }

  async startServer({
    name = null,
    spec = DEFAULT_SPEC,
    baseUrl = DEFAULT_BASE_URL,
    provider = DEFAULT_PROVIDER,
    nbUrl = false,
  } = {}){   
    let serverSettings = null;
    let server_url = null, server_token = null;

    // clear cookie, so it will use token as authentication
    document.cookie = null;

    const config_str = JSON.stringify({ name, spec, baseUrl, provider, nbUrl })
    if(this.cached_servers[config_str]){
      const {url, token} = this.cached_servers[config_str]
      server_url = url
      server_token = token
      try{
        // Connect to the notebook webserver.
        serverSettings = ServerConnection.makeSettings({
          baseUrl: url,
          wsUrl: baseToWsUrl(url),
          token: token,
        })
        const kernelSpecs = await Kernel.getSpecs(serverSettings)
        console.log('reusing an existing server: ', url, kernelSpecs)
        api.log('Connected to an existing server: ' + url)
      }
      catch(e){
        console.log('failed to reuse an existing server, will start another one.')
        delete this.cached_servers[config_str]
      }
    }

    if(!serverSettings){
      const binder = new BinderHub({ spec, baseUrl, provider, nbUrl })
      binder.registerCallback('*', (oldState, newState, data) => {
        if (data.message !== undefined) {
          api.log(data.message)
          api.showStatus(data.message)
        } else {
          console.log(data)
        }
      })
      const {url, token} = await binder.startServer()
      server_url = url
      server_token = token

      api.log('New server started: ' + url)
      
      // Connect to the notebook webserver.
      serverSettings = ServerConnection.makeSettings({
        baseUrl: url,
        wsUrl: baseToWsUrl(url),
        token: token,
      })

      const kernelSpecs = await Kernel.getSpecs(serverSettings)

      this.cached_servers[config_str] = {url, token}
      localStorage.jupyter_servers = JSON.stringify(this.cached_servers)
    }

    if(!this.registered_file_managers[server_url]){
      const contents = new ContentsManager({serverSettings:serverSettings});
      const url = server_url;
      const token = server_token;
      let name = new URL(url);
      let _file_list = []
      let fail_count = 20;
      name = name.pathname === '/' ? name.hostname: name.pathname ;
      let enable_show_file_dialog = false;
      if(await pingServer(server_url + 'elfinder'+'?token='+token)){
        enable_show_file_dialog = true;
      }
      await api.register({
        type: 'file-manager',
        name: name,
        url: url,
        showFileDialog: enable_show_file_dialog ? (config)=>{
          const w = await api.showDialog({
            type: 'external',
            name: "File Manager " + name,
            src: server_url + 'elfinder'+'?token='+token,
            config: config
          })
          const selections = await w.getSelections(config)
          return selections
        } : null,
        async listFiles(root, type, recursive){
          root = normalizePath(root)
          const file_url = `${url}api/contents/${encodeURIComponent(root)}?token=${token}&${ Math.random().toString(36).substr(2, 9)}`;
          const response = await fetch(file_url);
          const files = await response.json();
          files.children = files.content;
          _file_list = files.content;
          console.log('listing files', file_url, files)
          return files
        },
        async removeFile(path, type, recursive){
          path = normalizePath(path)
          await contents.delete(path)
        },
        getFileUrl(config){
          // contents.getDownloadUrl(config.path)
          const path = normalizePath(config.path)
          return `${url}view/${encodeURIComponent(path)}?token=${token}`;
        },
        async createFolder(folder_name){
          let root = '.'
          if(folder_name.includes('/')){
            const p = folder_name.split('/')
            root = p.slice(0, p.length-1).join('/')
            folder_name = p[p.length-1]
          }
          const ret = await contents.newUntitled({path: root, type: 'directory'})
          return await contents.rename(ret.path, normalizePath(root+'/'+folder_name))
        },
        async putFile(file, path){
          return await uploadFile(contents, file, path, api.showMessage, api.showProgress);
          // throw "File upload is not supported"
        },
        requestUploadUrl(config){
          let path = normalizePath(config.path)
          const dir = normalizePath(config.dir)
          if(dir && !dir === '.') path = dir + '/' + path
          if(path.startsWith('./')) path = path.slice(2)
          console.log('generating upload url: ', path)
          return `${url}api/contents/${encodeURIComponent(path)}?token=${token}`;
        },
        async heartbeat(){
          try{
            await Kernel.getSpecs(serverSettings)
            fail_count = 20;
          }
          catch(e){
            fail_count--;
            if(fail_count<=0){
              console.log('Removing file manager.')
              api.unregister({
                type: 'file-manager',
                url: url
              })
              delete this.registered_file_managers[url]
              return false
            }
          }
          return true
        }
      })
      
      this.registered_file_managers[url] = {url: url, contents: contents};
    }

    // localStorage.serverParams = JSON.stringify({ url, token })
    return serverSettings
  }

  async startKernel(key, serverSettings, kernelSpecName) {
    try {
      // Start a kernel
      if(!kernelSpecName){
        const kernelSpecs = await Kernel.getSpecs(serverSettings)
        kernelSpecName = kernelSpecs.default
      }
      console.log('Starting kernel with spec: ' + kernelSpecName)
      const kernel = await Kernel.startNew({
        name: kernelSpecName,
        serverSettings,
      })
      this.setupKernelCallbacks(kernel);
      // Store the params in localStorage for later use
      // localStorage.kernelId = kernel.id
      if(this._kernels[kernel.id]){
        this._kernels[kernel.id].shutdown()
      }
      this._kernels[kernel.id] = kernel;
      this.cached_kernels[key] = {baseUrl: serverSettings.baseUrl, token: serverSettings.token, kernelId: kernel.id}
      localStorage.jupyter_kernels = JSON.stringify(this.cached_kernels)

      api.log('Kernel started: ' + kernel.id)
      return kernel
    } catch (err) {
      console.error('Error in kernel initialization :(')
      throw err
    }
  }

  installRequirements(kernel, reqs, conda_available) {
    return new Promise(async (resolve, reject) => {
      const commands = [] //'!python -m pip install --upgrade pip'
      if(!Array.isArray(reqs)){
        reqs = [reqs]
      }
      for(let req of reqs){
        if(req.includes(":")){
            const req_parts = req.split(":")
            const typ = req_parts[0].trim()
            const libs_ = req_parts.slice(1).join(":").trim()
            const libs = []
            for(let l of libs_.split(" ")){
              if(l.trim()){
                libs.push(l.trim())
              }
            }
            
            if(typ === "conda" && libs && conda_available)
                commands.push("!conda install -y " + libs.join(" "))
            else if(typ === "pip" && libs)
                commands.push("!python -m pip install " + libs.join(" "))
            else if(typ == "repo" && libs){
              const temp = libs[0].split("/")
              const name = temp[temp.length-1].replace(".git", "")
              commands.push("!git clone --progress --depth=1 " + libs[0] + " " + (libs.length > 1 ? libs[1] : name))
            }
            else if(typ === "cmd" && libs)
                commands.push(libs.join(" "))
            else if(typ.includes("+") || typ.includes("http"))
                commands.push(`!python -m pip install ${req}`)
            else
                throw `Unsupported requirement type: ${typ}`
        }
        else{
          commands.push(`!python -m pip install ${req}`)
        }
      }

      let execution = kernel.requestExecute({ code: commands.join("\n") })
      api.log(`Installing requirements for kernel ${kernel.id}: ${JSON.stringify(commands)}`)
      execution.onIOPub = msg => {
        if(msg.msg_type == 'stream'){
          if(msg.content.name == 'stdout'){
            let data = msg.content.text
            data = util.fixOverwrittenChars(data);
            // escape ANSI & HTML specials in plaintext:
            data = util.fixConsole(data);
            data = util.autoLinkUrls(data);
            api.showStatus(data)
            console.log(data)
          }
        }
      }
      execution.done.then(resolve).catch(reject)
    })

  }

  async killKernel(kernel) {
    if(kernel.close) kernel.close();
    return kernel.shutdown()
  }
}

const jserver = new JupyterServer()

let stop_upload_signal = false;
function uploadFile(content_manager, file, path, display, progressbar){
  
  return new Promise((resolve, reject)=>{
    var filename = file.name
     // change buttons, add a progress bar
    display("Uploading " + filename + '...');
    var parse_large_file = function (f) {
        // codes inspired by https://stackoverflow.com/a/28318964
        // 8MB chunk size chosen to match chunk sizes used by benchmark reference (AWS S3)
        var chunk_size = 1024 * 1024 * 8;
        var offset = 0;
        var chunk = 0;
        var chunk_reader = null;

        var large_reader_onload = function (event) {
            if (stop_upload_signal === true) {
                return;
            }
            if (event.target.error == null) {
                offset += chunk_size;
                if (offset >= f.size) {
                    chunk = -1;
                } else {
                    chunk += 1;
                }
                // callback for handling reading: reader_onload in add_upload_button
                upload_file(event.target.result, chunk);  // Do the upload
            } else {
                console.log("Read error: " + event.target.error);
            }
        };
        var on_error = function (event) {
            display("Failed to read file '" + file.name + "'");
            reject("Failed to read file '" + file.name + "'");
        };

        chunk_reader = function (_offset, _f) {
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
        var  Uint8ToString = function(u8a){
            var CHUNK_SZ = 0x8000;
            var c = [];
            for (var i=0; i < u8a.length; i+=CHUNK_SZ) {
              c.push(String.fromCharCode.apply(null, u8a.subarray(i, i+CHUNK_SZ)));
            }
            return c.join("");
        };

        // These codes to upload file in original class
        var upload_file = function(filedata, chunk) {
            if (filedata instanceof ArrayBuffer) {
                // base64-encode binary file data
                var buf = new Uint8Array(filedata);
                filedata = btoa(Uint8ToString(buf));
                format = 'base64';
            }
            var model = { name: filename, path: path };

            // var name_and_ext = utils.splitext(filename);
            // var file_ext = name_and_ext[1];
            var content_type;
            // Treat everything as generic file
            model.type = 'file';
            model.format = format;
            content_type = 'application/octet-stream';

            model.chunk = chunk;
            model.content = filedata;

            var on_success = function () {
                if (offset < f.size) {
                    // of to the next chunk
                    chunk_reader(offset, f);
                    // change progress bar and progress button
                    var progress = offset / f.size * 100;
                    progress = progress > 100 ? 100 : progress;
                    display(`Uploading ${file.name } (${progress.toFixed(1)}%)...`)
                    progressbar(progress)
                } else {
                    display('Upload finished.')
                    resolve()
                }
            };

            content_manager.save(path, model).then(on_success, on_error);
        };

        // now let's start the read with the first block
        chunk_reader(offset, f);
    };

    parse_large_file(file);

  })
}

async function pingServer(url){
  const response = await fetch(url)
  return response.status === 200
}


async function setup() {
  await api.register({
    type: 'engine-factory',
    name: 'MyBinder-Engine',
    addEngine: addMyBinderEngine,
    removeEngine: removeEngine
  })

  await api.register({
    type: 'engine-factory',
    name: 'Jupyter-Engine',
    addEngine: addJupyterEngine,
    removeEngine: removeEngine
  })

  // create the binder plugin for the first time
  const temp = await api.getConfig('engines')
  if(!temp){
    createNewEngine({
      name: 'MyBinder Engine',
      url: DEFAULT_BASE_URL,
      spec: DEFAULT_SPEC,
      connected: true
    })
  }

  let saved_engines = await save_engine_config()
  for(let url in saved_engines){
    const config = saved_engines[url]
    createNewEngine(config)
  }
  api.log('initialized')
}

async function addJupyterEngine(){
  
  // Connect to the notebook webserver.
const description=`#### Jupyter Engine <sup>alpha</sup>
 
  This allows ImJoy run Python plugin via a [Jupyter](https://jupyter.org/) server. The easiest way to run Jupyter notebook is by using [Anaconda](https://docs.anaconda.com/anaconda/) or [Miniconda](https://docs.conda.io/en/latest/miniconda.html).  
  1. Install Jupyter server with command <code>pip install -U imjoy</code>
  2. Start a Jupyter server from your terminal (or Anaconda Prompt) with the command: <br><code>imjoy --jupyter</code>
  3. Copy and paste the provided URL in "Jupyter Notebook URL" below. **⚠️Important**: the URL needs to contain the connection token, e.g.: http://localhost:8888/?token=caac2d7f2e8e0...ad871fe
  4. Click "CONNECT TO JUPYTER"

**Note**: Due to security reasons, ImJoy cannot connect to remote notebook server served without <code>https</code>, for Chrome/Firefox, the only exception is the URL for localhost (127.0.0.1 or localhost, Safari can only be used with https URL).
`
    const dialog = await api.showDialog(
      {
        type: 'imjoy/schema-io',
        name: 'Connect to a Jupyter Engine',
        data: {
          id: 0,
          type: 'form',
          schema: {
            "fields": [
              {
                "type": "input",
                "inputType": "text",
                "label": "Engine Name",
                "model": "name",
              },
              {
                "type": "input",
                "inputType": "text",
                "label": "Jupyter Notebook URL",
                "hint": "A Jupyter notebook server url with token, e.g.: http://localhost:8888/?token=caac2d7f2e8e0...ad871fe",
                "model": "nbUrl",
              }
            ]
          },
          data: {nbUrl: '', name: 'Jupyter Notebook'},
          options: {
              validateAfterLoad: true,
              validateAfterChanged: true
          },
          description: description,
          buttons: [{label: 'Connect to Jupyter', event_id: 'add', class: 'md-primary md-raised'}]
        }
    })
    dialog.on('add', async (config)=>{
      dialog.close()
      config.url = config.nbUrl.split('?')[0]
      config.connected = true
      createNewEngine(config)
    })
}


async function addMyBinderEngine(){
  
  // Connect to the notebook webserver.
const description=`### MyBinder Engine <sup>alpha</sup>
  You can run Python plugin in ImJoy via free Jupyter servers provided by [MyBinder.org](https://mybinder.org). 
  This engine runs remotely, so no local installation or setup is required. 
  However, the provided computation power is limited (e.g. only 1GB memory and no GPU support).

  To add a new MyBinder Engine, you can keep the default settings below and click "START ANOTHER BINDER ENGINE".
  To reduce the startup time, you can specify plugin specific <code>Specification</code> repository on Github according to [here](https://mybinder.readthedocs.io/en/latest/config_files.html#config-files). 

⚠️Note 1: This feature is still in development, and new features such as file uploading and terminal will be supported soon.
⚠️Note 2: You should **never** process sensitive data with MyBinder Engine ([more information](https://mybinder.readthedocs.io/en/latest/faq.html#how-secure-is-mybinder-org)).
`
    const dialog = await api.showDialog(
      {
        type: 'imjoy/schema-io',
        name: 'Start Another MyBinder Engine',
        data: {
          id: 0,
          type: 'form',
          schema: {
            "fields": [
              {
                "type": "input",
                "inputType": "text",
                "label": "Engine Name",
                "model": "name",
              },
              {
                "type": "input",
                "inputType": "text",
                "label": "Specification",
                "hint": "A github repo with configuration files, format: GITHUB_USER/GITHUB_REPO/BRANCH",
                "model": "spec",
              },
              {
                "type": "input",
                "inputType": "text",
                "label": "Binder URL",
                "model": "url",
              }
            ]
          },
          data: {
            name: 'New Binder Engine',
            url: DEFAULT_BASE_URL,
            spec: DEFAULT_SPEC
          },
          options: {
              validateAfterLoad: true,
              validateAfterChanged: true
          },
          description: description,
          buttons: [{label: 'Start another Binder Engine', event_id: 'add', class: 'md-primary md-raised'}]
        }
    })
    dialog.on('add', async (config)=>{
      dialog.close()
      config.connected = true
      createNewEngine(config)
    })
}

function randId() {
  return Math.random()
    .toString(36)
    .substr(2, 10);
}

class JupyterConnection {
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
  async init(){
    try{
      const comm = await this.prepare_kernel(this.kernel, this.id)
      console.log('kernel prepared...')
      this.initializing = false;
      this._disconnected = false;
      await this.setup_comm(comm)
    }
    catch(e){
      this._disconnected = true;
      console.error("failed to initialize plugin on the plugin engine", e);
      this._failHandler("failed to initialize plugin on the plugin engine");
      throw "failed to initialize plugin on the plugin engine";
    }
  }

  setup_comm(comm){
    return new Promise((resolve, reject)=>{
        this._initHandler = resolve
        this.comm = comm;
        comm.onMsg = msg => {
            var data = msg.content.data
            const buffer_paths = data.__buffer_paths__ || [];
            delete data.__buffer_paths__;  
            util.put_buffers(data, buffer_paths,  msg.buffers || []);
            if (["initialized",
                "importSuccess",
                "importFailure",
                "executeSuccess",
                "executeFailure"
                ].includes(data.type)) {
                this.handle_data_message(data)
            } else {
                this.handle_data_message({ type: 'message', data: data })
            }
        }

        comm.onClose = msg => {
          console.log('comm closed, reconnecting', id, msg);
          this.reconnect()
          reject('Comm is closed');
        };
    })
  }

  handle_data_message(data){
    if (data.type == "initialized") {
      this.supportBinaryBuffers = data.supportBinaryBuffers
      this.dedicatedThread = data.dedicatedThread;
      this._initHandler();
    } 
    else if (data.type == "logging") {
      this._loggingHandler(data.details);
    } else if (data.type == "disconnected") {
      this._disconnectHandler(data.details);
    }
    else{
        switch (data.type) {
        case "message":
          data = data.data
          // console.log('message_from_plugin_'+this.secret, data)
          if (data.type == "logging") {
            this._loggingHandler(data.details);
          } else if (data.type == "disconnected") {
            this._disconnectHandler(data.details);
          } else {
              console.log('handling message: ', data)
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

  execute_code(kernel, code){
    return new Promise((resolve, reject) => {
        const execution = kernel.requestExecute({ code: code })
        console.log(kernel, execution)
        execution.onIOPub = msg => {
          if(msg.msg_type == 'stream'){
            if(msg.content.name == 'stdout'){
              api.showStatus(msg.content.text)
            }
          }
        }
        execution.done.then((reply)=>{
          if(reply.content.status !== 'ok'){
            let error_msg = ''
            for(let data of reply.content.traceback){
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
      try{
        console.log('installing imjoy...')
        api.showStatus('Setting up ImJoy worker...')
        await this.execute_code(kernel, '!python -m pip install -U imjoy')
        const client_id = plugin_id;
        console.log('starting jupyter client ...', client_id)
        await this.execute_code(kernel, `from imjoy.workers.jupyter_client import JupyterClient;JupyterClient.recover_client("${client_id}")` )
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
      }
      catch(e){
        console.error('Failed to prepare kernel: ', e)
        reject(e)
      }
    });
  }

  reconnect() {
    return new Promise(async (resolve, reject) => {
      console.log('reconnecting kernel...', this.kernel)
      try{
        const kernelModel = await Kernel.findById(this.kernel.id, this.kernel.serverSettings)
        const kernel = await Kernel.connectTo(kernelModel, this.kernel.serverSettings)
        await kernel.ready
        this.kernel = kernel
        console.log('kernel reconnected')
        this.prepare_kernel(kernel, this.id).then((comm)=>{
          console.log('comm reconnected', kernel, comm)
          // this.setup_comm(comm)
          resolve(comm)
        })
      }
      catch(e){
        reject(e)
      }
      
    })
  }

  send(data) {
    if (this.kernel.status !== 'dead' && this.comm && !this.comm.isDisposed) {
      //console.log('message to plugin', this.secret,  data)
      if(this.supportBinaryBuffers){
        const split = util.remove_buffers(data);
        split.state.__buffer_paths__ = split.buffer_paths
        this.comm.send({
          type: "message",
          data: split.state
        }, {}, {}, split.buffers);
      }
      else{
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
      this.send({ type: "execute", code: code });
    });
  }

  disconnect() {
    if (!this._disconnected) {
      this._disconnected = true;
    }
    if(this._disconnectHandler) this._disconnectHandler();

    if(this.kernel) {
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

const registered_engines = {}

async function createNewEngine(engine_config){
  const engine_kernels = {}
  let _connected = false;
  let initial_connection = engine_config.connected;
  await api.register({
    type: 'engine',
    pluginType: 'native-python',
    factory: 'Jupyter-Engine',
    icon: '🚀',
    name: engine_config.name,
    url: engine_config.url,
    config: engine_config,
    async connect(){
      // do not connect for the first time if the engine was disconnected
      if(!initial_connection){
        initial_connection = true
        return false
      }
       if(engine_config.nbUrl){
        const serverUrl =  engine_config.nbUrl.split('?')[0] 
        
        try{
          api.showMessage('Connecting to server ' + serverUrl + '...')
          await jserver.startServer(engine_config)
          api.showMessage('🎉Connected to server ' + serverUrl + '.')
        }
        catch(e){
          if(e.toString().includes('403 Forbidden')){
            console.error(e)
            api.showMessage('Failed to connect to server ' +serverUrl+ ', maybe the token is wrong?')
          }
          else{
            console.error(e)
            api.showMessage('Failed to connect to server ' + serverUrl + '.')
          } 
          throw e
        }
      }
      else{
        try{
          api.showMessage('Connecting to MyBinder...')
          await pingServer(engine_config.url)
          api.showMessage('🎉Connected to MyBinder.')
        }
        catch(e){
          console.error(e)
          api.showMessage('Failed to start server on MyBinder.org')
          throw e
        }
      }
      _connected = true;
      engine_config.connected = true
      await save_engine_config(engine_config)
      return true
    },
    async disconnect(){
      if(registered_engines[engine_config.name]){
        for(let kernel of Object.values(registered_engines[engine_config.name].kernels)){
          try{
            // TODO: handle allow-detach flag
            jserver.killKernel(kernel)
          }
          catch(e){
            console.error(e)
          }
        }
        registered_engines[engine_config.name].kernels = []
      }
      
      _connected = false;
      engine_config.connected = false
      await save_engine_config(engine_config)
    },
    listPlugins: ()=>{
    },
    getPlugin: ()=>{
    },
    startPlugin: (config, imjoy_interface, engine_utils)=>{
      return new Promise(async (resolve, reject) => {
        if(!_connected){
          reject('Engine is disconnected.')
          return
        }
        try{
          let serverSettings, kernelSpecName=null, skipRequirements=false;
          if(engine_config.nbUrl){
            serverSettings = await jserver.startServer(engine_config)
          }
          else {
            if(!jserver.binder_confirmation_shown){
              const ret = await api.confirm({title: "📌Notice: About to run plugin on mybinder.org", content: `You are going to run <code>${config.name}</code> on a public cloud server provided by <a href="https://mybinder.org" target="_blank">MyBinder.org</a>, please be aware of the following: <br><br> 1. This feature is currently in development, more improvements will come soon; <br> 2. The computational resources provided by MyBinder.org are limited (e.g. 1GB memory, no GPU support); <br>3. Please do not use it to process sensitive data. <br><br> For more stable use, please setup your own <a href="https://jupyter.org/" target="_blank">Jupyter notebook</a>. <br> <br> If you encountered any issue, please report it on the <a href="https://github.com/oeway/ImJoy/issues" target="_blank">ImJoy repo</a>. <br><br> Do you want to continue?`, confirm_text: 'Yes'})
              if(!ret){
                reject("User canceled plugin execution.")
                return
              }
              jserver.binder_confirmation_shown = true
            }
            
            if(imjoy_interface.TAG && imjoy_interface.TAG.includes('GPU')){
              const ret = await api.confirm({title: "📌Running plugin that requires GPU?", content: `It seems you are trying to run a plugin with GPU tag, however, please notice that the server on MyBinder.org does NOT support GPU. <br><br> Do you want to continue?`, confirm_text: 'Yes'})
              if(!ret){
                reject("User canceled plugin execution.")
                return
              }
            }
            let binderSpec = DEFAULT_SPEC;
            if(Array.isArray(config.env)){
              for(let e of config.env){
                if(e.type === 'binder' && e.spec){
                  binderSpec = e.spec
                  kernelSpecName = e.kernel
                  skipRequirements = e.skip_requirements
                }
              }
            }
            console.log('Starting server with binder spec', binderSpec)
            engine_config.spec = binderSpec;
            serverSettings = await jserver.startServer(engine_config);
          }

          const kernel = await jserver.startKernel(config.name, serverSettings, kernelSpecName)

          api.showMessage('🎉 Jupyter Kernel started (' + serverSettings.baseUrl + ')')
          if(skipRequirements){
            console.log('skipping requirements according to binder spec')
          }
          else {
            await jserver.installRequirements(kernel, config.requirements, true);
          }
          kernel.pluginId = config.id;
          kernel.pluginName = config.name;
          engine_kernels[kernel.id] = kernel
          kernel.onClose(()=>{
            engine_utils.terminatePlugin()
          })
          // const kernel = await jserver.getOrStartKernel(config.name, serverSettings, config.requirements);
          // kernel.statusChanged.connect(status => {
          //   console.log('kernel status changed', kernel._id, status);
          // });
          console.log('Kernel started:', kernel._id, config.name, kernel)        
          const connection = new JupyterConnection(config.id, 'native-python', config, kernel);
          await connection.init()
          const site = new JailedSite(connection, "__plugin__", "javascript");
          site.onInterfaceSetAsRemote(async ()=>{
            api.showStatus('Executing plugin script for ' + config.name + '...')
            for (let i = 0; i < config.scripts.length; i++) {
              await connection.execute({
                type: "script",
                content: config.scripts[i].content,
                lang: config.scripts[i].attrs.lang,
                attrs: config.scripts[i].attrs,
                src: config.scripts[i].attrs.src,
              });
            }
            site.onRemoteUpdate(() => {
              const remote_api = site.getRemote();
              remote_api.ENGINE_URL = kernel.serverSettings.baseUrl;
              remote_api.FILE_MANAGER_URL = kernel.serverSettings.baseUrl;
              console.log(`plugin ${config.name} (id=${config.id}) initialized.`, remote_api)
              api.showStatus(`🎉Plugin "${config.name}" is ready.`)
              resolve(remote_api)
            });
            site.requestRemote();
          });
          site.onDisconnect((details) => {
            console.log('disconnected.', details)
            connection.disconnect()
            engine_utils.terminatePlugin()
            reject('disconnected')
          })
          site.onRemoteReady(()=>{
            engine_utils.setPluginStatus({running: false});
          })
          site.onRemoteBusy(()=>{
            engine_utils.setPluginStatus({running: true});
          })
          imjoy_interface.ENGINE_URL = kernel.serverSettings.baseUrl;
          imjoy_interface.FILE_MANAGER_URL = kernel.serverSettings.baseUrl;
          site.setInterface(imjoy_interface);
  
        }
        catch(e){
          console.error(e)
          api.showMessage('Failed to start plugin ' + config.name + ', ' + e.toString())
          reject(e)
        }
      });
    },
    getEngineConfig() {
      return {}
    },
    async getEngineStatus() {
      const kernels_info = []
      // for(let k in jserver._kernels){
      //   const kernel = jserver._kernels[k]
      //   kernels_info.push({name: kernel.pluginName || kernel.name, pid: kernel.id})
      // }
      for(let k in jserver.cached_servers){
        const {url, token} = jserver.cached_servers[k]
        // Connect to the notebook webserver.
        const serverSettings = ServerConnection.makeSettings({
          baseUrl: url,
          wsUrl: baseToWsUrl(url),
          token: token,
        })
        try{
          const kernels = await Kernel.listRunning(serverSettings)
           for(let kernel of kernels){
             if(engine_kernels[kernel.id])
              kernels_info.push({name: engine_kernels[kernel.id].pluginName, pid: kernel.id,  baseUrl: url, wsUrl: baseToWsUrl(url), token: token})
           }
        }
        catch(e){
          console.error('removing dead server:', e)
        }
      }
      return {plugin_processes: kernels_info}
      // return engine.updateEngineStatus()
    },
    killPlugin(config){
      console.log('killing plugin', config, jserver._kernels)
      for(let k in jserver._kernels){
        const kernel = jserver._kernels[k]
        if(kernel.pluginId === config.id){
          try{
            jserver.killKernel(kernel)
          }
          catch(e){
            console.error(e)
          }
          
        }
      }
    },
    async killPluginProcess(p) {
      // kernel.close()
      try{
        if(jserver._kernels[p.pid]){
          await jserver.killKernel(jserver._kernels[p.pid])
        }
        else{
          const serverSettings = ServerConnection.makeSettings(p)
          const kernelModel = await Kernel.findById(p.pid, serverSettings)
          const kernel = await Kernel.connectTo(kernelModel, serverSettings)
          await kernel.shutdown()
        }
      }
      catch(e){
          console.error(e)
      }
      finally{
        delete jserver._kernels[p.pid]
      }
      // return engine.killPluginProcess(p)
    },
    heartbeat(){
      return _connected;
    },
    async startTerminal(){
      if(Object.keys(jserver.cached_servers).length <=0){
        api.alert('No jupyter engine is currently running.')
        return
      }
      // data-base-url="/user/oeway-imjoy-binder-image-8o8ztfkj/" data-ws-url="" data-ws-path="terminals/websocket/1"
      // ws_url = ws_url + base_url + ws_path;

      const buttons = []
      let i = 0
      for(let k in jserver.cached_servers){
        const {url, token} = jserver.cached_servers[k]
        // Connect to the notebook webserver.
        const serverSettings = ServerConnection.makeSettings({
          baseUrl: url,
          wsUrl: baseToWsUrl(url),
          token: token,
        })
        const ws_url = serverSettings.wsUrl + 'terminals/websocket/1'  //'wss://hub-binder.mybinder.ovh/user/oeway-imjoy-binder-image-8o8ztfkj/terminals/websocket/1'
        let name = new URL(url);
        name = name.pathname === '/' ? name.hostname: name.pathname ;
        buttons.push({
          label: name,
          event_id: k,
          ws_url: ws_url
        })
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
      
      const make_terminal = (ws_url) => {
      
        if(terminal_started){
          api.alert('Please open another terminal window if you want to switch server.')
          return
        }
       // clear the buttons;
       terminal_window.emit('show_buttons', [])
       terminal_started = true;
       var ws = new WebSocket(ws_url);
       // Terminal.applyAddon(fit);
       // var term = new Terminal();
       ws.onopen = async (event) => {
        
          terminal_window.emit('write', "Connected to terminal\r\n")
          const write = (data)=>{
            terminal_window.emit('write', data)
          }
          const disconnect = (data)=>{
            terminal_window.emit('write', "\r\nDisconnected!\r\n")
          }

          terminal_window.on('fit', (config)=>{
            // send the terminal size to the server.
            ws.send(JSON.stringify(["set_size", config["rows"], config["cols"],
                                        window.innerHeight, window.innerWidth]));
          
          })
          terminal_window.on('key', (key)=>{
            ws.send(JSON.stringify(['stdin', key]));
          });
          
          terminal_window.on("paste", data => {
            ws.send(JSON.stringify(['stdin', data]));
          })
        
          ws.onmessage = function(event) {
              var json_msg = JSON.parse(event.data);
              switch(json_msg[0]) {
                  case "stdout":
                      write(json_msg[1]);
                      break;
                  case "disconnect":
                      write("\r\n\r\n[CLOSED]\r\n");
                      break;
              }
          };
        };
      }
      if(buttons.length == 1){
        make_terminal(buttons[0].ws_url)
      }
      else{
        terminal_window.on('button_clicked', (event)=>{make_terminal(event.ws_url)})
      }
    },
    about(){
      api.alert('An ImJoy Engine for Jupyter Servers.')
      console.log(jserver)
    }
  })

  registered_engines[engine_config.name] = {kernels: engine_kernels, disconnect: ()=>{ 
    for(let kernel of Object.values(registered_engines[engine_config.name].kernels)){
        try{
          jserver.killKernel(kernel)
        }
        catch(e){
          console.error(e)
        }
      }
      _connected = false;
  }}
  
}

async function removeEngine(engine_config){
  if(await api.confirm(`Do you really want to remove the engine ${engine_config.name}?`)){
    if(registered_engines[engine_config.name]) {
      registered_engines[engine_config.name].disconnect()
    }
    let saved_engines = await save_engine_config()
    delete saved_engines[engine_config.url]
    await api.setConfig('engines', JSON.stringify(saved_engines))
    return true
  }

}

api.export({'setup': setup});
