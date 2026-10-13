import type { ContrastLevel, Depth, PersonalColouring, Season, SubSeason, Undertone } from '../domain/types';

export interface SubSeasonInfo {
  family: Season;
  label: string;
  /** One line on what defines it, shown when choosing. */
  traits: string;
  /** Typical depth and contrast, used when the season is chosen by hand rather than read from photos. */
  depth: Depth;
  contrast: ContrastLevel;
  /** Colours that flatter this type, strongest first. */
  palette: string[];
}

/**
 * Twelve-season colour analysis: each of the four seasons splits by its dominant trait
 * (light/deep, warm/cool, clear/soft). Palettes follow common draping references.
 */
export const SUB_SEASONS: Record<SubSeason, SubSeasonInfo> = {
  'light-spring': {
    family: 'spring', label: 'Light Spring', traits: 'Warm and light, delicate colouring', depth: 'light', contrast: 'low',
    palette: ['#FFB6A3', '#FFE5B4', '#F7E7A1', '#A8E4A0', '#7FDBD4', '#9BC4E2', '#F2C1D1', '#FFF8E7'],
  },
  'warm-spring': {
    family: 'spring', label: 'Warm Spring', traits: 'Golden warmth, fresh and bright', depth: 'medium', contrast: 'medium',
    palette: ['#FF7F50', '#F4C430', '#E9967A', '#6BA539', '#30D5C8', '#C19A6B', '#FFB347', '#FFFFF0'],
  },
  'clear-spring': {
    family: 'spring', label: 'Clear Spring', traits: 'Warm-leaning, vivid and high contrast', depth: 'medium', contrast: 'high',
    palette: ['#FF4F58', '#FFD700', '#00A86B', '#1CA9C9', '#3B6FB6', '#FF69B4', '#1F2A44', '#FFFFF0'],
  },
  'light-summer': {
    family: 'summer', label: 'Light Summer', traits: 'Cool and light, airy pastels', depth: 'light', contrast: 'low',
    palette: ['#B0C4DE', '#C8A2C8', '#F4C2C2', '#A7D8DE', '#B2C8B2', '#E6E6FA', '#8FA8C8', '#F5F5F5'],
  },
  'cool-summer': {
    family: 'summer', label: 'Cool Summer', traits: 'Blue-pink coolness, gentle depth', depth: 'medium', contrast: 'medium',
    palette: ['#4F6D9A', '#9DB4D3', '#B784A7', '#B3446C', '#3C4E78', '#708090', '#5F9EA0', '#F5F5F5'],
  },
  'soft-summer': {
    family: 'summer', label: 'Soft Summer', traits: 'Cool, muted and blended', depth: 'medium', contrast: 'low',
    palette: ['#8E9BAE', '#A3909B', '#9CAF88', '#B5A3B5', '#6E7F80', '#C9A9A6', '#5D6D7E', '#E8E4E0'],
  },
  'soft-autumn': {
    family: 'autumn', label: 'Soft Autumn', traits: 'Warm, muted and earthy', depth: 'medium', contrast: 'low',
    palette: ['#C2B280', '#A9BA9D', '#D8A48F', '#8F9779', '#B48C6E', '#6B8E8E', '#C9A66B', '#F3E5D0'],
  },
  'warm-autumn': {
    family: 'autumn', label: 'Warm Autumn', traits: 'Rich golden warmth, spice tones', depth: 'medium', contrast: 'medium',
    palette: ['#B7410E', '#D4A017', '#708238', '#E2725B', '#CC7722', '#5C3317', '#C19A6B', '#FFFDD0'],
  },
  'deep-autumn': {
    family: 'autumn', label: 'Deep Autumn', traits: 'Deep and warm, intense earth tones', depth: 'deep', contrast: 'high',
    palette: ['#7C2D12', '#556B2F', '#B8860B', '#014D4E', '#8B4513', '#4B3621', '#A0522D', '#F0E6D2'],
  },
  'deep-winter': {
    family: 'winter', label: 'Deep Winter', traits: 'Deep and cool, dramatic jewel tones', depth: 'deep', contrast: 'high',
    palette: ['#000000', '#800020', '#1B2A4A', '#046307', '#4B0082', '#C8102E', '#36454F', '#FFFFFF'],
  },
  'cool-winter': {
    family: 'winter', label: 'Cool Winter', traits: 'Icy blue undertone, crisp and cool', depth: 'medium', contrast: 'high',
    palette: ['#2741A8', '#C3216F', '#009B77', '#1B2A4A', '#D6DCE4', '#6A0DAD', '#000000', '#FFFFFF'],
  },
  'clear-winter': {
    family: 'winter', label: 'Clear Winter', traits: 'Bright, pure colours and stark contrast', depth: 'medium', contrast: 'high',
    palette: ['#DC143C', '#0047AB', '#FF1493', '#00A693', '#FFF44F', '#000000', '#FFFFFF', '#E0FFFF'],
  },
};

export const SUB_SEASON_ORDER = Object.keys(SUB_SEASONS) as SubSeason[];

/** Splits a four-season result by its strongest trait. */
export function subSeasonFor(season: Season, depth: Depth, contrast: ContrastLevel): SubSeason {
  switch (season) {
    case 'spring':
      return depth === 'light' ? 'light-spring' : contrast === 'high' ? 'clear-spring' : 'warm-spring';
    case 'summer':
      return depth === 'light' ? 'light-summer' : contrast === 'low' ? 'soft-summer' : 'cool-summer';
    case 'autumn':
      return depth === 'deep' ? 'deep-autumn' : contrast === 'low' ? 'soft-autumn' : 'warm-autumn';
    case 'winter':
      return depth === 'deep' ? 'deep-winter' : contrast === 'high' ? 'clear-winter' : 'cool-winter';
  }
}

export const isSubSeason = (s: unknown): s is SubSeason => typeof s === 'string' && s in SUB_SEASONS;

/**
 * The colouring suggestions use. A season the user chose by hand wins over photo analysis
 * (a professional draping beats a phone camera), but photo-read depth and contrast are kept.
 */
export function effectiveColouring(
  fromPhotos: PersonalColouring | null,
  chosen: SubSeason | null,
  twinUndertone: Undertone | null,
): PersonalColouring | null {
  if (!chosen) return fromPhotos;
  const info = SUB_SEASONS[chosen];
  const familyUndertone: Undertone = info.family === 'spring' || info.family === 'autumn' ? 'warm' : 'cool';
  return {
    skinHex: fromPhotos?.skinHex ?? null,
    undertone: fromPhotos?.undertone ?? twinUndertone ?? familyUndertone,
    depth: fromPhotos?.depth ?? info.depth,
    contrast: fromPhotos?.contrast ?? info.contrast,
    season: info.family,
    subSeason: chosen,
    source: 'twin',
    palette: info.palette,
    photoCount: fromPhotos?.photoCount ?? 0,
  };
}
