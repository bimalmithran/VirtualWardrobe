import type { KeyValueStore } from '../storage/keyValue';

/**
 * Per-day usage counter for on-device perks (try-on runs on the phone, so the server can't
 * meter it). Stored as "YYYY-MM-DD:count"; a new day starts at zero.
 */
export class DailyCounter {
  constructor(
    private readonly store: KeyValueStore,
    private readonly key: string,
    private readonly today: () => string = () => new Date().toISOString().slice(0, 10),
  ) {}

  async used(): Promise<number> {
    const raw = await this.store.get(this.key).catch(() => null);
    const [day, n] = (raw ?? '').split(':');
    return day === this.today() ? Number(n) || 0 : 0;
  }

  /** Counts one use if under `limit`; returns false (and counts nothing) when the limit is reached. */
  async take(limit: number): Promise<boolean> {
    const n = await this.used();
    if (n >= limit) return false;
    await this.store.set(this.key, `${this.today()}:${n + 1}`).catch(() => {});
    return true;
  }
}
