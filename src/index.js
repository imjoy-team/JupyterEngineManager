import '@babel/polyfill'

import JupyterServer from './JupyterServer'
import ContentsManager from './JupyterContents'
import debounce from 'lodash.debounce'

import * as services from '@jupyterlab/services'

import * as util from './util.js'
import BinderHub from './BinderHub'

// Kernel, ServerConnection etc. are wrapped in services
// Define globally for use in browser.
if (typeof window !== 'undefined') {
  window.JupyterEngineManager = {services, BinderHub, JupyterServer, util, debounce, ContentsManager}
}

export default {services, BinderHub, JupyterServer, util, debounce}
