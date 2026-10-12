# VirtualWardrobe — Edge AI POC (Expo SDK 57, Android)

All computer vision runs on the phone. The cloud is only used once, to download two
ONNX models (~56 MB) from Hugging Face on first use.

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
```
