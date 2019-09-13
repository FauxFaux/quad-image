var path = require('path');

module.exports = {
  entry: './web/index.tsx',
  output: {
    path: path.join(process.cwd(), 'web'),
    filename: 'bundle.js',
    library: 'quadImage',
  },

  // Enable sourcemaps for debugging webpack's output.
  devtool: 'inline-source-map',

  resolve: {
    // Add '.ts' and '.tsx' as resolvable extensions.
    extensions: ['.ts', '.tsx', '.js', '.json'],
  },

  module: {
    rules: [
      // All files with a '.ts' or '.tsx' extension will be handled by 'awesome-typescript-loader'.
      { test: /\.tsx?$/, use: [{ loader: 'ts-loader' }], exclude: /node_modules/ },

      // Pack SVGs into base64 urls
      { test: /\.svg$/, use: [{ loader: 'url-loader?mimetype=image/svg+xml&name=[name].[ext]' }] },
    ],
  },
};
