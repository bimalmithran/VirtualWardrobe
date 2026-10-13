import type { BodyShape, Proportions } from '../domain/types';

/**
 * Body shape from circumferences, using the ratio rules common to fit guides (e.g. the
 * FFIT classification): compare bust and hips, and how defined the waist is between them.
 * Returns null unless bust, waist and hips are all given.
 */
export function inferBodyShape({ bustCm, waistCm, hipCm }: Proportions): BodyShape | null {
  if (!bustCm || !waistCm || !hipCm) return null;
  const smaller = Math.min(bustCm, hipCm);
  if (waistCm >= bustCm && waistCm >= hipCm * 0.95) return 'oval';
  const balanced = Math.abs(bustCm - hipCm) <= 0.05 * hipCm;
  if (balanced && waistCm <= 0.75 * smaller) return 'hourglass';
  if (hipCm > bustCm * 1.05) return 'triangle';
  if (bustCm > hipCm * 1.05) return 'inverted-triangle';
  return 'rectangle';
}

/** Cut advice per body shape, used to score a garment's silhouette for the wearer. */
export const SHAPE_GUIDE: Record<BodyShape, { flatters: string; avoid: string }> = {
  rectangle: { flatters: 'belted, peplum and wrap cuts that create a waist', avoid: 'boxy, straight-cut pieces head to toe' },
  triangle: { flatters: 'structured shoulders, bright tops and A-line or straight bottoms', avoid: 'skinny bottoms with clingy, plain tops' },
  'inverted-triangle': { flatters: 'V-necks, soft shoulders and fuller or wide-leg bottoms', avoid: 'padded shoulders and boat necks' },
  hourglass: { flatters: 'fitted, waist-defining cuts and wrap styles', avoid: 'shapeless, oversized cuts that hide the waist' },
  oval: { flatters: 'longline, open layers, V-necks and straight-leg bottoms', avoid: 'tight waistbands and cropped, clingy tops' },
};
