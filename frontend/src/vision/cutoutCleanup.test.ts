import type { RGBAImage } from '../image/pixels';
import { cleanCutout } from './cutoutCleanup';

function image(w: number, h: number, alphaAt: (x: number, y: number) => number): RGBAImage {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([200, 50, 40, alphaAt(x, y)], (y * w + x) * 4);
  return { width: w, height: h, data };
}
const alpha = (img: RGBAImage, x: number, y: number) => img.data[(y * img.width + x) * 4 + 3];

const W = 200, H = 200;
const body = (x: number, y: number) => x >= 50 && x < 150 && y >= 40 && y < 180;

test('drops small stray blobs and faint haze, keeps the body and its soft edge', () => {
  const img = image(W, H, (x, y) => {
    if (body(x, y)) return 255;
    if (x === 150 && y >= 40 && y < 180) return 90; // soft edge right beside the body
    if (x >= 10 && x < 14 && y >= 10 && y < 14) return 255; // a 4x4 blob, far smaller than the body
    return (x + y) % 7 === 0 ? 40 : 0; // haze
  });
  const out = cleanCutout(img);
  expect(alpha(out, 100, 100)).toBe(255);
  expect(alpha(out, 150, 100)).toBe(90);
  expect(alpha(out, 11, 11)).toBe(0);
  expect(alpha(out, 0, 7)).toBe(0);
});

test('keeps two pieces of similar size, like a pair of shoes', () => {
  const out = cleanCutout(image(W, H, (x, y) => (y >= 80 && y < 120 && ((x >= 20 && x < 80) || (x >= 120 && x < 170)) ? 255 : 0)));
  expect(alpha(out, 50, 100)).toBe(255);
  expect(alpha(out, 150, 100)).toBe(255);
});

test('fills pinholes but keeps a real opening', () => {
  const out = cleanCutout(
    image(W, H, (x, y) => {
      if (!body(x, y)) return 0;
      if (x >= 100 && x < 102 && y >= 100 && y < 102) return 10; // pinhole
      if (x >= 70 && x < 130 && y >= 60 && y < 90) return 0; // a 60x30 opening
      return 255;
    }),
  );
  expect(alpha(out, 100, 100)).toBe(255);
  expect(alpha(out, 100, 75)).toBe(0);
});

test('returns the input when there is nothing to tidy', () => {
  const img = image(W, H, (x, y) => (body(x, y) ? 255 : 0));
  expect(cleanCutout(img)).toBe(img);
});
