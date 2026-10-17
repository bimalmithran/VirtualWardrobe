# VirtualWardrobe — Edge-to-Cloud POC

| | |
|---|---|
| `frontend/` | Expo SDK 57 app for Android and the web (iOS-ready). Computer vision runs on the device (ONNX Runtime; WebGPU/WebNN/Wasm in browsers), with a consented cloud fallback for low-end phones: junk filter, background removal (RMBG-1.4), K-Means colour, 512-d MobileCLIP embedding, fusion of several photos per garment, and personal colour analysis from photos of the user. |
| `backend/` | Go 1.26 API on PostgreSQL 17 + pgvector: device-authenticated sync and similarity search, DPDP consent ledger and data rights, cloud vision (same ONNX models), the streaming AI stylist (Claude), RevenueCat entitlements and quotas, affiliate links and resale listings. |
| `docker-compose.yml` | Runs the backend stack and, as an opt-in profile, builds the APK. |

The app is local-first. With no backend configured, or while offline, everything still works,
and uploads catch up later.

## Quick start (Docker)

Step-by-step server and phone setup, with troubleshooting: **[INSTALL.md](INSTALL.md)**.

```bash
cp .env.example .env               # set EXPO_PUBLIC_API_URL to this machine's LAN IP, e.g. http://192.168.1.20:8080
docker compose up --build -d       # Postgres + pgvector, and the Go API on :8080
curl localhost:8080/healthz        # {"status":"ok"}

docker compose --profile apk run --rm apk     # builds frontend/dist/VirtualWardrobe-release.apk (first run ~20-30 min)
adb install -r frontend/dist/VirtualWardrobe-release.apk
```

The phone must be on the same Wi-Fi as the machine running Compose, and port 8080 must be open
in that machine's firewall. `EXPO_PUBLIC_API_URL` is baked in at bundle time, so rebuild the APK
after changing it.

## Features

