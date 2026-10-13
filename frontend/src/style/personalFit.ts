import type { Garment, PersonalColouring, Wearer } from '../domain/types';
import { colorName, hexToRgb, rgbToLab, type Lab } from '../vision/color';
import { SUB_SEASONS } from './seasons';
import { scoreUndertoneMatch, type MatchResult } from '../vision/undertoneMatch';

/** Within this ΔE a colour counts as "in" the season palette; beyond FAR it is unrelated. */
const NEAR = 12;
const FAR = 50;
/** A closet colour within this ΔE already covers a palette colour. */
const COVERED = 22;

const lab = (hex: string): Lab => rgbToLab(...hexToRgb(hex));
const deltaE = (a: Lab, b: Lab) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** 0..100: how close a colour is to the nearest colour of the wearer's season palette. */
export function paletteCloseness(hex: string, colouring: PersonalColouring): number {
  const c = lab(hex);
  const nearest = Math.min(...colouring.palette.map((p) => deltaE(c, lab(p))));
  return Math.round(100 * Math.max(0, Math.min(1, 1 - (nearest - NEAR) / (FAR - NEAR))));
}

/**
 * How well a colour suits the wearer. With only an undertone it is the undertone match;
 * colouring read from photos adds closeness to their season palette.
 */
export function scoreForWearer(hex: string, wearer: Wearer): MatchResult | null {
  const undertone = wearer.undertone ?? wearer.colouring?.undertone ?? null;
  if (!undertone) return null;
  const base = scoreUndertoneMatch(hex, undertone);
  const colouring = wearer.colouring;
  if (!colouring) return base;

  const closeness = paletteCloseness(hex, colouring);
  const score = Math.round(0.5 * base.score + 0.5 * closeness);
  const verdict = score >= 75 ? 'Great match' : score >= 55 ? 'Works for you' : 'Not your strongest';
  const season = SUB_SEASONS[colouring.subSeason].label;
  const paletteNote =
    closeness >= 75
      ? ` It is in your ${season} palette.`
      : closeness < 35
        ? ` It is far from your ${season} palette.`
        : '';
  return { score, verdict, explanation: base.explanation + paletteNote };
}

export interface RankedForWearer {
  garment: Garment;
  match: MatchResult;
}

/** The closet, best-suited first. Empty when nothing is known about the wearer. */
export function rankForWearer(closet: Garment[], wearer: Wearer, limit: number): RankedForWearer[] {
  return closet
    .map((garment) => ({ garment, match: scoreForWearer(garment.colorHex, wearer) }))
    .filter((r): r is RankedForWearer => r.match !== null)
    .sort((a, b) => b.match.score - a.match.score)
    .slice(0, limit);
}

export interface ColourToAdd {
  hex: string;
  name: string;
}

/**
 * Palette colours the closet has nothing close to: what to look for when shopping.
 * Any colour in a garment's palette counts, not just its primary.
 */
export function coloursToAdd(closet: Garment[], colouring: PersonalColouring, limit = 4): ColourToAdd[] {
  const owned = closet.flatMap((g) => (g.palette.length ? g.palette.map((p) => p.hex) : [g.colorHex])).map(lab);
  const missing: ColourToAdd[] = [];
  const names = new Set<string>();
  for (const hex of colouring.palette) {
    const c = lab(hex);
    if (owned.some((o) => deltaE(c, o) < COVERED)) continue;
    const name = colorName(hex);
    if (names.has(name)) continue; // two shades with one name read as a duplicate
    names.add(name);
    missing.push({ hex, name });
    if (missing.length === limit) break;
  }
  return missing;
}
