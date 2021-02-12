var path = require('path');

module.exports = {
  entry: "./web/index.tsx",
  output: {
    path: path.join(process.cwd(), 'web'),
    filename: "bundle.js",
    library: "quadImage",
  },

  // Enable sourcemaps for debugging webpack's output.
  devtool: "source-map",

  resolve: {
    // Add '.ts' and '.tsx' as resolvable extensions.
    extensions: [".ts", ".tsx", ".js", ".json"]
  },

  module: {
    rules: [
      // All files with a '.ts' or '.tsx' extension will be handled by 'awesome-typescript-loader'.
      { test: /\.tsx?$/, use: [ { loader: "awesome-typescript-loader" } ] },

      // Pack SVGs into base64 urls
      { test: /\.svg$/, use: [ { loader: 'url-loader?mimetype=image/svg+xml&name=[name].[ext]' } ] },

      // All output '.js' files will have any sourcemaps re-processed by 'source-map-loader'.
      { enforce: "pre", test: /\.js$/, use: [ { loader: "source-map-loader" } ] }
    ]
  },

  externals: {
    jquery: 'jQuery',
  },
};
