const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Add Buffer to global scope
global.Buffer = global.Buffer || require('buffer').Buffer;

// Configure polyfills for crypto libraries
config.resolver.extraNodeModules = {
  crypto: require.resolve('crypto-browserify'),
  stream: require.resolve('web-streams-polyfill'),
  buffer: require.resolve('buffer'),
};

module.exports = config;
