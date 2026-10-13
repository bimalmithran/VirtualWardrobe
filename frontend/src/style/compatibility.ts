import { COMPLETE_ETHNIC, type Category, type Garment } from '../domain/types';
import { pairHarmony } from './outfitSuggestions';

/** A pair scoring at least this is wearable together. */
export const PAIRS_WELL = 0.55;

type Piece = Pick<Garment, 'id' | 'category' | 'subcategory' | 'colorHex' | 'pattern'>;

const isCompleteEthnic = (g: Piece) => g.category === 'ethnic' && !!g.subcategory && COMPLETE_ETHNIC.includes(g.subcategory);
const isKurta = (g: Piece) => g.category === 'ethnic' && !isCompleteEthnic(g);

/**
 * What a piece cannot be worn without: a top needs a bottom, shoes need something to wear
 * them with, and so on. A saree or lehenga is a look on its own, and accessories never
 * depend on anything, so neither can be an orphan.
 */
export function essentialPartners(g: Piece): ((p: Piece) => boolean)[] {
  switch (g.category) {
    case 'tops':
      return [(p) => p.category === 'bottoms'];
    case 'bottoms':
      return [(p) => p.category === 'tops' || isKurta(p)];
    case 'outerwear':
      return [(p) => p.category === 'tops' || p.category === 'ethnic'];
    case 'footwear':
      return [(p) => p.category === 'bottoms' || p.category === 'ethnic'];
    case 'ethnic':
      return isCompleteEthnic(g) ? [] : [(p) => p.category === 'bottoms'];
    default:
      return [];
  }
}

/** Every category that can go in an outfit with this piece. */
export function partnerCategories(g: Piece): Category[] {
  switch (g.category) {
    case 'tops':
      return ['bottoms', 'outerwear', 'footwear', 'accessories'];
    case 'bottoms':
      return ['tops', 'ethnic', 'outerwear', 'footwear', 'accessories'];
    case 'outerwear':
      return ['tops', 'bottoms', 'ethnic', 'footwear'];
    case 'footwear':
      return ['tops', 'bottoms', 'ethnic', 'outerwear'];
    case 'ethnic':
      return isCompleteEthnic(g) ? ['footwear', 'outerwear', 'accessories'] : ['bottoms', 'footwear', 'outerwear', 'accessories'];
    case 'accessories':
      return ['tops', 'bottoms', 'outerwear', 'footwear', 'ethnic'];
    default:
      return [];
  }
}

/**
 * How well two pieces go together, 0..1: colour harmony, less when two busy patterns
 * compete (stripes with checks, two prints). One patterned piece with a solid is classic.
 */
export function pairScore(a: Piece, b: Piece): number {
  let s = pairHarmony(a.colorHex, b.colorHex);
  const busy = (p: Piece) => p.pattern === 'striped' || p.pattern === 'checked' || p.pattern === 'printed';
  if (busy(a) && busy(b)) s -= a.pattern === b.pattern && a.pattern === 'striped' ? 0.1 : 0.18;
  return Math.max(0, Math.min(1, s));
}

export interface Partner {
  garment: Garment;
  score: number;
}

/** The best partners for a piece in each category it can be worn with. */
export function bestPartners(piece: Piece, closet: Garment[], perCategory = 3): Map<Category, Partner[]> {
  const out = new Map<Category, Partner[]>();
  for (const cat of partnerCategories(piece)) {
    const ranked = closet
      .filter((g) => g.id !== piece.id && g.category === cat)
      .map((g) => ({ garment: g, score: pairScore(piece, g) }))
      .sort((x, y) => y.score - x.score)
      .slice(0, perCategory);
    if (ranked.length) out.set(cat, ranked);
  }
  return out;
}

export interface OrphanReason {
  /** 'missing' = nothing of the needed kind is in the closet; 'clash' = there is, but none of it goes. */
  kind: 'missing' | 'clash';
  message: string;
}

const NEED_LABEL: Partial<Record<Category, string>> = {
  tops: 'bottoms',
  bottoms: 'tops or kurtas',
  outerwear: 'tops or ethnic wear',
  footwear: 'bottoms or ethnic wear',
  ethnic: 'bottoms',
};

/** Why a piece has no outfit in this closet, or null if it pairs with something. */
export function orphanReason(piece: Piece, closet: Piece[]): OrphanReason | null {
  const needs = essentialPartners(piece);
  if (needs.length === 0) return null;
  for (const need of needs) {
    const candidates = closet.filter((g) => g.id !== piece.id && need(g));
    if (candidates.length === 0) {
      return { kind: 'missing', message: `No ${NEED_LABEL[piece.category!] ?? 'matching pieces'} in your closet to wear it with.` };
    }
    if (candidates.some((g) => pairScore(piece, g) >= PAIRS_WELL)) return null;
  }
  return { kind: 'clash', message: `None of your ${NEED_LABEL[piece.category!] ?? 'pieces'} go well with it.` };
}

/** Orphans in the closet: tagged pieces with zero wearable pairings. */
export function findOrphans(closet: Garment[]): Map<string, OrphanReason> {
  const out = new Map<string, OrphanReason>();
  for (const g of closet) {
    const r = orphanReason(g, closet);
    if (r) out.set(g.id, r);
  }
  return out;
}
