import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import type { ConsentRecord, Purpose, Purposes } from '../../privacy/consent';
import { useServices } from '../../services/ServicesProvider';

interface ConsentValue {
  loaded: boolean;
  record: ConsentRecord | null;
  needsDecision: boolean;
  allows(purpose: Purpose): boolean;
  decide(purposes: Purposes, language: string): Promise<void>;
}

const ConsentContext = createContext<ConsentValue | null>(null);

/** React view of the ConsentService; re-renders consumers when a decision changes. */
export function ConsentProvider({ children }: { children: ReactNode }) {
  const { consent, sync } = useServices();
  const [record, setRecord] = useState<ConsentRecord | null>(consent.current());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    consent.load().then((r) => {
      setRecord(r);
      setLoaded(true);
    });
    return consent.subscribe(setRecord);
  }, [consent]);

  const decide = useCallback(
    async (purposes: Purposes, language: string) => {
      await consent.decide(purposes, language);
      if (purposes.cloud_sync) sync.syncAll().catch(() => {});
    },
    [consent, sync],
  );

  const value = useMemo<ConsentValue>(
    () => ({
      loaded,
      record,
      needsDecision: consent.needsDecision(),
      allows: (p) => consent.allows(p),
      decide,
    }),
    // record drives re-evaluation of the service's derived answers
    [loaded, record, decide, consent],
  );
  return <ConsentContext.Provider value={value}>{children}</ConsentContext.Provider>;
}

export function useConsent() {
  const ctx = useContext(ConsentContext);
  if (!ctx) throw new Error('useConsent must be used inside ConsentProvider');
  return ctx;
}
