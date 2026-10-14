// Expo's defaults, plus what the web build needs: wasm assets (expo-sqlite, Skia's CanvasKit)
// and cross-origin isolation in the dev server, which SharedArrayBuffer (SQLite on web,
// multi-threaded ONNX Runtime) requires. Production hosting sends the same headers
// (see app.json and INSTALL.md).
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('wasm');
config.server.enhanceMiddleware = (middleware) => (req, res, next) => {
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  return middleware(req, res, next);
};

module.exports = config;
