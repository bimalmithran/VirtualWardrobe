import { EMBEDDING_DIM, MODELS } from '../config/models';
import type { RGBAImage } from '../image/pixels';
import { cropResizeOnBackground, rgbaToCHW } from '../image/tensor';
import { modelManager } from '../ml/modelManager';

/**
 * MobileCLIP-S0 image tower. Mirrors the HF CLIPFeatureExtractor config: resize the
 * shortest edge to 256, centre-crop 256x256, rescale to 0..1, no mean/std.
 * The cutout is flattened onto white so the background can't leak into the vector.
 */
export async function embedGarment(cutout: RGBAImage): Promise<Float32Array> {
  const spec = MODELS.embedding;
  const size = spec.inputSize;
  const side = Math.min(cutout.width, cutout.height);
  const crop = {
    x: Math.floor((cutout.width - side) / 2),
    y: Math.floor((cutout.height - side) / 2),
    w: side,
    h: side,
  };
  const input = rgbaToCHW(cropResizeOnBackground(cutout, crop, size, size), spec.mean, spec.std);

  const vector = await modelManager.withSession('embedding', async (session, ort) => {
    const results = await session.run({
      [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, size, size]),
    });
    const name = session.outputNames.includes('image_embeds') ? 'image_embeds' : session.outputNames[0];
    const v = new Float32Array(results[name].data as Float32Array);
    for (const key of Object.keys(results)) results[key].dispose?.();
    return v;
  });

  if (vector.length !== EMBEDDING_DIM) {
    throw new Error(`Expected a ${EMBEDDING_DIM}-d embedding, got ${vector.length}`);
  }
  return l2normalise(vector);
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
