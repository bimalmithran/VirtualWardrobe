import * as SecureStore from 'expo-secure-store';

import type { KeyValueStore } from './keyValue.types';

export type { KeyValueStore } from './keyValue.types';
export { readJson } from './readJson';

/** Android Keystore / iOS Keychain backed. Values are encrypted at rest. */
export const secureKeyValue: KeyValueStore = {
  get: (key) => SecureStore.getItemAsync(key),
  set: (key, value) => SecureStore.setItemAsync(key, value),
  remove: (key) => SecureStore.deleteItemAsync(key),
};
