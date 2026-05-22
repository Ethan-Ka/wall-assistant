'use strict';

const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');

const CONFIG_PATH = path.join(__dirname, '../config.json');
const BASE = 'https://api.ecobee.com';
// Safety margin: refresh 60s before actual expiry
const EXPIRY_MARGIN = 60 * 1000;

let state = {
  apiKey: null,
  accessToken: null,
  refreshToken: null,
  expiresAt: 0,
};

// Cached indoor reading (Ecobee updates ~every 3 min; we poll every 60s)
const CACHE_TTL = 60 * 1000;
let cache = { data: null, ts: 0 };

function persistTokens({ accessToken, refreshToken, expiresIn }) {
  try {
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (_) {}
    if (!cfg.ecobee) cfg.ecobee = {};
    cfg.ecobee.accessToken = accessToken;
    cfg.ecobee.refreshToken = refreshToken;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  } catch (e) {
    console.error('[ecobee] Failed to persist tokens:', e.message);
  }
  state.accessToken = accessToken;
  state.refreshToken = refreshToken;
  state.expiresAt = Date.now() + (expiresIn || 3600) * 1000 - EXPIRY_MARGIN;
}

async function refreshAccessToken() {
  const res = await fetch(
    `${BASE}/token?grant_type=refresh_token&refresh_token=${encodeURIComponent(state.refreshToken)}&client_id=${encodeURIComponent(state.apiKey)}`,
    { method: 'POST' }
  );
  if (!res.ok) throw new Error(`Token refresh HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error_description || json.error);
  persistTokens({
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresIn: json.expires_in,
  });
}

async function ensureFreshToken() {
  if (!state.accessToken) throw new Error('No Ecobee access token — run `node server/ecobee-auth.js`');
  if (Date.now() >= state.expiresAt) {
    await refreshAccessToken();
  }
}

function initEcobee(config) {
  const ec = config && config.ecobee;
  if (!ec || !ec.apiKey) return;
  state.apiKey = ec.apiKey;
  state.accessToken = ec.accessToken || null;
  state.refreshToken = ec.refreshToken || null;
  // Treat token as expired until we know otherwise; first fetch will refresh
  state.expiresAt = ec.accessToken ? Date.now() + 3600 * 1000 - EXPIRY_MARGIN : 0;

  if (!state.accessToken) {
    console.log('[ecobee] No access token — run `node server/ecobee-auth.js` to authenticate.');
  } else {
    console.log('[ecobee] Initialized with API key and tokens.');
  }
}

async function getEcobeeTemperature() {
  if (!state.apiKey) return null;

  if (cache.data && Date.now() - cache.ts < CACHE_TTL) {
    return cache.data;
  }

  try {
    await ensureFreshToken();

    const selection = JSON.stringify({
      selection: { selectionType: 'registered', selectionMatch: '', includeRuntime: true },
    });
    const res = await fetch(
      `${BASE}/1/thermostat?json=${encodeURIComponent(selection)}`,
      { headers: { Authorization: `Bearer ${state.accessToken}` } }
    );
    if (!res.ok) throw new Error(`Thermostat HTTP ${res.status}`);
    const json = await res.json();

    const t = json.thermostatList && json.thermostatList[0];
    if (!t) throw new Error('No thermostats returned');

    // actualTemperature is tenths of °F (e.g. 720 = 72.0°F)
    const fahrenheit = t.runtime.actualTemperature / 10;
    const celsius = Math.round(((fahrenheit - 32) * 5) / 9 * 10) / 10;
    const result = {
      fahrenheit: Math.round(fahrenheit * 10) / 10,
      celsius,
      humidity: t.runtime.actualHumidity,
      name: t.name,
      source: 'ecobee',
    };
    cache = { data: result, ts: Date.now() };
    return result;
  } catch (e) {
    console.error('[ecobee] Temperature fetch failed:', e.message);
    return cache.data || null;
  }
}

module.exports = { initEcobee, getEcobeeTemperature };
