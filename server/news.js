'use strict';

const fetch = require('node-fetch');

const FEED_URL = 'https://feeds.bbci.co.uk/news/rss.xml';
const CACHE_TTL = 15 * 60 * 1000;

let cache = { data: null, ts: 0 };

const NAMED_ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'",
};

function decodeEntities(str) {
  return str
    .replace(/&(?:amp|lt|gt|quot|apos|#39);/g, (m) => NAMED_ENTITIES[m] || m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function parseRSS(xml) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  const titleRe = /<title>(?:<!\[CDATA\[(.*?)\]\]>|(.*?))<\/title>/;
  const thumbRe = /<media:thumbnail[^>]+url=["']([^"']+)["']/;
  let match;
  while ((match = itemRe.exec(xml)) !== null) {
    const titleMatch = titleRe.exec(match[1]);
    if (!titleMatch) continue;
    const raw = (titleMatch[1] !== undefined ? titleMatch[1] : titleMatch[2] || '').trim();
    const title = decodeEntities(raw);
    if (!title) continue;
    const thumbMatch = thumbRe.exec(match[1]);
    const imageUrl = thumbMatch ? thumbMatch[1] : null;
    items.push({ title, imageUrl });
  }
  return items.slice(0, 8);
}

async function getHeadlines() {
  if (cache.data && Date.now() - cache.ts < CACHE_TTL) return cache.data;
  try {
    const res = await fetch(FEED_URL, { headers: { 'User-Agent': 'wall-assistant/1.0' } });
    const xml = await res.text();
    const headlines = parseRSS(xml);
    if (headlines.length) cache = { data: headlines, ts: Date.now() };
    return headlines;
  } catch (_) {
    return cache.data || [];
  }
}

module.exports = { getHeadlines };
