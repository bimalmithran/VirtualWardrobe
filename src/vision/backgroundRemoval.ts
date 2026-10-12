import { MODELS } from '../config/models';
import { loadRGBA, type RGBAImage } from '../image/pixels';
import { resizeMap, rgbaToCHW } from '../image/tensor';
import { modelManager } from '../ml/modelManager';

export interface CutoutResult {
  cutout: RGBAImage; // working image with the mask applied as alpha
  coverage: number; // fraction of pixels kept as foreground
}

/**
 * RMBG-1.4 / ISNet: stretch to 1024x1024, predict a saliency map, min-max normalise it,
 * and resample it back onto the working image as the alpha channel.
 */
export async function removeBackground(sourceUri: string, working: RGBAImage): Promise<CutoutResult> {
  const spec = MODELS.segmentation;
  const size = spec.inputSize;

  let input: Float32Array | null = rgbaToCHW(
    await loadRGBA(sourceUri, { width: size, height: size }),
    spec.mean,
    spec.std,
  );

  const raw = await modelManager.withSession('segmentation', async (session, ort) => {
    const feeds = { [session.inputNames[0]]: new ort.Tensor('float32', input!, [1, 3, size, size]) };
    const results = await session.run(feeds);
    const out = results[session.outputNames[0]];
    // Copy out so the native-backed output buffers can be collected straight away.
    const data = new Float32Array(out.data as Float32Array);
    for (const name of Object.keys(results)) results[name].dispose?.();
    return { data, dims: out.dims };
  });
  input = null;

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

function normaliseInPlace(m: Float32Array) {
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < m.length; i++) {
    if (m[i] < min) min = m[i];
    if (m[i] > max) max = m[i];
  }
  const range = max - min || 1;
  for (let i = 0; i < m.length; i++) m[i] = (m[i] - min) / range;
}
