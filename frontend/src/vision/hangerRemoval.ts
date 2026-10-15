import type { RGBAImage } from '../image/pixels';
import { rgbToLab, type Lab } from './color';

/**
 * Removes the hanger the segmentation model keeps as part of the garment.
 *
 * Saliency models treat garment + hanger as one object, so the hook (and a wire or plastic
 * hanger's arms where they poke out past the shoulders) survives as a thin stalk on top of the
 * cutout. A morphological opening with a disk (erode, then dilate) deletes every structure
 * thinner than the disk while leaving the garment body intact. Only thin pieces that start in
 * the garment's top band and rise above its body are dropped, so drawstrings, belts, straps
 * and hems further down are kept.
 *
 * The removed hook also gives the hanger's colour. A second pass then removes hanger-coloured
 * parts in the top band that shape alone can't separate: the bar showing through a neckline
 * and arm tips poking out past the shoulders. It is skipped when the hanger is close in colour
 * to the garment (a wooden hanger on a brown kurta), so it never eats into the fabric.
 */

/** Disk radius as a fraction of the garment's longest side: removes structures under ~2.4% wide. */
const RADIUS_FRACTION = 0.012;
const MIN_RADIUS = 3;
/** The top share of the garment's body in which thin pieces count as hanger. */
const TOP_BAND = 0.25;
/** A thin piece is hanger only if it reaches this close to (or above) the body's top edge. */
const TOP_MARGIN = 0.03;
/** If the opening would remove more than this share, the item itself is thin (belt, tie): skip. */
const MAX_REMOVED_SHARE = 0.25;
/** Lab distance under which a pixel counts as hanger-coloured (if also nearer the hanger than the garment). */
const HANGER_DELTA_E = 30;
/** How far (in disk radii) from where the hook was cut the colour pass removes hanger colour. */
const GROW_RADII = 3;
/** The colour pass runs only if hanger and garment differ by at least this much. */
const MIN_CONTRAST = 30;
/** A thin piece is hanger by colour if at least this share of it matches. */
const COLOUR_SHARE = 0.6;
/** Soft alpha within this many pixels of a removed part (and not of the garment) is cleared too. */
const EDGE_PX = 2;

export interface HangerRemovalResult {
  image: RGBAImage;
  /** Share of the foreground removed; 0 when nothing was changed. */
  removedShare: number;
}

