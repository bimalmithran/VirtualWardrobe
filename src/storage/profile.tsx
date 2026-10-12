import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as SecureStore from 'expo-secure-store';

export type Undertone = 'warm' | 'cool' | 'neutral';
export type BodyShape = 'rectangle' | 'triangle' | 'inverted-triangle' | 'hourglass' | 'oval';

export interface DigitalTwin {
  heightCm: number;
  bodyShape: BodyShape;
  undertone: Undertone;
  updatedAt: number;
}

const KEY = 'digital_twin_v1';

interface ProfileContextValue {
  profile: DigitalTwin | null;
  loaded: boolean;
  save: (profile: Omit<DigitalTwin, 'updatedAt'>) => Promise<void>;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<DigitalTwin | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    SecureStore.getItemAsync(KEY)
      .then((raw) => setProfile(raw ? (JSON.parse(raw) as DigitalTwin) : null))
      .catch(() => setProfile(null)) // corrupt/unreadable entry: treat as not onboarded
      .finally(() => setLoaded(true));
  }, []);

  const save = useCallback(async (input: Omit<DigitalTwin, 'updatedAt'>) => {
    const next = { ...input, updatedAt: Date.now() };
    await SecureStore.setItemAsync(KEY, JSON.stringify(next));
    setProfile(next);
  }, []);

  const value = useMemo(() => ({ profile, loaded, save }), [profile, loaded, save]);
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile() {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error('useProfile must be used inside ProfileProvider');
  return ctx;
}
