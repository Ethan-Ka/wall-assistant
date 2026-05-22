'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const http = require('http');
const path = require('path');
const express = require('express');
const WebSocket = require('ws');
const { initRing, getRingSnapshot, getCameraList } = require('./ring');
const { initEcobee } = require('./ecobee');
const { getTemperature } = require('./temperature');
const { getStocks } = require('./stocks');
const { getHeadlines } = require('./news');
const { readLayout, writeLayout } = require('./layout');

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
    (s) => s.col < 1 || s.row < 1 || s.col > cols || s.row > rows
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
  res.json({ ok: true });
});

app.get('/api/cameras', (_req, res) => {
  res.json(getCameraList());
});

// Serve camera snapshots as JPEG so the browser can cache by timestamp
app.get('/api/snapshot/:index', async (req, res) => {
  const index = parseInt(req.params.index, 10);
  const cameraCount = getCameraList().length;
  if (isNaN(index) || index < 0 || (cameraCount > 0 && index >= cameraCount)) return res.status(400).end();
  try {
    const snap = await getRingSnapshot(index);
    if (!snap.snapshotBuffer) return res.status(503).end();
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'no-store');
    res.send(snap.snapshotBuffer);
  } catch (_) {
    res.status(503).end();
  }
});

const server = http.createServer(app);

const wss = new WebSocket.Server({
  server,
  maxPayload: 4 * 1024, // 4 KB — layouts are a few hundred bytes
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

// Snapshot timestamps track when Ring produced a new frame; used as cache keys
const snapshotTimestamps = {};

async function buildPayload() {
  const cameraSlots = currentLayout.slots.filter((s) => s.type === 'camera');

  const cameras = await Promise.all(
    cameraSlots.map(async (slot) => {
      const camIndex = (slot.config && slot.config.index != null) ? slot.config.index : 0;
      const snap = await getRingSnapshot(camIndex);
      const ts = snap.lastUpdated;
      if (ts !== snapshotTimestamps[camIndex]) {
        snapshotTimestamps[camIndex] = ts;
      }
      return {
        slotId: slot.id,
        name: slot.config.name || snap.name,
        // Cache key changes only when Ring produces a new frame
        snapshotUrl: snap.snapshotBuffer
          ? `/api/snapshot/${camIndex}?t=${snapshotTimestamps[camIndex]}`
          : null,
        lastUpdated: ts,
      };
    })
  );

  const temperature = await getTemperature(config);
  const hasStocks = currentLayout.slots.some((s) => s.type === 'stocks');
  const stocks = hasStocks ? await getStocks() : undefined;
  const hasNews = currentLayout.slots.some((s) => s.type === 'news');
  const headlines = hasNews ? await getHeadlines() : undefined;
  return JSON.stringify({ type: 'update', temperature, cameras, stocks, headlines });
}

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'layout', layout: currentLayout }));
});

setInterval(async () => {
  let payload;
  try {
    payload = await buildPayload();
  } catch (_) {
    return;
  }
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}, 5000);

server.listen(PORT, async () => {
  console.log(`wall-assistant server running at http://localhost:${PORT}`);
  await initRing(config);
  initEcobee(config);
});
