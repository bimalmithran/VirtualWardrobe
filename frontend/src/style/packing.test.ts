import { EMPTY_TAGS, type Garment } from '../domain/types';
import { capsuleSize, planPacking } from './packing';

let n = 0;
const g = (category: Garment['category'], colorHex: string, extra: Partial<Garment> = {}): Garment => ({
  id: `g${n++}`, imageUri: '', colorHex, palette: [], embedding: null, createdAt: 0, syncedAt: null, category,
  favorite: false, wearCount: 0, lastWornAt: null, photoCount: 1, revision: 0, ...EMPTY_TAGS, ...extra,
});

const closet = [
  ...['#F5F5F5', '#1B2A4A', '#87A96B', '#E2725B', '#D6DCE4', '#FFFDD0', '#000000'].map((c) => g('tops', c)),
  ...['#C3B091', '#36454F', '#3B5B8C'].map((c) => g('bottoms', c)),
  g('footwear', '#FFFFFF'),
  g('footwear', '#5C3317'),
  g('outerwear', '#5C4033'),
  g('ethnic', '#800020', { subcategory: 'sarees', occasions: ['wedding'] }),
  g('tops', '#FFD700', { weather: ['winter'] }), // wrong weather for a summer trip
];

test('capsule sizes shrink with laundry', () => {
  expect(capsuleSize(10, true)).toEqual({ tops: 4, bottoms: 2, shoes: 2 });
  expect(capsuleSize(10, false)).toEqual({ tops: 8, bottoms: 4, shoes: 2 });
});

test('a summer week packs a capsule and schedules a look every day', () => {
  const plan = planPacking(closet, null, { days: 5, weather: 'summer', occasions: ['casual', 'work'], laundry: true });
  expect(plan.schedule).toHaveLength(5);
  const packed = new Set(plan.pieces.map((p) => p.id));
  for (const s of plan.schedule) for (const piece of s.look.garments) expect(packed.has(piece.id)).toBe(true);
  expect(plan.pieces.filter((p) => p.category === 'tops')).toHaveLength(4);
  expect(plan.pieces.some((p) => p.category === 'outerwear')).toBe(false);
  expect(plan.pieces.some((p) => p.weather.includes('winter'))).toBe(false);
  // No top on two days in a row.
  const tops = plan.schedule.map((s) => s.look.garments.find((x) => x.category === 'tops')?.id);
  for (let i = 1; i < tops.length; i++) expect(tops[i]).not.toBe(tops[i - 1]);
});

test('a winter wedding trip packs the saree and a layer', () => {
  const plan = planPacking(closet, null, { days: 3, weather: 'winter', occasions: ['wedding', 'casual'], laundry: false });
  expect(plan.pieces.some((p) => p.subcategory === 'sarees')).toBe(true);
  expect(plan.pieces.some((p) => p.category === 'outerwear')).toBe(true);
  expect(plan.schedule[0].occasion).toBe('wedding');
});
