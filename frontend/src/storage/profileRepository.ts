import * as SecureStore from 'expo-secure-store';

import type { DigitalTwin } from '../domain/types';

export interface ProfileRepository {
  /** A corrupt or unreadable entry reads as "not onboarded". */
  load(): Promise<DigitalTwin | null>;
  save(profile: DigitalTwin): Promise<void>;
}

/** Remembers which profile version the server has, so sync can skip redundant uploads. */
export interface ProfileSyncMarker {
  syncedVersion(): Promise<number | null>;
  markSynced(version: number): Promise<void>;
}

const PROFILE_KEY = 'digital_twin_v1';
const SYNCED_KEY = 'digital_twin_synced_at_v1';

export class SecureStoreProfileRepository implements ProfileRepository, ProfileSyncMarker {
  async load() {
    try {
      const raw = await SecureStore.getItemAsync(PROFILE_KEY);
      return raw ? (JSON.parse(raw) as DigitalTwin) : null;
    } catch {
      return null;
    }
  }

  async save(profile: DigitalTwin) {
    await SecureStore.setItemAsync(PROFILE_KEY, JSON.stringify(profile));
  }

  async syncedVersion() {
    const raw = await SecureStore.getItemAsync(SYNCED_KEY);
    return raw ? Number(raw) : null;
  }

  async markSynced(version: number) {
    await SecureStore.setItemAsync(SYNCED_KEY, String(version));
  }
}
