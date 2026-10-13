/**
 * Core app types. Pure data with no runtime dependencies, so every layer (storage, vision,
 * sync, UI) can share them without depending on each other.
 */

export type Undertone = 'warm' | 'cool' | 'neutral';
export type BodyShape = 'rectangle' | 'triangle' | 'inverted-triangle' | 'hourglass' | 'oval';

export type Torso = 'short' | 'balanced' | 'long';

/** Optional body measurements, in centimetres. Null when not given. */
export interface Proportions {
  shoulderCm: number | null;
  bustCm: number | null;
  waistCm: number | null;
  hipCm: number | null;
  torso: Torso | null;
}

export const EMPTY_PROPORTIONS: Proportions = { shoulderCm: null, bustCm: null, waistCm: null, hipCm: null, torso: null };

/** The user's Digital Twin. */
export interface DigitalTwin {
  heightCm: number;
  bodyShape: BodyShape;
  undertone: Undertone;
  /** Added in v2; profiles saved before then load with empty proportions. */
  proportions: Proportions;
  /** A 12-season type the user chose themselves (e.g. after a draping session). Overrides photo analysis. */
  season: SubSeason | null;
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
  /** Number of photos the colour and embedding were fused from. */
  photoCount: number;
  /** Bumped by every change the server must see; sync only marks the revision it uploaded. */
  revision: number;
}

/** One photo of a garment, with what the pipeline read from that photo alone. */
export interface GarmentPhoto {
  id: string;
  garmentId: string;
  imageUri: string;
  palette: PaletteEntry[];
  embedding: Float32Array | null;
  createdAt: number;
}

/** What a single view contributes to a garment's appearance. */
export type GarmentView = Pick<GarmentPhoto, 'palette' | 'embedding'>;

/** A garment's appearance combined across all of its photos. */
export interface FusedAppearance {
  colorHex: string;
  palette: PaletteEntry[];
  embedding: Float32Array | null;
}

/** Combines per-photo views into one appearance. Views are never empty. */
export type AppearanceFuser = (views: GarmentView[]) => FusedAppearance;

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

/** One processed photo, ready to store: its cutout plus what was read from it. */
export interface NewGarmentPhoto {
  png: Uint8Array;
  palette: PaletteEntry[];
  embedding: Float32Array | null;
}

export interface NewGarment extends NewGarmentPhoto {
  category?: Category | null;
}

export type Depth = 'light' | 'medium' | 'deep';
export type ContrastLevel = 'low' | 'medium' | 'high';
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export type SubSeason =
  | 'light-spring' | 'warm-spring' | 'clear-spring'
  | 'light-summer' | 'cool-summer' | 'soft-summer'
  | 'soft-autumn' | 'warm-autumn' | 'deep-autumn'
  | 'deep-winter' | 'cool-winter' | 'clear-winter';

/** CIELAB colour, [L*, a*, b*]. */
export type LabColor = [number, number, number];

/** What one photo of the user shows: their skin colour and how dark their hair reads. */
export interface SelfReading {
  skin: LabColor;
  /** Lightness of the darkest part of the head (hair); null when none was visible. */
  hairL: number | null;
}

/** A photo of the user. Kept on the phone only; never uploaded. */
export interface SelfPhoto {
  id: string;
  imageUri: string;
  reading: SelfReading;
  createdAt: number;
}

/** The user's colouring, combined from all of their photos. */
export interface PersonalColouring {
  /** Null when the colouring comes from a season chosen by hand rather than photos. */
  skinHex: string | null;
  undertone: Undertone;
  depth: Depth;
  contrast: ContrastLevel;
  season: Season;
  subSeason: SubSeason;
  source: 'photos' | 'twin';
  /** Colours that flatter this season, strongest first. */
  palette: string[];
  photoCount: number;
}

/** Who suggestions are for: the Digital Twin's undertone plus colouring read from photos, if any. */
export interface Wearer {
  undertone: Undertone | null;
  colouring: PersonalColouring | null;
}
