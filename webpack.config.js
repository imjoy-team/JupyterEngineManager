const webpack = require('webpack')
const path = require('path')
const CleanWebpackPlugin = require('clean-webpack-plugin')
const CopyPlugin = require('copy-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin')
const HtmlReplaceWebpackPlugin = require('html-replace-webpack-plugin')
// const WriteFilePlugin = require('write-file-webpack-plugin');
const BundleAnalyzerPlugin = require('webpack-bundle-analyzer')
  .BundleAnalyzerPlugin

const config =  (env, argv) => ({
  mode: 'development',
  entry: {
    index: './src/index.js',
  },
  output: {
    filename: 'index.bundle.js',
    path: path.resolve(__dirname, 'dist'),
    library: 'JupyterEngineManager',
    libraryTarget: 'umd',
    umdNamedDefine: true
  },
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
    // new CleanWebpackPlugin(['dist']),
    new CopyPlugin([
      { from: path.resolve(__dirname, 'src', 'Jupyter-Engine-Manager.script.js'), to: path.resolve(__dirname, 'dist')}
    ]),
    new HtmlWebpackPlugin(
      {
        filename: 'Jupyter-Engine-Manager.imjoy.html',
        template: path.resolve(__dirname, 'src', 'Jupyter-Engine-Manager.imjoy.html'),
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
                  corejs: '3.0.0',
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
