import { ServerConnection } from '@jupyterlab/services'

const SERVICE_DRIVE_URL = 'api/contents';
/**
 * The url for the file access.
 */
const FILES_URL = 'files';

export default class ContentsManager {
  /**
   * Construct a new contents manager object.
   *
   * @param options - The options used to initialize the object.
   */
  constructor(options = {}) {
      this._isDisposed = false;
      this._additionalDrives = new Map();
      // this._fileChanged = new signaling_1.Signal(this);
      let serverSettings = (this.serverSettings =
          options.serverSettings || ServerConnection.makeSettings());
      this._defaultDrive = options.defaultDrive || new Drive({ serverSettings });
      // this._defaultDrive.fileChanged.connect(this._onFileChanged, this);
  }
  /**
   * A signal emitted when a file operation takes place.
   */
  // get fileChanged() {
  //     return this._fileChanged;
  // }
  /**
   * Test whether the manager has been disposed.
   */
  get isDisposed() {
      return this._isDisposed;
  }
  /**
   * Dispose of the resources held by the manager.
   */
  dispose() {
      if (this.isDisposed) {
          return;
      }
      this._isDisposed = true;
      // signaling_1.Signal.clearData(this);
  }
  /**
   * Add an `IDrive` to the manager.
   */
  addDrive(drive) {
      this._additionalDrives.set(drive.name, drive);
      // drive.fileChanged.connect(this._onFileChanged, this);
  }
  /**
   * Given a path, get a ModelDB.IFactory from the
   * relevant backend. Returns `null` if the backend
   * does not provide one.
   */
  getModelDBFactory(path) {
      let [drive] = this._driveForPath(path);
      return (drive && drive.modelDBFactory) || null;
  }
  /**
   * Given a path of the form `drive:local/portion/of/it.txt`
   * get the local part of it.
   *
   * @param path: the path.
   *
   * @returns The local part of the path.
   */
  localPath(path) {
      const parts = path.split('/');
      const firstParts = parts[0].split(':');
      if (firstParts.length === 1 || !this._additionalDrives.has(firstParts[0])) {
          return this._removeSlash(path);
      }
      return this._path_join(firstParts.slice(1).join(':'), ...parts.slice(1));
  }
  /**
   * Normalize a global path. Reduces '..' and '.' parts, and removes
   * leading slashes from the local part of the path, while retaining
   * the drive name if it exists.
   *
   * @param path: the path.
   *
   * @returns The normalized path.
   */
  // normalize(path) {
  //     const parts = path.split(':');
  //     if (parts.length === 1) {
  //         return coreutils_1.PathExt.normalize(path);
  //     }
  //     return `${parts[0]}:${coreutils_1.PathExt.normalize(parts.slice(1).join(':'))}`;
  // }
  normalize(path){
    path = Array.prototype.join.apply(arguments,['/'])
    var sPath;
    while (sPath!==path) {
        sPath = n(path);
        path = n(sPath);
    }
    function n(s){return s.replace(/\/+/g,'/').replace(/\w+\/+\.\./g,'')}
    return path.replace(/^\//,'').replace(/\/$/,'');
  }
  /**
   * Given a path of the form `drive:local/portion/of/it.txt`
   * get the name of the drive. If the path is missing
   * a drive portion, returns an empty string.
   *
   * @param path: the path.
   *
   * @returns The drive name for the path, or the empty string.
   */
  driveName(path) {
      const parts = path.split('/');
      const firstParts = parts[0].split(':');
      if (firstParts.length === 1) {
          return '';
      }
      if (this._additionalDrives.has(firstParts[0])) {
          return firstParts[0];
      }
      return '';
  }
  /**
   * Get a file or directory.
   *
   * @param path: The path to the file.
   *
   * @param options: The options used to fetch the file.
   *
   * @returns A promise which resolves with the file content.
   */
  get(path, options) {
      let [drive, localPath] = this._driveForPath(path);
      return drive.get(localPath, options).then(contentsModel => {
          let listing = [];
          if (contentsModel.type === 'directory' && contentsModel.content) {
              contentsModel.content.forEach((item) => {
                  listing.push(Object.assign({}, item, { path: this._toGlobalPath(drive, item.path) }));
              });
              return Object.assign({}, contentsModel, { path: this._toGlobalPath(drive, localPath), content: listing });
          }
          else {
              return Object.assign({}, contentsModel, { path: this._toGlobalPath(drive, localPath) });
          }
      });
  }
  /**
   * Get an encoded download url given a file path.
   *
   * @param path - An absolute POSIX file path on the server.
   *
   * #### Notes
   * It is expected that the path contains no relative paths.
   *
   * The returned URL may include a query parameter.
   */
  getDownloadUrl(path) {
      let [drive, localPath] = this._driveForPath(path);
      return drive.getDownloadUrl(localPath);
  }
  /**
   * Create a new untitled file or directory in the specified directory path.
   *
   * @param options: The options used to create the file.
   *
   * @returns A promise which resolves with the created file content when the
   *    file is created.
   */

  _path_join(...paths) {
      var separator = '/';
      var replace   = new RegExp(separator+'{1,}', 'g');
      const path = paths.join(separator).replace(replace, separator);
      return path === '.' ? '' : this._removeSlash(path);
  }

  newUntitled(options = {}) {
      if (options.path) {
          let globalPath = this.normalize(options.path);
          let [drive, localPath] = this._driveForPath(globalPath);
          return drive
              .newUntitled(Object.assign({}, options, { path: localPath }))
              .then(contentsModel => {
              return Object.assign({}, contentsModel, { path: this._path_join(globalPath, contentsModel.name) });
          });
      }
      else {
          return this._defaultDrive.newUntitled(options);
      }
  }
  /**
   * Delete a file.
   *
   * @param path - The path to the file.
   *
   * @returns A promise which resolves when the file is deleted.
   */
  delete(path) {
      let [drive, localPath] = this._driveForPath(path);
      return drive.delete(localPath);
  }
  /**
   * Rename a file or directory.
   *
   * @param path - The original file path.
   *
   * @param newPath - The new file path.
   *
   * @returns A promise which resolves with the new file contents model when
   *   the file is renamed.
   */
  rename(path, newPath) {
      let [drive1, path1] = this._driveForPath(path);
      let [drive2, path2] = this._driveForPath(newPath);
      if (drive1 !== drive2) {
          throw Error('ContentsManager: renaming files must occur within a Drive');
      }
      return drive1.rename(path1, path2).then(contentsModel => {
          return Object.assign({}, contentsModel, { path: this._toGlobalPath(drive1, path2) });
      });
  }
  /**
   * Save a file.
   *
   * @param path - The desired file path.
   *
   * @param options - Optional overrides to the model.
   *
   * @returns A promise which resolves with the file content model when the
   *   file is saved.
   *
   * #### Notes
   * Ensure that `model.content` is populated for the file.
   */
  save(path, options = {}) {
      const globalPath = this.normalize(path);
      const [drive, localPath] = this._driveForPath(path);
      return drive
          .save(localPath, Object.assign({}, options, { path: localPath }))
          .then(contentsModel => {
          return Object.assign({}, contentsModel, { path: globalPath });
      });
  }
  /**
   * Copy a file into a given directory.
   *
   * @param path - The original file path.
   *
   * @param toDir - The destination directory path.
   *
   * @returns A promise which resolves with the new contents model when the
   *  file is copied.
   *
   * #### Notes
   * The server will select the name of the copied file.
   */
  copy(fromFile, toDir) {
      let [drive1, path1] = this._driveForPath(fromFile);
      let [drive2, path2] = this._driveForPath(toDir);
      if (drive1 === drive2) {
          return drive1.copy(path1, path2).then(contentsModel => {
              return Object.assign({}, contentsModel, { path: this._toGlobalPath(drive1, contentsModel.path) });
          });
      }
      else {
          throw Error('Copying files between drives is not currently implemented');
      }
  }
  /**
   * Create a checkpoint for a file.
   *
   * @param path - The path of the file.
   *
   * @returns A promise which resolves with the new checkpoint model when the
   *   checkpoint is created.
   */
  createCheckpoint(path) {
      let [drive, localPath] = this._driveForPath(path);
      return drive.createCheckpoint(localPath);
  }
  /**
   * List available checkpoints for a file.
   *
   * @param path - The path of the file.
   *
   * @returns A promise which resolves with a list of checkpoint models for
   *    the file.
   */
  listCheckpoints(path) {
      let [drive, localPath] = this._driveForPath(path);
      return drive.listCheckpoints(localPath);
  }
  /**
   * Restore a file to a known checkpoint state.
   *
   * @param path - The path of the file.
   *
   * @param checkpointID - The id of the checkpoint to restore.
   *
   * @returns A promise which resolves when the checkpoint is restored.
   */
  restoreCheckpoint(path, checkpointID) {
      let [drive, localPath] = this._driveForPath(path);
      return drive.restoreCheckpoint(localPath, checkpointID);
  }
  /**
   * Delete a checkpoint for a file.
   *
   * @param path - The path of the file.
   *
   * @param checkpointID - The id of the checkpoint to delete.
   *
   * @returns A promise which resolves when the checkpoint is deleted.
   */
  deleteCheckpoint(path, checkpointID) {
      let [drive, localPath] = this._driveForPath(path);
      return drive.deleteCheckpoint(localPath, checkpointID);
  }
  /**
   * Given a drive and a local path, construct a fully qualified
   * path. The inverse of `_driveForPath`.
   *
   * @param drive: an `IDrive`.
   *
   * @param localPath: the local path on the drive.
   *
   * @returns the fully qualified path.
   */
  _removeSlash(path) {
      if (path.indexOf('/') === 0) {
          path = path.slice(1);
      }
      return path;
  }

  _toGlobalPath(drive, localPath) {
      if (drive === this._defaultDrive) {
          return this._removeSlash(localPath); //coreutils_1.PathExt.removeSlash
      }
      else {
          return `${drive.name}:${this._removeSlash(localPath)}`; //coreutils_1.PathExt.removeSlash
      }
  }
  /**
   * Given a path, get the `IDrive to which it refers,
   * where the path satisfies the pattern
   * `'driveName:path/to/file'`. If there is no `driveName`
   * prepended to the path, it returns the default drive.
   *
   * @param path: a path to a file.
   *
   * @returns A tuple containing an `IDrive` object for the path,
   * and a local path for that drive.
   */
  _driveForPath(path) {
      const driveName = this.driveName(path);
      const localPath = this.localPath(path);
      if (driveName) {
          return [this._additionalDrives.get(driveName), localPath];
      }
      else {
          return [this._defaultDrive, localPath];
      }
  }
  /**
   * Respond to fileChanged signals from the drives attached to
   * the manager. This prepends the drive name to the path if necessary,
   * and then forwards the signal.
   */
//   _onFileChanged(sender, args) {
//       if (sender === this._defaultDrive) {
//            this._fileChanged.emit(args);
//       }
//       else {
//           let newValue = null;
//           let oldValue = null;
//           if (args.newValue && args.newValue.path) {
//               newValue = Object.assign({}, args.newValue, { path: this._toGlobalPath(sender, args.newValue.path) });
//           }
//           if (args.oldValue && args.oldValue.path) {
//               oldValue = Object.assign({}, args.oldValue, { path: this._toGlobalPath(sender, args.oldValue.path) });
//           }
//           this._fileChanged.emit({
//               type: args.type,
//               newValue,
//               oldValue
//           });
//       }
//   }
}

class Drive {
  /**
   * Construct a new contents manager object.
   *
   * @param options - The options used to initialize the object.
   */
  constructor(options = {}) {
      this._isDisposed = false;
      // this._fileChanged = new signaling_1.Signal(this);
      this.name = options.name || 'Default';
      this._apiEndpoint = options.apiEndpoint || SERVICE_DRIVE_URL;
      this.serverSettings =
          options.serverSettings || ServerConnection.makeSettings();
  }
  /**
   * A signal emitted when a file operation takes place.
   */
  get fileChanged() {
      return false;//this._fileChanged;
  }
  /**
   * Test whether the manager has been disposed.
   */
  get isDisposed() {
      return this._isDisposed;
  }
  /**
   * Dispose of the resources held by the manager.
   */
  dispose() {
      if (this.isDisposed) {
          return;
      }
      this._isDisposed = true;
      // signaling_1.Signal.clearData(this);
  }
  /**
   * Get a file or directory.
   *
   * @param localPath: The path to the file.
   *
   * @param options: The options used to fetch the file.
   *
   * @returns A promise which resolves with the file content.
   *
   * Uses the [Jupyter Notebook API](http://petstore.swagger.io/?url=https://raw.githubusercontent.com/jupyter/notebook/master/notebook/services/api/api.yaml#!/contents) and validates the response model.
   */
  objectToQuerystring (obj) {
    return Object.keys.reduce(function (str, key, i) {
      var delimiter, val;
      delimiter = (i === 0) ? '?' : '&';
      key = encodeURIComponent(key);
      val = encodeURIComponent(obj[key]);
      return [str, delimiter, key, '=', val].join('');
    }, '');
  }

