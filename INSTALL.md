# VirtualWardrobe: install and run

This guide covers two things:

1. Running the server (Go API + PostgreSQL/pgvector) with Docker.
2. Installing the Android APK on your phone.

The phone talks to the server over your Wi-Fi. Set up the server first, then install the APK.

> The current APK (`frontend/dist/VirtualWardrobe-release.apk`) was built to talk to
> **`http://192.168.1.9:8080`**. If your computer's IP is different, follow
> [Rebuild the APK for a different IP](#rebuild-the-apk-for-a-different-ip) first.

---

## 1. Run the server

### Requirements

- Docker with the Compose plugin (`docker compose version` should print a version).
- Port 8080 free on this machine.

### Start

Run from the repository root:

```bash
cd ~/development/POC/VirtualWardrobe

# One-time: create the config file (skip if .env already exists)
cp .env.example .env

# Build and start Postgres 17 + pgvector, and the Go API on port 8080
docker compose up --build -d
```

The API creates and updates the database schema itself on startup. No manual SQL is needed.

### Check it is running

```bash
docker compose ps                  # both "db" and "api" should be Up; db shows (healthy)
curl localhost:8080/healthz        # {"status":"ok"}
```

### Let the phone reach it

1. Find this machine's Wi-Fi IP:

   ```bash
   ip -4 addr show | grep inet      # e.g. inet 192.168.1.9/24 on wlan0
   ```

2. Open port 8080 in the firewall if you run one:

   ```bash
   sudo ufw allow 8080/tcp                                   # ufw
   # or: sudo firewall-cmd --add-port=8080/tcp --permanent && sudo firewall-cmd --reload
   ```

3. On the phone, connect to the **same Wi-Fi** and open `http://<your-ip>:8080/healthz` in the
   browser. It should show `{"status":"ok"}`. If it doesn't load, the APK won't be able to sync
   either. Recheck the firewall and that both devices are on the same network.

### Day-to-day commands

```bash
docker compose logs -f api         # follow API logs (each request is logged)
docker compose restart api         # restart the API
docker compose stop                # stop, keep data
docker compose up -d               # start again
docker compose up --build -d       # rebuild after pulling or changing backend code
docker compose down                # remove containers, keep data (volumes)
docker compose down -v             # remove containers AND wipe the database and uploaded images
```

Optional: open a database shell. Postgres listens only on `127.0.0.1:5432`:

```bash
docker compose exec db psql -U wardrobe -d wardrobe
```

### Settings (`.env` at the repo root)

| Variable | Default | Meaning |
|---|---|---|
| `POSTGRES_PASSWORD` | `wardrobe` | Database password. Set it before the first `up`; changing it later needs `down -v`. |
| `PUBLIC_BASE_URL` | empty | Base for image URLs the API returns. Empty means use the address the phone called. |
| `EXPO_PUBLIC_API_URL` | `http://192.168.1.9:8080` | Server address **baked into the APK** at build time. |

---

## 2. Install the APK on Android

**File:** `frontend/dist/VirtualWardrobe-release.apk` (about 100 MB, for 64-bit ARM phones,
which covers any recent Android phone).

### Option A: USB with adb (recommended)

1. On the phone, enable **Developer options**: Settings → About phone → tap **Build number** 7
   times. On Samsung it's under Software information.
2. Turn on **USB debugging**: Settings → Developer options → USB debugging.
3. Connect the phone by USB and accept the "Allow USB debugging?" prompt.
4. On the computer:

   ```bash
   adb devices                     # your phone should be listed as "device"
   adb install -r frontend/dist/VirtualWardrobe-release.apk
   ```

   `-r` replaces an existing install and keeps your closet data.

No `adb`? Install Android platform-tools, e.g. `sudo pacman -S android-tools` on Arch/CachyOS or
`sudo apt install adb` on Debian/Ubuntu.

### Option B: copy the file to the phone

1. Copy `VirtualWardrobe-release.apk` to the phone (USB file transfer, Google Drive, a messaging
   app, etc.).
2. Open it from the phone's Files app.
3. When Android asks, allow **Install unknown apps** for that app (Files/Chrome/Drive), then tap
   **Install**.
4. If Play Protect warns about an unknown developer, choose **Install anyway**. The APK is signed
   with a development key, which is expected for a sideloaded test build.

### First launch

1. **Digital Twin:** enter your height, body shape and skin undertone.
2. **Model download:** on first use of **Add** or **Live Shop**, the app downloads its on-device
   AI models once (about 56 MB: background removal 44 MB and MobileCLIP 12 MB). Use Wi-Fi.
3. **Camera permission:** allow it when asked.
4. Photograph a garment on a plain background, then tag its category on the result screen.
   Tag at least one top and one bottom to get suggestions in the **Outfits** tab.

### Check that sync works

- **Closet** tab header shows `all synced` or `N waiting to sync`. `on-device only` means the APK
  was built without a server address.
- Server side: `docker compose logs -f api` shows `POST /api/wardrobe/items status=201` after
  you add a garment.
- Offline is fine. Everything works locally, and uploads catch up when the app next opens or
  returns to the foreground with the server reachable.

### Update or uninstall

```bash
adb install -r frontend/dist/VirtualWardrobe-release.apk   # update, keeps data
adb uninstall com.bimal.virtualwardrobe                     # remove app and its local data
```

---

## Rebuild the APK for a different IP

The server address is compiled into the APK. Rebuild it whenever the computer's IP changes
or you move to another network.

```bash
cd ~/development/POC/VirtualWardrobe

# 1. Point the app at this machine
sed -i "s|^EXPO_PUBLIC_API_URL=.*|EXPO_PUBLIC_API_URL=http://$(ip -4 route get 1.1.1.1 | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}'):8080|" .env
grep EXPO_PUBLIC_API_URL .env

# 2. Build in Docker (no Android SDK or Expo account needed)
docker compose --profile apk run --rm apk
#    first run ~20-30 min; later runs ~3-10 min thanks to cached Gradle/npm volumes
#    output: frontend/dist/VirtualWardrobe-release.apk

# 3. Install
adb install -r frontend/dist/VirtualWardrobe-release.apk
```

Tip: to avoid rebuilding every time the IP changes, give this machine a fixed IP (DHCP
reservation) in your router.

Alternative cloud build with EAS (needs a free Expo account):

```bash
cd frontend
npx eas-cli@latest login
npm run build:apk               # eas build -p android --profile preview → download link for the .apk
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `curl localhost:8080/healthz` fails | `docker compose ps` and `docker compose logs api`. The API retries the database for ~30 s on startup. |
| Phone browser can't open `http://<ip>:8080/healthz` | Same Wi-Fi? Firewall port 8080 open? Some guest or office networks block device-to-device traffic. |
| Closet says `N waiting to sync` and it never drops | The APK points at the wrong IP. Rebuild it (see above). |
| `adb devices` shows `unauthorized` | Unlock the phone and accept the USB debugging prompt. Try `adb kill-server && adb devices`. |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | An install signed with a different key exists. Run `adb uninstall com.bimal.virtualwardrobe` first. This erases local data. |
| Model download fails | Needs internet access to huggingface.co. Retry from the **Twin** tab. |
| App opened in Expo Go shows an error | Expected. The app needs its own APK because ONNX Runtime is a native module. |
