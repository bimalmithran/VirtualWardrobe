import { EMPTY_TAGS, type Garment } from '../domain/types';
import { currentWeather, generateLooks } from './outfitGenerator';

let n = 0;
const g = (category: Garment['category'], colorHex: string, extra: Partial<Garment> = {}): Garment => ({
  id: `g${n++}`, imageUri: '', colorHex, palette: [], embedding: null, createdAt: 0, syncedAt: null, category,
  favorite: false, wearCount: 0, lastWornAt: null, photoCount: 1, revision: 0, ...EMPTY_TAGS, ...extra,
});

const navyTop = g('tops', '#1B2A4A');
const whiteTop = g('tops', '#F5F5F5');
const khaki = g('bottoms', '#C3B091');
const jeans = g('bottoms', '#3B5B8C');
const sneakers = g('footwear', '#FFFFFF', { subcategory: 'sneakers' });
const saree = g('ethnic', '#800020', { subcategory: 'sarees', occasions: ['wedding'] });
const kurta = g('ethnic', '#F2E6C9', { subcategory: 'kurtas' });
const coat = g('outerwear', '#5C4033', { subcategory: 'coats' });
const closet = [navyTop, whiteTop, khaki, jeans, sneakers, saree, kurta, coat];

test('every look contains the anchor, and looks are complete', () => {
  const looks = generateLooks(closet, null, { anchor: navyTop, weather: 'summer' });
  expect(looks.length).toBeGreaterThanOrEqual(2);
  for (const l of looks) {
    expect(l.garments).toContain(navyTop);
    expect(l.garments.some((x) => x.category === 'bottoms')).toBe(true);
  }
});

test('a scanned item that is not in the closet can anchor looks', () => {
  const scanned = g('bottoms', '#2F4F4F');
  const looks = generateLooks(closet, null, { anchor: scanned, weather: 'summer' });
  expect(looks.length).toBeGreaterThan(0);
  expect(looks.every((l) => l.garments.includes(scanned))).toBe(true);
});

test('templates include kurta sets and complete ethnic looks', () => {
  const kinds = new Set(generateLooks(closet, null, { weather: 'summer', limit: 20 }).map((l) => l.kind));
  expect(kinds).toEqual(new Set(['western', 'kurta', 'ethnic']));
});

test('looks wear shoes, but not sneakers to a wedding', () => {
  expect(generateLooks(closet, null, { anchor: navyTop, weather: 'summer' })[0].garments).toContain(sneakers);
  const wedding = generateLooks(closet, null, { occasion: 'wedding', weather: 'winter' });
  expect(wedding[0].garments).not.toContain(sneakers);
});

test('occasion moves a saree to the top for a wedding', () => {
  const looks = generateLooks(closet, null, { occasion: 'wedding', weather: 'winter' });
  expect(looks[0].garments).toContain(saree);
  expect(looks[0].score.occasion).toBeGreaterThan(70);
});

test('winter adds a layer, summer does not', () => {
  const winter = generateLooks(closet, null, { anchor: whiteTop, weather: 'winter' });
  const summer = generateLooks(closet, null, { anchor: whiteTop, weather: 'summer' });
  expect(winter.some((l) => l.garments.includes(coat))).toBe(true);
  expect(summer.some((l) => l.garments.includes(coat))).toBe(false);
});

test('Indian seasons by month', () => {
  expect(currentWeather(new Date(2026, 4, 1).getTime())).toBe('summer');
  expect(currentWeather(new Date(2026, 7, 1).getTime())).toBe('monsoon');
  expect(currentWeather(new Date(2026, 11, 1).getTime())).toBe('winter');
});

