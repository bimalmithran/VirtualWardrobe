import * as Crypto from 'expo-crypto';

import type { KeyValueStore } from '../storage/keyValue';

export interface DeviceCredentials {
  userId: string;
  /** 64 hex characters from the platform CSPRNG. The server keeps only its SHA-256. */
  token: string;
}

export interface InstallationIdProvider {
  get(): Promise<string>;
}

/** Who this install is, for the API. */
export interface DeviceIdentity extends InstallationIdProvider {
  credentials(): Promise<DeviceCredentials>;
  /** Forgets the identity, after the user erased their server data. A new one is made on next use. */
  reset(): Promise<void>;
}

const USER_KEY = 'user_id_v1';
const TOKEN_KEY = 'device_token_v1';

/**
 * Anonymous per-install identity: a random user id plus a random secret, both kept in the
 * keystore. The secret authenticates the install to the API, so nobody who learns the user
 * id (it appears in image URLs) can act as this user.
 */
export class StoredDeviceIdentity implements DeviceIdentity {
  private cached: Promise<DeviceCredentials> | null = null;

  constructor(private readonly store: KeyValueStore) {}

  async get() {
    return (await this.credentials()).userId;
  }

  credentials(): Promise<DeviceCredentials> {
    this.cached ??= this.loadOrCreate().catch((e) => {
      this.cached = null; // let the next call retry
      throw e;
    });
    return this.cached;
  }

  async reset() {
    this.cached = null;
    await this.store.remove(TOKEN_KEY);
    await this.store.remove(USER_KEY);
  }

  private async loadOrCreate(): Promise<DeviceCredentials> {
    // Installs from before device tokens keep their user id and get a token on first use.
    let userId = await this.store.get(USER_KEY);
    if (!userId) {
      userId = Crypto.randomUUID();
      await this.store.set(USER_KEY, userId);
    }
    let token = await this.store.get(TOKEN_KEY);
    if (!token) {
      token = toHex(await Crypto.getRandomBytesAsync(32));
      await this.store.set(TOKEN_KEY, token);
    }
    return { userId, token };
  }
}

function toHex(bytes: Uint8Array) {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}
