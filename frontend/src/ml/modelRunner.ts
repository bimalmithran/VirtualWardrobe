import type { ModelKey } from '../config/models';

export interface InferenceRequest {
  input: Float32Array;
  dims: number[];
  /** Picks the output tensor to return; defaults to the first output. */
  pickOutput?: (outputNames: readonly string[]) => string;
}

export interface InferenceResult {
  /** A JS-owned copy; native output buffers are already released. */
  data: Float32Array;
  dims: readonly number[];
}

/** What vision stages need from the ML runtime: run one model on one tensor. */
export interface ModelRunner {
  run(key: ModelKey, request: InferenceRequest): Promise<InferenceResult>;
}

/** Memory controls the app shell and settings screen use. */
export interface ModelMemory {
  readonly maxResident: number;
  releaseAll(): Promise<void>;
}