export function removeHanger(img: RGBAImage): HangerRemovalResult {
  const { width: w, height: h, data } = img;
  const n = w * h;
  const fg = new Uint8Array(n);
  let fgCount = 0, minX = w, minY = h, maxX = -1, maxY = -1;
  for (let i = 0; i < n; i++) {
    if (data[i * 4 + 3] > 127) {
      fg[i] = 1;
      fgCount++;
      const x = i % w, y = (i / w) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const unchanged = { image: img, removedShare: 0 };
  if (fgCount === 0) return unchanged;

  const r = Math.max(MIN_RADIUS, Math.round(Math.max(maxX - minX + 1, maxY - minY + 1) * RADIUS_FRACTION));
  const r2 = r * r;

  // Opening: erode (pixels further than r from the background), then dilate the result by r.
  const toBg = squaredDistanceTo(fg, 0, w, h);
  const eroded = new Uint8Array(n);
  for (let i = 0; i < n; i++) eroded[i] = fg[i] && toBg[i] > r2 ? 1 : 0;
  const toEroded = squaredDistanceTo(eroded, 1, w, h);
  const body = new Uint8Array(n);
  for (let i = 0; i < n; i++) body[i] = fg[i] && toEroded[i] <= r2 ? 1 : 0;
  keepLargestComponent(body, w, h);

  let bodyCount = 0, bodyTop = h, bodyBottom = -1;
  for (let i = 0; i < n; i++) {
    if (!body[i]) continue;
    bodyCount++;
    const y = (i / w) | 0;
    if (y < bodyTop) bodyTop = y;
    if (y > bodyBottom) bodyBottom = y;
  }
  if (bodyCount === 0 || bodyCount < fgCount * (1 - MAX_REMOVED_SHARE)) return unchanged;

  // Thin pieces: foreground the opening removed. Drop those in the top band that reach the top.
  const bandEnd = bodyTop + (bodyBottom - bodyTop) * TOP_BAND;
  const reachTop = bodyTop + (bodyBottom - bodyTop) * TOP_MARGIN;
  const keep = new Uint8Array(fg);
  const seen = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0, tail = 0;
  for (let start = 0; start < n; start++) {
    if (!fg[start] || body[start] || seen[start]) continue;
    // Flood one thin piece (foreground outside the body), noting its extent.
    head = tail = 0;
    let top = h, bottom = -1;
    queue[tail++] = start;
    seen[start] = 1;
    while (head < tail) {
      const i = queue[head++];
      const y = (i / w) | 0, x = i - y * w;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      if (x > 0) visit(i - 1);
      if (x < w - 1) visit(i + 1);
      if (y > 0) visit(i - w);
      if (y < h - 1) visit(i + w);
    }
    // Tiny pieces are corners the opening rounded off, not hanger: keep them.
    if (tail >= 2 * r2 && top <= reachTop && bottom <= bandEnd) for (let k = 0; k < tail; k++) keep[queue[k]] = 0;
  }
  function visit(j: number) {
    if (fg[j] && !body[j] && !seen[j]) {
      seen[j] = 1;
      queue[tail++] = j;
    }
  }
  removeHangerColoured(data, fg, body, keep, seen, queue, { w, h, r2, bandEnd });
  // Whatever the cut left floating (the hook's far end, specks) goes too.
  keepLargestComponent(keep, w, h);

  let kept = 0;
  for (let i = 0; i < n; i++) kept += keep[i];
  const removed = fgCount - kept;
  if (removed === 0) return unchanged;

  // Clear what was removed and the soft fringe around it; the rest of the outline is untouched.
  const removedMask = new Uint8Array(n);
  for (let i = 0; i < n; i++) removedMask[i] = fg[i] && !keep[i] ? 1 : 0;
  const toRemoved = squaredDistanceTo(removedMask, 1, w, h);
  const toKeep = squaredDistanceTo(keep, 1, w, h);
  const out = new Uint8Array(data);
  const edge2 = EDGE_PX * EDGE_PX;
  for (let i = 0; i < n; i++) {
    const fringe = !fg[i] && toRemoved[i] <= edge2 && toKeep[i] > edge2;
    if (removedMask[i] || fringe) out[i * 4 + 3] = 0;
  }
  return { image: { width: w, height: h, data: out }, removedShare: removed / fgCount };
}

/**
 * The colour pass. `keep` arrives with the hook cleared; pixels it clears here are hanger by
 * colour. `seen` and `queue` are scratch buffers from the shape pass.
 */
function removeHangerColoured(
  data: Uint8Array,
  fg: Uint8Array,
  body: Uint8Array,
  keep: Uint8Array,
  seen: Uint8Array,
  queue: Int32Array,
  { w, h, r2, bandEnd }: { w: number; h: number; r2: number; bandEnd: number },
) {
  const n = w * h;
  const lab = (i: number) => rgbToLab(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  const hook = meanLab(n, (i) => fg[i] === 1 && keep[i] === 0, lab);
  if (!hook || hook.count < 2 * r2) return; // no hook found: nothing to learn the colour from
  const garment = meanLab(n, (i) => body[i] === 1 && i % 7 === 0, lab);
  if (!garment || deltaE(hook.mean, garment.mean) < MIN_CONTRAST) return;
  // Shading darkens parts of the hanger, so compare against both means, not one threshold.
  const isHanger = (i: number) => {
    const c = lab(i);
    const toHook = deltaE(c, hook.mean);
    return toHook < HANGER_DELTA_E && toHook < deltaE(c, garment.mean);
  };
  const bandLimit = Math.min(n, Math.ceil(bandEnd + 1) * w);

  // (a) Thin pieces in the band, mostly hanger-coloured: the arm tips past the shoulders.
  seen.fill(0);
  for (let start = 0; start < bandLimit; start++) {
    if (!keep[start] || body[start] || seen[start]) continue;
    let head = 0, tail = 0, matches = 0, inBand = true;
    queue[tail++] = start;
    seen[start] = 1;
    while (head < tail) {
      const i = queue[head++];
      if (i >= bandLimit) inBand = false;
      if (isHanger(i)) matches++;
      const y = (i / w) | 0, x = i - y * w;
      if (x > 0) tail = visit(i - 1, tail);
      if (x < w - 1) tail = visit(i + 1, tail);
      if (y > 0) tail = visit(i - w, tail);
      if (y < h - 1) tail = visit(i + w, tail);
    }
    if (inBand && matches >= tail * COLOUR_SHARE) for (let k = 0; k < tail; k++) keep[queue[k]] = 0;
  }
  function visit(j: number, tail: number) {
    if (keep[j] && !body[j] && !seen[j]) {
      seen[j] = 1;
      queue[tail++] = j;
    }
    return tail;
  }

  // (b) Hanger-coloured pixels close to the cut: the stubs of the hook's arms resting on the
  // shoulders. Measured as straight-line distance, because a dark outline usually separates
  // them from the cut; bounded, so it can't reach a print of the same colour further down.
  const cut = new Uint8Array(n);
  for (let i = 0; i < bandLimit; i++) cut[i] = fg[i] && !keep[i] ? 1 : 0;
  const toCut = squaredDistanceTo(cut, 1, w, h);
  const reach2 = r2 * GROW_RADII * GROW_RADII;
  for (let i = 0; i < bandLimit; i++) if (keep[i] && toCut[i] <= reach2 && isHanger(i)) keep[i] = 0;
}

function meanLab(n: number, include: (i: number) => boolean, lab: (i: number) => Lab) {
  let L = 0, a = 0, b = 0, count = 0;
  for (let i = 0; i < n; i++) {
    if (!include(i)) continue;
    const [l, aa, bb] = lab(i);
    L += l;
    a += aa;
    b += bb;
    count++;
  }
  return count === 0 ? null : { mean: [L / count, a / count, b / count] as Lab, count };
}

function deltaE(p: Lab, q: Lab) {
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/**
 * Exact squared Euclidean distance from every pixel to the nearest pixel whose mask value is
 * `target` (Felzenszwalb & Huttenlocher, separable, linear time).
 */
export function squaredDistanceTo(mask: Uint8Array, target: 0 | 1, w: number, h: number): Float32Array {
  const INF = 1e20;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] === target ? 0 : INF;
  const len = Math.max(w, h);
  const f = new Float32Array(len), out = new Float32Array(len), z = new Float32Array(len + 1);
  const v = new Int32Array(len);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = d[y * w + x];
    edt1d(f, h, out, v, z);
    for (let y = 0; y < h; y++) d[y * w + x] = out[y];
  }
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) f[x] = d[row + x];
    edt1d(f, w, out, v, z);
    for (let x = 0; x < w; x++) d[row + x] = out[x];
  }
  return d;
}

