import type { DigitalTwin } from '../domain/types';
import type { HttpClient } from './httpClient';
import type { InstallationIdProvider } from './installationId';

export interface UploadableGarment {
  clientItemId: string;
  pngBase64: string;
  colorHex: string;
  embedding: Float32Array;
  metadata: Record<string, unknown>;
}

export interface CloudMatch {
  id: string;
  client_item_id: string;
  image_url: string;
  primary_color_hex: string;
  similarity: number;
}

// One small interface per capability, so each consumer depends only on what it calls.

export interface ProfileRemote {
  saveProfile(profile: DigitalTwin): Promise<void>;
}

export interface GarmentRemote {
  uploadGarment(garment: UploadableGarment): Promise<void>;
}

export interface SimilarityRemote {
  /** Top-k visually similar items on the server (pgvector cosine distance), scoped to this user. */
  searchSimilar(embedding: Float32Array, limit?: number): Promise<CloudMatch[]>;
}

/** Maps app types to the Go API's JSON contract. */
export class WardrobeApi implements ProfileRemote, GarmentRemote, SimilarityRemote {
  constructor(
    private readonly http: HttpClient,
    private readonly installation: InstallationIdProvider,
  ) {}

  async saveProfile(profile: DigitalTwin) {
    await this.http.postJson('/api/users/profile', {
      user_id: await this.installation.get(),
      height_cm: Math.round(profile.heightCm),
      body_shape: profile.bodyShape,
      skin_undertone: profile.undertone,
    });
  }

  async uploadGarment(g: UploadableGarment) {
    await this.http.postJson('/api/wardrobe/items', {
      user_id: await this.installation.get(),
      client_item_id: g.clientItemId,
      image_base64: g.pngBase64,
      color_hex: g.colorHex,
      embedding: Array.from(g.embedding),
      metadata: g.metadata,
    });
  }

  async searchSimilar(embedding: Float32Array, limit = 5) {
    const res = await this.http.postJson<{ results: CloudMatch[] }>('/api/wardrobe/search', {
      embedding: Array.from(embedding),
      user_id: await this.installation.get(),
      limit,
    });
    return res.results;
  }
}
