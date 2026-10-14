// React Native Skia evaluates CanvasKit when its modules load, so the wasm must be ready
// before the app (and everything that imports Skia) is evaluated. A deferred require keeps
// it in the same bundle: single-output web exports have no async chunk loader.
import '@expo/metro-runtime';
import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/module/web';

LoadSkiaWeb({ locateFile: (file) => `/${file}` }).then(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('expo-router/entry');
});
