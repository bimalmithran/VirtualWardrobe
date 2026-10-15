import type { RGBAImage } from '../image/pixels';
import { squaredDistanceTo } from './hangerRemoval';

/** Pieces smaller than this share of the largest are debris (a lamp, a patch of wall). */
const MIN_PIECE_SHARE = 0.02;
/** Faint alpha further than this share of the longest side from what is kept is haze. */
const HALO_FRACTION = 0.01;
const MIN_HALO_PX = 2;
/** Enclosed gaps smaller than this share of the frame are pinholes, filled back in. */
const MAX_HOLE_SHARE = 0.002;

/**
 * Tidies a saliency cutout. The model keeps stray blobs of background (furniture, shadows)
 * and leaves a faint haze of low alpha across the rest of the frame; both show up once the
 * cutout is drawn on another background, as in try-on. Pieces well below the size of the
 * largest are dropped, alpha away from the kept pieces is cleared, and pinholes the model
 * punched into flat fabric are filled. Several large pieces (a pair of shoes) are all kept,
 * real openings (the gap between an arm and the body) stay open, and the soft edge around
 * the kept pieces (hair) is untouched.
 *
 * Returns the input itself when there is nothing to clear.
 */
export function cleanCutout(img: RGBAImage): RGBAImage {
  const { width: w, height: h, data } = img;
  const n = w * h;
  const fg = new Uint8Array(n);
  for (let i = 0; i < n; i++) fg[i] = data[i * 4 + 3] > 127 ? 1 : 0;

  // Label 4-connected pieces and size them.
  const label = new Int32Array(n);
  const sizes = [0];
  const queue = new Int32Array(n);
  for (let start = 0; start < n; start++) {
    if (!fg[start] || label[start]) continue;
    const id = sizes.length;
    let head = 0, tail = 0;
    queue[tail++] = start;
    label[start] = id;
    while (head < tail) {
      const i = queue[head++];
      const y = (i / w) | 0, x = i - y * w;
      if (x > 0) tail = push(i - 1, tail);
      if (x < w - 1) tail = push(i + 1, tail);
      if (y > 0) tail = push(i - w, tail);
      if (y < h - 1) tail = push(i + w, tail);
    }
    sizes.push(tail);
    function push(j: number, t: number) {
      if (fg[j] && !label[j]) {
        label[j] = id;
        queue[t++] = j;
      }
      return t;
    }
  }
  if (sizes.length === 1) return img;

  const largest = Math.max(...sizes);
  const keep = new Uint8Array(n);
  for (let i = 0; i < n; i++) keep[i] = fg[i] && sizes[label[i]] >= largest * MIN_PIECE_SHARE ? 1 : 0;

  // Pinholes: background pieces that don't reach the frame's edge and are small.
  const holes = enclosedSmallGaps(keep, w, h, label, queue, n * MAX_HOLE_SHARE);

  const halo = Math.max(MIN_HALO_PX, Math.round(Math.max(w, h) * HALO_FRACTION));
  const toKeep = squaredDistanceTo(keep, 1, w, h);
  let out: Uint8Array | null = null;
  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3];
    if (holes[i] && a < 255) {
      out ??= new Uint8Array(data);
      out[i * 4 + 3] = 255;
      continue;
    }
    if (a === 0 || keep[i] || (!fg[i] && toKeep[i] <= halo * halo)) continue;
    out ??= new Uint8Array(data);
    out[i * 4 + 3] = 0;
  }
  return out ? { width: w, height: h, data: out } : img;
}

/** Marks gaps in `keep` that are enclosed (don't touch the frame) and under `maxSize` pixels. */
function enclosedSmallGaps(keep: Uint8Array, w: number, h: number, label: Int32Array, queue: Int32Array, maxSize: number) {
  const n = w * h;
  const holes = new Uint8Array(n);
  label.fill(0);
  for (let start = 0; start < n; start++) {
    if (keep[start] || label[start]) continue;
    let head = 0, tail = 0, open = false;
    queue[tail++] = start;
    label[start] = 1;
    while (head < tail) {
      const i = queue[head++];
      const y = (i / w) | 0, x = i - y * w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) open = true;
      if (x > 0) tail = push(i - 1, tail);
      if (x < w - 1) tail = push(i + 1, tail);
      if (y > 0) tail = push(i - w, tail);
      if (y < h - 1) tail = push(i + w, tail);
    }
    if (!open && tail <= maxSize) for (let k = 0; k < tail; k++) holes[queue[k]] = 1;
  }
  return holes;

  function push(j: number, t: number) {
    if (!keep[j] && !label[j]) {
      label[j] = 1;
      queue[t++] = j;
    }
    return t;
  }
}
