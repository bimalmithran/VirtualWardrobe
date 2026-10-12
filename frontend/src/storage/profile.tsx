import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as SecureStore from 'expo-secure-store';

import { syncProfile } from '../api/sync';

export type Undertone = 'warm' | 'cool' | 'neutral';
export type BodyShape = 'rectangle' | 'triangle' | 'inverted-triangle' | 'hourglass' | 'oval';

export interface DigitalTwin {
  heightCm: number;
  bodyShape: BodyShape;
  undertone: Undertone;
  updatedAt: number;
}

const KEY = 'digital_twin_v1';

/** Reads the stored Digital Twin; a corrupt or unreadable entry counts as not onboarded. */
export async function readProfile(): Promise<DigitalTwin | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    return raw ? (JSON.parse(raw) as DigitalTwin) : null;
  } catch {
    return null;
  }
}

/** Mirrors the profile to the Go backend. Local save already succeeded, so failures only log. */
function syncInBackground(profile: DigitalTwin) {
  syncProfile(profile).catch((e) => console.warn('Profile sync failed; will retry on next sync.', e));
}

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
    readProfile().then((p) => {
      setProfile(p);
      setLoaded(true);
    });
  }, []);

  const save = useCallback(async (input: Omit<DigitalTwin, 'updatedAt'>) => {
    const next = { ...input, updatedAt: Date.now() };
    await SecureStore.setItemAsync(KEY, JSON.stringify(next));
    setProfile(next);
    syncInBackground(next);
  }, []);

  const value = useMemo(() => ({ profile, loaded, save }), [profile, loaded, save]);
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile() {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error('useProfile must be used inside ProfileProvider');
  return ctx;
}
