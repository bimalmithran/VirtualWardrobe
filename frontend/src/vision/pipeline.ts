import { WORKING_MAX_SIDE } from '../config/models';
import type { GarmentShape, PaletteEntry, Pattern } from '../domain/types';
import { encodePNG, loadRGBAFit, type RGBAImage } from '../image/pixels';
import type { BackgroundRemover } from './backgroundRemoval';
import type { PaletteExtractor } from './colorExtraction';
import type { GarmentEmbedder } from './embedding';
import { measureShape, tightCrop } from './garmentShape';
import { detectPattern } from './pattern';
import type { QualityReport } from './junkFilter';

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
  pattern: Pattern;
  shape: GarmentShape | null;
  coverage: number;
  timingsMs: Partial<Record<Stage, number>>;
}

export interface ProcessOptions {
  embed: boolean;
  onStage?: (stage: Stage) => void;
}

/** The pipeline's collaborators. Each one is replaceable on its own (e.g. a different model). */
export interface PipelineStages {
  removeBackground: BackgroundRemover;
  embedder: GarmentEmbedder;
  extractPalette: PaletteExtractor;
  assessQuality: (img: RGBAImage) => QualityReport;
}

/** Fraction of the frame the garment must cover for the cutout to be trusted. */
const MIN_COVERAGE = 0.03;
const MAX_COVERAGE = 0.97;

/** Orders the on-device stages. It knows the sequence and nothing about how each stage works. */
export class GarmentPipeline {
  constructor(private readonly stages: PipelineStages) {}

  /** Step 1: decode a bounded working copy and run the junk filter on it. */
  async inspect(photo: Photo): Promise<{ working: RGBAImage; quality: QualityReport }> {
    const working = await loadRGBAFit(photo.uri, photo.width, photo.height, WORKING_MAX_SIDE);
    return { working, quality: this.stages.assessQuality(working) };
  }

  /** Step 2: cutout, palette, and (optionally) the embedding. Each stage yields to the UI first. */
  async process(photo: Photo, working: RGBAImage, opts: ProcessOptions): Promise<ProcessedGarment> {
    const timingsMs: ProcessedGarment['timingsMs'] = {};
    const timed = async <T,>(stage: Stage, fn: () => Promise<T> | T): Promise<T> => {
      opts.onStage?.(stage);
      await nextFrame();
      const t0 = Date.now();
      const result = await fn();
      timingsMs[stage] = Date.now() - t0;
      return result;
    };

    const { cutout, coverage } = await timed('segmentation', () =>
      this.stages.removeBackground.removeBackground(photo.uri, working),
    );
    if (coverage < MIN_COVERAGE || coverage > MAX_COVERAGE) {
      throw new Error(
        coverage < MIN_COVERAGE
          ? 'No garment found in the photo. Move closer so it fills most of the frame.'
          : 'Could not separate the garment from the background. Try a plain, contrasting surface.',
      );
    }

    // Store and analyse only the garment's box: smaller PNGs, bigger thumbnails.
    const garment = tightCrop(cutout);
    const palette = await timed('color', () => this.stages.extractPalette(garment));
    if (palette.length === 0) throw new Error('Could not extract a colour from the garment.');
    const significant = palette.filter((p) => p.share >= 0.12).length;
    const { pattern } = detectPattern(garment, significant);
    const shape = measureShape(garment);

    const embedding = opts.embed ? await timed('embedding', () => this.stages.embedder.embed(garment)) : null;

    return { png: encodePNG(garment), colorHex: palette[0].hex, palette, embedding, pattern, shape, coverage, timingsMs };
  }
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
