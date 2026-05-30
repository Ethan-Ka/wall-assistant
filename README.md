# wall-assistant

A local smart home dashboard for a wall-mounted iPad. Spotify-dark aesthetic. No cloud, no deployment — runs entirely on your home WiFi.

## What it does

| Widget | Data source |
|--------|-------------|
| **Ring cameras** | Snapshot feed, auto-refreshing every 5 s |
| **Temperature** | Outdoor via Open-Meteo; Ecobee indoor temp shown as primary when configured |
| **Clock** | Always-on time and date; configurable 12/24h and seconds |
| **Stocks** | Up to 10 tickers with sparklines via Stooq (no API key needed) |
| **News** | Any RSS feed; defaults to BBC World News |
| **Sports scores** | Live + final scores via the ESPN unofficial API (any sport/league) |
| **ISS tracker** | Real-time ISS position, altitude, speed, and overhead flights via OpenSky |
| **Now Playing** | Spotify currently-playing track with album art and progress bar |

The **Layout Editor** (`/admin`) lets you arrange any combination of these widgets into a custom grid with configurable column widths and row heights.

## Architecture

```
Mac (server)  ──WebSocket──►  iPad (browser / PWA)
     │
     ├── Serves static web app (Express)
     ├── GET /api/snapshot/:index  ← JPEG proxy for Ring snapshots
     ├── Polls Ring API for camera snapshots (every 5 s)
     ├── Fetches weather from Open-Meteo
     ├── Fetches stock data from Stooq
     ├── Parses RSS headlines
     ├── Fetches ISS position + OpenSky flight data
     ├── Fetches ESPN scoreboard data
     └── Polls Spotify currently-playing endpoint
```

The Mac runs the Node.js server, fetches all smart home data, and pushes updates to the iPad over WebSocket every 5 seconds. The iPad only talks to your Mac — no direct external connections.

---

## Quick Start

### 1. Copy and edit the config

```bash
cp config.json.example config.json
```

Open `config.json` and set your location — that's the only required field:

```json
{
  "latitude": 37.7749,
  "longitude": -122.4194
}
```

The optional service blocks (`ring`, `ecobee`, `spotify`) can be filled in later.

---

### 2. Start the server

**Mac / Linux:**
```bash
./start.sh
```

**Windows:**
```
start.bat
```

Both scripts install dependencies automatically on first run. To run manually:

```bash
cd server
npm install
node index.js
```

The server starts at `http://localhost:3000`. The terminal also prints your local network IP — use that address on the iPad.

---

### 3. Open the dashboard

Navigate to `http://<your-mac-ip>:3000` in Safari on the iPad.

To install as a full-screen app: tap **Share → Add to Home Screen**.

---

### 4. Configure the layout

Go to `http://localhost:3000/admin` to open the Layout Editor. Set the grid size, assign widgets to cells, and click **Save Layout**. The dashboard reloads automatically.

---

### Optional: authenticate third-party services

These can be done in any order, at any time. The server runs fine without them — unauthenticated widgets show placeholder values.

**Ring cameras:**
```bash
node server/ring-auth.js
```
Prompts for your Ring email, password, and a 2FA code. Writes the refresh token to `config.json` automatically.

**Ecobee thermostat:**
1. Create a developer app at [ecobee.com](https://www.ecobee.com) → your name → **Developer → Create New**. Set Authorization Method to `ecobeePin`. Copy the API key into `config.json` under `ecobee.apiKey`.
2. Run `node server/ecobee-auth.js` — enter the printed PIN in the Ecobee portal (**My Apps → Add Application**), then press Enter.

**Spotify Now Playing:**
1. Create an app at the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard). Set the Redirect URI to `http://127.0.0.1:8888/callback`. Copy the Client ID and Secret into `config.json`.
2. Run `node server/spotify-auth.js` — a browser window opens for you to authorize access.

All three services auto-refresh their tokens while the server is running. You only need to re-run an auth script if you revoke access or change your account password.

---

## Admin CLI (optional)

The server exposes a small CLI for runtime toggles. Run these commands while the server is running:

```bash
node server/admin-cli.js status
node server/admin-cli.js lockdown toggle
node server/admin-cli.js lockdown window 22:00 06:00
node server/admin-cli.js update-interval 5000
```

Run `node server/admin-cli.js help` for the full list of commands.

---

## Widget reference

### Stocks
- **Symbols** — comma-separated tickers, e.g. `AAPL, NVDA, ^DJI, ^SPX`. Plain tickers are treated as US equities; index tickers start with `^`. No API key required.
- **Title** — header label shown above the grid (default: "Markets")

### News
- **Feed URL** — any RSS feed URL (default: BBC World News). The server fetches and parses it on the server side, so CORS is not a concern.
- **Title** — header label (default: "Top Headlines")

### Sports
- **Sport** — ESPN sport slug, e.g. `football`, `basketball`, `baseball`, `hockey`, `soccer`
- **League** — ESPN league slug, e.g. `nfl`, `nba`, `mlb`, `nhl`, `eng.1`
- **Team** — filter to a specific team abbreviation (e.g. `KC`, `LAL`); leave blank to show the first game ESPN returns

### ISS Tracker
- **Radius (km)** — radius around your location used to query OpenSky for overhead flights (default: 200 km)
- **Show Flights** — toggle the overhead flights section on/off

### Now Playing
No configuration required. Uses the Spotify account authorized in step 5.

### Temperature
- **Units** — `F` (Fahrenheit) or `C` (Celsius)

### Clock
- **Format** — `12` or `24` hour
- **Show Seconds** — toggle seconds display

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
├── config.json.example          # copy to config.json, fill in values
├── server/
│   ├── index.js                 # Express + WebSocket server, payload builder
│   ├── ring.js                  # Ring adapter: auth, snapshot cache
│   ├── ring-auth.js             # One-time CLI: Ring OAuth token
│   ├── ecobee.js                # Ecobee adapter: token refresh, indoor temp
│   ├── ecobee-auth.js           # One-time CLI: Ecobee PIN flow
│   ├── temperature.js           # Combines Open-Meteo (outdoor) + Ecobee (indoor)
│   ├── stocks.js                # Stooq CSV fetcher, sparkline data, per-key cache
│   ├── news.js                  # RSS parser, per-URL cache
│   ├── sports.js                # ESPN unofficial scoreboard API
│   ├── iss.js                   # ISS position (wheretheiss.at) + OpenSky flights
│   ├── spotify.js               # Spotify currently-playing, auto token refresh
│   └── spotify-auth.js          # One-time CLI: Spotify Authorization Code flow
└── client/
    ├── index.html               # Dashboard shell
    ├── admin.html               # Layout editor
    ├── css/
    │   ├── main.css             # Widget styles (Spotify dark theme)
    │   └── admin.css            # Layout editor styles
    ├── js/
    │   ├── main.js              # WebSocket client, widget renderers
    │   └── admin.js             # Grid editor, config panel, drag-and-drop
    ├── manifest.webmanifest     # PWA manifest
    └── sw.js                    # Service worker
```
