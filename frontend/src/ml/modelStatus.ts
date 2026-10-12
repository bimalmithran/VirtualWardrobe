import { useSyncExternalStore } from 'react';

import { MODELS, type ModelKey } from '../config/models';
import { Emitter } from '../lib/observable';

export type ModelState =
  | { state: 'missing' }
  | { state: 'downloading'; progress: number }
  | { state: 'downloaded' } // on disk, not in memory
  | { state: 'loading' }
  | { state: 'ready' } // session resident in memory
  | { state: 'error'; message: string };

export type ModelStatuses = Record<ModelKey, ModelState>;

/**
 * Observable model state, written by the downloader and the session pool and read by the
 * UI. Its only job is to hold and broadcast state.
 */
export class ModelStatusStore {
  private statuses: ModelStatuses;
  private changes = new Emitter<void>();

  constructor() {
    this.statuses = Object.fromEntries((Object.keys(MODELS) as ModelKey[]).map((k) => [k, { state: 'missing' }])) as ModelStatuses;
  }

  subscribe = (listener: () => void) => this.changes.subscribe(listener);

  getSnapshot = () => this.statuses;

  get(key: ModelKey): ModelState {
    return this.statuses[key];
  }

  set(key: ModelKey, state: ModelState) {
    this.statuses = { ...this.statuses, [key]: state };
    this.changes.emit();
  }
}

export function useModelStatuses(store: ModelStatusStore): ModelStatuses {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
