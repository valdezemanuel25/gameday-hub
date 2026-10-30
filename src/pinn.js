// Pinnacle prices from PinnOdds (pinnodds.com): the sharp reference next to DraftKings. Display and tracking only: no model reads a price.
// Key: Worker secret PINNODDS_KEY, sent as the x-portal-apikey header. The trial plan is 100 requests a day in all.
//   One call, GET /kit/v1/prematch/fixtures?sport_id=1, returns every prematch soccer fixture in the world with its home / draw / away
//   and totals (decimal prices, period num_0 = the full match). So a whole day's games for every league cost ONE request, and the
//   trimmed list is kept for 10 minutes in the free edge cache so the leagues read in the same run share it.
//   The first price the Hub saw (pf) is not Pinnacle's true opening price; the close is the read at the lineup window (pcl).
import { same, americanOf } from './apifootball.js';

const BASE = 'https://pinnodds.com';
export const PN_LIST_TTL = 600; // seconds a trimmed fixture list is reused
const HOUR = 3600e3;
const SKIP = /\(women\)|\bwomen\b|\bU-?\d{2}\b|\breserves?\b|\bII\b/i; // women's, youth and reserve sides share names with the senior clubs
// Pinnacle lists the same teams again in side markets ("England - Championship Bookings", corners, cards...): their money line is on
// something else, so they must never be taken for the match result.
const SIDE = /\b(bookings?|corners?|cards?|shots?|offsides?|fouls?|throw-?ins?|goal kicks?|specials?|props?|fantasy|e-?soccer|esports?|simulated|sim)\b/i;

// The fixtures JSON trimmed to what the Hub needs: [{ id, lg, home, away, t (ms), h, d, a (American), tl, to, tu (the 2.5 total only) }].
// Events with no complete home / draw / away price, special rows and women's / youth / reserve sides are left out.
export function reduceEvents(j) {
  const out = [];
  for (const e of (j && j.events) || []) {
    if (!e || e.special || SKIP.test(`${e.home} ${e.away} ${e.league_name}`) || SIDE.test(String(e.league_name || ''))) continue;
    const p = e.periods && e.periods.num_0, ml = p && p.money_line; if (!ml) continue;
    const h = americanOf(ml.home), d = americanOf(ml.draw), a = americanOf(ml.away); if (h == null || d == null || a == null) continue;
    const t = new Date(e.starts).getTime(); if (!Number.isFinite(t)) continue;
    const row = { id: e.event_id, lg: e.league_name, home: e.home, away: e.away, t, h, d, a };
    const tt = p.totals && p.totals['2.5']; if (tt) { const to = americanOf(tt.over), tu = americanOf(tt.under); if (to != null && tu != null) { row.tl = 2.5; row.to = to; row.tu = tu; } }
    out.push(row);
  }
  return out;
}
// Match a card to a fixture: both team names AND kickoff within 3 hours. A miss means skip, never guess.
export function matchPinn(card, events) {
  const t = new Date(card.kickoff).getTime();
  const hit = (events || []).filter(e => same(card.home, e.home) && same(card.away, e.away) && Math.abs(e.t - t) <= 3 * HOUR);
  return hit.length === 1 ? hit[0] : null;
}
// One request for every soccer fixture. { events, bytes, age } or { error, limited?, retryMs? }.
export async function fetchPinn(key, f = fetch) {
  if (!key) return { error: 'PINNODDS_KEY is not set' };
  let r; try { r = await f(`${BASE}/kit/v1/prematch/fixtures?sport_id=1`, { headers: { 'x-portal-apikey': key } }); } catch (e) { return { error: `PinnOdds: ${e && e.message || e}` }; }
  const hd = k => (r.headers && r.headers.get ? r.headers.get(k) : null);
  if (r.status === 429) { const ra = Number(hd('retry-after')); return { error: 'PinnOdds: rate limited', limited: true, retryMs: Number.isFinite(ra) ? ra * 1000 : null }; }
  if (!r.ok) return { error: `PinnOdds ${r.status}` };
  if (hd('x-data-status') === 'stale') return { error: 'PinnOdds: the prematch feed is stale (prices withheld)' };
  let txt, j; try { txt = await r.text(); j = JSON.parse(txt); } catch (e) { return { error: 'PinnOdds: answer was not JSON' }; }
  return { events: reduceEvents(j), bytes: txt.length, age: hd('x-data-age-ms') != null ? Number(hd('x-data-age-ms')) : null, status: hd('x-data-status') };
}

// What a card holds: px = { h, d, a, tl?, to?, tu? } (American), pf = the first one seen, pcl = when the closing read was taken.
export const pinnPrice = e => ({ h: e.h, d: e.d, a: e.a, ...(e.tl != null ? { tl: e.tl, to: e.to, tu: e.tu } : {}) });

// The shared fixture list: the edge cache first (no request), else one request. Failures are remembered for a few minutes so a bad
// answer is not asked again by every league; a rate limit holds until the limit says it lifts (default: until UTC midnight).
const KEY = k => `https://hub.local/pinn-${k}`;
const cacheOn = () => typeof caches !== 'undefined' && caches.default;
const getC = async k => { try { const r = cacheOn() ? await cacheOn().match(KEY(k)) : null; return r ? await r.json() : null; } catch (e) { return null; } };
const putC = async (k, v, ttl) => { try { if (cacheOn()) await cacheOn().put(KEY(k), new Response(JSON.stringify(v), { headers: { 'cache-control': `max-age=${Math.max(1, Math.round(ttl))}` } })); } catch (e) { /* ignore */ } };
export async function pinnEvents(env, f = fetch, now = new Date()) {
  if (!env.PINNODDS_KEY) return { error: 'PINNODDS_KEY is not set' };
  const bad = await getC('err'); if (bad) return { error: bad.error };
  const hit = await getC('list'); if (hit) return { events: hit.events, cached: true };
  const r = await fetchPinn(env.PINNODDS_KEY, f);
  if (r.error) { const toMidnight = (Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime()) / 1000; await putC('err', { error: r.error }, r.limited ? (r.retryMs != null ? r.retryMs / 1000 : toMidnight) : 300); return { error: r.error }; }
  await putC('list', { events: r.events }, PN_LIST_TTL);
  await putC('last', { at: now.toISOString(), n: r.events.length, bytes: r.bytes, age: r.age, status: r.status }, 86400);
  return { events: r.events };
}
export const pinnState = async () => ({ last: await getC('last'), error: (await getC('err')) || null });
