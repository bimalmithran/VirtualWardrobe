import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { deleteFile, readBytes } from '../platform/files';
import { AlphaType, ColorType, ImageFormat, Skia } from '@shopify/react-native-skia';

/** Straight (non-premultiplied) RGBA, 4 bytes per pixel, row-major. */
export interface RGBAImage {
  width: number;
  height: number;
  data: Uint8Array;
}

/**
 * Resizes natively (so a 50 MP photo never enters JS), then decodes to RGBA with Skia.
 * Pass both dimensions to stretch to an exact size (model input), or one to keep aspect.
 */
export async function loadRGBA(uri: string, size: { width?: number; height?: number }): Promise<RGBAImage> {
  const ref = await ImageManipulator.manipulate(uri).resize(size).renderAsync();
  // PNG avoids a second round of JPEG artefacts on the image the models see.
  const saved = await ref.saveAsync({ format: SaveFormat.PNG });
  ref.release(); // free the native bitmap now rather than at GC time
  try {
    return decodeToRGBA(await readBytes(saved.uri));
  } finally {
    deleteFile(saved.uri);
  }
}

/** Fit inside a square of `maxSide` without upscaling. */
export async function loadRGBAFit(uri: string, srcWidth: number, srcHeight: number, maxSide: number) {
  const scale = Math.min(1, maxSide / Math.max(srcWidth, srcHeight));
  return loadRGBA(uri, srcWidth >= srcHeight ? { width: Math.round(srcWidth * scale) } : { height: Math.round(srcHeight * scale) });
}

export function decodeToRGBA(encoded: Uint8Array): RGBAImage {
  const image = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(encoded));
  if (!image) throw new Error('Could not decode image');
  try {
    const width = image.width();
    const height = image.height();
    const pixels = image.readPixels(0, 0, {
      width,
      height,
      colorType: ColorType.RGBA_8888,
      alphaType: AlphaType.Unpremul,
    });
    if (!(pixels instanceof Uint8Array)) throw new Error('Could not read image pixels');
    return { width, height, data: pixels };
  } finally {
    image.dispose();
  }
}

export function encodePNG(img: RGBAImage): Uint8Array {
  const image = Skia.Image.MakeImage(
    { width: img.width, height: img.height, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul },
    Skia.Data.fromBytes(img.data),
    img.width * 4,
  );
  if (!image) throw new Error('Could not encode PNG');
  try {
    return image.encodeToBytes(ImageFormat.PNG, 100);
  } finally {
    image.dispose();
  }
}

/**
 * Downscales an encoded image (aspect kept) and re-encodes it as WebP, which keeps alpha
 * at a fraction of PNG's size: a 1024 px cutout PNG of 1-3 MB becomes a ~20-60 KB thumbnail.
 */
export function makeThumbnail(encoded: Uint8Array, maxSide: number, quality = 82): Uint8Array {
  const image = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(encoded));
  if (!image) throw new Error('Could not decode image');
  try {
    const scale = Math.min(1, maxSide / Math.max(image.width(), image.height()));
    const w = Math.max(1, Math.round(image.width() * scale));
    const h = Math.max(1, Math.round(image.height() * scale));
    const surface = Skia.Surface.Make(w, h);
    if (!surface) throw new Error('Could not allocate a thumbnail surface');
    const paint = Skia.Paint();
    paint.setAntiAlias(true);
    surface.getCanvas().drawImageRect(image, Skia.XYWHRect(0, 0, image.width(), image.height()), Skia.XYWHRect(0, 0, w, h), paint);
    surface.flush();
    const snapshot = surface.makeImageSnapshot();
    try {
      return snapshot.encodeToBytes(ImageFormat.WEBP, quality);
    } finally {
      snapshot.dispose();
      surface.dispose();
    }
  } finally {
    image.dispose();
  }
}
