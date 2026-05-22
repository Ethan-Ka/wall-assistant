# wall-assistant

A local smart home dashboard for a wall-mounted iPad. Spotify-dark aesthetic. No cloud, no deployment — runs entirely on your home WiFi.

## What it does

- **Ring cameras** — live snapshot feed, auto-refreshing (live stream coming in a later phase)
- **Temperature** — outdoor weather via Open-Meteo (no API key required); swappable for Nest, Ecobee, or Home Assistant
- **Clock** — always-on time and date display
- **PWA** — add to iPad home screen via Safari → Share → "Add to Home Screen" for a full-screen kiosk feel

## Architecture

```
Mac (server)  ──WebSocket──►  iPad (browser / PWA)
     │
     ├── Serves static web app (Express)
     ├── Polls Ring API for camera snapshots
     └── Fetches weather from Open-Meteo
```

The desktop runs the Node.js server, fetches all smart home data, and pushes updates to the iPad over WebSocket every 5 seconds. The iPad only talks to your Mac — no external connections.

## Setup

**1. Copy the config template**
```bash
cp config.json.example config.json
```

Edit `config.json` and set your `latitude` and `longitude` (used for outdoor temperature).

**2. Start the server**

Mac:
```bash
./start.sh
```

Windows:
```
start.bat
```

Both scripts install dependencies automatically on first run.

**3. Open on the iPad**

Navigate to the URL printed in the terminal (e.g. `http://192.168.1.x:3000`) in Safari.
To install as a home screen app: tap Share → "Add to Home Screen".

## Project structure

```
wall-assistant/
├── start.sh / start.bat     # one-click server start
├── config.json.example      # copy to config.json
├── server/
│   ├── index.js             # Express + WebSocket server
│   ├── ring.js              # Ring camera adapter
│   └── temperature.js       # Temperature adapter (Open-Meteo default)
└── client/
    ├── index.html           # 2×2 dashboard grid
    ├── css/main.css         # Spotify dark theme
    ├── js/main.js           # WebSocket client + clock
    ├── manifest.webmanifest # PWA manifest
    └── sw.js                # Service worker
```

## Next steps

See `TODO.md` for the full phased build plan. Phase 2 is Ring authentication.
