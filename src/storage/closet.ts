import { Directory, File, Paths } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';

import type { PaletteEntry } from '../vision/colorExtraction';

export const DB_NAME = 'wardrobe.db';

export interface Garment {
  id: string;
  imageUri: string;
  colorHex: string;
  palette: PaletteEntry[];
  embedding: Float32Array | null;
  createdAt: number;
  /** When the garment was uploaded to the Go backend; null while pending. */
  syncedAt: number | null;
}

interface GarmentRow {
  id: string;
  image_uri: string;
  color_hex: string;
  palette_json: string;
  embedding: Uint8Array | null;
  created_at: number;
  synced_at: number | null;
}

const SCHEMA_VERSION = 2;

/** Passed to <SQLiteProvider onInit>. Uses PRAGMA user_version for forward migrations. */
export async function migrate(db: SQLiteDatabase) {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const version = row?.user_version ?? 0;
  if (version >= SCHEMA_VERSION) return;

  if (version < 1) {
    await db.execAsync(`
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
    `);
  }
  if (version < 2) {
    await db.execAsync('ALTER TABLE garments ADD COLUMN synced_at INTEGER');
  }
  await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

const closetDir = () => {
  const dir = new Directory(Paths.document, 'closet');
  dir.create({ intermediates: true, idempotent: true });
  return dir;
};

export function newGarmentId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function insertGarment(
  db: SQLiteDatabase,
  input: { id: string; png: Uint8Array; colorHex: string; palette: PaletteEntry[]; embedding: Float32Array | null },
): Promise<Garment> {
  const file = new File(closetDir(), `${input.id}.png`);
  file.write(input.png);
  const createdAt = Date.now();
  try {
    await db.runAsync(
      'INSERT INTO garments (id, image_uri, color_hex, palette_json, embedding, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      input.id,
      file.uri,
      input.colorHex,
      JSON.stringify(input.palette),
      input.embedding ? new Uint8Array(input.embedding.buffer, input.embedding.byteOffset, input.embedding.byteLength) : null,
      createdAt,
    );
  } catch (e) {
    file.delete(); // don't leave orphaned PNGs behind
    throw e;
  }
  return { id: input.id, imageUri: file.uri, colorHex: input.colorHex, palette: input.palette, embedding: input.embedding, createdAt, syncedAt: null };
}

export async function listGarments(db: SQLiteDatabase): Promise<Garment[]> {
  const rows = await db.getAllAsync<GarmentRow>('SELECT * FROM garments ORDER BY created_at DESC');
  return rows.map(fromRow);
}

export async function getGarment(db: SQLiteDatabase, id: string): Promise<Garment | null> {
  const row = await db.getFirstAsync<GarmentRow>('SELECT * FROM garments WHERE id = ?', id);
  return row ? fromRow(row) : null;
}

/** Garments not yet uploaded. Ones without an embedding can't be indexed server-side. */
export async function listUnsynced(db: SQLiteDatabase): Promise<Garment[]> {
  const rows = await db.getAllAsync<GarmentRow>(
    'SELECT * FROM garments WHERE synced_at IS NULL AND embedding IS NOT NULL ORDER BY created_at',
  );
  return rows.map(fromRow);
}

export async function markSynced(db: SQLiteDatabase, id: string) {
  await db.runAsync('UPDATE garments SET synced_at = ? WHERE id = ?', Date.now(), id);
}

export async function deleteGarment(db: SQLiteDatabase, garment: Garment) {
  await db.runAsync('DELETE FROM garments WHERE id = ?', garment.id);
  const file = new File(garment.imageUri);
  if (file.exists) file.delete();
}

function fromRow(row: GarmentRow): Garment {
  return {
    id: row.id,
    imageUri: row.image_uri,
    colorHex: row.color_hex,
    palette: JSON.parse(row.palette_json) as PaletteEntry[],
    // slice() copies into a fresh, 4-byte-aligned buffer before reinterpreting as floats.
    embedding: row.embedding ? new Float32Array(row.embedding.slice().buffer) : null,
    createdAt: row.created_at,
    syncedAt: row.synced_at,
  };
}
