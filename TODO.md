# Wall Assistant — Build TODO

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
- [ ] Run one-time auth CLI: `node server/ring-auth.js`
  - Prompts for Ring email, password, 2FA code
  - Saves refresh token to `config.json` (never committed)
- [ ] Verify token refresh works across server restarts
- [ ] Wire real snapshot URLs into the Ring adapter
- [ ] Test camera tile displays live snapshots (polling every 5s)

---

## Phase 3 — Temperature Source (pick one)
- [ ] **Option A** (current default): Open-Meteo weather API — outdoor temp, no key needed
- [ ] **Option B**: Ecobee thermostat — indoor temp via Ecobee API (needs API key)
- [ ] **Option C**: Nest thermostat — indoor temp via Google Smart Device Management API
- [ ] **Option D**: Home Assistant — pulls any sensor via HA REST API (most flexible)
- [ ] **Option E**: Ring temperature sensor — if you have Ring Alarm kit with temp sensor

---

## Phase 4 — Camera Streaming Upgrade Path
Current default is snapshot polling (image refresh every 5s). Upgrade options ranked by complexity:

- [ ] **Snapshot polling** (default, done in foundation) — not live, works everywhere
- [ ] **HLS via ffmpeg transcoding** — ~5s latency, works natively in iOS Safari, needs ffmpeg installed on desktop
- [ ] **WebRTC via Ring live stream** — near-zero latency, complex; ring-client-api has WebRTC support but iOS Safari signaling needs testing

---

## Phase 5 — Kiosk / Polish
- [ ] `navigator.wakeLock` to prevent iPad screen sleep
- [ ] HTTPS via mkcert self-signed cert (required for wakeLock + full PWA on LAN IP)
  - `brew install mkcert && mkcert -install && mkcert <your-mac-ip>`
  - Update server to use `https` module with the generated cert
- [ ] Doorbell event push — Ring motion/ring alerts show a full-screen notification overlay
- [ ] Add more widget slots: weather forecast, time/date widget improvements
- [ ] App icon set (180x180 for iOS touch icon)
- [ ] Tap a camera tile to expand it full-screen

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
