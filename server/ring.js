'use strict';

const path = require('path');
const fs = require('fs');
const { RingApi } = require('ring-client-api');

const CONFIG_PATH  = path.join(__dirname, '../config.json');
const CAMERAS_PATH = path.join(__dirname, '../cameras.json');

const SNAPSHOT_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes between scheduled pulls
const RECORDING_DELAY_MS   = 25 * 1000;       // wait for Ring to transcode the clip
const URL_TTL_MS           = 45 * 60 * 1000;  // refresh pre-signed URL before 1hr expiry

const PLACEHOLDER_SNAPSHOT = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" role="img" aria-label="Camera unavailable"><rect width="640" height="360" fill="#121417"/><rect x="42" y="42" width="556" height="276" rx="24" fill="#1b2026" stroke="#2b323b" stroke-width="4"/><circle cx="320" cy="180" r="54" fill="none" stroke="#4b5563" stroke-width="10"/><path d="M275 180h90" stroke="#4b5563" stroke-width="10" stroke-linecap="round"/><path d="M320 135v90" stroke="#4b5563" stroke-width="10" stroke-linecap="round"/><text x="320" y="254" fill="#9ca3af" font-family="Arial, sans-serif" font-size="24" text-anchor="middle">Snapshot unavailable</text></svg>',
  'utf8'
);

let cameras = [];

// Per-camera snapshot cache (populated by 30-min scheduler, never fetched on-demand)
const snapshotBuffers   = {}; // index → Buffer
const snapshotTimestamp = {}; // index → ISO string of when Ring produced the frame
const snapshotDropped   = {}; // index → number of failed fetches since server start

// Per-camera motion state
// { dingId, url, urlFetchedAt (ms), timestamp (ISO) }
const motionClips = {};

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

async function doScheduledSnapshot(cam, index) {
  try {
    const buffer = await cam.getSnapshot();
    snapshotBuffers[index]   = buffer;
    snapshotTimestamp[index] = new Date().toISOString();
    console.log(`[ring] Scheduled snapshot OK — cam ${index} (${cam.name})`);
  } catch (e) {
    snapshotDropped[index] = (snapshotDropped[index] || 0) + 1;
  }
}

function startSnapshotSchedule(cam, index) {
  doScheduledSnapshot(cam, index); // immediate first shot
  setInterval(() => doScheduledSnapshot(cam, index), SNAPSHOT_INTERVAL_MS);
}

function subscribeMotion(cam, index) {
  cam.subscribeToMotionEvents().catch((e) => {
    console.warn(`[ring] subscribeToMotionEvents failed for cam ${index}: ${e.message}`);
  });

  cam.onNewNotification.subscribe((notification) => {
    if (notification.subtype !== 'motion' && notification.subtype !== 'human') return;
    const dingId = notification.ding && notification.ding.id;
    if (!dingId) return;
    console.log(`[ring] Motion on cam ${index} — ding ${dingId}`);

    // Ring needs time to transcode before the recording URL resolves
    setTimeout(async () => {
      try {
        const url = await cam.getRecordingUrl(String(dingId));
        motionClips[index] = {
          dingId:       String(dingId),
          url,
          urlFetchedAt: Date.now(),
          timestamp:    new Date().toISOString(),
        };
        console.log(`[ring] Motion clip ready for cam ${index}`);
      } catch (e) {
        console.error(`[ring] Failed to fetch recording for cam ${index}: ${e.message}`);
      }
    }, RECORDING_DELAY_MS);
  });
}

async function initRing(config) {
  const token = config && config.ring && config.ring.refreshToken;
  if (!token) {
    console.log('[ring] No refreshToken in config — run `node server/ring-auth.js` to authenticate.');
    return;
  }

  const api = new RingApi({ refreshToken: token });

  api.onRefreshTokenUpdated.subscribe(({ newRefreshToken }) => {
    persistToken(newRefreshToken);
  });

  try {
    cameras = await api.getCameras();
    console.log(`[ring] Found ${cameras.length} camera(s):`, cameras.map((c) => c.name).join(', '));
    const list = cameras.map((cam, index) => ({ index, id: cam.id, name: cam.name, kind: cam.deviceType }));
    fs.writeFileSync(CAMERAS_PATH, JSON.stringify(list, null, 2) + '\n', 'utf8');

    cameras.forEach((cam, index) => {
      startSnapshotSchedule(cam, index);
      subscribeMotion(cam, index);
    });
  } catch (e) {
    console.error('[ring] Failed to fetch cameras:', e.message);
  }
}

// Sync — reads from cache only; never wakes the camera
function getRingSnapshot(cameraIndex) {
  const cam = cameras[cameraIndex];
  return {
    name:           cam ? cam.name : `Camera ${cameraIndex}`,
    snapshotBuffer: snapshotBuffers[cameraIndex] || PLACEHOLDER_SNAPSHOT,
    isPlaceholder:  !snapshotBuffers[cameraIndex],
    lastUpdated:    snapshotTimestamp[cameraIndex] || null,
  };
}

// Returns the motion clip URL only when motion has occurred since the last snapshot.
// Transparently refreshes the pre-signed S3 URL before the 1-hr expiry.
async function getMotionClipUrl(cameraIndex) {
  const clip = motionClips[cameraIndex];
  if (!clip) return null;

  // Discard if this clip predates the most recent scheduled snapshot
  const snapTime = snapshotTimestamp[cameraIndex];
  if (snapTime && new Date(clip.timestamp) <= new Date(snapTime)) return null;

  // Refresh the URL when it's approaching expiry
  if (Date.now() - clip.urlFetchedAt > URL_TTL_MS) {
    const cam = cameras[cameraIndex];
    if (cam) {
      try {
        clip.url          = await cam.getRecordingUrl(clip.dingId);
        clip.urlFetchedAt = Date.now();
      } catch (e) {
        console.error(`[ring] Failed to refresh clip URL for cam ${cameraIndex}: ${e.message}`);
        return null;
      }
    }
  }

  return clip.url;
}

function getCameraList() {
  return cameras.map((cam, index) => ({
    index,
    id:      cam.id,
    name:    cam.name,
    kind:    cam.deviceType,
    dropped: snapshotDropped[index] || 0,
  }));
}

function getCameras() {
  return cameras;
}

module.exports = { initRing, getRingSnapshot, getMotionClipUrl, getCameraList, getCameras };
