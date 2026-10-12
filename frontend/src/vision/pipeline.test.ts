import type { RGBAImage } from '../image/pixels';
import { GarmentPipeline, type PipelineStages } from './pipeline';

// Skia-backed decode/encode is native; the pipeline's ordering logic is what's under test.
jest.mock('../image/pixels', () => ({
  loadRGBAFit: jest.fn(async () => ({ width: 2, height: 2, data: new Uint8Array(16) })),
  encodePNG: jest.fn(() => new Uint8Array([0x89, 0x50])),
}));

const working: RGBAImage = { width: 2, height: 2, data: new Uint8Array(16) };
const photo = { uri: 'file:///p.jpg', width: 4000, height: 3000 };

function stages(overrides: Partial<PipelineStages> = {}): PipelineStages {
  return {
    removeBackground: { removeBackground: jest.fn(async () => ({ cutout: working, coverage: 0.4 })) },
    embedder: { embed: jest.fn(async () => new Float32Array(512)) },
    extractPalette: jest.fn(() => [{ hex: '#C82828', share: 0.8 }, { hex: '#FFFFFF', share: 0.2 }]),
    assessQuality: jest.fn(() => ({ brightness: 120, contrast: 40, sharpness: 200, issues: [] })),
    ...overrides,
  };
}

beforeAll(() => {
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 0)) as typeof requestAnimationFrame;
});

test('runs stages in order and takes the dominant colour as primary', async () => {
  const s = stages();
  const seen: string[] = [];
  const result = await new GarmentPipeline(s).process(photo, working, { embed: true, onStage: (st) => seen.push(st) });
  expect(seen).toEqual(['segmentation', 'color', 'embedding']);
  expect(result.colorHex).toBe('#C82828');
  expect(result.embedding).toHaveLength(512);
});

test('skips the embedding model when the mode does not need it', async () => {
  const s = stages();
  const result = await new GarmentPipeline(s).process(photo, working, { embed: false });
  expect(s.embedder.embed).not.toHaveBeenCalled();
  expect(result.embedding).toBeNull();
});

test.each([
  [0.01, /No garment found/],
  [0.99, /Could not separate/],
])('rejects a cutout covering %p of the frame', async (coverage: number, message: RegExp) => {
  const s = stages({ removeBackground: { removeBackground: async () => ({ cutout: working, coverage }) } });
  await expect(new GarmentPipeline(s).process(photo, working, { embed: true })).rejects.toThrow(message);
  expect(s.extractPalette).not.toHaveBeenCalled();
});

test('inspect runs the junk filter on the bounded working copy', async () => {
  const s = stages();
  const { quality } = await new GarmentPipeline(s).inspect(photo);
  expect(s.assessQuality).toHaveBeenCalledTimes(1);
  expect(quality.issues).toEqual([]);
});
