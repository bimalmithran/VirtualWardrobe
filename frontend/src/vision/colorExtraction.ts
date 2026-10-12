import type { RGBAImage } from '../image/pixels';
import { labToRgb, rgbToHex, rgbToLab, type Lab } from './color';

export interface PaletteEntry {
  hex: string;
  share: number; // fraction of garment pixels in this cluster
}

const K = 5;
const MAX_SAMPLES = 4000;
const ITERATIONS = 12;
/** Ignore the soft mask fringe, where background colour bleeds into the garment. */
const MIN_ALPHA = 200;
/**
 * Clusters closer than this (CIE76 ΔE) are the same colour under different shading.
 * Without merging, one large solid colour gets split across several clusters and a
 * smaller accent colour can win "primary".
 */
const MERGE_DELTA_E = 12;

/** K-Means (k-means++ init) over garment pixels in CIELAB. Returns clusters by size. */
export function extractPalette(cutout: RGBAImage): PaletteEntry[] {
  const samples = sampleForeground(cutout);
  if (samples.length === 0) return [];
  const k = Math.min(K, samples.length);
  const rand = mulberry32(42); // deterministic: the same photo yields the same hex

  const centroids: Lab[] = [samples[Math.floor(rand() * samples.length)]];
  const dist = new Float64Array(samples.length);
  while (centroids.length < k) {
    let total = 0;
    for (let i = 0; i < samples.length; i++) {
      dist[i] = Math.min(...centroids.map((c) => d2(samples[i], c)));
      total += dist[i];
    }
    let r = rand() * total;
    let pick = 0;
    while (pick < samples.length - 1 && (r -= dist[pick]) > 0) pick++;
    centroids.push([...samples[pick]] as Lab);
  }

  const assign = new Int32Array(samples.length);
  for (let it = 0; it < ITERATIONS; it++) {
    let moved = 0;
    for (let i = 0; i < samples.length; i++) {
      let best = 0, bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const d = d2(samples[i], centroids[c]);
        if (d < bestD) { bestD = d; best = c; }
      }
      if (assign[i] !== best) { assign[i] = best; moved++; }
    }
    const sums = Array.from({ length: k }, () => [0, 0, 0, 0]);
    for (let i = 0; i < samples.length; i++) {
      const s = sums[assign[i]];
      s[0] += samples[i][0]; s[1] += samples[i][1]; s[2] += samples[i][2]; s[3]++;
    }
    sums.forEach((s, c) => { if (s[3]) centroids[c] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
    if (it > 0 && moved === 0) break;
  }

  const counts = new Array(k).fill(0);
  for (let i = 0; i < samples.length; i++) counts[assign[i]]++;

  const merged: { lab: Lab; n: number }[] = [];
  for (const c of centroids.map((lab, i) => ({ lab, n: counts[i] })).sort((a, b) => b.n - a.n)) {
    if (c.n === 0) continue;
    const into = merged.find((m) => d2(m.lab, c.lab) < MERGE_DELTA_E ** 2);
    if (!into) {
      merged.push({ lab: [...c.lab] as Lab, n: c.n });
      continue;
    }
    const n = into.n + c.n;
    into.lab = [0, 1, 2].map((j) => (into.lab[j] * into.n + c.lab[j] * c.n) / n) as Lab;
    into.n = n;
  }

  return merged
    .sort((a, b) => b.n - a.n)
    .map((m) => ({ hex: rgbToHex(labToRgb(m.lab)), share: m.n / samples.length }));
}

function sampleForeground(img: RGBAImage): Lab[] {
  const { data } = img;
  const total = img.width * img.height;
  let fg = 0;
  for (let i = 0; i < total; i++) if (data[i * 4 + 3] >= MIN_ALPHA) fg++;
  const stride = Math.max(1, Math.floor(fg / MAX_SAMPLES));
  const out: Lab[] = [];
  let seen = 0;
  for (let i = 0; i < total; i++) {
    const o = i * 4;
    if (data[o + 3] < MIN_ALPHA) continue;
    if (seen++ % stride === 0) out.push(rgbToLab(data[o], data[o + 1], data[o + 2]));
  }
  return out;
}

const d2 = (a: Lab, b: Lab) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
