import { Buffer } from 'buffer';
import { Directory, File, Paths } from 'expo-file-system';

import { makeThumbnail } from '../image/pixels';
import { UPLOAD_MAX_SIDE } from './garmentImages.constants';

export { UPLOAD_MAX_SIDE } from './garmentImages.constants';

/** Reads a stored cutout for upload. Sync depends on this, not on the full store. */
export interface GarmentImageReader {
  readBase64(uri: string): Promise<string>;
  /**
   * A light WebP thumbnail (≤ UPLOAD_MAX_SIDE) instead of the full PNG: the server needs a
   * picture for search results and restore, not the 1024 px original.
   */
  readUploadBase64(uri: string): Promise<string>;
}

/** Where garment cutout PNGs live. */
export interface GarmentImageStore extends GarmentImageReader {
  /** Writes the PNG and returns its URI. */
  save(id: string, png: Uint8Array): string;
  remove(uri: string): void;
}

export class FileGarmentImageStore implements GarmentImageStore {
  private readonly dir: Directory;

  /** `name` is the folder under the app's documents directory. */
  constructor(name = 'closet') {
    const dir = new Directory(Paths.document, name);
    dir.create({ intermediates: true, idempotent: true });
    this.dir = dir;
  }

  save(id: string, png: Uint8Array) {
    const file = new File(this.dir, `${id}.png`);
    file.write(png);
    return file.uri;
  }

  remove(uri: string) {
    const file = new File(uri);
    if (file.exists) file.delete();
  }

  readBase64(uri: string) {
    return new File(uri).base64();
  }

  async readUploadBase64(uri: string) {
    const bytes = await new File(uri).bytes();
    return Buffer.from(makeThumbnail(bytes, UPLOAD_MAX_SIDE)).toString('base64');
  }

  /** Deletes every image in this store. */
  clear() {
    if (this.dir.exists) this.dir.delete();
    this.dir.create({ intermediates: true, idempotent: true });
  }
}
