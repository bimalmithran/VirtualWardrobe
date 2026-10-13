import { SUBCATEGORIES, type Category, type Garment } from '../domain/types';
import { colorName, hexToRgb, rgbToLab } from '../vision/color';
import { cosine } from '../vision/embedding';

/** MobileCLIP cosine above which two garments read as the same kind of thing. */
const SAME_STYLE = 0.86;
/** CIE76 ΔE below which two primary colours look the same. */
const SAME_COLOUR = 14;

export interface ScannedItem {
  colorHex: string;
  embedding: Float32Array | null;
  category: Category | null;
  subcategory: string | null;
  pattern: Garment['pattern'];
}

const lab = (hex: string) => rgbToLab(...hexToRgb(hex));
const deltaE = (a: string, b: string) => {
  const x = lab(a), y = lab(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
};

/**
 * Closet items that are near-identical to the scanned one: same category, same-looking
 * colour, and either a very similar style vector or (without vectors) the same subtype
 * and pattern.
 */
export function nearDuplicates(item: ScannedItem, closet: Garment[]): Garment[] {
  return closet.filter((g) => {
    if (item.category && g.category && g.category !== item.category) return false;
    if (deltaE(item.colorHex, g.colorHex) > SAME_COLOUR) return false;
    if (item.embedding && g.embedding) return cosine(item.embedding, g.embedding) >= SAME_STYLE;
    return item.subcategory !== null && item.subcategory === g.subcategory && item.pattern === g.pattern;
  });
}

/** "You already have 3 navy blue T-shirts", or null when there are none. */
export function redundancyMessage(item: ScannedItem, dupes: Garment[]): string | null {
  if (dupes.length === 0) return null;
  const sub = item.subcategory ?? dupes.find((d) => d.subcategory)?.subcategory ?? null;
  const cat = item.category ?? dupes[0].category;
  const noun = sub && cat ? SUBCATEGORIES[cat].find((s) => s.slug === sub)?.label ?? 'piece' : cat ? singular(cat) : 'piece';
  const n = dupes.length;
  const pattern = item.pattern && item.pattern !== 'solid' ? `${item.pattern} ` : '';
  return `You already have ${n === 1 ? 'a' : n} ${colorName(item.colorHex)} ${pattern}${n === 1 ? noun.toLowerCase() : plural(noun.toLowerCase())} like this.`;
}

function singular(c: Category) {
  return { tops: 'Top', bottoms: 'Bottom', outerwear: 'Layer', footwear: 'Pair of shoes', ethnic: 'Ethnic piece', accessories: 'Accessory' }[c];
}

function plural(noun: string) {
  if (noun.endsWith('s') || noun.endsWith('wear')) return noun;
  if (noun === 'pair of shoes') return 'pairs of shoes';
  return `${noun}s`;
}

/**
 * Guesses a scanned item's category by majority vote of its nearest tagged closet items
 * (k-NN on MobileCLIP vectors). Returns null when the closet can't say with confidence.
 */
export function guessCategory(embedding: Float32Array | null, closet: Garment[], k = 5): { category: Category; subcategory: string | null } | null {
  if (!embedding) return null;
  const tagged = closet
    .filter((g) => g.category && g.embedding)
    .map((g) => ({ g, sim: cosine(embedding, g.embedding!) }))
    .sort((a, b) => b.sim - a.sim)
    .slice(0, k);
  if (tagged.length === 0 || tagged[0].sim < 0.6) return null;
  const votes = new Map<Category, number>();
  for (const t of tagged) votes.set(t.g.category!, (votes.get(t.g.category!) ?? 0) + t.sim);
  const [category, weight] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
  const total = tagged.reduce((s, t) => s + t.sim, 0);
  if (weight / total < 0.5) return null;
  const sub = tagged.find((t) => t.g.category === category && t.g.subcategory)?.g.subcategory ?? null;
  return { category, subcategory: sub };
}
