'use strict';

const util = require('util');
const readline = require('readline');
const os = require('os');
const fs = require('fs');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const http = require('http');
const path = require('path');
const express = require('express');
const WebSocket = require('ws');

const SETTINGS_PATH = path.join(__dirname, '../settings.json');

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

const GRAPH_SAMPLES = 30;
let requestsInInterval = 0;
const requestsHistory = [];
const droppedHistory = [];
let lastTotalDropped = 0;

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

const { initRing, getRingSnapshot, getMotionClipUrl, getCameraList, getCameras, isCameraLowBattery, getCameraBattery, hasRecentMotionClip, takeSnapshot } = require('./ring');
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

function getLocalIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return null;
}

function color(code, text) {
  return isDashboardEnabled ? `\u001b[${code}m${text}\u001b[0m` : text;
}

function statusColor(ok, text) {
  return color(ok ? '1;32' : '1;33', text);
}

function dimColor(text) {
  return color('90', text);
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

function sparkline(data, width) {
  const BLOCKS = '▁▂▃▄▅▆▇█';
  const window = data.slice(-width);
  const max = Math.max(...window, 1);
  const bar = window.map((v) => BLOCKS[Math.min(7, Math.floor((v / max) * 8))]).join('');
  return bar.padStart(width, ' ');
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
  const localIp = getLocalIp();
  const urlPart = localIp
    ? `${color('1;34', `http://localhost:${PORT}`)}  |  ${color('1;34', `http://${localIp}:${PORT}`)}`
    : color('1;34', `http://localhost:${PORT}`);
  lines.push(`${urlPart}  |  uptime ${color('1;36', `${uptimeSeconds}s`)}  |  ws clients ${color('1;36', String(wsCount))}`);
  lines.push(`ring ${statusColor(dashboardState.ringReady, dashboardState.ringReady ? 'ready' : 'starting')}  |  ecobee ${statusColor(dashboardState.ecobeeReady, dashboardState.ecobeeReady ? 'ready' : 'starting')}  |  hls ${color('1;32', 'on-demand')}`);
  lines.push(`layout ${color('1;36', `${layout.slots.length} slots`)} (${dimColor(`${layout.grid.cols}x${layout.grid.rows}`)})  |  last payload ${lastPayload === 'waiting' ? color('1;33', lastPayload) : color('1;32', lastPayload)}  |  last client event ${lastEvent === 'none' ? color('90', lastEvent) : color('1;32', lastEvent)}`);
  if (dashboardState.lastPayloadError) {
    lines.push(color('1;31', `payload status: ${dashboardState.lastPayloadError}`));
  }
  lines.push('');
  lines.push(color('1;33', 'connected devices'));
  if (cameraList.length) {
    cameraList.forEach((camera) => {
      const streaming = getHlsUrl(camera.index) ? color('1;32', 'streaming') : color('1;33', 'snapshot');
      const dropped = camera.dropped ? `  |  ${camera.dropped} dropped` : '';
      const battStr = camera.battery != null ? `  |  ${camera.battery}% bat` : '';
      const lowBatStr = camera.lowBattery ? color('1;33', '  |  LOW BATTERY') : '';
      lines.push(`camera ${color('1;36', String(camera.index))}: ${camera.name}  |  ${dimColor(camera.kind || 'unknown')}  |  ${streaming}${dropped}${battStr}${lowBatStr}`);
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
      lines.push(`client ${color('1;36', String(client.id))}: ${client.remoteAddress || 'unknown'}  |  ${color('1;32', `${ageSeconds}s connected`)}  |  origin ${dimColor(origin)}  |  ua ${userAgent}`);
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
  lines.push(color('1;33', 'metrics'));
  const termWidth = Math.max(process.stdout.columns || 100, 60);
  const graphWidth = Math.min(GRAPH_SAMPLES, Math.max(20, termWidth - 30));
  const totalDropped = lastTotalDropped;
  const latestReq = requestsHistory[requestsHistory.length - 1] || 0;
  lines.push(
    `req/s   ${color('1;34', sparkline(requestsHistory, graphWidth))}  ${color('1;36', String(latestReq))} now`
  );
  lines.push(
    `dropped ${color('1;31', sparkline(droppedHistory, graphWidth))}  ${color('1;36', String(totalDropped))} total`
  );

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

let serverSettings = {};
try {
  serverSettings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
} catch (_) {}

let updateIntervalMs = (serverSettings.updateIntervalMs >= 1000) ? serverSettings.updateIntervalMs : 3000;
let broadcastIntervalId = null;

let currentLayout = readLayout();

const PORT = process.env.PORT || 3000;
const app = express();

app.use(express.json({ limit: '16kb' }));
app.use(express.static(path.join(__dirname, '../client')));
app.use((_req, _res, next) => { requestsInInterval++; next(); });

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

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor((Date.now() - dashboardState.startedAt.getTime()) / 1000),
    ringReady: dashboardState.ringReady,
    ecobeeReady: dashboardState.ecobeeReady,
    wsClients: wss ? wss.clients.size : 0,
    cameras: getCameraList(),
    updateIntervalMs,
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/config', (_req, res) => {
  res.json({ updateIntervalMs });
});

app.post('/api/config', (req, res) => {
  const { updateIntervalMs: newInterval } = req.body;
  if (newInterval != null) {
    const ms = parseInt(newInterval, 10);
    if (isNaN(ms) || ms < 1000 || ms > 60000) {
      return res.status(400).json({ error: 'updateIntervalMs must be between 1000 and 60000' });
    }
    updateIntervalMs = ms;
    serverSettings.updateIntervalMs = ms;
    try {
      fs.writeFileSync(SETTINGS_PATH, JSON.stringify(serverSettings, null, 2) + '\n', 'utf8');
    } catch (e) {
      console.error('[config] Failed to persist settings:', e.message);
    }
    startBroadcastInterval();
    scheduleRender();
  }
  res.json({ ok: true, updateIntervalMs });
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

  if (isCameraLowBattery(index)) {
    return res.status(503).json({ error: 'Camera unavailable — low battery' });
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
  if (!isNaN(index) && index >= 0) {
    stopStream(index);
    // Capture a fresh snapshot — but skip if a motion clip is waiting to be shown,
    // because a newer snapshot timestamp would cause getMotionClipUrl to discard the clip.
    const cams = getCameras();
    if (cams[index] && !hasRecentMotionClip(index)) {
      takeSnapshot(cams[index], index).catch(() => {});
    }
  }
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

      // getRingSnapshot is sync — reads from the scheduled cache (5s), never wakes the camera
      const snap = getRingSnapshot(camIndex);
      const motionClipUrl = await getMotionClipUrl(camIndex);
      const streamUrl = getHlsUrl(camIndex);

      return {
        slotId:        slot.id,
        camIndex,
        name:          snap.name,
        isPlaceholder: snap.isPlaceholder,
        streamUrl:     streamUrl || null,
        streamAge:     streamUrl ? new Date().toISOString() : null,
        snapshotUrl:   snap.isPlaceholder
          ? null
          : `/api/snapshot/${camIndex}?t=${encodeURIComponent(snap.lastUpdated)}`,
        snapshotAge:   snap.lastUpdated,
        motionClipUrl: motionClipUrl || null,
        battery:       getCameraBattery(camIndex),
        lowBattery:    isCameraLowBattery(camIndex),
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

async function broadcastPayload() {
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
}

function startBroadcastInterval() {
  if (broadcastIntervalId) clearInterval(broadcastIntervalId);
  broadcastIntervalId = setInterval(broadcastPayload, updateIntervalMs);
}

startBroadcastInterval();

setInterval(() => {
  requestsHistory.push(requestsInInterval);
  requestsInInterval = 0;
  if (requestsHistory.length > GRAPH_SAMPLES) requestsHistory.shift();

  const totalDropped = getCameraList().reduce((sum, c) => sum + (c.dropped || 0), 0);
  droppedHistory.push(Math.max(0, totalDropped - lastTotalDropped));
  lastTotalDropped = totalDropped;
  if (droppedHistory.length > GRAPH_SAMPLES) droppedHistory.shift();

  scheduleRender();
}, 1000);

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Error: Port ${PORT} is already in use. Stop the other process or set a different PORT.`);
    process.exit(1);
  }
  throw err;
});

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
