import type { BodyShape, Category, DigitalTwin, GarmentShape } from '../domain/types';

export type Silhouette = 'fitted' | 'flared' | 'boxy' | 'straight' | 'longline' | 'cropped' | 'wide-leg' | 'tapered';

export interface CutFit {
  silhouette: Silhouette;
  /** 0..100 */
  score: number;
  notes: string[];
}

/** Reads a silhouette from mask geometry; the category decides which reading applies. */
export function silhouetteOf(category: Category | null, shape: GarmentShape): Silhouette {
  if (category === 'bottoms') {
    if (shape.taper >= 1.12) return 'wide-leg';
    if (shape.taper <= 0.72) return 'tapered';
    return 'straight';
  }
  if (category === 'tops' && shape.aspect < 0.85) return 'cropped';
  if (shape.aspect >= 1.55 && category !== 'footwear') return 'longline';
  if (shape.waistDefinition >= 0.12) return 'fitted';
  if (shape.taper >= 1.15) return 'flared';
  if (shape.fill >= 0.8 && shape.taper > 0.9 && shape.taper < 1.1) return 'boxy';
  return 'straight';
}

/**
 * Style-guide rules: how each silhouette works on each body shape, in points around a
 * neutral 70. Tops and bottoms differ, e.g. pear shapes balance with wide-leg bottoms but
 * not with flared tops.
 */
const TOPS: Record<BodyShape, Partial<Record<Silhouette, [number, string]>>> = {
  hourglass: { fitted: [20, 'Fitted cuts follow your defined waist.'], boxy: [-20, 'Boxy cuts hide your waist.'], flared: [5, 'A gentle flare keeps your waist visible.'] },
  rectangle: { fitted: [15, 'A shaped cut creates waist definition.'], flared: [10, 'A flared hem adds curve.'], boxy: [-5, 'Boxy cuts keep your frame straight; belt it.'] },
  triangle: { boxy: [10, 'Structure on top balances fuller hips.'], fitted: [5, 'Fitted tops are fine; add detail at the shoulder.'], flared: [-15, 'A flared top widens the hip line.'], cropped: [5, 'Cropped tops draw the eye up.'] },
  'inverted-triangle': { boxy: [-15, 'Boxy shoulders add width up top.'], flared: [10, 'A flared hem balances broader shoulders.'], fitted: [5, 'Simple fitted cuts work.'], longline: [10, 'Longline shapes lengthen and balance.'] },
  oval: { longline: [20, 'Longline cuts skim the midsection.'], straight: [10, 'Straight cuts drape cleanly.'], fitted: [-15, 'Tight cuts cling at the middle.'], cropped: [-20, 'Cropped tops cut you at the widest point.'], boxy: [0, 'Boxy is fine if the fabric drapes.'] },
};

const BOTTOMS: Record<BodyShape, Partial<Record<Silhouette, [number, string]>>> = {
  hourglass: { tapered: [10, 'Tapered bottoms show your curves.'], straight: [10, 'Straight legs keep you balanced.'], 'wide-leg': [5, 'Wide legs work with a fitted top.'] },
  rectangle: { 'wide-leg': [10, 'Wide legs add volume at the hip.'], tapered: [5, 'Tapered cuts are an easy match.'] },
  triangle: { 'wide-leg': [15, 'Wide or straight legs balance the hips.'], straight: [15, 'Straight legs balance the hips.'], tapered: [-15, 'Tapered legs emphasise the hips.'] },
  'inverted-triangle': { 'wide-leg': [20, 'Volume below balances your shoulders.'], tapered: [-15, 'Skinny bottoms exaggerate broad shoulders.'] },
  oval: { straight: [15, 'Straight legs lengthen the line.'], tapered: [-5, 'Tapered legs can look top-heavy.'], 'wide-leg': [5, 'Wide legs work with a longline top.'] },
};

export function cutFit(
  category: Category | null,
  shape: GarmentShape | null,
  twin: Pick<DigitalTwin, 'bodyShape' | 'heightCm' | 'proportions'> | null,
): CutFit | null {
  if (!shape || !twin || !category || category === 'accessories' || category === 'footwear') return null;
  const silhouette = silhouetteOf(category, shape);
  const table = category === 'bottoms' ? BOTTOMS : TOPS;
  const rule = table[twin.bodyShape][silhouette];
  let score = 70 + (rule?.[0] ?? 0);
  const notes = rule ? [rule[1]] : [`A ${silhouette} cut is a neutral choice for your shape.`];

  if (silhouette === 'longline' && twin.heightCm < 158) {
    score -= 10;
    notes.push('Very long cuts can overwhelm a petite frame; try it with heels or a slit.');
  }
  if (silhouette === 'cropped' && twin.proportions.torso === 'long') {
    score += 5;
    notes.push('Cropped lengths balance a long torso.');
  }
  if (silhouette === 'longline' && twin.proportions.torso === 'short') {
    score -= 5;
    notes.push('Long tops shorten the legs on a short torso; tuck or belt.');
  }
  return { silhouette, score: Math.max(0, Math.min(100, score)), notes };
}
