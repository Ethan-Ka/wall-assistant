'use strict';

const fetch = require('node-fetch');

const ISS_URL = 'https://api.wheretheiss.at/v1/satellites/25544';
const CACHE_TTL = 15 * 1000;

let cache = { data: null, ts: 0 };

async function getISS(cfg) {
  if (cache.data && Date.now() - cache.ts < CACHE_TTL) return cache.data;

  let iss = null;
  try {
    const res = await fetch(ISS_URL, { headers: { 'User-Agent': 'wall-assistant/1.0' }, timeout: 8000 });
    iss = await res.json();
  } catch (_) {
    return cache.data;
  }

  let flights = [];
  const lat = cfg && cfg.latitude;
  const lon = cfg && cfg.longitude;
  const showFlights = cfg && cfg.showFlights !== false;

  if (showFlights && lat != null && lon != null) {
    const radiusKm = ((cfg && cfg.radius) || 100) * 1.60934;
    const latDelta = radiusKm / 111;
    const lonDelta = radiusKm / (111 * Math.cos(lat * Math.PI / 180));
    const url =
      'https://opensky-network.org/api/states/all' +
      '?lamin=' + (lat - latDelta).toFixed(4) +
      '&lamax=' + (lat + latDelta).toFixed(4) +
      '&lomin=' + (lon - lonDelta).toFixed(4) +
      '&lomax=' + (lon + lonDelta).toFixed(4);
    try {
      const osRes = await fetch(url, { headers: { 'User-Agent': 'wall-assistant/1.0' }, timeout: 8000 });
      const osJson = await osRes.json();
      if (osJson && Array.isArray(osJson.states)) {
        flights = osJson.states
          .filter((s) => s[1] && s[1].trim())
          .slice(0, 8)
          .map((s) => ({
            callsign: (s[1] || '').trim(),
            altitudeFt: s[7] != null ? Math.round(s[7] * 3.28084) : null,
            speedKts:   s[9] != null ? Math.round(s[9] * 1.94384)  : null,
            heading:    s[10] != null ? Math.round(s[10]) : null,
          }));
      }
    } catch (_) {}
  }

  const data = {
    latitude:  iss.latitude,
    longitude: iss.longitude,
    altitudeKm: Math.round(iss.altitude),
    speedKmh:   Math.round(iss.velocity),
    flights,
  };
  cache = { data, ts: Date.now() };
  return data;
}

module.exports = { getISS };
