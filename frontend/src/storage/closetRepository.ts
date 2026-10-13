import type { SQLiteDatabase } from 'expo-sqlite';

import { CATEGORIES, type Category, type Garment, type GarmentPatch, type NewGarment, type PaletteEntry } from '../domain/types';
import { recordDeletion } from './deletionQueue';
import type { GarmentImageStore } from './garmentImages';

/** What the closet screens need. */
export interface ClosetRepository {
  list(): Promise<Garment[]>;
  get(id: string): Promise<Garment | null>;
  add(garment: NewGarment): Promise<Garment>;
  update(id: string, patch: GarmentPatch): Promise<void>;
  /** Records that the garments were worn now. */
  markWorn(ids: string[]): Promise<void>;
  /** Deletes the garment, drops it from outfits, and queues a server delete if it was uploaded. */
  remove(garment: Garment): Promise<void>;
}

/** What cloud sync needs: only the upload bookkeeping. */
export interface PendingUploads {
  /** Garments not yet uploaded. Ones without an embedding can't be indexed server-side. */
  listUnsynced(): Promise<Garment[]>;
  /** Marks the uploaded version as synced; a no-op if the garment was edited since. */
  markSynced(uploaded: Pick<Garment, 'id' | 'category'>): Promise<void>;
}

interface GarmentRow {
  id: string;
  image_uri: string;
  color_hex: string;
  palette_json: string;
  embedding: Uint8Array | null;
  created_at: number;
  synced_at: number | null;
  category: string | null;
  favorite: number;
  wear_count: number;
  last_worn_at: number | null;
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
    const category = input.category ?? null;
    try {
      await this.db.runAsync(
        'INSERT INTO garments (id, image_uri, color_hex, palette_json, embedding, created_at, category) VALUES (?, ?, ?, ?, ?, ?, ?)',
        id,
        imageUri,
        input.colorHex,
        JSON.stringify(input.palette),
        input.embedding ? new Uint8Array(input.embedding.buffer, input.embedding.byteOffset, input.embedding.byteLength) : null,
        createdAt,
        category,
      );
    } catch (e) {
      this.images.remove(imageUri); // don't leave orphaned PNGs behind
      throw e;
    }
    return {
      id,
      imageUri,
      colorHex: input.colorHex,
      palette: input.palette,
      embedding: input.embedding,
      createdAt,
      syncedAt: null,
      category,
      favorite: false,
      wearCount: 0,
      lastWornAt: null,
    };
  }

  async update(id: string, patch: GarmentPatch) {
    if (patch.category !== undefined) {
      // The server stores the category, so the garment has to be uploaded again.
      await this.db.runAsync('UPDATE garments SET category = ?, synced_at = NULL WHERE id = ?', patch.category, id);
    }
    if (patch.favorite !== undefined) {
      await this.db.runAsync('UPDATE garments SET favorite = ? WHERE id = ?', patch.favorite ? 1 : 0, id);
    }
  }

  async markWorn(ids: string[]) {
    const now = Date.now();
    await this.db.withTransactionAsync(async () => {
      for (const id of ids) {
        await this.db.runAsync('UPDATE garments SET wear_count = wear_count + 1, last_worn_at = ? WHERE id = ?', now, id);
      }
    });
  }

  async remove(garment: Garment) {
    await this.db.withTransactionAsync(async () => {
      const row = await this.db.getFirstAsync<{ synced_at: number | null }>('SELECT synced_at FROM garments WHERE id = ?', garment.id);
      await this.db.runAsync('DELETE FROM garments WHERE id = ?', garment.id);
      if (row?.synced_at != null) await recordDeletion(this.db, 'garment', garment.id);
      await this.detachFromOutfits(garment.id);
    });
    this.images.remove(garment.imageUri);
  }

  async listUnsynced() {
    const rows = await this.db.getAllAsync<GarmentRow>(
      'SELECT * FROM garments WHERE synced_at IS NULL AND embedding IS NOT NULL ORDER BY created_at',
    );
    return rows.map(fromRow);
  }

  /** Compares the uploaded category so an edit made mid-upload is still sent next pass. */
  async markSynced(uploaded: Pick<Garment, 'id' | 'category'>) {
    await this.db.runAsync(
      "UPDATE garments SET synced_at = ? WHERE id = ? AND IFNULL(category, '') = ?",
      Date.now(),
      uploaded.id,
      uploaded.category ?? '',
    );
  }

  /**
   * Mirrors the server's ON DELETE CASCADE on outfit_items. An outfit left empty is deleted;
   * one that still has garments is re-queued so the server gets the shorter list.
   */
  private async detachFromOutfits(garmentId: string) {
    const outfits = await this.db.getAllAsync<{ id: string; item_ids_json: string; synced_at: number | null }>(
      'SELECT id, item_ids_json, synced_at FROM outfits WHERE item_ids_json LIKE ?',
      `%"${garmentId}"%`,
    );
    for (const o of outfits) {
      const remaining = (JSON.parse(o.item_ids_json) as string[]).filter((x) => x !== garmentId);
      if (remaining.length === 0) {
        await this.db.runAsync('DELETE FROM outfits WHERE id = ?', o.id);
        if (o.synced_at != null) await recordDeletion(this.db, 'outfit', o.id);
      } else {
        await this.db.runAsync('UPDATE outfits SET item_ids_json = ?, synced_at = NULL WHERE id = ?', JSON.stringify(remaining), o.id);
      }
    }
  }
}

function newGarmentId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const isCategory = (s: string | null): s is Category => s !== null && (CATEGORIES as readonly string[]).includes(s);

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
    category: isCategory(row.category) ? row.category : null,
    favorite: row.favorite === 1,
    wearCount: row.wear_count,
    lastWornAt: row.last_worn_at,
  };
}
