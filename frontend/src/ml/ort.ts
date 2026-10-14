import { NativeModules } from 'react-native';
import type * as OrtModule from 'onnxruntime-react-native';

export type Ort = typeof OrtModule;

let ort: Ort | null = null;
let loadError: Error | null = null;

/**
 * onnxruntime-react-native installs its JSI bindings as a side effect of being imported,
 * and that throws when the native module is absent (Expo Go, or a build where it was not
 * autolinked). In release builds Metro reports a throwing module factory as a fatal error
 * before any surrounding catch runs, so the native module is checked for *before* the
 * require. That keeps the failure contained to the ML features instead of killing the app.
 */
export function getOrt(): Ort {
  if (ort) return ort;
  if (loadError) throw loadError;
  if (!NativeModules.Onnxruntime && typeof (globalThis as { OrtApi?: unknown }).OrtApi === 'undefined') {
    loadError = new Error(
      'ONNX Runtime native module is not available in this build. Install an APK that links ' +
        'onnxruntime-react-native (Expo Go cannot run on-device models).',
    );
    throw loadError;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate lazy load, see above
    ort = require('onnxruntime-react-native') as Ort;
    return ort;
  } catch (e) {
    loadError = new Error(`ONNX Runtime failed to load: ${e instanceof Error ? e.message : String(e)}`);
    throw loadError;
  }
}

/** ORT's native loader takes a filesystem path verbatim; it does not understand file:// URIs. */
export function uriToPath(uri: string): string {
  return decodeURIComponent(uri.replace(/^file:\/\//, ''));
}

/** Loads the runtime where that is asynchronous (web); a no-op on phones. */
export async function prepareOrt(): Promise<void> {}
