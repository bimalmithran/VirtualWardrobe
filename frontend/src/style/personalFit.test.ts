import type { Garment, PersonalColouring, Wearer } from '../domain/types';
import { SEASON_PALETTES } from '../vision/personColouring';
import { scoreOutfit } from './outfitSuggestions';
import { coloursToAdd, paletteCloseness, rankForWearer, scoreForWearer } from './personalFit';

const g = (id: string, colorHex: string, category: Garment['category'] = 'tops'): Garment => ({
  id,
  imageUri: '',
  colorHex,
  palette: [{ hex: colorHex, share: 1 }],
  embedding: null,
  createdAt: 0,
  syncedAt: null,
  category,
  favorite: false,
  wearCount: 0,
  lastWornAt: null,
  photoCount: 1,
  revision: 0,
});

const colouring = (season: PersonalColouring['season'], contrast: PersonalColouring['contrast'] = 'medium'): PersonalColouring => ({
  skinHex: '#C68E6A',
  undertone: season === 'spring' || season === 'autumn' ? 'warm' : 'cool',
  depth: 'medium',
  contrast,
  season,
  subSeason: ({ spring: 'warm-spring', summer: 'cool-summer', autumn: 'warm-autumn', winter: 'cool-winter' } as const)[season],
  source: 'photos',
  palette: SEASON_PALETTES[season],
  photoCount: 1,
});

const autumn: Wearer = { undertone: 'warm', colouring: colouring('autumn') };

test('a colour from the palette is close; an unrelated one is not', () => {
  expect(paletteCloseness('#B7410E', autumn.colouring!)).toBe(100);
  expect(paletteCloseness('#FF00FF', autumn.colouring!)).toBeLessThan(40);
});

test('without photos the score is the plain undertone match', () => {
  const plain = scoreForWearer('#B7410E', { undertone: 'warm', colouring: null })!;
  expect(plain.explanation).not.toMatch(/palette/);
  expect(scoreForWearer('#B7410E', { undertone: null, colouring: null })).toBeNull();
});

test('photos add palette closeness and say so', () => {
  const rust = scoreForWearer('#B7410E', autumn)!;
  const icyPink = scoreForWearer('#F4C2E0', autumn)!;
  expect(rust.score).toBeGreaterThan(icyPink.score);
  expect(rust.explanation).toMatch(/Autumn palette/);
});

test('the detected undertone is used when the Twin has none', () => {
  expect(scoreForWearer('#B7410E', { undertone: null, colouring: colouring('autumn') })).not.toBeNull();
});

test('ranks the closet best-suited first', () => {
  const ranked = rankForWearer([g('pink', '#F4C2E0'), g('rust', '#B7410E'), g('olive', '#708238')], autumn, 2);
  expect(ranked.map((r) => r.garment.id)).toEqual(['rust', 'olive']);
});

test('suggests palette colours the closet is missing, skipping ones it covers', () => {
  const closet = [g('rust', '#B5420F'), g('mustard', '#D6A21A')];
  const missing = coloursToAdd(closet, autumn.colouring!, 3);
  expect(missing).toHaveLength(3);
  expect(missing.map((m) => m.hex)).not.toContain('#B7410E');
  expect(missing.map((m) => m.hex)).not.toContain('#D4A017');
});

test('outfit contrast is judged against the wearer’s contrast', () => {
  const blackAndWhite = [g('t', '#FFFFFF'), g('b', '#111111', 'bottoms')];
  const high = scoreOutfit(blackAndWhite, { undertone: 'cool', colouring: colouring('winter', 'high') });
  const low = scoreOutfit(blackAndWhite, { undertone: 'cool', colouring: colouring('winter', 'low') });
  expect(high.score).toBeGreaterThan(low.score);
  expect(low.notes.join(' ')).toMatch(/overpower/);
});
