import type { ShoppingNeed } from '../style/gaps';
import type { HttpClient } from './httpClient';

export interface AffiliateProduct {
  need_index: number;
  partner: string;
  partner_name: string;
  title: string;
  image_url?: string;
  price_inr?: number;
  color_hex: string;
  url: string;
}

export type ListingCondition = 'new' | 'like-new' | 'good' | 'fair';
export type ListingStatus = 'active' | 'sold' | 'withdrawn';

export interface Listing {
  id: string;
  client_item_id?: string;
  title: string;
  description: string;
  price_inr: number;
  condition: ListingCondition;
  size: string;
  category: string;
  color_hex: string;
  city: string;
  image_url: string;
  status: ListingStatus;
  mine: boolean;
  inquiries?: number;
  created_at: string;
}

export interface NewListing {
  client_item_id: string;
  title: string;
  description: string;
  price_inr: number;
  condition: ListingCondition;
  size: string;
  category: string;
  color_hex: string;
  city: string;
  image_base64: string;
}

export interface Inquiry {
  id: number;
  message: string;
  contact: string;
  created_at: string;
}

/** Affiliate cards and peer-to-peer resale. */
export class CommerceApi {
  constructor(private readonly http: HttpClient) {}

  get baseUrl() {
    return this.http.baseUrl;
  }

  recommend(needs: ShoppingNeed[]) {
    return this.http.postJson<{ disclosure: string; products: AffiliateProduct[] }>('/api/affiliate/recommendations', {
      needs: needs.map(({ category, subcategory, colour, hex }) => ({ category, subcategory, colour, hex })),
    });
  }

  createListing(l: NewListing) {
    return this.http.postJson<Listing>('/api/listings', l);
  }

  async feed(category = ''): Promise<Listing[]> {
    return (await this.http.getJson<{ listings: Listing[] }>(`/api/listings?category=${encodeURIComponent(category)}`)).listings;
  }

  async mine(): Promise<Listing[]> {
    return (await this.http.getJson<{ listings: Listing[] }>('/api/listings?mine=1')).listings;
  }

  getListing(id: string) {
    return this.http.getJson<Listing>(`/api/listings/${encodeURIComponent(id)}`);
  }

  updateListing(id: string, patch: { status?: ListingStatus; price_inr?: number }) {
    return this.http.patchJson(`/api/listings/${encodeURIComponent(id)}`, patch);
  }

  inquire(id: string, message: string, contact: string) {
    return this.http.postJson(`/api/listings/${encodeURIComponent(id)}/inquiries`, { message, contact });
  }

  async inquiries(id: string): Promise<Inquiry[]> {
    return (await this.http.getJson<{ inquiries: Inquiry[] }>(`/api/listings/${encodeURIComponent(id)}/inquiries`)).inquiries;
  }

  shareUrl(id: string) {
    return `${this.http.baseUrl}/l/${id}`;
  }
}
