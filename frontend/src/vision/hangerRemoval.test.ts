import type { RGBAImage } from '../image/pixels';
import { keepLargestComponent, removeHanger, squaredDistanceTo } from './hangerRemoval';

type Shape = (x: number, y: number) => boolean;

function mask(w: number, h: number, inside: Shape): RGBAImage {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) data.set([30, 45, 90, inside(x, y) ? 255 : 0], (y * w + x) * 4);
  return { width: w, height: h, data };
}

const alpha = (img: RGBAImage, x: number, y: number) => img.data[(y * img.width + x) * 4 + 3];
const opaque = (img: RGBAImage) => {
  let c = 0;
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] > 127) c++;
  return c;
};

// A 300x400 frame: a T-shirt (body + sleeves) from y=100 down to y=380.
const W = 300, H = 400;
const shirt: Shape = (x, y) => (y >= 100 && y < 380 && x >= 90 && x < 210) || (y >= 100 && y < 160 && x >= 40 && x < 260);
// A wire hook: 4 px wide stem rising 60 px from the collar, plus a curl at the top.
const hook: Shape = (x, y) => (y >= 40 && y < 100 && x >= 148 && x < 152) || (y >= 36 && y < 40 && x >= 148 && x < 175);
// A drawstring: 3 px wide, hanging 15 px below the hem.
const string: Shape = (x, y) => y >= 380 && y < 395 && x >= 120 && x < 123;

test('removes a hook above the garment', () => {
  const { image, removedShare } = removeHanger(mask(W, H, (x, y) => shirt(x, y) || hook(x, y)));
  expect(removedShare).toBeGreaterThan(0);
  expect(alpha(image, 150, 60)).toBe(0); // stem
  expect(alpha(image, 170, 37)).toBe(0); // curl
  expect(alpha(image, 150, 200)).toBe(255); // body untouched
  expect(alpha(image, 45, 130)).toBe(255); // sleeve untouched
});

test('keeps thin details lower on the garment', () => {
  const { image } = removeHanger(mask(W, H, (x, y) => shirt(x, y) || hook(x, y) || string(x, y)));
  expect(alpha(image, 121, 390)).toBe(255);
  expect(alpha(image, 150, 60)).toBe(0);
});

test('leaves a garment without a hanger alone', () => {
  const src = mask(W, H, shirt);
  const { image, removedShare } = removeHanger(src);
  expect(removedShare).toBe(0);
  expect(opaque(image)).toBe(opaque(src));
});

test('skips items that are thin all over, like a belt', () => {
  const belt = mask(W, H, (x, y) => y >= 190 && y < 200 && x >= 10 && x < 290);
  expect(removeHanger(belt).removedShare).toBe(0);
});

test('distance transform is exact on a line', () => {
  const m = new Uint8Array(10);
  m[0] = 1;
  const d = squaredDistanceTo(m, 1, 10, 1);
  expect(Array.from(d)).toEqual([0, 1, 4, 9, 16, 25, 36, 49, 64, 81]);
});

test('keeps only the largest component', () => {
  const m = Uint8Array.from([1, 1, 0, 1, 1, 1, 0, 1]);
  keepLargestComponent(m, 8, 1);
  expect(Array.from(m)).toEqual([0, 0, 0, 1, 1, 1, 0, 0]);
});

test('removes hanger-coloured arm stubs near the cut, but not a same-coloured print lower down', () => {
  const dark = [25, 25, 30], blue = [40, 90, 200];
  // Arm stub: 12x10 block of hanger blue on the shoulder line, right beside the stem's base.
  const arm: Shape = (x, y) => y >= 100 && y < 110 && x >= 152 && x < 164;
  const print: Shape = (x, y) => y >= 250 && y < 270 && x >= 120 && x < 180;
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const inside = shirt(x, y) || hook(x, y);
      const c = hook(x, y) || arm(x, y) || print(x, y) ? blue : dark;
      data.set([...c, inside ? 255 : 0], (y * W + x) * 4);
    }
  const { image } = removeHanger({ width: W, height: H, data });
  expect(alpha(image, 150, 60)).toBe(0); // stem (shape)
  expect(alpha(image, 158, 104)).toBe(0); // arm stub (colour)
  expect(alpha(image, 150, 260)).toBe(255); // print kept
  expect(alpha(image, 100, 200)).toBe(255); // fabric kept
});

test('paints over the bar seen through the neckline with the fabric around it', () => {
  const dark = [25, 25, 30], blue = [40, 90, 200];
  // A 40x6 bar of hanger blue, centred under the hook, inside the body.
  const bar: Shape = (x, y) => y >= 120 && y < 126 && x >= 130 && x < 170;
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const inside = shirt(x, y) || hook(x, y);
      data.set([...(hook(x, y) || bar(x, y) ? blue : dark), inside ? 255 : 0], (y * W + x) * 4);
    }
  const { image } = removeHanger({ width: W, height: H, data });
  const at = (x: number, y: number) => Array.from(image.data.slice((y * W + x) * 4, (y * W + x) * 4 + 4));
  expect(at(150, 123)).toEqual([...dark, 255]); // bar repainted, not a hole
  expect(at(150, 60)[3]).toBe(0); // hook still removed
});

test('removes arm tips poking past the shoulders when the hook itself was not segmented', () => {
  // Diagonal stubs ~4 px thick rising off each shoulder corner, no hook.
  const tip = (cx: number, dir: number): Shape => (x, y) => {
    const t = (x - cx) * dir;
    return t >= 0 && t < 22 && Math.abs(y - (100 - t * 0.4)) < 2.5;
  };
  const left = tip(60, -1), right = tip(240, 1);
  const { image } = removeHanger(mask(W, H, (x, y) => shirt(x, y) || left(x, y) || right(x, y)));
  expect(alpha(image, 48, 95)).toBe(0);
  expect(alpha(image, 252, 95)).toBe(0);
  expect(alpha(image, 150, 200)).toBe(255);
});
