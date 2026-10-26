// Both-teams-to-score prices from The Odds API (DraftKings). Display and tracking only: no model ever reads a price.
// The key lives in the Worker secret ODDS_API_KEY, never in code. Read on the same schedule as the ESPN price (src/worker.js addBtts):
// once when a game is first priced (the opening both-score price) and once at the lineup read (the close). Without the key nothing runs.
import { is as isName } from './forebetpage.js';

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
