import { EMPTY_TAGS, type Garment } from '../domain/types';
import { rankBySimilarity } from './similarity';

const unit = (...v: number[]) => {
  const n = Math.hypot(...v);
  return new Float32Array(v.map((x) => x / n));
};

const g = (id: string, embedding: Float32Array | null): Garment => ({
  id,
  imageUri: '',
  colorHex: '#000000',
  palette: [],
  embedding,
  createdAt: 0,
  category: null,
  favorite: false,
  wearCount: 0,
  lastWornAt: null,
  syncedAt: null,
  photoCount: 1,
  revision: 0,
  ...EMPTY_TAGS,
});

test('ranks by cosine similarity, excluding the query and unembedded garments', () => {
  const query = g('q', unit(1, 0));
  const ranked = rankBySimilarity(query, [query, g('far', unit(0, 1)), g('near', unit(1, 0.1)), g('none', null)], 5);
  expect(ranked.map((r) => r.garment.id)).toEqual(['near', 'far']);
  expect(ranked[0].score).toBeCloseTo(0.995, 3);
});

test('returns nothing for a garment without an embedding', () => {
  expect(rankBySimilarity(g('q', null), [g('a', unit(1, 0))], 5)).toEqual([]);
});
