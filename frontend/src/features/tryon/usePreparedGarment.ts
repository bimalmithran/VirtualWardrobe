import { useEffect, useState } from 'react';

import type { Category } from '../../domain/types';
import { decodeToRGBA, encodePNG } from '../../image/pixels';
import { readBytes, writeCacheFile } from '../../platform/files';
import type { GarmentSize } from '../../style/tryOn';
import { cleanCutout } from '../../vision/cutoutCleanup';
import { anchorWidth, tightCrop } from '../../vision/garmentShape';
import { removeHanger } from '../../vision/hangerRemoval';

export interface PreparedGarment extends GarmentSize {
  uri: string;
}

/**
 * The garment cutout as try-on draws it: tidied (see cutoutCleanup.ts), without a hanger
 * (cutouts saved before hanger removal still have one, and it would sit on the wearer's
 * neck), tightly cropped, and measured where it meets the body. The stored cutout itself is
 * left as it is.
 */
async function prepare(uri: string, category: Category | null): Promise<PreparedGarment> {
  const decoded = decodeToRGBA(await readBytes(uri));
  const img = tightCrop(removeHanger(cleanCutout(decoded)).image);
  const at = category === 'bottoms' ? 'waist' : 'chest';
  const out = img === decoded ? uri : writeCacheFile(`tryon-${hash(uri)}.png`, encodePNG(img));
  return { uri: out, width: img.width, height: img.height, anchorWidth: anchorWidth(img, at) };
}

/** Null while preparing. If preparation fails, the original cutout is used unmeasured. */
export function usePreparedGarment(uri: string, category: Category | null): PreparedGarment | null {
  return usePrepared(`${uri}|${category ?? ''}`, () =>
    prepare(uri, category).catch(() => ({ uri, width: 0, height: 0, anchorWidth: null })),
  );
}

/**
 * The person's photo with stray background blobs and haze cleared. Photos saved before the
 * background remover tidied its output carry them, and they float around the wearer. Same
 * size as the stored photo, so pose keypoints still line up. Null while preparing.
 */
export function usePreparedPhoto(uri: string | null): string | null {
  return usePrepared(uri ?? '', () => (uri ? cleanPhoto(uri).catch(() => uri) : Promise.resolve(null)));
}

async function cleanPhoto(uri: string): Promise<string> {
  const decoded = decodeToRGBA(await readBytes(uri));
  const img = cleanCutout(decoded);
  return img === decoded ? uri : writeCacheFile(`tryon-person-${hash(uri)}.png`, encodePNG(img));
}

// Per key, for this session: switching photos or modes doesn't redo the work.
const jobs = new Map<string, Promise<unknown>>();

function usePrepared<T>(key: string, start: () => Promise<T>): T | null {
  const [result, setResult] = useState<{ key: string; value: T } | null>(null);
  useEffect(() => {
    let cancelled = false;
    let job = jobs.get(key) as Promise<T> | undefined;
    if (!job) {
      job = start();
      jobs.set(key, job);
    }
    job.then((value) => !cancelled && setResult({ key, value }));
    return () => {
      cancelled = true;
    };
    // `start` is derived from `key`; a new closure each render must not restart the job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return result?.key === key ? result.value : null;
}

/** Short stable name for a cache file. */
function hash(s: string) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
