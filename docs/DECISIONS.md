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
  dynamically-quantised int8 graphs these models ship as, so CPU is the default (XNNPACK was
  dropped, see below). An accelerator that *rejects* the graph falls back to CPU automatically;
  one that aborts natively takes the app down, which is why NNAPI stays opt-in.
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
- **Multi-photo gallery pick** (Add tab and add-photo screen, up to 20). Photos run strictly
  in sequence through the same inspect → process → complete steps as a single capture, each
  dropping its working image before the next is decoded, so peak memory equals one photo's no
  matter how many are picked. Quality-check failures are skipped and listed rather than asked
  about one by one (a 20-photo batch shouldn't stall on a prompt); "Add skipped anyway" re-runs
  just those. Live Shop keeps single capture because its value is the per-item verdict. Category
  tagging moved to the garment page for batches; a per-row picker made the summary too long.
- **No XNNPACK execution provider.** With `['xnnpack', 'cpu']` (added with device tiering),
  ORT aborted the app natively inside `Ort::Session` creation for the int8 RMBG model on the
  Motorola Edge 20 Pro, right after every photo. A native abort can't be caught in JS, so the CPU
  retry in `SessionPool` never ran. Android now uses ORT's CPU provider (NEON int8 kernels), as
  the last build that worked on the phone did; NNAPI/Core ML remain opt-in via the NPU toggle.
  Any new provider must load every model on a real phone before it's added.
- **Hanger removal** (`vision/hangerRemoval.ts`, after segmentation, before the crop and every
  measurement). Saliency models keep the hanger as part of the object. Shape pass: an exact
  Euclidean opening (disk radius 1.2% of the garment's longest side) separates thin structures
  from the body; thin pieces in the top 25% that reach the body's top edge (the hook) are
  dropped, plus anything left floating. Thin details lower down (drawstrings, belts, straps
  inside the outline) and tiny corner trims are kept; items that are thin all over (a belt)
  are skipped. Colour pass: the removed hook gives the hanger's colour; if it differs from the
  garment (ΔE ≥ 30), hanger-coloured pixels within 3 radii of the cut, and thin hanger-coloured
  pieces in the band, are removed too. Distance-bounded on purpose: on a kurta with blue
  embroidery and a blue hanger, unbounded colour matching would punch holes in the yoke.
  The bar seen through a neckline is found by shape and place (a solid hanger-coloured strip
  under 3 radii tall, ≥ 8% of the garment wide and 3× wider than tall, centred within 12% of
  the hook) and repainted column by column from the fabric above and below it; clearing it
  would leave a hole. Thin pieces count as hanger from 1.5 r²: real shoulder corners trimmed
  by the opening measured ≤ 1.2 r², arm tips left when the model drops the hook ~1.9 r².
  Checked on real synced cutouts (~60–100 ms at 512 px in Node); the kurta's blue embroidery
  under a blue hanger was untouched. Small arm tips can still remain in some photos.
- **Cutout tidy-up** (`vision/cutoutCleanup.ts`, in the on-device background remover). The
  saliency model keeps stray blobs of background and a faint low-alpha haze over the frame,
  which showed as specks around the wearer in try-on. Pieces under 2% of the largest are
  dropped (so a pair of shoes keeps both), alpha further than 1% of the frame from the kept
  pieces is cleared (hair's soft edge stays), and enclosed gaps under 0.2% of the frame are
  filled (pinholes; the gap between an arm and the body is far larger). Try-on runs the same
  tidy-up on photos and garments saved before it existed.
- **ONNX Runtime native version is pinned** (patch to `onnxruntime-react-native`'s gradle file).
  Upstream resolves `onnxruntime-android:latest.integration`, which silently moved builds to 1.31
  under a 1.24.3 JSI bridge. Not the cause of the crash above, but builds must be reproducible.

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

## 4. In-store assistant & live scanner

- **Scanning stays point-and-shoot** with the live junk-filter chip, rather than continuous
  frame processing: a continuous 1024² cutout model would drain the battery and needs
  frame-processor native code. The scan now also computes the style vector (needed to compare
  with the closet).
- **Category is guessed** by k-NN over the closet's MobileCLIP vectors (similarity-weighted
  vote, abstains below 50% agreement), then shown as editable chips. No text tower or extra
  classifier download needed.
- **Personal match = 60% colour, 40% cut.** Colour is the existing undertone/season score.
  Cut reads a silhouette (fitted, flared, boxy, straight, longline, cropped, wide-leg,
  tapered) from the mask geometry and scores it per body shape with style-guide rules, plus
  petite/torso adjustments. Rules live in one table (`style/cutFit.ts`) for easy tuning.
- **Compatibility index**: 3–5 complete looks from the closet built around the scanned piece
  by the same generator the Outfits tab uses.
- **Redundancy**: same category + ΔE < 14 + MobileCLIP cosine ≥ 0.86 (or same subtype and
  pattern when vectors are missing) → "You already have 3 navy t-shirts like this."
- **Orphan alert**: the scanned item is checked with the same orphan rules as the closet.
- **"I bought it"** adds the scan straight to the closet with no re-processing.
- **Virtual try-on** uses **MoveNet SinglePose Lightning** (Apache-2.0, 9.4 MB fp32 ONNX,
  `int32` NHWC input — runner gained int32 support), downloaded only on first try-on. It runs
  on the user's own photos (from Your colours) on the phone only; keypoints are cached per
  photo. The garment cutout is anchored to shoulders / hips / ankles, scaled by joint span,
  rotated with the shoulder line, and keeps its own aspect so length and silhouette show.
  Without a photo, an **avatar is generated from the Digital Twin** (height, shape ratios or
  measurements, torso length). This is a 2D silhouette/drape preview, not a photoreal
  diffusion try-on — labelled as such in the UI. Photoreal VTO needs a server GPU model
  (e.g. IDM-VTON) and is a possible premium upgrade.
- **Try-on fits by the garment's own chest or waistband** (`anchorWidth`), not its bounding
  box: the torso's width at 22–38% of a top's height (or the waistband) is matched to
  shoulder-joint span × 1.45 (hip span × 2.0 for bottoms). The bounding box includes sleeves,
  so the same tee came out small flat-laid (sleeves spread) and large on a hanger. The result
  is clamped to 0.5–2.2× the old estimate and falls back to it when nothing is measurable.
  Before drawing, the stored cutout is passed through hanger removal and re-cropped, so
  garments saved before that feature no longer wear a hook; the stored file is not changed.
- MoveNet's output order (y, x, score) is from Google's model card; I could not run it on a
  real photo of a person here, so the first on-device test should confirm placement.

## 5a. Outfits

- **One generator** (`style/outfitGenerator.ts`) serves the Outfits tab, Live Shop and (next)
  the stylist chat, so every surface agrees on what a good look is.
- **Anchor piece**: pick any closet piece (or come from a garment page via "Build outfits
  around this"); every suggestion contains it. "Any" lets the closet decide.
- **Score = 65% base (colour harmony + suits-you + contrast + recency) + 15% weather + 20%
  occasion** (when one is chosen), minus a penalty when two busy patterns meet, +3 when the
  look has shoes. Shown as four labelled bars on each card, not just a single number.
- **Weather defaults to India's current season** by month (summer Mar–Jun, monsoon Jul–Sep,
  winter Oct–Feb). Monsoon penalises pale bottoms and heavy coats; summer penalises layers.
- **Untagged pieces get default occasions from their subtype** (sneakers → casual/sport,
  sherwani → wedding/festive), so suggestions work before the user tags anything.
- **Shoes are required when a suitable pair exists**, and a layer is required in winter;
  scoring picks which, not whether. (Pure score maximisation dropped both, because each
  extra piece is another chance of a colour clash.)
- **Carousel**: the top 5 looks are paged horizontally, with no main piece repeated, so the
  options are real alternatives.

## 5b. Stylist chat & streaming

- **LLM: Claude Opus 5.5 (`claude-opus-5-5`) via the official Go SDK**, streamed, effort `low`
  (chat is latency-sensitive; styling doesn't need deep reasoning). Override with
  `STYLIST_MODEL`. **Server-side refusal fallback is on** (`fallbacks: "default"`,
  beta `server-side-fallback-2026-07-01`), so a policy decline is retried on the recommended
  model instead of failing; remove those two fields to opt out.
- **Outfit cards are a strict tool** (`show_outfit` with `strict: true`, eager input
  streaming, and server-side validation). The server keeps only item ids that exist in the
  user's closet, at most three cards, so the model can't invent garments. The prompt asks
  for cards before text because on Opus 5.5 text written between tool calls comes back as
  (hidden) progress notes.
- **Prompt caching**: tools → fixed system prompt → closet summary (cache breakpoint) →
  messages; the per-question context and pre-scored candidates go in the last user turn,
  after the cached prefix.
- **What is sent**: conversation text, a text summary of the closet (category, colour name,
  hex, pattern, tags, wear count — no photos, no prices), the person's undertone/season/shape,
  and up to 5 looks the on-device generator scored for the question. Requires the **AI stylist
  consent**, checked on the server too.
- **Without an API key** the server uses a deterministic built-in stylist; **without a server
  or without consent** the phone uses its own basic stylist. Same UI either way, with a
  notice offering to turn on the AI stylist.
- **SSE**: `event: delta|outfit|done|error`, JSON data, 15 s heartbeat comments, per-event
  write deadlines (the server's 60 s WriteTimeout would cut long chats), `X-Accel-Buffering:
  no`. Errors before the stream starts are normal JSON (403 consent, 402 quota).
- **Client** uses `expo/fetch` (streaming bodies on Android/iOS/web) and a byte-level SSE
  parser that splits on `\n` before decoding, so Hindi/Malayalam characters split across
  chunks decode correctly without relying on `TextDecoder` in Hermes.
- Chat history is stored on the phone (SQLite); the last 12 turns are sent, with earlier
  cards folded into text, so the server stays stateless.
- **Not tested against the live Claude API here** (no key on this machine); the Claude path
  compiles against SDK v1.80.0 and the SSE path was tested end-to-end with the built-in
  stylist. Set `ANTHROPIC_API_KEY` in `.env` to switch it on.

## 5c. Monetisation

- **Premium is free for everyone during testing** (`PREMIUM_FOR_ALL` on the server,
  `EXPO_PUBLIC_PREMIUM_FOR_ALL` in the app, both default on). The server reports Premium for every
  user, so quotas don't apply; the app shows every perk and the paywall says "You have
  Premium". Set both to `false` to start selling; nothing else needs to change.

- **Payments: RevenueCat** (`react-native-purchases`). It validates Google Play / App Store
  receipts and is one of the two libraries Expo's IAP guide lists. The app logs in to
  RevenueCat with its install user id, so the webhook's `app_user_id` is our `users.id`.
  Keys: `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` / `_IOS_KEY`. Without a key, or on web, the paywall
  says purchases aren't available and Premium can still come from the server.
- **Entitlement: `premium`.** The store is the truth on the phone. The server's copy comes
  from the webhook (`POST /api/webhooks/revenuecat`, checked against
  `REVENUECAT_WEBHOOK_AUTH`, applied once per event id) and is what the API enforces.
  Cancellation keeps access until expiry; EXPIRATION/REFUND end it.
- **Free limits**: AI stylist 10 chats/day (server-enforced with an atomic counter; 402
  `quota_exceeded`, with a "See Premium" link in the chat), cloud vision 30/day (counter
  ready, not yet wired), try-on 3/day (counted on the phone, because it runs there — a
  determined user could reset it by clearing data; acceptable for an on-device feature).
- **Premium perks**: unlimited try-on and chat, **packing lists** (capsule sizing by trip
  length and laundry; versatility-greedy selection; day-by-day looks without repeating a
  top on consecutive days), **wardrobe insights** (spend, average cost per wear, best/worst
  value, idle pieces). Per-garment cost per wear stays free.
- **Affiliate "Complete the look"**: gap detection finds what a look needs (shoes, a winter
  layer, a bottom for a kurta) or what an orphan needs, and picks the colour that harmonises
  with every piece. Cards come from the optional `affiliate_products` feed (closest colour
  first) then search links on Myntra, AJIO, Amazon.in and Zara. `AMAZON_ASSOCIATE_TAG` is
  added to Amazon links; `AFFILIATE_LINK_WRAPPER` (a network deep-link template such as
  Cuelinks/EarnKaro) wraps the others. **No made-up products**: without a feed, the cards
  are honest search links. Every link goes through a signed `/go/{token}` redirect (HMAC,
  30-day expiry, not an open redirect) that logs partner + category + hour only, never the
  user. Cards load only on tap and always show the sponsored disclosure (ASCI).
- **Resale**: "List for sale" pre-fills title, description and a suggested price
  (purchase price × condition factor − 1% per wear, max 15%, rounded to ₹50) from the closet.
  It publishes a 1024 px WebP of the cutout. Listing needs cloud backup on (the server needs
  the user's account row). Buyers message sellers through **inquiries**; only the seller sees
  the buyer's contact, and the seller's identity is never exposed. One active listing per
  garment; marking sold offers to remove it from the closet; erasing the account removes
  listings. A public share page `/l/{id}` (escaped HTML, strict CSP) works without the app.
  **No in-app payment/escrow** — buyer and seller settle directly, with safety advice
  shown. Payments would need a marketplace PSP (e.g. Razorpay Route) and KYC.

## 6. Cross-platform core

- **One codebase for Android, web and iOS.** Platform differences live in `*.web.ts` siblings
  that Metro picks per platform: `ml/ort.web.ts`, `ml/modelDownloader.web.ts`,
  `ml/deviceCapabilities.web.ts`, `storage/keyValue.web.ts`, `storage/garmentImages.web.ts`,
  `platform/files.web.ts`. Feature code never imports `expo-file-system` or SecureStore
  directly any more.
- **Web ML**: ONNX Runtime Web 1.30 (WebNN → WebGPU → Wasm, multi-threaded when the page is
  cross-origin isolated), loaded by script tag from the app's own origin. A postinstall step
  copies it and Skia's CanvasKit into `public/`, at the versions in `package-lock.json`, so
  there is no third-party CDN and COEP doesn't block it. Models are cached in Cache Storage,
  size-verified like on the phone. Verified in headless Chromium: isolated page, 4 threads,
  MoveNet ran, and WebGPU fell back to Wasm cleanly.
- **Web images** are stored as ≤768 px WebP data URIs in SQLite (browsers have no app file
  system); **web secrets** in localStorage (no keystore exists in browsers).
- **Skia on web** must load CanvasKit before any module that imports Skia is evaluated, so
  `index.web.js` loads it, then `require`s the router entry. A dynamic `import()` doesn't work:
  single-output web exports have no async chunk loader.
- **Hosting headers** `Cross-Origin-Embedder-Policy: credentialless` and
  `Cross-Origin-Opener-Policy: same-origin` are set in the dev server (`metro.config.js`) and for
  EAS Hosting (`app.json`). Other hosts must add them (INSTALL.md).
- **Purchases on web** are not offered (RevenueCat's mobile SDK); Premium bought on a phone
  applies on the web through the server entitlement.
- **iOS readiness**: bundle id, camera/photo permission strings from the config plugins, Core ML
  as an accelerator option, `ITSAppUsesNonExemptEncryption: false`, safe-area insets throughout
  (`SafeAreaProvider` + `useSafeAreaInsets`), RevenueCat iOS key support. Not built or run on
  iOS here (no macOS); `npx expo run:ios` or EAS is the next step.
- **SSE** uses `expo/fetch` on every platform (see 5b).

## 7. Verified vs not verified

- Verified here: TypeScript, ESLint, 112 Jest tests; `go vet` (with and without `-tags onnx`) and
  Go tests; every new API end to end against Postgres in Docker (device auth, consent, export,
  erasure, cloud vision with real RMBG and MobileCLIP, SSE chat, quotas, RevenueCat webhook,
  affiliate redirects, listings and inquiries); the web build booting in Chromium through
  consent → Digital Twin → tabs → stylist chat; Android JS bundle export; `expo-doctor` 21/21.
- Not verified here: the app on a physical phone (no Android SDK/emulator in this environment),
  the live Claude API (no key), real RevenueCat purchases (no store accounts), MoveNet placement
  on a real photo of a person, and iOS builds.
