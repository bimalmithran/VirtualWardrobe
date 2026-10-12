import { File } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import type { SQLiteDatabase } from 'expo-sqlite';

import { MODELS } from '../config/models';
import { errorMessage } from '../ml/modelManager';
import { listUnsynced, markSynced } from '../storage/closet';
import { readProfile, type DigitalTwin } from '../storage/profile';
import { ApiError, cloudEnabled, postProfile, postWardrobeItem } from './client';

/**
 * Local-first sync. SQLite and SecureStore are the source of truth; the server is a
 * best-effort mirror. Every upload is idempotent server-side, so retrying is always safe.
 */

const PROFILE_SYNCED_KEY = 'digital_twin_synced_at_v1'; // updatedAt of the last profile the server accepted

export async function syncProfile(profile: DigitalTwin): Promise<void> {
  if (!cloudEnabled) return;
  await postProfile(profile);
  await SecureStore.setItemAsync(PROFILE_SYNCED_KEY, String(profile.updatedAt));
}

/** Uploads the stored profile unless the server already has this version. Returns false if there is none. */
async function ensureProfileSynced(): Promise<boolean> {
  const profile = await readProfile();
  if (!profile) return false;
  if ((await SecureStore.getItemAsync(PROFILE_SYNCED_KEY)) !== String(profile.updatedAt)) {
    await syncProfile(profile);
  }
  return true;
}

export interface SyncResult {
  uploaded: number;
  pending: number;
  error: string | null;
}

const listeners = new Set<(r: SyncResult) => void>();

export function onClosetSynced(listener: (r: SyncResult) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

let running: Promise<SyncResult> | null = null;
let rerun = false;

/**
 * Uploads every garment the server hasn't seen. Single-flight: calls made while a sync
 * is running schedule exactly one more pass, so a garment saved mid-sync isn't missed.
 */
export function syncCloset(db: SQLiteDatabase): Promise<SyncResult> {
  if (!cloudEnabled) return Promise.resolve({ uploaded: 0, pending: 0, error: null });
  if (running) {
    rerun = true;
    return running;
  }
  running = (async () => {
    let total = 0;
    let result: SyncResult;
    do {
      rerun = false;
      result = await syncPass(db);
      total += result.uploaded;
    } while (rerun && !result.error);
    return { ...result, uploaded: total };
  })().finally(() => {
    running = null;
  });
  running.then((r) => listeners.forEach((l) => l(r)));
  return running;
}

async function syncPass(db: SQLiteDatabase): Promise<SyncResult> {
  const pending = await listUnsynced(db);

  // Profile first, even with no garments pending: it retries a profile save that failed
  // offline, and wardrobe_items has a foreign key to users.
  try {
    if (!(await ensureProfileSynced())) return { uploaded: 0, pending: pending.length, error: 'No Digital Twin yet' };
  } catch (e) {
    return { uploaded: 0, pending: pending.length, error: errorMessage(e) };
  }
  if (pending.length === 0) return { uploaded: 0, pending: 0, error: null };

  let uploaded = 0;
  let lastError: string | null = null;
  for (const g of pending) {
    try {
      // One garment at a time keeps at most one base64 PNG (~2-4 MB) in JS memory.
      const pngBase64 = await new File(g.imageUri).base64();
      await postWardrobeItem({
        clientItemId: g.id,
        pngBase64,
        colorHex: g.colorHex,
        embedding: g.embedding!, // listUnsynced only returns rows with an embedding
        metadata: {
          palette: g.palette,
          captured_at: new Date(g.createdAt).toISOString(),
          models: { segmentation: MODELS.segmentation.fileName, embedding: MODELS.embedding.fileName },
        },
      });
      await markSynced(db, g.id);
      uploaded++;
    } catch (e) {
      lastError = errorMessage(e);
      // Offline or server down: stop and retry the whole batch later. A 4xx is specific
      // to this garment, so carry on with the rest.
      if (!(e instanceof ApiError) || e.status === 0 || e.status >= 500) break;
    }
  }
  return { uploaded, pending: pending.length - uploaded, error: lastError };
}
