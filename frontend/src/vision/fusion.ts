import type { AppearanceFuser, PaletteEntry } from '../domain/types';
import { hexToRgb, labToRgb, rgbToHex, rgbToLab, type Lab } from './color';

/** Same cap as a single photo's palette, so fused garments look like any other. */
const MAX_COLOURS = 5;
/**
 * Clusters closer than this (CIE76 ΔE) across photos are one colour seen under different
 * light. A little looser than the within-photo merge, because exposure and white balance
 * shift between shots.
 */
const MERGE_DELTA_E = 15;

/**
 * Pools every photo's palette, each photo weighted equally, and merges clusters that are
 * the same colour. The primary colour is then the one that dominates across all views
 * rather than in one lucky (or badly lit) shot.
 */
export function fusePalettes(palettes: PaletteEntry[][]): PaletteEntry[] {
  const views = palettes.filter((p) => p.length > 0);
  if (views.length === 0) return [];
  const weighted = views
    .flatMap((p) => {
      const total = p.reduce((s, e) => s + e.share, 0) || 1;
      return p.map((e) => ({ lab: rgbToLab(...hexToRgb(e.hex)), w: e.share / total / views.length }));
    })
    .sort((a, b) => b.w - a.w);

  const merged: { lab: Lab; w: number }[] = [];
  for (const c of weighted) {
    const into = merged.find((m) => d2(m.lab, c.lab) < MERGE_DELTA_E ** 2);
    if (!into) {
      merged.push({ lab: [...c.lab] as Lab, w: c.w });
      continue;
    }
    const w = into.w + c.w;
    into.lab = [0, 1, 2].map((j) => (into.lab[j] * into.w + c.lab[j] * c.w) / w) as Lab;
    into.w = w;
  }

  const top = merged.sort((a, b) => b.w - a.w).slice(0, MAX_COLOURS);
  const kept = top.reduce((s, m) => s + m.w, 0) || 1;
  return top.map((m) => ({ hex: rgbToHex(labToRgb(m.lab)), share: m.w / kept }));
}

/**
 * Mean of the unit vectors, re-normalised: the usual way to pool CLIP embeddings of several
 * views. Views without an embedding are skipped.
 */
export function fuseEmbeddings(vectors: (Float32Array | null)[]): Float32Array | null {
  const present = vectors.filter((v): v is Float32Array => v !== null);
  if (present.length === 0) return null;
  const out = new Float32Array(present[0].length);
  for (const v of present) for (let i = 0; i < out.length; i++) out[i] += v[i];
  let n = 0;
  for (let i = 0; i < out.length; i++) n += out[i] * out[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < out.length; i++) out[i] /= n;
  return out;
}

export const fuseViews: AppearanceFuser = (views) => {
  const palette = fusePalettes(views.map((v) => v.palette));
  if (palette.length === 0) throw new Error('None of the photos had a usable colour.');
  return { colorHex: palette[0].hex, palette, embedding: fuseEmbeddings(views.map((v) => v.embedding)) };
};

const d2 = (a: Lab, b: Lab) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
