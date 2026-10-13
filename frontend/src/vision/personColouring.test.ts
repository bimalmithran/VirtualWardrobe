import type { LabColor } from '../domain/types';
import type { RGBAImage } from '../image/pixels';
import { rgbToLab } from './color';
import { contrastLevel, fuseColouring, isSkin, ita, readSelf, seasonFor, skinDepth, skinUndertone } from './personColouring';

/** A W×H cutout: transparent background, `hair` rows on top, then skin, then a shirt. */
function person(opts: { skin: [number, number, number]; hair: [number, number, number]; shirt?: [number, number, number] }): RGBAImage {
  const w = 60, h = 100;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (x < 10 || x >= 50) continue; // background stays transparent
      const c = y < 12 ? opts.hair : y < 45 ? opts.skin : (opts.shirt ?? [20, 60, 160]);
      data.set([...c, 255], o);
    }
  }
  return { width: w, height: h, data };
}

const LIGHT_WARM_SKIN: [number, number, number] = [236, 196, 160];
const DEEP_SKIN: [number, number, number] = [120, 78, 52];

describe('isSkin', () => {
  test('accepts light and deep skin, rejects blue, grey and black', () => {
    expect(isSkin(...LIGHT_WARM_SKIN)).toBe(true);
    expect(isSkin(...DEEP_SKIN)).toBe(true);
    expect(isSkin(20, 60, 160)).toBe(false);
    expect(isSkin(128, 128, 128)).toBe(false);
    expect(isSkin(10, 8, 6)).toBe(false);
  });
});

describe('readSelf', () => {
  test('reads the skin colour and the darkness of the hair', () => {
    const reading = readSelf(person({ skin: LIGHT_WARM_SKIN, hair: [25, 20, 18] }))!;
    const expected = rgbToLab(...LIGHT_WARM_SKIN);
    reading.skin.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 1));
    expect(reading.hairL).toBeLessThan(15);
  });

  test('returns null when no skin is visible', () => {
    expect(readSelf(person({ skin: [20, 60, 160], hair: [25, 20, 18] }))).toBeNull();
  });
});

describe('classification', () => {
  test('depth follows the ITA scale', () => {
    expect(skinDepth(rgbToLab(...LIGHT_WARM_SKIN))).toBe('light');
    expect(skinDepth(rgbToLab(...DEEP_SKIN))).toBe('deep');
    expect(ita([50, 0, 10])).toBeCloseTo(0);
  });

  test('yellow-leaning skin reads warm and pink-leaning skin reads cool', () => {
    expect(skinUndertone(rgbToLab(243, 207, 170))).toBe('warm'); // fair peach
    expect(skinUndertone(rgbToLab(241, 194, 180))).toBe('cool'); // fair pink
    expect(skinUndertone(rgbToLab(190, 140, 115))).toBe('neutral');
    expect(skinUndertone(rgbToLab(198, 145, 106))).toBe('warm'); // medium, golden
  });

  test('deep skin is judged against the hue typical of its depth', () => {
    expect(skinUndertone(rgbToLab(95, 60, 45))).toBe('warm'); // reddish-brown
    expect(skinUndertone(rgbToLab(90, 58, 55))).toBe('cool');
  });

  test('contrast compares skin and hair lightness', () => {
    expect(contrastLevel(80, 20)).toBe('high');
    expect(contrastLevel(60, 45)).toBe('low');
    expect(contrastLevel(70, 40)).toBe('medium');
    expect(contrastLevel(70, null)).toBe('medium');
  });

  test('seasons combine undertone, depth and contrast', () => {
    const skin: LabColor = [70, 10, 20];
    expect(seasonFor('warm', 'light', 'medium', skin)).toBe('spring');
    expect(seasonFor('warm', 'deep', 'low', skin)).toBe('autumn');
    expect(seasonFor('cool', 'light', 'low', skin)).toBe('summer');
    expect(seasonFor('cool', 'medium', 'high', skin)).toBe('winter');
  });
});

describe('fuseColouring', () => {
  test('returns null without photos', () => {
    expect(fuseColouring([])).toBeNull();
  });

  test('one oddly lit photo cannot flip the result', () => {
    const warm = { skin: [72, 8, 24] as LabColor, hairL: 20 };
    const odd = { skin: [72, 18, 8] as LabColor, hairL: 20 }; // cool cast from shade
    const c = fuseColouring([warm, warm, odd])!;
    expect(c.undertone).toBe('warm');
    expect(c.photoCount).toBe(3);
    expect(c.palette.length).toBeGreaterThan(0);
  });
});
