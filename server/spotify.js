'use strict';

const fetch = require('node-fetch');
const fs    = require('fs');
const path  = require('path');

const CONFIG_PATH = path.join(__dirname, '../config.json');
const CACHE_TTL   = 15 * 1000;

let cache = { data: null, ts: 0 };
let inFlight = null;

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (_) { return {}; }
}

function saveConfig(cfg) {
  const tmp = CONFIG_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
  fs.renameSync(tmp, CONFIG_PATH);
}

async function refreshAccessToken(cfg) {
  const sp = cfg.spotify;
  if (!sp || !sp.clientId || !sp.clientSecret || !sp.refreshToken) return false;
  const creds = Buffer.from(sp.clientId + ':' + sp.clientSecret).toString('base64');
  try {
    const res  = await fetch('https://accounts.spotify.com/api/token', {
      method:  'POST',
      headers: { 'Authorization': 'Basic ' + creds, 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    'grant_type=refresh_token&refresh_token=' + encodeURIComponent(sp.refreshToken),
      timeout: 8000,
    });
    const json = await res.json();
    if (!json.access_token) return false;
    cfg.spotify.accessToken = json.access_token;
    if (json.refresh_token) cfg.spotify.refreshToken = json.refresh_token;
    saveConfig(cfg);
    return true;
  } catch (_) {
    return false;
  }
}

function simplifyDevice(device) {
  if (!device) return null;
  return {
    id: device.id || null,
    name: device.name || null,
    type: device.type || null,
    volumePercent: device.volume_percent != null ? device.volume_percent : null,
    isActive: !!device.is_active,
    isRestricted: !!device.is_restricted,
    isPrivateSession: !!device.is_private_session,
  };
}

function simplifyContext(context) {
  if (!context) return null;
  return {
    type: context.type || null,
    uri: context.uri || null,
    href: context.href || null,
    externalUrl: context.external_urls && context.external_urls.spotify || null,
  };
}

function buildPlaybackData(json) {
  if (!json) return null;

  const item = json.item || null;
  const images = item && item.album && item.album.images || [];
  const albumArt = (images[1] || images[0] || {}).url || null;
  const artists = item && item.artists ? item.artists.map((artist) => artist.name).join(', ') : '';

  return {
    playing: !!json.is_playing,
    client: simplifyDevice(json.device),
    context: simplifyContext(json.context),
    track: item ? item.name : null,
    artist: artists,
    album: item && item.album ? item.album.name : null,
    albumArt,
    progressMs: json.progress_ms != null ? json.progress_ms : null,
    durationMs: item && item.duration_ms != null ? item.duration_ms : null,
    itemType: item && item.type || null,
    itemUri: item && item.uri || null,
    itemId: item && item.id || null,
    explicit: item ? !!item.explicit : false,
    shuffleState: json.shuffle_state != null ? !!json.shuffle_state : null,
    repeatState: json.repeat_state || null,
    currentlyPlayingType: json.currently_playing_type || null,
    timestamp: json.timestamp || null,
    stale: false,
  };
}

async function requestPlayback(token) {
  const endpoints = [
    'https://api.spotify.com/v1/me/player',
    'https://api.spotify.com/v1/me/player/currently-playing',
  ];

  for (const endpoint of endpoints) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let res;
      try {
        res = await fetch(endpoint, {
          headers: { 'Authorization': 'Bearer ' + token },
          timeout: 8000,
        });
      } catch (_) {
        if (attempt === 0) continue;
        break;
      }

      if (res.status === 204) {
        return { playing: false, client: null, context: null, stale: false };
      }

      if (res.status === 401) {
        return { authExpired: true };
      }

      if (res.status === 429 || res.status >= 500) {
        if (attempt === 0) {
          const retryAfter = parseFloat(res.headers.get('retry-after'));
          const waitMs = Number.isFinite(retryAfter) ? Math.max(250, retryAfter * 1000) : 500;
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          continue;
        }
      }

      if (!res.ok) break;

      const json = await res.json().catch(() => null);
      const data = buildPlaybackData(json);
      if (data) return data;
      break;
    }
  }

  return null;
}

async function getNowPlaying() {
  if (cache.data !== null && Date.now() - cache.ts < CACHE_TTL) return cache.data;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    let cfg = loadConfig();
    const sp = cfg && cfg.spotify;
    if (!sp || !sp.accessToken) return cache.data;

    let data = await requestPlayback(sp.accessToken);
    if (data && data.authExpired) {
      cfg = loadConfig();
      const ok = await refreshAccessToken(cfg);
      if (!ok) return cache.data;
      data = await requestPlayback(cfg.spotify.accessToken);
    }

    if (!data) return cache.data;
    if (data.authExpired) return cache.data;

    cache = { data, ts: Date.now() };
    return data;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

module.exports = { getNowPlaying };
