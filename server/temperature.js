'use strict';

const fetch = require('node-fetch');
const { getEcobeeTemperature } = require('./ecobee');

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
let outdoorCache = { data: null, ts: 0 };

async function getOutdoorTemperature(config) {
  if (outdoorCache.data && Date.now() - outdoorCache.ts < CACHE_TTL) {
    return outdoorCache.data;
  }

  const lat = (config && config.latitude) || 37.7749;
  const lon = (config && config.longitude) || -122.4194;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&daily=temperature_2m_max,temperature_2m_min&timezone=auto`;

  try {
    const res = await fetch(url);
    const json = await res.json();
    const w = json.current_weather;
    const celsius = w.temperature;
    const highC = json.daily && json.daily.temperature_2m_max && json.daily.temperature_2m_max[0];
    const lowC = json.daily && json.daily.temperature_2m_min && json.daily.temperature_2m_min[0];
    const result = {
      celsius,
      fahrenheit: Math.round((celsius * 9) / 5 + 32),
      highF: highC != null ? Math.round((highC * 9) / 5 + 32) : null,
      lowF: lowC != null ? Math.round((lowC * 9) / 5 + 32) : null,
      condition: WMO_CONDITIONS[w.weathercode] || 'Unknown',
      source: 'open-meteo',
    };
    outdoorCache = { data: result, ts: Date.now() };
    return result;
  } catch (_) {
    return outdoorCache.data || { celsius: null, fahrenheit: null, condition: 'Unavailable', source: 'open-meteo' };
  }
}

async function getTemperature(config) {
  const [outdoor, indoor] = await Promise.all([
    getOutdoorTemperature(config),
    getEcobeeTemperature(),
  ]);
  return { outdoor, indoor };
}

module.exports = { getTemperature };
