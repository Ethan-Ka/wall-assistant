'use strict';

const path = require('path');
const fs = require('fs');
const { RingApi } = require('ring-client-api');

const CONFIG_PATH   = path.join(__dirname, '../config.json');
const CAMERAS_PATH  = path.join(__dirname, '../cameras.json');
const SNAPSHOT_CACHE_TTL = 30 * 1000;

const PLACEHOLDER_SNAPSHOT = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" role="img" aria-label="Camera unavailable"><rect width="640" height="360" fill="#121417"/><rect x="42" y="42" width="556" height="276" rx="24" fill="#1b2026" stroke="#2b323b" stroke-width="4"/><circle cx="320" cy="180" r="54" fill="none" stroke="#4b5563" stroke-width="10"/><path d="M275 180h90" stroke="#4b5563" stroke-width="10" stroke-linecap="round"/><path d="M320 135v90" stroke="#4b5563" stroke-width="10" stroke-linecap="round"/><text x="320" y="254" fill="#9ca3af" font-family="Arial, sans-serif" font-size="24" text-anchor="middle">Snapshot unavailable</text></svg>',
  'utf8'
);

let cameras = [];
let snapshotCache = {}; // cameraIndex → { buffer, lastUpdated, fetchedAt, pending }

function persistToken(token) {
  try {
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (_) {}
    if (!cfg.ring) cfg.ring = {};
    cfg.ring.refreshToken = token;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  } catch (e) {
    console.error('[ring] Failed to persist refreshToken:', e.message);
  }
}

async function initRing(config) {
  const token = config && config.ring && config.ring.refreshToken;
  if (!token) {
    console.log('[ring] No refreshToken in config — run `node server/ring-auth.js` to authenticate.');
    return;
  }

  const api = new RingApi({ refreshToken: token });

  // Rotate and persist whenever ring-client-api refreshes the OAuth token
  api.onRefreshTokenUpdated.subscribe(({ newRefreshToken }) => {
    persistToken(newRefreshToken);
  });

  try {
    cameras = await api.getCameras();
    console.log(`[ring] Found ${cameras.length} camera(s):`, cameras.map((c) => c.name).join(', '));
    const list = cameras.map((cam, index) => ({ index, id: cam.id, name: cam.name, kind: cam.deviceType }));
    fs.writeFileSync(CAMERAS_PATH, JSON.stringify(list, null, 2) + '\n', 'utf8');
    console.log(`[ring] Camera list written to cameras.json`);
  } catch (e) {
    console.error('[ring] Failed to fetch cameras:', e.message);
  }
}

async function getRingSnapshot(cameraIndex) {
  const cam = cameras[cameraIndex];
  const cached = snapshotCache[cameraIndex];

  const stub = {
    name: cam ? cam.name : `Camera ${cameraIndex}`,
    snapshotBuffer: null,
    lastUpdated: new Date().toISOString(),
  };

  if (!cam) return stub;

  if (cached && cached.buffer && Date.now() - cached.fetchedAt < SNAPSHOT_CACHE_TTL) {
    return {
      name: cam.name,
      snapshotBuffer: cached.buffer,
      lastUpdated: cached.lastUpdated,
    };
  }

  if (cached && cached.pending) {
    return cached.pending;
  }

  const pending = (async () => {
    try {
      const buffer = await cam.getSnapshot();
      const lastUpdated = new Date().toISOString();
      snapshotCache[cameraIndex] = {
        buffer,
        lastUpdated,
        fetchedAt: Date.now(),
        pending: null,
      };
      return {
        name: cam.name,
        snapshotBuffer: buffer,
        lastUpdated,
      };
    } catch (e) {
      const entry = snapshotCache[cameraIndex];
      if (entry && entry.buffer) {
        return {
          name: cam.name,
          snapshotBuffer: entry.buffer,
          lastUpdated: entry.lastUpdated,
        };
      }

      console.error(`[ring] Snapshot failed for camera ${cameraIndex}:`, e.message);
      return stub;
    } finally {
      const entry = snapshotCache[cameraIndex];
      if (entry && entry.pending === pending) {
        entry.pending = null;
      }
    }
  })();

  snapshotCache[cameraIndex] = {
    buffer: cached ? cached.buffer : null,
    lastUpdated: cached ? cached.lastUpdated : null,
    fetchedAt: cached ? cached.fetchedAt : 0,
    pending,
  };

  return pending;
}

function getCachedRingSnapshot(cameraIndex) {
  const cam = cameras[cameraIndex];
  const cached = snapshotCache[cameraIndex];
  const snapshotBuffer = (cached && cached.buffer) || PLACEHOLDER_SNAPSHOT;

  return {
    name: cam ? cam.name : `Camera ${cameraIndex}`,
    snapshotBuffer,
    isPlaceholder: !cached || !cached.buffer,
    lastUpdated: cached ? cached.lastUpdated : null,
  };
}

function getCameraList() {
  return cameras.map((cam, index) => ({
    index,
    id: cam.id,
    name: cam.name,
    kind: cam.deviceType,
  }));
}

function getCameras() {
  return cameras;
}

module.exports = { initRing, getRingSnapshot, getCachedRingSnapshot, getCameraList, getCameras };
