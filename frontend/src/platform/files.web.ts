/** Web: files are Blobs behind object URLs; reading any URL (data:, blob:, http) is a fetch. */
export async function readBytes(uri: string): Promise<Uint8Array> {
  const res = await fetch(uri);
  return new Uint8Array(await res.arrayBuffer());
}

export function deleteFile(uri: string) {
  if (uri.startsWith('blob:')) URL.revokeObjectURL(uri);
}

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', json: 'application/json' };

export function writeCacheFile(name: string, data: Uint8Array | string): string {
  const type = MIME[name.split('.').pop() ?? ''] ?? 'application/octet-stream';
  return URL.createObjectURL(new Blob([data as BlobPart], { type }));
}

export async function offerFile(uri: string, _mimeType: string, title: string): Promise<boolean> {
  const a = document.createElement('a');
  a.href = uri;
  a.download = title.replace(/[^\w.-]+/g, '-') || 'download';
  a.click();
  return true;
}
