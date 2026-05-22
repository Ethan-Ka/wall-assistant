'use strict';

const path = require('path');
const fs   = require('fs');
const os   = require('os');

const HLS_BASE   = path.join(os.tmpdir(), 'wall-assistant-hls');
const RESTART_MS = 5000;

// Per-camera state
const sessionIds = {};   // index → string timestamp while live, null while starting
const hlsCamSet  = new Set();

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
  const dir = camDir(index);
  fs.mkdirSync(dir, { recursive: true });
  cleanDir(dir);
  sessionIds[index] = null;

  try {
    const session = await cam.streamVideo({
      output: [
        '-c:v', 'copy',   // remux H.264 directly — no re-encode
        '-an',            // no audio (wall display, saves CPU and avoids AAC transcode)
        '-f', 'hls',
        '-hls_time', '2',
        '-hls_list_size', '4',
        '-hls_flags', 'delete_segments+append_list+omit_endlist',
        '-hls_segment_type', 'mpegts',
        '-hls_segment_filename', path.join(dir, 'seg%03d.ts'),
        path.join(dir, 'stream.m3u8'),
      ],
    });

    // Session ID changes on every restart so the client can detect it
    sessionIds[index] = String(Date.now());
    console.log(`[hls] cam ${index} (${cam.name}) started — session ${sessionIds[index]}`);

    session.onCallEnded.subscribe(() => {
      console.log(`[hls] cam ${index} call ended, restarting in ${RESTART_MS}ms`);
      sessionIds[index] = null;
      setTimeout(() => startStream(cam, index), RESTART_MS);
    });
  } catch (e) {
    console.error(`[hls] cam ${index} failed to start:`, e.message);
    setTimeout(() => startStream(cam, index), RESTART_MS * 2);
  }
}

function initHls(rawCameras, config) {
  fs.mkdirSync(HLS_BASE, { recursive: true });
  const camCfgs = (config && config.cameras) || [];
  let count = 0;
  rawCameras.forEach((cam, index) => {
    const cfg = camCfgs.find((c) => c.index === index);
    if (cfg && cfg.stream === 'hls') {
      hlsCamSet.add(index);
      count++;
      startStream(cam, index);
    }
  });
  if (count > 0) console.log(`[hls] HLS streaming enabled for ${count} camera(s)`);
}

function isHlsCamera(index) {
  return hlsCamSet.has(index);
}

// Returns the HLS manifest URL with a session-ID query param.
// Session ID only changes on stream restart, so the client can detect restarts
// and only then re-assign video.src (avoiding a reload flash every 5s tick).
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

module.exports = { initHls, isHlsCamera, getHlsUrl, getHlsDir };
