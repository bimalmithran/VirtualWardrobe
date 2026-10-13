import type { RGBAImage } from '../image/pixels';
import { assessQuality } from './junkFilter';

const img = (w: number, h: number, luma: (x: number, y: number) => number): RGBAImage => {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = luma(x, y);
      data.set([v, v, v, 255], (y * w + x) * 4);
    }
  return { width: w, height: h, data };
};

// A sharp, well-exposed fabric: fine checks between two mid tones.
const good = img(256, 256, (x, y) => ((x >> 2) + (y >> 2)) % 2 ? 90 : 170);

test('a good photo passes', () => {
  const q = assessQuality(good);
  expect(q.issues).toEqual([]);
  expect(q.headline).toBeNull();
});

test('flat grey is blurry and low-contrast; blur leads', () => {
  const q = assessQuality(img(256, 256, () => 128));
  expect(q.headline).toBe('Too blurry, hold still');
  expect(q.issues).toHaveLength(2);
});

test('crushed shadows trip the histogram even when the mean looks fine', () => {
  // Half pure black, half bright: mean ~120, but 50% of pixels clipped.
  const q = assessQuality(img(256, 256, (x, y) => (x < 128 ? 0 : ((x + y) % 4 < 2 ? 200 : 255 - 15))));
  expect(q.shadowClip).toBeGreaterThan(0.35);
  expect(q.issues.some((i) => i.includes('too dark'))).toBe(true);
});

test('blown highlights are flagged', () => {
  const q = assessQuality(img(256, 256, (x, y) => (y < 100 ? 255 : (x >> 2) % 2 ? 80 : 160)));
  expect(q.highlightClip).toBeGreaterThan(0.2);
  expect(q.issues.some((i) => i.includes('overexposed'))).toBe(true);
});
