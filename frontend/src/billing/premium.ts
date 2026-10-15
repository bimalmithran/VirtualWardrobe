import { Platform } from 'react-native';
import type { CustomerInfo, PurchasesPackage } from 'react-native-purchases';

import type { HttpClient } from '../api/httpClient';
import type { DeviceIdentity } from '../api/installationId';
import { Emitter } from '../lib/observable';
import { PREMIUM_ENTITLEMENT } from './plans';

export interface PremiumState {
  premium: boolean;
  expiresAt: string | null;
  /** Whether purchases can be made in this build (a RevenueCat key for this platform). */
  storeAvailable: boolean;
}

export interface Plan {
  id: string;
  title: string;
  price: string;
  period: string;
  pkg: PurchasesPackage;
}

const KEYS: Partial<Record<typeof Platform.OS, string | undefined>> = {
  android: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY,
  ios: process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY,
};

/**
 * Every user gets Premium while the app is in testing. Set EXPO_PUBLIC_PREMIUM_FOR_ALL=false
 * (and PREMIUM_FOR_ALL=false on the server) to start selling it.
 */
export const PREMIUM_FOR_ALL = process.env.EXPO_PUBLIC_PREMIUM_FOR_ALL !== 'false';

type PurchasesModule = typeof import('react-native-purchases').default;

/**
 * Premium status. The store (Google Play / App Store, via RevenueCat) is the source of truth
 * on the phone; the server's copy, written by RevenueCat's webhook, is what the API enforces
 * and covers builds without a store key. The RevenueCat app user id is this install's user
 * id, so the two always refer to the same person.
 */
export class PremiumService {
  private state: PremiumState = { premium: PREMIUM_FOR_ALL, expiresAt: null, storeAvailable: false };
  private changes = new Emitter<PremiumState>();
  private purchases: PurchasesModule | null = null;
  private started: Promise<void> | null = null;

  constructor(
    private readonly identity: DeviceIdentity,
    private readonly http: HttpClient | null,
  ) {}

  subscribe = (l: (s: PremiumState) => void) => this.changes.subscribe(l);
  current = () => this.state;

  start(): Promise<void> {
    this.started ??= this.init().catch((e) => console.warn('Premium status unavailable', e));
    return this.started;
  }

  private async init() {
    const key = KEYS[Platform.OS];
    if (key) {
      // Loaded lazily so builds without the native module (Expo Go, web) still run.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Purchases = (require('react-native-purchases') as { default: PurchasesModule }).default;
      Purchases.configure({ apiKey: key, appUserID: await this.identity.get() });
      Purchases.addCustomerInfoUpdateListener((info) => this.fromStore(info));
      this.purchases = Purchases;
      this.set({ storeAvailable: true });
      this.fromStore(await Purchases.getCustomerInfo());
    }
    await this.refreshFromServer();
  }

  async refreshFromServer() {
    if (!this.http) return;
    try {
      const e = await this.http.getJson<{ premium: boolean; expires_at?: string }>('/api/me/entitlements');
      // The store wins when it says premium; the server can grant it (e.g. a purchase on another device).
      if (e.premium || !this.state.storeAvailable) this.set({ premium: e.premium, expiresAt: e.expires_at ?? null });
    } catch {
      // Offline: keep what we have.
    }
  }

  async plans(): Promise<Plan[]> {
    if (!this.purchases) return [];
    const offerings = await this.purchases.getOfferings();
    return (offerings.current?.availablePackages ?? []).map((pkg) => ({
      id: pkg.identifier,
      title: pkg.product.title,
      price: pkg.product.priceString,
      period: pkg.packageType === 'ANNUAL' ? 'year' : pkg.packageType === 'MONTHLY' ? 'month' : pkg.packageType === 'WEEKLY' ? 'week' : '',
      pkg,
    }));
  }

  /** Resolves true when premium is active afterwards; false when the user cancelled. */
  async purchase(plan: Plan): Promise<boolean> {
    if (!this.purchases) throw new Error('Purchases are not available in this build.');
    try {
      const { customerInfo } = await this.purchases.purchasePackage(plan.pkg);
      this.fromStore(customerInfo);
      return this.state.premium;
    } catch (e) {
      if ((e as { userCancelled?: boolean }).userCancelled) return false;
      throw e;
    }
  }

  async restore(): Promise<boolean> {
    if (this.purchases) this.fromStore(await this.purchases.restorePurchases());
    await this.refreshFromServer();
    return this.state.premium;
  }

  async manage() {
    await this.purchases?.showManageSubscriptions();
  }

  private fromStore(info: CustomerInfo) {
    const ent = info.entitlements.active[PREMIUM_ENTITLEMENT];
    this.set({ premium: !!ent, expiresAt: ent?.expirationDate ?? null });
  }

  private set(patch: Partial<PremiumState>) {
    this.state = { ...this.state, ...patch };
    if (PREMIUM_FOR_ALL) this.state.premium = true;
    this.changes.emit(this.state);
  }
}
