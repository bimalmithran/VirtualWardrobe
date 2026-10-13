import { COMPLETE_ETHNIC, type Garment, type Occasion, type Wearer, type Weather } from '../domain/types';
import { hexToRgb, labToLch, rgbToLab } from '../vision/color';
import { pairScore } from './compatibility';
import { scoreOutfit, type OutfitScore } from './outfitSuggestions';

export interface LookScore extends OutfitScore {
  /** 0..100 for the requested occasion; null when none was asked for. */
  occasion: number | null;
  /** 0..100 for the weather. */
  weather: number;
}

export interface Look {
  garments: Garment[];
  score: LookScore;
  /** The template the look follows, for display. */
  kind: 'western' | 'kurta' | 'ethnic';
}

export interface LookContext {
  occasion?: Occasion | null;
  /** Defaults to the current season in India. */
  weather?: Weather;
  now?: number;
}

/** India's seasons by month: summer Mar-Jun, monsoon Jul-Sep, winter Oct-Feb. */
export function currentWeather(now = Date.now()): Weather {
  const m = new Date(now).getMonth(); // 0 = Jan
  if (m >= 2 && m <= 5) return 'summer';
  if (m >= 6 && m <= 8) return 'monsoon';
  return 'winter';
}

/** Occasions a piece implies when the user hasn't tagged any. */
const DEFAULT_OCCASIONS: Record<string, Occasion[]> = {
  't-shirts': ['casual', 'lounge', 'sport'],
  shirts: ['work', 'formal', 'casual'],
  knitwear: ['casual', 'work'],
  jeans: ['casual', 'party'],
  trousers: ['work', 'formal'],
  skirts: ['casual', 'work', 'party'],
  jackets: ['casual', 'work', 'party'],
  coats: ['work', 'formal'],
  sneakers: ['casual', 'sport'],
  'formal-shoes': ['work', 'formal', 'wedding'],
  kurtas: ['casual', 'work', 'festive'],
  sarees: ['festive', 'wedding', 'formal', 'work'],
  lehengas: ['wedding', 'festive', 'party'],
  'salwar-sets': ['casual', 'work', 'festive'],
  sherwanis: ['wedding', 'festive'],
  'mundu-dhoti': ['festive', 'casual'],
};

function occasionFit(g: Garment, occasion: Occasion): number {
  const tags = g.occasions.length ? g.occasions : (g.subcategory && DEFAULT_OCCASIONS[g.subcategory]) || null;
  if (!tags) return 0.6; // unknown: neither helps nor hurts much
  if (tags.includes(occasion)) return 1;
  // Near misses: dressy occasions accept each other's pieces better than casual ones.
  const dressy: Occasion[] = ['formal', 'party', 'festive', 'wedding'];
  if (dressy.includes(occasion) && tags.some((t) => dressy.includes(t))) return 0.65;
  return g.occasions.length ? 0.2 : 0.35;
}

function weatherFit(g: Garment, weather: Weather): number {
  if (g.weather.length) return g.weather.includes(weather) ? 1 : 0.3;
  const { L } = labToLch(rgbToLab(...hexToRgb(g.colorHex)));
  if (weather === 'summer') {
    if (g.category === 'outerwear' || g.subcategory === 'knitwear') return 0.25;
    return L > 60 ? 0.9 : 0.7; // light colours stay cooler
  }
  if (weather === 'winter') return g.category === 'outerwear' || g.subcategory === 'knitwear' ? 1 : 0.7;
  // Monsoon: pale bottoms show splashes; heavy layers stay damp.
  if (g.category === 'bottoms' && L > 80) return 0.45;
  if (g.subcategory === 'coats') return 0.4;
  return 0.75;
}

function scoreLook(garments: Garment[], wearer: Wearer | null, ctx: Required<Pick<LookContext, 'weather' | 'now'>> & LookContext): LookScore {
  const base = scoreOutfit(garments, wearer, ctx.now);
  // Patterns: two busy pieces compete even when their colours agree.
  let patternPenalty = 0;
  for (let i = 0; i < garments.length; i++)
    for (let j = i + 1; j < garments.length; j++) {
      const p = pairScore(garments[i], garments[j]);
      const plainHarmony = pairScore({ ...garments[i], pattern: 'solid' }, { ...garments[j], pattern: 'solid' });
      patternPenalty += Math.max(0, plainHarmony - p);
    }
  const notes = [...base.notes];
  if (patternPenalty > 0.1) notes.push('Two busy patterns compete; swap one for a solid.');

  const occasion = ctx.occasion ? Math.round((100 * garments.reduce((s, g) => s + occasionFit(g, ctx.occasion!), 0)) / garments.length) : null;
  let weather = Math.round((100 * garments.reduce((s, g) => s + weatherFit(g, ctx.weather), 0)) / garments.length);
  const warmLayer = garments.some((g) => g.category === 'outerwear' || g.subcategory === 'knitwear' || g.weather.includes('winter'));
  if (ctx.weather === 'winter' && !warmLayer) {
    weather = Math.round(weather * 0.75);
    notes.push('Add a warm layer for winter.');
  }
  if (occasion !== null && occasion < 50) notes.push(`Not ideal for ${ctx.occasion}.`);
  if (weather < 50) notes.push(`Not great for ${ctx.weather}.`);

  const parts: [number, number][] = [[base.score, 0.65], [weather, 0.15]];
  if (occasion !== null) parts.push([occasion, 0.2]);
  const weight = parts.reduce((s, [, w]) => s + w, 0);
  // Shoes make a look complete; worth a little, never enough to excuse a bad pair.
  const complete = garments.some((g) => g.category === 'footwear') ? 3 : 0;
  const score = Math.round(parts.reduce((s, [v, w]) => s + v * w, 0) / weight - 30 * patternPenalty + complete);
  return { ...base, score: Math.max(0, Math.min(100, score)), notes, occasion, weather };
}

