'use strict';

const fetch = require('node-fetch');

// WMO weather interpretation codes: https://open-meteo.com/en/docs#weathervariables
const WMO_CONDITIONS = {
  0: 'Clear',
  1: 'Mostly Clear',
  2: 'Partly Cloudy',
  3: 'Cloudy',
  45: 'Fog',
  48: 'Fog',
  51: 'Drizzle',
  53: 'Drizzle',
  55: 'Drizzle',
  61: 'Rain',
  63: 'Rain',
  65: 'Rain',
  71: 'Snow',
  73: 'Snow',
  75: 'Snow',
  80: 'Showers',
  81: 'Showers',
  82: 'Showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm',
  99: 'Thunderstorm',
};

const CACHE_TTL = 5 * 60 * 1000;
let cache = { data: null, ts: 0 };

async function getTemperature(config) {
  if (cache.data && Date.now() - cache.ts < CACHE_TTL) {
    return cache.data;
  }

  const lat = (config && config.latitude) || 37.7749;
  const lon = (config && config.longitude) || -122.4194;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`;

  try {
    const res = await fetch(url);
    const json = await res.json();
    const w = json.current_weather;
    const celsius = w.temperature;
    const result = {
      celsius,
      fahrenheit: Math.round((celsius * 9) / 5 + 32),
      condition: WMO_CONDITIONS[w.weathercode] || 'Unknown',
      source: 'open-meteo',
    };
    cache = { data: result, ts: Date.now() };
    return result;
  } catch (_) {
    return { celsius: null, fahrenheit: null, condition: 'Unavailable', source: 'open-meteo' };
  }
}

module.exports = { getTemperature };
