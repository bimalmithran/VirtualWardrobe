import { Buffer } from 'buffer';

import { makeThumbnail } from '../image/pixels';
import type { GarmentImageStore } from './garmentImages';

export type { GarmentImageReader, GarmentImageStore } from './garmentImages';
export { UPLOAD_MAX_SIDE } from './garmentImages.constants';

/** Web keeps garment images inside the row, so it caps them smaller than the phone's PNGs. */
const WEB_MAX_SIDE = 768;

const toBytes = (dataUri: string) => new Uint8Array(Buffer.from(dataUri.slice(dataUri.indexOf(',') + 1), 'base64'));

/**
 * Browsers have no app file system, so cutouts are stored as WebP data URIs in SQLite
 * (alpha kept, ~40-120 KB each). They survive reloads with the database and need no
 * object-URL bookkeeping.
 */
export class FileGarmentImageStore implements GarmentImageStore {
  /** Same signature as the native store; on web the name only labels the store. */
  constructor(readonly name = 'closet') {}

  save(_id: string, png: Uint8Array) {
    return `data:image/webp;base64,${Buffer.from(makeThumbnail(png, WEB_MAX_SIDE, 88)).toString('base64')}`;
  }

  remove() {}

  async readBase64(uri: string) {
    return uri.slice(uri.indexOf(',') + 1);
  }

  async readUploadBase64(uri: string) {
    return Buffer.from(makeThumbnail(toBytes(uri), 512)).toString('base64');
  }

  clear() {}
}
