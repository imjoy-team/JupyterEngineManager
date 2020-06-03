import JupyterServer from "./JupyterServer";
import ContentsManager from "./JupyterContents";
import debounce from "lodash.debounce";

import * as services from "@jupyterlab/services";

import * as util from "./util.js";
import BinderHub from "./BinderHub";
import JupyterConnection from "./JupyterConnection";
import { setupPlugin } from "./Plugin";

const DEFAULT_BASE_URL = "https://mybinder.org";
const DEFAULT_PROVIDER = "gh";
const DEFAULT_SPEC = "oeway/imjoy-binder-image/master";

export {
  services,
  BinderHub,
  JupyterServer,
  util,
  debounce,
  ContentsManager,
  JupyterConnection,
  setupPlugin,
  DEFAULT_SPEC,
  DEFAULT_PROVIDER,
  DEFAULT_BASE_URL
};
