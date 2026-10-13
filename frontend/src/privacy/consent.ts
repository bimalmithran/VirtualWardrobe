import { LEGAL } from '../config/legal';
import { Emitter } from '../lib/observable';
import { readJson, type KeyValueStore } from '../storage/keyValue';

/** Every purpose the app asks consent for, in the order the sheet lists them. */
export const PURPOSES = ['core', 'cloud_sync', 'cloud_processing', 'ai_stylist', 'analytics'] as const;
export type Purpose = (typeof PURPOSES)[number];

/** Purposes that send data to our server; the server only needs consent records when one is on. */
export const CLOUD_PURPOSES: Purpose[] = ['cloud_sync', 'cloud_processing', 'ai_stylist', 'analytics'];

export type Purposes = Record<Purpose, boolean>;

/** Nothing is pre-ticked: DPDP consent must be an affirmative act. */
export const NO_CONSENT: Purposes = { core: false, cloud_sync: false, cloud_processing: false, ai_stylist: false, analytics: false };

export interface ConsentRecord {
  noticeVersion: string;
  language: string;
  purposes: Purposes;
  decidedAt: number;
  /** When the server last received this decision; null while it hasn't. */
  syncedAt: number | null;
}

/** What the consent sheet and privacy settings need from the server. */
export interface PrivacyRemote {
  recordConsent(record: Pick<ConsentRecord, 'noticeVersion' | 'language' | 'purposes'>): Promise<void>;
  /** Erases everything the server holds for this install. */
  eraseCloudData(): Promise<void>;
  exportCloudData(): Promise<unknown>;
}

const KEY = 'consent_v1';

/**
 * The consent in force on this phone. Local first: decisions apply immediately and the
 * server's audit copy catches up. Every cloud feature checks allows() before sending data.
 */
export class ConsentService {
  private record: ConsentRecord | null = null;
  private loaded: Promise<ConsentRecord | null> | null = null;
  private changes = new Emitter<ConsentRecord | null>();

  constructor(
    private readonly store: KeyValueStore,
    private readonly remote: PrivacyRemote | null,
    /** Clears local "already uploaded" bookkeeping, so a later opt-in uploads everything again. */
    private readonly afterCloudErase: () => Promise<void> = async () => {},
  ) {}

  subscribe = (listener: (r: ConsentRecord | null) => void) => this.changes.subscribe(listener);

  load(): Promise<ConsentRecord | null> {
    this.loaded ??= readJson<ConsentRecord>(this.store, KEY).then((r) => {
      this.record = r;
      return r;
    });
    return this.loaded;
  }

  current() {
    return this.record;
  }

  allows(purpose: Purpose): boolean {
    return this.record !== null && this.record.purposes.core && this.record.purposes[purpose];
  }

  /** True until the user has answered the current notice and agreed to the required purpose. */
  needsDecision(): boolean {
    return !this.record || this.record.noticeVersion !== LEGAL.noticeVersion || !this.record.purposes.core;
  }

  /**
   * Applies a decision. Withdrawing cloud backup erases the server copy, as the DPDP Act
   * requires once the purpose ends (s.8(7)); a failed erase is reported to the caller.
   */
  async decide(purposes: Purposes, language: string): Promise<ConsentRecord> {
    const before = this.record;
    const next: ConsentRecord = { noticeVersion: LEGAL.noticeVersion, language, purposes: { ...purposes }, decidedAt: Date.now(), syncedAt: null };
    await this.save(next);

    if (this.remote && before?.purposes.cloud_sync && !purposes.cloud_sync) {
      await this.remote.eraseCloudData();
      await this.afterCloudErase();
      // The erase removed the server's ledger too; the new record starts it again if needed.
    }
    await this.syncPending().catch(() => {}); // retried by the next sync pass
    return this.record!;
  }

  /**
   * The user's erasure request for server data. Cloud backup is switched off with it, since
   * keeping it on would upload everything again on the next sync.
   */
  async eraseCloud(): Promise<void> {
    const r = this.record;
    if (!this.remote || !r) return;
    if (r.purposes.cloud_sync) {
      await this.decide({ ...r.purposes, cloud_sync: false }, r.language);
      return;
    }
    await this.remote.eraseCloudData();
    await this.afterCloudErase();
    await this.save({ ...r, syncedAt: null }); // the server's ledger went with it
    await this.syncPending().catch(() => {});
  }

  /** Uploads the decision when the server should hold it: some cloud purpose is or was on. */
  async syncPending(): Promise<void> {
    const r = this.record;
    if (!this.remote || !r || r.syncedAt !== null) return;
    const anyCloud = CLOUD_PURPOSES.some((p) => r.purposes[p]);
    if (!anyCloud) return;
    await this.remote.recordConsent(r);
    if (this.record?.decidedAt === r.decidedAt) await this.save({ ...r, syncedAt: Date.now() });
  }

  /** Forgets every decision (local erase); the sheet shows again. */
  async clear() {
    this.record = null;
    this.loaded = Promise.resolve(null);
    await this.store.remove(KEY);
    this.changes.emit(null);
  }

  private async save(r: ConsentRecord) {
    this.record = r;
    this.loaded = Promise.resolve(r);
    await this.store.set(KEY, JSON.stringify(r));
    this.changes.emit(r);
  }
}
