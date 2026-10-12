#!/usr/bin/env bash
# Builds a sideloadable release APK from the project mounted read-only at /src.
# Output: /out/VirtualWardrobe-release.apk (./dist on the host).
set -euo pipefail

# Work on a copy so prebuild's generated android/ never touches the host checkout.
rsync -a --delete \
  --exclude node_modules --exclude android --exclude ios --exclude .git \
  --exclude dist --exclude .expo --exclude backend --exclude .claude \
  /src/ /work/
cd /work

[ -f "$HOME/.gradle/gradle.properties" ] || { mkdir -p "$HOME/.gradle"; cp /opt/gradle-defaults/gradle.properties "$HOME/.gradle/"; }

echo "==> EXPO_PUBLIC_API_URL=${EXPO_PUBLIC_API_URL:-<unset: app runs on-device only>}"
npm ci --no-audit --no-fund

# Continuous Native Generation: android/ comes from app.json + config plugins.
npx expo prebuild --platform android --clean --no-install

cd android
# The Expo template signs release builds with the debug keystore, which is fine for
# sideloading. Use EAS (or your own keystore) for anything distributed.
./gradlew assembleRelease --no-daemon --console=plain

mkdir -p /out
cp app/build/outputs/apk/release/app-release.apk /out/VirtualWardrobe-release.apk
chown "${HOST_UID:-0}:${HOST_GID:-0}" /out /out/VirtualWardrobe-release.apk
echo "==> APK: dist/VirtualWardrobe-release.apk"
