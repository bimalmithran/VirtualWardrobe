import { fetch } from 'expo/fetch';

import { ApiError, type HttpClient } from './httpClient';
import { SseParser } from './sse';

export interface OutfitCardEvent {
  title: string;
  item_ids: string[];
  reason: string;
}

export type StylistEvent =
  | { type: 'delta'; text: string }
  | { type: 'outfit'; card: OutfitCardEvent }
  | { type: 'done'; provider: string }
  | { type: 'error'; code: string; message: string };

/** Body of POST /api/stylist/chat (see backend/internal/stylist). */
export interface ChatPayload {
  messages: { role: 'user' | 'assistant'; text: string }[];
  closet: {
    id: string;
    category: string;
    subcategory?: string;
    colour: string;
    hex: string;
    pattern?: string;
    occasions?: string[];
    weather?: string[];
    wear_count: number;
    favourite?: boolean;
  }[];
  candidates: { item_ids: string[]; score: number }[];
  wearer: { undertone?: string; season?: string; body_shape?: string; height_cm?: number };
  context: string;
}

export interface StylistRemote {
  /** Streams one reply; resolves when the stream ends. Abort with `signal`. */
  chat(payload: ChatPayload, onEvent: (e: StylistEvent) => void, signal?: AbortSignal): Promise<void>;
}

/** SSE client for the stylist. Uses expo/fetch, whose response body is a readable byte stream. */
export class StylistApi implements StylistRemote {
  constructor(private readonly http: HttpClient) {}

  async chat(payload: ChatPayload, onEvent: (e: StylistEvent) => void, signal?: AbortSignal, retried = false): Promise<void> {
    const res = await fetch(`${this.http.baseUrl}/api/stylist/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...(await this.http.authHeaders()) },
      body: JSON.stringify(payload),
      signal,
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      if (res.status === 401 && !retried) {
        await this.http.ensureEnrolled();
        return this.chat(payload, onEvent, signal, true);
      }
      throw new ApiError(res.status, json.error ?? `HTTP ${res.status}`, json.code ?? null);
    }
    if (!res.body) throw new ApiError(0, 'Streaming is not supported here');

    const reader = res.body.getReader();
    const parser = new SseParser();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const ev of parser.push(value)) {
        const data = JSON.parse(ev.data) as Record<string, unknown>;
        if (ev.event === 'delta') onEvent({ type: 'delta', text: String(data.text ?? '') });
        else if (ev.event === 'outfit') onEvent({ type: 'outfit', card: data as unknown as OutfitCardEvent });
        else if (ev.event === 'done') onEvent({ type: 'done', provider: String(data.provider ?? '') });
        else if (ev.event === 'error') onEvent({ type: 'error', code: String(data.code ?? ''), message: String(data.error ?? '') });
      }
    }
  }
}
