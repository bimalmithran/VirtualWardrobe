import type { KeyValueStore } from './keyValue.types';

/** Reads JSON, treating a missing or corrupt entry as absent. */
export async function readJson<T>(store: KeyValueStore, key: string): Promise<T | null> {
  try {
    const raw = await store.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
