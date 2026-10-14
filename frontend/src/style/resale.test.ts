import { EMPTY_TAGS, type Garment } from '../domain/types';
import { listingDescription, listingTitle, suggestPrice } from './resale';

const shirt: Garment = {
  id: 'a', imageUri: '', colorHex: '#1B2A4A', palette: [], embedding: null, createdAt: 0, syncedAt: null, category: 'tops',
  favorite: false, wearCount: 3, lastWornAt: null, photoCount: 1, revision: 0, ...EMPTY_TAGS,
  subcategory: 'shirts', pattern: 'striped', brand: 'Fabindia', size: 'M', price: 2000, occasions: ['work'],
};

test('listing text and price come from the closet', () => {
  expect(listingTitle(shirt)).toBe('Navy Striped Shirt · Fabindia');
  expect(listingDescription(shirt)).toBe('Size M. Great for work. Worn 3 times.');
  expect(suggestPrice(shirt, 'like-new')).toBe(1150); // 2000 × (0.60 − 0.03) = 1140 → nearest 50
  expect(suggestPrice({ ...shirt, price: null }, 'good')).toBeNull();
});
