import type { SQLiteDatabase } from 'expo-sqlite';

export type DeletionKind = 'garment' | 'outfit';

export interface PendingDeletion {
  kind: DeletionKind;
  id: string;
}

/** Server-side deletes that are still owed, so sync can replay them when back online. */
export interface DeletionQueue {
  listDeletions(): Promise<PendingDeletion[]>;
  clearDeletion(d: PendingDeletion): Promise<void>;
}

/** Called by repositories inside their delete transaction. */
export async function recordDeletion(db: SQLiteDatabase, kind: DeletionKind, id: string) {
  await db.runAsync('INSERT OR IGNORE INTO deletions (kind, id) VALUES (?, ?)', kind, id);
}

export class SqliteDeletionQueue implements DeletionQueue {
  constructor(private readonly db: SQLiteDatabase) {}

  listDeletions() {
    // Outfits first: the server would cascade them anyway, but this keeps its rows tidy.
    return this.db.getAllAsync<PendingDeletion>("SELECT kind, id FROM deletions ORDER BY kind = 'garment', id");
  }

  async clearDeletion(d: PendingDeletion) {
    await this.db.runAsync('DELETE FROM deletions WHERE kind = ? AND id = ?', d.kind, d.id);
  }
}
