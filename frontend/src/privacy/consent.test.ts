import { ConsentService, NO_CONSENT, type PrivacyRemote } from './consent';

function memoryStore() {
  const m = new Map<string, string>();
  return {
    get: async (k: string) => m.get(k) ?? null,
    set: async (k: string, v: string) => void m.set(k, v),
    remove: async (k: string) => void m.delete(k),
  };
}

function remote() {
  const calls: string[] = [];
  const r: PrivacyRemote = {
    recordConsent: async (c) => void calls.push(`record:${Object.keys(c.purposes).filter((k) => c.purposes[k as keyof typeof c.purposes]).join(',')}`),
    eraseCloudData: async () => void calls.push('erase'),
    exportCloudData: async () => ({}),
  };
  return { r, calls };
}

test('nothing is allowed before a decision, and core is required', async () => {
  const svc = new ConsentService(memoryStore(), null);
  await svc.load();
  expect(svc.needsDecision()).toBe(true);
  expect(svc.allows('core')).toBe(false);
  await svc.decide({ ...NO_CONSENT, analytics: true }, 'en');
  expect(svc.needsDecision()).toBe(true);
  expect(svc.allows('analytics')).toBe(false); // optional purposes need core too
  await svc.decide({ ...NO_CONSENT, core: true }, 'en');
  expect(svc.needsDecision()).toBe(false);
});

test('core-only consent never contacts the server', async () => {
  const { r, calls } = remote();
  const svc = new ConsentService(memoryStore(), r);
  await svc.decide({ ...NO_CONSENT, core: true }, 'hi');
  expect(calls).toEqual([]);
});

test('withdrawing cloud backup erases the server copy and records the new choice', async () => {
  const { r, calls } = remote();
  const svc = new ConsentService(memoryStore(), r);
  await svc.decide({ ...NO_CONSENT, core: true, cloud_sync: true, ai_stylist: true }, 'en');
  expect(calls).toEqual(['record:core,cloud_sync,ai_stylist']);
  expect(svc.current()?.syncedAt).not.toBeNull();
  await svc.decide({ ...NO_CONSENT, core: true, ai_stylist: true }, 'en');
  expect(calls).toEqual(['record:core,cloud_sync,ai_stylist', 'erase', 'record:core,ai_stylist']);
  expect(svc.allows('cloud_sync')).toBe(false);
});

test('a decision survives a restart', async () => {
  const store = memoryStore();
  await new ConsentService(store, null).decide({ ...NO_CONSENT, core: true, analytics: true }, 'ml');
  const again = new ConsentService(store, null);
  await again.load();
  expect(again.allows('analytics')).toBe(true);
  expect(again.current()?.language).toBe('ml');
});

test('erasing cloud data switches backup off and resets upload bookkeeping', async () => {
  const { r, calls } = remote();
  let resets = 0;
  const svc = new ConsentService(memoryStore(), r, async () => void resets++);
  await svc.decide({ ...NO_CONSENT, core: true, cloud_sync: true }, 'en');
  await svc.eraseCloud();
  expect(calls).toEqual(['record:core,cloud_sync', 'erase']);
  expect(resets).toBe(1);
  expect(svc.allows('cloud_sync')).toBe(false);
});
