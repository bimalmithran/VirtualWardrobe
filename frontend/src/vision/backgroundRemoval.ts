import { MODELS, type ModelSpec } from '../config/models';
import { loadRGBA, type RGBAImage } from '../image/pixels';
import { resizeMap, rgbaToCHW } from '../image/tensor';
import type { ModelRunner } from '../ml/modelRunner';

export interface CutoutResult {
  cutout: RGBAImage; // working image with the mask applied as alpha
  coverage: number; // fraction of pixels kept as foreground
}

export interface BackgroundRemover {
  removeBackground(sourceUri: string, working: RGBAImage): Promise<CutoutResult>;
}

/**
 * RMBG-1.4 / ISNet: stretch to 1024x1024, predict a saliency map, min-max normalise it,
 * and resample it back onto the working image as the alpha channel.
 */
export class SaliencyBackgroundRemover implements BackgroundRemover {
  constructor(
    private readonly runner: ModelRunner,
    private readonly spec: ModelSpec = MODELS.segmentation,
  ) {}

  async removeBackground(sourceUri: string, working: RGBAImage): Promise<CutoutResult> {
    const raw = await this.predictSaliency(sourceUri);
    const mh = raw.dims[raw.dims.length - 2];
    const mw = raw.dims[raw.dims.length - 1];
    normaliseInPlace(raw.data);

    const mask = resizeMap(raw.data, mw, mh, working.width, working.height);
    const out = new Uint8Array(working.data);
    let kept = 0;
    for (let i = 0; i < mask.length; i++) {
      const a = Math.round(Math.min(1, Math.max(0, mask[i])) * 255);
      out[i * 4 + 3] = a;
      if (a > 127) kept++;
    }
    return {
      cutout: { width: working.width, height: working.height, data: out },
      coverage: kept / mask.length,
    };
  }

  /**
   * Decodes straight at model resolution from the original file (sharper than upscaling
   * the working copy). Kept separate so the ~12 MB input tensor is unreachable, and
   * collectable, before post-processing allocates the mask.
   */
  private async predictSaliency(sourceUri: string) {
    const size = this.spec.inputSize;
    const input = rgbaToCHW(await loadRGBA(sourceUri, { width: size, height: size }), this.spec.mean, this.spec.std);
    return this.runner.run(this.spec.key, { input, dims: [1, 3, size, size] });
  }
}

function normaliseInPlace(m: Float32Array) {
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < m.length; i++) {
    if (m[i] < min) min = m[i];
    if (m[i] > max) max = m[i];
  }
  const range = max - min || 1;
  for (let i = 0; i < m.length; i++) m[i] = (m[i] - min) / range;
}
