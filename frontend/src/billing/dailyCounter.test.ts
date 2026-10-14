import { DailyCounter } from './dailyCounter';

test('counts per day and stops at the limit', async () => {
  const m = new Map<string, string>();
  const store = { get: async (k: string) => m.get(k) ?? null, set: async (k: string, v: string) => void m.set(k, v), remove: async () => {} };
  let day = '2026-10-14';
  const c = new DailyCounter(store, 'tryon', () => day);
  expect([await c.take(2), await c.take(2), await c.take(2)]).toEqual([true, true, false]);
  expect(await c.used()).toBe(2);
  day = '2026-10-15';
  expect(await c.take(2)).toBe(true);
});
