'use strict';

const path = require('path');
const fs = require('fs');
const { RingApi } = require('ring-client-api');

const CONFIG_PATH  = path.join(__dirname, '../config.json');
const CAMERAS_PATH = path.join(__dirname, '../cameras.json');

const SNAPSHOT_INTERVAL_MS     = 15 * 1000; // 15 seconds between scheduled pulls
const RECORDING_DELAY_MS       = 25 * 1000;       // wait for Ring to transcode the clip
const URL_TTL_MS               = 45 * 60 * 1000;  // refresh pre-signed URL before 1hr expiry
const LOW_BATTERY_THRESHOLD    = 15;              // suspend all camera requests below this %
const BATTERY_RESUME_THRESHOLD = 20;             // resume requests at or above this % (hysteresis)
let offlineRetryMs             = 30 * 60 * 1000; // retry offline cameras every 30 minutes (configurable)

const PLACEHOLDER_SNAPSHOT = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" role="img" aria-label="Camera unavailable"><rect width="640" height="360" fill="#121417"/><rect x="42" y="42" width="556" height="276" rx="24" fill="#1b2026" stroke="#2b323b" stroke-width="4"/><circle cx="320" cy="180" r="54" fill="none" stroke="#4b5563" stroke-width="10"/><path d="M275 180h90" stroke="#4b5563" stroke-width="10" stroke-linecap="round"/><path d="M320 135v90" stroke="#4b5563" stroke-width="10" stroke-linecap="round"/><text x="320" y="254" fill="#9ca3af" font-family="Arial, sans-serif" font-size="24" text-anchor="middle">Snapshot unavailable</text></svg>',
  'utf8'
);

let cameras = [];

// Per-camera snapshot cache (populated by scheduler, never fetched on-demand)
const snapshotBuffers   = {}; // index → Buffer
const snapshotTimestamp = {}; // index → ISO string of when Ring produced the frame
const snapshotDropped   = {}; // index → number of failed fetches since server start

// Per-camera battery state
const batteryLevels  = {}; // index → number (0-100) or null (wired/unknown)
const batteryLowFlag = {}; // index → true when suspended due to low battery

// Per-camera online/offline state
// onlineStatus: true = confirmed online, false = offline (backoff active), undefined = unknown (first attempt pending)
const onlineStatus   = {}; // index → true | false | undefined
const offlineRetryAt = {}; // index → ms timestamp after which next snapshot attempt is allowed

// Per-camera motion state
// { dingId, url, urlFetchedAt (ms), timestamp (ISO ding event time) }
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
  if (batteryLowFlag[index]) return; // suspended — avoid waking a low-battery camera

  if (onlineStatus[index] === false) {
    const now = Date.now();
    if (offlineRetryAt[index] && now < offlineRetryAt[index]) return;
    // Proactively advance the timer so concurrent interval ticks don't all pile in
    offlineRetryAt[index] = now + offlineRetryMs;
  }

  try {
    const requestedAt = new Date().toISOString();
    const buffer = await cam.getSnapshot();
    snapshotBuffers[index]   = buffer;
    snapshotTimestamp[index] = requestedAt;
    if (onlineStatus[index] !== true) {
      onlineStatus[index] = true;
      console.log(`[ring] Camera ${index} is online`);
    }
  } catch (e) {
    snapshotDropped[index] = (snapshotDropped[index] || 0) + 1;
    if (onlineStatus[index] !== false) {
      onlineStatus[index] = false;
      offlineRetryAt[index] = Date.now() + offlineRetryMs;
      console.warn(`[ring] Camera ${index} offline — snapshot suspended, retry in 30 min`);
    }
  }
}

function startSnapshotSchedule(cam, index) {
  doScheduledSnapshot(cam, index); // immediate first shot
  setInterval(() => doScheduledSnapshot(cam, index), SNAPSHOT_INTERVAL_MS);
}

function subscribeConnectivity(cam, index) {
  // Seed from the current push-cached value so the gate is active before the first snapshot
  onlineStatus[index] = !cam.isOffline;
  if (onlineStatus[index] === false) {
    offlineRetryAt[index] = Date.now() + offlineRetryMs;
    console.warn(`[ring] Camera ${index} starts offline — snapshot suspended, retry in 30 min`);
  }

  // Watch for Ring-pushed connectivity transitions. The subscription's only role is fast
  // recovery: when the camera comes back online it clears the backoff so the next scheduled
  // tick (or an immediate attempt) doesn't have to wait out the 30-min window.
  // doScheduledSnapshot remains the single authority that writes onlineStatus.
  let prevOffline = cam.isOffline;
  cam.onData.subscribe((data) => {
    const isNowOffline = data.alerts && data.alerts.connection === 'offline';
    if (isNowOffline === prevOffline) return;
    prevOffline = isNowOffline;

    if (!isNowOffline && onlineStatus[index] === false) {
      // Camera came back — clear the backoff and let the next snapshot attempt confirm it
      offlineRetryAt[index] = null;
      doScheduledSnapshot(cam, index);
    }
  });
}

function subscribeBattery(cam, index) {
  // onBatteryLevel emits null for wired cameras — skip threshold logic for those
  cam.onBatteryLevel.subscribe((level) => {
    batteryLevels[index] = level;
    if (level === null) return;

    if (!batteryLowFlag[index] && level < LOW_BATTERY_THRESHOLD) {
      batteryLowFlag[index] = true;
      console.warn(`[ring] Camera ${index} battery low (${level}%) — suspending snapshot & motion requests`);
    } else if (batteryLowFlag[index] && level >= BATTERY_RESUME_THRESHOLD) {
      batteryLowFlag[index] = false;
      console.log(`[ring] Camera ${index} battery recovered (${level}%) — resuming`);
      doScheduledSnapshot(cam, index); // immediate refresh now that camera is usable again
    }
  });
}

