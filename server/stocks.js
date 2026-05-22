'use strict';

const fetch = require('node-fetch');

const SYMBOLS = ['^DJI', '^GSPC', 'AAPL', 'NVDA', 'JPM'];
const DISPLAY_NAMES = { '^DJI': 'DOW', '^GSPC': 'S&P 500' };

const CACHE_TTL = 5 * 60 * 1000;
let cache = { data: null, ts: 0 };

async function fetchSymbol(symbol) {
  const url =
    'https://query1.finance.yahoo.com/v8/finance/chart/' +
    encodeURIComponent(symbol) +
    '?interval=1d&range=1mo';
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    timeout: 8000,
  });
  const json = await res.json();
  const result = json.chart && json.chart.result && json.chart.result[0];
  if (!result) throw new Error('no result for ' + symbol);

  const meta = result.meta || {};
  const quoteData =
    result.indicators &&
    result.indicators.quote &&
    result.indicators.quote[0];
  const closes = (quoteData && quoteData.close) || [];
  const sparkline = closes.filter((v) => v != null).slice(-20);

  const price = meta.regularMarketPrice != null ? meta.regularMarketPrice : null;
  const prevClose = meta.chartPreviousClose || meta.previousClose || null;
  let changePct = null;
  if (price != null && prevClose) {
    changePct = ((price - prevClose) / prevClose) * 100;
  }

  return {
    symbol: DISPLAY_NAMES[symbol] || symbol,
    price,
    changePct,
    sparkline,
  };
}

async function getStocks() {
  if (cache.data && Date.now() - cache.ts < CACHE_TTL) return cache.data;

  const results = await Promise.allSettled(SYMBOLS.map(fetchSymbol));
  const data = results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    const cached = cache.data && cache.data[i];
    return (
      cached || {
        symbol: DISPLAY_NAMES[SYMBOLS[i]] || SYMBOLS[i],
        price: null,
        changePct: null,
        sparkline: [],
      }
    );
  });

  if (data.some((d) => d.price != null)) {
    cache = { data, ts: Date.now() };
  }
  return data;
}

module.exports = { getStocks };
