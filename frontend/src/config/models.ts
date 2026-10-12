/**
 * Model registry. These are the same ONNX exports Transformers.js loads from
 * the Hugging Face Hub; we run them directly through onnxruntime-react-native.
 */

export type ModelKey = 'segmentation' | 'embedding';

export interface ModelSpec {
  key: ModelKey;
  label: string;
  url: string;
  fileName: string;
  /** Exact byte size of the published file. Used for progress and to reject truncated downloads. */
  bytes: number;
  inputSize: number;
  /** pixel = (value / 255 - mean) / std, per channel. */
  mean: [number, number, number];
  std: [number, number, number];
  license: string;
}

// RMBG-1.4 is the better cutout model but is licensed for non-commercial use only.
// For anything you might ship, swap in ISNET (same IS-Net architecture, Apache-2.0).
const RMBG_1_4: ModelSpec = {
  key: 'segmentation',
  label: 'Background removal (RMBG-1.4, int8)',
  url: 'https://huggingface.co/briaai/RMBG-1.4/resolve/main/onnx/model_quantized.onnx',
  fileName: 'rmbg-1.4-quantized.onnx',
  bytes: 44403226,
  inputSize: 1024,
  mean: [0.5, 0.5, 0.5],
  std: [1, 1, 1],
  license: 'bria-rmbg-1.4 (non-commercial)',
};

export const ISNET: ModelSpec = {
  key: 'segmentation',
  label: 'Background removal (ISNet, int8)',
  url: 'https://huggingface.co/onnx-community/ISNet-ONNX/resolve/main/onnx/model_quantized.onnx',
  fileName: 'isnet-quantized.onnx',
  bytes: 44348381,
  inputSize: 1024,
  // HF config: (x - 128) / 256, rewritten in 0..1 space.
  mean: [0.50196, 0.50196, 0.50196],
  std: [1.00392, 1.00392, 1.00392],
  license: 'Apache-2.0',
};

const MOBILECLIP_S0: ModelSpec = {
  key: 'embedding',
  label: 'Garment embedding (MobileCLIP-S0 vision, int8)',
  url: 'https://huggingface.co/Xenova/mobileclip_s0/resolve/main/onnx/vision_model_quantized.onnx',
  fileName: 'mobileclip-s0-vision-quantized.onnx',
  bytes: 11846843,
  inputSize: 256,
  // MobileCLIP's preprocessor has do_normalize=false: rescale to 0..1 only.
  mean: [0, 0, 0],
  std: [1, 1, 1],
  license: 'Apple ML research license',
};

export const MODELS: Record<ModelKey, ModelSpec> = {
  segmentation: RMBG_1_4,
  embedding: MOBILECLIP_S0,
};

export const EMBEDDING_DIM = 512;

/** Longest side of the working image. Bounds every RGBA buffer we hold in JS to ~4 MB. */
export const WORKING_MAX_SIDE = 1024;
