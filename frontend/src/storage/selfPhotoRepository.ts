import type { SQLiteDatabase } from 'expo-sqlite';

import type { SelfPhoto, SelfReading } from '../domain/types';
import type { Pose } from '../vision/pose';
import type { GarmentImageStore } from './garmentImages';

/** Photos of the user. They never leave the phone. */
export interface SelfPhotoRepository {
  /** Oldest first. */
  list(): Promise<SelfPhoto[]>;
  add(photo: { png: Uint8Array; reading: SelfReading }): Promise<SelfPhoto>;
  remove(photo: SelfPhoto): Promise<void>;
  /** Keypoints normalised to 0..1 of the photo's width and height; null until estimated. */
  getPose(id: string): Promise<NormalisedPose | null>;
  savePose(id: string, pose: NormalisedPose): Promise<void>;
}

/** Keypoint positions as fractions of the image size, so they survive any display scale. */
export type NormalisedPose = Pose;

interface Row {
  id: string;
  image_uri: string;
  reading_json: string;
  created_at: number;
}

export class SqliteSelfPhotoRepository implements SelfPhotoRepository {
  constructor(
    private readonly db: SQLiteDatabase,
    /** A store of its own, so the user's photos are never mixed with garment cutouts. */
    private readonly images: GarmentImageStore,
  ) {}

  async list() {
    const rows = await this.db.getAllAsync<Row>('SELECT * FROM self_photos ORDER BY created_at, id');
    return rows.map((r) => ({
      id: r.id,
      imageUri: r.image_uri,
      reading: JSON.parse(r.reading_json) as SelfReading,
      createdAt: r.created_at,
    }));
  }

  async add({ png, reading }: { png: Uint8Array; reading: SelfReading }): Promise<SelfPhoto> {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const imageUri = this.images.save(id, png);
    const createdAt = Date.now();
    try {
      await this.db.runAsync(
        'INSERT INTO self_photos (id, image_uri, reading_json, created_at) VALUES (?, ?, ?, ?)',
        id,
        imageUri,
        JSON.stringify(reading),
        createdAt,
      );
    } catch (e) {
      this.images.remove(imageUri);
      throw e;
    }
    return { id, imageUri, reading, createdAt };
  }

  async getPose(id: string) {
    const row = await this.db.getFirstAsync<{ pose_json: string | null }>('SELECT pose_json FROM self_photos WHERE id = ?', id);
    return row?.pose_json ? (JSON.parse(row.pose_json) as NormalisedPose) : null;
  }

  async savePose(id: string, pose: NormalisedPose) {
    await this.db.runAsync('UPDATE self_photos SET pose_json = ? WHERE id = ?', JSON.stringify(pose), id);
  }

  async remove(photo: SelfPhoto) {
    await this.db.runAsync('DELETE FROM self_photos WHERE id = ?', photo.id);
    this.images.remove(photo.imageUri);
  }
}
