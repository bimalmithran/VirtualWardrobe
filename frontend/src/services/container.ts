import type { SQLiteDatabase } from 'expo-sqlite';

import { configuredApiUrl, FetchHttpClient } from '../api/httpClient';
import { StoredDeviceIdentity } from '../api/installationId';
import { CommerceApi } from '../api/commerceApi';
import { StylistApi, type StylistRemote } from '../api/stylistApi';
import { DailyCounter } from '../billing/dailyCounter';
import { PremiumService } from '../billing/premium';
import { WardrobeApi, type SimilarityRemote } from '../api/wardrobeApi';
import { SqliteChatRepository, type ChatRepository } from '../storage/chatRepository';
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
import type { PlanInputs } from '../ml/capabilities';
import { detectCapabilities, probeAccelerators } from '../ml/deviceCapabilities';
import { ExecutionRouter } from '../ml/executionRouter';
import { SaliencyBackgroundRemover, type BackgroundRemover } from '../vision/backgroundRemoval';
import { CloudBackgroundRemover, CloudEmbedder, RoutedBackgroundRemover, RoutedEmbedder } from '../vision/cloudVision';
import { extractPalette } from '../vision/colorExtraction';
import { MobileClipEmbedder, type GarmentEmbedder } from '../vision/embedding';
import { fuseViews } from '../vision/fusion';
import { assessQuality } from '../vision/junkFilter';
import { GarmentPipeline } from '../vision/pipeline';
import { MoveNetPoseEstimator, type PoseEstimator } from '../vision/pose';
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
  /** Stylist conversation, kept on the phone. */
  chat: ChatRepository;
  /** Cloud AI stylist (SSE); null without a backend. */
  stylist: StylistRemote | null;
  premium: PremiumService;
  /** Affiliate cards and resale; null without a backend. */
  commerce: CommerceApi | null;
  /** Today's free try-ons (try-on runs on the phone, so it is counted here). */
  tryOnCounter: DailyCounter;
  pipeline: GarmentPipeline;
  /** Photos of the user and the on-device analysis that reads their colouring. */
  self: { photos: SelfPhotoRepository; analyzer: SelfAnalyzer; pose: PoseEstimator };
  models: {
    status: ModelStatusStore;
    files: ModelDownloader;
    memory: ModelMemory;
    /** Device tier and where each model runs. */
    router: ExecutionRouter;
  };
}

interface MlServices {
  pose: PoseEstimator;
  models: Omit<AppServices['models'], 'router'>;
  router: ExecutionRouter;
  deviceRemover: BackgroundRemover;
  deviceEmbedder: GarmentEmbedder;
  selfAnalyzer: SelfAnalyzer;
}

let ml: MlServices | null = null;
/** Plan inputs come from the current app services (consent, API); set in createAppServices. */
let planInputs: () => PlanInputs = () => ({ cloudAvailable: false, cloudConsent: false, preferNpu: false });

/** ML objects own native memory and download state, so there is exactly one set per process. */
function mlServices(): MlServices {
  if (ml) return ml;
  const status = new ModelStatusStore();
  const files = new ModelDownloader(status);
  const router = new ExecutionRouter(detectCapabilities(), () => planInputs());
  probeAccelerators(router.caps).then((c) => router.update(c)).catch(() => {});
  const sessions = new SessionPool(files, status, () => {
    const plan = router.plan();
    return { maxResident: plan.maxResidentSessions, executionProviders: plan.executionProviders };
  });
  const deviceRemover = new SaliencyBackgroundRemover(sessions);
  ml = {
    pose: new MoveNetPoseEstimator(sessions),
    models: { status, files, memory: sessions },
    router,
    deviceRemover,
    deviceEmbedder: new MobileClipEmbedder(sessions),
    // Photos of the user never leave the phone, so self analysis always runs on the device.
    selfAnalyzer: new OnDeviceSelfAnalyzer(deviceRemover),
  };
  return ml;
}

const NPU_KEY = 'prefer_npu_v1';
let preferNpu = false;

/** Whether the NPU (NNAPI / Core ML / WebNN) is tried first; persisted. */
export async function setPreferNpu(store: KeyValueStore, value: boolean) {
  preferNpu = value;
  await store.set(NPU_KEY, value ? '1' : '0');
  mlServices().router.plan();
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
  const http = apiUrl ? new FetchHttpClient(apiUrl, identity) : null;
  const api = http ? new WardrobeApi(http, identity, language) : null;
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

  planInputs = () => ({ cloudAvailable: api !== null, cloudConsent: consent.allows('cloud_processing'), preferNpu });
  kv.get(NPU_KEY)
    .then((v) => {
      preferNpu = v === '1';
      mlServices().router.plan();
    })
    .catch(() => {});
  consent.subscribe(() => mlServices().router.plan());

  const { selfAnalyzer, router, deviceRemover, deviceEmbedder, models, pose } = mlServices();
  const deviceUsable = () => router.caps.runtimeAvailable;
  const pipeline = new GarmentPipeline({
    removeBackground: new RoutedBackgroundRemover(() => router.plan(), deviceRemover, api && new CloudBackgroundRemover(api), deviceUsable),
    embedder: new RoutedEmbedder(() => router.plan(), deviceEmbedder, api && new CloudEmbedder(api), deviceUsable),
    extractPalette,
    assessQuality,
  });
  const selfImages = new FileGarmentImageStore('me');
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
    chat: new SqliteChatRepository(db),
    stylist: http ? new StylistApi(http) : null,
    premium: new PremiumService(identity, http),
    commerce: http ? new CommerceApi(http) : null,
    tryOnCounter: new DailyCounter(kv, 'tryon_usage_v1'),
    self: { photos: selfPhotos, analyzer: selfAnalyzer, pose },
    pipeline,
    models: { ...models, router },
  };
}
