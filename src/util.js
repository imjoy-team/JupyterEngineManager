/**
 * Private utility functions used primarily by NbInteract.js
 */

import { KernelMessage } from '@jupyterlab/services'

/**
 * Converts a notebook HTTP URL to a WebSocket URL
 */
export const baseToWsUrl = baseUrl =>
  (baseUrl.startsWith('https:') ? 'wss:' : 'ws:') +
  baseUrl
    .split(':')
    .slice(1)
    .join(':')

/**
 * Message type for widgets
 */
export const WIDGET_MSG = 'application/vnd.jupyter.widget-view+json'

/**
 * Functions to work with notebook DOM
 */
export const codeCells = () => document.querySelectorAll('.code_cell')

export const pageHasWidgets = () =>
  document.querySelector('.output_widget_view') !== null

export const cellToCode = cell =>
  cell.querySelector('.input_area').textContent.trim()

export const isWidgetCell = cell =>
  cell.querySelector('.output_widget_view') !== null

export const cellToWidgetOutput = cell =>
  cell.querySelector('.output_widget_view')


/**
 * Functions to work with kernel messages
 */
export const isErrorMsg = msg => msg.msg_type === 'error'
export const msgToModel = async (msg, manager) => {
  if (!KernelMessage.isDisplayDataMsg(msg)) {
    return false
  }

  const widgetData = msg.content.data[WIDGET_MSG]
  if (widgetData === undefined || widgetData.version_major !== 2) {
    return false
  }

  const model = await manager.get_model(widgetData.model_id)
  return model
}



var uuid = function () {
  /**
   * http://www.ietf.org/rfc/rfc4122.txt
   */
  var s = [];
  var hexDigits = "0123456789abcdef";
  for (var i = 0; i < 32; i++) {
      s[i] = hexDigits.substr(Math.floor(Math.random() * 0x10), 1);
  }
  s[12] = "4";  // bits 12-15 of the time_hi_and_version field to 0010
  s[16] = hexDigits.substr((s[16] & 0x3) | 0x8, 1);  // bits 6-7 of the clock_seq_hi_and_reserved to 01

  var uuid = s.join("");
  return uuid;
};

var _ANSI_COLORS = [
  "ansi-black",
  "ansi-red",
  "ansi-green",
  "ansi-yellow",
  "ansi-blue",
  "ansi-magenta",
  "ansi-cyan",
  "ansi-white",
  "ansi-black-intense",
  "ansi-red-intense",
  "ansi-green-intense",
  "ansi-yellow-intense",
  "ansi-blue-intense",
  "ansi-magenta-intense",
  "ansi-cyan-intense",
  "ansi-white-intense",
];

function _pushColoredChunk(chunk, fg, bg, bold, underline, inverse, out) {
  if (chunk) {
      var classes = [];
      var styles = [];

      if (bold && typeof fg === "number" && 0 <= fg && fg < 8) {
          fg += 8;  // Bold text uses "intense" colors
      }
      if (inverse) {
          [fg, bg] = [bg, fg];
      }

      if (typeof fg === "number") {
          classes.push(_ANSI_COLORS[fg] + "-fg");
      } else if (fg.length) {
          styles.push("color: rgb(" + fg + ")");
      } else if (inverse) {
          classes.push("ansi-default-inverse-fg");
      }

      if (typeof bg === "number") {
          classes.push(_ANSI_COLORS[bg] + "-bg");
      } else if (bg.length) {
          styles.push("background-color: rgb(" + bg + ")");
      } else if (inverse) {
          classes.push("ansi-default-inverse-bg");
      }

      if (bold) {
          classes.push("ansi-bold");
      }

      if (underline) {
          classes.push("ansi-underline");
      }

      if (classes.length || styles.length) {
          out.push("<span");
          if (classes.length) {
              out.push(' class="' + classes.join(" ") + '"');
          }
          if (styles.length) {
              out.push(' style="' + styles.join("; ") + '"');
          }
          out.push(">");
          out.push(chunk);
          out.push("</span>");
      } else {
          out.push(chunk);
      }
  }
}

