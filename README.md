# `JupyterServices` for ImJoy

This package contains the Javascript API for [`JupyterServices`](https://github.com/imjoy-team/JupyterServices) used by the Jupyter Engine plugin in ImJoy.

## Basic Usage

```javascript
var jserver = new JupyterServices.JupyterServer({
    spec: 'oeway/imjoy-binder-image/master',
    baseUrl: 'https://mybinder.org',
    provider: 'gh',
})
jserver.startServer()
```

## Development for ImJoy

* run `npm install`
* run `npm run serve` and you will get a development server on `http://127.0.0.1:9090`
* now go to `https://imjoy.io` and install the Jupyter Engine Manager plugin via `http://127.0.0.1:9090/Jupyter-Engine-Manager.imjoy.html` ("+Plugins > Install from URL").
* If you modify any thing, the code will be deployed automatically, however, in ImJoy you need to reload the `Jupyter-Engine-Manager` plugin manually by selecting `Reload` in the plugin menu.
