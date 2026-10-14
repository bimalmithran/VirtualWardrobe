import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { router } from 'expo-router';

import { useServices } from '../services/ServicesProvider';
import type { PremiumState } from './premium';

interface PremiumValue extends PremiumState {
  /** Opens the paywall, explaining which perk led there. */
  upgrade(reason?: string): void;
}

const PremiumContext = createContext<PremiumValue | null>(null);

export function PremiumProvider({ children }: { children: ReactNode }) {
  const { premium } = useServices();
  const [state, setState] = useState(premium.current());
  useEffect(() => {
    premium.start();
    return premium.subscribe(setState);
  }, [premium]);
  const value = useMemo<PremiumValue>(
    () => ({ ...state, upgrade: (reason) => router.push({ pathname: '/premium', params: reason ? { reason } : {} }) }),
    [state],
  );
  return <PremiumContext.Provider value={value}>{children}</PremiumContext.Provider>;
}

export function usePremium() {
  const ctx = useContext(PremiumContext);
  if (!ctx) throw new Error('usePremium must be used inside PremiumProvider');
  return ctx;
}
