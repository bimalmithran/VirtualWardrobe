import { ApiError } from '../api/httpClient';
import type { UploadableGarment } from '../api/wardrobeApi';
import type { DigitalTwin, Garment } from '../domain/types';
import { CloudSyncService, type CloudSyncDeps } from './cloudSync';

const profile: DigitalTwin = { heightCm: 175, bodyShape: 'oval', undertone: 'warm', updatedAt: 42 };

const garment = (id: string): Garment => ({
  id,
  imageUri: `file:///closet/${id}.png`,
  colorHex: '#112233',
  palette: [{ hex: '#112233', share: 1 }],
  embedding: new Float32Array(512).fill(0.1),
  createdAt: 0,
  syncedAt: null,
});

function setup(opts: { garments?: Garment[]; uploadErrors?: Record<string, Error>; syncedVersion?: number | null; profile?: DigitalTwin | null } = {}) {
  const pending = [...(opts.garments ?? [])];
  const uploaded: UploadableGarment[] = [];
  const savedProfiles: DigitalTwin[] = [];
  let syncedVersion = opts.syncedVersion ?? null;

  const deps: CloudSyncDeps = {
    remote: {
      saveProfile: async (p) => {
        savedProfiles.push(p);
      },
      uploadGarment: async (g) => {
        const err = opts.uploadErrors?.[g.clientItemId];
        if (err) throw err;
        uploaded.push(g);
      },
    },
    pending: {
      listUnsynced: async () => [...pending],
      markSynced: async (id) => {
        pending.splice(pending.findIndex((g) => g.id === id), 1);
      },
    },
    images: { readBase64: async (uri) => `b64:${uri}` },
    profiles: { load: async () => (opts.profile === undefined ? profile : opts.profile) },
    profileSync: {
      syncedVersion: async () => syncedVersion,
      markSynced: async (v) => {
        syncedVersion = v;
      },
    },
  };
  return { service: new CloudSyncService(deps), uploaded, savedProfiles, pending, synced: () => syncedVersion };
}

test('uploads the profile first, then every pending garment', async () => {
  const s = setup({ garments: [garment('a'), garment('b')] });
  const r = await s.service.syncAll();
  expect(r).toEqual({ uploaded: 2, pending: 0, error: null });
  expect(s.savedProfiles).toEqual([profile]);
  expect(s.synced()).toBe(42);
  expect(s.uploaded.map((u) => u.clientItemId)).toEqual(['a', 'b']);
  expect(s.uploaded[0].pngBase64).toBe('b64:file:///closet/a.png');
  expect(s.pending).toHaveLength(0);
});

test('skips the profile upload when the server already has that version', async () => {
  const s = setup({ syncedVersion: 42 });
  await s.service.syncAll();
  expect(s.savedProfiles).toHaveLength(0);
});

test('without a Digital Twin nothing is uploaded', async () => {
  const s = setup({ garments: [garment('a')], profile: null });
  const r = await s.service.syncAll();
  expect(r.error).toMatch(/Digital Twin/);
  expect(s.uploaded).toHaveLength(0);
});

test('a transient error stops the batch so it can be retried later', async () => {
  const s = setup({ garments: [garment('a'), garment('b')], uploadErrors: { a: new ApiError(0, 'offline') } });
  const r = await s.service.syncAll();
  expect(r).toEqual({ uploaded: 0, pending: 2, error: 'offline' });
  expect(s.uploaded).toHaveLength(0);
});

test('a 4xx for one garment does not block the others', async () => {
  const s = setup({ garments: [garment('a'), garment('b')], uploadErrors: { a: new ApiError(400, 'bad color') } });
  const r = await s.service.syncAll();
  expect(r).toEqual({ uploaded: 1, pending: 1, error: 'bad color' });
  expect(s.uploaded.map((u) => u.clientItemId)).toEqual(['b']);
});

test('concurrent calls share one run and notify listeners once per run', async () => {
  const s = setup({ garments: [garment('a')] });
  const listener = jest.fn();
  s.service.onSynced(listener);
  const [r1, r2] = await Promise.all([s.service.syncAll(), s.service.syncAll()]);
  expect(r1).toBe(r2);
  expect(s.uploaded).toHaveLength(1);
  await Promise.resolve();
  expect(listener).toHaveBeenCalledTimes(1);
});
