import { EMPTY_PROPORTIONS, EMPTY_TAGS, type Garment } from '../domain/types';
import { cutFit, silhouetteOf } from './cutFit';
import { guessCategory, nearDuplicates, redundancyMessage } from './redundancy';

const unit = (seed: number) => {
  const v = new Float32Array(512).map((_, i) => Math.sin(i * seed));
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
};
const g = (id: string, extra: Partial<Garment>): Garment => ({
  id, imageUri: '', colorHex: '#1B2A4A', palette: [], embedding: null, createdAt: 0, syncedAt: null, category: 'tops',
  favorite: false, wearCount: 0, lastWornAt: null, photoCount: 1, revision: 0, ...EMPTY_TAGS, ...extra,
});

test('three navy tees are flagged as near-duplicates of a navy tee', () => {
  const e = unit(1);
  const closet = [
    g('a', { embedding: e, subcategory: 't-shirts' }),
    g('b', { embedding: e, subcategory: 't-shirts' }),
    g('c', { embedding: e, subcategory: 't-shirts' }),
    g('d', { embedding: e, colorHex: '#C8102E' }), // red: different colour
    g('e', { embedding: unit(7) }), // navy but a different style
  ];
  const item = { colorHex: '#1C2B4C', embedding: e, category: 'tops' as const, subcategory: 't-shirts', pattern: 'solid' as const };
  const dupes = nearDuplicates(item, closet);
  expect(dupes.map((d) => d.id)).toEqual(['a', 'b', 'c']);
  expect(redundancyMessage(item, dupes)).toBe('You already have 3 navy t-shirts like this.');
});

test('category is guessed from the nearest tagged pieces', () => {
  const closet = [g('a', { embedding: unit(1), category: 'bottoms', subcategory: 'jeans' }), g('b', { embedding: unit(1.001), category: 'bottoms' }), g('c', { embedding: unit(9), category: 'tops' })];
  expect(guessCategory(unit(1), closet)).toEqual({ category: 'bottoms', subcategory: 'jeans' });
  expect(guessCategory(unit(3), [])).toBeNull();
});

test('cut fit follows body shape', () => {
  const boxy = { aspect: 1.0, taper: 1.0, waistDefinition: 0.02, fill: 0.9 };
  const fitted = { aspect: 1.1, taper: 1.0, waistDefinition: 0.2, fill: 0.7 };
  expect(silhouetteOf('tops', boxy)).toBe('boxy');
  const twin = { bodyShape: 'hourglass' as const, heightCm: 165, proportions: EMPTY_PROPORTIONS };
  expect(cutFit('tops', fitted, twin)!.score).toBeGreaterThan(cutFit('tops', boxy, twin)!.score);
  const pear = { ...twin, bodyShape: 'triangle' as const };
  expect(cutFit('bottoms', { aspect: 2, taper: 1.3, waistDefinition: 0, fill: 0.7 }, pear)!.silhouette).toBe('wide-leg');
  expect(cutFit('bottoms', { aspect: 2, taper: 0.6, waistDefinition: 0, fill: 0.7 }, pear)!.score).toBeLessThan(70);
  expect(cutFit('accessories', fitted, twin)).toBeNull();
});
