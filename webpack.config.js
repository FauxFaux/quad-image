const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyPlugin = require('copy-webpack-plugin');
const { readFileSync } = require('fs');

const bs = './node_modules/bootstrap/dist/css/bootstrap.min.css';
const bsHash = require('crypto')
  .createHash('sha512-224')
  .update(readFileSync(bs, 'utf8'))
  .digest('hex')
  .substring(0, 8);
const bsName = `static/bootstrap.${bsHash}.css`;

module.exports = {
  entry: './web/index.tsx',
  output: {
    path: path.resolve(__dirname, './dist'),
    filename: 'static/bundle.[contenthash].js',
    library: 'app',
  },

  plugins: [
    new HtmlWebpackPlugin({
      template: './web/index.ejs',
      templateParameters: {
        mode: 'home',
        bsName,
      },
    }),
    new HtmlWebpackPlugin({
      template: './web/index.ejs',
      filename: 'gallery/index.html',
      templateParameters: {
        mode: 'gallery',
        bsName,
      },
    }),
    new CopyPlugin({
      patterns: [
        { from: 'web/plain/dumb', to: 'dumb' },
        { from: 'web/plain/terms', to: 'terms' },
        { from: bs, to: bsName },
        { from: `${bs}.map`, to: `static/bootstrap.min.css.map` },
      ],
    }),
  ],

  // Enable sourcemaps for debugging webpack's output.
  devtool: 'source-map',

  resolve: {
    // Add '.ts' and '.tsx' as resolvable extensions.
    extensions: ['.ts', '.tsx', '.js', '.json'],
  },

  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: [{ loader: 'babel-loader' }],
        exclude: /node_modules/,
      },
      {
        test: /\.css$/i,
        use: ['style-loader', 'css-loader'],
      },
    ],
  },
};
