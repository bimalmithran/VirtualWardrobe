# VirtualWardrobe — Edge-to-Cloud POC (Expo SDK 57 Android + Go/pgvector)

All computer vision runs on the phone: background removal, colour extraction and the 512-d
embedding. The phone then mirrors a lightweight payload (PNG cutout, hex colour, vector) to a
Go API backed by PostgreSQL + pgvector, which indexes it for similarity search. The app is
local-first: with no backend configured, or while offline, everything still works and
uploads catch up later.

## Quick start (Docker)

```bash
cp .env.example .env             # set EXPO_PUBLIC_API_URL to this machine's LAN IP, e.g. http://192.168.1.20:8080
docker compose up --build -d     # Postgres 17 + pgvector, and the Go API on :8080
curl localhost:8080/healthz      # {"status":"ok"}

docker compose --profile apk run --rm apk   # builds dist/VirtualWardrobe-release.apk (first run ~20-30 min)
adb install -r dist/VirtualWardrobe-release.apk
```

The phone must be on the same Wi-Fi as the machine running Compose, and port 8080 must be open
in the machine's firewall. `EXPO_PUBLIC_API_URL` is baked in at bundle time, so rebuild the APK
after changing it.

## Setup (what was run to create this project)

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
```

## Build the APK

```bash
npx eas-cli@latest login
npx eas-cli@latest build:configure            # first time only; links the project to your Expo account
npm run build:apk                             # = eas build -p android --profile preview  -> installable .apk
npm run build:dev                             # dev-client APK for hot reload: then `npx expo start`
```

`eas build --local` also works, but needs the Android SDK + NDK and JDK 17 installed locally.

**Or in Docker, with no Expo account:** `docker compose --profile apk run --rm apk`.
`docker/android/` holds an image with Node 22, JDK 17, Android SDK 36, build-tools 36.0.0 and NDK 27.1
(the versions RN 0.86 pins). It copies the project, runs `npm ci`, `expo prebuild` and
`./gradlew assembleRelease`, and writes `dist/VirtualWardrobe-release.apk`. Gradle and npm caches
live in named volumes, so later builds are much faster. The APK is signed with the Expo template's
debug keystore. That's fine for sideloading onto your own phones, but use EAS or your own keystore
for anything you distribute.

For EAS cloud builds, `.env` is uploaded with the project (only `.env*.local` is gitignored), so
`EXPO_PUBLIC_API_URL` reaches the bundle there too.

## Backend (Go + PostgreSQL/pgvector)

| Endpoint | Body | Notes |
|---|---|---|
| `POST /api/users/profile` | `{user_id, height_cm, body_shape, skin_undertone}` | Upsert. `user_id` is a UUID the app generates once per install. |
| `POST /api/wardrobe/items` | `{user_id, client_item_id, image_base64 \| image_url, color_hex, embedding[512], metadata?, category_slug?}` | Idempotent on `(user_id, client_item_id)`: 201 created, 200 updated. PNGs are written to the `uploads` volume and served at `/uploads/...`. |
| `POST /api/wardrobe/search` | `{embedding[512], user_id?, limit?}` | Top 5 by default (max 50), cosine similarity via the HNSW index. With `user_id` set, pgvector 0.8's iterative scan keeps the filter from returning too few rows. |
| `POST /api/llm/complete` | `{prompt, max_output_tokens?, min_quality?, cost_ceiling_usd?}` | LLM gateway demo (mock providers). 422 when no model fits the ceiling. |
| `GET /api/llm/models` | | EMA latency, sample count and cooldown state for each model. |
| `GET /healthz` | | Checks the database connection. |

- `backend/db/schema.sql` contains `users`, hierarchical `categories` (adjacency list, seeded),
  `wardrobe_items` (`JSONB` metadata, `VECTOR(512)` with `hnsw … vector_cosine_ops`), `outfits` and
  `outfit_items`. It is idempotent: Compose runs it on first init, and the API runs it again at
  boot (`AUTO_MIGRATE=true`).
- `backend/internal/store` uses `pgx/v5` with `pgvector-go`. Vector types are registered on each
  pooled connection in `AfterConnect`.
- `backend/internal/llmgateway` drops models over the cost ceiling or below the requested quality,
  and drops benched models. It tries unmeasured models first, then picks the lowest EMA latency
  (`ema = α·latency + (1-α)·ema`), and fails over on error. A model that fails 3 times in a row is
  benched for 30 s. `mock.go` has the demo model table. Its prices are placeholders, so plug real
  clients into the `Provider` interface.

Without Docker (Go 1.25+ and a Postgres with pgvector >= 0.8):

```bash
cd backend
go mod init github.com/bimalmithran/virtualwardrobe/backend   # already done; shown for reference
go get github.com/jackc/pgx/v5 github.com/pgvector/pgvector-go github.com/pgvector/pgvector-go/pgx
psql "$DATABASE_URL" -f db/schema.sql                         # optional, the server also applies it
DATABASE_URL=postgres://wardrobe:wardrobe@localhost:5432/wardrobe?sslmode=disable go run ./cmd/server
go test ./...
```

### How the phone syncs

`src/api/sync.ts` uploads the profile first, because items have a foreign key to users. It then
uploads every SQLite row with `synced_at IS NULL`, one PNG at a time to keep JS memory flat. Sync
runs after each save, at launch, and when the app returns to the foreground. A network or 5xx
error stops the batch, and it retries on the next trigger. Deleting a garment on the phone does
not delete it on the server yet. The garment screen's **Search the cloud** button calls
`/api/wardrobe/search`.
Expo Go will **not** work: it cannot load ONNX Runtime. The app detects this and shows an error
instead of crashing.

## Why ONNX Runtime directly instead of Transformers.js

Transformers.js does not run in React Native/Hermes. Its inference backends are
`onnxruntime-web` (needs WebAssembly, which Hermes does not have) and `onnxruntime-node`, and
its image utilities need a browser canvas or `sharp`. This app uses the same ONNX
exports Transformers.js would download, and runs them through `onnxruntime-react-native`, the
native ORT build for Android/iOS. Preprocessing follows each repo's `preprocessor_config.json`.

| Stage | Model / method | Where |
|---|---|---|
| Junk filter | brightness, contrast, Laplacian-variance blur | `src/vision/junkFilter.ts` |
| Background removal | `briaai/RMBG-1.4` int8, 1024², 44 MB | `src/vision/backgroundRemoval.ts` |
| Primary colour | K-Means++ in CIELAB, k=5, near-duplicate clusters merged | `src/vision/colorExtraction.ts` |
| Vector embedding | `Xenova/mobileclip_s0` vision tower int8, 256², 512-d | `src/vision/embedding.ts` |
| Undertone match | hue-warmth table × saturation | `src/vision/undertoneMatch.ts` |

**Licence warning:** RMBG-1.4 is non-commercial only. `ISNET` in `src/config/models.ts` is an
Apache-2.0 drop-in replacement; switch `MODELS.segmentation` to it before shipping anything.

## Memory safety

- Photos are resized natively (`expo-image-manipulator`) before any pixels reach JS. The largest
  JS buffer is about 12 MB, the 1024² input tensor.
- `src/ml/modelManager.ts` serialises all inference, so only one model runs at a time. It keeps
  2 sessions resident on ≥6 GB devices and 1 otherwise, evicting the least recently used. It
  releases everything when the app is backgrounded or on a memory warning.
- Only the focused tab mounts a camera, and the camera is unmounted while processing.
- Model downloads are size-verified, so a truncated file can't crash ORT's parser.

## Layout

```
src/app/            Expo Router screens: (tabs)/index=Closet, add, shop=Live Shop, profile; onboarding; garment/[id]
src/components/     IngestionFlow (capture → junk check → pipeline → save/score), CameraCapture, ModelSetup, …
src/ml/             ORT lazy loader + session/download manager
src/vision/         pipeline stages (pure TS, no React)
src/image/          Skia decode/encode, tensor + resampling helpers
src/storage/        SecureStore Digital Twin, SQLite closet (PNG on disk, embedding as BLOB)
src/api/            Go API client + local-first sync
backend/            Go API: cmd/server, internal/{api,store,llmgateway}, db/schema.sql
docker/android/     APK build image
docker-compose.yml  db + api (+ apk profile)
```
