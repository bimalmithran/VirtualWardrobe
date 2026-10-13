import type { ContrastLevel, Depth, LabColor, PersonalColouring, Season, SelfReading, Undertone } from '../domain/types';
import type { RGBAImage } from '../image/pixels';
import { SUB_SEASONS, subSeasonFor } from '../style/seasons';
import { labToRgb, rgbToHex, rgbToLab } from './color';

/** Ignore the soft mask fringe, where background colour bleeds into the person. */
const MIN_ALPHA = 200;
const MAX_SKIN_SAMPLES = 6000;
/** Too little skin and the reading is mostly noise (e.g. a photo from behind). */
const MIN_SKIN_PIXELS = 300;
const MIN_SKIN_SHARE = 0.01;
/** The head is in the top part of the person's bounding box, in selfies and full-body shots alike. */
const HEAD_FRACTION = 0.3;
const MIN_HAIR_PIXELS = 150;

/**
 * Classic YCbCr skin rule (Chai & Ngan), which holds across skin tones because it ignores
 * luma. Very dark and blown-out pixels are dropped: their chroma is unreliable.
 */
export function isSkin(r: number, g: number, b: number): boolean {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return y > 35 && y < 245 && cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173;
}

/**
 * Reads skin colour and hair darkness from a background-removed photo of the user.
 * Returns null when too little skin is visible to say anything.
 */
export function readSelf(cutout: RGBAImage): SelfReading | null {
  const { width, height, data } = cutout;
  let top = height, bottom = -1, fg = 0, skinCount = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (data[o + 3] < MIN_ALPHA) continue;
      fg++;
      if (y < top) top = y;
      bottom = y;
      if (isSkin(data[o], data[o + 1], data[o + 2])) skinCount++;
    }
  }
  if (skinCount < MIN_SKIN_PIXELS || skinCount < fg * MIN_SKIN_SHARE) return null;

  const headEnd = top + (bottom - top + 1) * HEAD_FRACTION;
  const stride = Math.max(1, Math.floor(skinCount / MAX_SKIN_SAMPLES));
  const L: number[] = [], A: number[] = [], B: number[] = [], hair: number[] = [];
  let seen = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (data[o + 3] < MIN_ALPHA) continue;
      const r = data[o], g = data[o + 1], b = data[o + 2];
      if (isSkin(r, g, b)) {
        if (seen++ % stride === 0) {
          const lab = rgbToLab(r, g, b);
          L.push(lab[0]);
          A.push(lab[1]);
          B.push(lab[2]);
        }
      } else if (y < headEnd) {
        hair.push(rgbToLab(r, g, b)[0]);
      }
    }
  }
  return {
    // Per-channel median: lips, shadows and highlights fall in the tails.
    skin: [median(L), median(A), median(B)],
    hairL: hair.length >= MIN_HAIR_PIXELS ? percentile(hair, 0.25) : null,
  };
}

/** Individual Typology Angle (ITA°), the dermatology scale for skin lightness. */
export function ita([L, , b]: LabColor): number {
  return (Math.atan2(L - 50, b) * 180) / Math.PI;
}

/**
 * How far the skin's CIELAB hue angle sits from what is typical at its depth. Yellower (warm)
 * skin sits above, pinker (cool) skin below. Hue falls naturally as skin gets deeper, so a
 * fixed threshold would call most deep skin "cool"; the expected hue follows ITA instead.
 */
export function hueOffset(skin: LabColor): number {
  const h = (Math.atan2(skin[2], skin[1]) * 180) / Math.PI;
  return h - (50 + 0.15 * ita(skin));
}

/**
 * A heuristic, and phone white balance shifts it, so the app offers the result for the user
 * to confirm rather than applying it.
 */
export function skinUndertone(skin: LabColor): Undertone {
  const offset = hueOffset(skin);
  if (offset < -5) return 'cool';
  if (offset > 5) return 'warm';
  return 'neutral';
}

export function skinDepth(skin: LabColor): Depth {
  const angle = ita(skin);
  if (angle > 41) return 'light';
  if (angle > -10) return 'medium';
  return 'deep';
}

/** How strongly hair stands out against skin; drives how much contrast an outfit can carry. */
export function contrastLevel(skinL: number, hairL: number | null): ContrastLevel {
  if (hairL === null) return 'medium';
  const gap = skinL - hairL;
  if (gap >= 40) return 'high';
  if (gap <= 20) return 'low';
  return 'medium';
}

/**
 * Four-season colour analysis: undertone picks warm (spring/autumn) or cool (summer/winter);
 * depth and contrast pick bright and light (spring/summer) or deep and strong (autumn/winter).
 */
export function seasonFor(undertone: Undertone, depth: Depth, contrast: ContrastLevel, skin: LabColor): Season {
  const warm = undertone === 'warm' || (undertone === 'neutral' && hueOffset(skin) >= 0);
  const strong = depth === 'deep' || (depth === 'medium' && contrast === 'high');
  if (warm) return strong ? 'autumn' : 'spring';
  return strong ? 'winter' : 'summer';
}

export const SEASON_PALETTES: Record<Season, string[]> = {
  spring: ['#FF7F50', '#F4C430', '#30D5C8', '#6BA539', '#FFB07C', '#C19A6B', '#3B6FB6', '#FFFFF0'],
  summer: ['#9DB4D3', '#B9A9D9', '#3C4E78', '#B784A7', '#8E9BDA', '#708090', '#D8A1C4', '#F5F5F5'],
  autumn: ['#B7410E', '#D4A017', '#708238', '#E2725B', '#367588', '#5C3317', '#C19A6B', '#FFFDD0'],
  winter: ['#1B2A4A', '#C8102E', '#2741A8', '#009B77', '#C3216F', '#000000', '#FFFFFF', '#D6DCE4'],
};

export const SEASON_LABELS: Record<Season, string> = {
  spring: 'Spring: warm, light and clear',
  summer: 'Summer: cool, soft and light',
  autumn: 'Autumn: warm, rich and muted',
  winter: 'Winter: cool, deep and high-contrast',
};

/** Combines every photo's reading; medians keep one oddly lit photo from dominating. */
export function fuseColouring(readings: SelfReading[]): PersonalColouring | null {
  if (readings.length === 0) return null;
  const skin: LabColor = [0, 1, 2].map((i) => median(readings.map((r) => r.skin[i]))) as LabColor;
  const hairs = readings.map((r) => r.hairL).filter((h): h is number => h !== null);
  const undertone = skinUndertone(skin);
  const depth = skinDepth(skin);
  const contrast = contrastLevel(skin[0], hairs.length ? median(hairs) : null);
  const season = seasonFor(undertone, depth, contrast, skin);
  const subSeason = subSeasonFor(season, depth, contrast);
  return {
    skinHex: rgbToHex(labToRgb(skin)),
    undertone,
    depth,
    contrast,
    season,
    subSeason,
    source: 'photos',
    palette: SUB_SEASONS[subSeason].palette,
    photoCount: readings.length,
  };
}

function median(v: number[]) {
  return percentile(v, 0.5);
}

function percentile(v: number[], p: number) {
  const s = [...v].sort((x, y) => x - y);
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}
