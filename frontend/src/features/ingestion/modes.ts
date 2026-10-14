import { useEffect, useMemo } from 'react';
import { deleteFile, writeCacheFile } from '../../platform/files';
import { router } from 'expo-router';

import type { ModelKey } from '../../config/models';
import type { Garment, Wearer } from '../../domain/types';
import { useServices } from '../../services/ServicesProvider';
import type { ClosetRepository, GarmentPhotos } from '../../storage/closetRepository';
import type { CloudSync } from '../../sync/cloudSync';
import type { ProcessedGarment, Stage } from '../../vision/pipeline';
import { scoreForWearer } from '../../style/personalFit';
import type { MatchResult } from '../../vision/undertoneMatch';
import { useWearer } from '../self/SelfContext';

export type StepKey = Stage | 'saving';

export interface IngestionOutcome {
  previewUri: string;
  match: MatchResult | null;
  /** The saved garment, with its colour fused across all of its photos. Null when nothing was saved. */
  garment: Garment | null;
}

/**
 * Strategy for one capture flow. The shared flow (capture → junk check → pipeline →
 * result) is closed for modification; a new flow is a new IngestionMode.
 */
export interface IngestionMode {
  readonly requiredModels: ModelKey[];
  readonly embed: boolean;
  readonly steps: { key: StepKey; label: string }[];
  readonly copy: { captureHint: string; doneTitle: string; againLabel: string; exitLabel?: string };
  /** Whether the result screen asks what kind of garment this is. */
  readonly asksCategory: boolean;
  /** Turns a processed garment into a result, persisting it if the mode does that. */
  complete(result: ProcessedGarment, onStep: (step: StepKey) => void): Promise<IngestionOutcome>;
  /** Releases anything the last complete() created that only lives while it is shown. */
  discard(): void;
  /** Leaves the flow from the result screen. Only called when copy.exitLabel is set. */
  exit(outcome: IngestionOutcome): void;
  /** Set when the result can be improved with more photos of the same garment. */
  addPhotos?(outcome: IngestionOutcome): void;
}

const PROCESS_STEPS: IngestionMode['steps'] = [
  { key: 'segmentation', label: 'Removing background' },
  { key: 'color', label: 'Extracting colours (K-Means)' },
];

const EMBED_STEP = { key: 'embedding', label: 'Computing style vector (MobileCLIP)' } as const;

/** Opens the add-photo flow on top of the garment's page, so leaving it lands there. */
export function openAddPhotos(garmentId: string, fromGarmentPage: boolean) {
  if (!fromGarmentPage) router.push({ pathname: '/garment/[id]', params: { id: garmentId } });
  router.push({ pathname: '/add-photo/[id]', params: { id: garmentId } });
}

/** Digital Closet: keep the cutout, its colour and its style vector, then sync. */
export function createClosetMode(deps: { closet: ClosetRepository; sync: CloudSync }): IngestionMode {
  return {
    requiredModels: ['segmentation', 'embedding'],
    embed: true,
    steps: [...PROCESS_STEPS, EMBED_STEP, { key: 'saving', label: 'Saving to closet' }],
    copy: {
      captureHint: 'Lay the garment flat or hang it against a plain background',
      doneTitle: 'Added to your closet',
      againLabel: 'Add another garment',
      exitLabel: 'View in closet',
    },
    asksCategory: true,
    async complete(result, onStep) {
      onStep('saving');
      const garment = await deps.closet.add(result);
      deps.sync.syncAll().catch(() => {}); // upload in the background; retried later if offline
      return { previewUri: garment.imageUri, match: null, garment };
    },
    discard() {},
    exit() {
      router.navigate('/');
    },
    addPhotos(outcome) {
      if (outcome.garment) openAddPhotos(outcome.garment.id, false);
    },
  };
}

/**
 * Another photo of a garment already in the closet: a different side, the back, or other
 * light. Its colour and style vector are fused with the garment's other photos.
 */
export function createAddPhotoMode(deps: { photos: GarmentPhotos; sync: CloudSync; garmentId: string }): IngestionMode {
  return {
    requiredModels: ['segmentation', 'embedding'],
    embed: true,
    steps: [...PROCESS_STEPS, EMBED_STEP, { key: 'saving', label: 'Combining with the other photos' }],
    copy: {
      captureHint: 'Same garment, another angle: the back, a detail, or different light',
      doneTitle: 'Photo added',
      againLabel: 'Add another photo',
      exitLabel: 'Done',
    },
    asksCategory: false,
    async complete(result, onStep) {
      onStep('saving');
      const { garment, photo } = await deps.photos.addPhoto(deps.garmentId, result);
      deps.sync.syncAll().catch(() => {});
      return { previewUri: photo.imageUri, match: null, garment };
    },
    discard() {},
    exit() {
      router.back();
    },
  };
}

/**
 * In-store assistant: cut out the garment on the rack, read its colour, pattern, cut and
 * style vector, and compare it with the wearer and the closet. Nothing is saved unless the
 * user says they bought it.
 */
export function createShopMode(deps: { wearer: Wearer }): IngestionMode {
  let preview: string | null = null;
  const discard = () => {
    if (preview) deleteFile(preview);
    preview = null;
  };
  return {
    requiredModels: ['segmentation', 'embedding'],
    embed: true,
    steps: [...PROCESS_STEPS, { key: 'embedding', label: 'Comparing with your closet' }],
    copy: {
      captureHint: 'Point at a garment on the rack: fill the frame, plain background behind it if you can',
      doneTitle: 'In-store match',
      againLabel: 'Scan another',
    },
    asksCategory: false,
    async complete(result) {
      discard();
      preview = writeCacheFile(`shop-${Date.now()}.png`, result.png);
      const match = scoreForWearer(result.colorHex, deps.wearer);
      return { previewUri: preview, match, garment: null };
    },
    discard,
    exit() {},
  };
}

export type ModeKey = 'closet' | 'shop' | 'add-photo';

/**
 * Builds the strategy for a route from app services and releases it on unmount.
 * `garmentId` is the garment that 'add-photo' attaches photos to.
 */
export function useIngestionMode(key: ModeKey, garmentId?: string): IngestionMode {
  const { closet, photos, sync } = useServices();
  const wearer = useWearer();
  const mode = useMemo(() => {
    switch (key) {
      case 'closet':
        return createClosetMode({ closet, sync });
      case 'shop':
        return createShopMode({ wearer });
      case 'add-photo':
        if (!garmentId) throw new Error('add-photo needs a garment id');
        return createAddPhotoMode({ photos, sync, garmentId });
    }
  }, [key, garmentId, closet, photos, sync, wearer]);
  useEffect(() => () => mode.discard(), [mode]);
  return mode;
}
