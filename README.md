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

## Setup

### 1. Copy the config template

```bash
cp config.json.example config.json
```

Edit `config.json` with your values. Here is a full example showing all supported keys:

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
  "spotify": {
    "clientId": "YOUR_SPOTIFY_CLIENT_ID",
    "clientSecret": "YOUR_SPOTIFY_CLIENT_SECRET",
    "accessToken": "",
    "refreshToken": ""
  }
}
```

| Key | Description |
|-----|-------------|
| `latitude` / `longitude` | Used for the outdoor temperature widget (Open-Meteo) |
| `ring.refreshToken` | Filled in automatically by the Ring auth CLI (step 3) |
| `ecobee.apiKey` | Your Ecobee developer app key (step 2); omit the whole block to skip indoor temp |
| `ecobee.accessToken` / `ecobee.refreshToken` | Filled in automatically by `ecobee-auth.js` |
| `spotify.clientId` / `spotify.clientSecret` | Your Spotify developer app credentials (step 4); omit to skip Now Playing |
| `spotify.accessToken` / `spotify.refreshToken` | Filled in automatically by `spotify-auth.js` |

`config.json` is gitignored and never committed.

---

### 2. Configure the layout

Open `http://localhost:3000/admin` in a browser after starting the server. The Layout Editor lets you:

- Set the grid size (rows × columns)
- Set relative column widths and row heights (e.g. `2, 1` → the left column is twice as wide)
- Click any cell to assign a widget type and configure it
- Drag cells to swap positions
- Set ColSpan / RowSpan to make a widget span multiple cells

Click **Save Layout** when done. The dashboard reloads automatically.

---

### 3. Authenticate with Ecobee (optional, one-time)

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

```bash
node server/ecobee-auth.js
```

It will print a 4-character PIN. Open the Ecobee web portal or mobile app, go to **My Apps → Add Application**, enter the PIN, and click **Authorize**. Then press Enter back in the terminal. The access and refresh tokens are written to `config.json` automatically.

**Token rotation:** Ecobee access tokens expire after 1 hour. The server refreshes them proactively and persists the new tokens without any manual intervention.

---

### 4. Authenticate with Ring (optional, one-time)

Ring uses OAuth with a long-lived refresh token. Run the auth CLI once to obtain it:

```bash
node server/ring-auth.js
```

It will prompt for:
1. Your Ring account email
2. Your Ring account password
3. A 2FA code (Ring will text or email it to you)

On success, the refresh token is written directly into `config.json`. You don't need to run this again unless you revoke access or change your Ring password.

**Token rotation:** Ring rotates the refresh token on every OAuth call. The server automatically writes the new token back to `config.json` whenever it refreshes.

---

### 5. Authenticate with Spotify (optional, one-time)

Skip this step if you don't want the Now Playing widget.

**Part A — Create a Spotify developer app (~2 min):**

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Click **Create App**
3. Fill in any name and description
4. Set **Redirect URI** to `http://127.0.0.1:8888/callback`
5. Click **Save** — your Client ID and Client Secret appear on the app page
6. Copy both into `config.json` under `spotify.clientId` and `spotify.clientSecret`

**Part B — Authorize the app against your Spotify account:**

```bash
node server/spotify-auth.js
```

This opens a browser window asking you to log in to Spotify and grant access. After authorizing, the tokens are written to `config.json` automatically.

**Token rotation:** Spotify access tokens expire after 1 hour. The server refreshes them automatically and saves the new tokens without any manual intervention.

---

### 6. Start the server

Mac / Linux:
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

If a service (Ring, Ecobee, Spotify) is not yet authenticated, the server still starts — those widgets will show placeholder values until auth is complete.

---

### 7. Open on the iPad

Navigate to the URL printed in the terminal (e.g. `http://192.168.1.x:3000`) in Safari.

To install as a home screen app: tap **Share → "Add to Home Screen"** — this gives a full-screen kiosk experience with no browser chrome.

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
