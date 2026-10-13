import { cpuBenchmark, type Capabilities } from './capabilities';

interface NavigatorML {
  ml?: { createContext?: (opts?: unknown) => Promise<unknown> };
  gpu?: { requestAdapter?: () => Promise<unknown | null> };
  deviceMemory?: number;
}

/**
 * Browser capability probe: WebNN (NPU), WebGPU, WebGL2 and WebAssembly (+SIMD, +threads).
 * Synchronous checks only report presence; probeAccelerators() confirms an adapter exists.
 */
export function detectCapabilities(): Capabilities {
  const nav = (globalThis.navigator ?? {}) as NavigatorML;
  const notes: string[] = [];
  const wasm = typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function';
  const simd = wasm && wasmSimdSupported();
  const threads = wasm && !!(globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated;
  const webnn = typeof nav.ml?.createContext === 'function';
  const webgpu = typeof nav.gpu?.requestAdapter === 'function';
  const webgl = webgl2Supported();

  const accelerators: string[] = [];
  if (webnn) accelerators.push('webnn');
  if (webgpu) accelerators.push('webgpu');
  if (wasm) accelerators.push('wasm');
  if (!wasm) notes.push('This browser has no WebAssembly, so models cannot run in it.');
  if (wasm && !simd) notes.push('WebAssembly SIMD is unavailable; on-device models will be slow.');
  if (wasm && !threads) notes.push('Page is not cross-origin isolated; WebAssembly runs single-threaded.');
  if (webgl && !webgpu) notes.push('WebGL2 only: kept as a capability signal, ORT web uses WebGPU/WASM for these models.');

  return {
    platform: 'web',
    totalMemoryBytes: nav.deviceMemory ? nav.deviceMemory * 1024 ** 3 : null,
    runtimeAvailable: wasm,
    accelerators,
    npu: webnn,
    gpu: webgpu || webgl,
    cpuScoreMs: cpuBenchmark(),
    notes,
  };
}

/** Confirms the GPU/NPU entries by asking for an adapter/context; drops ones that fail. */
export async function probeAccelerators(c: Capabilities): Promise<Capabilities> {
  const nav = (globalThis.navigator ?? {}) as NavigatorML;
  const accelerators = [...c.accelerators];
  const drop = (name: string) => {
    const i = accelerators.indexOf(name);
    if (i >= 0) accelerators.splice(i, 1);
  };
  if (accelerators.includes('webgpu')) {
    const adapter = await nav.gpu!.requestAdapter!().catch(() => null);
    if (!adapter) drop('webgpu');
  }
  if (accelerators.includes('webnn')) {
    const ctx = await nav.ml!.createContext!({ deviceType: 'npu' }).catch(() => null);
    if (!ctx) drop('webnn');
  }
  return { ...c, accelerators, npu: accelerators.includes('webnn'), gpu: accelerators.includes('webgpu') || c.gpu };
}

function webgl2Supported() {
  try {
    const doc = (globalThis as { document?: { createElement(t: string): { getContext(t: string): unknown } } }).document;
    return !!doc?.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

// Smallest module using a v128 instruction; validates only where SIMD is supported.
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);

function wasmSimdSupported() {
  try {
    return WebAssembly.validate(SIMD_PROBE);
  } catch {
    return false;
  }
}
