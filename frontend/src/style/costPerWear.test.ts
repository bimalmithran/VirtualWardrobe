import { EMPTY_TAGS, type Garment } from '../domain/types';
import { costPerWear, costReport, formatInr } from './costPerWear';

const g = (id: string, price: number | null, wearCount: number, lastWornAt: number | null = null): Garment => ({
  id, imageUri: '', colorHex: '#000000', palette: [], embedding: null, createdAt: 0, syncedAt: null, category: 'tops',
  favorite: false, wearCount, lastWornAt, photoCount: 1, revision: 0, ...EMPTY_TAGS, price,
});

test('cost per wear', () => {
  expect(costPerWear(g('a', 2000, 4))).toBe(500);
  expect(costPerWear(g('a', 2000, 0))).toBe(2000);
  expect(costPerWear(g('a', null, 4))).toBeNull();
  expect(formatInr(123456)).toBe('₹1,23,456');
});

test('report ranks value and finds idle pieces', () => {
  const now = 200 * 86_400_000;
  const r = costReport([g('cheap', 500, 10, now), g('pricey', 6000, 1, 0), g('none', null, 3)], now);
  expect(r.totalSpent).toBe(6500);
  expect(r.averageCpw).toBe(Math.round(6500 / 11));
  expect(r.bestValue[0].garment.id).toBe('cheap');
  expect(r.worstValue[0].garment.id).toBe('pricey');
  expect(r.idle.map((x) => x.id)).toEqual(['pricey']);
});
