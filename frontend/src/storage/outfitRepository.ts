import type { SQLiteDatabase } from 'expo-sqlite';

import type { Outfit } from '../domain/types';
import { recordDeletion } from './deletionQueue';

export interface OutfitRepository {
  list(): Promise<Outfit[]>;
  get(id: string): Promise<Outfit | null>;
  create(input: { name: string; itemIds: string[] }): Promise<Outfit>;
  rename(id: string, name: string): Promise<void>;
  markWorn(id: string): Promise<void>;
  remove(id: string): Promise<void>;
}

/** What cloud sync needs. */
export interface PendingOutfits {
  listUnsyncedOutfits(): Promise<Outfit[]>;
  /** Marks the uploaded version as synced; a no-op if the outfit was edited since. */
  markOutfitSynced(uploaded: Pick<Outfit, 'id' | 'name' | 'itemIds'>): Promise<void>;
}

interface OutfitRow {
  id: string;
  name: string;
  item_ids_json: string;
  created_at: number;
  last_worn_at: number | null;
  synced_at: number | null;
}

export class SqliteOutfitRepository implements OutfitRepository, PendingOutfits {
  constructor(private readonly db: SQLiteDatabase) {}

  async list() {
    const rows = await this.db.getAllAsync<OutfitRow>('SELECT * FROM outfits ORDER BY created_at DESC');
    return rows.map(fromRow);
  }

  async get(id: string) {
    const row = await this.db.getFirstAsync<OutfitRow>('SELECT * FROM outfits WHERE id = ?', id);
    return row ? fromRow(row) : null;
  }

  async create({ name, itemIds }: { name: string; itemIds: string[] }): Promise<Outfit> {
    const outfit: Outfit = {
      id: `o-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      name: name.trim() || 'Untitled outfit',
      itemIds: [...new Set(itemIds)],
      createdAt: Date.now(),
      lastWornAt: null,
      syncedAt: null,
    };
    await this.db.runAsync(
      'INSERT INTO outfits (id, name, item_ids_json, created_at) VALUES (?, ?, ?, ?)',
      outfit.id,
      outfit.name,
      JSON.stringify(outfit.itemIds),
      outfit.createdAt,
    );
    return outfit;
  }

  async rename(id: string, name: string) {
    await this.db.runAsync('UPDATE outfits SET name = ?, synced_at = NULL WHERE id = ?', name.trim() || 'Untitled outfit', id);
  }

  async markWorn(id: string) {
    await this.db.runAsync('UPDATE outfits SET last_worn_at = ? WHERE id = ?', Date.now(), id);
  }

  async remove(id: string) {
    await this.db.withTransactionAsync(async () => {
      const row = await this.db.getFirstAsync<{ synced_at: number | null }>('SELECT synced_at FROM outfits WHERE id = ?', id);
      await this.db.runAsync('DELETE FROM outfits WHERE id = ?', id);
      if (row?.synced_at != null) await recordDeletion(this.db, 'outfit', id);
    });
  }

  async listUnsyncedOutfits() {
    const rows = await this.db.getAllAsync<OutfitRow>('SELECT * FROM outfits WHERE synced_at IS NULL ORDER BY created_at');
    return rows.map(fromRow);
  }

  async markOutfitSynced(uploaded: Pick<Outfit, 'id' | 'name' | 'itemIds'>) {
    await this.db.runAsync(
      'UPDATE outfits SET synced_at = ? WHERE id = ? AND name = ? AND item_ids_json = ?',
      Date.now(),
      uploaded.id,
      uploaded.name,
      JSON.stringify(uploaded.itemIds),
    );
  }
}

function fromRow(row: OutfitRow): Outfit {
  return {
    id: row.id,
    name: row.name,
    itemIds: JSON.parse(row.item_ids_json) as string[],
    createdAt: row.created_at,
    lastWornAt: row.last_worn_at,
    syncedAt: row.synced_at,
  };
}
