import type { RGBAImage } from '../image/pixels';

export interface QualityReport {
  brightness: number; // mean luma, 0..255
  contrast: number; // luma std-dev
  sharpness: number; // variance of the Laplacian
  issues: string[];
}

// Tuned for a ~256 px analysis image. Sharp phone photos of fabric typically score
// sharpness in the hundreds; motion blur drops it below ~40.
const MIN_BRIGHTNESS = 45;
const MAX_BRIGHTNESS = 235;
const MIN_CONTRAST = 18;
const MIN_SHARPNESS = 40;
const ANALYSIS_SIDE = 256;

/** Cheap pre-flight check so we don't spend seconds of NPU/CPU time on a junk photo. */
export function assessQuality(img: RGBAImage): QualityReport {
  const { gray, w, h } = toSmallGray(img, ANALYSIS_SIDE);

  let sum = 0;
  for (let i = 0; i < gray.length; i++) sum += gray[i];
  const brightness = sum / gray.length;

  let sq = 0;
  for (let i = 0; i < gray.length; i++) sq += (gray[i] - brightness) ** 2;
  const contrast = Math.sqrt(sq / gray.length);

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

  const issues: string[] = [];
  if (brightness < MIN_BRIGHTNESS) issues.push('Photo is too dark — add light or move near a window.');
  if (brightness > MAX_BRIGHTNESS) issues.push('Photo is overexposed — avoid direct light on the garment.');
  if (contrast < MIN_CONTRAST) issues.push('Very low contrast — place the garment on a plain background that differs from its colour.');
  if (sharpness < MIN_SHARPNESS) issues.push('Photo looks blurry — hold the phone steady and tap to focus.');

  return { brightness, contrast, sharpness, issues };
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
