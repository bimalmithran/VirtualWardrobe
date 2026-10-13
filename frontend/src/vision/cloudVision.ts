import { Buffer } from 'buffer';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { decodeToRGBA, encodePNG, type RGBAImage } from '../image/pixels';
import { letterboxOnBackground } from '../image/tensor';
import type { ExecutionPlan } from '../ml/capabilities';
import type { BackgroundRemover, CutoutResult } from './backgroundRemoval';
import type { GarmentEmbedder } from './embedding';

/** The server's vision endpoints (POST /api/vision/segment and /embed). */
export interface VisionRemote {
  segment(imageBase64: string): Promise<{ maskPngBase64: string; width: number; height: number }>;
  embed(imageBase64: string): Promise<Float32Array>;
}

/**
 * Background removal on the server, for phones below the on-device threshold. Sends a JPEG
 * of the working image (≤1024 px, ~200-400 KB) and applies the returned soft mask locally.
 */
export class CloudBackgroundRemover implements BackgroundRemover {
  constructor(private readonly remote: VisionRemote) {}

  async removeBackground(sourceUri: string, working: RGBAImage): Promise<CutoutResult> {
    const ref = await ImageManipulator.manipulate(sourceUri).resize({ width: working.width, height: working.height }).renderAsync();
    const jpeg = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.85, base64: true });
    ref.release();
    const res = await this.remote.segment(jpeg.base64!);
    const mask = decodeToRGBA(new Uint8Array(Buffer.from(res.maskPngBase64, 'base64')));
    if (mask.width !== working.width || mask.height !== working.height) {
      throw new Error(`Cloud mask is ${mask.width}x${mask.height}, expected ${working.width}x${working.height}`);
    }
    const out = new Uint8Array(working.data);
    let kept = 0;
    for (let i = 0; i < mask.width * mask.height; i++) {
      const a = mask.data[i * 4]; // grey PNG decodes to R = G = B
      out[i * 4 + 3] = a;
      if (a > 127) kept++;
    }
    return { cutout: { width: working.width, height: working.height, data: out }, coverage: kept / (mask.width * mask.height) };
  }
}

/** Style vector on the server. Sends the same 256² letterboxed image the phone would feed the model. */
export class CloudEmbedder implements GarmentEmbedder {
  constructor(private readonly remote: VisionRemote) {}

  async embed(cutout: RGBAImage): Promise<Float32Array> {
    const square = letterboxOnBackground(cutout, 256);
    return this.remote.embed(Buffer.from(encodePNG(square)).toString('base64'));
  }
}

/**
 * Picks the device or cloud implementation per call from the current execution plan, so
 * a consent change or capability probe takes effect on the next photo. If the cloud is
 * unreachable and the phone has a runtime, it falls back to the phone.
 */
export class RoutedBackgroundRemover implements BackgroundRemover {
  constructor(
    private readonly plan: () => ExecutionPlan,
    private readonly device: BackgroundRemover,
    private readonly cloud: BackgroundRemover | null,
    private readonly deviceUsable: () => boolean,
  ) {}

  async removeBackground(sourceUri: string, working: RGBAImage) {
    if (this.cloud && this.plan().segmentation === 'cloud') {
      try {
        return await this.cloud.removeBackground(sourceUri, working);
      } catch (e) {
        if (!this.deviceUsable()) throw e;
        console.warn('Cloud segmentation failed; running on the phone', e);
      }
    }
    return this.device.removeBackground(sourceUri, working);
  }
}

export class RoutedEmbedder implements GarmentEmbedder {
  constructor(
    private readonly plan: () => ExecutionPlan,
    private readonly device: GarmentEmbedder,
    private readonly cloud: GarmentEmbedder | null,
    private readonly deviceUsable: () => boolean,
  ) {}

  async embed(cutout: RGBAImage) {
    if (this.cloud && this.plan().embedding === 'cloud') {
      try {
        return await this.cloud.embed(cutout);
      } catch (e) {
        if (!this.deviceUsable()) throw e;
        console.warn('Cloud embedding failed; running on the phone', e);
      }
    }
    return this.device.embed(cutout);
  }
}
