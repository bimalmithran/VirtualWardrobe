import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import type { PersonalColouring, SelfPhoto, Wearer } from '../../domain/types';
import { useServices } from '../../services/ServicesProvider';
import { effectiveColouring } from '../../style/seasons';
import { fuseColouring } from '../../vision/personColouring';
import type { Photo } from '../../vision/pipeline';
import { useProfile } from '../profile/ProfileContext';

interface SelfContextValue {
  photos: SelfPhoto[];
  /** Combined from every photo; null until there is at least one. */
  colouring: PersonalColouring | null;
  /** Analyses and stores a photo. Rejects with a user-readable message when it can't be read. */
  add(photo: Photo): Promise<SelfPhoto>;
  remove(photo: SelfPhoto): Promise<void>;
  reload(): Promise<void>;
}

const SelfContext = createContext<SelfContextValue | null>(null);

/** Holds the user's photos in React state. Analysis and storage are delegated to services. */
export function SelfProvider({ children }: { children: ReactNode }) {
  const { self } = useServices();
  const [photos, setPhotos] = useState<SelfPhoto[]>([]);

  const reload = useCallback(async () => {
    setPhotos(await self.photos.list().catch(() => []));
  }, [self]);

  useEffect(() => {
    self.photos.list().then(setPhotos).catch(() => setPhotos([]));
  }, [self]);

  const add = useCallback(
    async (photo: Photo) => {
      const analyzed = await self.analyzer.analyze(photo);
      const saved = await self.photos.add(analyzed);
      setPhotos((prev) => [...prev, saved]);
      return saved;
    },
    [self],
  );

  const remove = useCallback(
    async (photo: SelfPhoto) => {
      await self.photos.remove(photo);
      setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
    },
    [self],
  );

  const colouring = useMemo(() => fuseColouring(photos.map((p) => p.reading)), [photos]);
  const value = useMemo(() => ({ photos, colouring, add, remove, reload }), [photos, colouring, add, remove, reload]);
  return <SelfContext.Provider value={value}>{children}</SelfContext.Provider>;
}

export function useSelf() {
  const ctx = useContext(SelfContext);
  if (!ctx) throw new Error('useSelf must be used inside SelfProvider');
  return ctx;
}

/**
 * Who suggestions are for: the Digital Twin's undertone plus the colouring read from photos,
 * or the 12-season type chosen on the Twin, which takes precedence.
 */
export function useWearer(): Wearer {
  const profile = useProfile().profile;
  const undertone = profile?.undertone ?? null;
  const chosen = profile?.season ?? null;
  const { colouring } = useSelf();
  return useMemo(
    () => ({ undertone, colouring: effectiveColouring(colouring, chosen, undertone) }),
    [undertone, colouring, chosen],
  );
}
