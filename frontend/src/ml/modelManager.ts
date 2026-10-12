import { useSyncExternalStore } from 'react';
import * as Device from 'expo-device';
import { Directory, File, Paths } from 'expo-file-system';
import type { InferenceSession } from 'onnxruntime-react-native';

import { MODELS, type ModelKey } from '../config/models';
import { getOrt, uriToPath, type Ort } from './ort';

export type ModelState =
  | { state: 'missing' }
  | { state: 'downloading'; progress: number }
  | { state: 'downloaded' } // on disk, not in memory
  | { state: 'loading' }
  | { state: 'ready' } // session resident in memory
  | { state: 'error'; message: string };

export type ModelStatuses = Record<ModelKey, ModelState>;

const GB = 1024 ** 3;

/**
 * Owns every ONNX session in the app. Guarantees:
 *  - only one inference (or session load) runs at a time, so a double tap can never
 *    put two 1024x1024 segmentation passes in memory at once;
 *  - at most `maxResident` sessions are alive; the least recently used one is
 *    released before another loads;
 *  - all sessions are released when the app is backgrounded (see App.tsx).
 */
class ModelManager {
  private statuses: ModelStatuses;
  private listeners = new Set<() => void>();
  private sessions = new Map<ModelKey, InferenceSession>(); // insertion order = LRU order
  private downloads = new Map<ModelKey, Promise<void>>();
  private lock: Promise<unknown> = Promise.resolve();
  private readonly dir = new Directory(Paths.document, 'models');

  /** 8 GB phones keep both models warm; smaller devices swap them per stage. */
  readonly maxResident = (Device.totalMemory ?? 0) >= 6 * GB ? 2 : 1;

  constructor() {
    this.dir.create({ intermediates: true, idempotent: true });
    this.statuses = {
      segmentation: this.file('segmentation').exists ? { state: 'downloaded' } : { state: 'missing' },
      embedding: this.file('embedding').exists ? { state: 'downloaded' } : { state: 'missing' },
    };
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.statuses;

  isDownloaded(key: ModelKey) {
    return this.file(key).exists;
  }

  /** Downloads a model once; concurrent callers share the same promise. */
  download(key: ModelKey): Promise<void> {
    if (this.isDownloaded(key)) {
      const { state } = this.statuses[key];
      if (state === 'missing' || state === 'error') this.setStatus(key, { state: 'downloaded' });
      return Promise.resolve();
    }
    const pending = this.downloads.get(key);
    if (pending) return pending;

    const spec = MODELS[key];
    const target = this.file(key);
    const partial = new File(this.dir, `${spec.fileName}.part`);

    const run = (async () => {
      this.setStatus(key, { state: 'downloading', progress: 0 });
      try {
        if (partial.exists) partial.delete();
        await File.downloadFileAsync(spec.url, partial, {
          idempotent: true,
          onProgress: ({ bytesWritten, totalBytes }) => {
            const total = totalBytes > 0 ? totalBytes : spec.bytes;
            this.setStatus(key, { state: 'downloading', progress: Math.min(1, bytesWritten / total) });
          },
        });
        // Android streams straight into the destination, so a dropped connection can
        // leave a truncated file that would later crash ORT's parser.
        if (partial.size !== spec.bytes) {
          throw new Error(`Download incomplete (${partial.size} of ${spec.bytes} bytes)`);
        }
        partial.moveSync(target);
        this.setStatus(key, { state: 'downloaded' });
      } catch (e) {
        if (partial.exists) partial.delete();
        this.setStatus(key, { state: 'error', message: errorMessage(e) });
        throw e;
      } finally {
        this.downloads.delete(key);
      }
    })();

    this.downloads.set(key, run);
    return run;
  }

  async downloadAll() {
    // Sequential: halves peak network/disk pressure and keeps progress readable.
    for (const key of Object.keys(MODELS) as ModelKey[]) await this.download(key);
  }

  /**
   * Runs `fn` with exclusive access to a loaded session. Every inference in the app
   * goes through here.
   */
  withSession<T>(key: ModelKey, fn: (session: InferenceSession, ort: Ort) => Promise<T>): Promise<T> {
    return this.exclusive(async () => {
      const ort = getOrt();
      const session = await this.acquire(key, ort);
      return fn(session, ort);
    });
  }

  /** Frees all native model memory once any in-flight inference finishes. */
  releaseAll(): Promise<void> {
    return this.exclusive(async () => {
      for (const key of [...this.sessions.keys()]) await this.release(key);
    });
  }

  private async acquire(key: ModelKey, ort: Ort): Promise<InferenceSession> {
    const existing = this.sessions.get(key);
    if (existing) {
      this.sessions.delete(key);
      this.sessions.set(key, existing);
      return existing;
    }

    if (!this.isDownloaded(key)) {
      throw new Error(`${MODELS[key].label} has not been downloaded yet.`);
    }

    while (this.sessions.size >= this.maxResident) {
      const lru = this.sessions.keys().next().value as ModelKey;
      await this.release(lru);
    }

    this.setStatus(key, { state: 'loading' });
    try {
      const session = await ort.InferenceSession.create(uriToPath(this.file(key).uri), {
        executionProviders: ['cpu'],
        graphOptimizationLevel: 'all',
      });
      this.sessions.set(key, session);
      this.setStatus(key, { state: 'ready' });
      return session;
    } catch (e) {
      this.setStatus(key, { state: 'error', message: errorMessage(e) });
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
      this.setStatus(key, { state: 'downloaded' });
    }
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    this.lock = run.catch(() => undefined);
    return run;
  }

  private file(key: ModelKey) {
    return new File(this.dir, MODELS[key].fileName);
  }

  private setStatus(key: ModelKey, state: ModelState) {
    this.statuses = { ...this.statuses, [key]: state };
    this.listeners.forEach((l) => l());
  }
}

export function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

export const modelManager = new ModelManager();

export function useModelStatuses(): ModelStatuses {
  return useSyncExternalStore(modelManager.subscribe, modelManager.getSnapshot);
}
