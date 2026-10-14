import { MODELS, type ModelKey } from '../config/models';
import { errorMessage } from '../lib/errors';
import type { ModelStatusStore } from './modelStatus';

export type { ModelFileLocator } from './modelDownloader.types';

const CACHE = 'virtualwardrobe-models-v1';

/**
 * Web: models live in Cache Storage under their Hugging Face URL. Presence is checked once
 * at startup (Cache Storage is async; the locator interface is sync), then tracked here.
 */
export class ModelDownloader {
  private present = new Set<ModelKey>();
  private pending = new Map<ModelKey, Promise<void>>();

  constructor(private readonly status: ModelStatusStore) {
    if (typeof caches === 'undefined') return;
    caches
      .open(CACHE)
      .then(async (cache) => {
        for (const key of Object.keys(MODELS) as ModelKey[]) {
          const hit = await cache.match(MODELS[key].url);
          if (hit && Number(hit.headers.get('content-length') ?? MODELS[key].bytes) === MODELS[key].bytes) {
            this.present.add(key);
            status.set(key, { state: 'downloaded' });
          }
        }
      })
      .catch(() => {});
  }

  isDownloaded(key: ModelKey) {
    return this.present.has(key);
  }

  /** The cache key; ort.web.ts reads the bytes from Cache Storage. */
  path(key: ModelKey) {
    return MODELS[key].url;
  }

  download(key: ModelKey): Promise<void> {
    if (this.present.has(key)) return Promise.resolve();
    const existing = this.pending.get(key);
    if (existing) return existing;
    const run = this.fetch(key).finally(() => this.pending.delete(key));
    this.pending.set(key, run);
    return run;
  }

  async downloadAll(keys: readonly ModelKey[]) {
    for (const key of keys) await this.download(key);
  }

  private async fetch(key: ModelKey) {
    const spec = MODELS[key];
    this.status.set(key, { state: 'downloading', progress: 0 });
    try {
      const res = await fetch(spec.url);
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        this.status.set(key, { state: 'downloading', progress: Math.min(1, received / spec.bytes) });
      }
      if (received !== spec.bytes) throw new Error(`Download incomplete (${received} of ${spec.bytes} bytes)`);
      const cache = await caches.open(CACHE);
      await cache.put(spec.url, new Response(new Blob(chunks as BlobPart[]), { headers: { 'content-length': String(received) } }));
      this.present.add(key);
      this.status.set(key, { state: 'downloaded' });
    } catch (e) {
      this.status.set(key, { state: 'error', message: errorMessage(e) });
      throw e;
    }
  }
}

/** Reads a cached model's bytes for ONNX Runtime Web. */
export async function cachedModelBytes(url: string): Promise<Uint8Array> {
  const hit = await (await caches.open(CACHE)).match(url);
  if (!hit) throw new Error('Model is not downloaded');
  return new Uint8Array(await hit.arrayBuffer());
}
