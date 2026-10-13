import type { DigitalTwin } from '../domain/types';
import type { ConsentRecord, PrivacyRemote } from '../privacy/consent';
import type { VisionRemote } from '../vision/cloudVision';
import { ApiError, type HttpClient } from './httpClient';
import type { InstallationIdProvider } from './installationId';

export interface UploadableGarment {
  clientItemId: string;
  categorySlug: string | null;
  imageBase64: string;
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

export interface UploadableOutfit {
  clientOutfitId: string;
  name: string;
  itemClientIds: string[];
  metadata: Record<string, unknown>;
}

export interface GarmentRemote {
  uploadGarment(garment: UploadableGarment): Promise<void>;
  /** Resolves when the garment is gone, including when the server never had it. */
  deleteGarment(clientItemId: string): Promise<void>;
}

export interface OutfitRemote {
  /** Rejects with a 409 ApiError while any of its garments is not uploaded yet. */
  uploadOutfit(outfit: UploadableOutfit): Promise<void>;
  /** Resolves when the outfit is gone, including when the server never had it. */
  deleteOutfit(clientOutfitId: string): Promise<void>;
}

export interface SimilarityRemote {
  /** Top-k visually similar items on the server (pgvector cosine distance), scoped to this user. */
  searchSimilar(embedding: Float32Array, limit?: number): Promise<CloudMatch[]>;
}

/** Maps app types to the Go API's JSON contract. */
export class WardrobeApi implements ProfileRemote, GarmentRemote, OutfitRemote, SimilarityRemote, PrivacyRemote, VisionRemote {
  constructor(
    private readonly http: HttpClient,
    private readonly installation: InstallationIdProvider,
    /** The UI language, stored with the profile so notices can reach the user in it. */
    private readonly language: () => Promise<string> = async () => 'en',
  ) {}

  async saveProfile(profile: DigitalTwin) {
    const p = profile.proportions;
    await this.http.postJson('/api/users/profile', {
      user_id: await this.installation.get(),
      height_cm: Math.round(profile.heightCm),
      body_shape: profile.bodyShape,
      skin_undertone: profile.undertone,
      proportions: { shoulder_cm: p.shoulderCm, bust_cm: p.bustCm, waist_cm: p.waistCm, hip_cm: p.hipCm, torso: p.torso ?? '' },
      season: profile.season ?? '',
      language: await this.language(),
    });
  }

  async recordConsent(c: Pick<ConsentRecord, 'noticeVersion' | 'language' | 'purposes'>) {
    await this.http.postJson('/api/users/consent', {
      notice_version: c.noticeVersion,
      language: c.language,
      purposes: c.purposes,
    });
  }

  async eraseCloudData() {
    try {
      await this.http.delete('/api/users/me');
    } catch (e) {
      // Never enrolled means the server never had anything.
      if (!(e instanceof ApiError && (e.status === 404 || e.status === 401))) throw e;
    }
  }

  async segment(imageBase64: string) {
    const r = await this.http.postJson<{ mask_png_base64: string; width: number; height: number }>('/api/vision/segment', {
      image_base64: imageBase64,
    });
    return { maskPngBase64: r.mask_png_base64, width: r.width, height: r.height };
  }

  async embed(imageBase64: string) {
    const r = await this.http.postJson<{ embedding: number[] }>('/api/vision/embed', { image_base64: imageBase64 });
    return Float32Array.from(r.embedding);
  }

  exportCloudData() {
    return this.http.getJson<unknown>('/api/users/me/export');
  }

  async uploadGarment(g: UploadableGarment) {
    await this.http.postJson('/api/wardrobe/items', {
      user_id: await this.installation.get(),
      client_item_id: g.clientItemId,
      category_slug: g.categorySlug ?? '',
      image_base64: g.imageBase64,
      color_hex: g.colorHex,
      embedding: Array.from(g.embedding),
      metadata: g.metadata,
    });
  }

  async deleteGarment(clientItemId: string) {
    await this.deleteIdempotent(`/api/wardrobe/items/${encodeURIComponent(clientItemId)}`);
  }

  async uploadOutfit(o: UploadableOutfit) {
    await this.http.postJson('/api/outfits', {
      user_id: await this.installation.get(),
      client_outfit_id: o.clientOutfitId,
      name: o.name,
      item_client_ids: o.itemClientIds,
      metadata: o.metadata,
    });
  }

  async deleteOutfit(clientOutfitId: string) {
    await this.deleteIdempotent(`/api/outfits/${encodeURIComponent(clientOutfitId)}`);
  }

  /** A 404 means it's already gone, which is the outcome the caller wanted. */
  private async deleteIdempotent(path: string) {
    const userId = encodeURIComponent(await this.installation.get());
    try {
      await this.http.delete(`${path}?user_id=${userId}`);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) throw e;
    }
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
