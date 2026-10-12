/** sRGB <-> CIELAB (D65). Lab makes K-Means distances match perceived colour difference. */

export type Lab = [number, number, number];

const srgbToLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const linearToSrgb = (v: number) => {
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, c)) * 255);
};

const XN = 0.95047, YN = 1.0, ZN = 1.08883;
const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
const fInv = (t: number) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));

export function rgbToLab(r: number, g: number, b: number): Lab {
  const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
  const x = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / XN;
  const y = (0.2126729 * R + 0.7151522 * G + 0.072175 * B) / YN;
  const z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / ZN;
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function labToRgb([L, a, b]: Lab): [number, number, number] {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const x = fInv(fx) * XN, y = fInv(fy) * YN, z = fInv(fz) * ZN;
  const R = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  const G = -0.969266 * x + 1.8760108 * y + 0.041556 * z;
  const B = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;
  return [linearToSrgb(R), linearToSrgb(G), linearToSrgb(B)];
}

export function rgbToHex([r, g, b]: [number, number, number]) {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Lightness, chroma, hue in degrees. */
export function labToLch([L, a, b]: Lab) {
  const C = Math.hypot(a, b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { L, C, h };
}

export function colorName(hex: string): string {
  const { L, C, h } = labToLch(rgbToLab(...hexToRgb(hex)));
  if (C < 8) {
    if (L > 90) return 'white';
    if (L > 70) return 'light grey';
    if (L > 35) return 'grey';
    if (L > 15) return 'charcoal';
    return 'black';
  }
  const tone = L > 75 ? 'light ' : L < 35 ? 'dark ' : '';
  // Hue bands calibrated against CIELAB LCh hues of reference colours
  // (e.g. red 40°, orange 73°, yellow 103°, green 136°, cyan 196°, blue 306°, purple 328°).
  if (h >= 340 || h < 20) return L < 40 ? 'burgundy' : tone + 'pink';
  if (h < 50) return L < 35 ? 'maroon' : tone + 'red';
  if (h < 85) return C < 35 ? (L > 65 ? 'tan' : 'brown') : L < 45 ? 'brown' : tone + 'orange';
  if (h < 115) return C < 30 && L > 70 ? 'beige' : L < 60 ? 'olive' : tone + 'yellow';
  if (h < 165) return tone + 'green';
  if (h < 220) return tone + 'teal';
  if (h < 310) return L < 20 ? 'navy' : h < 260 ? 'sky blue' : tone + 'blue';
  return tone + 'purple';
}
