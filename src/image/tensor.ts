import type { RGBAImage } from './pixels';

/** RGBA -> planar float32 [1, 3, H, W], normalised as (v/255 - mean) / std. */
export function rgbaToCHW(img: RGBAImage, mean: readonly number[], std: readonly number[]): Float32Array {
  const { width, height, data } = img;
  const plane = width * height;
  const out = new Float32Array(3 * plane);
  for (let c = 0; c < 3; c++) {
    const m = mean[c];
    const s = 255 * std[c];
    const base = c * plane;
    for (let i = 0; i < plane; i++) out[base + i] = data[i * 4 + c] / s - m / std[c];
  }
  return out;
}

/** Bilinear resample of a single-channel float map. */
export function resizeMap(src: Float32Array, sw: number, sh: number, dw: number, dh: number): Float32Array {
  const out = new Float32Array(dw * dh);
  const xr = sw / dw;
  const yr = sh / dh;
  for (let y = 0; y < dh; y++) {
    const sy = Math.max(0, (y + 0.5) * yr - 0.5);
    const y0 = Math.min(sh - 1, Math.floor(sy));
    const y1 = Math.min(sh - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < dw; x++) {
      const sx = Math.max(0, (x + 0.5) * xr - 0.5);
      const x0 = Math.min(sw - 1, Math.floor(sx));
      const x1 = Math.min(sw - 1, x0 + 1);
      const fx = sx - x0;
      const top = src[y0 * sw + x0] * (1 - fx) + src[y0 * sw + x1] * fx;
      const bottom = src[y1 * sw + x0] * (1 - fx) + src[y1 * sw + x1] * fx;
      out[y * dw + x] = top * (1 - fy) + bottom * fy;
    }
  }
  return out;
}

/**
 * Box-filter downsample of an RGBA source region into an RGB output, compositing
 * transparent pixels onto `bg`. Used to produce CLIP-style centre crops.
 */
export function cropResizeOnBackground(
  img: RGBAImage,
  crop: { x: number; y: number; w: number; h: number },
  dw: number,
  dh: number,
  bg: [number, number, number] = [255, 255, 255],
): RGBAImage {
  const out = new Uint8Array(dw * dh * 4);
  const sx = crop.w / dw;
  const sy = crop.h / dh;
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor(crop.y + y * sy);
    const y1 = Math.max(y0 + 1, Math.floor(crop.y + (y + 1) * sy));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor(crop.x + x * sx);
      const x1 = Math.max(x0 + 1, Math.floor(crop.x + (x + 1) * sx));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1 && yy < img.height; yy++) {
        for (let xx = x0; xx < x1 && xx < img.width; xx++) {
          const i = (yy * img.width + xx) * 4;
          const a = img.data[i + 3] / 255;
          r += img.data[i] * a + bg[0] * (1 - a);
          g += img.data[i + 1] * a + bg[1] * (1 - a);
          b += img.data[i + 2] * a + bg[2] * (1 - a);
          n++;
        }
      }
      const o = (y * dw + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = 255;
    }
  }
  return { width: dw, height: dh, data: out };
}