function _getExtendedColors(numbers) {
  var r, g, b;
  var n = numbers.shift();
  if (n === 2 && numbers.length >= 3) {
      // 24-bit RGB
      r = numbers.shift();
      g = numbers.shift();
      b = numbers.shift();
      if ([r, g, b].some(function (c) { return c < 0 || 255 < c; })) {
          throw new RangeError("Invalid range for RGB colors");
      }
  } else if (n === 5 && numbers.length >= 1) {
      // 256 colors
      var idx = numbers.shift();
      if (idx < 0) {
          throw new RangeError("Color index must be >= 0");
      } else if (idx < 16) {
          // 16 default terminal colors
          return idx;
      } else if (idx < 232) {
          // 6x6x6 color cube, see https://stackoverflow.com/a/27165165/500098
          r = Math.floor((idx - 16) / 36);
          r = r > 0 ? 55 + r * 40 : 0;
          g = Math.floor(((idx - 16) % 36) / 6);
          g = g > 0 ? 55 + g * 40 : 0;
          b = (idx - 16) % 6;
          b = b > 0 ? 55 + b * 40 : 0;
      } else if (idx < 256) {
          // grayscale, see https://stackoverflow.com/a/27165165/500098
          r = g = b = (idx - 232) * 10 + 8;
      } else {
          throw new RangeError("Color index must be < 256");
      }
  } else {
      throw new RangeError("Invalid extended color specification");
  }
  return [r, g, b];
}

