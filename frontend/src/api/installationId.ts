import * as SecureStore from 'expo-secure-store';

export interface InstallationIdProvider {
  get(): Promise<string>;
}

const KEY = 'user_id_v1';

/**
 * Stable anonymous id for this install, created on first use and kept in SecureStore.
 * Not a credential: the POC has no auth; the id only partitions data on the server.
 */
export class SecureStoreInstallationId implements InstallationIdProvider {
  private cached: Promise<string> | null = null;

  get(): Promise<string> {
    this.cached ??= this.loadOrCreate().catch((e) => {
      this.cached = null; // let the next call retry
      throw e;
    });
    return this.cached;
  }

  private async loadOrCreate() {
    const existing = await SecureStore.getItemAsync(KEY);
    if (existing) return existing;
    const id = uuidV4();
    await SecureStore.setItemAsync(KEY, id);
    return id;
  }
}

/** RFC 4122 v4. Hermes has no crypto.getRandomValues; Math.random is fine for a non-secret id. */
function uuidV4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
