const webpack = require('webpack')
const path = require('path')
const CleanWebpackPlugin = require('clean-webpack-plugin')
const CopyPlugin = require('copy-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin')
const HtmlReplaceWebpackPlugin = require('html-replace-webpack-plugin')
// const WriteFilePlugin = require('write-file-webpack-plugin');
const BundleAnalyzerPlugin = require('webpack-bundle-analyzer')
  .BundleAnalyzerPlugin

// Use the shim() function to stub out unneeded modules. Used to cut down
// bundle size since tree-shaking doesn't work with Typescript modules.
const shimJS = path.resolve(__dirname, 'src', 'emptyshim.js')
function shim(regExp) {
  return new webpack.NormalModuleReplacementPlugin(regExp, shimJS)
}

const config =  (env, argv) => ({
  mode: 'development',
  entry: {
    index: './src/index.js',
  },
  output: {
    filename: 'index.bundle.js',
    path: path.resolve(__dirname, 'dist'),
  },
  devtool: 'cheap-module-eval-source-map',
  devServer: {
    contentBase: path.resolve(__dirname, 'dist'),
    publicPath: '/',
    port: 9090,
    hot: true,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
      "Access-Control-Allow-Headers": "X-Requested-With, content-type, Authorization"
    }
  },
  plugins: [
    shim(/moment/),
    shim(/comment-json/),

    shim(/@jupyterlab\/apputils/),
    shim(/@jupyterlab\/codemirror/),
    shim(/codemirror\/keymap\/vim/),
    shim(/codemirror\/addon\/search/),

    shim(/elliptic/),
    shim(/bn\.js/),
    shim(/readable\-stream/),

    // shim out some unused phosphor
    shim(
      /@phosphor\/widgets\/lib\/(commandpalette|box|dock|grid|menu|scroll|split|stacked|tab).*/,
    ),
    shim(/@phosphor\/(dragdrop|commands).*/),

    shim(/@jupyterlab\/codeeditor\/lib\/jsoneditor/),
    shim(/@jupyterlab\/coreutils\/lib\/(time|settingregistry|.*menu.*)/),
    shim(/@jupyterlab\/services\/lib\/(session|contents|terminal)\/.*/),

    // new CleanWebpackPlugin(['dist']),
    new CopyPlugin([
      { from: path.resolve(__dirname, 'src', 'Jupyter-Engine-Manager.script.js'), to: path.resolve(__dirname, 'dist')}
    ]),
    new CopyPlugin([
      { from: path.resolve(__dirname, 'src', 'Jupyter-Notebook.imjoy.html'), to: path.resolve(__dirname, 'dist')}
    ]),
    new HtmlWebpackPlugin(
      {
        filename: 'Jupyter-Engine-Manager.imjoy.html',
        template: path.resolve(__dirname, 'src', 'Jupyter-Engine-Manager.imjoy.html'),
        inject: false
      }
    ),
    new HtmlWebpackPlugin(
      {
        filename: 'ImJoy-elFinder.imjoy.html',
        template: path.resolve(__dirname, 'src', 'ImJoy-elFinder.imjoy.html'),
        inject: false
      }
    ),
    new HtmlReplaceWebpackPlugin([
      {
        pattern: 'STATIC_SERVER_URL',
        replacement: argv.mode === 'production'?'https://imjoy-team.github.io/jupyter-engine-manager':'http://127.0.0.1:9090',
      }]
    ),
    new HtmlReplaceWebpackPlugin([
      {
        pattern: 'PLUGIN_VERSION',
        replacement: require("./package.json").version
      }]
    ),
    new BundleAnalyzerPlugin({
      analyzerMode: 'static',
      openAnalyzer: false,
    }),
    // new WriteFilePlugin(),
  ],
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              [
                '@babel/preset-env',
                {
                  targets: { browsers: ['last 2 Chrome versions'] },
                  useBuiltIns: 'entry',
                  modules: false,
                },
              ],
            ],
            plugins: ['@babel/plugin-syntax-dynamic-import'],
            cacheDirectory: true,
          },
        },
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
    ],
  },
})

module.exports = config
