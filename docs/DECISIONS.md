# Feature completion — decisions log

Audit of the planned front-end feature list against the codebase (2026-10-13), and every
decision taken while filling the gaps. Each entry says what was chosen, why, and what was
deliberately left out.

## 0. Audit result (before this work)

| Area | Status before |
|---|---|
| Junk filter, RMBG cutout, K-Means colour, MobileCLIP vector, offline SQLite closet | Done |
| Digital Twin height / shape / undertone in SecureStore, synced | Done |
| 4-season colouring from selfies | Done |
| Live Shop single-colour match score | Done |
| Outfit suggestions (top+bottom+shoes) | Done |
| Consent sheet, language selector, privacy notice, grievance officer | Missing |
| Body proportions, 12-season palette choice | Missing |
| Device tier detection / cloud fallback | Missing (RAM only sized the model cache) |
| Histogram exposure check, live junk feedback, tight crop, pattern extraction, light payload | Missing |
| Indian Ethnic Wear category, wear history, orphan items | Missing |
| Compatibility index, redundancy alerts, cut/body match, virtual try-on in Live Shop | Missing |
| Anchor-piece outfit generator, occasion/season scoring | Missing |
| Stylist chat + SSE | Missing |
| Affiliate, resale, paywall, cost-per-wear, packing lists | Missing |
| Web target | Missing (no react-native-web; ORT/Skia/SecureStore native only) |

## 1. Onboarding, profile & legal

- **Device authentication added (not in the list, but required for "production ready").**
  Before, any client could act as any `user_id`, and cloud search searched every user's
  items. Each install now makes a 32-byte random token (`expo-crypto`, platform CSPRNG),
  keeps it in the keystore, and sends `X-User-ID` + `Authorization: Bearer`. The server
  stores only SHA-256 in a `devices` table, binds on first use (`POST /api/devices/enroll`),
  and every `/api` route resolves the user from the verified device; naming another user is 403.
  Search is now always scoped to the caller. `AUTH_REQUIRED=false` exists only for local experiments.
  Trade-off: trust-on-first-use, not an account system. Losing the phone's keystore means
  losing the cloud identity. Real accounts (phone OTP) are a follow-up.
- **Consent is per purpose, nothing pre-ticked**, including the required one (DPDP s.6 needs an
  affirmative act). Purposes: core (required), cloud backup, cloud processing, AI stylist,
  anonymous analytics. Each cloud feature checks consent before sending anything.
- **Core-only users never contact the server**: the consent record itself is uploaded only
  once some cloud purpose is on.
- **Withdrawing cloud backup erases the server copy** (DPDP s.8(7)) and resets local upload
  bookkeeping, so opting in later re-uploads everything.
- **Consent ledger on the server is append-only** (`consents` table); newest row is in force.
- **Rights implemented**: export (`GET /api/users/me/export`, shared as a JSON file), erase
  cloud data (`DELETE /api/users/me`), erase everything on the phone.
- **Languages: English, Hindi, Malayalam.** Translated: consent sheet, privacy notice,
  privacy settings, tab titles, Digital Twin form. Other screens fall back to English
  (typed dictionaries make a missing key a compile error). **The Hindi/Malayalam legal text
  is machine-quality and must be reviewed by a native speaker / counsel before release.**
- **Legal identity is configuration**, not code: `EXPO_PUBLIC_LEGAL_ENTITY`,
  `EXPO_PUBLIC_PRIVACY_URL`, `EXPO_PUBLIC_GRIEVANCE_NAME/EMAIL/PHONE/ADDRESS`. If unset the
  screens show a visible "not configured" warning rather than a fake contact.
- **Notice version** (`LEGAL.noticeVersion`): bumping it re-shows the sheet to everyone.
- **12-season palettes** replace the 4-season palette everywhere; photo analysis still
  decides the family, depth and contrast pick the sub-season. A season the user picks by hand
  overrides photo analysis (a professional draping beats a phone camera) but photo-read
  depth/contrast are kept.
- **Proportions** are optional circumferences + shoulder width + torso length. Body shape is
  suggested from bust/waist/hip ratios, never silently applied.
- **Web storage**: SecureStore has no web build, so web uses localStorage (documented as only
  as safe as the origin).
