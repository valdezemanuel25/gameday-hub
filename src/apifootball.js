// Both-score prices from API-Football (api-football.com, v3): the second source, used when The Odds API has no credits left or no
// match for a game. Display and tracking only: no model reads a price. Key: Worker secret APIFOOTBALL_KEY. Free plan: 100 requests a day.
//   One league on one day costs a fixtures list (to match teams: the odds feed only has fixture ids) plus the odds pages for the Both
//   Teams Score bet (10 fixtures a page), so about 2-3 requests. Prices are decimal and are turned into American odds like the rest.
//   The book is the one already on the card (so the opening and the close come from the same book), else bet365, else the first.
import { is as isName } from './forebetpage.js';

const BASE = 'https://v3.football.api-sports.io';
// API-Football league ids by the Hub's league slugs.
export const AF_LEAGUE = { 'eng.1': 39, 'eng.2': 40, 'ger.1': 78, 'esp.1': 140, 'ita.1': 135, 'fra.1': 61, 'ned.1': 88, 'usa.1': 253, 'mex.1': 262, 'bra.1': 71, 'uefa.champions': 2, 'uefa.europa': 3 };
const CALENDAR_YEAR = new Set(['usa.1', 'bra.1', 'mex.1']); // seasons that run inside one calendar year
// The season number API-Football wants: the year the season started (Aug 2026 to May 2027 is 2026).
export const seasonFor = (slug, date) => { const y = Number(String(date).slice(0, 4)), m = Number(String(date).slice(5, 7)); return CALENDAR_YEAR.has(slug) || m >= 7 ? y : y - 1; };
export const americanOf = d => { const x = Number(d); return Number.isFinite(x) && x > 1 ? Math.round(x >= 2 ? (x - 1) * 100 : -100 / (x - 1)) : null; };

// Pick the Yes / No prices of the Both Teams Score bet out of one odds item: the wanted book first, then bet365, then the first book.
export function parseAfBtts(item, prefer = []) {
  const books = (item && item.bookmakers) || [], low = b => String(b.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const order = [...prefer.map(p => String(p || '').toLowerCase().replace(/[^a-z0-9]/g, '')).filter(Boolean), 'bet365'].flatMap(p => books.filter(b => low(b) === p)).concat(books);
  for (const b of order) {
    const bet = (b.bets || []).find(x => /both teams (to )?score/i.test(x.name || '') && !/first|second|half|&|and/i.test(x.name || '')); if (!bet) continue;
    const y = (bet.values || []).find(v => /^yes$/i.test(v.value)), n = (bet.values || []).find(v => /^no$/i.test(v.value));
    const by = y && americanOf(y.odd), bn = n && americanOf(n.odd);
    if (by != null && bn != null) return { by, bn, bk: low(b) };
  }
  return null;
}
const HOUR = 3600e3;
// ESPN abbreviates some clubs the feeds spell out ("Athletico-PR" against "Athletico Paranaense"); the full name is tried as well.
export const spell = n => String(n || '').replace(/\bPR\b/, 'Paranaense').replace(/\bMG\b/, 'Mineiro');
export const same = (a, b) => isName(a, b) || isName(spell(a), b) || isName(a, spell(b));
// Match a card to a fixture: both team names AND kickoff within 3 hours. A miss means skip, never guess.
export function matchFixture(card, fixtures) {
  const t = new Date(card.kickoff).getTime();
  const hit = (fixtures || []).filter(x => x.teams && same(card.home, x.teams.home && x.teams.home.name) && same(card.away, x.teams.away && x.teams.away.name) && Math.abs(new Date(x.fixture && x.fixture.date).getTime() - t) <= 3 * HOUR);
  return hit.length === 1 ? hit[0] : null;
}
// Both-score prices for the given cards of ONE league on ONE day (YYYY-MM-DD, the Hub's local date).
// Returns { prices: Map(cardId -> { by, bn, bk }), skipped, left (requests left today), used } or { error }.
export async function fetchAfBtts(key, slug, date, cards, f = fetch, maxPages = 3) {
  const league = AF_LEAGUE[slug]; if (!league) return { error: 'No API-Football league for this slug' };
  if (!key) return { error: 'APIFOOTBALL_KEY is not set' };
  const season = seasonFor(slug, date), head = { headers: { 'x-apisports-key': key } };
  let left = null, used = 0; const out = new Map(), skipped = [];
  const get = async path => {
    const r = await f(`${BASE}${path}`, head); used++;
    const x = r.headers && r.headers.get && r.headers.get('x-ratelimit-requests-remaining'); if (x != null) left = Number(x);
    if (!r.ok) return { error: `API-Football ${r.status}` };
    const j = await r.json(); if (j && j.errors && (Array.isArray(j.errors) ? j.errors.length : Object.keys(j.errors).length)) { const m = JSON.stringify(j.errors).slice(0, 160); return { error: `API-Football: ${m}`, plan: /plan|subscription|season/i.test(m) }; }
    return j;
  };
  const fx = await get(`/fixtures?league=${league}&season=${season}&date=${date}`); if (fx.error) return fx;
  const mine = cards.map(c => ({ c, x: matchFixture(c, fx.response) }));
  for (const m of mine) if (!m.x) skipped.push(`${m.c.home} v ${m.c.away}`);
  const want = new Map(mine.filter(m => m.x).map(m => [m.x.fixture.id, m.c]));
  if (!want.size) return { prices: out, skipped, left, used };
  const items = [];
  for (let page = 1; page <= maxPages; page++) {
    const j = await get(`/odds?league=${league}&season=${season}&date=${date}&bet=8&page=${page}`); if (j.error) return items.length ? { prices: out, skipped, left, used, partial: j.error } : j;
    items.push(...(j.response || [])); if (!j.paging || page >= j.paging.total) break;
  }
  for (const [id, c] of want) {
    const it = items.find(i => i.fixture && i.fixture.id === id), p = it && parseAfBtts(it, [c.odds && c.odds.bk]);
    if (p) out.set(c.id, p); else skipped.push(`${c.home} v ${c.away}`);
  }
  return { prices: out, skipped, left, used };
}
// For checking by hand (the /api/apifootball-check page): the bet types that mention "both", and the raw Both Teams Score item
// for the first fixture of a league on a day. Reads at most 3 requests.
export async function checkAf(key, slug, date, f = fetch) {
  const league = AF_LEAGUE[slug]; if (!league || !key) return { error: !key ? 'APIFOOTBALL_KEY is not set' : 'No API-Football league for this slug' };
  const head = { headers: { 'x-apisports-key': key } }, season = seasonFor(slug, date), g = async p => { const r = await f(`${BASE}${p}`, head); return { status: r.status, left: r.headers && r.headers.get && r.headers.get('x-ratelimit-requests-remaining'), body: r.ok ? await r.json() : null }; };
  const bets = await g('/odds/bets?search=both'), odds = await g(`/odds?league=${league}&season=${season}&date=${date}&bet=8`);
  const first = odds.body && odds.body.response && odds.body.response[0];
  return { league, season, requestsLeftToday: odds.left, bets: bets.body ? bets.body.response : { status: bets.status }, oddsStatus: odds.status, errors: odds.body && odds.body.errors, fixtures: odds.body && odds.body.results, parsed: first ? parseAfBtts(first) : null, sample: first || null };
}
