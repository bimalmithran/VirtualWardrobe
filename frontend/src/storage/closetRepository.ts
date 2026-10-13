import type { SQLiteDatabase } from 'expo-sqlite';

import {
  CATEGORIES,
  type AppearanceFuser,
  type Category,
  type Garment,
  type GarmentPatch,
  type GarmentPhoto,
  type NewGarment,
  type NewGarmentPhoto,
  type PaletteEntry,
} from '../domain/types';
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
  /** Deletes the garment and its photos, drops it from outfits, and queues a server delete if it was uploaded. */
  remove(garment: Garment): Promise<void>;
}

/**
 * Extra photos of a garment. Every change re-fuses the garment's colour and embedding from
 * all of its photos and re-queues it for upload.
 */
export interface GarmentPhotos {
  /** Oldest first; the first photo is the garment's main image. */
  listPhotos(garmentId: string): Promise<GarmentPhoto[]>;
  /** Returns the stored photo and the garment with its re-fused appearance. */
  addPhoto(garmentId: string, photo: NewGarmentPhoto): Promise<{ garment: Garment; photo: GarmentPhoto }>;
  /** Refuses to remove a garment's only photo. */
  removePhoto(photo: GarmentPhoto): Promise<Garment>;
}

/** What cloud sync needs: only the upload bookkeeping. */
export interface PendingUploads {
  /** Garments not yet uploaded. Ones without an embedding can't be indexed server-side. */
  listUnsynced(): Promise<Garment[]>;
  /** Marks the uploaded revision as synced; a no-op if the garment changed since. */
  markSynced(uploaded: Pick<Garment, 'id' | 'revision'>): Promise<void>;
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
  revision: number;
  photo_count: number;
}

interface PhotoRow {
  id: string;
  garment_id: string;
  image_uri: string;
  palette_json: string;
  embedding: Uint8Array | null;
  created_at: number;
}

const SELECT_GARMENTS =
  'SELECT g.*, (SELECT COUNT(*) FROM garment_photos p WHERE p.garment_id = g.id) AS photo_count FROM garments g';

/**
 * SQLite holds metadata and embedding BLOBs; PNGs go to the image store. The garment row
 * caches the appearance fused from its photos, so lists and suggestions never re-fuse.
 */
export class SqliteClosetRepository implements ClosetRepository, GarmentPhotos, PendingUploads {
  constructor(
    private readonly db: SQLiteDatabase,
    private readonly images: GarmentImageStore,
    private readonly fuse: AppearanceFuser,
  ) {}

  async list() {
    const rows = await this.db.getAllAsync<GarmentRow>(`${SELECT_GARMENTS} ORDER BY g.created_at DESC`);
    return rows.map(fromRow);
  }

  async get(id: string) {
    const row = await this.db.getFirstAsync<GarmentRow>(`${SELECT_GARMENTS} WHERE g.id = ?`, id);
    return row ? fromRow(row) : null;
  }

  async add(input: NewGarment): Promise<Garment> {
    // The first photo shares the garment's id, so its cutout keeps the garment's file name.
    const id = newId();
    const imageUri = this.images.save(id, input.png);
    const createdAt = Date.now();
    const fused = this.fuse([input]);
    try {
      await this.db.withTransactionAsync(async () => {
        await this.db.runAsync(
          'INSERT INTO garments (id, image_uri, color_hex, palette_json, embedding, created_at, category) VALUES (?, ?, ?, ?, ?, ?, ?)',
          id,
          imageUri,
          fused.colorHex,
          JSON.stringify(fused.palette),
          toBlob(fused.embedding),
          createdAt,
          input.category ?? null,
        );
        await this.insertPhoto(id, id, imageUri, input, createdAt);
      });
    } catch (e) {
      this.images.remove(imageUri); // don't leave orphaned PNGs behind
      throw e;
    }
    return (await this.get(id))!;
  }

