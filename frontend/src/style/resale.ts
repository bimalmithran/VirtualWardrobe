import { SUBCATEGORIES, type Garment } from '../domain/types';
import type { ListingCondition } from '../api/commerceApi';
import { colorName } from '../vision/color';

const RESALE_SHARE: Record<ListingCondition, number> = { new: 0.75, 'like-new': 0.6, good: 0.45, fair: 0.3 };

/** Asking price from the purchase price and condition, rounded to ₹50; null without a price. */
export function suggestPrice(g: Pick<Garment, 'price' | 'wearCount'>, condition: ListingCondition): number | null {
  if (!g.price) return null;
  const worn = Math.min(0.15, g.wearCount * 0.01); // every wear takes a little more off
  return Math.max(50, Math.round((g.price * (RESALE_SHARE[condition] - worn)) / 50) * 50);
}

/** "Navy Striped Shirt · Fabindia", from what the closet already knows. */
export function listingTitle(g: Garment): string {
  const noun = (g.category && g.subcategory && SUBCATEGORIES[g.category].find((s) => s.slug === g.subcategory)?.label) || g.category || 'Garment';
  const pattern = g.pattern && g.pattern !== 'solid' ? `${g.pattern} ` : '';
  const title = `${colorName(g.colorHex)} ${pattern}${noun}`.replace(/\b\w/g, (c) => c.toUpperCase());
  return (g.brand ? `${title} · ${g.brand}` : title).slice(0, 80);
}

export function listingDescription(g: Garment): string {
  const parts = [
    g.size ? `Size ${g.size}.` : '',
    g.occasions.length ? `Great for ${g.occasions.join(', ')}.` : '',
    g.weather.length ? `Suits ${g.weather.join(' and ')} weather.` : '',
    g.wearCount === 0 ? 'Never worn.' : `Worn ${g.wearCount} time${g.wearCount === 1 ? '' : 's'}.`,
  ];
  return parts.filter(Boolean).join(' ');
}
