import type * as OrtModule from 'onnxruntime-react-native';

export type Ort = typeof OrtModule;

let ort: Ort | null = null;
let loadError: Error | null = null;

/**
 * onnxruntime-react-native installs its JSI bindings as a side effect of being imported,
 * and that throws when the native module is absent (Expo Go, or a build without the
 * config plugin). Importing lazily keeps that failure contained to the ML features
 * instead of crashing the app at startup.
 */
export function getOrt(): Ort {
  if (ort) return ort;
  if (loadError) throw loadError;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate lazy load, see above
    ort = require('onnxruntime-react-native') as Ort;
    return ort;
  } catch (e) {
    loadError = new Error(
      'ONNX Runtime native module is not available. Install the APK built with ' +
        '`eas build -p android --profile preview` (Expo Go cannot run on-device models). ' +
        `Cause: ${e instanceof Error ? e.message : String(e)}`,
    );
    throw loadError;
  }
}

/** ORT's native loader takes a filesystem path verbatim; it does not understand file:// URIs. */
export function uriToPath(uri: string): string {
  return decodeURIComponent(uri.replace(/^file:\/\//, ''));
}
