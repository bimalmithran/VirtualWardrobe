import type { BodyShape, Category, DigitalTwin } from '../domain/types';
import { MIN_SCORE, type Keypoint, type Pose } from '../vision/pose';

/** Where to draw a garment cutout over a person, in the person image's pixels. */
export interface Placement {
  /** Top-left of the unrotated garment rectangle. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Radians, about (pivotX, pivotY); follows the shoulder or hip line. */
  rotation: number;
  pivotX: number;
  pivotY: number;
}

export type PlacementResult = { ok: true; placement: Placement } | { ok: false; reason: string };

const mid = (a: Keypoint, b: Keypoint) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const dist = (a: Keypoint, b: Keypoint) => Math.hypot(a.x - b.x, a.y - b.y);
const seen = (...k: Keypoint[]) => k.every((p) => p.score >= MIN_SCORE);

/**
 * Garment width relative to the span between the two anchor joints. Shoulder joints sit
 * inside the shoulder line and sleeves hang outside it; hip joints are well inside the hips.
 */
const WIDTH_PER_SPAN: Record<string, number> = {
  tops: 1.75,
  knitwear: 1.85,
  outerwear: 1.95,
  ethnic: 1.8,
  sarees: 2.3,
  lehengas: 2.6,
  bottoms: 2.3,
  skirts: 2.6,
  footwear: 2.2,
};

/**
 * The garment's measured anchor width (see vision/garmentShape anchorWidth) relative to the
 * span between the anchor joints: a shirt's chest is about 1.45× the shoulder-joint span when
 * laid flat, a waistband about 2× the hip-joint span.
 */
const ANCHOR_PER_SPAN: Record<string, number> = {
  tops: 1.45,
  knitwear: 1.5,
  outerwear: 1.6,
  ethnic: 1.45,
  bottoms: 2.0,
  skirts: 2.0,
};

/** A measured anchor may move the width this far from the bounding-box estimate, no further. */
const ANCHOR_CLAMP = [0.5, 2.2] as const;

/** A garment cutout's size, plus where it meets the body when that was measured. */
export interface GarmentSize {
  width: number;
  height: number;
  /** Torso width at the chest (tops) or the waistband width (bottoms), in the same pixels. */
  anchorWidth?: number | null;
}

/**
 * Anchors a garment to the body: tops, outerwear and ethnic wear hang from the shoulders,
 * bottoms sit at the waist above the hip joints, footwear at the ankles. The garment keeps
 * its own aspect ratio, so a long kurta falls past the hips and cropped tops stay short:
 * that is what shows silhouette and drape.
 */
export function placeGarment(
  category: Category | null,
  subcategory: string | null,
  garment: GarmentSize,
  pose: Pose,
): PlacementResult {
  const aspect = garment.height / garment.width;
  const factor = (key: string) => WIDTH_PER_SPAN[subcategory ?? ''] ?? WIDTH_PER_SPAN[key];
  /**
   * Drawn width for an anchor span. With a measured anchor the garment's chest or waistband
   * is matched to the body, so sleeves held out (flat lay) or hanging (hanger) don't change
   * the fit; without one, the whole bounding box is scaled by a typical ratio.
   */
  const drawnWidth = (span: number, key: string) => {
    const estimate = span * factor(key);
    const perSpan = ANCHOR_PER_SPAN[subcategory ?? ''] ?? ANCHOR_PER_SPAN[key];
    if (!garment.anchorWidth || !perSpan) return estimate;
    const measured = (garment.width * span * perSpan) / garment.anchorWidth;
    return Math.min(estimate * ANCHOR_CLAMP[1], Math.max(estimate * ANCHOR_CLAMP[0], measured));
  };

  if (category === 'tops' || category === 'outerwear' || category === 'ethnic') {
    const { leftShoulder: l, rightShoulder: r } = pose;
    if (!seen(l, r)) return { ok: false, reason: 'Shoulders are not visible in your photo.' };
    const span = dist(l, r);
    const m = mid(l, r);
    const width = drawnWidth(span, category);
    const top = m.y - 0.2 * span; // collar sits above the shoulder joints
    return { ok: true, placement: rect(m.x, top, width, width * aspect, l, r, m) };
  }
  if (category === 'bottoms') {
    const { leftHip: l, rightHip: r } = pose;
    if (!seen(l, r)) return { ok: false, reason: 'Hips are not visible in your photo.' };
    const span = dist(l, r);
    const m = mid(l, r);
    const width = drawnWidth(span, 'bottoms');
    const top = m.y - 0.45 * span; // waistband sits above the hip joints
    return { ok: true, placement: rect(m.x, top, width, width * aspect, l, r, m) };
  }
  if (category === 'footwear') {
    const { leftAnkle: l, rightAnkle: r } = pose;
    if (!seen(l, r)) return { ok: false, reason: 'Feet are not visible in your photo; use a full-length photo.' };
    const span = Math.max(dist(l, r), 20);
    const m = mid(l, r);
    const width = span * factor('footwear');
    const height = width * aspect;
    return { ok: true, placement: { x: m.x - width / 2, y: m.y - height * 0.35, width, height, rotation: 0, pivotX: m.x, pivotY: m.y } };
  }
  return { ok: false, reason: 'Try-on works for clothing and footwear, not accessories.' };
}

