import type { Garment } from '../domain/types';

/** Price divided by wears (a never-worn piece costs its full price per wear so far). */
export function costPerWear(g: Pick<Garment, 'price' | 'wearCount'>): number | null {
  if (!g.price || g.price <= 0) return null;
  return Math.round(g.price / Math.max(1, g.wearCount));
}

export function formatInr(n: number): string {
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

export interface CostReport {
  totalSpent: number;
  pricedCount: number;
  averageCpw: number | null;
  /** Lowest cost per wear first. */
  bestValue: { garment: Garment; cpw: number }[];
  /** Highest cost per wear first: expensive pieces you rarely wear. */
  worstValue: { garment: Garment; cpw: number }[];
  /** Priced pieces not worn in 90 days (or never). */
  idle: Garment[];
}

const DAY = 86_400_000;

/** Wardrobe-level cost-per-wear analytics (a premium screen). */
export function costReport(closet: Garment[], now = Date.now(), top = 5): CostReport {
  const priced = closet.filter((g) => g.price && g.price > 0);
  const withCpw = priced.map((g) => ({ garment: g, cpw: costPerWear(g)! }));
  const totalSpent = priced.reduce((s, g) => s + g.price!, 0);
  const totalWears = priced.reduce((s, g) => s + g.wearCount, 0);
  return {
    totalSpent,
    pricedCount: priced.length,
    averageCpw: totalWears > 0 ? Math.round(totalSpent / totalWears) : null,
    bestValue: [...withCpw].filter((x) => x.garment.wearCount > 0).sort((a, b) => a.cpw - b.cpw).slice(0, top),
    worstValue: [...withCpw].sort((a, b) => b.cpw - a.cpw).slice(0, top),
    idle: priced.filter((g) => g.lastWornAt === null || now - g.lastWornAt > 90 * DAY),
  };
}
