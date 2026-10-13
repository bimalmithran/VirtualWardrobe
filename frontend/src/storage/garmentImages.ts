import { Directory, File, Paths } from 'expo-file-system';

/** Reads a stored cutout for upload. Sync depends on this, not on the full store. */
export interface GarmentImageReader {
  readBase64(uri: string): Promise<string>;
}

/** Where garment cutout PNGs live. */
export interface GarmentImageStore extends GarmentImageReader {
  /** Writes the PNG and returns its URI. */
  save(id: string, png: Uint8Array): string;
  remove(uri: string): void;
}

export class FileGarmentImageStore implements GarmentImageStore {
  private readonly dir: Directory;

  constructor(dir = new Directory(Paths.document, 'closet')) {
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

  /** Deletes every image in this store. */
  clear() {
    if (this.dir.exists) this.dir.delete();
    this.dir.create({ intermediates: true, idempotent: true });
  }
}
