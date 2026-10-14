import type * as OrtModule from 'onnxruntime-react-native';

import { cachedModelBytes } from './modelDownloader.web';

export type Ort = typeof OrtModule;

interface OrtWeb {
  env: { wasm: { wasmPaths?: string; numThreads?: number } };
  Tensor: unknown;
  InferenceSession: { create(model: Uint8Array, opts?: unknown): Promise<unknown> };
}

declare global {
  // Set by /ort/ort.all.min.js (ONNX Runtime Web, copied into public/ at install time).
  var ort: OrtWeb | undefined;
}

let loading: Promise<void> | null = null;
let wrapped: Ort | null = null;

/**
 * Loads ONNX Runtime Web (WebNN, WebGPU and WASM execution providers) from the app's own
 * origin. A script tag rather than a bundled import: the runtime loads its wasm and worker
 * files itself, which Metro can't bundle.
 */
export function prepareOrt(): Promise<void> {
  loading ??= new Promise<void>((resolve, reject) => {
    if (globalThis.ort) return resolve();
    const s = document.createElement('script');
    s.src = '/ort/ort.all.min.js';
    s.async = true;
    s.onload = () => {
      const o = globalThis.ort!;
      o.env.wasm.wasmPaths = '/ort/';
      // Threads need SharedArrayBuffer, which needs a cross-origin-isolated page.
      o.env.wasm.numThreads = globalThis.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
      resolve();
    };
    s.onerror = () => {
      loading = null;
      reject(new Error('Could not load ONNX Runtime Web (/ort/ort.all.min.js).'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/** The runtime, shaped like onnxruntime-react-native: sessions open from cached model bytes. */
export function getOrt(): Ort {
  if (wrapped) return wrapped;
  const o = globalThis.ort;
  if (!o) throw new Error('ONNX Runtime Web is not loaded yet.');
  wrapped = {
    Tensor: o.Tensor,
    InferenceSession: {
      create: async (url: string, opts?: unknown) => o.InferenceSession.create(await cachedModelBytes(url), opts),
    },
  } as unknown as Ort;
  return wrapped;
}

export const uriToPath = (uri: string) => uri;
