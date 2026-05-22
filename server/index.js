'use strict';

const util = require('util');
const readline = require('readline');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const http = require('http');
const path = require('path');
const express = require('express');
const WebSocket = require('ws');

const isDashboardEnabled = process.stdout.isTTY && process.stderr.isTTY;
const originalConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

const dashboardState = {
  startedAt: new Date(),
  lastPayloadAt: null,
  lastPayloadError: null,
  ringReady: false,
  ecobeeReady: false,
  hlsReady: false,
  lastClientEvent: null,
  clientErrors: [],
};

const logBuffer = [];
const MAX_LOG_LINES = 12;
const MAX_CLIENT_ERRORS = 8;
let renderQueued = false;
let nextClientId = 1;
const clientMetadata = new Map();

function formatLogLine(args) {
  return util.format(...args);
}

function pushLog(level, args) {
  const entry = {
    time: new Date(),
    level,
    message: formatLogLine(args),
  };

  logBuffer.push(entry);
  while (logBuffer.length > MAX_LOG_LINES) {
    logBuffer.shift();
  }

  if (!isDashboardEnabled) {
    originalConsole[level](...args);
    return;
  }

  scheduleRender();
}

console.log = (...args) => pushLog('log', args);
console.info = (...args) => pushLog('log', args);
console.warn = (...args) => pushLog('warn', args);
console.error = (...args) => pushLog('error', args);

const { initRing, getRingSnapshot, getMotionClipUrl, getCameraList, getCameras } = require('./ring');
const { initHls, startStream, stopStream, getHlsUrl, getHlsDir } = require('./hls');
const { initEcobee } = require('./ecobee');
const { getTemperature } = require('./temperature');
const { getStocks }    = require('./stocks');
const { getHeadlines } = require('./news');
const { getISS }       = require('./iss');
const { getSports }    = require('./sports');
const { getNowPlaying } = require('./spotify');
const { readLayout, writeLayout } = require('./layout');
const autoUpdate = require('./auto-update');

function color(code, text) {
  return isDashboardEnabled ? `\u001b[${code}m${text}\u001b[0m` : text;
}

function truncate(text, width) {
  if (text.length <= width) return text;
  if (width <= 1) return text.slice(0, width);
  return text.slice(0, width - 1) + '…';
}

function padRight(text, width) {
  if (text.length >= width) return text;
  return text + ' '.repeat(width - text.length);
}

function getDisplayLines() {
  const layout = currentLayout || { grid: { cols: 0, rows: 0 }, slots: [] };
  const cameraList = getCameraList();
  const wsCount = wss ? wss.clients.size : 0;
  const uptimeSeconds = Math.floor((Date.now() - dashboardState.startedAt.getTime()) / 1000);
  const lastPayload = dashboardState.lastPayloadAt
    ? dashboardState.lastPayloadAt.toLocaleTimeString()
    : 'waiting';
  const lastEvent = dashboardState.lastClientEvent
    ? dashboardState.lastClientEvent.toLocaleTimeString()
    : 'none';

  const lines = [];
  lines.push(color('1;36', 'wall-assistant server'));
  lines.push(`http://localhost:${PORT}  |  uptime ${uptimeSeconds}s  |  ws clients ${wsCount}`);
  lines.push(`ring ${dashboardState.ringReady ? 'ready' : 'starting'}  |  ecobee ${dashboardState.ecobeeReady ? 'ready' : 'starting'}  |  hls on-demand`);
  lines.push(`layout ${layout.slots.length} slots (${layout.grid.cols}x${layout.grid.rows})  |  last payload ${lastPayload}  |  last client event ${lastEvent}`);
  if (dashboardState.lastPayloadError) {
    lines.push(color('1;31', `payload status: ${dashboardState.lastPayloadError}`));
  }
  lines.push('');
  lines.push(color('1;33', 'connected devices'));
  if (cameraList.length) {
    cameraList.forEach((camera) => {
      const streaming = getHlsUrl(camera.index) ? 'streaming' : 'snapshot';
      lines.push(`camera ${camera.index}: ${camera.name}  |  ${camera.kind || 'unknown'}  |  ${streaming}`);
    });
  } else {
    lines.push('no Ring cameras detected yet');
  }

  lines.push('');
  lines.push(color('1;33', 'websocket clients'));
  const clientLines = Array.from(clientMetadata.values()).sort((a, b) => a.id - b.id);
  if (clientLines.length) {
    clientLines.forEach((client) => {
      const ageSeconds = Math.max(0, Math.floor((Date.now() - client.connectedAt.getTime()) / 1000));
      const origin = client.origin || 'same-host';
      const userAgent = client.userAgent || 'unknown';
      lines.push(`client ${client.id}: ${client.remoteAddress || 'unknown'}  |  ${ageSeconds}s connected  |  origin ${origin}  |  ua ${userAgent}`);
    });
  } else {
    lines.push('no websocket clients connected yet');
  }

  lines.push('');
  lines.push(color('1;33', 'client errors'));
  if (dashboardState.clientErrors.length) {
    dashboardState.clientErrors.forEach((entry) => {
      const stamp = entry.time.toLocaleTimeString();
      const prefix = `client ${entry.clientId || '?'} @ ${entry.remoteAddress}`;
      const detail = entry.detail ? ` (${entry.detail})` : '';
      lines.push(`[${stamp}] ${prefix} | ${entry.source}: ${entry.message}${detail}`);
    });
  } else {
    lines.push('no client errors reported yet');
  }

  lines.push('');
  lines.push(color('1;33', 'recent logs'));
  if (logBuffer.length) {
    logBuffer.forEach((entry) => {
      const stamp = entry.time.toLocaleTimeString();
      const level = entry.level === 'error' ? color('1;31', entry.level.toUpperCase())
        : entry.level === 'warn' ? color('1;33', entry.level.toUpperCase())
        : color('1;32', entry.level.toUpperCase());
      lines.push(`[${stamp}] [${level}] ${entry.message}`);
    });
  } else {
    lines.push('waiting for log activity');
  }

  return lines;
}

