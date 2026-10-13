import type { RGBAImage } from '../image/pixels';
import type { GarmentShape } from '../domain/types';

const KEEP = 128;

/** Bounding box of the opaque pixels, or null when there are none. */
export function opaqueBounds(img: RGBAImage, minAlpha = KEEP) {
  let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] < minAlpha) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * Crops the cutout to the garment plus a small margin, so the stored PNG is "tight": no
 * acres of transparent pixels, and thumbnails show the garment large.
 */
export function tightCrop(img: RGBAImage, marginFrac = 0.04): RGBAImage {
  const b = opaqueBounds(img);
  if (!b) return img;
  const m = Math.round(Math.max(b.w, b.h) * marginFrac);
  const x = Math.max(0, b.x - m);
  const y = Math.max(0, b.y - m);
  const w = Math.min(img.width, b.x + b.w + m) - x;
  const h = Math.min(img.height, b.y + b.h + m) - y;
  if (w === img.width && h === img.height) return img;
  const out = new Uint8Array(w * h * 4);
  for (let row = 0; row < h; row++) {
    const start = ((y + row) * img.width + x) * 4;
    out.set(img.data.subarray(start, start + w * 4), row * w * 4);
  }
  return { width: w, height: h, data: out };
}

/**
 * Silhouette geometry from the mask: how long the garment is relative to its width, how
 * it widens or narrows toward the hem, and how much of its box it fills (a boxy tee fills
 * most of it; a flared lehenga or an A-line kurta much less near the top).
 */
export function measureShape(img: RGBAImage): GarmentShape | null {
  const b = opaqueBounds(img);
  if (!b || b.w < 4 || b.h < 4) return null;
  const rowWidth = (frac: number) => {
    const y = b.y + Math.min(b.h - 1, Math.floor(b.h * frac));
    let n = 0;
    for (let x = b.x; x < b.x + b.w; x++) if (img.data[(y * img.width + x) * 4 + 3] >= KEEP) n++;
    return n;
  };
  let filled = 0;
  for (let y = b.y; y < b.y + b.h; y++) {
    for (let x = b.x; x < b.x + b.w; x++) if (img.data[(y * img.width + x) * 4 + 3] >= KEEP) filled++;
  }
  const upper = Math.max(1, rowWidth(0.3));
  const waist = rowWidth(0.55);
  const hem = rowWidth(0.92);
  const round = (v: number) => Math.round(v * 100) / 100;
  return {
    aspect: round(b.h / b.w),
    taper: round(hem / upper),
    waistDefinition: round(1 - waist / Math.max(upper, hem, 1)),
    fill: round(filled / (b.w * b.h)),
  };
}
