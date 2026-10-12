import { ApiError } from '../api/httpClient';
import type { GarmentRemote, ProfileRemote } from '../api/wardrobeApi';
import { MODELS } from '../config/models';
import type { DigitalTwin } from '../domain/types';
import { errorMessage } from '../lib/errors';
import { Emitter } from '../lib/observable';
import type { PendingUploads } from '../storage/closetRepository';
import type { GarmentImageReader } from '../storage/garmentImages';
import type { ProfileRepository, ProfileSyncMarker } from '../storage/profileRepository';

export interface SyncResult {
  uploaded: number;
  pending: number;
  error: string | null;
}

/** What the UI and app shell use. */
export interface CloudSync {
  readonly enabled: boolean;
  /** Uploads one profile version. Throws on failure; the next syncAll() retries it. */
  syncProfile(profile: DigitalTwin): Promise<void>;
  /** Uploads the current profile if needed, then every garment the server hasn't seen. */
  syncAll(): Promise<SyncResult>;
  onSynced(listener: (r: SyncResult) => void): () => void;
}

export interface CloudSyncDeps {
  remote: ProfileRemote & GarmentRemote;
  pending: PendingUploads;
  images: GarmentImageReader;
  profiles: Pick<ProfileRepository, 'load'>;
  profileSync: ProfileSyncMarker;
}

/**
 * Local-first sync. SQLite and SecureStore are the source of truth and the server is a
 * best-effort mirror. Every upload is idempotent server-side, so retrying is always safe.
 */
export class CloudSyncService implements CloudSync {
  readonly enabled = true;
  private synced = new Emitter<SyncResult>();
  private running: Promise<SyncResult> | null = null;
  private rerun = false;

  constructor(private readonly deps: CloudSyncDeps) {}

  onSynced = (listener: (r: SyncResult) => void) => this.synced.subscribe(listener);

  async syncProfile(profile: DigitalTwin) {
    await this.deps.remote.saveProfile(profile);
    await this.deps.profileSync.markSynced(profile.updatedAt);
  }

  /** Single-flight: calls during a run schedule exactly one more pass, so a garment saved mid-sync isn't missed. */
  syncAll(): Promise<SyncResult> {
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    this.running = (async () => {
      let total = 0;
      let result: SyncResult;
      do {
        this.rerun = false;
        result = await this.pass();
        total += result.uploaded;
      } while (this.rerun && !result.error);
      return { ...result, uploaded: total };
    })().finally(() => {
      this.running = null;
    });
    this.running.then((r) => this.synced.emit(r));
    return this.running;
  }

  private async pass(): Promise<SyncResult> {
    const pending = await this.deps.pending.listUnsynced();

    // Profile first, even with no garments pending: it retries a profile save that failed
    // offline, and the server's wardrobe_items has a foreign key to users.
    try {
      if (!(await this.ensureProfileSynced())) return { uploaded: 0, pending: pending.length, error: 'No Digital Twin yet' };
    } catch (e) {
      return { uploaded: 0, pending: pending.length, error: errorMessage(e) };
    }

    let uploaded = 0;
    let lastError: string | null = null;
    for (const g of pending) {
      try {
        // One garment at a time keeps at most one base64 PNG (~2-4 MB) in JS memory.
        await this.deps.remote.uploadGarment({
          clientItemId: g.id,
          pngBase64: await this.deps.images.readBase64(g.imageUri),
          colorHex: g.colorHex,
          embedding: g.embedding!, // listUnsynced only returns rows with an embedding
          metadata: {
            palette: g.palette,
            captured_at: new Date(g.createdAt).toISOString(),
            models: { segmentation: MODELS.segmentation.fileName, embedding: MODELS.embedding.fileName },
          },
        });
        await this.deps.pending.markSynced(g.id);
        uploaded++;
      } catch (e) {
        lastError = errorMessage(e);
        // Offline or server down: stop and retry the batch later. A 4xx is specific to
        // this garment, so carry on with the rest.
        if (!(e instanceof ApiError) || e.transient) break;
      }
    }
    return { uploaded, pending: pending.length - uploaded, error: lastError };
  }

  private async ensureProfileSynced(): Promise<boolean> {
    const profile = await this.deps.profiles.load();
    if (!profile) return false;
    if ((await this.deps.profileSync.syncedVersion()) !== profile.updatedAt) await this.syncProfile(profile);
    return true;
  }
}

/** Null object used when no backend is configured: the app stays fully on-device. */
export class DisabledCloudSync implements CloudSync {
  readonly enabled = false;
  async syncProfile() {}
  async syncAll() {
    return { uploaded: 0, pending: 0, error: null };
  }
  onSynced() {
    return () => {};
  }
}