function edt1d(f: Float32Array, n: number, d: Float32Array, v: Int32Array, z: Float32Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}

/** Clears every 4-connected component of `mask` but the largest, in place. */
export function keepLargestComponent(mask: Uint8Array, w: number, h: number) {
  const n = w * h;
  const label = new Int32Array(n);
  const queue = new Int32Array(n);
  let best = 0, bestSize = 0, next = 0;
  for (let start = 0; start < n; start++) {
    if (!mask[start] || label[start]) continue;
    next++;
    let head = 0, tail = 0;
    queue[tail++] = start;
    label[start] = next;
    while (head < tail) {
      const i = queue[head++];
      const y = (i / w) | 0, x = i - y * w;
      if (x > 0) tail = push(i - 1, tail);
      if (x < w - 1) tail = push(i + 1, tail);
      if (y > 0) tail = push(i - w, tail);
      if (y < h - 1) tail = push(i + w, tail);
    }
    if (tail > bestSize) {
      bestSize = tail;
      best = next;
    }
  }
  for (let i = 0; i < n; i++) if (mask[i] && label[i] !== best) mask[i] = 0;

  function push(j: number, tail: number) {
    if (mask[j] && !label[j]) {
      label[j] = next;
      queue[tail++] = j;
    }
    return tail;
  }
}
