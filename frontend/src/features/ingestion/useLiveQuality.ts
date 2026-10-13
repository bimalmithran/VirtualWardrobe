import { useEffect, useRef, useState, type RefObject } from 'react';
import type { CameraView } from 'expo-camera';
import { File } from 'expo-file-system';

import { loadRGBA } from '../../image/pixels';
import { assessQuality } from '../../vision/junkFilter';

export type LiveQuality = { state: 'checking' } | { state: 'ok' } | { state: 'issue'; headline: string };

const INTERVAL_MS = 1500;
const ANALYSIS_WIDTH = 256;

/**
 * Real-time junk filter. Periodically grabs a tiny, unprocessed frame and runs the same
 * blur and exposure checks the capture flow uses, so the user sees "Too blurry, hold still"
 * before pressing the shutter. Paused while `paused` (a real capture is in flight).
 */
export function useLiveQuality(camera: RefObject<CameraView | null>, active: boolean, paused: boolean): LiveQuality {
  const [quality, setQuality] = useState<LiveQuality>({ state: 'checking' });
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (cancelled) return;
      if (!pausedRef.current && camera.current) {
        try {
          const frame = await camera.current.takePictureAsync({ quality: 0.1, skipProcessing: true, shutterSound: false });
          if (frame && !cancelled && !pausedRef.current) {
            const img = await loadRGBA(frame.uri, { width: ANALYSIS_WIDTH });
            const report = assessQuality(img);
            if (!cancelled) setQuality(report.headline ? { state: 'issue', headline: report.headline } : { state: 'ok' });
          }
          if (frame) {
            const f = new File(frame.uri);
            if (f.exists) f.delete();
          }
        } catch {
          // The camera may be busy (focus, capture); try again next tick.
        }
      }
      if (!cancelled) timer = setTimeout(tick, INTERVAL_MS);
    };
    timer = setTimeout(tick, 800); // let the preview settle first
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [active, camera]);

  return quality;
}
