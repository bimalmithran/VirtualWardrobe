import { NativeModules, Platform } from 'react-native';
import * as Device from 'expo-device';

import { cpuBenchmark, type Capabilities } from './capabilities';

/** Probes the phone once at launch: memory, ORT linkage, accelerators and CPU speed. */
export function detectCapabilities(): Capabilities {
  const notes: string[] = [];
  const runtimeAvailable =
    !!NativeModules.Onnxruntime || typeof (globalThis as { OrtApi?: unknown }).OrtApi !== 'undefined';
  if (!runtimeAvailable) notes.push('ONNX Runtime is not linked in this build (e.g. Expo Go).');

  const accelerators: string[] = [];
  let npu = false;
  if (Platform.OS === 'android') {
    // NNAPI exists from Android 8.1 (API 27); drivers before Android 10 are often CPU-only.
    const api = typeof Platform.Version === 'number' ? Platform.Version : Number(Platform.Version);
    if (api >= 29) {
      accelerators.push('nnapi');
      npu = true;
    }
    accelerators.push('xnnpack', 'cpu');
  } else if (Platform.OS === 'ios') {
    accelerators.push('coreml', 'xnnpack', 'cpu');
    npu = true; // every supported iPhone has a Neural Engine
  } else {
    accelerators.push('cpu');
  }

  return {
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    totalMemoryBytes: Device.totalMemory ?? null,
    runtimeAvailable,
    accelerators,
    npu,
    gpu: false, // ORT mobile's GPU paths are not built into onnxruntime-react-native
    cpuScoreMs: cpuBenchmark(),
    notes,
  };
}

/** Native detection is already exact; kept for parity with the web probe. */
export async function probeAccelerators(c: Capabilities): Promise<Capabilities> {
  return c;
}
