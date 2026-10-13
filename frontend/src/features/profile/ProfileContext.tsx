import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import type { DigitalTwin, DigitalTwinInput } from '../../domain/types';
import { useServices } from '../../services/ServicesProvider';

interface ProfileContextValue {
  profile: DigitalTwin | null;
  loaded: boolean;
  save: (input: DigitalTwinInput) => Promise<void>;
  /** Re-reads the stored profile (after a local erase). */
  reload: () => Promise<void>;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

/** Holds the Digital Twin in React state. Persistence and sync are delegated to services. */
export function ProfileProvider({ children }: { children: ReactNode }) {
  const { profiles, sync } = useServices();
  const [profile, setProfile] = useState<DigitalTwin | null>(null);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    setProfile(await profiles.load());
    setLoaded(true);
  }, [profiles]);

  useEffect(() => {
    profiles.load().then((p) => {
      setProfile(p);
      setLoaded(true);
    });
  }, [profiles]);

  const save = useCallback(
    async (input: DigitalTwinInput) => {
      const next = { ...input, updatedAt: Date.now() };
      await profiles.save(next);
      setProfile(next);
      // Local save already succeeded; a failed upload is retried by the next syncAll().
      sync.syncProfile(next).catch((e) => console.warn('Profile sync failed; will retry.', e));
    },
    [profiles, sync],
  );

  const value = useMemo(() => ({ profile, loaded, save, reload }), [profile, loaded, save, reload]);
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile() {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error('useProfile must be used inside ProfileProvider');
  return ctx;
}
