import type { SQLiteDatabase } from 'expo-sqlite';

export const DB_NAME = 'wardrobe.db';

/**
 * Forward-only migrations keyed by PRAGMA user_version. To change the schema, append a step;
 * existing steps never change.
 */
const MIGRATIONS: ((db: SQLiteDatabase) => Promise<void>)[] = [
  // 1: garments table
  (db) =>
    db.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS garments (
        id TEXT PRIMARY KEY NOT NULL,
        image_uri TEXT NOT NULL,
        color_hex TEXT NOT NULL,
        palette_json TEXT NOT NULL,
        embedding BLOB,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS garments_created ON garments (created_at DESC);
    `),
  // 2: cloud sync bookkeeping
  (db) => db.execAsync('ALTER TABLE garments ADD COLUMN synced_at INTEGER'),
  // 3: categories, favourites, wear tracking, outfits, and delete tombstones for sync
  (db) =>
    db.execAsync(`
      ALTER TABLE garments ADD COLUMN category TEXT;
      ALTER TABLE garments ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE garments ADD COLUMN wear_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE garments ADD COLUMN last_worn_at INTEGER;
      CREATE TABLE IF NOT EXISTS outfits (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        item_ids_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_worn_at INTEGER,
        synced_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS outfits_created ON outfits (created_at DESC);
      -- Server-side deletes still owed. Only rows the server has seen get a tombstone.
      CREATE TABLE IF NOT EXISTS deletions (
        kind TEXT NOT NULL CHECK (kind IN ('garment', 'outfit')),
        id TEXT NOT NULL,
        PRIMARY KEY (kind, id)
      );
    `),
];

/** Passed to <SQLiteProvider onInit>. */
export async function migrate(db: SQLiteDatabase) {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const version = row?.user_version ?? 0;
  for (let v = version; v < MIGRATIONS.length; v++) {
    await MIGRATIONS[v](db);
    await db.execAsync(`PRAGMA user_version = ${v + 1}`);
  }
}
