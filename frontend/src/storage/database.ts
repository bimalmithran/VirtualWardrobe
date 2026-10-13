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
  // 4: several photos per garment. Each existing garment becomes its own first photo, and
  // `revision` replaces comparing categories to detect an edit made mid-upload.
  (db) =>
    db.execAsync(`
      CREATE TABLE IF NOT EXISTS garment_photos (
        id TEXT PRIMARY KEY NOT NULL,
        garment_id TEXT NOT NULL,
        image_uri TEXT NOT NULL,
        palette_json TEXT NOT NULL,
        embedding BLOB,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS garment_photos_garment ON garment_photos (garment_id, created_at);
      INSERT OR IGNORE INTO garment_photos (id, garment_id, image_uri, palette_json, embedding, created_at)
        SELECT id, id, image_uri, palette_json, embedding, created_at FROM garments;
      ALTER TABLE garments ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
    `),
  // 5: photos of the user, for colour analysis. Phone-only: there is no sync bookkeeping.
  (db) =>
    db.execAsync(`
      CREATE TABLE IF NOT EXISTS self_photos (
        id TEXT PRIMARY KEY NOT NULL,
        image_uri TEXT NOT NULL,
        reading_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `),
  // 6: tags (pattern, silhouette, occasion, weather, brand, size, price), and a wear log so the
  // detail screen can show history. Existing wear counts keep their last date as one event.
  (db) =>
    db.execAsync(`
      ALTER TABLE garments ADD COLUMN pattern TEXT;
      ALTER TABLE garments ADD COLUMN shape_json TEXT;
      ALTER TABLE garments ADD COLUMN subcategory TEXT;
      ALTER TABLE garments ADD COLUMN occasions_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE garments ADD COLUMN weather_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE garments ADD COLUMN brand TEXT;
      ALTER TABLE garments ADD COLUMN size_label TEXT;
      ALTER TABLE garments ADD COLUMN price INTEGER;
      ALTER TABLE garments ADD COLUMN purchased_at INTEGER;
      CREATE TABLE IF NOT EXISTS wear_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        garment_id TEXT NOT NULL,
        worn_at INTEGER NOT NULL,
        outfit_id TEXT
      );
      CREATE INDEX IF NOT EXISTS wear_log_garment ON wear_log (garment_id, worn_at DESC);
      INSERT INTO wear_log (garment_id, worn_at)
        SELECT id, last_worn_at FROM garments WHERE last_worn_at IS NOT NULL;
    `),
  // 7: cached MoveNet keypoints per photo of the user, for virtual try-on.
  (db) => db.execAsync('ALTER TABLE self_photos ADD COLUMN pose_json TEXT'),
  // 8: stylist chat history, kept on the phone so the conversation survives restarts.
  (db) =>
    db.execAsync(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        text TEXT NOT NULL,
        cards_json TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL
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
