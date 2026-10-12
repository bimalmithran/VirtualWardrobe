import * as SecureStore from 'expo-secure-store';

import type { DigitalTwin } from '../storage/profile';

/**
 * Base URL of the Go API, baked in at bundle time. Unset means cloud sync is off and
 * the app runs fully on-device.
 *   EXPO_PUBLIC_API_URL=http://192.168.1.20:8080
 */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/+$/, '');
export const cloudEnabled = API_URL.length > 0;

const USER_ID_KEY = 'user_id_v1';
const TIMEOUT_MS = 20_000;

let userId: Promise<string> | null = null;

/**
 * Stable anonymous id for this install, created on first use. Not a credential: the POC
 * has no auth, the id only partitions data on the server.
 */
export function getUserId(): Promise<string> {
  userId ??= (async () => {
    const existing = await SecureStore.getItemAsync(USER_ID_KEY);
    if (existing) return existing;
    const id = uuidV4();
    await SecureStore.setItemAsync(USER_ID_KEY, id);
    return id;
  })().catch((e) => {
    userId = null; // let the next call retry
    throw e;
  });
  return userId;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  if (!cloudEnabled) throw new ApiError(0, 'Cloud sync is not configured (EXPO_PUBLIC_API_URL).');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, (json as { error?: string }).error ?? `HTTP ${res.status}`);
    return json as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, controller.signal.aborted ? 'Request timed out' : `Network error: ${String(e)}`);
  } finally {
    clearTimeout(timer);
  }
}

export async function postProfile(profile: DigitalTwin): Promise<void> {
  await post('/api/users/profile', {
    user_id: await getUserId(),
    height_cm: Math.round(profile.heightCm),
    body_shape: profile.bodyShape,
    skin_undertone: profile.undertone,
  });
}

export interface WardrobeItemPayload {
  clientItemId: string;
  pngBase64: string;
  colorHex: string;
  embedding: Float32Array;
  metadata: Record<string, unknown>;
}

export async function postWardrobeItem(item: WardrobeItemPayload): Promise<{ id: string; image_url: string }> {
  return post('/api/wardrobe/items', {
    user_id: await getUserId(),
    client_item_id: item.clientItemId,
    image_base64: item.pngBase64,
    color_hex: item.colorHex,
    embedding: Array.from(item.embedding),
    metadata: item.metadata,
  });
}

export interface CloudMatch {
  id: string;
  client_item_id: string;
  image_url: string;
  primary_color_hex: string;
  similarity: number;
}

/** Top-k visually similar items on the server (pgvector cosine distance), scoped to this user. */
export async function searchSimilar(embedding: Float32Array, limit = 5): Promise<CloudMatch[]> {
  const res = await post<{ results: CloudMatch[] }>('/api/wardrobe/search', {
    embedding: Array.from(embedding),
    user_id: await getUserId(),
    limit,
  });
  return res.results;
}

/** RFC 4122 v4. Hermes has no crypto.getRandomValues; Math.random is fine for a non-secret id. */
function uuidV4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