  get(localPath, options) {
      let url = this._getUrl(localPath);
      if (options) {
          // The notebook type cannot take an format option.
          if (options.type === 'notebook') {
              delete options['format'];
          }
          let content = options.content ? '1' : '0';
          let params = Object.assign({}, options, { content });
          url += objectToQueryString(params);
      }
      let settings = this.serverSettings;
      return ServerConnection.makeRequest(url, {}, settings)
          .then(response => {
          if (response.status !== 200) {
              throw new ServerConnection.ResponseError(response);
          }
          return response.json();
      })
          .then(data => {
          validate.validateContentsModel(data);
          return data;
      });
  }
  /**
   * Get an encoded download url given a file path.
   *
   * @param localPath - An absolute POSIX file path on the server.
   *
   * #### Notes
   * It is expected that the path contains no relative paths.
   *
   * The returned URL may include a query parameter.
   */
  encodeParts(url) {
      return this.url_join(...url.split('/').map(encodeURIComponent));
  }

  url_join(...parts) {
    parts = parts || [];
    // Isolate the top element.
    const top = parts[0] || '';
    // Check whether protocol shorthand is being used.
    const shorthand = top.indexOf('//') === 0;
    // Parse the top element into a header collection.
    const header = top.match(/(\w+)(:)(\/\/)?/);
    const protocol = header && header[1];
    const colon = protocol && header[2];
    const slashes = colon && header[3];
    // Construct the URL prefix.
    const prefix = shorthand
        ? '//'
        : [protocol, colon, slashes].filter(str => str).join('');
    // Construct the URL body omitting the prefix of the top value.
    const body = [top.indexOf(prefix) === 0 ? top.replace(prefix, '') : top]
        // Filter out top value if empty.
        .filter(str => str)
        // Remove leading slashes in all subsequent URL body elements.
        .concat(parts.slice(1).map(str => str.replace(/^\//, '')))
        .join('/')
        // Replace multiple slashes with one.
        .replace(/\/+/g, '/');
    return prefix + body;
  }

  getDownloadUrl(localPath) {
      let baseUrl = this.serverSettings.baseUrl;
      let url = this.url_join(baseUrl, FILES_URL, this.encodeParts(localPath));
      const xsrfTokenMatch = document.cookie.match('\\b_xsrf=([^;]*)\\b');
      if (xsrfTokenMatch) {
          const fullurl = new URL(url);
          fullurl.searchParams.append('_xsrf', xsrfTokenMatch[1]);
          url = fullurl.toString();
      }
      return Promise.resolve(url);
  }
  /**
   * Create a new untitled file or directory in the specified directory path.
   *
   * @param options: The options used to create the file.
   *
   * @returns A promise which resolves with the created file content when the
   *    file is created.
   *
   * #### Notes
   * Uses the [Jupyter Notebook API](http://petstore.swagger.io/?url=https://raw.githubusercontent.com/jupyter/notebook/master/notebook/services/api/api.yaml#!/contents) and validates the response model.
   */
  newUntitled(options = {}) {
      let body = '{}';
      if (options) {
          if (options.ext) {
              options.ext = Private.normalizeExtension(options.ext);
          }
          body = JSON.stringify(options);
      }
      let settings = this.serverSettings;
      let url = this._getUrl(options.path || '');
      let init = {
          method: 'POST',
          body
      };
      return ServerConnection.makeRequest(url, init, settings)
          .then(response => {
          if (response.status !== 201) {
              throw new ServerConnection.ResponseError(response);
          }
          return response.json();
      })
          .then(data => {
          // validate.validateContentsModel(data);
          // this._fileChanged.emit({
          //     type: 'new',
          //     oldValue: null,
          //     newValue: data
          // });
          return data;
      });
  }
  /**
   * Delete a file.
   *
   * @param localPath - The path to the file.
   *
   * @returns A promise which resolves when the file is deleted.
   *
   * #### Notes
   * Uses the [Jupyter Notebook API](http://petstore.swagger.io/?url=https://raw.githubusercontent.com/jupyter/notebook/master/notebook/services/api/api.yaml#!/contents).
   */
  delete(localPath) {
      let url = this._getUrl(localPath);
      let settings = this.serverSettings;
      let init = { method: 'DELETE' };
      return ServerConnection.makeRequest(url, init, settings).then(response => {
          // Translate certain errors to more specific ones.
          // TODO: update IPEP27 to specify errors more precisely, so
          // that error types can be detected here with certainty.
          if (response.status === 400) {
              return response.json().then(data => {
                  throw new ServerConnection.ResponseError(response, data['message']);
              });
          }
          if (response.status !== 204) {
              throw new ServerConnection.ResponseError(response);
          }
          // this._fileChanged.emit({
          //     type: 'delete',
          //     oldValue: { path: localPath },
          //     newValue: null
          // });
      });
  }
  /**
   * Rename a file or directory.
   *
   * @param oldLocalPath - The original file path.
   *
   * @param newLocalPath - The new file path.
   *
   * @returns A promise which resolves with the new file contents model when
   *   the file is renamed.
   *
   * #### Notes
   * Uses the [Jupyter Notebook API](http://petstore.swagger.io/?url=https://raw.githubusercontent.com/jupyter/notebook/master/notebook/services/api/api.yaml#!/contents) and validates the response model.
   */
  rename(oldLocalPath, newLocalPath) {
      let settings = this.serverSettings;
      let url = this._getUrl(oldLocalPath);
      let init = {
          method: 'PATCH',
          body: JSON.stringify({ path: newLocalPath })
      };
      return ServerConnection.makeRequest(url, init, settings)
          .then(response => {
          if (response.status !== 200) {
              throw new ServerConnection.ResponseError(response);
          }
          return response.json();
      })
          .then(data => {
          // validate.validateContentsModel(data);
          // this._fileChanged.emit({
          //     type: 'rename',
          //     oldValue: { path: oldLocalPath },
          //     newValue: data
          // });
          return data;
      });
  }
  /**
   * Save a file.
   *
   * @param localPath - The desired file path.
   *
   * @param options - Optional overrides to the model.
   *
   * @returns A promise which resolves with the file content model when the
   *   file is saved.
   *
   * #### Notes
   * Ensure that `model.content` is populated for the file.
   *
   * Uses the [Jupyter Notebook API](http://petstore.swagger.io/?url=https://raw.githubusercontent.com/jupyter/notebook/master/notebook/services/api/api.yaml#!/contents) and validates the response model.
   */
  save(localPath, options = {}) {
      let settings = this.serverSettings;
      let url = this._getUrl(localPath);
      let init = {
          method: 'PUT',
          body: JSON.stringify(options)
      };
      return ServerConnection.makeRequest(url, init, settings)
          .then(response => {
          // will return 200 for an existing file and 201 for a new file
          if (response.status !== 200 && response.status !== 201) {
              throw new ServerConnection.ResponseError(response);
          }
          return response.json();
      })
          .then(data => {
          // validate.validateContentsModel(data);
          // this._fileChanged.emit({
          //     type: 'save',
          //     oldValue: null,
          //     newValue: data
          // });
          return data;
      });
  }
  /**
   * Copy a file into a given directory.
   *
   * @param localPath - The original file path.
   *
   * @param toDir - The destination directory path.
   *
   * @returns A promise which resolves with the new contents model when the
   *  file is copied.
   *
   * #### Notes
   * The server will select the name of the copied file.
   *
   * Uses the [Jupyter Notebook API](http://petstore.swagger.io/?url=https://raw.githubusercontent.com/jupyter/notebook/master/notebook/services/api/api.yaml#!/contents) and validates the response model.
   */
  copy(fromFile, toDir) {
      let settings = this.serverSettings;
      let url = this._getUrl(toDir);
      let init = {
          method: 'POST',
          body: JSON.stringify({ copy_from: fromFile })
      };
      return ServerConnection.makeRequest(url, init, settings)
          .then(response => {
          if (response.status !== 201) {
              throw new ServerConnection.ResponseError(response);
          }
          return response.json();
      })
          .then(data => {
          // validate.validateContentsModel(data);
          // this._fileChanged.emit({
          //     type: 'new',
          //     oldValue: null,
          //     newValue: data
          // });
          return data;
      });
  }
  /**
   * Create a checkpoint for a file.
   *
   * @param localPath - The path of the file.
   *
   * @returns A promise which resolves with the new checkpoint model when the
   *   checkpoint is created.
   *
   * #### Notes
   * Uses the [Jupyter Notebook API](http://petstore.swagger.io/?url=https://raw.githubusercontent.com/jupyter/notebook/master/notebook/services/api/api.yaml#!/contents) and validates the response model.
   */
  createCheckpoint(localPath) {
      let url = this._getUrl(localPath, 'checkpoints');
      let init = { method: 'POST' };
      return ServerConnection.makeRequest(url, init, this.serverSettings)
          .then(response => {
          if (response.status !== 201) {
              throw new ServerConnection.ResponseError(response);
          }
          return response.json();
      })
          .then(data => {
          validate.validateCheckpointModel(data);
          return data;
      });
  }
  /**
   * List available checkpoints for a file.
   *
   * @param localPath - The path of the file.
   *
   * @returns A promise which resolves with a list of checkpoint models for
   *    the file.
   *
   * #### Notes
   * Uses the [Jupyter Notebook API](http://petstore.swagger.io/?url=https://raw.githubusercontent.com/jupyter/notebook/master/notebook/services/api/api.yaml#!/contents) and validates the response model.
   */
  listCheckpoints(localPath) {
      let url = this._getUrl(localPath, 'checkpoints');
      return ServerConnection.makeRequest(url, {}, this.serverSettings)
          .then(response => {
          if (response.status !== 200) {
              throw new ServerConnection.ResponseError(response);
          }
          return response.json();
      })
          .then(data => {
          if (!Array.isArray(data)) {
              throw new Error('Invalid Checkpoint list');
          }
          for (let i = 0; i < data.length; i++) {
              validate.validateCheckpointModel(data[i]);
          }
          return data;
      });
  }
  /**
   * Restore a file to a known checkpoint state.
   *
   * @param localPath - The path of the file.
   *
   * @param checkpointID - The id of the checkpoint to restore.
   *
   * @returns A promise which resolves when the checkpoint is restored.
   *
   * #### Notes
   * Uses the [Jupyter Notebook API](http://petstore.swagger.io/?url=https://raw.githubusercontent.com/jupyter/notebook/master/notebook/services/api/api.yaml#!/contents).
   */
  restoreCheckpoint(localPath, checkpointID) {
      let url = this._getUrl(localPath, 'checkpoints', checkpointID);
      let init = { method: 'POST' };
      return ServerConnection.makeRequest(url, init, this.serverSettings).then(response => {
          if (response.status !== 204) {
              throw new ServerConnection.ResponseError(response);
          }
      });
  }
  /**
   * Delete a checkpoint for a file.
   *
   * @param localPath - The path of the file.
   *
   * @param checkpointID - The id of the checkpoint to delete.
   *
   * @returns A promise which resolves when the checkpoint is deleted.
   *
   * #### Notes
   * Uses the [Jupyter Notebook API](http://petstore.swagger.io/?url=https://raw.githubusercontent.com/jupyter/notebook/master/notebook/services/api/api.yaml#!/contents).
   */
  deleteCheckpoint(localPath, checkpointID) {
      let url = this._getUrl(localPath, 'checkpoints', checkpointID);
      let init = { method: 'DELETE' };
      return ServerConnection.makeRequest(url, init, this.serverSettings).then(response => {
          if (response.status !== 204) {
              throw new ServerConnection.ResponseError(response);
          }
      });
  }
  /**
   * Get a REST url for a file given a path.
   */
  _getUrl(...args) {
      let parts = args.map(path => this.encodeParts(path));
      let baseUrl = this.serverSettings.baseUrl;
      return this.url_join(baseUrl, this._apiEndpoint, ...parts);
  }
}
