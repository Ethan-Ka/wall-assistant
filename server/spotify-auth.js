#!/usr/bin/env node
'use strict';

// One-time OAuth flow for Spotify. Run with: node server/spotify-auth.js
// Requires config.json to have:  { "spotify": { "clientId": "...", "clientSecret": "..." } }

const fs    = require('fs');
const http  = require('http');
const path  = require('path');
const fetch = require('node-fetch');

const CONFIG_PATH   = path.join(__dirname, '../config.json');
const REDIRECT_PORT = process.env.SPOTIFY_REDIRECT_PORT ? parseInt(process.env.SPOTIFY_REDIRECT_PORT, 10) : 8888;
const REDIRECT_URI  = process.env.SPOTIFY_REDIRECT_URI || `http://127.0.0.1:${REDIRECT_PORT}/callback`;
const SCOPE         = 'user-read-currently-playing user-read-playback-state';

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (_) { return {}; }
}

function saveConfig(cfg) {
  const tmp = CONFIG_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
  fs.renameSync(tmp, CONFIG_PATH);
}

async function main() {
  const config = loadConfig();
  const sp = config.spotify;
  if (!sp || !sp.clientId || !sp.clientSecret) {
    console.error(
      '\nAdd to config.json first:\n' +
      '  "spotify": { "clientId": "YOUR_APP_ID", "clientSecret": "YOUR_APP_SECRET" }\n' +
      '\nCreate an app at https://developer.spotify.com/dashboard and set the redirect URI:\n' +
      '  ' + REDIRECT_URI + '\n'
    );
    process.exit(1);
  }

  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     sp.clientId,
    scope:         SCOPE,
    redirect_uri:  REDIRECT_URI,
  });
  const authUrl = 'https://accounts.spotify.com/authorize?' + params;

  console.log('\nOpen this URL in your browser:\n');
  console.log(authUrl);
  console.log('\nWaiting for redirect on ' + REDIRECT_URI + '...\n');

  await new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const url   = new URL(req.url, REDIRECT_URI);
        const code  = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (error) {
          res.end('<h2>Auth denied: ' + error + '</h2>');
          server.close();
          reject(new Error('Auth denied: ' + error));
          return;
        }

        if (!code) { res.writeHead(400); res.end('Missing code.'); return; }

        const creds = Buffer.from(sp.clientId + ':' + sp.clientSecret).toString('base64');
        const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
          method:  'POST',
          headers: { 'Authorization': 'Basic ' + creds, 'Content-Type': 'application/x-www-form-urlencoded' },
          body:    new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI }),
        });
        const json = await tokenRes.json();

        if (!json.access_token) {
          res.end('<h2>Token exchange failed</h2><pre>' + JSON.stringify(json, null, 2) + '</pre>');
          server.close();
          reject(new Error('Token exchange failed'));
          return;
        }

        config.spotify.accessToken  = json.access_token;
        config.spotify.refreshToken = json.refresh_token;
        saveConfig(config);

        res.end('<h2>Authorized! You can close this tab and return to the terminal.</h2>');
        server.close();
        console.log('Spotify tokens saved to config.json.\n');
        resolve();
      } catch (e) {
        res.end('<h2>Error: ' + e.message + '</h2>');
        server.close();
        reject(e);
      }
    });

    server.listen(REDIRECT_PORT, '127.0.0.1');
  });
}

main().catch((e) => { console.error(e.message); process.exit(1); });
