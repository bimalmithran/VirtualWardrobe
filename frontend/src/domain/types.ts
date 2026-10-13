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

export type Pattern = 'solid' | 'striped' | 'checked' | 'printed' | 'textured';

/** Silhouette geometry read from the cutout's mask (see vision/garmentShape.ts). */
export interface GarmentShape {
  /** Height / width of the garment's bounding box. */
  aspect: number;
  /** Width near the hem / width across the upper body; > 1 flares, < 1 tapers. */
  taper: number;
  /** 0 = straight sides, higher = narrower at the waist than above or below. */
  waistDefinition: number;
  /** Share of the bounding box the garment covers. */
  fill: number;
}

export interface PaletteEntry {
  hex: string;
  share: number; // fraction of garment pixels in this cluster
}

/** Top-level slugs of the server's `categories` table. */
export const CATEGORIES = ['tops', 'bottoms', 'outerwear', 'footwear', 'ethnic', 'accessories'] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  tops: 'Tops',
  bottoms: 'Bottoms',
  outerwear: 'Outerwear',
  footwear: 'Footwear',
  ethnic: 'Indian Ethnic Wear',
  accessories: 'Accessories',
};

/** Second-level slugs, mirroring the server's category tree. */
export const SUBCATEGORIES: Record<Category, { slug: string; label: string }[]> = {
  tops: [
    { slug: 'shirts', label: 'Shirt' },
    { slug: 't-shirts', label: 'T-shirt' },
    { slug: 'knitwear', label: 'Knitwear' },
  ],
  bottoms: [
    { slug: 'trousers', label: 'Trousers' },
    { slug: 'jeans', label: 'Jeans' },
    { slug: 'skirts', label: 'Skirt' },
  ],
  outerwear: [
    { slug: 'jackets', label: 'Jacket' },
    { slug: 'coats', label: 'Coat' },
  ],
  footwear: [
    { slug: 'sneakers', label: 'Sneakers' },
    { slug: 'formal-shoes', label: 'Formal shoes' },
  ],
  ethnic: [
    { slug: 'kurtas', label: 'Kurta' },
    { slug: 'sarees', label: 'Saree' },
    { slug: 'lehengas', label: 'Lehenga' },
    { slug: 'salwar-sets', label: 'Salwar set' },
    { slug: 'sherwanis', label: 'Sherwani' },
    { slug: 'mundu-dhoti', label: 'Mundu / dhoti' },
  ],
  accessories: [],
};

/** Ethnic pieces that are a whole look on their own; a kurta still pairs with a bottom. */
export const COMPLETE_ETHNIC = ['sarees', 'lehengas', 'salwar-sets', 'sherwanis'];

export const OCCASIONS = ['casual', 'work', 'formal', 'party', 'festive', 'wedding', 'sport', 'lounge'] as const;
export type Occasion = (typeof OCCASIONS)[number];

/** Weather seasons as lived in India; 'all' means trans-seasonal. */
export const WEATHER = ['summer', 'monsoon', 'winter'] as const;
export type Weather = (typeof WEATHER)[number];

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
  /** Read from the main photo; the user can correct it. */
  pattern: Pattern | null;
  shape: GarmentShape | null;
  subcategory: string | null;
  occasions: Occasion[];
  /** Weather it suits; empty means not tagged (treated as any). */
  weather: Weather[];
  brand: string | null;
  size: string | null;
  /** Purchase price in whole rupees, for cost-per-wear. */
  price: number | null;
  purchasedAt: number | null;
}

/** One time a garment was worn. */
export interface WearEvent {
  garmentId: string;
  wornAt: number;
  /** Set when it was worn as part of a saved outfit. */
  outfitId: string | null;
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

/** User-editable garment fields. Everything but `favorite` re-queues the garment for upload. */
export type GarmentPatch = Partial<
  Pick<Garment, 'category' | 'favorite' | 'pattern' | 'subcategory' | 'occasions' | 'weather' | 'brand' | 'size' | 'price' | 'purchasedAt'>
>;

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
  pattern?: Pattern | null;
  shape?: GarmentShape | null;
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

/** Tag fields of a garment nobody has tagged yet. */
export const EMPTY_TAGS: Pick<
  Garment,
  'pattern' | 'shape' | 'subcategory' | 'occasions' | 'weather' | 'brand' | 'size' | 'price' | 'purchasedAt'
> = { pattern: null, shape: null, subcategory: null, occasions: [], weather: [], brand: null, size: null, price: null, purchasedAt: null };
