import { Directory, File, Paths } from 'expo-file-system';

import { MODELS, type ModelKey } from '../config/models';
import { errorMessage } from '../lib/errors';
import type { ModelStatusStore } from './modelStatus';
import { uriToPath } from './ort';

/** Where model files live. The session pool depends on this, not on the downloader. */
export interface ModelFileLocator {
  isDownloaded(key: ModelKey): boolean;
  /** Filesystem path (not a file:// URI) as ONNX Runtime expects. */
  path(key: ModelKey): string;
}

/** Fetches model files once and verifies their size, reporting progress to the status store. */
export class ModelDownloader implements ModelFileLocator {
  private readonly dir = new Directory(Paths.document, 'models');
  private pending = new Map<ModelKey, Promise<void>>();

  constructor(private readonly status: ModelStatusStore) {
    this.dir.create({ intermediates: true, idempotent: true });
    for (const key of Object.keys(MODELS) as ModelKey[]) {
      if (this.isDownloaded(key)) status.set(key, { state: 'downloaded' });
    }
  }

  isDownloaded(key: ModelKey) {
    return this.file(key).exists;
  }

  path(key: ModelKey) {
    return uriToPath(this.file(key).uri);
  }

  /** Downloads a model once; concurrent callers share the same promise. */
  download(key: ModelKey): Promise<void> {
    if (this.isDownloaded(key)) {
      const { state } = this.status.get(key);
      if (state === 'missing' || state === 'error') this.status.set(key, { state: 'downloaded' });
      return Promise.resolve();
    }
    const existing = this.pending.get(key);
    if (existing) return existing;

    const run = this.fetch(key).finally(() => this.pending.delete(key));
    this.pending.set(key, run);
    return run;
  }

  async downloadAll(keys: readonly ModelKey[]) {
    // Sequential: halves peak network/disk pressure and keeps progress readable.
    for (const key of keys) await this.download(key);
  }

  private async fetch(key: ModelKey) {
    const spec = MODELS[key];
    const partial = new File(this.dir, `${spec.fileName}.part`);
    this.status.set(key, { state: 'downloading', progress: 0 });
    try {
      if (partial.exists) partial.delete();
      await File.downloadFileAsync(spec.url, partial, {
        idempotent: true,
        onProgress: ({ bytesWritten, totalBytes }) => {
          const total = totalBytes > 0 ? totalBytes : spec.bytes;
          this.status.set(key, { state: 'downloading', progress: Math.min(1, bytesWritten / total) });
        },
      });
      // Android streams straight into the destination, so a dropped connection can leave a
      // truncated file that would later crash ORT's parser.
      if (partial.size !== spec.bytes) {
        throw new Error(`Download incomplete (${partial.size} of ${spec.bytes} bytes)`);
      }
      partial.moveSync(this.file(key));
      this.status.set(key, { state: 'downloaded' });
    } catch (e) {
      if (partial.exists) partial.delete();
      this.status.set(key, { state: 'error', message: errorMessage(e) });
      throw e;
    }
  }

  private file(key: ModelKey) {
    return new File(this.dir, MODELS[key].fileName);
  }
}
