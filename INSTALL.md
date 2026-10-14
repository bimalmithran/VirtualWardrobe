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
| `AUTH_REQUIRED` | `true` | Every `/api` call must carry the install's device token. Only switch off for local experiments. |
| `VISION_ENABLED` | `true` | Cloud background removal / style vectors for low-end phones (needs the user's consent). Models (~56 MB) download into the `models` volume on first boot. |
| `VISION_SEGMENTATION` | `rmbg-1.4` | `rmbg-1.4` (non-commercial licence, matches the app) or `isnet` (Apache-2.0, use for commercial deployments). |
| `ANTHROPIC_API_KEY` | empty | Turns on the AI stylist (Claude). Empty = the built-in basic stylist. |
| `STYLIST_MODEL` | `claude-opus-5-5` | Claude model for the stylist. |
| `REVENUECAT_WEBHOOK_AUTH` | empty | The exact `Authorization` header value you set on the RevenueCat webhook. Without it purchases aren't recorded server-side. |
| `AFFILIATE_SECRET` | random per boot | Signs shopping links; set a long random string so links survive restarts. |
| `AMAZON_ASSOCIATE_TAG` | empty | Amazon Associates tracking id added to Amazon.in links. |
| `AFFILIATE_LINK_WRAPPER` | empty | Affiliate-network deep link with a `{url}` placeholder (Cuelinks, EarnKaro, …) for Myntra/AJIO/Zara links. |
| `AFFILIATE_PARTNERS` | `myntra,ajio,amazon,zara` | Stores to offer, in order. |

App-side settings live in `frontend/.env` and are baked in at build time:

| Variable | Meaning |
|---|---|
| `EXPO_PUBLIC_API_URL` | Server address (as above). |
| `EXPO_PUBLIC_LEGAL_ENTITY`, `EXPO_PUBLIC_PRIVACY_URL` | Your company name and hosted privacy notice, shown in the consent sheet. |
| `EXPO_PUBLIC_GRIEVANCE_NAME`, `_EMAIL`, `_PHONE`, `_ADDRESS` | Grievance Officer contact (DPDP). Until set, the privacy screens show a "not configured" warning. |
| `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`, `_IOS_KEY` | RevenueCat public SDK keys. Without them the paywall shows plans as unavailable. |

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

1. **Consent:** choose your language, then tick what the app may do. Only *Keep my wardrobe on
   this phone* is required; cloud backup, cloud processing, the AI stylist and analytics are
   optional and off until ticked. Change them any time in **Twin → Privacy & data**.
2. **Digital Twin:** enter your height, body shape and skin undertone. Measurements and a
   12-season colour type are optional.
3. **Model download:** on first use of **Add**, **Live Shop** or **Your colours**, the app
   downloads its on-device AI models once (about 56 MB: background removal 44 MB and MobileCLIP
   12 MB). Use Wi-Fi.
4. **Camera permission:** allow it when asked. The camera shows live feedback ("Too blurry,
   hold still", "Needs more light") before you press the shutter.
5. Photograph a garment on a plain background, then tag its category on the result screen.
   Tag at least one top and one bottom to get suggestions in the **Outfits** tab.

### Using the app

**Adding many garments at once.** On the **Add** tab, tap **Gallery** and select up to 20
photos; each becomes its own garment. They're processed one after another on the phone, with a
"Photo 3 of 8" progress screen, so keep the app open. Photos that fail the quality check (blurry,
too dark) are skipped rather than stopping the batch. The summary lists every photo as added,
skipped or failed, offers **Add skipped photos anyway**, and opens each new garment so you can tag
its category. Picking just one photo works as before. **Live Shop** stays one photo at a time.

**Several photos of one garment.** One photo's colour depends on its light and angle. Add more
shots (the back, a close-up, the garment in other light) and the app combines them into a truer
colour and style vector, which improves outfit suggestions and "similar items".

- Right after adding a garment, tap **Add another photo of this garment**.
- Or open any garment from the **Closet** and tap the **Add photo** tile in its photo strip.
- On that screen, **Gallery** also takes several photos at once; all of them join that garment.
- Tap a thumbnail to view it; long-press one to remove a bad shot. A garment keeps at least one
  photo.

**Your colours (photos of you).** Open the **Twin** tab → **Your colours**, or tap the prompt on
the **Outfits** tab.

1. Tap **Take a photo** (opens the front camera; **Flip** switches lenses) or **Upload** to pick
   one from the gallery.
2. The app reads your skin tone, undertone (warm, cool or neutral), depth and skin-to-hair
   contrast, and shows your colour season with a palette of colours that flatter you.
3. Below that: **Best on you from your closet** ranks your garments by how well they suit you,
   and **Colours to add to your wardrobe** lists palette colours your closet is missing.
4. If your photos suggest a different undertone from your Digital Twin, a button offers to use it.
   Nothing changes unless you tap it.

After that, outfit suggestions, the "suits you" score on outfit cards, garment match scores and
Live Shop all take your palette and contrast into account.

For a reliable reading, face a window in daylight, keep your face and neck visible, and avoid
beauty filters and heavy make-up. Phone white balance affects the result, so a few photos in
different light give a steadier answer. Long-press a photo to remove it.

**Privacy:** photos of you are processed and stored on the phone only and are never uploaded.
For garments, the server receives only the main cutout plus the combined colour and style vector;
extra garment photos stay on the phone.

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

Updating keeps your closet, outfits, photos and downloaded models. The app upgrades its local
database on first launch; garments added before multi-photo support become garments with one
photo.

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

## Run the web app

The same app runs in a browser (Chrome, Edge or Firefox; WebGPU/WebNN are used when available,
WebAssembly otherwise).

```bash
cd frontend
npm ci                     # also copies the CanvasKit and ONNX Runtime Web files into public/
npm run web                # dev server on http://localhost:8081
npm run build:web          # static site in dist-web/ (dist/ holds the APK)
```

Host the exported folder on any static host **with these response headers** (SQLite and
multi-threaded ONNX Runtime need a cross-origin-isolated page):

```
Cross-Origin-Embedder-Policy: credentialless
Cross-Origin-Opener-Policy: same-origin
```

EAS Hosting applies them from `app.json`. Serve the site over HTTPS. On the web, photos and
models stay in the browser (SQLite in the origin's private storage, models in Cache Storage),
and Premium is bought in the mobile app.

## Premium and shopping links (optional)

1. **RevenueCat:** create a project with Google Play (and App Store) apps, an entitlement named
   `premium`, and an offering with monthly/annual packages. Put the public SDK keys in
   `frontend/.env` and rebuild. Add a webhook pointing at `https://<your-api>/api/webhooks/revenuecat`
   with an Authorization header value, and put the same value in `REVENUECAT_WEBHOOK_AUTH`.
2. **Affiliate links:** set `AMAZON_ASSOCIATE_TAG` and/or `AFFILIATE_LINK_WRAPPER`, plus a fixed
   `AFFILIATE_SECRET`. To show real products, load a partner feed into the `affiliate_products`
   table (partner, title, category, color_hex, price_inr, image_url, url).

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
| App closes as soon as it starts removing a background | You have an APK built before the ONNX Runtime linking fix. Rebuild and reinstall with `adb install -r` (keeps data). |
| "ONNX Runtime native module is not available in this build" | Same cause as above: the APK doesn't include the on-device AI runtime. Rebuild and reinstall. |
| Your colours: "too dark" / "overexposed" | Retake facing a window in daylight, without flash or direct sun on your face. |
| Your colours: "Not enough skin is visible" | Use a photo where your face is clearly shown, not from behind or heavily filtered. |
| Your colours result looks wrong | Lighting shifts skin colour. Add two or three photos in different daylight; the app combines them. Remove any odd one with a long-press. |
