import { decodePose, letterboxInt32, KEYPOINTS } from './pose';

test('letterbox puts a tall image in the middle, on white, as int32 NHWC', () => {
  const img = { width: 2, height: 4, data: new Uint8Array(2 * 4 * 4).fill(0).map((_, i) => (i % 4 === 3 ? 255 : 10)) };
  const { input, scale, ox, oy } = letterboxInt32(img, 8);
  expect(scale).toBe(2);
  expect([ox, oy]).toEqual([2, 0]);
  expect(input[0]).toBe(255); // padding is white
  expect(input[(0 * 8 + 2) * 3]).toBe(10); // first garment pixel
});

test('keypoints map back from the 192 input to image pixels', () => {
  const out = new Float32Array(17 * 3);
  out[5 * 3] = 0.5; // left shoulder y
  out[5 * 3 + 1] = 0.25; // x
  out[5 * 3 + 2] = 0.9;
  // A 100x200 image letterboxed into 192: scale 0.96, x offset 48.
  const pose = decodePose(out, 192, 0.96, 48, 0);
  expect(Object.keys(pose)).toEqual([...KEYPOINTS]);
  expect(pose.leftShoulder.x).toBeCloseTo((0.25 * 192 - 48) / 0.96, 5);
  expect(pose.leftShoulder.y).toBeCloseTo(100, 5);
  expect(pose.leftShoulder.score).toBeCloseTo(0.9);
});
