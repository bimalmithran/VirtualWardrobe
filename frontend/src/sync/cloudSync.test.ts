import { ApiError } from '../api/httpClient';
import type { UploadableGarment, UploadableOutfit } from '../api/wardrobeApi';
import { EMPTY_PROPORTIONS, type DigitalTwin, type Garment, type Outfit } from '../domain/types';
import type { PendingDeletion } from '../storage/deletionQueue';
import { CloudSyncService, type CloudSyncDeps } from './cloudSync';

const profile: DigitalTwin = {
  heightCm: 175,
  bodyShape: 'oval',
  undertone: 'warm',
  proportions: EMPTY_PROPORTIONS,
  season: null,
  updatedAt: 42,
};

const garment = (id: string): Garment => ({
  id,
  imageUri: `file:///closet/${id}.png`,
  colorHex: '#112233',
  palette: [{ hex: '#112233', share: 1 }],
  embedding: new Float32Array(512).fill(0.1),
  createdAt: 0,
  syncedAt: null,
  category: 'tops',
  favorite: false,
  wearCount: 0,
  lastWornAt: null,
  photoCount: 1,
  revision: 0,
});

const outfit = (id: string, itemIds: string[]): Outfit => ({ id, name: id, itemIds, createdAt: 0, lastWornAt: null, syncedAt: null });

function setup(
  opts: {
    garments?: Garment[];
    uploadErrors?: Record<string, Error>;
    syncedVersion?: number | null;
    profile?: DigitalTwin | null;
    outfits?: Outfit[];
    deletions?: PendingDeletion[];
    consented?: boolean;
  } = {},
) {
  const pending = [...(opts.garments ?? [])];
  const pendingOutfits = [...(opts.outfits ?? [])];
  const deletions = [...(opts.deletions ?? [])];
  const deleted: string[] = [];
  const uploadedOutfits: UploadableOutfit[] = [];
  const onServer = new Set<string>();
  const uploaded: UploadableGarment[] = [];
  const savedProfiles: DigitalTwin[] = [];
  let syncedVersion = opts.syncedVersion ?? null;

  const deps: CloudSyncDeps = {
    consent: { allows: () => opts.consented ?? true, syncPending: async () => {} },
    remote: {
      saveProfile: async (p) => {
        savedProfiles.push(p);
      },
      uploadGarment: async (g) => {
        const err = opts.uploadErrors?.[g.clientItemId];
        if (err) throw err;
        uploaded.push(g);
        onServer.add(g.clientItemId);
      },
      deleteGarment: async (id) => {
        const err = opts.uploadErrors?.[id];
        if (err) throw err;
        deleted.push(`garment:${id}`);
      },
      uploadOutfit: async (o) => {
        if (!o.itemClientIds.every((id) => onServer.has(id))) throw new ApiError(409, 'garments not uploaded');
        uploadedOutfits.push(o);
      },
      deleteOutfit: async (id) => {
        deleted.push(`outfit:${id}`);
      },
    },
    pending: {
      listUnsynced: async () => [...pending],
      markSynced: async ({ id }) => {
        pending.splice(pending.findIndex((g) => g.id === id), 1);
      },
    },
    outfits: {
      listUnsyncedOutfits: async () => [...pendingOutfits],
      markOutfitSynced: async ({ id }) => {
        pendingOutfits.splice(pendingOutfits.findIndex((o) => o.id === id), 1);
      },
    },
    deletions: {
      listDeletions: async () => [...deletions],
      clearDeletion: async (d) => {
        deletions.splice(deletions.findIndex((x) => x.kind === d.kind && x.id === d.id), 1);
      },
    },
    images: { readBase64: async (uri) => `b64:${uri}` },
    profiles: { load: async () => (opts.profile === undefined ? profile : opts.profile) },
    profileSync: {
      syncedVersion: async () => syncedVersion,
      markSynced: async (v) => {
        syncedVersion = v;
      },
      clearSynced: async () => {
        syncedVersion = null;
      },
    },
  };
  return {
    service: new CloudSyncService(deps),
    uploaded,
    savedProfiles,
    pending,
    synced: () => syncedVersion,
    deleted,
    deletions,
    uploadedOutfits,
    pendingOutfits,
    onServer,
  };
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

test('sends the category with each garment', async () => {
  const s = setup({ garments: [{ ...garment('a'), category: null }, garment('b')] });
  await s.service.syncAll();
  expect(s.uploaded.map((u) => u.categorySlug)).toEqual([null, 'tops']);
});

test('replays queued deletes before uploading, and clears them', async () => {
  const s = setup({
    garments: [garment('a')],
    deletions: [{ kind: 'outfit', id: 'o1' }, { kind: 'garment', id: 'old' }],
  });
  const r = await s.service.syncAll();
  expect(r.error).toBeNull();
  expect(s.deleted).toEqual(['outfit:o1', 'garment:old']);
  expect(s.deletions).toHaveLength(0);
});

test('a transient delete failure keeps the tombstone and stops the pass', async () => {
  const s = setup({ garments: [garment('a')], deletions: [{ kind: 'garment', id: 'old' }], uploadErrors: { old: new ApiError(503, 'down') } });
  const r = await s.service.syncAll();
  expect(r).toEqual({ uploaded: 0, pending: 1, error: 'down' });
  expect(s.deletions).toHaveLength(1);
  expect(s.uploaded).toHaveLength(0);
});

test('outfits upload after their garments; a 409 leaves them queued without an error', async () => {
  const s = setup({ garments: [garment('a')], outfits: [outfit('o1', ['a']), outfit('o2', ['a', 'missing'])] });
  const r = await s.service.syncAll();
  expect(r).toEqual({ uploaded: 1, pending: 1, error: null });
  expect(s.uploadedOutfits.map((o) => o.clientOutfitId)).toEqual(['o1']);
  expect(s.pendingOutfits.map((o) => o.id)).toEqual(['o2']);

  s.onServer.add('missing');
  await s.service.syncAll();
  expect(s.pendingOutfits).toHaveLength(0);
});

test('nothing leaves the phone without cloud backup consent', async () => {
  const s = setup({ garments: [garment('a')], consented: false });
  const r = await s.service.syncAll();
  expect(s.service.enabled).toBe(false);
  expect(r).toEqual({ uploaded: 0, pending: 0, error: null });
  expect(s.uploaded).toEqual([]);
  expect(s.savedProfiles).toEqual([]);
  await s.service.syncProfile(profile);
  expect(s.savedProfiles).toEqual([]);
});
