import type { SQLiteDatabase } from 'expo-sqlite';

export interface ChatCard {
  title: string;
  itemIds: string[];
  reason: string;
}

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  cards: ChatCard[];
  createdAt: number;
}

export interface ChatRepository {
  /** Oldest first, the most recent `limit`. */
  list(limit?: number): Promise<ChatMessage[]>;
  add(m: Omit<ChatMessage, 'id' | 'createdAt'>): Promise<ChatMessage>;
  clear(): Promise<void>;
}

interface Row {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  cards_json: string;
  created_at: number;
}

export class SqliteChatRepository implements ChatRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  async list(limit = 200) {
    const rows = await this.db.getAllAsync<Row>('SELECT * FROM (SELECT * FROM chat_messages ORDER BY id DESC LIMIT ?) ORDER BY id', limit);
    return rows.map((r) => ({ id: r.id, role: r.role, text: r.text, cards: JSON.parse(r.cards_json) as ChatCard[], createdAt: r.created_at }));
  }

  async add(m: Omit<ChatMessage, 'id' | 'createdAt'>) {
    const createdAt = Date.now();
    const res = await this.db.runAsync(
      'INSERT INTO chat_messages (role, text, cards_json, created_at) VALUES (?, ?, ?, ?)',
      m.role,
      m.text,
      JSON.stringify(m.cards),
      createdAt,
    );
    return { ...m, id: res.lastInsertRowId, createdAt };
  }

  async clear() {
    await this.db.runAsync('DELETE FROM chat_messages');
  }
}
