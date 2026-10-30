// Both-teams-to-score prices from The Odds API (DraftKings). Display and tracking only: no model ever reads a price.
// The key lives in the Worker secret ODDS_API_KEY, never in code. Read on the same schedule as the ESPN price (src/worker.js addBtts):
// once when a game is first priced (the opening both-score price) and once at the lineup read (the close). Without the key nothing runs.
import { same as isName } from './names.js';

export const SPORT = { 'eng.2': 'soccer_efl_champ', 'eng.1': 'soccer_epl', 'ger.1': 'soccer_germany_bundesliga', 'esp.1': 'soccer_spain_la_liga', 'ita.1': 'soccer_italy_serie_a', 'fra.1': 'soccer_france_ligue_one', 'ned.1': 'soccer_netherlands_eredivisie', 'usa.1': 'soccer_usa_mls', 'mex.1': 'soccer_mexico_ligamx', 'bra.1': 'soccer_brazil_campeonato',
  'uefa.champions': 'soccer_uefa_champs_league', 'uefa.europa': 'soccer_uefa_europa_league' };
const BASE = 'https://api.the-odds-api.com/v4/sports';
const HOUR = 3600e3;

// Pick the Yes/No prices out of one event's odds. DraftKings first, else the first book that has the market.
export function parseBtts(ev) {
  const books = (ev && ev.bookmakers) || [];
  const order = [...books.filter(b => b.key === 'draftkings'), ...books.filter(b => b.key !== 'draftkings')];
  for (const b of order) {
    const mk = (b.markets || []).find(m => m.key === 'btts'); if (!mk) continue;
    const y = (mk.outcomes || []).find(o => /^yes$/i.test(o.name)), n = (mk.outcomes || []).find(o => /^no$/i.test(o.name));
    if (y && n && Number.isFinite(y.price) && Number.isFinite(n.price)) return { by: Math.round(y.price), bn: Math.round(n.price), bk: b.key };
  }
  return null;
}
// Match a card to an event: both team names must match AND kickoff within 3 hours. A miss means skip, never guess.
export function matchEvent(card, events) {
  const t = new Date(card.kickoff).getTime();
  const hit = (events || []).filter(e => isName(card.home, e.home_team) && isName(card.away, e.away_team) && Math.abs(new Date(e.commence_time).getTime() - t) <= 3 * HOUR);
  return hit.length === 1 ? hit[0] : null;
}
// Fetch Both-score prices for the given cards of ONE league. Returns Map(cardId -> {by,bn}) plus counts and credits left.
// The events list costs no credit; each game's price costs one. keep(card, left) is asked per game once the credits left are known
// (from the events call), so optional reads can be dropped when the month's credits run low.
export async function fetchBtts(key, slug, cards, f = fetch, keep = () => true) {
  const sport = SPORT[slug]; if (!sport) return { error: 'No price source for this league' };
  if (!key) return { error: 'ODDS_API_KEY is not set. Add it as a Worker secret.' };
  const out = new Map(); let left = null, used = 0, skipped = [];
  const note = r => { const x = r.headers && r.headers.get && r.headers.get('x-requests-remaining'); if (x != null) left = Number(x); };
  const er = await f(`${BASE}/${sport}/events?apiKey=${encodeURIComponent(key)}&dateFormat=iso`);
  note(er); if (!er.ok) return { error: `Odds API ${er.status}` };
  const events = await er.json();
  for (const c of cards) {
    if (!keep(c, left)) continue;
    const e = matchEvent(c, events); if (!e) { skipped.push(`${c.home} v ${c.away}`); continue; }
    const r = await f(`${BASE}/${sport}/events/${e.id}/odds?apiKey=${encodeURIComponent(key)}&regions=us&markets=btts&oddsFormat=american&dateFormat=iso`);
    note(r); used++; if (!r.ok) { skipped.push(`${c.home} v ${c.away}`); continue; }
    const p = parseBtts(await r.json()); if (p) out.set(c.id, p); else skipped.push(`${c.home} v ${c.away}`);
  }
  return { prices: out, left, used, skipped };
}

