/** What the free plan allows and what Premium adds; one table for the paywall and the gates. */
export const FREE_LIMITS = {
  /** Try-ons per day (on-device, counted on the phone). */
  tryOn: 3,
  /** AI stylist chats per day (enforced by the server). */
  stylistChat: 10,
};

export const PREMIUM_ENTITLEMENT = 'premium';

export const PERKS: { title: string; free: string; premium: string }[] = [
  { title: 'Virtual try-on', free: `${FREE_LIMITS.tryOn} a day`, premium: 'Unlimited' },
  { title: 'AI stylist chat', free: `${FREE_LIMITS.stylistChat} a day`, premium: 'Unlimited' },
  { title: 'Automated packing lists', free: '—', premium: 'Included' },
  { title: 'Cost-per-wear analytics', free: 'Per garment', premium: 'Full wardrobe report' },
  { title: 'Closet, outfits, Live Shop, colours', free: 'Included', premium: 'Included' },
];
