import * as Device from 'expo-device';
import type { SQLiteDatabase } from 'expo-sqlite';

import { configuredApiUrl, FetchHttpClient } from '../api/httpClient';
import { SecureStoreInstallationId } from '../api/installationId';
import { WardrobeApi, type SimilarityRemote } from '../api/wardrobeApi';
import { ModelDownloader } from '../ml/modelDownloader';
import type { ModelMemory } from '../ml/modelRunner';
import { ModelStatusStore } from '../ml/modelStatus';
import { SessionPool } from '../ml/sessionPool';
import { SqliteClosetRepository, type ClosetRepository, type GarmentPhotos } from '../storage/closetRepository';
import { SqliteDeletionQueue } from '../storage/deletionQueue';
import { FileGarmentImageStore } from '../storage/garmentImages';
import { SqliteOutfitRepository, type OutfitRepository } from '../storage/outfitRepository';
import { SecureStoreProfileRepository, type ProfileRepository } from '../storage/profileRepository';
import { CloudSyncService, DisabledCloudSync, type CloudSync } from '../sync/cloudSync';
import { SaliencyBackgroundRemover } from '../vision/backgroundRemoval';
import { extractPalette } from '../vision/colorExtraction';
import { MobileClipEmbedder } from '../vision/embedding';
import { fuseViews } from '../vision/fusion';
import { assessQuality } from '../vision/junkFilter';
import { GarmentPipeline } from '../vision/pipeline';

/** Everything screens may use, typed by interface rather than implementation. */
export interface AppServices {
  closet: ClosetRepository;
  /** Extra photos per garment; the same store as `closet`. */
  photos: GarmentPhotos;
  outfits: OutfitRepository;
  profiles: ProfileRepository;
  sync: CloudSync;
  /** Null when no backend is configured. */
  similarity: SimilarityRemote | null;
  pipeline: GarmentPipeline;
  models: {
    status: ModelStatusStore;
    files: ModelDownloader;
    memory: ModelMemory;
  };
}

const GB = 1024 ** 3;

interface MlServices {
  models: AppServices['models'];
  pipeline: GarmentPipeline;
}

let ml: MlServices | null = null;

/** ML objects own native memory and download state, so there is exactly one set per process. */
function mlServices(): MlServices {
  if (ml) return ml;
  const status = new ModelStatusStore();
  const files = new ModelDownloader(status);
  // 8 GB phones keep both models warm; smaller devices swap them per stage.
  const sessions = new SessionPool(files, status, (Device.totalMemory ?? 0) >= 6 * GB ? 2 : 1);
  const pipeline = new GarmentPipeline({
    removeBackground: new SaliencyBackgroundRemover(sessions),
    embedder: new MobileClipEmbedder(sessions),
    extractPalette,
    assessQuality,
  });
  ml = { models: { status, files, memory: sessions }, pipeline };
  return ml;
}

/**
 * The composition root: the only place that chooses concrete implementations. Swapping
 * storage, transport or a model means changing this file, not the screens.
 */
export function createAppServices(db: SQLiteDatabase, apiUrl = configuredApiUrl()): AppServices {
  const images = new FileGarmentImageStore();
  const closet = new SqliteClosetRepository(db, images, fuseViews);
  const outfits = new SqliteOutfitRepository(db);
  const profiles = new SecureStoreProfileRepository();
  const api = apiUrl ? new WardrobeApi(new FetchHttpClient(apiUrl), new SecureStoreInstallationId()) : null;

  const sync: CloudSync = api
    ? new CloudSyncService({
        remote: api,
        pending: closet,
        outfits,
        deletions: new SqliteDeletionQueue(db),
        images,
        profiles,
        profileSync: profiles,
      })
    : new DisabledCloudSync();

  return { closet, photos: closet, outfits, profiles, sync, similarity: api, ...mlServices() };
}
