import { useCallback, useEffect, useRef, useState } from 'react';

import type { RGBAImage } from '../../image/pixels';
import { errorMessage } from '../../lib/errors';
import type { QualityReport } from '../../vision/junkFilter';
import type { GarmentPipeline, Photo, ProcessedGarment } from '../../vision/pipeline';
import type { IngestionMode, IngestionOutcome, StepKey } from './modes';

/** One photo of a multi-photo pick, once it has been tried. */
export type BatchItem =
  | { photo: Photo; status: 'added'; outcome: IngestionOutcome }
  | { photo: Photo; status: 'skipped' | 'failed'; reason: string };

export type BatchStep = StepKey | 'inspecting';

export type IngestionState =
  | { kind: 'capture' }
  | { kind: 'inspecting' }
  | { kind: 'junk'; photo: Photo; quality: QualityReport }
  | { kind: 'processing'; step: StepKey }
  | { kind: 'done'; result: ProcessedGarment; outcome: IngestionOutcome }
  | { kind: 'error'; message: string }
  | { kind: 'batch'; index: number; total: number; step: BatchStep; items: BatchItem[] }
  | { kind: 'batchDone'; items: BatchItem[] };

/**
 * The capture → junk check → process → result state machine, independent of any view.
 * Mode-specific work is delegated to the IngestionMode strategy.
 */
export function useIngestion(mode: IngestionMode, pipeline: GarmentPipeline) {
  const [state, setState] = useState<IngestionState>({ kind: 'capture' });

  // The working image (~4 MB) lives in a ref, not state, so React doesn't retain it and it
  // can be dropped the moment processing finishes.
  const working = useRef<RGBAImage | null>(null);
  // Bumped on reset/unmount so late results from an abandoned run are ignored.
  const generation = useRef(0);

  useEffect(
    () => () => {
      generation.current++;
      working.current = null;
    },
    [],
  );

  const reset = useCallback(() => {
    generation.current++;
    working.current = null;
    mode.discard();
    setState({ kind: 'capture' });
  }, [mode]);

  const process = useCallback(
    async (photo: Photo) => {
      const gen = generation.current;
      const live = () => gen === generation.current;
      const img = working.current;
      if (!img) return;
      try {
        setState({ kind: 'processing', step: 'segmentation' });
        const result = await pipeline.process(photo, img, {
          embed: mode.embed,
          onStage: (step) => live() && setState({ kind: 'processing', step }),
        });
        working.current = null;
        if (!live()) return;
        const outcome = await mode.complete(result, (step) => live() && setState({ kind: 'processing', step }));
        if (live()) setState({ kind: 'done', result, outcome });
      } catch (e) {
        working.current = null;
        if (live()) setState({ kind: 'error', message: errorMessage(e) });
      }
    },
    [mode, pipeline],
  );

  const capture = useCallback(
    async (photo: Photo) => {
      const gen = generation.current;
      setState({ kind: 'inspecting' });
      try {
        const { working: img, quality } = await pipeline.inspect(photo);
        if (gen !== generation.current) return;
        working.current = img;
        if (quality.issues.length > 0) setState({ kind: 'junk', photo, quality });
        else await process(photo);
      } catch (e) {
        if (gen === generation.current) setState({ kind: 'error', message: errorMessage(e) });
      }
    },
    [pipeline, process],
  );

  /**
   * Several gallery photos picked at once. They run strictly one after another, each
   * dropping its working image before the next is decoded, so memory stays at one photo's
   * worth however many are picked. A photo that fails the quality check is skipped, not
   * asked about, so a long batch never stalls; `force` re-runs skipped ones regardless.
   * `kept` carries earlier results over so the summary still lists them.
   */
  const captureMany = useCallback(
    async (photos: Photo[], { force = false, kept = [] as BatchItem[] } = {}) => {
      if (photos.length === 1 && !force && kept.length === 0) return capture(photos[0]);
      const gen = generation.current;
      const live = () => gen === generation.current;
      const items = [...kept];
      for (let index = 0; index < photos.length; index++) {
        if (!live()) return;
        const photo = photos[index];
        const at = (step: BatchStep) => live() && setState({ kind: 'batch', index, total: photos.length, step, items: [...items] });
        try {
          at('inspecting');
          const { working: img, quality } = await pipeline.inspect(photo);
          if (!force && quality.issues.length > 0) {
            items.push({ photo, status: 'skipped', reason: quality.headline ?? quality.issues[0] });
            continue;
          }
          const result = await pipeline.process(photo, img, { embed: mode.embed, onStage: at });
          if (!live()) return;
          const outcome = await mode.complete(result, at);
          items.push({ photo, status: 'added', outcome });
        } catch (e) {
          items.push({ photo, status: 'failed', reason: errorMessage(e) });
        }
      }
      if (live()) setState({ kind: 'batchDone', items });
    },
    [capture, mode, pipeline],
  );

  return { state, capture, captureMany, processAnyway: process, reset };
}
