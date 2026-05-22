# wall-assistant

A local smart home dashboard for a wall-mounted iPad. Spotify-dark aesthetic. No cloud, no deployment — runs entirely on your home WiFi.

## What it does

- **Ring cameras** — snapshot feed, auto-refreshing every 5 seconds via Ring's API
- **Temperature** — outdoor weather via Open-Meteo always; Ecobee indoor temp shown as the primary tile when configured
- **Clock** — always-on time and date display
- **PWA** — add to iPad home screen via Safari → Share → "Add to Home Screen" for a full-screen kiosk feel

## Architecture

```
Mac (server)  ──WebSocket──►  iPad (browser / PWA)
     │
     ├── Serves static web app (Express)
     ├── GET /api/snapshot/:index  ← JPEG proxy for Ring snapshots
     ├── Polls Ring API for camera snapshots (every 5s)
     └── Fetches weather from Open-Meteo
```

The Mac runs the Node.js server, fetches all smart home data, and pushes updates to the iPad over WebSocket every 5 seconds. The iPad only talks to your Mac — no direct external connections.

---

## Setup

### 1. Copy the config template

```bash
cp config.json.example config.json
```

Edit `config.json` and fill in your values:

```json
{
  "latitude": 37.7749,
  "longitude": -122.4194,
  "ring": {
    "refreshToken": ""
  },
  "ecobee": {
    "apiKey": "YOUR_ECOBEE_APP_API_KEY",
    "accessToken": "",
    "refreshToken": ""
  },
  "cameras": [
    { "name": "Front Door", "index": 0 },
    { "name": "Backyard",   "index": 1 }
  ]
}
```

- `latitude` / `longitude` — used for the outdoor temperature widget (Open-Meteo)
- `ring.refreshToken` — filled in automatically by the Ring auth CLI (step 2)
- `ecobee.apiKey` — your Ecobee developer app key (see step 3); omit the whole `ecobee` block to skip indoor temp
- `ecobee.accessToken` / `ecobee.refreshToken` — filled in automatically by `ecobee-auth.js`
- `cameras` — names and order of your Ring cameras as they appear in the Ring app

`config.json` is gitignored and never committed.

---

### 2. Authenticate with Ecobee (optional, one-time)

Skip this step if you don't have an Ecobee thermostat. When configured, indoor temperature becomes the primary display on the temp tile and outdoor moves to a secondary line.

**Part A — Create a developer app (one-time, ~2 min):**

1. Log in to your Ecobee account at [ecobee.com](https://www.ecobee.com)
2. Click your name in the top-right → **Developer**
3. Click **Create New** under My Apps
4. Fill in any name and summary (e.g. "wall-assistant")
5. Set **Authorization Method** to `ecobeePin`
6. Click **Save** — your API key appears on the app detail page
7. Copy the API key into `config.json` under `ecobee.apiKey`

**Part B — Authorize the app against your thermostat:**

1. Run the auth CLI:

```bash
node server/ecobee-auth.js
```

It will print a 4-character PIN. Open the Ecobee web portal or mobile app, go to **My Apps → Add Application**, enter the PIN, and click **Authorize**. Then press Enter back in the terminal. The access and refresh tokens are written to `config.json` automatically.

**Token rotation:** Ecobee access tokens expire after 1 hour. The server refreshes them proactively and persists the new tokens without any manual intervention.

---

### 3. Authenticate with Ring (one-time)

Ring uses OAuth with a long-lived refresh token. Run the auth CLI once to obtain it:

```bash
node server/ring-auth.js
```

It will prompt for:
1. Your Ring account email
2. Your Ring account password
3. A 2FA code (Ring will text or email it to you)

On success, the refresh token is written directly into `config.json`. You don't need to run this again unless you revoke access or change your Ring password.

**Token rotation:** Ring rotates the refresh token on every OAuth call. The server automatically writes the new token back to `config.json` whenever it refreshes, so restarts keep working without re-running the CLI.

---

### 4. Start the server

Mac:
```bash
./start.sh
```

Windows:
```
start.bat
```

Both scripts install dependencies automatically on first run. You can also run manually:

```bash
cd server
npm install
node index.js
```

The terminal will print the local URL, e.g.:
```
wall-assistant server running at http://localhost:3000
[ring] Found 2 camera(s): Front Door, Backyard
```

If Ring is not yet authenticated, the server still starts and shows temperature and clock — cameras will be blank until you run the auth CLI.

---

### 5. Open on the iPad

Navigate to the URL printed in the terminal (e.g. `http://192.168.1.x:3000`) in Safari.

To install as a home screen app: tap **Share → "Add to Home Screen"** — this gives a full-screen kiosk experience with no browser chrome.

---

## How snapshots work

1. The server calls `camera.getSnapshot()` on each Ring camera every 5 seconds.
2. The JPEG buffer is held in memory and served at `GET /api/snapshot/:index`.
3. The WebSocket push sends each camera's snapshot URL with a frame timestamp as a cache key (`/api/snapshot/0?t=<timestamp>`).
4. The browser only re-fetches the image when Ring produces a new frame — unchanged frames are served from the browser cache.
5. If a snapshot fetch fails (camera sleeping, API timeout), the last successful frame is served instead of a broken image.

---

## Project structure

```
wall-assistant/
├── start.sh / start.bat         # one-click server start
├── config.json.example          # copy to config.json, then fill in values
├── server/
│   ├── index.js                 # Express + WebSocket server, /api/snapshot route
│   ├── ring.js                  # Ring adapter: auth, camera cache, snapshot fetch
│   ├── ring-auth.js             # One-time CLI to obtain a Ring refresh token
│   ├── ecobee.js                # Ecobee adapter: token refresh, indoor temp fetch
│   ├── ecobee-auth.js           # One-time CLI to authorize Ecobee (PIN flow)
│   └── temperature.js           # Combines Open-Meteo (outdoor) + Ecobee (indoor)
└── client/
    ├── index.html               # 2×2 dashboard grid
    ├── css/main.css             # Spotify dark theme
    ├── js/main.js               # WebSocket client + clock
    ├── manifest.webmanifest     # PWA manifest
    └── sw.js                    # Service worker
```

---

## Next steps

See `TODO.md` for the full phased build plan.

- **Phase 3** — swap the temperature source (Ecobee, Nest, Home Assistant, or Ring sensor)
- **Phase 4** — upgrade cameras from snapshot polling to HLS or WebRTC for near-live video
- **Phase 5** — kiosk polish: wake lock, HTTPS, doorbell push notifications, full-screen tap
