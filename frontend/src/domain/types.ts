/**
 * Core app types. Pure data with no runtime dependencies, so every layer (storage, vision,
 * sync, UI) can share them without depending on each other.
 */

export type Undertone = 'warm' | 'cool' | 'neutral';
export type BodyShape = 'rectangle' | 'triangle' | 'inverted-triangle' | 'hourglass' | 'oval';

/** The user's Digital Twin. */
export interface DigitalTwin {
  heightCm: number;
  bodyShape: BodyShape;
  undertone: Undertone;
  /** Doubles as the profile version for sync. */
  updatedAt: number;
}

export type DigitalTwinInput = Omit<DigitalTwin, 'updatedAt'>;

export interface PaletteEntry {
  hex: string;
  share: number; // fraction of garment pixels in this cluster
}

export interface Garment {
  id: string;
  imageUri: string;
  colorHex: string;
  palette: PaletteEntry[];
  embedding: Float32Array | null;
  createdAt: number;
  /** When the garment was uploaded to the backend; null while pending. */
  syncedAt: number | null;
}

export interface NewGarment {
  png: Uint8Array;
  colorHex: string;
  palette: PaletteEntry[];
  embedding: Float32Array | null;
}
