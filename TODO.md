# Wall Assistant — Build TODO

# Claude Code

COMMANDS FOR CLI

add options to turn on floodlights, siren, other features.

Make graph one that works on windows 10 CMD

## Status key
- [x] Done
- [ ] Todo
- [~] In progress

---

## Phase 1 — Foundation (current session)
- [x] Project structure scaffolded
- [x] Node.js/Express server with WebSocket push
- [x] Static file serving from `/client`
- [x] Config loader (`config.json` + `.env`)
- [x] Ring adapter stub (auth placeholder, snapshot polling stub)
- [x] Temperature adapter stub (Open-Meteo free weather API, no key required)
- [x] PWA manifest + service worker skeleton
- [x] iOS Safari "Add to Home Screen" meta tags
- [x] Spotify-dark shell UI (4 widget slots: 2 cameras, temp, clock)
- [x] WebSocket client that receives server push and updates widgets

---

## Phase 2 — Ring Authentication
- [x] Run one-time auth CLI: `node server/ring-auth.js`
  - Prompts for Ring email, password, 2FA code
  - Saves refresh token to `config.json` (never committed)
- [x] Verify token refresh works across server restarts
  - `onRefreshTokenUpdated` subscription persists new token to `config.json`
- [x] Wire real snapshot URLs into the Ring adapter
  - Express serves `/api/snapshot/:index` as JPEG; WebSocket sends URL with frame timestamp as cache key
- [ ] Test camera tile displays live snapshots (polling every 5s)

---

## Phase 3 — Temperature Source (pick one)
- [x] **Option A** (current default): Open-Meteo weather API — outdoor temp, no key needed
- [x] **Option B**: Ecobee thermostat — indoor temp via Ecobee API (needs API key)
  - One-time auth: `node server/ecobee-auth.js` (requires `ecobee.apiKey` in config first)
  - When configured: indoor temp is primary, outdoor is secondary on the temp tile
  - Token rotation persisted automatically on every refresh
- [ ] **Option C**: Nest thermostat — indoor temp via Google Smart Device Management API
- [ ] **Option D**: Home Assistant — pulls any sensor via HA REST API (most flexible)
- [ ] **Option E**: Ring temperature sensor — if you have Ring Alarm kit with temp sensor

---

## Phase 4 — Camera Streaming Upgrade Path
Current default is snapshot polling (image refresh every 5s). Upgrade options ranked by complexity:

- [ ] **Snapshot polling** (default, done in foundation) — not live, works everywhere
- [x] **HLS via ffmpeg transcoding** — ~5s latency, works natively in iOS Safari, needs ffmpeg installed on desktop
- [ ] **WebRTC via Ring live stream** — near-zero latency, complex; ring-client-api has WebRTC support but iOS Safari signaling needs testing

---

## Phase 5 — Kiosk / Polish
- [x] `navigator.wakeLock` to prevent iPad screen sleep (re-acquired on visibilitychange)
- [x] HTTP only — local network, no cert needed
- [ ] Doorbell event push — skipped per request
- [x] Weather hi/lo forecast on temperature card (Open-Meteo daily endpoint)
- [x] Viewport locked: no pinch-zoom, no page scroll/bounce (overscroll-behavior + touch-action)
- [ ] App icon set (180x180) — drop a PNG at `client/icons/icon-180.png`
- [x] Tap a camera tile to expand it full-screen (tap overlay or ✕ to dismiss)

---

---

## Phase 6 — Expanded Widgets & Smart Features

