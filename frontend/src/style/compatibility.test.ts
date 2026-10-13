import { EMPTY_TAGS, type Garment } from '../domain/types';
import { findOrphans, orphanReason, pairScore } from './compatibility';

let n = 0;
const g = (category: Garment['category'], colorHex: string, extra: Partial<Garment> = {}): Garment => ({
  id: `g${n++}`,
  imageUri: '',
  colorHex,
  palette: [],
  embedding: null,
  createdAt: 0,
  syncedAt: null,
  category,
  favorite: false,
  wearCount: 0,
  lastWornAt: null,
  photoCount: 1,
  revision: 0,
  ...EMPTY_TAGS,
  ...extra,
});

test('a top with no bottoms is an orphan; adding a matching bottom fixes it', () => {
  const top = g('tops', '#1B2A4A');
  expect(orphanReason(top, [top])?.kind).toBe('missing');
  const jeans = g('bottoms', '#C8B89A');
  expect(orphanReason(top, [top, jeans])).toBeNull();
});

test('a top whose only bottoms clash is an orphan by clash', () => {
  const top = g('tops', '#E0115F'); // ruby
  const bottom = g('bottoms', '#2E8B57'); // sea green, also loud
  expect(orphanReason(top, [top, bottom])?.kind).toBe('clash');
});

test('a saree is complete on its own; a kurta needs a bottom', () => {
  const saree = g('ethnic', '#800020', { subcategory: 'sarees' });
  const kurta = g('ethnic', '#F5F5DC', { subcategory: 'kurtas' });
  expect(findOrphans([saree, kurta]).has(saree.id)).toBe(false);
  expect(findOrphans([saree, kurta]).has(kurta.id)).toBe(true);
});

test('two busy patterns score lower than a pattern with a solid', () => {
  const stripes = g('tops', '#1B2A4A', { pattern: 'striped' });
  const checks = g('bottoms', '#C8B89A', { pattern: 'checked' });
  const plain = g('bottoms', '#C8B89A', { pattern: 'solid' });
  expect(pairScore(stripes, checks)).toBeLessThan(pairScore(stripes, plain));
});

test('accessories and untagged pieces are never orphans', () => {
  expect(findOrphans([g('accessories', '#000000'), g(null, '#123456')]).size).toBe(0);
});
