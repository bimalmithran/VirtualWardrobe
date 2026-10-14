import { EMPTY_TAGS, type Garment } from '../domain/types';
import { lookGaps, orphanNeed } from './gaps';

let n = 0;
const g = (category: Garment['category'], colorHex: string, extra: Partial<Garment> = {}): Garment => ({
  id: `g${n++}`, imageUri: '', colorHex, palette: [], embedding: null, createdAt: 0, syncedAt: null, category,
  favorite: false, wearCount: 0, lastWornAt: null, photoCount: 1, revision: 0, ...EMPTY_TAGS, ...extra,
});

test('a top and bottom with no shoes in winter needs shoes and a layer', () => {
  const gaps = lookGaps([g('tops', '#F5F5F5'), g('bottoms', '#3B5B8C')], null, 'winter');
  expect(gaps.map((x) => x.category)).toEqual(['footwear', 'outerwear']);
  expect(gaps[0].hex).toMatch(/^#[0-9A-F]{6}$/);
});

test('a kurta alone needs a bottom and shoes; a complete look needs nothing in summer', () => {
  expect(lookGaps([g('ethnic', '#F2E6C9', { subcategory: 'kurtas' })], null, 'summer').map((x) => x.category)).toEqual(['bottoms', 'footwear']);
  expect(lookGaps([g('tops', '#FFF'), g('bottoms', '#000000'), g('footwear', '#FFFFFF')], null, 'summer')).toEqual([]);
});

test('an orphan top needs a bottom; a saree is never an orphan', () => {
  expect(orphanNeed(g('tops', '#E0115F'), null)?.category).toBe('bottoms');
  expect(orphanNeed(g('ethnic', '#800020', { subcategory: 'sarees' }), null)).toBeNull();
});
