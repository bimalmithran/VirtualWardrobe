import * as Device from 'expo-device';
import { Directory, Paths } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';

import { configuredApiUrl, FetchHttpClient } from '../api/httpClient';
import { StoredDeviceIdentity } from '../api/installationId';
import { WardrobeApi, type SimilarityRemote } from '../api/wardrobeApi';
import { isLanguage } from '../i18n/I18nProvider';
import { ConsentService } from '../privacy/consent';
import { secureKeyValue, type KeyValueStore } from '../storage/keyValue';
import { DeviceEraser, type LocalEraser } from '../storage/localEraser';
import { ModelDownloader } from '../ml/modelDownloader';
import type { ModelMemory } from '../ml/modelRunner';
import { ModelStatusStore } from '../ml/modelStatus';
import { SessionPool } from '../ml/sessionPool';
import { SqliteClosetRepository, type ClosetRepository, type GarmentPhotos } from '../storage/closetRepository';
import { SqliteDeletionQueue } from '../storage/deletionQueue';
import { FileGarmentImageStore } from '../storage/garmentImages';
import { SqliteOutfitRepository, type OutfitRepository } from '../storage/outfitRepository';
import { KeyValueProfileRepository, type ProfileRepository } from '../storage/profileRepository';
import { SqliteSelfPhotoRepository, type SelfPhotoRepository } from '../storage/selfPhotoRepository';
import { CloudSyncService, DisabledCloudSync, type CloudSync } from '../sync/cloudSync';
import { SaliencyBackgroundRemover } from '../vision/backgroundRemoval';
import { extractPalette } from '../vision/colorExtraction';
import { MobileClipEmbedder } from '../vision/embedding';
import { fuseViews } from '../vision/fusion';
import { assessQuality } from '../vision/junkFilter';
import { GarmentPipeline } from '../vision/pipeline';
import { OnDeviceSelfAnalyzer, type SelfAnalyzer } from '../vision/selfAnalyzer';

/** Everything screens may use, typed by interface rather than implementation. */
export interface AppServices {
  closet: ClosetRepository;
  /** Extra photos per garment; the same store as `closet`. */
  photos: GarmentPhotos;
  outfits: OutfitRepository;
  profiles: ProfileRepository;
  sync: CloudSync;
  /** Consent in force; every cloud feature checks it. */
  consent: ConsentService;
  /** Server API; null when no backend is configured. */
  api: WardrobeApi | null;
  /** Null when no backend is configured. */
  similarity: SimilarityRemote | null;
  /** Keystore-backed settings store (language, flags). */
  settings: KeyValueStore;
  eraser: LocalEraser;
  pipeline: GarmentPipeline;
  /** Photos of the user and the on-device analysis that reads their colouring. */
  self: { photos: SelfPhotoRepository; analyzer: SelfAnalyzer };
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
  selfAnalyzer: SelfAnalyzer;
}

let ml: MlServices | null = null;

/** ML objects own native memory and download state, so there is exactly one set per process. */
function mlServices(): MlServices {
  if (ml) return ml;
  const status = new ModelStatusStore();
  const files = new ModelDownloader(status);
  // 8 GB phones keep both models warm; smaller devices swap them per stage.
  const sessions = new SessionPool(files, status, (Device.totalMemory ?? 0) >= 6 * GB ? 2 : 1);
  const removeBackground = new SaliencyBackgroundRemover(sessions);
  const pipeline = new GarmentPipeline({
    removeBackground,
    embedder: new MobileClipEmbedder(sessions),
    extractPalette,
    assessQuality,
  });
  ml = { models: { status, files, memory: sessions }, pipeline, selfAnalyzer: new OnDeviceSelfAnalyzer(removeBackground) };
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
  const kv = secureKeyValue;
  const profiles = new KeyValueProfileRepository(kv);
  const identity = new StoredDeviceIdentity(kv);
  const language = async () => {
    const saved = await kv.get('ui_language_v1');
    return isLanguage(saved) ? saved : 'en';
  };
  const api = apiUrl ? new WardrobeApi(new FetchHttpClient(apiUrl, identity), identity, language) : null;
  const consent = new ConsentService(kv, api, async () => {
    await closet.resetSyncState();
    await profiles.clearSynced();
  });

  const sync: CloudSync = api
    ? new CloudSyncService({
        consent,
        remote: api,
        pending: closet,
        outfits,
        deletions: new SqliteDeletionQueue(db),
        images,
        profiles,
        profileSync: profiles,
      })
    : new DisabledCloudSync();

  const { selfAnalyzer, ...mlRest } = mlServices();
  const selfImages = new FileGarmentImageStore(new Directory(Paths.document, 'me'));
  const selfPhotos = new SqliteSelfPhotoRepository(db, selfImages);
  const eraser = new DeviceEraser(db, [images, selfImages], [() => profiles.clear(), () => consent.clear(), () => identity.reset()]);
  return {
    closet,
    photos: closet,
    outfits,
    profiles,
    sync,
    consent,
    api,
    similarity: api,
    settings: kv,
    eraser,
    self: { photos: selfPhotos, analyzer: selfAnalyzer },
    ...mlRest,
  };
}
