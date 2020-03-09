/**
 BSD 3-Clause License

Copyright (c) 2017, Sam Lau
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

* Neither the name of the copyright holder nor the names of its
  contributors may be used to endorse or promote products derived from
  this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * This code has been modified by the imjoy-team authors 2019.
 */

/**
 * Methods for starting kernels using BinderHub.
 */

// States that you can register callbacks on
// Keep in sync with https://github.com/jupyterhub/binderhub/blob/master/doc/api.rst#events
const VALID_STATES = new Set([
  '*',
  'failed',
  'built',
  'waiting',
  'building',
  'fetching',
  'pushing',
  'launching',
  'ready',
])

/**
 * Implements the Binder API to start kernels.
 */
export default class BinderHub {
  /**
   *
   * @param {Object} [config] - Config for BinderHub
   *
   * @param {String} [config.spec] - BinderHub spec for Jupyter image. Must be
   *     in the format: `${username}/${repo}/${branch}`.
   *
   * @param {String} [config.baseUrl] - Binder URL to start server.
   *
   * @param {String} [config.provider] - BinderHub provider (e.g. 'gh' for
   * Github)
   *
   * @param {Object} [config.callbacks] - Mapping from state to callback fired
   *     when BinderHub transitions to that state.
   *
   * @param {String} [config.nbUrl] - Full URL of a running notebook server.
   *     If set, BinderHub connection ignores all Binder config and will directly request
   *     Python kernels from the notebook server.
   *
   *     Defaults to `false`; by default we use Binder to start a notebook
   *     server.
   */
  constructor({
    spec,
    baseUrl,
    provider,
    callbacks = {},
    nbUrl = false,
  } = {}) {
    this.baseUrl = baseUrl
    this.provider = provider
    this.spec = spec
    this.nbUrl = nbUrl

    this.callbacks = callbacks
    this.state = null

    // Logs all messages sent by Binder
    this.registerCallback('*', (oldState, newState, data) => {
      if (data.message !== undefined) {
        console.log(data.message)
      } else {
        console.log(data)
      }
    })
  }

  apiUrl() {
    return `${this.baseUrl}/build/${this.provider}/${this.spec}`
  }

  startServer() {
    if (this.nbUrl) {
      const url = new URL(this.nbUrl);
      const token = url.searchParams.get("token");
      return Promise.resolve({
        url: url.protocol+'//'+url.host+url.pathname,
        token: token
      })
    }

    return new Promise((resolve, reject) => {
      const eventSource = new EventSource(this.apiUrl())

      eventSource.onerror = err => {
        console.error(
          'Failed to connect to Binder. Stopping BinderHub connection...',
          err,
        )
        eventSource.close()
        reject(new Error(err))
      }

      eventSource.onmessage = event => {
        const data = JSON.parse(event.data)

        if (data.phase) {
          this.changeState(data.phase.toLowerCase(), data)
        }
      }

      this.registerCallback('failed', (oldState, newState, data) => {
        console.error(
          'Failed to build Binder image. Stopping BinderHub connection...',
          data,
        )
        eventSource.close()
        reject(new Error(data))
      })

      // When the Binder server is ready, `data` contains the information
      // needed to connect.
      this.registerCallback('ready', (oldState, newState, data) => {
        eventSource.close()
        resolve(data)
      })
    })
  }

  registerCallback(state, cb) {
    if (!VALID_STATES.has(state)) {
      console.error(`Tried to register callback on invalid state: ${state}`)
      return
    }

    if (this.callbacks[state] === undefined) {
      this.callbacks[state] = [cb]
    } else {
      this.callbacks[state].push(cb)
    }
  }

  changeState(newState, data) {
    ;[newState, '*'].map(key => {
      const callbacks = this.callbacks[key]
      if (callbacks) {
        callbacks.forEach(callback => callback(this.state, newState, data))
      }
    })

    if (newState) {
      this.state = newState
    }
  }
}