function renderDashboard() {
  if (!isDashboardEnabled) return;

  const width = Math.max(process.stdout.columns || 100, 60);
  const lines = getDisplayLines().map((line) => truncate(line, width - 1));

  readline.cursorTo(process.stdout, 0, 0);
  readline.clearScreenDown(process.stdout);

  const top = color('90', '┌') + color('90', '─'.repeat(width - 2)) + color('90', '┐');
  const bottom = color('90', '└') + color('90', '─'.repeat(width - 2)) + color('90', '┘');
  originalConsole.log(top);
  for (const line of lines) {
    originalConsole.log(color('90', '│') + padRight(line, width - 2) + color('90', '│'));
  }
  originalConsole.log(bottom);
}

function scheduleRender() {
  if (!isDashboardEnabled || renderQueued) return;
  renderQueued = true;
  setTimeout(() => {
    renderQueued = false;
    renderDashboard();
  }, 50);
}

function recordClientError(metadata, payload) {
  const entry = {
    time: new Date(),
    clientId: metadata && metadata.id,
    remoteAddress: metadata && metadata.remoteAddress ? metadata.remoteAddress : 'unknown',
    origin: metadata && metadata.origin ? metadata.origin : 'same-host',
    source: payload && payload.source ? String(payload.source) : 'client',
    message: payload && payload.message ? String(payload.message) : 'Client error',
    detail: payload && payload.detail ? String(payload.detail) : '',
  };

  dashboardState.clientErrors.unshift(entry);
  while (dashboardState.clientErrors.length > MAX_CLIENT_ERRORS) {
    dashboardState.clientErrors.pop();
  }

  console.warn(`[client ${entry.clientId || '?'}] ${entry.source}: ${entry.message}${entry.detail ? ` (${entry.detail})` : ''}`);
  scheduleRender();
}

let config = {};
try {
  config = require('../config.json');
} catch (_) {}

let currentLayout = readLayout();

const PORT = process.env.PORT || 3000;
const app = express();

app.use(express.json({ limit: '16kb' }));
app.use(express.static(path.join(__dirname, '../client')));

app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, '../client/admin.html'));
});

app.get('/api/layout', (req, res) => {
  res.json(currentLayout);
});

app.post('/api/layout', (req, res) => {
  const layout = req.body;
  if (!layout || !layout.grid || !Array.isArray(layout.slots)) {
    return res.status(400).json({ error: 'Invalid layout' });
  }
  const { cols, rows } = layout.grid;
  const outOfBounds = layout.slots.some(
    (s) =>
      s.col < 1 || s.row < 1 ||
      s.col + (s.colSpan || 1) - 1 > cols ||
      s.row + (s.rowSpan || 1) - 1 > rows
  );
  if (outOfBounds) {
    return res.status(400).json({ error: 'Slot position out of grid bounds' });
  }
  currentLayout = layout;
  try {
    writeLayout(layout);
  } catch (e) {
    console.error('[layout] Failed to persist layout:', e.message);
  }
  const msg = JSON.stringify({ type: 'layout', layout });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  }
  scheduleRender();
  res.json({ ok: true });
});

