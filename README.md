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
