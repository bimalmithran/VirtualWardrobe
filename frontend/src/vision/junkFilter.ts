import type { RGBAImage } from '../image/pixels';

export interface QualityReport {
  brightness: number; // mean luma, 0..255
  contrast: number; // luma std-dev
  sharpness: number; // variance of the Laplacian
  /** Share of pixels crushed to black / blown to white (histogram tails). */
  shadowClip: number;
  highlightClip: number;
  issues: string[];
  /** The most important problem in a few words, for live on-screen feedback; null when fine. */
  headline: string | null;
}

// Tuned for a ~256 px analysis image. Sharp phone photos of fabric typically score
// sharpness in the hundreds; motion blur drops it below ~40.
export const MIN_BRIGHTNESS = 45;
export const MAX_BRIGHTNESS = 235;
const MIN_CONTRAST = 18;
const MIN_SHARPNESS = 40;
/** Histogram tails: luma <= 12 is crushed shadow, >= 248 is blown highlight. */
const SHADOW = 12;
const HIGHLIGHT = 248;
const MAX_SHADOW_CLIP = 0.35;
const MAX_HIGHLIGHT_CLIP = 0.2;
const ANALYSIS_SIDE = 256;

/** Cheap pre-flight check so we don't spend seconds of NPU/CPU time on a junk photo. */
export function assessQuality(img: RGBAImage): QualityReport {
  const { gray, w, h } = toSmallGray(img, ANALYSIS_SIDE);

  let sum = 0;
  for (let i = 0; i < gray.length; i++) sum += gray[i];
  const brightness = sum / gray.length;

  let sq = 0;
  let dark = 0;
  let blown = 0;
  for (let i = 0; i < gray.length; i++) {
    sq += (gray[i] - brightness) ** 2;
    if (gray[i] <= SHADOW) dark++;
    else if (gray[i] >= HIGHLIGHT) blown++;
  }
  const contrast = Math.sqrt(sq / gray.length);
  const shadowClip = dark / gray.length;
  const highlightClip = blown / gray.length;

  // 4-neighbour Laplacian; its variance collapses when edges are smeared.
  let lapSum = 0, lapSq = 0, n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = gray[i - 1] + gray[i + 1] + gray[i - w] + gray[i + w] - 4 * gray[i];
      lapSum += lap;
      lapSq += lap * lap;
      n++;
    }
  }
  const lapMean = lapSum / n;
  const sharpness = lapSq / n - lapMean * lapMean;

  // Ordered by how badly each spoils the cutout and colour; the first becomes the headline.
  const found: [string, string][] = [];
  if (sharpness < MIN_SHARPNESS) found.push(['Too blurry, hold still', 'Photo looks blurry — hold the phone steady and tap to focus.']);
  if (brightness < MIN_BRIGHTNESS || shadowClip > MAX_SHADOW_CLIP)
    found.push(['Needs more light', 'Photo is too dark — add light or move near a window.']);
  if (brightness > MAX_BRIGHTNESS || highlightClip > MAX_HIGHLIGHT_CLIP)
    found.push(['Too bright, avoid direct light', 'Photo is overexposed — parts are pure white. Avoid direct light on the garment.']);
  if (contrast < MIN_CONTRAST)
    found.push(['Use a plain, contrasting background', 'Very low contrast — place the garment on a plain background that differs from its colour.']);

  return {
    brightness,
    contrast,
    sharpness,
    shadowClip,
    highlightClip,
    issues: found.map(([, long]) => long),
    headline: found[0]?.[0] ?? null,
  };
}

function toSmallGray(img: RGBAImage, maxSide: number) {
  const step = Math.max(1, Math.floor(Math.max(img.width, img.height) / maxSide));
  const w = Math.floor(img.width / step);
  const h = Math.floor(img.height / step);
  const gray = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * step * img.width + x * step) * 4;
      gray[y * w + x] = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
    }
  }
  return { gray, w, h };
}
