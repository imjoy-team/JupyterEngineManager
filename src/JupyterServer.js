import debounce from 'lodash.debounce'

import { Kernel, ServerConnection } from '@jupyterlab/services'

import * as util from './util.js'
import BinderHub from './BinderHub'

const DEFAULT_BASE_URL = 'https://mybinder.org'
const DEFAULT_PROVIDER = 'gh'
const DEFAULT_SPEC = 'oeway/imjoy-binder-image/master'

/**
 * Main entry point for JupyterServer.
 *
 * Class that runs notebook code and creates widgets.
 */
export default class JupyterServer {
  /**
   * Initialize JupyterServer. Does not start kernel until run() is called.
   *
   * @param {Object} [config] - Configuration for JupyterServer
   *
   * @param {String} [config.spec] - BinderHub spec for Jupyter image. Must be
   *     in the format: `${username}/${repo}/${branch}`. Defaults to
   *     'oeway/imjoy-binder-image/master'.
   *
   * @param {String} [config.baseUrl] - Binder URL to start server. Defaults to
   *     https://mybinder.org.
   *
   * @param {String} [config.provider] - BinderHub provider. Defaults to 'gh'
   *     for GitHub.
   *
   * @param {String} [config.nbUrl] - Full URL of a running notebook server.
   *     If set, JupyterServer ignores all Binder config and will directly request
   *     Python kernels from the notebook server.
   *
   *     Defaults to `false`; by default we use Binder to start a notebook
   *     server.
   */
  constructor({
    spec = DEFAULT_SPEC,
    baseUrl = DEFAULT_BASE_URL,
    provider = DEFAULT_PROVIDER,
    nbUrl = false,
  } = {}) {
    this.run = debounce(this.run, 500, {
      leading: true,
      trailing: false,
    })
    this._kernelHeartbeat = this._kernelHeartbeat.bind(this)

    this.binder = new BinderHub({ spec, baseUrl, provider, nbUrl })

    // Keep track of properties for debugging
    this.kernel = null
  }

  /**
   * Starts kernel if needed, runs code on page, and initializes widgets.
   */
  async run() {
    throw "This version of JupyterServer has been modified."
  }

  /**
   * Same as run(), but only runs code if kernel is already started.
   */
  async runIfKernelExists() {
    try {
      await this.getKernelModel()
    } catch (err) {
      console.log(
        'No kernel, stopping the runIfKernelExists() call. Use the',
        'run() method to automatically start a kernel if needed.',
      )
      return
    }

    this.run()
  }

  /**********************************************************************
   * Private methods
   **********************************************************************/

  /**
   * Checks kernel connection every seconds_between_check seconds. If the
   * kernel is dead, starts a new kernel and re-creates widgets.
   */
  async _kernelHeartbeat(seconds_between_check = 5) {
    try {
      await this.getKernelModel()
    } catch (err) {
      console.log('Looks like the kernel died:', err.toString())
      console.log('Starting a new kernel...')
      const kernel = await this.startKernel()
      this.kernel = kernel
    } finally {
      setTimeout(this._kernelHeartbeat, seconds_between_check * 1000)
    }
  }

  /**
   * Private method that starts a Binder server, then starts a kernel and
   * returns the kernel information.
   *
   * Once initialized, this function caches the server and kernel info in
   * localStorage. Future calls will attempt to use the cached info, falling
   * back to starting a new server and kernel.
   */
  async getOrStartKernel() {
    if (this.kernel) {
      return this.kernel
    }

    try {
      const kernel = await this.getKernel()
      console.log('Connected to cached kernel.')
      return kernel
    } catch (err) {
      console.log(
        'No cached kernel, starting kernel on BinderHub:',
        err.toString(),
      )
      const kernel = await this.startKernel()
      return kernel
    }
  }

  /**
   * Connects to kernel using cached info from localStorage. Throws exception
   * if kernel connection fails for any reason.
   */
  async getKernel() {
    const { serverSettings, kernelModel } = await this.getKernelModel()
    return await Kernel.connectTo(kernelModel, serverSettings)
  }

  /**
   * Retrieves kernel model using cached info from localStorage. Throws
   * exception if kernel doesn't exist.
   */
  async getKernelModel() {
    const { serverParams, kernelId } = localStorage
    const { url, token } = JSON.parse(serverParams)

    const serverSettings = ServerConnection.makeSettings({
      baseUrl: url,
      wsUrl: util.baseToWsUrl(url),
      token: token,
    })

    const kernelModel = await Kernel.findById(kernelId, serverSettings)
    return { serverSettings, kernelModel }
  }

  async startServer(){
    const { url, token } = await this.binder.startServer()
    // Connect to the notebook webserver.
    const serverSettings = ServerConnection.makeSettings({
      baseUrl: url,
      wsUrl: util.baseToWsUrl(url),
      token: token,
    })
    localStorage.serverParams = JSON.stringify({ url, token })
    return serverSettings
  }

  /**
   * Starts a new kernel using Binder and returns the connected kernel. Stores
   * localStorage.serverParams and localStorage.kernelId .
   */
  async startKernel(serverSettings) {
    try {
  
      if(!serverSettings){
        serverSettings = this.startServer()
      }

      // Start a kernel
      const kernelSpecs = await Kernel.getSpecs(serverSettings)
      const kernel = await Kernel.startNew({
        name: kernelSpecs.default,
        serverSettings,
      })

      // Store the params in localStorage for later use
      localStorage.kernelId = kernel.id

      console.log('Started kernel:', kernel.id)
      return kernel
    } catch (err) {
      debugger
      console.error('Error in kernel initialization :(')
      throw err
    }
  }

  async killKernel() {
    const kernel = await this.getKernel()
    return kernel.shutdown()
  }

}
