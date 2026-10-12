# VirtualWardrobe — Edge-to-Cloud POC

| | |
|---|---|
| `frontend/` | Expo SDK 57 Android app. All computer vision runs on the phone: junk filter, background removal (RMBG-1.4), K-Means colour, 512-d MobileCLIP embedding. |
| `backend/` | Go 1.25 API on PostgreSQL 17 + pgvector. It stores what the phone produced (PNG cutout, hex colour, vector), runs similarity search over it, and hosts the LLM gateway. |
| `docker-compose.yml` | Runs the backend stack and, as an opt-in profile, builds the APK. |

The app is local-first. With no backend configured, or while offline, everything still works,
and uploads catch up later.

## Quick start (Docker)

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
| Undertone match | hue-warmth table × saturation | `src/vision/undertoneMatch.ts` |

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

### Architecture

```
src/app/                  Expo Router screens, kept thin: read services, render components
src/services/             container.ts = composition root (the only place concrete classes are chosen)
                          ServicesProvider.tsx exposes AppServices (typed by interfaces) to React
src/domain/types.ts       shared data types, no dependencies
src/features/ingestion/   IngestionScreen (container) · useIngestion (state machine) ·
                          modes.ts (IngestionMode strategies: closet, shop) · components/ (views)
src/features/profile/     ProfileContext (React state; persistence and sync delegated)
src/features/closet/      CloudSearchPanel
src/vision/               GarmentPipeline + stages behind interfaces (BackgroundRemover,
                          GarmentEmbedder, PaletteExtractor); pure colour, junk and similarity math
src/ml/                   ModelStatusStore (observable) · ModelDownloader (files) ·
                          SessionPool (implements ModelRunner + ModelMemory) · ort.ts (lazy native load)
src/storage/              SqliteClosetRepository (ClosetRepository + PendingUploads) ·
                          FileGarmentImageStore · SecureStoreProfileRepository · migrations
src/api/                  FetchHttpClient (transport) · SecureStoreInstallationId · WardrobeApi (endpoints)
src/sync/                 CloudSyncService / DisabledCloudSync (null object when no backend)
```

How SOLID maps onto this layout:

- **Single responsibility.** Downloading models, holding sessions and broadcasting status are
  three classes. Transport, identity and endpoints are three modules. The ingestion screen is
  split into a state machine, strategies and views.
- **Open/closed.** A new capture flow is a new `IngestionMode`, and a new model is a new
  `BackgroundRemover`/`GarmentEmbedder`. `GarmentPipeline` and `useIngestion` stay unchanged.
- **Liskov substitution.** `DisabledCloudSync` stands in for `CloudSyncService` everywhere, and test
  fakes stand in for repositories and remotes.
- **Interface segregation.** Sync sees `PendingUploads`, not the whole closet repository, and
  `GarmentImageReader`, not the full image store. Vision stages see `ModelRunner`, not the session
  pool.
- **Dependency inversion.** Vision, sync and screens depend on interfaces. Only
  `services/container.ts` imports concrete storage, HTTP and ML classes.

### How the phone syncs

`CloudSyncService` uploads the profile first, because items have a foreign key to users. It then
uploads every SQLite row with `synced_at IS NULL`. Sync runs after each save, at launch, and when
the app returns to the foreground. A network or 5xx error stops the batch, and it retries on the
next trigger. A 4xx error only skips that one garment. Deleting a garment on the phone does not
delete it on the server yet.

## Backend (`backend/`)

| Endpoint | Body | Notes |
|---|---|---|
| `POST /api/users/profile` | `{user_id, height_cm, body_shape, skin_undertone}` | Upsert. `user_id` is a UUID the app generates once per install. |
| `POST /api/wardrobe/items` | `{user_id, client_item_id, image_base64 \| image_url, color_hex, embedding[512], metadata?, category_slug?}` | Idempotent on `(user_id, client_item_id)`: 201 created, 200 updated. |
| `POST /api/wardrobe/search` | `{embedding[512], user_id?, limit?}` | Top 5 by default (max 50) by cosine similarity via the HNSW index. With `user_id` set, pgvector 0.8's iterative scan keeps the filter from returning too few rows. |
| `POST /api/llm/complete` | `{prompt, max_output_tokens?, min_quality?, cost_ceiling_usd?}` | LLM gateway demo (mock providers). 422 when no model fits the ceiling, 502 when every eligible model failed. |
| `GET /api/llm/models` | | EMA latency, sample count and cooldown state for each model. |
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

Requires Go 1.25+ and PostgreSQL with pgvector 0.8 or later.

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