function _ansispan(str) {
  var ansi_re = /\x1b\[(.*?)([@-~])/g;
  var fg = [];
  var bg = [];
  var bold = false;
  var underline = false;
  var inverse = false;
  var match;
  var out = [];
  var numbers = [];
  var start = 0;

  str += "\x1b[m";  // Ensure markup for trailing text
  while ((match = ansi_re.exec(str))) {
      if (match[2] === "m") {
          var items = match[1].split(";");
          for (var i = 0; i < items.length; i++) {
              var item = items[i];
              if (item === "") {
                  numbers.push(0);
              } else if (item.search(/^\d+$/) !== -1) {
                  numbers.push(parseInt(item));
              } else {
                  // Ignored: Invalid color specification
                  numbers.length = 0;
                  break;
              }
          }
      } else {
          // Ignored: Not a color code
      }
      var chunk = str.substring(start, match.index);
_pushColoredChunk(chunk, fg, bg, bold, underline, inverse, out);
      start = ansi_re.lastIndex;

      while (numbers.length) {
          var n = numbers.shift();
          switch (n) {
              case 0:
                  fg = bg = [];
                  bold = false;
                  underline = false;
                  inverse = false;
                  break;
              case 1:
              case 5:
                  bold = true;
                  break;
              case 4:
                  underline = true;
                  break;
              case 7:
                  inverse = true;
                  break;
              case 21:
              case 22:
                  bold = false;
                  break;
              case 24:
                  underline = false;
                  break;
              case 27:
                  inverse = false;
                  break;
              case 30:
              case 31:
              case 32:
              case 33:
              case 34:
              case 35:
              case 36:
              case 37:
                  fg = n - 30;
                  break;
              case 38:
                  try {
                      fg = _getExtendedColors(numbers);
                  } catch(e) {
                      numbers.length = 0;
                  }
                  break;
              case 39:
                  fg = [];
                  break;
              case 40:
              case 41:
              case 42:
              case 43:
              case 44:
              case 45:
              case 46:
              case 47:
                  bg = n - 40;
                  break;
              case 48:
                  try {
                      bg = _getExtendedColors(numbers);
                  } catch(e) {
                      numbers.length = 0;
                  }
                  break;
              case 49:
                  bg = [];
                  break;
  case 90:
  case 91:
  case 92:
  case 93:
  case 94:
  case 95:
  case 96:
  case 97:
fg = n - 90 + 8;
                  break;
  case 100:
  case 101:
  case 102:
  case 103:
  case 104:
  case 105:
  case 106:
  case 107:
bg = n - 100 + 8;
                  break;
              default:
                  // Unknown codes are ignored
          }
      }
  }
  return out.join("");
}

function _escapeHtml(unsafe) {
  return unsafe
       .replace(/&/g, "&amp;")
       .replace(/</g, "&lt;")
       .replace(/>/g, "&gt;")
       .replace(/"/g, "&quot;")
       .replace(/'/g, "&#039;");
}

// Transform ANSI color escape codes into HTML <span> tags with CSS
// classes such as "ansi-green-intense-fg".
// The actual colors used are set in the CSS file.
// This is supposed to have the same behavior as nbconvert.filters.ansi2html()
export function fixConsole(txt) {
  txt = _escapeHtml(txt);

  // color ansi codes (and remove non-color escape sequences)
  txt = _ansispan(txt);
  return txt;
}

// Remove chunks that should be overridden by the effect of
// carriage return characters
export function fixCarriageReturn(txt) {
  txt = txt.replace(/\r+\n/gm, '\n'); // \r followed by \n --> newline
  while (txt.search(/\r[^$]/g) > -1) {
      var base = txt.match(/^(.*)\r+/m)[1];
      var insert = txt.match(/\r+(.*)$/m)[1];
      insert = insert + base.slice(insert.length, base.length);
      txt = txt.replace(/\r+.*$/m, '\r').replace(/^.*\r/m, insert);
  }
  return txt;
}

// Remove characters that are overridden by backspace characters
export function fixBackspace(txt) {
  var tmp = txt;
  do {
      txt = tmp;
      // Cancel out anything-but-newline followed by backspace
      tmp = txt.replace(/[^\n]\x08/gm, '');
  } while (tmp.length < txt.length);
  return txt;
}

// Remove characters overridden by backspace and carriage return
export function fixOverwrittenChars(txt) {
  return fixCarriageReturn(fixBackspace(txt));
}

// Locate any URLs and convert them to an anchor tag
export function autoLinkUrls(txt) {
  return txt.replace(/(^|\s)(https?|ftp)(:[^'"<>\s]+)/gi,
      "$1<a target=\"_blank\" href=\"$2$3\">$2$3</a>");
}

// pub_buffers and remove_buffers are taken from https://github.com/jupyter-widgets/ipywidgets/blob/master/packages/base/src/utils.ts
// Author: IPython Development Team
// License: BSD
export function put_buffers(
  state,
  buffer_paths,
  buffers
){
  buffers = buffers.map(b => {
    if (b instanceof DataView) {
        return b;
    } else {
        return new DataView(b instanceof ArrayBuffer ? b : b.buffer);
    }
  });
  for (let i = 0; i < buffer_paths.length; i++) {
    const buffer_path = buffer_paths[i];
    // say we want to set state[x][y][z] = buffers[i]
    let obj = state;
    // we first get obj = state[x][y]
    for (let j = 0; j < buffer_path.length - 1; j++) {
      obj = obj[buffer_path[j]];
    }
    // and then set: obj[z] = buffers[i]
    obj[buffer_path[buffer_path.length - 1]] = buffers[i];
  }
}

 //#Source https://bit.ly/2neWfJ2 
 export function urlJoin(...args){
  return args
    .join('/')
    .replace(/[\/]+/g, '/')
    .replace(/^(.+):\//, '$1://')
    .replace(/^file:/, 'file:/')
    .replace(/\/(\?|&|#[^!])/g, '$1')
    .replace(/\?/g, '&')
    .replace('&', '?');
 }

function isSerializable(object){
    return typeof object === 'object' && object && object.toJSON;
}

function isObject (value) {
    return value && typeof value === 'object' && value.constructor === Object;
}

/**
 * The inverse of put_buffers, return an objects with the new state where all buffers(ArrayBuffer)
 * are removed. If a buffer is a member of an object, that object is cloned, and the key removed. If a buffer
 * is an element of an array, that array is cloned, and the element is set to null.
 * See put_buffers for the meaning of buffer_paths
 * Returns an object with the new state (.state) an array with paths to the buffers (.buffer_paths),
 * and the buffers associated to those paths (.buffers).
 */
export function remove_buffers(state){
  const buffers = [];
  const buffer_paths = [];
  // if we need to remove an object from a list, we need to clone that list, otherwise we may modify
  // the internal state of the widget model
  // however, we do not want to clone everything, for performance
  function remove(obj, path) {
    if (isSerializable(obj)) {
      // We need to get the JSON form of the object before recursing.
      // See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify#toJSON()_behavior
      obj = obj.toJSON();
    }
    if (Array.isArray(obj)) {
      let is_cloned = false;
      for (let i = 0; i < obj.length; i++) {
        const value = obj[i];
        if (value) {
          if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
            if (!is_cloned) {
              obj = obj.slice();
              is_cloned = true;
            }
            buffers.push(ArrayBuffer.isView(value) ? value.buffer : value);
            buffer_paths.push(path.concat([i]));
            // easier to just keep the array, but clear the entry, otherwise we have to think
            // about array length, much easier this way
            obj[i] = null;
          } else {
            const new_value = remove(value, path.concat([i]));
            // only assigned when the value changes, we may serialize objects that don't support assignment
            if (new_value !== value) {
              if (!is_cloned) {
                obj = obj.slice();
                is_cloned = true;
              }
              obj[i] = new_value;
            }
          }
        }
      }
    } else if (isObject(obj)) {
      for (const key in obj) {
        let is_cloned = false;
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          const value = obj[key];
          if (value) {
            if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
              if (!is_cloned) {
                obj = { ...obj };
                is_cloned = true;
              }
              buffers.push(ArrayBuffer.isView(value) ? value.buffer : value);
              buffer_paths.push(path.concat([key]));
              delete obj[key]; // for objects/dicts we just delete them
            } else {
              const new_value = remove(value, path.concat([key]));
              // only assigned when the value changes, we may serialize objects that don't support assignment
              if (new_value !== value) {
                if (!is_cloned) {
                  obj = { ...obj };
                  is_cloned = true;
                }
                obj[key] = new_value;
              }
            }
          }
        }
      }
    }
    return obj;
  }
  const new_state = remove(state, []);
  return { state: new_state, buffers: buffers, buffer_paths: buffer_paths };
}
