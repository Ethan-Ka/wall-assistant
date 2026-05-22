'use strict';

const fetch = require('node-fetch');

const DEFAULT_SYMBOLS = [
  { stooq: '^dji',    display: 'DOW'     },
  { stooq: '^spx',    display: 'S&P 500' },
  { stooq: 'aapl.us', display: 'AAPL'   },
  { stooq: 'nvda.us', display: 'NVDA'   },
  { stooq: 'jpm.us',  display: 'JPM'    },
];

const CACHE_TTL = 5 * 60 * 1000;
const FETCH_BUDGET_MS = 3500;
const PER_SYMBOL_TIMEOUT_MS = 1800;
const SYMBOL_GAP_MS = 120;

// Keyed by sorted stooq symbol list — different slot configs share a cache entry
const caches = {};

function dateStr(d) {
  const m   = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}${m}${day}`;
}

function parseCsv(text) {
  return text
    .trim()
    .split('\n')
    .slice(1)
    .map((line) => parseFloat(line.split(',')[4]))
    .filter((v) => !isNaN(v));
}

// Human-readable names for common index tickers
const NICE_NAMES = {
  '^dji': 'DOW', '^spx': 'S&P 500', '^gspc': 'S&P 500',
  '^ixic': 'NASDAQ', '^rut': 'Russell 2K', '^vix': 'VIX',
};

const YAHOO_SYMBOLS = {
  '^dji': '^DJI',
  '^spx': '^GSPC',
  '^gspc': '^GSPC',
  '^ixic': '^IXIC',
  '^rut': '^RUT',
  '^vix': '^VIX',
};

// Convert plain ticker (e.g. "AAPL") to stooq format ("aapl.us").
// Indices like "^DJI" stay as "^dji".  Symbols with dots are passed through.
function toStooq(raw) {
  const s = raw.trim();
  if (s.startsWith('^') || s.includes('.')) return s.toLowerCase();
  return s.toLowerCase() + '.us';
}

function toYahoo(raw) {
  const s = raw.trim();
  if (!s) return s;

  const lower = s.toLowerCase();
  if (YAHOO_SYMBOLS[lower]) return YAHOO_SYMBOLS[lower];

  if (s.startsWith('^')) return s.toUpperCase();

  return s
    .replace(/\.us$/i, '')
    .replace(/\./g, '-')
    .toUpperCase();
}

function displaySymbol(raw) {
  const yahoo = toYahoo(raw);
  const lower = raw.trim().toLowerCase();
  return NICE_NAMES[lower] || yahoo.replace(/^\^/, '');
}

function symbolsFromConfig(raw) {
  if (!raw) return DEFAULT_SYMBOLS;
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => {
      const yahoo = toYahoo(t);
      const stooq = toStooq(t);
      return { yahoo, stooq, display: displaySymbol(t) };
    });
}

function parseYahooCloses(payload) {
  const result = payload && payload.chart && payload.chart.result && payload.chart.result[0];
  const quote = result && result.indicators && result.indicators.quote && result.indicators.quote[0];
  if (!quote || !Array.isArray(quote.close)) return [];
  return quote.close.filter((v) => typeof v === 'number' && isFinite(v));
}

async function fetchYahooSymbol(sym, timeoutMs) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym.yahoo)}?range=1mo&interval=1d&includePrePost=false&events=div%2Csplits`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    timeout: timeoutMs || PER_SYMBOL_TIMEOUT_MS,
  });

  if (!res.ok) throw new Error('yahoo status ' + res.status);

  const closes = parseYahooCloses(await res.json());
  if (closes.length === 0) throw new Error('no yahoo data for ' + sym.yahoo);

  const sparkline = closes.slice(-20);
  const price     = sparkline[sparkline.length - 1];
  const prevClose = sparkline.length >= 2 ? sparkline[sparkline.length - 2] : null;
  const changePct = prevClose ? ((price - prevClose) / prevClose) * 100 : null;

  return { symbol: sym.display, price, changePct, sparkline };
}

async function fetchSymbol(sym, timeoutMs) {
  try {
    return await fetchYahooSymbol(sym, timeoutMs);
  } catch (_) {
    const now  = new Date();
    const from = new Date(now - 35 * 24 * 60 * 60 * 1000);
    const url  = `https://stooq.com/q/d/l/?s=${sym.stooq}&d1=${dateStr(from)}&d2=${dateStr(now)}&i=d`;

    const res    = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: timeoutMs || PER_SYMBOL_TIMEOUT_MS,
    });
    const closes = parseCsv(await res.text());
    if (closes.length === 0) throw new Error('no data for ' + sym.stooq);

    const sparkline = closes.slice(-20);
    const price     = sparkline[sparkline.length - 1];
    const prevClose = sparkline.length >= 2 ? sparkline[sparkline.length - 2] : null;
    const changePct = prevClose ? ((price - prevClose) / prevClose) * 100 : null;

    return { symbol: sym.display, price, changePct, sparkline };
  }
}

// symbols: optional comma-separated string of tickers (e.g. "AAPL, NVDA, ^DJI")
async function getStocks(symbols) {
  const syms = symbolsFromConfig(symbols);
  const key  = syms.map((s) => s.stooq).sort().join(',');
  const entry = caches[key];

  if (entry && entry.data && Date.now() - entry.ts < CACHE_TTL) return entry.data;

  // Sequential with a small gap — Stooq drops parallel requests.
  // Keep a tight total budget so slow ticker requests do not stall the dashboard.
  const data = [];
  const deadline = Date.now() + FETCH_BUDGET_MS;
  for (let i = 0; i < syms.length; i++) {
    if (i > 0) {
      const remainingGap = deadline - Date.now() - 250;
      if (remainingGap <= 0) {
        const cached = entry && entry.data && entry.data[i];
        data.push(cached || { symbol: syms[i].display, price: null, changePct: null, sparkline: [] });
        continue;
      }
      await new Promise((r) => setTimeout(r, Math.min(SYMBOL_GAP_MS, remainingGap)));
    }

    const remainingBudget = deadline - Date.now() - 250;
    if (remainingBudget <= 0) {
      const cached = entry && entry.data && entry.data[i];
      data.push(cached || { symbol: syms[i].display, price: null, changePct: null, sparkline: [] });
      continue;
    }

    try {
      data.push(await fetchSymbol(syms[i], Math.min(PER_SYMBOL_TIMEOUT_MS, remainingBudget)));
    } catch (_) {
      const cached = entry && entry.data && entry.data[i];
      data.push(cached || { symbol: syms[i].display, price: null, changePct: null, sparkline: [] });
    }
  }

  if (data.some((d) => d.price != null)) caches[key] = { data, ts: Date.now() };
  return data;
}

module.exports = { getStocks };
