import type { Pattern } from '../domain/types';
import type { RGBAImage } from '../image/pixels';

export interface PatternReading {
  pattern: Pattern;
  /** 0..1; how clearly the evidence pointed one way. */
  confidence: number;
  /** Fraction of interior pixels on an edge. */
  edgeDensity: number;
}

const ANALYSIS_SIDE = 256;
const INTERIOR_ALPHA = 230;
/** Sobel magnitude (on 0..255 grey) that counts as a printed edge rather than a fold. */
const EDGE = 90;
const BINS = 18; // 10° each, orientation modulo 180°

/**
 * Classifies the fabric's pattern from the garment's interior: no edges is solid; edges
 * mostly in one direction are stripes; two perpendicular directions are checks; edges in
 * every direction with several colours are a print; otherwise a texture (knit, denim,
 * embroidery). Heuristic, fast (a 256 px pass), and good enough for tags and matching.
 */
export function detectPattern(cutout: RGBAImage, significantColours: number): PatternReading {
  const step = Math.max(1, Math.ceil(Math.max(cutout.width, cutout.height) / ANALYSIS_SIDE));
  const w = Math.floor(cutout.width / step);
  const h = Math.floor(cutout.height / step);
  const gray = new Float32Array(w * h);
  const inside = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * step * cutout.width + x * step) * 4;
      gray[y * w + x] = 0.299 * cutout.data[i] + 0.587 * cutout.data[i + 1] + 0.114 * cutout.data[i + 2];
      inside[y * w + x] = cutout.data[i + 3] >= INTERIOR_ALPHA ? 1 : 0;
    }
  }

  const hist = new Float64Array(BINS);
  let interior = 0;
  let edges = 0;
  const r = 2; // stay off the silhouette, whose outline is an edge in every garment
  for (let y = r; y < h - r; y++) {
    for (let x = r; x < w - r; x++) {
      const i = y * w + x;
      if (!inside[i] || !inside[i - r] || !inside[i + r] || !inside[i - r * w] || !inside[i + r * w]) continue;
      interior++;
      const gx = gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1] - gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1];
      const gy = gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1] - gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1];
      const mag = Math.hypot(gx, gy);
      if (mag < EDGE) continue;
      edges++;
      let angle = (Math.atan2(gy, gx) * 180) / Math.PI;
      if (angle < 0) angle += 180;
      hist[Math.min(BINS - 1, Math.floor(angle / (180 / BINS)))] += mag;
    }
  }
  if (interior < 200) return { pattern: 'solid', confidence: 0.3, edgeDensity: 0 };

  const edgeDensity = edges / interior;
  if (edgeDensity < 0.03) return { pattern: 'solid', confidence: round(1 - edgeDensity / 0.03), edgeDensity: round(edgeDensity) };

  const total = hist.reduce((a, b) => a + b, 0) || 1;
  const around = (k: number) => (hist[(k + BINS - 1) % BINS] + hist[k] + hist[(k + 1) % BINS]) / total;
  let peak = 0;
  for (let k = 1; k < BINS; k++) if (hist[k] > hist[peak]) peak = k;
  const main = around(peak);
  const orth = around((peak + BINS / 2) % BINS);

  let pattern: Pattern;
  let confidence: number;
  if (main + orth > 0.7 && orth >= 0.2) {
    pattern = 'checked';
    confidence = main + orth;
  } else if (main > 0.5) {
    pattern = 'striped';
    confidence = main;
  } else if (significantColours >= 3 || edgeDensity > 0.15) {
    pattern = 'printed';
    confidence = Math.min(1, 0.5 + edgeDensity);
  } else {
    pattern = 'textured';
    confidence = 0.5;
  }
  return { pattern, confidence: round(confidence), edgeDensity: round(edgeDensity) };
}

const round = (v: number) => Math.round(Math.min(1, v) * 100) / 100;
