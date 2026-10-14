/**
 * Copies the browser runtimes the web build loads at run time into public/, so they are
 * served from the app's own origin at the exact versions in package-lock.json:
 *   public/canvaskit.wasm  (React Native Skia on web)
 *   public/ort/            (ONNX Runtime Web: script + wasm)
 * Runs on postinstall; the copies are git-ignored.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pub = path.join(root, 'public');
const copy = (from, to) => {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
};

try {
  copy(require.resolve('canvaskit-wasm/bin/full/canvaskit.wasm', { paths: [root] }), path.join(pub, 'canvaskit.wasm'));
  // The package's exports map hides package.json, so locate dist/ from the main entry.
  let ortDist = path.dirname(require.resolve('onnxruntime-web', { paths: [root] }));
  while (path.basename(ortDist) !== 'dist' && ortDist !== path.dirname(ortDist)) ortDist = path.dirname(ortDist);
  for (const f of fs.readdirSync(ortDist)) {
    if (f === 'ort.all.min.js' || (f.startsWith('ort-wasm-simd-threaded') && /\.(wasm|mjs)$/.test(f))) {
      copy(path.join(ortDist, f), path.join(pub, 'ort', f));
    }
  }
  console.log('web runtimes copied to public/');
} catch (e) {
  // Native-only installs (e.g. the APK Docker build) can live without them.
  console.warn('Skipping web runtimes:', e.message);
}