### New widget types
- [ ] **Calendar widget** — shows today's events from Google Calendar (OAuth) or a public `.ics` URL; displays event title, time, and duration; highlights events starting within the next 30 min
- [ ] **Countdown widget** — user-defined label + target date; counts down days/hours/min; switches to "elapsed" mode after the date passes; config: `label`, `targetDate`
- [ ] **UV & Air Quality widget** — UV index + AQI from Open-Meteo (no key needed); color-codes risk level; shows dominant pollutant when AQI > 50
- [ ] **Commute / Transit widget** — live drive or transit ETA via Google Maps Distance Matrix API or Apple Maps web API; config: `origin`, `destination`, `mode`; updates every 5 min
- [ ] **Package tracking widget** — polls a self-hosted parcel tracker (e.g., `parcelsapp` API or `17track`); shows carrier, status, and last-scan location; configurable tracking numbers list
- [ ] **Crypto ticker widget** — reuses the stocks slot infrastructure; fetches BTC/ETH/others from CoinGecko free API; sparkline + 24h % change; config: `symbols` comma list

### Camera & security improvements
- [ ] **Lockdown mode** — when Ring motion event fires, auto-open the camera overlay full-screen, flash a red border on the card for 5 s, and play a soft alert tone; dismissible with a tap; config: `triggerCamera` index
- [ ] **Motion clip priority in tile** — when a motion clip URL is available, show its first frame as the tile thumbnail instead of the scheduled snapshot; add a red dot badge on the tile label
- [ ] **Stale camera alert** — if `snapshotAge` is older than a configurable threshold (default 15 min), overlay a subtle amber badge on the camera tile
- [ ] **Two-way audio button** — in the camera expand overlay, add a hold-to-talk button that opens a Ring SIP/RTP channel via `ring-client-api`; iOS mic permission prompt handled once

### Layout & UX
- [ ] **Layout presets / scene switching** — save up to 4 named layout presets; tap to switch; server persists each preset in `layout-presets.json`; keyboard shortcut `1–4` on desktop
- [ ] **Schedule-based auto-switching** — config: array of `{ preset, cronExpr }` entries; server switches layout on schedule (e.g., night mode at 22:00, morning mode at 07:00)
- [ ] **Ambient / night dimming** — between configured hours, client reduces brightness via a translucent overlay; restores on tap or motion event
- [ ] **Swipe gesture to change layout preset** — horizontal swipe on the main grid cycles through presets; uses pointer events, works on iOS Safari
- [ ] **PIN-protected admin page** — `GET /admin` redirects to a PIN entry screen; session stored in a signed cookie; config: `adminPin`

### System & infra
- [ ] **Web Push notifications for motion** — server subscribes to Ring motion events and sends a Web Push payload; client registers a push subscription via service worker; no third-party relay needed on local network
- [ ] **Battery status widget / overlay** — reads `navigator.getBattery()` on the iPad; if below 20% shows a low-battery badge on the clock card; optional: send a log event to the server
- [ ] **Health-check endpoint** — `GET /api/health` returns JSON `{ ok, uptime, ringReady, ecobeeReady, wsClients, lastPayloadAt }`; useful for uptime monitors (e.g., `curl` from a cron or Home Assistant)
- [ ] **Configurable update interval** — `config.json: { "updateIntervalMs": 3000 }` instead of the hardcoded `setInterval(..., 3000)` in `index.js`; validates min 1000 ms

### Polish
- [ ] **Dropped-snapshots counter badge** — replace the per-snapshot `console.warn` in `main.js` with a server-side counter already tracked; show a small badge in the dashboard instead of log noise (noted at top of this file)
- [ ] **App icon set** — generate a full iOS icon set (180×180, 167×167, 152×152) from a single source SVG using `sharp`; add to manifest and `apple-touch-icon` tags (left open from Phase 5)
- [ ] **Reduced-motion respect** — check `prefers-reduced-motion` and skip CSS animations on news scroll track and any new animated widgets

---

## Defaults chosen (redirect if wrong)
- **JS framework**: vanilla JS — no build step, works on any old Safari
- **Temperature default**: Open-Meteo (free outdoor weather, no API key, lat/lon in config)
- **Camera default**: snapshot polling — replace with HLS or WebRTC in Phase 4

---

## Running the app
```bash
cd server
npm install
node index.js
# Open http://<your-mac-ip>:3000 on the iPad
```
