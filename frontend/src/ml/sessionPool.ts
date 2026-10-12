import type { InferenceSession } from 'onnxruntime-react-native';

import { MODELS, type ModelKey } from '../config/models';
import { errorMessage } from '../lib/errors';
import type { ModelFileLocator } from './modelDownloader';
import type { InferenceRequest, InferenceResult, ModelMemory, ModelRunner } from './modelRunner';
import type { ModelStatusStore } from './modelStatus';
import { getOrt } from './ort';

/**
 * Owns every ONNX session. Guarantees:
 *  - only one inference (or session load) runs at a time, so a double tap can never put
 *    two 1024x1024 segmentation passes in memory at once;
 *  - at most `maxResident` sessions are alive; the least recently used one is released
 *    before another loads;
 *  - releaseAll() frees everything (the app calls it when backgrounded or low on memory).
 */
export class SessionPool implements ModelRunner, ModelMemory {
  private sessions = new Map<ModelKey, InferenceSession>(); // insertion order = LRU order
  private lock: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly files: ModelFileLocator,
    private readonly status: ModelStatusStore,
    readonly maxResident: number,
  ) {}

  run(key: ModelKey, { input, dims, pickOutput }: InferenceRequest): Promise<InferenceResult> {
    return this.exclusive(async () => {
      const ort = getOrt();
      const session = await this.acquire(key);
      const results = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, dims) });
      const out = results[pickOutput ? pickOutput(session.outputNames) : session.outputNames[0]];
      // Copy out so the native-backed output buffers can be released straight away.
      const data = new Float32Array(out.data as Float32Array);
      for (const name of Object.keys(results)) results[name].dispose?.();
      return { data, dims: out.dims };
    });
  }

  /** Frees all native model memory once any in-flight inference finishes. */
  releaseAll(): Promise<void> {
    return this.exclusive(async () => {
      for (const key of [...this.sessions.keys()]) await this.release(key);
    });
  }

  private async acquire(key: ModelKey): Promise<InferenceSession> {
    const existing = this.sessions.get(key);
    if (existing) {
      this.sessions.delete(key);
      this.sessions.set(key, existing);
      return existing;
    }
    if (!this.files.isDownloaded(key)) {
      throw new Error(`${MODELS[key].label} has not been downloaded yet.`);
    }
    while (this.sessions.size >= this.maxResident) {
      await this.release(this.sessions.keys().next().value as ModelKey);
    }

    this.status.set(key, { state: 'loading' });
    try {
      const session = await getOrt().InferenceSession.create(this.files.path(key), {
        executionProviders: ['cpu'],
        graphOptimizationLevel: 'all',
      });
      this.sessions.set(key, session);
      this.status.set(key, { state: 'ready' });
      return session;
    } catch (e) {
      this.status.set(key, { state: 'error', message: errorMessage(e) });
      throw e;
    }
  }

  private async release(key: ModelKey) {
    const session = this.sessions.get(key);
    if (!session) return;
    this.sessions.delete(key);
    try {
      await session.release();
    } finally {
      this.status.set(key, { state: 'downloaded' });
    }
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    this.lock = run.catch(() => undefined);
    return run;
  }
}
