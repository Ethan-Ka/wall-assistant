'use strict';

const path = require('path');
const fs = require('fs');
const { RingApi } = require('ring-client-api');

const CONFIG_PATH = path.join(__dirname, '../config.json');

let cameras = [];
let lastBuffers = {};  // cameraIndex → last-good JPEG Buffer

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
  } catch (e) {
    console.error('[ring] Failed to fetch cameras:', e.message);
  }
}

async function getRingSnapshot(cameraIndex) {
  const cam = cameras[cameraIndex];

  const stub = {
    name: cam ? cam.name : `Camera ${cameraIndex}`,
    snapshotBuffer: null,
    lastUpdated: new Date().toISOString(),
  };

  if (!cam) return stub;

  try {
    const buffer = await cam.getSnapshot();
    lastBuffers[cameraIndex] = buffer;
    stub.snapshotBuffer = buffer;
    stub.lastUpdated = new Date().toISOString();
  } catch (e) {
    // Return the last known-good frame rather than a broken tile
    if (lastBuffers[cameraIndex]) {
      stub.snapshotBuffer = lastBuffers[cameraIndex];
    } else {
      console.error(`[ring] Snapshot failed for camera ${cameraIndex}:`, e.message);
    }
  }

  return stub;
}

function getCameraList() {
  return cameras.map((cam, index) => ({
    index,
    id: cam.id,
    name: cam.name,
    kind: cam.deviceType,
  }));
}

module.exports = { initRing, getRingSnapshot, getCameraList };
