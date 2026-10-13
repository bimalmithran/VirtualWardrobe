import { EMBEDDING_DIM, MODELS, type ModelSpec } from '../config/models';
import type { RGBAImage } from '../image/pixels';
import { letterboxOnBackground, rgbaToCHW } from '../image/tensor';
import type { ModelRunner } from '../ml/modelRunner';

export interface GarmentEmbedder {
  /** Returns a unit-length style vector for a background-removed garment. */
  embed(cutout: RGBAImage): Promise<Float32Array>;
}

/**
 * MobileCLIP-S0 image tower: 256x256 input, rescaled to 0..1, no mean/std. The cutout is
 * letterboxed (aspect kept) onto white rather than centre-cropped, so a tall kurta keeps
 * its hem and a wide shirt its sleeves. The server's cloud embedder does exactly the same.
 */
export class MobileClipEmbedder implements GarmentEmbedder {
  constructor(
    private readonly runner: ModelRunner,
    private readonly spec: ModelSpec = MODELS.embedding,
  ) {}

  async embed(cutout: RGBAImage): Promise<Float32Array> {
    const size = this.spec.inputSize;
    const input = rgbaToCHW(letterboxOnBackground(cutout, size), this.spec.mean, this.spec.std);
    const { data } = await this.runner.run(this.spec.key, {
      input,
      dims: [1, 3, size, size],
      pickOutput: (names) => (names.includes('image_embeds') ? 'image_embeds' : names[0]),
    });
    if (data.length !== EMBEDDING_DIM) {
      throw new Error(`Expected a ${EMBEDDING_DIM}-d embedding, got ${data.length}`);
    }
    return l2normalise(data);
  }
}

function l2normalise(v: Float32Array) {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

/** Vectors are unit length, so cosine similarity is just the dot product. */
export function cosine(a: Float32Array, b: Float32Array) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
