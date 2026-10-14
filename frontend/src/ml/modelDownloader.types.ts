import type { ModelKey } from '../config/models';

/** Where model files live. The session pool depends on this, not on the downloader. */
export interface ModelFileLocator {
  isDownloaded(key: ModelKey): boolean;
  /** What ONNX Runtime opens: a filesystem path on phones, a cache key (URL) on the web. */
  path(key: ModelKey): string;
}
