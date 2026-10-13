/**
 * Legal identity shown in the consent sheet and Privacy Notice, from EXPO_PUBLIC_* at
 * bundle time. Under the DPDP Rules 2025 the notice must name a contact for grievances;
 * set these before publishing a build. `configured` is false while any is missing, and the
 * app then warns on the privacy screens instead of showing an empty contact.
 */
const env = (key: string) => (process.env[key] ?? '').trim();

export const LEGAL = {
  /** Bump when the notice text changes materially; users are asked again. */
  noticeVersion: '2026-10',
  controller: env('EXPO_PUBLIC_LEGAL_ENTITY') || 'VirtualWardrobe',
  privacyUrl: env('EXPO_PUBLIC_PRIVACY_URL'),
  grievance: {
    name: env('EXPO_PUBLIC_GRIEVANCE_NAME'),
    email: env('EXPO_PUBLIC_GRIEVANCE_EMAIL'),
    phone: env('EXPO_PUBLIC_GRIEVANCE_PHONE'),
    address: env('EXPO_PUBLIC_GRIEVANCE_ADDRESS'),
  },
  /** Days within which grievances are answered (DPDP Rules 2025, r.14: at most 90). */
  grievanceResponseDays: 30,
  dpbUrl: 'https://www.dpb.gov.in',
};

export const grievanceConfigured = Boolean(LEGAL.grievance.name && LEGAL.grievance.email);
