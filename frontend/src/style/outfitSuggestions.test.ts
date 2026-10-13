import type { Category, Garment } from '../domain/types';
import { pairHarmony, scoreOutfit, suggestOutfits } from './outfitSuggestions';

const g = (id: string, colorHex: string, category: Category | null, lastWornAt: number | null = null): Garment => ({
  id,
  imageUri: '',
  colorHex,
  palette: [],
  embedding: null,
  createdAt: 0,
  syncedAt: null,
  category,
  favorite: false,
  wearCount: 0,
  lastWornAt,
});

const NOW = 1_000_000_000_000;

describe('pairHarmony', () => {
  test('neutrals go with anything', () => {
    expect(pairHarmony('#FFFFFF', '#E0115F')).toBeGreaterThan(0.8);
    expect(pairHarmony('#1C1C1C', '#2E5090')).toBeGreaterThan(0.8);
  });

  test('analogous beats clashing hues', () => {
    const analogous = pairHarmony('#1F3A93', '#3B5BA9'); // two blues
    const clash = pairHarmony('#E53935', '#43A047'); // saturated red + green, different lightness bands
    expect(analogous).toBeGreaterThan(clash);
  });

  test('is symmetric', () => {
    expect(pairHarmony('#C0392B', '#2980B9')).toBeCloseTo(pairHarmony('#2980B9', '#C0392B'));
  });
});

describe('scoreOutfit', () => {
  test('empty outfit scores zero', () => {
    expect(scoreOutfit([], 'warm').score).toBe(0);
  });

  test('undertone shifts the score for the top only', () => {
    const navyTop = [g('t', '#1F2A60', 'tops'), g('b', '#D8CBB0', 'bottoms')];
    expect(scoreOutfit(navyTop, 'cool').score).toBeGreaterThan(scoreOutfit(navyTop, 'warm').score);
    expect(scoreOutfit(navyTop, null).undertone).toBeNull();
  });

  test('recently worn pieces are down-weighted', () => {
    const fresh = [g('t', '#FFFFFF', 'tops'), g('b', '#1C1C1C', 'bottoms')];
    const worn = [g('t', '#FFFFFF', 'tops', NOW - 1000), g('b', '#1C1C1C', 'bottoms')];
    expect(scoreOutfit(worn, 'neutral', NOW).score).toBeLessThan(scoreOutfit(fresh, 'neutral', NOW).score);
  });
});

describe('suggestOutfits', () => {
  test('needs at least one top and one bottom', () => {
    expect(suggestOutfits([g('t', '#FFFFFF', 'tops'), g('x', '#000000', null)], 'warm')).toEqual([]);
  });

  test('ranks combinations, adds shoes, and does not repeat a top', () => {
    const closet = [
      g('white-tee', '#F5F5F5', 'tops'),
      g('rust-shirt', '#B7410E', 'tops'),
      g('jeans', '#2B3A55', 'bottoms'),
      g('chinos', '#C8B68E', 'bottoms'),
      g('sneakers', '#FAFAFA', 'footwear'),
    ];
    const s = suggestOutfits(closet, 'warm', 3, NOW);
    expect(s).toHaveLength(2);
    expect(new Set(s.map((x) => x.garments[0].id)).size).toBe(2);
    expect(s[0].score.score).toBeGreaterThanOrEqual(s[1].score.score);
    expect(s.every((x) => x.garments.some((p) => p.id === 'sneakers'))).toBe(true);
  });
});
