# JupyterEngineManager for ImJoy

This package contains the Javascript API for [`JupyterEngineManager`](https://github.com/imjoy-team/jupyter-engine-manager) used by the Jupyter Engine plugin in ImJoy.

Click [here](https://imjoy.io/#/app?plugin=https://imjoy-team.github.io/jupyter-engine-manager/jupyter-engine-manager.imjoy.html) to run Jupyter Engine Manager in ImJoy.

## Basic Usage

```javascript
var jserver = new JupyterEngineManager.JupyterServer({
    spec: 'oeway/imjoy-binder-image/master',
    baseUrl: 'https://mybinder.org',
    provider: 'gh',
})
jserver.startServer()
```

## Development for ImJoy

* Run `npm install`
* Run `npm run serve` and you will get a development server on `http://127.0.0.1:9090`
* Now go to `https://imjoy.io` and install the Jupyter Engine Manager plugin via `http://127.0.0.1:9090/Jupyter-Engine-Manager.imjoy.html` ("+Plugins > Install from URL").
* If you modify any thing, the code will be deployed automatically, however, in ImJoy you need to reload the `Jupyter-Engine-Manager` plugin manually by selecting `Reload` in the plugin menu.

* Run `npm run build` and you will get the files inside the `docs` folder.
