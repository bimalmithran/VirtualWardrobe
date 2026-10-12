import { useCallback, useEffect, useRef, useState } from 'react';

import type { RGBAImage } from '../../image/pixels';
import { errorMessage } from '../../lib/errors';
import type { QualityReport } from '../../vision/junkFilter';
import type { GarmentPipeline, Photo, ProcessedGarment } from '../../vision/pipeline';
import type { IngestionMode, IngestionOutcome, StepKey } from './modes';

export type IngestionState =
  | { kind: 'capture' }
  | { kind: 'inspecting' }
  | { kind: 'junk'; photo: Photo; quality: QualityReport }
  | { kind: 'processing'; step: StepKey }
  | { kind: 'done'; result: ProcessedGarment; outcome: IngestionOutcome }
  | { kind: 'error'; message: string };

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

  return { state, capture, processAnyway: process, reset };
}
