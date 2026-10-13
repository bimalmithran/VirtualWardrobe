import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import type { Garment, Outfit } from '../../domain/types';
import { useServices } from '../../services/ServicesProvider';

/** Garments and outfits, reloaded on focus and after each sync. */
export function useWardrobe() {
  const { closet, outfits, sync } = useServices();
  const [garments, setGarments] = useState<Garment[] | null>(null);
  const [saved, setSaved] = useState<Outfit[]>([]);

  const reload = useCallback(() => {
    Promise.all([closet.list(), outfits.list()])
      .then(([g, o]) => {
        setGarments(g);
        setSaved(o);
      })
      .catch(() => setGarments([]));
  }, [closet, outfits]);

  useFocusEffect(reload);
  useEffect(() => sync.onSynced(reload), [sync, reload]);

  return { garments, outfits: saved, reload };
}

/** An outfit's garments in its stored order, skipping any no longer in the closet. */
export function piecesOf(outfit: Outfit, garments: Garment[]): Garment[] {
  const byId = new Map(garments.map((g) => [g.id, g]));
  return outfit.itemIds.map((id) => byId.get(id)).filter((g): g is Garment => g !== undefined);
}
