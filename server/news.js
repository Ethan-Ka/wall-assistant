'use strict';

const fetch = require('node-fetch');

// NPR top news — US-focused, includes <media:thumbnail> image tags
const DEFAULT_FEED = 'https://feeds.npr.org/1001/rss.xml';
const CACHE_TTL    = 15 * 60 * 1000;

// Keyed by feed URL — different slots can use different feeds
const caches = {};

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
  // Handles BBC <media:thumbnail url="..."> and CNN <media:content url="...">
  const thumbRe = /<media:(?:thumbnail|content)[^>]+url=["']([^"']+)["']/;
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

// feedUrl: optional override; defaults to BBC RSS
async function getHeadlines(feedUrl) {
  const url   = feedUrl || DEFAULT_FEED;
  const entry = caches[url];
  if (entry && entry.data && Date.now() - entry.ts < CACHE_TTL) return entry.data;
  try {
    const res       = await fetch(url, { headers: { 'User-Agent': 'wall-assistant/1.0' }, timeout: 8000 });
    const xml       = await res.text();
    const headlines = parseRSS(xml);
    if (headlines.length) caches[url] = { data: headlines, ts: Date.now() };
    return headlines;
  } catch (_) {
    return (entry && entry.data) || [];
  }
}

module.exports = { getHeadlines };
