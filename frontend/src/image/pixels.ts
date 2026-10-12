import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';
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
  const tmp = new File(saved.uri);
  try {
    return decodeToRGBA(await tmp.bytes());
  } finally {
    if (tmp.exists) tmp.delete();
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
