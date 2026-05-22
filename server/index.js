'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const http = require('http');
const path = require('path');
const express = require('express');
const WebSocket = require('ws');
const { getRingSnapshot } = require('./ring');
const { getTemperature } = require('./temperature');

let config = {};
try {
  config = require('../config.json');
} catch (_) {}

const PORT = process.env.PORT || 3000;
const app = express();

app.use(express.static(path.join(__dirname, '../client')));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

async function buildPayload() {
  const cameras = config.cameras && config.cameras.length
    ? await Promise.all(config.cameras.map((cam) => getRingSnapshot(cam.index)))
    : [await getRingSnapshot(0)];

  const temperature = await getTemperature(config);

  return JSON.stringify({ type: 'update', temperature, cameras });
}

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

server.listen(PORT, () => {
  console.log(`wall-assistant server running at http://localhost:${PORT}`);
});
