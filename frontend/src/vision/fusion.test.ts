import { fuseEmbeddings, fusePalettes, fuseViews } from './fusion';

const unit = (...v: number[]) => {
  const n = Math.hypot(...v);
  return new Float32Array(v.map((x) => x / n));
};

describe('fusePalettes', () => {
  test('a single palette comes back with the same primary colour', () => {
    const fused = fusePalettes([[{ hex: '#1E3A8A', share: 0.7 }, { hex: '#FFFFFF', share: 0.3 }]]);
    expect(fused[0].hex).toBe('#1E3A8A');
    expect(fused[0].share).toBeCloseTo(0.7);
  });

  test('the same colour under different light merges into one cluster', () => {
    // A navy shirt shot in shade and in daylight, with a white logo.
    const fused = fusePalettes([
      [{ hex: '#1E3A8A', share: 0.8 }, { hex: '#FFFFFF', share: 0.2 }],
      [{ hex: '#24418F', share: 0.85 }, { hex: '#F5F5F5', share: 0.15 }],
    ]);
    expect(fused).toHaveLength(2);
    expect(fused[0].share).toBeCloseTo(0.825);
    expect(fused.reduce((s, e) => s + e.share, 0)).toBeCloseTo(1);
  });

  test('one badly lit photo cannot flip the primary colour', () => {
    // Two photos agree the garment is mostly red; one shot is dominated by a dark shadow.
    const fused = fusePalettes([
      [{ hex: '#C62828', share: 0.9 }, { hex: '#202020', share: 0.1 }],
      [{ hex: '#C62828', share: 0.85 }, { hex: '#202020', share: 0.15 }],
      [{ hex: '#202020', share: 0.6 }, { hex: '#C62828', share: 0.4 }],
    ]);
    expect(fused[0].hex).toBe('#C62828');
  });

  test('each photo counts equally, however many clusters it has', () => {
    const fused = fusePalettes([
      [{ hex: '#000000', share: 1 }],
      [
        { hex: '#FF0000', share: 0.25 },
        { hex: '#00FF00', share: 0.25 },
        { hex: '#0000FF', share: 0.25 },
        { hex: '#FFFF00', share: 0.25 },
      ],
    ]);
    expect(fused[0]).toEqual({ hex: '#000000', share: 0.5 });
  });

  test('ignores empty palettes and caps the result at five colours', () => {
    expect(fusePalettes([[], []])).toEqual([]);
    const many = ['#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF'];
    const fused = fusePalettes([many.map((hex) => ({ hex, share: 1 / many.length }))]);
    expect(fused).toHaveLength(5);
    expect(fused.reduce((s, e) => s + e.share, 0)).toBeCloseTo(1);
  });
});

describe('fuseEmbeddings', () => {
  test('returns the normalised mean of the views', () => {
    const fused = fuseEmbeddings([unit(1, 0), unit(0, 1)])!;
    expect(fused[0]).toBeCloseTo(Math.SQRT1_2);
    expect(fused[1]).toBeCloseTo(Math.SQRT1_2);
  });

  test('skips views without an embedding and returns null when there are none', () => {
    expect(Array.from(fuseEmbeddings([null, unit(3, 4)])!)).toEqual([0.6000000238418579, 0.800000011920929]);
    expect(fuseEmbeddings([null])).toBeNull();
  });
});

test('fuseViews takes the primary colour from the fused palette', () => {
  const fused = fuseViews([
    { palette: [{ hex: '#1E3A8A', share: 1 }], embedding: unit(1, 0) },
    { palette: [{ hex: '#24418F', share: 1 }], embedding: null },
  ]);
  expect(fused.colorHex).toBe(fused.palette[0].hex);
  expect(fused.palette).toHaveLength(1);
  expect(Array.from(fused.embedding!)).toEqual([1, 0]);
});

test('fuseViews refuses views with no colour at all', () => {
  expect(() => fuseViews([{ palette: [], embedding: null }])).toThrow();
});
