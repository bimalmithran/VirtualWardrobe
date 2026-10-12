import { WORKING_MAX_SIDE } from '../config/models';
import { encodePNG, loadRGBAFit, type RGBAImage } from '../image/pixels';
import { removeBackground } from './backgroundRemoval';
import { extractPalette, type PaletteEntry } from './colorExtraction';
import { embedGarment } from './embedding';
import { assessQuality, type QualityReport } from './junkFilter';

export interface Photo {
  uri: string;
  width: number;
  height: number;
}

export type Stage = 'segmentation' | 'color' | 'embedding';

export interface ProcessedGarment {
  png: Uint8Array;
  colorHex: string;
  palette: PaletteEntry[];
  embedding: Float32Array | null;
  coverage: number;
  timingsMs: Partial<Record<Stage, number>>;
}

/** Fraction of the frame the garment must cover for the cutout to be trusted. */
const MIN_COVERAGE = 0.03;
const MAX_COVERAGE = 0.97;

/** Step 1: decode a bounded working copy and run the junk filter on it. */
export async function inspectPhoto(photo: Photo): Promise<{ working: RGBAImage; quality: QualityReport }> {
  const working = await loadRGBAFit(photo.uri, photo.width, photo.height, WORKING_MAX_SIDE);
  return { working, quality: assessQuality(working) };
}

/** Step 2: the on-device pipeline. Each stage yields to the UI first so progress can render. */
export async function processGarment(
  photo: Photo,
  working: RGBAImage,
  opts: { embed: boolean; onStage?: (stage: Stage) => void },
): Promise<ProcessedGarment> {
  const timingsMs: ProcessedGarment['timingsMs'] = {};
  const timed = async <T,>(stage: Stage, fn: () => Promise<T> | T): Promise<T> => {
    opts.onStage?.(stage);
    await nextFrame();
    const t0 = Date.now();
    const result = await fn();
    timingsMs[stage] = Date.now() - t0;
    return result;
  };

  const { cutout, coverage } = await timed('segmentation', () => removeBackground(photo.uri, working));
  if (coverage < MIN_COVERAGE || coverage > MAX_COVERAGE) {
    throw new Error(
      coverage < MIN_COVERAGE
        ? 'No garment found in the photo. Move closer so it fills most of the frame.'
        : 'Could not separate the garment from the background. Try a plain, contrasting surface.',
    );
  }

  const palette = await timed('color', () => extractPalette(cutout));
  if (palette.length === 0) throw new Error('Could not extract a colour from the garment.');

  const embedding = opts.embed ? await timed('embedding', () => embedGarment(cutout)) : null;

  return { png: encodePNG(cutout), colorHex: palette[0].hex, palette, embedding, coverage, timingsMs };
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
