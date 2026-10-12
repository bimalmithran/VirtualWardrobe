import type { Garment } from '../domain/types';
import { cosine } from './embedding';

export interface RankedGarment {
  garment: Garment;
  score: number;
}

/**
 * On-device nearest neighbours. Brute-force cosine is instant for a personal closet
 * (hundreds of 512-d vectors); the server's HNSW index covers the large-scale case.
 */
export function rankBySimilarity(query: Garment, candidates: Garment[], limit: number): RankedGarment[] {
  const q = query.embedding;
  if (!q) return [];
  return candidates
    .filter((g) => g.id !== query.id && g.embedding)
    .map((garment) => ({ garment, score: cosine(q, garment.embedding!) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
