import { MODELS, type ModelSpec } from '../config/models';
import type { RGBAImage } from '../image/pixels';
import type { ModelRunner } from '../ml/modelRunner';

export const KEYPOINTS = [
  'nose', 'leftEye', 'rightEye', 'leftEar', 'rightEar', 'leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow',
  'leftWrist', 'rightWrist', 'leftHip', 'rightHip', 'leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle',
] as const;
export type KeypointName = (typeof KEYPOINTS)[number];

export interface Keypoint {
  /** Pixels in the analysed image. */
  x: number;
  y: number;
  score: number;
}

export type Pose = Record<KeypointName, Keypoint>;

/** Below this MoveNet confidence a keypoint is a guess. */
export const MIN_SCORE = 0.3;

export interface PoseEstimator {
  estimate(image: RGBAImage): Promise<Pose>;
}

/**
 * MoveNet SinglePose Lightning. The image is letterboxed onto white (a person cutout's
 * transparent background must not read as dark clutter) at 192², fed as raw int32 pixels,
 * and keypoints are mapped back to the image's own coordinates.
 */
export class MoveNetPoseEstimator implements PoseEstimator {
  constructor(
    private readonly runner: ModelRunner,
    private readonly spec: ModelSpec = MODELS.pose,
  ) {}

  async estimate(image: RGBAImage): Promise<Pose> {
    const size = this.spec.inputSize;
    const { input, scale, ox, oy } = letterboxInt32(image, size);
    const { data } = await this.runner.run(this.spec.key, { input, dims: [1, size, size, 3] });
    return decodePose(data, size, scale, ox, oy);
  }
}

/** Nearest-neighbour letterbox to NHWC int32, compositing alpha onto white. */
export function letterboxInt32(img: RGBAImage, size: number) {
  const scale = size / Math.max(img.width, img.height);
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const ox = Math.floor((size - w) / 2);
  const oy = Math.floor((size - h) / 2);
  const input = new Int32Array(size * size * 3).fill(255);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(img.height - 1, Math.floor(y / scale));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.floor(x / scale));
      const i = (sy * img.width + sx) * 4;
      const a = img.data[i + 3] / 255;
      const o = ((oy + y) * size + ox + x) * 3;
      for (let c = 0; c < 3; c++) input[o + c] = Math.round(img.data[i + c] * a + 255 * (1 - a));
    }
  }
  return { input, scale, ox, oy };
}

/** [17 × (y, x, score)] normalised to the 192² input → image pixels. */
export function decodePose(out: Float32Array, size: number, scale: number, ox: number, oy: number): Pose {
  const pose = {} as Pose;
  KEYPOINTS.forEach((name, k) => {
    const y = out[k * 3] * size;
    const x = out[k * 3 + 1] * size;
    pose[name] = { x: (x - ox) / scale, y: (y - oy) / scale, score: out[k * 3 + 2] };
  });
  return pose;
}

/** Pixel keypoints → fractions of the image size (and back), to cache independent of scale. */
export function scalePose(pose: Pose, sx: number, sy: number): Pose {
  const out = {} as Pose;
  for (const k of KEYPOINTS) out[k] = { x: pose[k].x * sx, y: pose[k].y * sy, score: pose[k].score };
  return out;
}