// ---- best price across books (the Analyst's price shopping, src/analyst.js) ----
// The US-regulated books the Analyst may take a price from. A Worker variable BOOKS (comma-separated Odds API keys) replaces the list,
// e.g. to keep only the books you have accounts with. Offshore books are left out on purpose.
export const BOOKS = ['draftkings', 'fanduel', 'betmgm', 'williamhill_us', 'betrivers', 'espnbet', 'fanatics', 'ballybet', 'hardrockbet'];
const decOf = m => (m > 0 ? 1 + m / 100 : 1 + 100 / -m);
// One event's best home / draw / away and Over / Under 2.5 prices among the allowed books: { H: { m, bk }, ... } (American odds).
export function bestPrices(ev, books = BOOKS) {
  const out = {}, ok = new Set(books), put = (k, m, bk) => { if (Number.isFinite(m) && (!out[k] || decOf(m) > decOf(out[k].m))) out[k] = { m: Math.round(m), bk }; };
  for (const b of (ev && ev.bookmakers) || []) {
    if (!ok.has(b.key)) continue;
    for (const mk of b.markets || []) {
      for (const o of mk.outcomes || []) {
        if (mk.key === 'h2h') put(o.name === ev.home_team ? 'H' : o.name === ev.away_team ? 'A' : /^draw$/i.test(o.name) ? 'D' : null, o.price, b.key);
        else if (mk.key === 'totals' && o.point === 2.5) put(/^over$/i.test(o.name) ? 'O' : /^under$/i.test(o.name) ? 'U' : null, o.price, b.key);
      }
    }
  }
  delete out.null;
  return out;
}
// Every book's 1X2 and totals for ONE league in one call. Costs 2 credits (two markets, one region) whatever the number of games.
// Returns Map(cardId -> bestPrices) for the cards that match an event, and the credits left.
export async function fetchBest(key, slug, cards, f = fetch, books = BOOKS) {
  const sport = SPORT[slug]; if (!sport) return { error: 'No price source for this league' };
  if (!key) return { error: 'ODDS_API_KEY is not set' };
  const r = await f(`${BASE}/${sport}/odds?apiKey=${encodeURIComponent(key)}&regions=us&markets=h2h,totals&oddsFormat=american&dateFormat=iso`);
  const x = r.headers && r.headers.get && r.headers.get('x-requests-remaining'), left = x != null ? Number(x) : null;
  if (!r.ok) return { error: `Odds API ${r.status}`, left };
  const events = await r.json(), out = new Map();
  for (const c of cards) { const e = matchEvent(c, events); if (e) out.set(c.id, bestPrices(e, books)); }
  return { prices: out, left };
}

// ---- the sharp price: DraftKings against a sharp book at the same moment (the Analyst's "stale price" rule, src/analyst.js) ----
// Sharp books in order of preference: Pinnacle, then the Betfair and Matchbook exchanges. Whichever the plan returns first is used.
export const SHARP = ['pinnacle', 'betfair_ex_eu', 'betfair_ex_uk', 'matchbook'];
const fair = (...ms) => { const q = ms.map(m => 1 / decOf(m)); let lo = 0.5, hi = 2, k = 1;
  for (let i = 0; i < 50; i++) { k = (lo + hi) / 2; const s = q.reduce((a, x) => a + Math.pow(x, k), 0); if (s > 1) lo = k; else hi = k; }
  const p = q.map(x => Math.pow(x, k)), s = p.reduce((a, b) => a + b, 0); return p.map(x => x / s); }; // power method, as src/v6core.js devig
const pricesOf = (ev, b) => {
  const out = {};
  for (const mk of b.markets || []) for (const o of mk.outcomes || []) {
    if (!Number.isFinite(o.price)) continue;
    if (mk.key === 'h2h') { const k = o.name === ev.home_team ? 'H' : o.name === ev.away_team ? 'A' : /^draw$/i.test(o.name) ? 'D' : null; if (k) out[k] = o.price; }
    else if (mk.key === 'totals' && o.point === 2.5) { const k = /^over$/i.test(o.name) ? 'O' : /^under$/i.test(o.name) ? 'U' : null; if (k) out[k] = o.price; }
  }
  return out;
};
// One event: { book, fair: { H, D, A, O?, U? } (chances 0-1, margin removed), dk: { H, D, A, O?, U? } (American) } or null without both.
export function sharpOf(ev) {
  const books = (ev && ev.bookmakers) || [], dkB = books.find(b => b.key === 'draftkings'); if (!dkB) return null;
  const dk = pricesOf(ev, dkB);
  for (const key of SHARP) {
    const b = books.find(x => x.key === key); if (!b) continue;
    const p = pricesOf(ev, b); if (![p.H, p.D, p.A].every(Number.isFinite)) continue;
    const f = fair(p.H, p.D, p.A), out = { book: key, fair: { H: f[0], D: f[1], A: f[2] }, dk };
    if (Number.isFinite(p.O) && Number.isFinite(p.U)) { const g = fair(p.O, p.U); out.fair.O = g[0]; out.fair.U = g[1]; }
    return out;
  }
  return null;
}
// DraftKings and the sharp books for ONE league in one call: 2 credits (two markets; up to 10 named books count as one region).
// Returns Map(cardId -> sharpOf) for the cards matched to an event, the books seen at all, and the credits left.
export async function fetchSharp(key, slug, cards, f = fetch) {
  const sport = SPORT[slug]; if (!sport) return { error: 'No price source for this league' };
  if (!key) return { error: 'ODDS_API_KEY is not set' };
  const r = await f(`${BASE}/${sport}/odds?apiKey=${encodeURIComponent(key)}&bookmakers=${['draftkings', ...SHARP].join(',')}&markets=h2h,totals&oddsFormat=american&dateFormat=iso`);
  const x = r.headers && r.headers.get && r.headers.get('x-requests-remaining'), left = x != null ? Number(x) : null;
  if (!r.ok) return { error: `Odds API ${r.status}`, left };
  const events = await r.json(), out = new Map(), seen = new Set();
  for (const e of events) for (const b of e.bookmakers || []) seen.add(b.key);
  for (const c of cards) { const e = matchEvent(c, events), s = e && sharpOf(e); if (s) out.set(c.id, s); }
  return { prices: out, books: [...seen], left };
}