| Area | What it does |
|---|---|
| **Consent & privacy** | First-launch bottom sheet: itemised, unticked-by-default purposes (core required; cloud backup, cloud processing, AI stylist, analytics optional), English / हिन्दी / മലയാളം, Privacy Notice and Grievance Officer. **Twin → Privacy & data** changes or withdraws consent, exports server data, and erases it (server or phone). Withdrawing cloud backup erases the server copy. |
| **Digital Twin** | Height, body shape (suggested from optional bust/waist/hip/shoulder measurements), torso length, undertone, and an optional hand-picked 12-season palette. Encrypted on the device (SecureStore) and synced when cloud backup is on. |
| **Capture** | Device-tier detection picks where models run (on-device, or hybrid with cloud background removal on low-end phones). Live "Too blurry / Needs more light" feedback, histogram + Laplacian junk filter, RMBG cutout cropped tight, K-Means colours, pattern (solid/striped/checked/printed/textured), silhouette, letterboxed MobileCLIP vector. |
| **Closet** | Grid of cutouts, filters (Tops, Bottoms, Outerwear, Footwear, Indian Ethnic Wear, Accessories, favourites, untagged, orphans). Garment page: photo strip, type, pattern, occasions, weather, brand, size, price, colour swatches, wear history with cost per wear, orphan warning, similar items, try-on, build outfits, list for sale. |
| **Outfits** | Pick a piece to build around (or any), an occasion and weather (defaults to India's season); a carousel of complete looks (western, kurta sets, sarees/lehengas…) with bars for colour harmony, suits-you, occasion and season. "Complete the look" when a look lacks shoes or a layer. |
| **Stylist** | Chat ("What should I wear to a rainy dinner tonight?") with streamed replies and tap-to-view outfit cards built only from your closet. Claude via SSE with the AI stylist consent, otherwise an on-device basic stylist. |
| **Live Shop** | Scan a garment in a store: category guessed from your closet, personal match (colour vs your colouring, cut vs your body shape), "you already own 3 like this", would-be-orphan alert, 3–5 outfits with your closet, try-on, "I bought it". |
| **Try-on** | The garment placed on your own photo by on-device MoveNet pose estimation, or on an avatar generated from your Digital Twin, showing silhouette and length. |
| **Your colours** | Selfies analysed on the phone only into undertone, depth, contrast and a 12-season palette; closet ranked by what suits you, and colours to add. |
| **Premium** | RevenueCat subscriptions: unlimited try-on and AI stylist (free: 3 and 10 a day), packing lists, wardrobe cost-per-wear insights. |
| **Marketplace** | List a closet item for sale in one tap (title, description and price pre-filled), browse others' listings, message sellers through relayed inquiries, share a public listing page. |

All decisions behind these are recorded in [docs/DECISIONS.md](docs/DECISIONS.md).

## Frontend (`frontend/`)

### Setup (what was run to create it)

```bash
npx create-expo-app@latest VirtualWardrobe --template blank-typescript
cd VirtualWardrobe

# Expo modules (SDK-matched versions)
npx expo install expo-router expo-linking expo-constants expo-status-bar \
  expo-camera expo-image-picker expo-image-manipulator expo-file-system \
  expo-sqlite expo-secure-store expo-device expo-dev-client expo-build-properties \
  expo-font @expo/vector-icons react-native-safe-area-context react-native-screens \
  @shopify/react-native-skia
npm install react-dom@19.2.3          # pins an optional peer; without it npm hits ERESOLVE on SDK 57

# On-device inference runtime (has its own Expo config plugin)
npm install onnxruntime-react-native
npm approve-scripts @shopify/react-native-skia   # npm 11 blocks Skia's postinstall otherwise

# Unit tests
npx expo install jest-expo jest @types/jest -- --save-dev
```

Day to day, from `frontend/`: `npm ci`, `npm test`, `npm run typecheck`, `npm run lint`.

### Build the APK

| How | Command (from `frontend/`) | Notes |
|---|---|---|
| EAS cloud | `npx eas-cli@latest build -p android --profile preview` | `eas.json` sets `buildType: apk`. Run `eas login` and `eas build:configure` once first. |
| Docker | `docker compose --profile apk run --rm apk` (run at the repo root) | No Expo account needed. The image in `frontend/docker/` has Node 22, JDK 17, Android SDK 36, build-tools 36.0.0 and NDK 27.1, the versions RN 0.86 pins. It runs `npm ci`, `expo prebuild` and `./gradlew assembleRelease`, with Gradle and npm caches kept in volumes. |
| Dev client | `npm run build:dev`, then `npx expo start` | Hot reload on the phone. |

`frontend/patches/` makes three fixes to `onnxruntime-react-native` 1.24.3, and `patch-package`
reapplies them on every `npm install`/`npm ci`, so EAS and Docker builds both get them:

- Gradle 9 removed the `VersionNumber` class its `build.gradle` used.
- It ships a legacy `unimodule.json`, which makes Expo autolinking treat it as an Expo module and
  skip React Native autolinking. Its `OnnxruntimePackage` was then never registered,
  `NativeModules.Onnxruntime` was `null`, and the app crashed on its first background removal. The
  patch deletes the file. Check with
  `npx expo-modules-autolinking react-native-config --platform android`, which must list the package.
- Its `build.gradle` fetched the native runtime as `onnxruntime-android:latest.integration`, so
  every fresh build silently bundled whatever ONNX Runtime was newest (1.31 by October 2026)
  under a JS bridge compiled against 1.24.3. The patch pins the AAR to 1.24.3 so builds are
  reproducible. Bump it together with the npm package, never on its own.
  Check with `unzip -p frontend/dist/*.apk lib/arm64-v8a/libonnxruntime.so | strings | grep -x '1\.[0-9]*\.[0-9]*'`.

Drop each fix once upstream ships it.

Expo Go will **not** work, because it can't load ONNX Runtime. The app detects this and shows an
error instead of crashing. The Docker APK is signed with the Expo template's debug keystore. That's
fine for sideloading onto your own phones, but use EAS or your own keystore for anything you
distribute. For EAS builds, put `EXPO_PUBLIC_API_URL` in `frontend/.env` (see
`frontend/.env.example`).

### Why ONNX Runtime directly instead of Transformers.js

Transformers.js does not run in React Native/Hermes. Its inference backends are `onnxruntime-web`
(which needs WebAssembly, and Hermes has none) and `onnxruntime-node`, and its image utilities need
a browser canvas or `sharp`. This app uses the same ONNX exports Transformers.js would download
and runs them through `onnxruntime-react-native`, the native ORT build for Android and iOS.
Preprocessing follows each repo's `preprocessor_config.json`.

| Stage | Model / method | Where |
|---|---|---|
| Junk filter | brightness, contrast, Laplacian-variance blur | `src/vision/junkFilter.ts` |
| Background removal | `briaai/RMBG-1.4` int8, 1024², 44 MB | `src/vision/backgroundRemoval.ts` |
| Primary colour | K-Means++ in CIELAB, k=5, near-duplicate clusters merged | `src/vision/colorExtraction.ts` |
| Vector embedding | `Xenova/mobileclip_s0` vision tower int8, 256², 512-d | `src/vision/embedding.ts` |
| Multi-photo fusion | palettes pooled (each photo weighted equally, clusters within ΔE 15 merged); embeddings averaged and re-normalised | `src/vision/fusion.ts` |
| Undertone match | hue-warmth table × saturation | `src/vision/undertoneMatch.ts` |
| Personal colouring | YCbCr skin rule on the RMBG cutout, median skin Lab; ITA° for depth, hue angle relative to depth for undertone, hair-to-skin lightness for contrast; four-season mapping | `src/vision/personColouring.ts` |
| Fit for you | undertone match + ΔE to the season palette; outfit light-dark range vs personal contrast | `src/style/personalFit.ts` |

**Licence warning:** RMBG-1.4 is non-commercial only. `ISNET` in `src/config/models.ts` is an
Apache-2.0 drop-in replacement; switch `MODELS.segmentation` to it before shipping anything.

### Memory safety (8 GB phones and below)

- Photos are resized natively (`expo-image-manipulator`) before any pixels reach JS. The largest JS
  buffer is about 12 MB, the 1024² input tensor, and it becomes unreachable before post-processing
  allocates the mask.
- `SessionPool` serialises all inference, so only one model runs at a time. It keeps 2 sessions
  resident on devices with 6 GB or more and 1 otherwise, evicting the least recently used. It
  releases everything when the app is backgrounded or gets a memory warning.
- Only the focused tab mounts a camera, and the camera is unmounted while processing.
- Model downloads are size-verified, so a truncated file can't crash ORT's parser.
- Sync uploads one base64 PNG at a time.
- Extra garment photos and photos of the user go through the same `SessionPool`, one photo at a
  time. Fusion only needs each photo's small palette and 512-d vector, which are stored, so no
  earlier image is decoded again.

### Architecture

```
src/app/                  Expo Router screens, kept thin: read services, render components
src/services/             container.ts = composition root (the only place concrete classes are chosen)
                          ServicesProvider.tsx exposes AppServices (typed by interfaces) to React
src/domain/types.ts       shared data types, no dependencies
src/features/ingestion/   IngestionScreen (container) · useIngestion (state machine) ·
                          modes.ts (IngestionMode strategies: closet, add-photo, shop) · components/ (views)
src/features/profile/     ProfileContext (React state; persistence and sync delegated)
src/features/self/        SelfContext (user photos + fused colouring; useWearer for suggestions) ·
                          ColouringCard · WardrobeForYou
src/features/closet/      CloudSearchPanel
src/features/outfits/     useWardrobe (garments + outfits, refreshed on focus and after sync)
src/style/                outfitSuggestions (LCh colour harmony + personal fit + contrast) ·
                          personalFit (fit for a Wearer, closet ranking, colours to add); pure, unit-tested
src/vision/               GarmentPipeline + stages behind interfaces (BackgroundRemover,
                          GarmentEmbedder, PaletteExtractor); pure colour, junk and similarity math ·
                          fusion (multi-photo palettes + embeddings) · personColouring (skin, depth,
                          undertone, contrast, season) · selfAnalyzer (SelfAnalyzer for photos of the user)
src/ml/                   ModelStatusStore (observable) · ModelDownloader (files) ·
                          SessionPool (implements ModelRunner + ModelMemory) · ort.ts (lazy native load)
src/storage/              SqliteClosetRepository (ClosetRepository + GarmentPhotos + PendingUploads) ·
                          SqliteSelfPhotoRepository (phone-only photos of the user) ·
                          SqliteOutfitRepository (OutfitRepository + PendingOutfits) ·
                          SqliteDeletionQueue (server deletes owed) ·
                          FileGarmentImageStore · SecureStoreProfileRepository · migrations
src/api/                  FetchHttpClient (transport) · SecureStoreInstallationId · WardrobeApi (endpoints)
src/sync/                 CloudSyncService / DisabledCloudSync (null object when no backend)
```

How SOLID maps onto this layout:

- **Single responsibility.** Downloading models, holding sessions and broadcasting status are
  three classes. Transport, identity and endpoints are three modules. The ingestion screen is
  split into a state machine, strategies and views.
- **Open/closed.** A new capture flow is a new `IngestionMode` (adding photos to a garment was
  exactly that), and a new model is a new `BackgroundRemover`/`GarmentEmbedder`. `GarmentPipeline`
  and `useIngestion` stay unchanged.
- **Liskov substitution.** `DisabledCloudSync` stands in for `CloudSyncService` everywhere, and test
  fakes stand in for repositories and remotes.
- **Interface segregation.** Sync sees `PendingUploads`, not the whole closet repository, and
  `GarmentImageReader`, not the full image store. Screens that only list garments see
  `ClosetRepository`; the photo strip and add-photo flow see `GarmentPhotos`. Vision stages see
  `ModelRunner`, not the session pool.
- **Dependency inversion.** Vision, sync and screens depend on interfaces. Only
  `services/container.ts` imports concrete storage, HTTP and ML classes. The closet repository gets
  its `AppearanceFuser` injected, so storage never imports vision code.

### How the phone syncs

`CloudSyncService` runs one pass in this order:

1. Profile, because items have a foreign key to users.
2. Queued deletes. Removing a garment or outfit the server has already seen writes a tombstone to
   the `deletions` table in the same transaction. A 404 counts as done.
3. Garments with `synced_at IS NULL`. Changing a garment's category, or adding or removing one of
   its photos, clears `synced_at` and bumps its `revision`, so it is re-uploaded with the re-fused
   colour and vector. `markSynced` only marks the revision it uploaded, so a change made mid-upload
   goes up on the next pass. Metadata carries the palette and `photo_count`.
4. Outfits with `synced_at IS NULL`. The server answers 409 while any of an outfit's garments is
   still missing. The outfit stays queued with no error reported, and goes up on a later pass.

Sync runs after each save, at launch, and when the app returns to the foreground. A network or
5xx error stops the pass, and it retries on the next trigger. Any other 4xx only skips that record.
Removing a garment also drops it from local outfits, which mirrors the server's `ON DELETE CASCADE`
on `outfit_items`. An outfit left with no garments is deleted.

## Backend (`backend/`)

| Endpoint | Body | Notes |
|---|---|---|
| `POST /api/users/profile` | `{user_id, height_cm, body_shape, skin_undertone}` | Upsert. `user_id` is a UUID the app generates once per install. |
| `POST /api/wardrobe/items` | `{user_id, client_item_id, image_base64 \| image_url, color_hex, embedding[512], metadata?, category_slug?}` | Idempotent on `(user_id, client_item_id)`: 201 created, 200 updated. |
| `DELETE /api/wardrobe/items/{client_item_id}?user_id=` | | 204, or 404 if already gone. Also removes the stored PNG and the garment's outfit memberships. |
| `POST /api/outfits` | `{user_id, client_outfit_id, name, item_client_ids[], occasion?, metadata?}` | Idempotent on `(user_id, client_outfit_id)`: 201/200. Replaces the garment list and keeps its order. 409 while a garment is not uploaded yet. |
| `GET /api/outfits?user_id=` | | `{outfits: [...]}`, newest first, garments in display order. |
| `DELETE /api/outfits/{client_outfit_id}?user_id=` | | 204, or 404 if already gone. |
| `POST /api/wardrobe/search` | `{embedding[512], user_id?, limit?}` | Top 5 by default (max 50) by cosine similarity via the HNSW index. With `user_id` set, pgvector 0.8's iterative scan keeps the filter from returning too few rows. |
| `POST /api/llm/complete` | `{prompt, max_output_tokens?, min_quality?, cost_ceiling_usd?}` | LLM gateway demo (mock providers). 422 when no model fits the ceiling, 502 when every eligible model failed. |
| `GET /api/llm/models` | | EMA latency, sample count and cooldown state for each model. |
| `POST /api/devices/enroll` | headers only | Binds the install's bearer token (SHA-256 stored) to its user id. Every other `/api` route requires `X-User-ID` + `Authorization: Bearer`, and acts only for that user. |
| `POST /api/users/consent` | `{notice_version, language, purposes}` | Appends to the consent ledger; the newest record is in force. |
| `GET /api/users/me/export` · `DELETE /api/users/me` | | DPDP access and erasure (profile, items, images, outfits, consents, listings). |
| `POST /api/vision/segment` · `/embed` | `{image_base64}` | Cloud background removal (soft-mask PNG) and 512-d vector; needs the cloud-processing consent; 503 until models load. |
| `POST /api/stylist/chat` | `{messages, closet, candidates, wearer, context}` | `text/event-stream` of `delta` / `outfit` / `done` / `error`. Needs the AI stylist consent; free plan 10/day (402). |
| `GET /api/me/entitlements` · `POST /api/webhooks/revenuecat` | | Premium status and today's usage; RevenueCat events (shared-secret auth, idempotent). |
| `POST /api/affiliate/recommendations` · `GET /go/{token}` | `{needs[]}` | Product cards for outfit gaps; signed, logged redirects to partner stores. |
| `POST/GET /api/listings`, `GET/PATCH /api/listings/{id}`, `POST/GET /api/listings/{id}/inquiries`, `GET /l/{id}` | | Resale listings, buyer inquiries (seller-only), public share page. |
| `GET /healthz` | | Checks the database connection. |
| `GET /uploads/...` | | Stored PNGs. The database stores host-free paths, and responses resolve them against `PUBLIC_BASE_URL` or the request host. |

### Architecture

```
cmd/server/          composition root: wires adapters into use cases into handlers
internal/config/     environment parsing
internal/domain/     entities + invariants (Profile, NewItem, Embedding, ...), no I/O
internal/wardrobe/   use cases (Profiles, Closet) + the ports they need:
                     UserRepository, ItemRepository, ImageStore
internal/postgres/   pgx/v5 + pgvector-go adapters implementing the repositories
internal/imagestore/ LocalFS implementing ImageStore (an S3 store would slot in here)
internal/httpapi/    one handler per resource, each depending on a one-method interface;
                     error→status mapping and URL resolution in one place
internal/llmgateway/ Gateway composing RoutingPolicy, HealthTracker and CostEstimator
db/schema.sql        users, hierarchical categories, wardrobe_items (JSONB, VECTOR(512),
                     HNSW vector_cosine_ops), outfits, outfit_items. Idempotent, embedded in the binary.
```

Dependencies only point inward: `httpapi → wardrobe → domain ← postgres/imagestore`, and the
`main.go` composition root is the only place that sees every package.

**LLM gateway.** `CheapestFastestUnderCeiling` (the default `RoutingPolicy`) drops models whose
worst-case cost exceeds the ceiling, models below the requested quality, and benched models. It
tries unmeasured models first, then the lowest latency EMA (`ema = α·latency + (1-α)·ema`), and
the gateway fails over on error. `EMATracker` benches a model for 30 s after 3 consecutive
failures. To add real providers, implement `Provider`. To change the routing rules, implement
`RoutingPolicy`. The gateway itself doesn't change. The prices in `mock.go` are placeholders.

### Without Docker

Requires Go 1.26+ (and, for cloud vision, cgo with `-tags onnx` and the ONNX Runtime 1.29 shared library) and PostgreSQL with pgvector 0.8 or later.

```bash
cd backend
go mod init github.com/bimalmithran/virtualwardrobe/backend   # already done; shown for reference
go get github.com/jackc/pgx/v5 github.com/pgvector/pgvector-go github.com/pgvector/pgvector-go/pgx
psql "$DATABASE_URL" -f db/schema.sql                         # optional: the server also applies it
DATABASE_URL=postgres://wardrobe:wardrobe@localhost:5432/wardrobe?sslmode=disable go run ./cmd/server
go vet ./... && go test ./...
```

Settings: `DATABASE_URL` (required), `ADDR` (default `:8080`), `UPLOAD_DIR`, `PUBLIC_BASE_URL`,
`AUTO_MIGRATE` (default `true`), `LLM_COST_CEILING_USD` (default `0.01`), `LLM_EMA_ALPHA` (default `0.3`).

## Licence

Copyright (C) 2026 Bimal.

This program is free software: you can redistribute it and/or modify it under the terms of the
GNU Affero General Public License as published by the Free Software Foundation, either version 3
of the License, or (at your option) any later version. It is distributed in the hope that it will
be useful, but WITHOUT ANY WARRANTY; see [LICENSE](LICENSE) for details.

In short: if you distribute a modified version of the app, or run a modified version of the API
for users over a network, you must offer them its source under the same licence.

The ML models are not part of this repository and keep their own licences; they are downloaded
on first use. RMBG-1.4 in particular is non-commercial only (see the warning above).