app.get('/api/cameras', (_req, res) => {
  res.json(getCameraList());
});

app.get('/api/spotify', async (_req, res) => {
  try {
    const spotify = await getNowPlaying();
    if (!spotify) {
      return res.status(503).json({ error: 'Spotify unavailable' });
    }
    res.json(spotify);
  } catch (e) {
    res.status(503).json({ error: e.message || 'Spotify unavailable' });
  }
});

// Serve HLS manifest + segments; different cache policies for each type
app.get('/api/hls/:index/:file', (req, res) => {
  const index = parseInt(req.params.index, 10);
  const file  = req.params.file;
  if (isNaN(index) || index < 0) return res.status(400).end();
  // Whitelist: only .m3u8 and .ts — root: enforces no path traversal
  if (!/^[\w-]+\.(m3u8|ts)$/.test(file)) return res.status(400).end();
  const cacheHeader = file.endsWith('.m3u8')
    ? 'no-cache, no-store'                          // playlist is rewritten every ~2s
    : 'public, max-age=31536000, immutable';         // segments are write-once
  res.sendFile(file, {
    root: getHlsDir(index),
    headers: { 'Cache-Control': cacheHeader },
  }, (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});

// Serve camera snapshots as JPEG (or SVG placeholder) so the browser can cache by timestamp
app.get('/api/snapshot/:index', (req, res) => {
  const index = parseInt(req.params.index, 10);
  const cameraCount = getCameraList().length;
  if (isNaN(index) || index < 0 || (cameraCount > 0 && index >= cameraCount)) return res.status(400).end();

  const snap = getRingSnapshot(index);
  res.set('Content-Type', snap.isPlaceholder ? 'image/svg+xml; charset=utf-8' : 'image/jpeg');
  res.set('Cache-Control', 'no-store');
  if (snap.lastUpdated) res.set('X-Snapshot-Timestamp', snap.lastUpdated);
  res.send(snap.snapshotBuffer);
});

// On-demand live stream: starts HLS for the requested camera, waits up to 15s for
// the first manifest to appear, then returns the URL. Idempotent — if the stream
// is already running the existing URL is returned immediately.
app.post('/api/stream/:index/start', async (req, res) => {
  const index = parseInt(req.params.index, 10);
  const camList = getCameras();
  if (isNaN(index) || index < 0 || index >= camList.length) {
    return res.status(404).json({ error: 'Camera not found' });
  }

  const existingUrl = getHlsUrl(index);
  if (existingUrl) return res.json({ hlsUrl: existingUrl });

  startStream(camList[index], index); // fire; don't await

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const url = getHlsUrl(index);
    if (url) return res.json({ hlsUrl: url });
  }

  res.status(504).json({ error: 'Stream did not become ready in time' });
});

app.post('/api/stream/:index/stop', (req, res) => {
  const index = parseInt(req.params.index, 10);
  if (!isNaN(index) && index >= 0) stopStream(index);
  res.json({ ok: true });
});

const server = http.createServer(app);

const wss = new WebSocket.Server({
  server,
  maxPayload: 16 * 1024, // 16 KB — motion clip URLs add ~500 bytes per camera
  verifyClient({ origin, req }) {
    // No Origin header = same-host tool (curl, native app) — allow
    if (!origin) return true;
    // Origin must match the Host the HTTP server is actually listening on
    try {
      const originHost = new URL(origin).host; // strips scheme, keeps host:port
      const serverHost = req.headers.host || '';
      return originHost === serverHost;
    } catch (_) {
      return false;
    }
  },
});

async function buildPayload() {
  const cameraSlots = currentLayout.slots.filter((s) => s.type === 'camera');

  const cameras = await Promise.all(
    cameraSlots.map(async (slot) => {
      const camIndex = (slot.config && slot.config.index != null) ? slot.config.index : 0;

      // getRingSnapshot is sync — reads from the 30-min scheduled cache, never wakes the camera
      const snap = getRingSnapshot(camIndex);
      const motionClipUrl = await getMotionClipUrl(camIndex);

      return {
        slotId:        slot.id,
        camIndex,
        name:          snap.name,
        isPlaceholder: snap.isPlaceholder,
        snapshotUrl:   snap.isPlaceholder
          ? null
          : `/api/snapshot/${camIndex}?t=${encodeURIComponent(snap.lastUpdated)}`,
        snapshotAge:   snap.lastUpdated,
        motionClipUrl: motionClipUrl || null,
      };
    })
  );

  const temperature = await getTemperature(config);

  // Stocks — per slot so each can have its own symbol list
  const stocksSlots = currentLayout.slots.filter((s) => s.type === 'stocks');
  const stocks = stocksSlots.length
    ? await Promise.all(
        stocksSlots.map(async (slot) => ({
          slotId: slot.id,
          items:  await getStocks(slot.config && slot.config.symbols || null),
        }))
      )
    : undefined;

  // Headlines — per slot so each can have its own RSS feed
  const newsSlots = currentLayout.slots.filter((s) => s.type === 'news');
  const headlines = newsSlots.length
    ? await Promise.all(
        newsSlots.map(async (slot) => ({
          slotId: slot.id,
          items:  await getHeadlines(slot.config && slot.config.feedUrl || null),
        }))
      )
    : undefined;

  // ISS — shared across all ISS slots; uses first slot's radius config
  const issSlots = currentLayout.slots.filter((s) => s.type === 'iss');
  let iss;
  if (issSlots.length) {
    const slotCfg = issSlots[0].config || {};
    iss = await getISS({
      latitude:    config.latitude,
      longitude:   config.longitude,
      radius:      Number(slotCfg.radius) || 100,
      showFlights: slotCfg.showFlights !== 'false',
    });
  }

  // Sports — per slot so each can track a different team
  const sportsSlots = currentLayout.slots.filter((s) => s.type === 'sports');
  const sports = sportsSlots.length
    ? await Promise.all(
        sportsSlots.map(async (slot) => {
          const cfg = slot.config || {};
          return {
            slotId: slot.id,
            game:   await getSports(cfg.sport || 'football', cfg.league || 'nfl', cfg.team || ''),
          };
        })
      )
    : undefined;

  // Spotify Now Playing — shared
  const hasNowPlaying = currentLayout.slots.some((s) => s.type === 'nowplaying');
  const spotify = hasNowPlaying ? await getNowPlaying() : undefined;

  return JSON.stringify({ type: 'update', temperature, cameras, stocks, headlines, iss, sports, nowplaying: spotify, spotify });
}

wss.on('connection', (ws, req) => {
  const clientId = nextClientId++;
  const metadata = {
    id: clientId,
    remoteAddress: req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : 'unknown',
    origin: req.headers.origin || '',
    userAgent: req.headers['user-agent'] || '',
    connectedAt: new Date(),
  };
  clientMetadata.set(ws, metadata);
  dashboardState.lastClientEvent = new Date();
  console.log(`[ws] client #${metadata.id} connected from ${metadata.remoteAddress} (${wss.clients.size} total)`);
  ws.send(JSON.stringify({ type: 'layout', layout: currentLayout }));
  scheduleRender();

  ws.on('message', (raw) => {
    let payload;
    try {
      payload = JSON.parse(raw.toString());
    } catch (_) {
      return;
    }

    if (!payload || payload.type !== 'client-error') return;
    dashboardState.lastClientEvent = new Date();
    recordClientError(metadata, payload);
  });

  ws.on('close', () => {
    clientMetadata.delete(ws);
    dashboardState.lastClientEvent = new Date();
    console.log(`[ws] client #${metadata.id} disconnected (${wss.clients.size} remaining)`);
    scheduleRender();
  });
});

setInterval(async () => {
  let payload;
  try {
    payload = await buildPayload();
    dashboardState.lastPayloadAt = new Date();
    dashboardState.lastPayloadError = null;
  } catch (_) {
    dashboardState.lastPayloadError = 'payload update failed';
    return;
  }
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}, 3000);

setInterval(() => {
  scheduleRender();
}, 1000);

server.listen(PORT, async () => {
  console.log(`wall-assistant server running at http://localhost:${PORT}`);
  scheduleRender();
  await initRing(config);
  dashboardState.ringReady = true;
  scheduleRender();
  initEcobee(config);
  dashboardState.ecobeeReady = true;
  scheduleRender();
  initHls();
  scheduleRender();
  dashboardState.hlsReady = true;
  scheduleRender();
  autoUpdate.start();
});

if (isDashboardEnabled) {
  renderDashboard();
}
