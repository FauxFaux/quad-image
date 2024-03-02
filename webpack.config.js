import path from 'node:path';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import CopyPlugin from 'copy-webpack-plugin';

const __dirname = import.meta.dirname;
if (!__dirname) {
  throw new Error('requires node >20.11 for no particular reason');
}

export default {
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
      },
    }),
    new HtmlWebpackPlugin({
      template: './web/index.ejs',
      filename: 'gallery/index.html',
      templateParameters: {
        mode: 'gallery',
      },
    }),
    new CopyPlugin({
      patterns: [{ from: 'web/plain/dumb', to: 'dumb' }, { from: 'web/plain/terms', to: 'terms' }],
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
