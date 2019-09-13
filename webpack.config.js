var path = require('path');
var webpack = require('webpack');

module.exports = {
  entry: './web/index.tsx',
  output: {
    path: path.join(process.cwd(), 'web'),
    filename: 'bundle.js',
    library: 'quadImage',
  },

  // Enable sourcemaps for debugging webpack's output.
  devtool: 'source-map',

  resolve: {
    // Add '.ts' and '.tsx' as resolvable extensions.
    extensions: ['.ts', '.tsx', '.js', '.json'],
  },

  module: {
    rules: [
      { test: /\.tsx?$/, loader: 'awesome-typescript-loader' },

      // Pack SVGs into base64 urls
      { test: /\.svg$/, loader: 'url-loader?mimetype=image/svg+xml&name=[name].[ext]' },

      // All output '.js' files will have any sourcemaps re-processed by 'source-map-loader'.
      { enforce: 'pre', test: /\.js$/, loader: 'source-map-loader' },
    ],
  },
};

new webpack.DefinePlugin({
  'process.env': {
    NODE_ENV: JSON.stringify('development'),
  },
});
