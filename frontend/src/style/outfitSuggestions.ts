import type { Category, Garment, Undertone } from '../domain/types';
import { hexToRgb, labToLch, rgbToLab } from '../vision/color';
import { scoreUndertoneMatch } from '../vision/undertoneMatch';

/**
 * Outfit scoring and suggestions from colour alone: the phone already knows every
 * garment's primary colour, category and the wearer's undertone, so this needs no model.
 */

export interface OutfitScore {
  /** 0..100 */
  score: number;
  /** Colour harmony across the pieces, 0..100. */
  harmony: number;
  /** Undertone match of the pieces worn near the face, 0..100; null without a profile. */
  undertone: number | null;
  notes: string[];
}

export interface Suggestion {
  garments: Garment[];
  score: OutfitScore;
}

const NEUTRAL_CHROMA = 12;
const DAY = 24 * 60 * 60 * 1000;

const lch = (hex: string) => labToLch(rgbToLab(...hexToRgb(hex)));

/** Harmony of two colours in 0..1, from hue angle, chroma and lightness contrast. */
export function pairHarmony(a: string, b: string): number {
  const x = lch(a);
  const y = lch(b);
  const contrast = Math.min(1, Math.abs(x.L - y.L) / 40); // light/dark separation reads as intentional
  if (x.C < NEUTRAL_CHROMA || y.C < NEUTRAL_CHROMA) return 0.8 + 0.2 * contrast; // neutrals go with anything

  const d = Math.abs(x.h - y.h) % 360;
  const hueGap = d > 180 ? 360 - d : d;
  let base: number;
  if (hueGap < 30) base = 0.8; // analogous / tonal
  else if (hueGap >= 150) base = 0.72; // complementary
  else if (hueGap >= 105 && hueGap <= 135) base = 0.6; // triadic
  else base = 0.38; // in-between angles tend to clash
  if (x.C > 45 && y.C > 45 && hueGap >= 30) base -= 0.15; // two loud, different colours compete
  return Math.max(0, Math.min(1, base + 0.15 * contrast));
}

/** Pieces worn near the face are the ones whose colour affects how skin reads. */
const NEAR_FACE: (Category | null)[] = ['tops', 'outerwear', null];

export function scoreOutfit(garments: Garment[], undertone: Undertone | null, now = Date.now()): OutfitScore {
  const notes: string[] = [];
  if (garments.length === 0) return { score: 0, harmony: 0, undertone: null, notes };

  let pairs = 0;
  let total = 0;
  let worst = 1;
  for (let i = 0; i < garments.length; i++) {
    for (let j = i + 1; j < garments.length; j++) {
      const h = pairHarmony(garments[i].colorHex, garments[j].colorHex);
      total += h;
      worst = Math.min(worst, h);
      pairs++;
    }
  }
  const harmony = pairs === 0 ? 1 : 0.7 * (total / pairs) + 0.3 * worst; // one clash spoils an outfit

  const loud = garments.filter((g) => lch(g.colorHex).C >= NEUTRAL_CHROMA).length;
  if (loud === 0) notes.push('All neutrals: easy to wear, add an accessory for a pop of colour.');
  else if (loud > 2) notes.push(`${loud} bold colours: consider swapping one for a neutral.`);
  if (worst < 0.45) notes.push('Two of these colours clash.');
  else if (harmony > 0.8) notes.push('The colours work well together.');

  const face = garments.filter((g) => NEAR_FACE.includes(g.category));
  const undertoneScore =
    undertone && face.length > 0
      ? face.reduce((sum, g) => sum + scoreUndertoneMatch(g.colorHex, undertone).score, 0) / face.length
      : null;
  if (undertoneScore !== null && undertoneScore >= 75) notes.push(`Flatters your ${undertone} undertone.`);
  else if (undertoneScore !== null && undertoneScore < 55) notes.push(`The top isn't ideal for a ${undertone} undertone.`);

  // Prefer pieces that haven't just been worn, so suggestions rotate through the closet.
  const recentlyWorn = garments.filter((g) => g.lastWornAt !== null && now - g.lastWornAt < 2 * DAY).length;
  if (recentlyWorn > 0) notes.push('Includes something you wore in the last two days.');

  const blended = undertoneScore === null ? harmony * 100 : 0.6 * harmony * 100 + 0.4 * undertoneScore;
  const score = Math.round(Math.max(0, Math.min(100, blended - 8 * recentlyWorn)));
  return { score, harmony: Math.round(harmony * 100), undertone: undertoneScore === null ? null : Math.round(undertoneScore), notes };
}

/**
 * Best top + bottom combinations, each completed with the best-matching shoes when any are tagged.
 * Tops are not repeated across suggestions, so the list shows real alternatives.
 */
export function suggestOutfits(closet: Garment[], undertone: Undertone | null, limit = 3, now = Date.now()): Suggestion[] {
  const by = (c: Category) => closet.filter((g) => g.category === c);
  const tops = by('tops');
  const bottoms = by('bottoms');
  const shoes = by('footwear');
  if (tops.length === 0 || bottoms.length === 0) return [];

  const candidates: Suggestion[] = [];
  for (const top of tops) {
    for (const bottom of bottoms) {
      const pair: Suggestion = { garments: [top, bottom], score: scoreOutfit([top, bottom], undertone, now) };
      let withShoes: Suggestion | null = null;
      for (const shoe of shoes) {
        const garments = [top, bottom, shoe];
        const score = scoreOutfit(garments, undertone, now);
        if (!withShoes || score.score > withShoes.score.score) withShoes = { garments, score };
      }
      // Suggest complete looks whenever footwear is tagged.
      candidates.push(withShoes ?? pair);
    }
  }
  candidates.sort((a, b) => b.score.score - a.score.score);

  const usedTops = new Set<string>();
  const picked: Suggestion[] = [];
  for (const c of candidates) {
    if (usedTops.has(c.garments[0].id)) continue;
    usedTops.add(c.garments[0].id);
    picked.push(c);
    if (picked.length === limit) break;
  }
  return picked;
}
