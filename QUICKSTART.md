# Quick Start

## Prerequisites

- **Node.js 18+** — [nodejs.org](https://nodejs.org)
- A Mac, PC, or Linux machine on the same WiFi network as your iPad

---

## 1. Copy and edit the config

```bash
cp config.json.example config.json
```

Open `config.json` and set your location:

```json
{
  "latitude": 37.7749,
  "longitude": -122.4194
}
```

That's all that's required to start. The optional service blocks (`ring`, `ecobee`, `spotify`) can be filled in later.

---

## 2. Start the server

**Mac / Linux:**
```bash
./start.sh
```

**Windows:**
```
start.bat
```

Both scripts install dependencies automatically on first run. To run manually instead:

```bash
cd server
npm install
node index.js
```

The server starts at `http://localhost:3000`. The terminal also prints your local network IP — use that address on the iPad.

---

## 3. Open the dashboard

Navigate to `http://<your-mac-ip>:3000` in Safari on the iPad.

To install as a full-screen app: tap **Share → Add to Home Screen**.

---

## 4. Configure the layout

Go to `http://localhost:3000/admin` to open the Layout Editor. Set the grid size, assign widgets to cells, and click **Save Layout**. The dashboard reloads automatically.

---

## Optional: authenticate third-party services

These can be done in any order, at any time. The server runs fine without them — unauthenticated widgets show placeholder values.

### Ring cameras

```bash
node server/ring-auth.js
```

Prompts for your Ring email, password, and a 2FA code. Writes the refresh token to `config.json` automatically.

### Ecobee thermostat

1. Create a developer app at [ecobee.com](https://www.ecobee.com) → your name → **Developer → Create New**. Set Authorization Method to `ecobeePin`. Copy the API key into `config.json` under `ecobee.apiKey`.

2. Run the auth flow:
   ```bash
   node server/ecobee-auth.js
   ```
   Enter the printed PIN in the Ecobee portal (**My Apps → Add Application**), then press Enter. Tokens are written to `config.json` automatically.

### Spotify Now Playing

1. Create an app at the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard). Set the Redirect URI to `http://127.0.0.1:8888/callback`. Copy the Client ID and Client Secret into `config.json`.

2. Run the auth flow:
   ```bash
   node server/spotify-auth.js
   ```
   A browser window opens — log in and grant access. Tokens are written to `config.json` automatically.

---

All three services auto-refresh their tokens while the server is running. You only need to re-run an auth script if you revoke access or change your account password.
