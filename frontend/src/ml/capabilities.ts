/**
 * What this device can run, and the plan that follows from it. Detection is per platform
 * (deviceCapabilities.ts / deviceCapabilities.web.ts); planning is pure and shared.
 */

export type Tier = 'high' | 'mid' | 'low';
export type Where = 'device' | 'cloud';

export interface Capabilities {
  platform: 'android' | 'ios' | 'web';
  totalMemoryBytes: number | null;
  /** The ONNX runtime for this platform loaded (native module linked, or wasm available on web). */
  runtimeAvailable: boolean;
  /** Accelerators the runtime can use, best first: e.g. ['nnapi', 'xnnpack', 'cpu'] or ['webgpu', 'wasm']. */
  accelerators: string[];
  /** Hardware neural accelerator reachable from the runtime (NNAPI, Core ML, WebNN). */
  npu: boolean;
  gpu: boolean;
  /** Milliseconds for a fixed CPU micro-benchmark; lower is faster. */
  cpuScoreMs: number;
  notes: string[];
}

export interface ExecutionPlan {
  tier: Tier;
  segmentation: Where;
  embedding: Where;
  /** ORT execution providers to request, in order; the runtime falls back along the list. */
  executionProviders: string[];
  /** Model sessions kept in memory at once. */
  maxResidentSessions: number;
  reasons: string[];
}

const GB = 1024 ** 3;

/** Thresholds from the target phones: an 8 GB Galaxy M-series is high, 4 GB budget phones are mid. */
export function classify(c: Capabilities): Tier {
  if (!c.runtimeAvailable) return 'low';
  const mem = c.totalMemoryBytes;
  if (c.platform === 'web') {
    // Browsers hide RAM; WebGPU/WebNN plus a quick CPU means the 44 MB cutout model runs well.
    if ((c.gpu || c.npu) && c.cpuScoreMs < 60) return 'high';
    return c.cpuScoreMs < 150 ? 'mid' : 'low';
  }
  if (mem !== null && mem < 3 * GB) return 'low';
  if (c.cpuScoreMs > 250) return 'low';
  if (mem !== null && mem >= 6 * GB && c.cpuScoreMs < 120) return 'high';
  return 'mid';
}

export interface PlanInputs {
  /** A backend is configured. */
  cloudAvailable: boolean;
  /** The user consented to cloud photo processing. */
  cloudConsent: boolean;
  /** User preference: let the NPU try first (some int8 graphs run slower there). */
  preferNpu: boolean;
}

/**
 * High tier: everything on the phone. Mid: everything on the phone, one model in memory at
 * a time. Low: the 1024² background-removal model goes to the cloud when allowed (hybrid),
 * while the small embedding model stays on the phone if the runtime exists at all; without a
 * runtime both go to the cloud. Without cloud consent nothing is sent: the phone tries anyway.
 */
export function planExecution(c: Capabilities, inputs: PlanInputs): ExecutionPlan {
  const tier = classify(c);
  const reasons = [...c.notes];
  const cloud = inputs.cloudAvailable && inputs.cloudConsent;
  let segmentation: Where = 'device';
  let embedding: Where = 'device';

  if (tier === 'low') {
    if (cloud) {
      segmentation = 'cloud';
      reasons.push('Background removal runs in the cloud: this device is below the on-device threshold.');
      if (!c.runtimeAvailable) {
        embedding = 'cloud';
        reasons.push('Style vectors run in the cloud: no on-device runtime.');
      }
    } else {
      reasons.push(
        inputs.cloudAvailable
          ? 'Low-tier device without cloud-processing consent: running on this device, which may be slow.'
          : 'Low-tier device and no server configured: running on this device, which may be slow.',
      );
    }
  } else {
    reasons.push(tier === 'high' ? 'High-tier device: all AI runs on this device.' : 'Mid-tier device: AI runs on this device, one model at a time.');
  }

  const accelerators = c.accelerators.filter((a) => inputs.preferNpu || !['nnapi', 'coreml', 'webnn'].includes(a));
  return {
    tier,
    segmentation,
    embedding,
    executionProviders: accelerators.length ? accelerators : ['cpu'],
    maxResidentSessions: tier === 'high' ? 2 : 1,
    reasons,
  };
}

/** ~2M floating-point ops; a few ms on a flagship, hundreds on a struggling budget phone. */
export function cpuBenchmark(): number {
  const start = Date.now();
  let acc = 0;
  const a = new Float32Array(4096);
  for (let i = 0; i < a.length; i++) a[i] = i * 0.001;
  for (let r = 0; r < 500; r++) for (let i = 0; i < a.length; i++) acc += a[i] * a[(i + r) & 4095];
  const ms = Date.now() - start;
  return acc === -1 ? -1 : Math.max(1, ms); // acc keeps the loop from being optimised away
}
