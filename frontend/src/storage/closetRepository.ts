import type { SQLiteDatabase } from 'expo-sqlite';

import type { Garment, NewGarment, PaletteEntry } from '../domain/types';
import type { GarmentImageStore } from './garmentImages';

/** What the closet screens need. */
export interface ClosetRepository {
  list(): Promise<Garment[]>;
  get(id: string): Promise<Garment | null>;
  add(garment: NewGarment): Promise<Garment>;
  remove(garment: Garment): Promise<void>;
}

/** What cloud sync needs: only the upload bookkeeping. */
export interface PendingUploads {
  /** Garments not yet uploaded. Ones without an embedding can't be indexed server-side. */
  listUnsynced(): Promise<Garment[]>;
  markSynced(id: string): Promise<void>;
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

/** SQLite holds metadata and the embedding BLOB; the PNG goes to the image store. */
export class SqliteClosetRepository implements ClosetRepository, PendingUploads {
  constructor(
    private readonly db: SQLiteDatabase,
    private readonly images: GarmentImageStore,
  ) {}

  async list() {
    const rows = await this.db.getAllAsync<GarmentRow>('SELECT * FROM garments ORDER BY created_at DESC');
    return rows.map(fromRow);
  }

  async get(id: string) {
    const row = await this.db.getFirstAsync<GarmentRow>('SELECT * FROM garments WHERE id = ?', id);
    return row ? fromRow(row) : null;
  }

  async add(input: NewGarment): Promise<Garment> {
    const id = newGarmentId();
    const imageUri = this.images.save(id, input.png);
    const createdAt = Date.now();
    try {
      await this.db.runAsync(
        'INSERT INTO garments (id, image_uri, color_hex, palette_json, embedding, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        id,
        imageUri,
        input.colorHex,
        JSON.stringify(input.palette),
        input.embedding ? new Uint8Array(input.embedding.buffer, input.embedding.byteOffset, input.embedding.byteLength) : null,
        createdAt,
      );
    } catch (e) {
      this.images.remove(imageUri); // don't leave orphaned PNGs behind
      throw e;
    }
    return { id, imageUri, colorHex: input.colorHex, palette: input.palette, embedding: input.embedding, createdAt, syncedAt: null };
  }

  async remove(garment: Garment) {
    await this.db.runAsync('DELETE FROM garments WHERE id = ?', garment.id);
    this.images.remove(garment.imageUri);
  }

  async listUnsynced() {
    const rows = await this.db.getAllAsync<GarmentRow>(
      'SELECT * FROM garments WHERE synced_at IS NULL AND embedding IS NOT NULL ORDER BY created_at',
    );
    return rows.map(fromRow);
  }

  async markSynced(id: string) {
    await this.db.runAsync('UPDATE garments SET synced_at = ? WHERE id = ?', Date.now(), id);
  }
}

function newGarmentId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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
