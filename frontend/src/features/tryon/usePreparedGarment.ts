import { useEffect, useState } from 'react';

import type { Category } from '../../domain/types';
import { decodeToRGBA, encodePNG } from '../../image/pixels';
import { readBytes, writeCacheFile } from '../../platform/files';
import type { GarmentSize } from '../../style/tryOn';
import { anchorWidth, tightCrop } from '../../vision/garmentShape';
import { removeHanger } from '../../vision/hangerRemoval';

export interface PreparedGarment extends GarmentSize {
  uri: string;
}

// Per stored cutout, for this session: switching photos or modes doesn't redo the work.
const prepared = new Map<string, Promise<PreparedGarment>>();

/**
 * The garment cutout as try-on draws it: without a hanger (cutouts saved before hanger
 * removal still have one, and it would sit on the wearer's neck), tightly cropped, and
 * measured where it meets the body. The stored cutout itself is left as it is.
 */
async function prepare(uri: string, category: Category | null): Promise<PreparedGarment> {
  const decoded = decodeToRGBA(await readBytes(uri));
  const img = tightCrop(removeHanger(decoded).image);
  const at = category === 'bottoms' ? 'waist' : 'chest';
  const out = img === decoded ? uri : writeCacheFile(`tryon-${hash(uri)}.png`, encodePNG(img));
  return { uri: out, width: img.width, height: img.height, anchorWidth: anchorWidth(img, at) };
}

/** Null while preparing. If preparation fails, the original cutout is used unmeasured. */
export function usePreparedGarment(uri: string, category: Category | null): PreparedGarment | null {
  const [result, setResult] = useState<{ key: string; garment: PreparedGarment } | null>(null);
  const key = `${uri}|${category ?? ''}`;
  useEffect(() => {
    let cancelled = false;
    let job = prepared.get(key);
    if (!job) {
      job = prepare(uri, category).catch(() => ({ uri, width: 0, height: 0, anchorWidth: null }));
      prepared.set(key, job);
    }
    job.then((garment) => !cancelled && setResult({ key, garment }));
    return () => {
      cancelled = true;
    };
  }, [key, uri, category]);
  return result?.key === key ? result.garment : null;
}

/** Short stable name for a cache file. */
function hash(s: string) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
