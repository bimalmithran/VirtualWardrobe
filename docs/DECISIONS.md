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

## 2. Camera, capture & edge AI

- **Tiering** (`src/ml/capabilities.ts`): RAM + a 2M-flop JS micro-benchmark + whether ONNX
  Runtime is linked. ≥6 GB and fast → high (both models resident); ≥3 GB → mid (one model at
  a time); below, slow, or no runtime → low. Thresholds were picked from the two target phones
  (8 GB Galaxy M-series, Edge 20 Pro = high).
- **Web detection** probes WebNN (`navigator.ml`), WebGPU (an adapter is actually requested),
  WebGL2, and WebAssembly incl. SIMD and threads (`crossOriginIsolated`).
- **Routing**: high/mid run everything on the phone. Low tier goes *hybrid*: the 44 MB 1024²
  background-removal model runs on the server, the 12 MB MobileCLIP stays on the phone. With
  no runtime at all (Expo Go, no-wasm browser) both go to the cloud. **Cloud is only used with
  the "cloud processing" consent**; without it the phone runs the models anyway, slowly.
  Cloud failure falls back to the phone when it has a runtime.
- **Photos of the user never use the cloud path**, whatever the tier (the consent text promises it).
- **NPU is opt-in** (Twin → AI on this device). NNAPI/Core ML often reject or slow down the
  dynamically-quantised int8 graphs these models ship as, so XNNPACK → CPU is the default.
  Any accelerator that fails session creation falls back to CPU automatically.
- **Server-side vision** uses the same ONNX files via `onnxruntime_go` (cgo, `-tags onnx`,
  ORT 1.29). The API binary now ships on Debian slim instead of static distroless because of
  that. Models download into a volume on first boot; `/api/vision/*` returns 503 until ready.
  Default server cutout model is RMBG-1.4 to match the app, with a startup warning about its
  non-commercial licence (`VISION_SEGMENTATION=isnet` for commercial use). Photos are processed
  in memory and never written.
- **Junk filter** gains histogram clipping (crushed shadows / blown highlights) on top of the
  mean-brightness, contrast and Laplacian checks, and a one-line headline for live feedback.
- **Live feedback**: expo-camera has no frame processors, so the camera grabs a tiny
  unprocessed frame every 1.5 s (shutter animation off) and runs the junk filter on a 256 px
  copy. No new native dependency (VisionCamera would add frame processors but also a native
  module and worklets).
- **Tight crop**: cutouts are cropped to the garment's bounding box + 4% margin before
  colour, pattern, embedding and storage.
- **Embedding input changed from centre-crop to letterbox** so long garments (kurtas, sarees)
  keep their hem. Vectors of garments saved before this change are slightly different;
  similarity still works but is a little less precise between old and new items. Adding a new
  photo to an old garment re-fuses it.
- **Pattern** (solid / striped / checked / printed / textured) from Sobel edge density and an
  orientation histogram inside the eroded mask. Heuristic, ~5 ms; documented as such.
- **Silhouette geometry** (aspect, taper, waist definition, fill) is measured from the mask and
  feeds cut/body-shape matching (section 4).
- **Light payload**: cloud backup uploads a ≤512 px WebP thumbnail (Skia encoder, keeps alpha;
  ~20–60 KB) with the vector, colours and tags, instead of the 1–3 MB PNG. The server now
  accepts PNG/WebP/JPEG by signature.

## 3. Wardrobe management

- **Indian Ethnic Wear is a top-level category** (`ethnic`) with subcategories kurta, saree,
  lehenga, salwar set, sherwani, mundu/dhoti, on both client and server. Sarees, lehengas,
  salwar sets and sherwanis count as complete looks; a kurta still pairs with a bottom.
- **Subcategory is sent as the item's `category_slug`** (the server's tree already supports
  it), so cloud data keeps the most specific type.
- **Tags**: pattern (auto-detected, editable), occasions, weather (summer / monsoon / winter —
  Indian seasons rather than four temperate ones), brand, size, price in ₹. Everything except
  price and favourite syncs as item metadata; **price stays on the phone**.
- **Wear history** is a new `wear_log` table. Old wear counts can't be back-dated, so the
  last known date becomes one event and the rest show as "earlier wears without a date".
- **Orphan items**: a tagged piece is an orphan if nothing it needs to be worn with exists
  (`missing`) or nothing of that kind pairs at ≥ 0.55 (`clash`). Pairing = colour harmony
  with a penalty when two busy patterns meet. Shown as a badge, a closet filter and a
  warning on the detail screen.
- **Cost per wear** is shown per garment for free; the wardrobe-wide analytics screen is a
  premium perk (section 5).
