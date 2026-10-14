import type { Garment, Occasion, Wearer, Weather } from '../domain/types';
import { pairScore } from './compatibility';
import { generateLooks, type Look } from './outfitGenerator';

export interface TripPlan {
  days: number;
  weather: Weather;
  /** Occasions the trip includes; casual is assumed for plain days. */
  occasions: Occasion[];
  laundry: boolean;
}

export interface PackingList {
  pieces: Garment[];
  /** One look per day, drawn only from `pieces`. */
  schedule: { day: number; occasion: Occasion; look: Look }[];
  notes: string[];
}

/** Capsule sizes: with laundry you rewash after ~4 days; tops repeat less than bottoms. */
export function capsuleSize(days: number, laundry: boolean) {
  const cycle = laundry ? Math.min(days, 4) : days;
  return {
    tops: Math.max(1, Math.ceil(cycle * 0.8)),
    bottoms: Math.max(1, Math.ceil(cycle / 3)),
    shoes: days > 4 ? 2 : 1,
  };
}

/**
 * A capsule wardrobe for a trip: few pieces that combine into many outfits. Pieces are
 * chosen greedily by versatility (how well each pairs with the others already packed) and
 * by how well they suit the trip's weather and occasions; then each day gets the best look
 * from the packed pieces, avoiding repeating a top on consecutive days.
 */
export function planPacking(closet: Garment[], wearer: Wearer | null, trip: TripPlan, now = Date.now()): PackingList {
  const size = capsuleSize(trip.days, trip.laundry);
  const notes: string[] = [];
  const dayOccasions: Occasion[] = Array.from({ length: trip.days }, (_, i) => trip.occasions[i % Math.max(1, trip.occasions.length)] ?? 'casual');
  const dressy = trip.occasions.some((o) => o === 'wedding' || o === 'festive');

  const fits = (g: Garment) => (g.weather.length === 0 || g.weather.includes(trip.weather)) && g.category !== null;
  const usable = closet.filter(fits);
  const byCat = (c: Garment['category']) => usable.filter((g) => g.category === c);

  const packed: Garment[] = [];
  const versatility = (g: Garment) => (packed.length ? packed.reduce((s, p) => s + pairScore(g, p), 0) / packed.length : 0.5);
  const occasionFit = (g: Garment) =>
    trip.occasions.length === 0 || g.occasions.length === 0 ? 0.5 : g.occasions.filter((o) => trip.occasions.includes(o)).length / trip.occasions.length;
  const pick = (pool: Garment[], n: number) => {
    const left = pool.filter((g) => !packed.includes(g));
    for (let i = 0; i < n && left.length; i++) {
      left.sort((a, b) => versatility(b) + 0.5 * occasionFit(b) - (versatility(a) + 0.5 * occasionFit(a)));
      packed.push(left.shift()!);
    }
  };

  // Bottoms first: they anchor the most combinations.
  pick(byCat('bottoms'), size.bottoms);
  pick(byCat('tops'), size.tops);
  if (dressy) {
    const formalDays = dayOccasions.filter((o) => o === 'wedding' || o === 'festive').length;
    pick(byCat('ethnic'), Math.max(1, Math.min(formalDays, 3)));
  }
  pick(byCat('footwear'), size.shoes);
  if (trip.weather !== 'summer') pick(byCat('outerwear'), 1);

  const schedule: PackingList['schedule'] = [];
  let lastMain: string | null = null;
  for (let d = 0; d < trip.days; d++) {
    const occasion = dayOccasions[d];
    const looks = generateLooks(packed, wearer, { occasion, weather: trip.weather, now, limit: 6 });
    const look = looks.find((l) => mainPiece(l) !== lastMain) ?? looks[0];
    if (!look) break;
    lastMain = mainPiece(look);
    schedule.push({ day: d + 1, occasion, look });
  }

  if (byCat('tops').length < size.tops) notes.push(`Only ${byCat('tops').length} suitable tops in your closet; you'll repeat some.`);
  if (byCat('footwear').length === 0) notes.push('No shoes tagged in your closet: add a pair to the list.');
  if (trip.weather === 'monsoon') notes.push('Monsoon: pack an umbrella, quick-dry fabrics and a spare pair of socks.');
  if (dressy && byCat('ethnic').length === 0) notes.push('A festive or wedding day is planned, but no ethnic wear is tagged.');
  if (trip.laundry && trip.days > 4) notes.push('Plan one laundry day around day 4.');
  return { pieces: packed, schedule, notes };
}

function mainPiece(l: Look): string | null {
  return l.garments.find((g) => g.category === 'tops' || g.category === 'ethnic')?.id ?? null;
}