function subscribeMotion(cam, index) {
  cam.subscribeToMotionEvents().catch((e) => {
    console.warn(`[ring] subscribeToMotionEvents failed for cam ${index}: ${e.message}`);
  });

  cam.onNewNotification.subscribe((notification) => {
    if (batteryLowFlag[index]) return; // don't process motion on a low-battery camera
    if (notification.subtype !== 'motion' && notification.subtype !== 'human') return;
    const dingId = notification.ding && notification.ding.id;
    if (!dingId) return;
    console.log(`[ring] Motion on cam ${index} — ding ${dingId}`);

    const motionTimestamp =
      (notification.data && notification.data.event && notification.data.event.ding && notification.data.event.ding.created_at) ||
      (notification.ding && notification.ding.created_at) ||
      new Date().toISOString();

    // Ring needs time to transcode before the recording URL resolves
    setTimeout(async () => {
      if (batteryLowFlag[index]) return; // recheck — battery may have dipped during the delay
      const delays = [0, 15_000, 30_000]; // retry at +0s, +15s, +30s after initial wait
      for (const delay of delays) {
        if (delay) await new Promise(r => setTimeout(r, delay));
        if (batteryLowFlag[index]) return;
        try {
          const url = await cam.getRecordingUrl(String(dingId));
          motionClips[index] = {
            dingId:       String(dingId),
            url,
            urlFetchedAt: Date.now(),
            timestamp:    motionTimestamp,
          };
          console.log(`[ring] Motion clip ready for cam ${index}`);
          return;
        } catch (e) {
          if (delay === delays[delays.length - 1]) {
            console.error(`[ring] Failed to fetch recording for cam ${index} after retries: ${e.message}`);
          }
        }
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
      // Seed battery level from the current device snapshot so low-battery logic is
      // active from the very first snapshot attempt, before onBatteryLevel fires.
      batteryLevels[index] = cam.batteryLevel;
      if (batteryLevels[index] !== null && batteryLevels[index] < LOW_BATTERY_THRESHOLD) {
        batteryLowFlag[index] = true;
        console.warn(`[ring] Camera ${index} starts with low battery (${batteryLevels[index]}%) — requests suspended`);
      }

      subscribeConnectivity(cam, index); // must run before startSnapshotSchedule seeds the gate
      startSnapshotSchedule(cam, index);
      subscribeMotion(cam, index);
      subscribeBattery(cam, index);
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
    id:             cam.id,
    name:           cam.name,
    kind:           cam.deviceType,
    dropped:        snapshotDropped[index] || 0,
    battery:        batteryLevels[index] != null ? batteryLevels[index] : null,
    lowBattery:     batteryLowFlag[index] || false,
    online:         onlineStatus[index] !== false,
    offlineRetryAt: onlineStatus[index] === false ? (offlineRetryAt[index] || null) : null,
  }));
}

async function retryCamera(index) {
  const cam = cameras[index];
  if (!cam) return false;
  offlineRetryAt[index] = null; // clear backoff so doScheduledSnapshot proceeds immediately
  await doScheduledSnapshot(cam, index);
  return onlineStatus[index] !== false;
}

function getCameras() {
  return cameras;
}

function isCameraLowBattery(index) {
  return batteryLowFlag[index] || false;
}

function isCameraOnline(index) {
  return onlineStatus[index] !== false;
}

function getCameraBattery(index) {
  const level = batteryLevels[index];
  return level != null ? level : null;
}

// Returns true when there is a motion clip that postdates the most recent snapshot
// (mirrors the discard condition in getMotionClipUrl without async URL refresh).
function hasRecentMotionClip(index) {
  const clip = motionClips[index];
  if (!clip) return false;
  const snapTime = snapshotTimestamp[index];
  if (snapTime && new Date(clip.timestamp) <= new Date(snapTime)) return false;
  return true;
}

function setOfflineRetryMs(ms) {
  offlineRetryMs = ms;
}

function getOfflineRetryMs() {
  return offlineRetryMs;
}

// Returns the stable identity of the current active motion clip (dingId + timestamp),
// or null when no clip postdates the most recent snapshot. Used for server-side dedup
// without relying on the refreshing pre-signed S3 URL.
function getMotionClipInfo(cameraIndex) {
  const clip = motionClips[cameraIndex];
  if (!clip) return null;
  const snapTime = snapshotTimestamp[cameraIndex];
  if (snapTime && new Date(clip.timestamp) <= new Date(snapTime)) return null;
  return { dingId: clip.dingId, timestamp: clip.timestamp };
}

function getLastMotionEvents() {
  return cameras.map((cam, index) => {
    const clip = motionClips[index];
    const snapTime = snapshotTimestamp[index];
    const active = clip
      ? !snapTime || new Date(clip.timestamp) > new Date(snapTime)
      : false;
    return {
      index,
      name:      cam.name,
      timestamp: clip ? clip.timestamp : null,
      dingId:    clip ? clip.dingId : null,
      active,
    };
  });
}

module.exports = {
  initRing,
  getRingSnapshot,
  getMotionClipUrl,
  getMotionClipInfo,
  getCameraList,
  getCameras,
  isCameraLowBattery,
  isCameraOnline,
  getCameraBattery,
  hasRecentMotionClip,
  getLastMotionEvents,
  takeSnapshot: doScheduledSnapshot,
  retryCamera,
  setOfflineRetryMs,
  getOfflineRetryMs,
};
