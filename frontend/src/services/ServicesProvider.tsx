import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useSQLiteContext } from 'expo-sqlite';

import { createAppServices, type AppServices } from './container';

const ServicesContext = createContext<AppServices | null>(null);

/** Builds the service graph once per database. Must sit inside <SQLiteProvider>. */
export function ServicesProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const services = useMemo(() => createAppServices(db), [db]);
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): AppServices {
  const ctx = useContext(ServicesContext);
  if (!ctx) throw new Error('useServices must be used inside ServicesProvider');
  return ctx;
}
