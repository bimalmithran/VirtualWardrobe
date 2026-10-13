import { EMPTY_PROPORTIONS, type DigitalTwin } from '../domain/types';
import { isSubSeason } from '../style/seasons';
import { readJson, type KeyValueStore } from './keyValue';

export interface ProfileRepository {
  /** A corrupt or unreadable entry reads as "not onboarded". */
  load(): Promise<DigitalTwin | null>;
  save(profile: DigitalTwin): Promise<void>;
  /** Forgets the Digital Twin (erasing all local data). */
  clear(): Promise<void>;
}

/** Remembers which profile version the server has, so sync can skip redundant uploads. */
export interface ProfileSyncMarker {
  syncedVersion(): Promise<number | null>;
  markSynced(version: number): Promise<void>;
  clearSynced(): Promise<void>;
}

const PROFILE_KEY = 'digital_twin_v1';
const SYNCED_KEY = 'digital_twin_synced_at_v1';

/** Keeps the Digital Twin in the platform keystore (it is body data). */
export class KeyValueProfileRepository implements ProfileRepository, ProfileSyncMarker {
  constructor(private readonly store: KeyValueStore) {}

  async load(): Promise<DigitalTwin | null> {
    const raw = await readJson<Partial<DigitalTwin>>(this.store, PROFILE_KEY);
    if (!raw || typeof raw.heightCm !== 'number' || !raw.bodyShape || !raw.undertone) return null;
    // v1 profiles had no proportions or season.
    return {
      heightCm: raw.heightCm,
      bodyShape: raw.bodyShape,
      undertone: raw.undertone,
      proportions: { ...EMPTY_PROPORTIONS, ...raw.proportions },
      season: isSubSeason(raw.season) ? raw.season : null,
      updatedAt: raw.updatedAt ?? 0,
    };
  }

  async save(profile: DigitalTwin) {
    await this.store.set(PROFILE_KEY, JSON.stringify(profile));
  }

  async clear() {
    await this.store.remove(PROFILE_KEY);
    await this.store.remove(SYNCED_KEY);
  }

  async syncedVersion() {
    const raw = await this.store.get(SYNCED_KEY);
    return raw ? Number(raw) : null;
  }

  async clearSynced() {
    await this.store.remove(SYNCED_KEY);
  }

  async markSynced(version: number) {
    await this.store.set(SYNCED_KEY, String(version));
  }
}
