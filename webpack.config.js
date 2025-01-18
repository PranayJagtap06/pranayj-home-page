const path = require('path');
const webpack = require('webpack');
// const Dotenv = require('dotenv-webpack');
const dotenv = require('dotenv');
const CopyPlugin = require('copy-webpack-plugin');

// Manually load dotenv
const env = dotenv.config().parsed || {};

console.log('Loaded Environment Variables:', env);

module.exports = {
  mode: 'development',
  entry: './index.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.js',
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        use: 'babel-loader',
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: ['.js'],
    fallback: {
      "path": require.resolve("path-browserify"),
      "crypto": require.resolve("crypto-browserify"),
      "os": require.resolve("os-browserify/browser"),
      "stream": require.resolve("stream-browserify"),
      "vm": require.resolve("vm-browserify"),
      "util": require.resolve("util/"),
      "dropbox": require.resolve("dropbox"),
      "buffer": require.resolve('buffer/'),
      // "http": require.resolve('stream-http'),
      "url": require.resolve('url/'),
      "process": require.resolve('process/browser'),
    },
    alias: {
      'dropbox': path.resolve(__dirname, 'node_modules/dropbox/dist/Dropbox-sdk.min.js'),
    }
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        // { from: 'public', to: '' },
        { from: 'index.html', to: '' },
        {from: 'styles.css', to: ''},
        {from: 'pranay_sq.jpg', to: ''},
        {from: 'favicon.ico', to: ''},
        {from: 'config.js', to: ''},
        {from: 'debug-env.js', to: ''},
        {from: 'bwsrsync.js', to: ''},
        {from: 'index.js', to: ''},
        { from: 'auth-callback.html', to: '' },
        {from: './functions/suggestions.js', to: './functions/'},
      ],
    }),
    // Manual environment variable injection
    new webpack.DefinePlugin({
      'process.env': JSON.stringify({
        ...process.env,
        // ...env,
        DROPBOX_CLIENT_ID: process.env.DROPBOX_CLIENT_ID,
        DROPBOX_CLIENT_SECRET: process.env.DROPBOX_CLIENT_SECRET,
        'import.meta.env.VITE_DROPBOX_CLIENT_ID': JSON.stringify(process.env.DROPBOX_CLIENT_ID),
        'import.meta.env.VITE_DROPBOX_CLIENT_SECRET': JSON.stringify(process.env.DROPBOX_CLIENT_SECRET),
      })
    }),
    new webpack.ProvidePlugin({
      process: 'process/browser',
      Buffer: ['buffer', 'Buffer']
    })
  ],
};