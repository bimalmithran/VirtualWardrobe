import type { SQLiteDatabase } from 'expo-sqlite';

/** Wipes the user's data from this device (the DPDP right to erasure, on the phone side). */
export interface LocalEraser {
  eraseAll(): Promise<void>;
}

/** Tables whose rows are the user's data. Schema bookkeeping (user_version) is kept. */
const USER_TABLES = ['garments', 'garment_photos', 'outfits', 'deletions', 'self_photos', 'wear_log', 'chat_messages', 'listings'];

export class DeviceEraser implements LocalEraser {
  constructor(
    private readonly db: SQLiteDatabase,
    private readonly imageStores: { clear(): void }[],
    /** Keystore entries: profile, consent, device identity. */
    private readonly forget: (() => Promise<void>)[],
  ) {}

  async eraseAll() {
    const existing = new Set(
      (await this.db.getAllAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")).map((r) => r.name),
    );
    await this.db.withTransactionAsync(async () => {
      for (const t of USER_TABLES) if (existing.has(t)) await this.db.runAsync(`DELETE FROM ${t}`);
    });
    for (const store of this.imageStores) store.clear();
    for (const f of this.forget) await f();
  }
}
