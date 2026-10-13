import { EMPTY_PROPORTIONS } from '../domain/types';
import { buildAvatar, placeGarment } from './tryOn';

const avatar = buildAvatar({ heightCm: 170, bodyShape: 'hourglass', proportions: EMPTY_PROPORTIONS });

test('a shirt hangs from the shoulders, centred, wider than the joints', () => {
  const r = placeGarment('tops', 'shirts', { width: 400, height: 440 }, avatar.pose);
  if (!r.ok) throw new Error(r.reason);
  const { x, y, width, height, rotation } = r.placement;
  const span = avatar.pose.leftShoulder.x - avatar.pose.rightShoulder.x;
  expect(width).toBeCloseTo(span * 1.75, 3);
  expect(x + width / 2).toBeCloseTo(avatar.width / 2, 3);
  expect(y).toBeLessThan(avatar.pose.leftShoulder.y);
  expect(height / width).toBeCloseTo(1.1, 3);
  expect(rotation).toBeCloseTo(0, 5);
});

test('a long kurta reaches past the hips while a tee stops above them', () => {
  const kurta = placeGarment('ethnic', 'kurtas', { width: 300, height: 650 }, avatar.pose);
  const tee = placeGarment('tops', 't-shirts', { width: 300, height: 300 }, avatar.pose);
  if (!kurta.ok || !tee.ok) throw new Error('placement failed');
  expect(kurta.placement.y + kurta.placement.height).toBeGreaterThan(avatar.pose.leftHip.y);
  expect(tee.placement.y + tee.placement.height).toBeLessThan(kurta.placement.y + kurta.placement.height);
});

test('tilted shoulders rotate the garment', () => {
  const pose = { ...avatar.pose, leftShoulder: { ...avatar.pose.leftShoulder, y: avatar.pose.leftShoulder.y + 30 } };
  const r = placeGarment('tops', null, { width: 100, height: 100 }, pose);
  expect(r.ok && r.placement.rotation).toBeGreaterThan(0.05);
});

test('reports why it cannot place', () => {
  const hidden = { ...avatar.pose, leftAnkle: { ...avatar.pose.leftAnkle, score: 0.1 } };
  expect(placeGarment('footwear', null, { width: 10, height: 10 }, hidden)).toEqual({ ok: false, reason: expect.stringMatching(/Feet/) });
  expect(placeGarment('accessories', null, { width: 10, height: 10 }, avatar.pose).ok).toBe(false);
});

test('measurements change the avatar', () => {
  const narrow = buildAvatar({ heightCm: 170, bodyShape: 'rectangle', proportions: { ...EMPTY_PROPORTIONS, hipCm: 85 } });
  const wide = buildAvatar({ heightCm: 170, bodyShape: 'rectangle', proportions: { ...EMPTY_PROPORTIONS, hipCm: 115 } });
  expect(wide.pose.leftHip.x - wide.pose.rightHip.x).toBeGreaterThan(narrow.pose.leftHip.x - narrow.pose.rightHip.x);
});
