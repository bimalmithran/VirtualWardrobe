import { useEffect, useMemo } from 'react';
import { File, Paths } from 'expo-file-system';

import type { ModelKey } from '../../config/models';
import type { Undertone } from '../../domain/types';
import { useServices } from '../../services/ServicesProvider';
import type { ClosetRepository } from '../../storage/closetRepository';
import type { CloudSync } from '../../sync/cloudSync';
import type { ProcessedGarment, Stage } from '../../vision/pipeline';
import { scoreUndertoneMatch, type MatchResult } from '../../vision/undertoneMatch';
import { useProfile } from '../profile/ProfileContext';

export type StepKey = Stage | 'saving';

export interface IngestionOutcome {
  previewUri: string;
  match: MatchResult | null;
  /** Set when the garment was saved to the closet. */
  garmentId: string | null;
}

/**
 * Strategy for one capture flow. The shared flow (capture → junk check → pipeline →
 * result) is closed for modification; a new flow is a new IngestionMode.
 */
export interface IngestionMode {
  readonly requiredModels: ModelKey[];
  readonly embed: boolean;
  readonly steps: { key: StepKey; label: string }[];
  readonly copy: { captureHint: string; doneTitle: string; againLabel: string };
  /** Turns a processed garment into a result, persisting it if the mode does that. */
  complete(result: ProcessedGarment, onStep: (step: StepKey) => void): Promise<IngestionOutcome>;
  /** Releases anything the last complete() created that only lives while it is shown. */
  discard(): void;
}

const PROCESS_STEPS: IngestionMode['steps'] = [
  { key: 'segmentation', label: 'Removing background' },
  { key: 'color', label: 'Extracting colours (K-Means)' },
];

/** Digital Closet: keep the cutout, its colour and its style vector, then sync. */
export function createClosetMode(deps: { closet: ClosetRepository; sync: CloudSync }): IngestionMode {
  return {
    requiredModels: ['segmentation', 'embedding'],
    embed: true,
    steps: [
      ...PROCESS_STEPS,
      { key: 'embedding', label: 'Computing style vector (MobileCLIP)' },
      { key: 'saving', label: 'Saving to closet' },
    ],
    copy: {
      captureHint: 'Lay the garment flat or hang it against a plain background',
      doneTitle: 'Added to your closet',
      againLabel: 'Add another',
    },
    async complete(result, onStep) {
      onStep('saving');
      const garment = await deps.closet.add(result);
      deps.sync.syncAll().catch(() => {}); // upload in the background; retried later if offline
      return { previewUri: garment.imageUri, match: null, garmentId: garment.id };
    },
    discard() {},
  };
}

/** In-store AR simulator: score the shirt against the Digital Twin, keep nothing. */
export function createShopMode(deps: { undertone: Undertone | null }): IngestionMode {
  let preview: File | null = null;
  const discard = () => {
    if (preview?.exists) preview.delete();
    preview = null;
  };
  return {
    requiredModels: ['segmentation'],
    embed: false,
    steps: PROCESS_STEPS,
    copy: {
      captureHint: 'Point at a shirt in the store to check it against your undertone',
      doneTitle: 'In-store match',
      againLabel: 'Scan another',
    },
    async complete(result) {
      discard();
      preview = new File(Paths.cache, `shop-${Date.now()}.png`);
      preview.write(result.png);
      const match = deps.undertone ? scoreUndertoneMatch(result.colorHex, deps.undertone) : null;
      return { previewUri: preview.uri, match, garmentId: null };
    },
    discard,
  };
}

export type ModeKey = 'closet' | 'shop';

/** Builds the strategy for a route from app services and releases it on unmount. */
export function useIngestionMode(key: ModeKey): IngestionMode {
  const { closet, sync } = useServices();
  const undertone = useProfile().profile?.undertone ?? null;
  const mode = useMemo(
    () => (key === 'closet' ? createClosetMode({ closet, sync }) : createShopMode({ undertone })),
    [key, closet, sync, undertone],
  );
  useEffect(() => () => mode.discard(), [mode]);
  return mode;
}
