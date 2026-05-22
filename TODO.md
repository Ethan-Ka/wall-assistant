# Wall Assistant — Build TODO

# Claude Code

instead of warning every time a snapshot fails to load, just do a "dropped snapshots counter" and then focus on the real errors

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
