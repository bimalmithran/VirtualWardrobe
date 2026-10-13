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

/** Top-level slugs of the server's `categories` table. */
export const CATEGORIES = ['tops', 'bottoms', 'outerwear', 'footwear', 'accessories'] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  tops: 'Tops',
  bottoms: 'Bottoms',
  outerwear: 'Outerwear',
  footwear: 'Footwear',
  accessories: 'Accessories',
};

export interface Garment {
  id: string;
  imageUri: string;
  colorHex: string;
  palette: PaletteEntry[];
  embedding: Float32Array | null;
  createdAt: number;
  /** When the garment was uploaded to the backend; null while pending. */
  syncedAt: number | null;
  category: Category | null;
  favorite: boolean;
  wearCount: number;
  lastWornAt: number | null;
}

/** User-editable garment fields. Changing category re-queues the garment for upload. */
export type GarmentPatch = Partial<Pick<Garment, 'category' | 'favorite'>>;

export interface Outfit {
  id: string;
  name: string;
  /** Garment ids in display order. */
  itemIds: string[];
  createdAt: number;
  lastWornAt: number | null;
  syncedAt: number | null;
}

export interface NewGarment {
  category?: Category | null;
  png: Uint8Array;
  colorHex: string;
  palette: PaletteEntry[];
  embedding: Float32Array | null;
}
