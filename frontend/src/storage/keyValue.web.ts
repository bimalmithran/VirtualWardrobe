import type { KeyValueStore } from './keyValue';

export type { KeyValueStore } from './keyValue';
export { readJson } from './keyValue';

/**
 * expo-secure-store has no web implementation. Browsers offer no keystore to JS, so web
 * keeps these values in localStorage, scoped to the app's origin. The device token is
 * therefore only as safe as the origin: serve the web build over HTTPS with a strict CSP.
 */
export const secureKeyValue: KeyValueStore = {
  async get(key) {
    return globalThis.localStorage?.getItem(key) ?? null;
  },
  async set(key, value) {
    globalThis.localStorage?.setItem(key, value);
  },
  async remove(key) {
    globalThis.localStorage?.removeItem(key);
  },
};
