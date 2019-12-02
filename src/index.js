import '@babel/polyfill'

import JupyterServer from './JupyterServer'

import debounce from 'lodash.debounce'

import * as services from '@jupyterlab/services'

import * as util from './util.js'
import BinderHub from './BinderHub'

// Kernel, ServerConnection etc. are wrapped in services
// Define globally for use in browser.
if (typeof window !== 'undefined') {
  window.JupyterServices = {services, BinderHub, JupyterServer, util, debounce}
}

export default {services, BinderHub, JupyterServer, util, debounce}
