'use strict';

const fetch = require('node-fetch');

const IN_GAME_TTL  = 30  * 1000;
const IDLE_TTL     = 10  * 60 * 1000;

// Cache keyed by `sport/league/team`
const caches = {};

function espnUrl(sport, league) {
  return (
    'https://site.api.espn.com/apis/site/v2/sports/' +
    encodeURIComponent(sport) + '/' + encodeURIComponent(league) + '/scoreboard'
  );
}

async function getSports(sport, league, team) {
  const key   = sport + '/' + league + '/' + (team || '');
  const entry = caches[key];
  const ttl   = entry && entry.data && entry.data.status === 'in_progress' ? IN_GAME_TTL : IDLE_TTL;

  if (entry && entry.data && Date.now() - entry.ts < ttl) return entry.data;

  try {
    const res  = await fetch(espnUrl(sport, league), {
      headers: { 'User-Agent': 'wall-assistant/1.0' },
      timeout: 8000,
    });
    const json = await res.json();

    const teamUpper = (team || '').toUpperCase();
    const event = (json.events || []).find((e) => {
      const comps = e.competitions && e.competitions[0];
      if (!comps) return false;
      return comps.competitors.some(
        (c) =>
          (c.team && c.team.abbreviation && c.team.abbreviation.toUpperCase() === teamUpper) ||
          (c.team && c.team.shortDisplayName && c.team.shortDisplayName.toUpperCase() === teamUpper)
      );
    });

    if (!event) {
      const data = { status: 'no_game', team };
      caches[key] = { data, ts: Date.now() };
      return data;
    }

    const comp   = event.competitions[0];
    const home   = comp.competitors.find((c) => c.homeAway === 'home');
    const away   = comp.competitors.find((c) => c.homeAway === 'away');
    const state  = event.status && event.status.type && event.status.type.state;
    const status = state === 'in'   ? 'in_progress'
                 : state === 'post' ? 'final'
                 :                    'scheduled';

    const data = {
      status,
      home: home ? { name: home.team && home.team.abbreviation, score: home.score } : null,
      away: away ? { name: away.team && away.team.abbreviation, score: away.score } : null,
      period: event.status && event.status.period,
      clock:  event.status && event.status.displayClock,
      date:   event.date,
      shortName: event.shortName,
    };

    caches[key] = { data, ts: Date.now() };
    return data;
  } catch (_) {
    return (entry && entry.data) || { status: 'error', team };
  }
}

module.exports = { getSports };
