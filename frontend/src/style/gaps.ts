import { COMPLETE_ETHNIC, type Category, type Garment, type Wearer, type Weather } from '../domain/types';
import { colorName } from '../vision/color';
import { pairHarmony } from './outfitSuggestions';
import { essentialPartners } from './compatibility';

/** Something a look or a garment is missing, and the colour that would complete it. */
export interface ShoppingNeed {
  category: Category;
  subcategory?: string;
  colour: string;
  hex: string;
  why: string;
}

/** Versatile neutrals every wardrobe can use; the wearer's palette is added for tops. */
const NEUTRALS = ['#1B2A4A', '#F5F5F5', '#000000', '#C3B091', '#36454F', '#8B5A2B', '#3B5B8C', '#FFFDD0'];

/** The candidate colour that harmonises best with every piece in the look. */
function bestColour(pieces: Garment[], candidates: string[]): string {
  let best = candidates[0];
  let bestScore = -1;
  for (const c of candidates) {
    const score = pieces.length ? Math.min(...pieces.map((p) => pairHarmony(c, p.colorHex))) : 0.5;
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

function need(category: Category, pieces: Garment[], candidates: string[], why: string, subcategory?: string): ShoppingNeed {
  const hex = bestColour(pieces, candidates);
  return { category, subcategory, colour: colorName(hex), hex, why };
}

/** What a look lacks: shoes, a winter layer, or a bottom for a kurta. */
export function lookGaps(pieces: Garment[], wearer: Wearer | null, weather: Weather): ShoppingNeed[] {
  const has = (c: Category) => pieces.some((g) => g.category === c);
  const out: ShoppingNeed[] = [];
  const kurta = pieces.find((g) => g.category === 'ethnic' && !(g.subcategory && COMPLETE_ETHNIC.includes(g.subcategory)));
  if (kurta && !has('bottoms')) out.push(need('bottoms', pieces, NEUTRALS, 'A bottom to wear with the kurta'));
  if (!has('footwear')) {
    const ethnic = pieces.some((g) => g.category === 'ethnic');
    out.push(need('footwear', pieces, NEUTRALS, 'Shoes to finish the look', ethnic ? undefined : 'sneakers'));
  }
  if (weather === 'winter' && !has('outerwear')) {
    out.push(need('outerwear', pieces, [...NEUTRALS, ...(wearer?.colouring?.palette ?? [])], 'A warm layer for winter', 'jackets'));
  }
  return out;
}

const PARTNER_FOR: Partial<Record<Category, Category>> = {
  tops: 'bottoms',
  bottoms: 'tops',
  outerwear: 'tops',
  footwear: 'bottoms',
  ethnic: 'bottoms',
};

/** For an orphan: the piece that would let it be worn, in a colour that suits both. */
export function orphanNeed(orphan: Garment, wearer: Wearer | null): ShoppingNeed | null {
  if (essentialPartners(orphan).length === 0 || !orphan.category) return null;
  const category = PARTNER_FOR[orphan.category];
  if (!category) return null;
  const candidates = category === 'tops' ? [...(wearer?.colouring?.palette ?? []), ...NEUTRALS] : NEUTRALS;
  return need(category, [orphan], candidates, 'So you can finally wear it');
}
