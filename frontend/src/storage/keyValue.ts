import * as SecureStore from 'expo-secure-store';

/** Small string values that must survive restarts: profile, consent, device credentials. */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Android Keystore / iOS Keychain backed. Values are encrypted at rest. */
export const secureKeyValue: KeyValueStore = {
  get: (key) => SecureStore.getItemAsync(key),
  set: (key, value) => SecureStore.setItemAsync(key, value),
  remove: (key) => SecureStore.deleteItemAsync(key),
};

/** Reads JSON, treating a missing or corrupt entry as absent. */
export async function readJson<T>(store: KeyValueStore, key: string): Promise<T | null> {
  try {
    const raw = await store.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
