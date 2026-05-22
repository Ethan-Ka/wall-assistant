'use strict';

const path = require('path');
const fs   = require('fs');
const os   = require('os');

const HLS_BASE   = path.join(os.tmpdir(), 'wall-assistant-hls');
const RESTART_MS = 5000;

const sessionIds      = {};  // index → timestamp string while live, null while starting
const activeSessions  = {};  // index → StreamingSession
const inFlightStarts  = new Set(); // index is present while cam.streamVideo() is connecting
const manualStops     = new Set();
const pendingRestarts = {};  // index → setTimeout id

function camDir(index) {
  return path.join(HLS_BASE, `cam-${index}`);
}

function cleanDir(dir) {
  try {
    for (const f of fs.readdirSync(dir)) {
      if (/\.(ts|m3u8)$/.test(f)) {
        try { fs.unlinkSync(path.join(dir, f)); } catch (_) {}
      }
    }
  } catch (_) {}
}

async function startStream(cam, index) {
  // Idempotency: don't double-start a live or connecting session
  if (activeSessions[index] || inFlightStarts.has(index)) return;

  manualStops.delete(index);
  inFlightStarts.add(index);

  // Cancel any pending auto-restart so we don't spawn a second stream
  if (pendingRestarts[index]) {
    clearTimeout(pendingRestarts[index]);
    delete pendingRestarts[index];
  }

  const dir = camDir(index);
  fs.mkdirSync(dir, { recursive: true });
  cleanDir(dir);
  sessionIds[index] = null; // signal "connecting"

  try {
    const session = await cam.streamVideo({
      output: [
        '-c:v', 'copy',
        '-an',
        '-f', 'hls',
        '-hls_time', '2',
        '-hls_list_size', '4',
        '-hls_flags', 'delete_segments+append_list+omit_endlist',
        '-hls_segment_type', 'mpegts',
        '-hls_segment_filename', path.join(dir, 'seg%03d.ts'),
        path.join(dir, 'stream.m3u8'),
      ],
    });

    inFlightStarts.delete(index);

    // If stopStream was called while streamVideo was connecting, honour it now
    if (manualStops.has(index)) {
      manualStops.delete(index);
      try { session.stop(); } catch (_) {}
      delete activeSessions[index];
      sessionIds[index] = null;
      return;
    }

    activeSessions[index] = session;
    sessionIds[index] = String(Date.now());
    console.log(`[hls] cam ${index} (${cam.name}) started — session ${sessionIds[index]}`);

    session.onCallEnded.subscribe(() => {
      delete activeSessions[index];
      sessionIds[index] = null;
      console.log(`[hls] cam ${index} call ended`);
      if (!manualStops.has(index)) {
        // Auto-restart on unexpected drop (e.g., Ring closed the call)
        pendingRestarts[index] = setTimeout(() => {
          delete pendingRestarts[index];
          if (!manualStops.has(index)) startStream(cam, index);
        }, RESTART_MS);
      }
      manualStops.delete(index);
    });
  } catch (e) {
    inFlightStarts.delete(index);
    console.error(`[hls] cam ${index} failed to start: ${e.message}`);
    delete activeSessions[index];
    sessionIds[index] = null;
    if (!manualStops.has(index)) {
      pendingRestarts[index] = setTimeout(() => {
        delete pendingRestarts[index];
        if (!manualStops.has(index)) startStream(cam, index);
      }, RESTART_MS * 2);
    }
    manualStops.delete(index);
  }
}

function stopStream(index) {
  manualStops.add(index);

  if (pendingRestarts[index]) {
    clearTimeout(pendingRestarts[index]);
    delete pendingRestarts[index];
  }

  const session = activeSessions[index];
  if (session) {
    try { session.stop(); } catch (_) {}
    delete activeSessions[index];
  }

  sessionIds[index] = null;
  cleanDir(camDir(index));
  console.log(`[hls] cam ${index} stream stopped`);
}

function initHls() {
  fs.mkdirSync(HLS_BASE, { recursive: true });
}

function getHlsUrl(index) {
  const sid = sessionIds[index];
  if (!sid) return null;
  try {
    if (!fs.existsSync(path.join(camDir(index), 'stream.m3u8'))) return null;
  } catch (_) {
    return null;
  }
  return `/api/hls/${index}/stream.m3u8?s=${sid}`;
}

function getHlsDir(index) {
  return camDir(index);
}

module.exports = { initHls, startStream, stopStream, getHlsUrl, getHlsDir };