  async update(id: string, patch: GarmentPatch) {
    if (patch.category !== undefined) {
      // The server stores the category, so the garment has to be uploaded again.
      await this.db.runAsync(
        'UPDATE garments SET category = ?, synced_at = NULL, revision = revision + 1 WHERE id = ?',
        patch.category,
        id,
      );
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
    const photos = await this.listPhotos(garment.id);
    await this.db.withTransactionAsync(async () => {
      const row = await this.db.getFirstAsync<{ synced_at: number | null }>('SELECT synced_at FROM garments WHERE id = ?', garment.id);
      await this.db.runAsync('DELETE FROM garments WHERE id = ?', garment.id);
      await this.db.runAsync('DELETE FROM garment_photos WHERE garment_id = ?', garment.id);
      if (row?.synced_at != null) await recordDeletion(this.db, 'garment', garment.id);
      await this.detachFromOutfits(garment.id);
    });
    for (const uri of new Set([garment.imageUri, ...photos.map((p) => p.imageUri)])) this.images.remove(uri);
  }

  async listPhotos(garmentId: string) {
    const rows = await this.db.getAllAsync<PhotoRow>(
      'SELECT * FROM garment_photos WHERE garment_id = ? ORDER BY created_at, id',
      garmentId,
    );
    return rows.map(photoFromRow);
  }

  async addPhoto(garmentId: string, photo: NewGarmentPhoto) {
    const id = newId();
    const imageUri = this.images.save(id, photo.png);
    const createdAt = Date.now();
    try {
      await this.db.withTransactionAsync(async () => {
        const exists = await this.db.getFirstAsync('SELECT 1 FROM garments WHERE id = ?', garmentId);
        if (!exists) throw new Error('This garment is no longer in your closet.');
        await this.insertPhoto(id, garmentId, imageUri, photo, createdAt);
        await this.refuse(garmentId);
      });
    } catch (e) {
      this.images.remove(imageUri);
      throw e;
    }
    const stored: GarmentPhoto = { id, garmentId, imageUri, palette: photo.palette, embedding: photo.embedding, createdAt };
    return { garment: (await this.get(garmentId))!, photo: stored };
  }

  async removePhoto(photo: GarmentPhoto): Promise<Garment> {
    await this.db.withTransactionAsync(async () => {
      const row = await this.db.getFirstAsync<{ n: number }>(
        'SELECT COUNT(*) AS n FROM garment_photos WHERE garment_id = ?',
        photo.garmentId,
      );
      if ((row?.n ?? 0) <= 1) throw new Error("A garment needs at least one photo. Remove the garment instead.");
      await this.db.runAsync('DELETE FROM garment_photos WHERE id = ?', photo.id);
      await this.refuse(photo.garmentId);
    });
    this.images.remove(photo.imageUri);
    return (await this.get(photo.garmentId))!;
  }

  async listUnsynced() {
    const rows = await this.db.getAllAsync<GarmentRow>(
      `${SELECT_GARMENTS} WHERE g.synced_at IS NULL AND g.embedding IS NOT NULL ORDER BY g.created_at`,
    );
    return rows.map(fromRow);
  }

  /** Compares the uploaded revision so a change made mid-upload is still sent next pass. */
  async markSynced(uploaded: Pick<Garment, 'id' | 'revision'>) {
    await this.db.runAsync('UPDATE garments SET synced_at = ? WHERE id = ? AND revision = ?', Date.now(), uploaded.id, uploaded.revision);
  }

  private insertPhoto(id: string, garmentId: string, imageUri: string, photo: NewGarmentPhoto, createdAt: number) {
    return this.db.runAsync(
      'INSERT INTO garment_photos (id, garment_id, image_uri, palette_json, embedding, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      id,
      garmentId,
      imageUri,
      JSON.stringify(photo.palette),
      toBlob(photo.embedding),
      createdAt,
    );
  }

  /** Recomputes the cached appearance from every photo; the oldest photo is the main image. */
  private async refuse(garmentId: string) {
    const photos = await this.listPhotos(garmentId);
    const fused = this.fuse(photos);
    await this.db.runAsync(
      `UPDATE garments SET image_uri = ?, color_hex = ?, palette_json = ?, embedding = ?,
         synced_at = NULL, revision = revision + 1 WHERE id = ?`,
      photos[0].imageUri,
      fused.colorHex,
      JSON.stringify(fused.palette),
      toBlob(fused.embedding),
      garmentId,
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

function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const isCategory = (s: string | null): s is Category => s !== null && (CATEGORIES as readonly string[]).includes(s);

const toBlob = (v: Float32Array | null) => (v ? new Uint8Array(v.buffer, v.byteOffset, v.byteLength) : null);

// slice() copies into a fresh, 4-byte-aligned buffer before reinterpreting as floats.
const fromBlob = (b: Uint8Array | null) => (b ? new Float32Array(b.slice().buffer) : null);

function fromRow(row: GarmentRow): Garment {
  return {
    id: row.id,
    imageUri: row.image_uri,
    colorHex: row.color_hex,
    palette: JSON.parse(row.palette_json) as PaletteEntry[],
    embedding: fromBlob(row.embedding),
    createdAt: row.created_at,
    syncedAt: row.synced_at,
    category: isCategory(row.category) ? row.category : null,
    favorite: row.favorite === 1,
    wearCount: row.wear_count,
    lastWornAt: row.last_worn_at,
    photoCount: row.photo_count,
    revision: row.revision,
  };
}

function photoFromRow(row: PhotoRow): GarmentPhoto {
  return {
    id: row.id,
    garmentId: row.garment_id,
    imageUri: row.image_uri,
    palette: JSON.parse(row.palette_json) as PaletteEntry[],
    embedding: fromBlob(row.embedding),
    createdAt: row.created_at,
  };
}