function rect(cx: number, top: number, width: number, height: number, l: Keypoint, r: Keypoint, pivot: { x: number; y: number }): Placement {
  // Image-left joint to image-right joint gives the body's tilt.
  const [a, b] = l.x < r.x ? [l, r] : [r, l];
  const rotation = Math.atan2(b.y - a.y, b.x - a.x);
  return { x: cx - width / 2, y: top, width, height, rotation, pivotX: pivot.x, pivotY: pivot.y };
}

/** A person drawn from the Digital Twin, for users without a photo of themselves. */
export interface Avatar {
  width: number;
  height: number;
  pose: Pose;
  /** Closed outline, clockwise from the top of the head, in avatar pixels. */
  outline: { x: number; y: number }[];
  headRadius: number;
  head: { x: number; y: number };
}

const SHAPE_RATIOS: Record<BodyShape, { shoulder: number; waist: number; hip: number }> = {
  rectangle: { shoulder: 1, waist: 0.9, hip: 1 },
  triangle: { shoulder: 0.9, waist: 0.8, hip: 1.12 },
  'inverted-triangle': { shoulder: 1.14, waist: 0.86, hip: 0.92 },
  hourglass: { shoulder: 1, waist: 0.72, hip: 1.02 },
  oval: { shoulder: 0.98, waist: 1.05, hip: 1.0 },
};

/**
 * Builds a front-facing figure at `pxPerCm` scale. Proportions come from measurements when
 * given (circumference / π approximates front width), else from the body-shape ratios;
 * torso length moves the hip line.
 */
export function buildAvatar(twin: Pick<DigitalTwin, 'heightCm' | 'bodyShape' | 'proportions'>, pxPerCm = 2.4): Avatar {
  const H = twin.heightCm * pxPerCm;
  const ratios = SHAPE_RATIOS[twin.bodyShape];
  const p = twin.proportions;
  const base = 0.23 * twin.heightCm; // typical biacromial width is ~23% of height
  const shoulderCm = p.shoulderCm ?? base * ratios.shoulder;
  const waistCm = p.waistCm ? p.waistCm / Math.PI : base * 0.75 * ratios.waist;
  const hipCm = p.hipCm ? p.hipCm / Math.PI : base * 0.85 * ratios.hip;
  const torsoShift = p.torso === 'long' ? 0.02 : p.torso === 'short' ? -0.02 : 0;

  const W = Math.max(shoulderCm, hipCm) * pxPerCm * 2.2;
  const cx = W / 2;
  const y = (f: number) => f * H;
  const half = (cm: number) => (cm * pxPerCm) / 2;
  const headR = 0.065 * H;
  const shoulderY = y(0.18);
  const waistY = y(0.4 + torsoShift);
  const hipY = y(0.5 + torsoShift);
  const kneeY = y(0.73);
  const ankleY = y(0.95);
  const kp = (x: number, yy: number): Keypoint => ({ x, y: yy, score: 1 });
  const sh = half(shoulderCm) * 0.85; // joints sit inside the shoulder line
  const hj = half(hipCm) * 0.55;

  const pose: Pose = {
    nose: kp(cx, y(0.06)), leftEye: kp(cx + 6, y(0.055)), rightEye: kp(cx - 6, y(0.055)),
    leftEar: kp(cx + headR, y(0.06)), rightEar: kp(cx - headR, y(0.06)),
    leftShoulder: kp(cx + sh, shoulderY), rightShoulder: kp(cx - sh, shoulderY),
    leftElbow: kp(cx + sh + 8, y(0.32)), rightElbow: kp(cx - sh - 8, y(0.32)),
    leftWrist: kp(cx + sh + 10, y(0.45)), rightWrist: kp(cx - sh - 10, y(0.45)),
    leftHip: kp(cx + hj, hipY), rightHip: kp(cx - hj, hipY),
    leftKnee: kp(cx + hj * 0.9, kneeY), rightKnee: kp(cx - hj * 0.9, kneeY),
    leftAnkle: kp(cx + hj * 0.8, ankleY), rightAnkle: kp(cx - hj * 0.8, ankleY),
  };

  const s = half(shoulderCm), w = half(waistCm), h = half(hipCm);
  const neckY = y(0.135);
  const right = [
    { x: cx + half(12), y: neckY }, { x: cx + s, y: shoulderY }, { x: cx + s + 10, y: y(0.3) },
    { x: cx + s + 6, y: y(0.46) }, { x: cx + s - 6, y: y(0.46) }, { x: cx + s - 4, y: y(0.3) },
    { x: cx + w, y: waistY }, { x: cx + h, y: hipY }, { x: cx + h * 0.75, y: kneeY },
    { x: cx + h * 0.55, y: ankleY }, { x: cx + h * 0.55, y: y(0.99) }, { x: cx + 4, y: y(0.99) }, { x: cx + 3, y: y(0.6) },
  ];
  const left = right.map((pt) => ({ x: 2 * cx - pt.x, y: pt.y })).reverse();
  return { width: W, height: H, pose, outline: [...right, ...left], headRadius: headR, head: { x: cx, y: y(0.065) } };
}