const isComplete = (g: Garment) => g.category === 'ethnic' && !!g.subcategory && COMPLETE_ETHNIC.includes(g.subcategory);
const isKurta = (g: Garment) => g.category === 'ethnic' && !isComplete(g);

/**
 * Complete outfits, best first. With an anchor every look contains it (a closet piece, or
 * a scanned store item that is not in the closet). Looks follow three templates: western
 * (top + bottom), kurta + bottom, and complete ethnic (saree, lehenga, ...), each finished
 * with the best shoes and, when the weather or occasion calls for it, a layer. Results
 * avoid repeating the same main pieces so the carousel shows real alternatives.
 */
export function generateLooks(closet: Garment[], wearer: Wearer | null, opts: LookContext & { anchor?: Garment; limit?: number } = {}): Look[] {
  const now = opts.now ?? Date.now();
  const ctx = { ...opts, now, weather: opts.weather ?? currentWeather(now) };
  const anchor = opts.anchor;
  const pool = closet.filter((g) => g.id !== anchor?.id);
  const of = (pred: (g: Garment) => boolean) => {
    const xs = pool.filter(pred);
    return anchor && pred(anchor) ? [anchor] : xs;
  };
  const tops = of((g) => g.category === 'tops');
  const bottoms = of((g) => g.category === 'bottoms');
  const kurtas = of(isKurta);
  const complete = of(isComplete);
  const shoes = pool.filter((g) => g.category === 'footwear');
  const layers = pool.filter((g) => g.category === 'outerwear');
  const anchorIs = (pred: (g: Garment) => boolean) => !!anchor && pred(anchor);

  const bases: { pieces: Garment[]; kind: Look['kind'] }[] = [];
  const anchorFreeOrIn = (pieces: Garment[]) => !anchor || pieces.includes(anchor) || anchorIs((g) => g.category === 'footwear' || g.category === 'outerwear' || g.category === 'accessories');
  for (const t of tops) for (const b of bottoms) if (anchorFreeOrIn([t, b])) bases.push({ pieces: [t, b], kind: 'western' });
  for (const k of kurtas) for (const b of bottoms) if (anchorFreeOrIn([k, b])) bases.push({ pieces: [k, b], kind: 'kurta' });
  for (const c of complete) if (anchorFreeOrIn([c])) bases.push({ pieces: [c], kind: 'ethnic' });

  const wantsLayer = ctx.weather === 'winter' || ctx.occasion === 'formal';
  const looks: Look[] = [];
  for (const base of bases) {
    let pieces = base.pieces;
    // A look needs shoes when a suitable pair exists (sneakers don't go to a wedding), and a
    // layer in winter; scoring then picks which ones, not whether.
    const suitableShoes = shoes.filter((sh) => !ctx.occasion || occasionFit(sh, ctx.occasion) >= 0.5);
    const shoeOptions: (Garment | null)[] = anchorIs((g) => g.category === 'footwear') ? [anchor!] : suitableShoes.length ? suitableShoes : [null];
    const layerOptions: (Garment | null)[] = anchorIs((g) => g.category === 'outerwear')
      ? [anchor!]
      : wantsLayer && layers.length
        ? ctx.weather === 'winter' ? layers : [null, ...layers]
        : [null];
    let best: { pieces: Garment[]; score: LookScore } | null = null;
    for (const shoe of shoeOptions) {
      for (const layer of layerOptions) {
        const candidate = [...pieces, ...(layer ? [layer] : []), ...(shoe ? [shoe] : [])];
        const score = scoreLook(candidate, wearer, ctx);
        if (!best || score.score > best.score.score) best = { pieces: candidate, score };
      }
    }
    if (!best) continue;
    pieces = best.pieces;
    if (anchor && !pieces.includes(anchor)) continue;
    looks.push({ garments: pieces, score: best.score, kind: base.kind });
  }
  looks.sort((a, b) => b.score.score - a.score.score);

  // Diversity: don't show the same main piece (other than the anchor) twice.
  const used = new Set<string>();
  const picked: Look[] = [];
  for (const look of looks) {
    const main = look.garments.find((g) => g !== anchor && g.category !== 'footwear' && g.category !== 'outerwear');
    if (main && used.has(main.id)) continue;
    if (main) used.add(main.id);
    picked.push(look);
    if (picked.length === (opts.limit ?? 5)) break;
  }
  return picked;
}
