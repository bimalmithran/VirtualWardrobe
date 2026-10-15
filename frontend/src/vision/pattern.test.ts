import type { RGBAImage } from '../image/pixels';
import { anchorWidth, measureShape, tightCrop } from './garmentShape';
import { detectPattern } from './pattern';

function make(w: number, h: number, paint: (x: number, y: number) => [number, number, number, number]): RGBAImage {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(paint(x, y), (y * w + x) * 4);
  return { width: w, height: h, data };
}

const navy: [number, number, number, number] = [30, 45, 90, 255];
const white: [number, number, number, number] = [240, 240, 240, 255];

test('solid fabric', () => {
  expect(detectPattern(make(200, 200, () => navy), 1).pattern).toBe('solid');
});

test('horizontal stripes', () => {
  expect(detectPattern(make(200, 200, (_, y) => (Math.floor(y / 10) % 2 ? navy : white)), 2).pattern).toBe('striped');
});

test('checks', () => {
  const r = detectPattern(make(200, 200, (x, y) => ((Math.floor(x / 12) + Math.floor(y / 12)) % 2 ? navy : white)), 2);
  expect(r.pattern).toBe('checked');
});

test('a multicolour print', () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const blobs = Array.from({ length: 120 }, () => ({ x: rnd() * 200, y: rnd() * 200, r: 4 + rnd() * 8, c: [rnd() * 255, rnd() * 255, rnd() * 255, 255] }));
  const img = make(200, 200, (x, y) => {
    const b = blobs.find((p) => (p.x - x) ** 2 + (p.y - y) ** 2 < p.r ** 2);
    return (b ? b.c : white) as [number, number, number, number];
  });
  expect(detectPattern(img, 4).pattern).toBe('printed');
});

test('the silhouette edge alone does not count as a pattern', () => {
  const disc = make(200, 200, (x, y) => ((x - 100) ** 2 + (y - 100) ** 2 < 80 ** 2 ? navy : [0, 0, 0, 0]));
  expect(detectPattern(disc, 1).pattern).toBe('solid');
});

test('tight crop and shape', () => {
  // A 40x100 opaque bar in a 200x200 frame.
  const img = make(200, 200, (x, y) => (x >= 80 && x < 120 && y >= 50 && y < 150 ? navy : [0, 0, 0, 0]));
  const c = tightCrop(img, 0);
  expect([c.width, c.height]).toEqual([40, 100]);
  expect(measureShape(c)).toEqual({ aspect: 2.5, taper: 1, waistDefinition: 0, fill: 1 });
});

describe('anchorWidth', () => {
  const clear: [number, number, number, number] = [0, 0, 0, 0];
  // 300x300 tee: torso x 100..199, sleeves spread out to 0..299 for the top 20% only.
  const tee = make(300, 300, (x, y) => ((x >= 100 && x < 200) || (y < 60 && y >= 0) ? navy : clear));
  test('measures the torso, not the spread sleeves', () => {
    expect(anchorWidth(tee, 'chest')).toBe(100);
  });
  test('bridges an open front', () => {
    const jacket = make(300, 300, (x) => ((x >= 90 && x < 145) || (x >= 155 && x < 210) ? navy : clear));
    expect(anchorWidth(jacket, 'chest')).toBe(120);
  });
  test('waistband of trousers', () => {
    const jeans = make(200, 400, (x, y) => (y < 120 ? x >= 40 && x < 160 : (x >= 40 && x < 95) || (x >= 105 && x < 160)) ? navy : clear);
    expect(anchorWidth(jeans, 'waist')).toBe(120);
  });
});
