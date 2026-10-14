import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/**
 * The few file operations features need, behind one module so web (which has no
 * expo-file-system) can provide its own version in files.web.ts.
 */
export async function readBytes(uri: string): Promise<Uint8Array> {
  return new File(uri).bytes();
}

export function deleteFile(uri: string) {
  const f = new File(uri);
  if (f.exists) f.delete();
}

/** Writes to the cache directory and returns a URI usable by <Image> and other modules. */
export function writeCacheFile(name: string, data: Uint8Array | string): string {
  const f = new File(Paths.cache, name);
  f.write(data);
  return f.uri;
}

/** Offers a file to the user: the share sheet on phones, a download on the web. */
export async function offerFile(uri: string, mimeType: string, title: string): Promise<boolean> {
  if (!(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(uri, { mimeType, dialogTitle: title });
  return true;
}
