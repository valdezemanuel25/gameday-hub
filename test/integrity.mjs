// Data-integrity checks (Nov 18, 2026 audit, docs/audit-2026-11-18/agent1-data-integrity.md): a game must not lose a step of its
// lifecycle (card, models, prices, pick, result) to a feed hiccup, a re-analysis or the cron's turns, and the records and the backups
// must count and carry each game once. Real Worker code, fake ESPN-shaped answers, in-memory KV.
import worker, { analyzeLeague, gradeLeague } from '../src/worker.js';

let fails = 0;
const ok = (name, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${cond ? '' : extra}`); };

const kv = new Map();
const env = {
  ADMIN_TOKEN: 'secret', GAME_HOURS: '2', GRADE_DELAY_HOURS: '3', ASSETS: { fetch: () => new Response('asset') },
  HUB: {
    get: async (k, type) => { const v = kv.get(k); return v == null ? null : type === 'json' ? JSON.parse(v) : v; },
    put: async (k, v) => { kv.set(k, v); }, delete: async k => { kv.delete(k); },
    list: async ({ prefix }) => ({ keys: [...kv.keys()].filter(k => k.startsWith(prefix)).sort().map(name => ({ name })), list_complete: true }),
  },
};
const H = 3600000, DATE = '2026-11-21';
// Two Premier League games on Saturday Nov 21 (Chicago): g1 at 9 AM (UTC Nov 21), g2 at 7 PM (UTC Nov 22, ESPN's next-day request).
const KO1 = '2026-11-21T15:00:00Z', KO2 = '2026-11-22T01:00:00Z';
const team = (id, name) => ({ id, displayName: name, abbreviation: name.slice(0, 3).toUpperCase() });
const DK = { provider: { name: 'DraftKings' }, moneyline: { home: { close: { odds: '-150' } }, draw: { close: { odds: '+260' } }, away: { close: { odds: '+400' } } } };
const ev = (id, date, h, a, { done = false, hs = 0, as = 0, odds = [DK], score = true } = {}) => ({ id, date, competitions: [{ status: { type: { completed: done } }, odds,
  competitors: [{ homeAway: 'home', team: team(...h), ...(score ? { score: String(hs) } : {}) }, { homeAway: 'away', team: team(...a), ...(score ? { score: String(as) } : {}) }] }] });
const ARS = [359, 'Arsenal'], BHA = [331, 'Brighton'], CHE = [363, 'Chelsea'], LIV = [364, 'Liverpool'];
let feed = {}, down = new Set(), hits = 0; // feed: 'YYYYMMDD' -> events; down: dates that answer 500
const setFeed = (...evs) => { feed = {}; for (const e of evs) (feed[e.date.slice(0, 10).replace(/-/g, '')] ||= []).push(e); };
globalThis.fetch = async url => {
  const u = String(url), m = /\/eng\.1\/scoreboard\?dates=(\d{8})/.exec(u);
  if (m) { hits++; return down.has(m[1]) ? new Response('down', { status: 500 }) : new Response(JSON.stringify({ events: feed[m[1]] || [] })); }
  return new Response(JSON.stringify({ events: [] }));
};
// eng.1's club context, as the sync step builds it (src/data.js buildContext): every club with 5 recent league games.
const recent = ['2026-10-18', '2026-10-25', '2026-11-01', '2026-11-04', '2026-11-08'].map((d, i) => [`${d}T15:00:00Z`, 1 + (i % 2), i % 3]);
const club = (name, rank) => ({ name, season: { gf: 15, ga: 10, gp: 11 }, last: { gf: 60, ga: 40, gp: 38 }, form: { gf: 7, ga: 5, n: 5 }, recent, rank });
const ctx = (ids = [ARS, BHA, CHE, LIV]) => kv.set('ctx:eng.1', JSON.stringify({ v: 4, slug: 'eng.1', leagueAvg: 1.4, builtAt: 0, teams: Object.fromEntries(ids.map(([id, n], i) => [String(id), club(n, i + 1)])) }));
const day = () => JSON.parse(kv.get(`day:${DATE}`));
const card = id => day().cards.find(c => c.id === id);
const patch = (id, f) => { const d = day(); f(d.cards.find(c => c.id === id)); kv.set(`day:${DATE}`, JSON.stringify(d)); };
const reset = () => { kv.delete(`day:${DATE}`); down = new Set(); ctx(); setFeed(ev('g1', KO1, ARS, BHA), ev('g2', KO2, CHE, LIV)); };
const before = new Date(Date.parse(KO1) - 24 * H);

// ---- 1. a feed that answers only in part keeps the cards it did not list ----
reset();
const a0 = await analyzeLeague(DATE, 'eng.1', env, before);
ok('setup: both games get full cards with a price', a0.cards === 2 && card('g1').v2 && card('g2').v2 && card('g2').odds && card('g2').odds.h === -150, JSON.stringify(a0));
patch('g2', c => { c.fb = { p: [50, 25, 25], at: 'x' }; c.odds.cl = 'kept'; });
down.add('20261122'); // the evening game's request fails
const a1 = await analyzeLeague(DATE, 'eng.1', env, new Date(before.getTime() + 7 * H));
ok('partial feed: the game ESPN did not answer for keeps its card, prices and Forebet', a1.debug.length && card('g2') && card('g2').odds.cl === 'kept' && card('g2').fb && card('g2').v2, JSON.stringify(day().cards.map(c => c.id)));
ok('partial feed: the game it did list is analyzed as usual', !!card('g1') && card('g1').v2);
down.clear();

// ---- 2. a game that kicked off is never dropped; an unstarted game ESPN moved away is ----
reset();
await analyzeLeague(DATE, 'eng.1', env, before);
setFeed(ev('g2', KO2, CHE, LIV)); // g1 no longer listed for the day (moved after kickoff); g2 still is
await analyzeLeague(DATE, 'eng.1', env, new Date(Date.parse(KO1) + H));
ok('a game past kickoff that ESPN stops listing keeps its card (gradeLeague looks for it on the next days)', !!card('g1') && !!card('g1').v2 && !!card('g1').odds);
setFeed(ev('g1', KO1, ARS, BHA)); // g2 moved to another day before kickoff
await analyzeLeague(DATE, 'eng.1', env, new Date(Date.parse(KO1) + 2 * H));
ok('an unstarted game ESPN moved to another day is dropped here (the new day gets it)', !card('g2') && !!card('g1'));
patch('g1', c => { c.final = { h: 1, a: 0 }; c.grade = { v2: { outcomeHit: 1 } }; });
setFeed(ev('g2', KO2, CHE, LIV));
await analyzeLeague(DATE, 'eng.1', env, new Date(Date.parse(KO1) + 3 * H));
ok('a graded card ESPN no longer lists for the day is never deleted by a re-analysis', !!card('g1') && card('g1').final && card('g1').final.h === 1 && day().cards.filter(c => c.id === 'g1').length === 1);

// ---- 3. a re-analysis that cannot find a club keeps the full card ----
reset();
await analyzeLeague(DATE, 'eng.1', env, before);
const full = card('g2');
ctx([ARS, BHA, CHE]); // Liverpool missing from the context on this run
await analyzeLeague(DATE, 'eng.1', env, new Date(before.getTime() + 7 * H));
const g2 = card('g2');
ok('club missing on a re-analysis: the card keeps its models and price (not rebuilt as skipped)', !g2.skipped && JSON.stringify(g2.v2) === JSON.stringify(full.v2) && g2.odds && g2.odds.h === -150, JSON.stringify(g2));
ok('club missing on a first analysis: still a skipped card (nothing to keep)', (kv.delete(`day:${DATE}`), await analyzeLeague(DATE, 'eng.1', env, before), !!card('g2').skipped));

// ---- 4. no in-play price: a game past the lock never takes ESPN's price ----
reset();
setFeed(ev('g1', KO1, ARS, BHA, { odds: [] }), ev('g2', KO2, CHE, LIV));
await analyzeLeague(DATE, 'eng.1', env, before); // g1 has no price before kickoff
ok('setup: g1 has no price before kickoff', !card('g1').odds);
setFeed(ev('g1', KO1, ARS, BHA), ev('g2', KO2, CHE, LIV)); // in play: ESPN now shows a (live) price
await analyzeLeague(DATE, 'eng.1', env, new Date(Date.parse(KO1) + 30 * 60000));
ok('re-analysis during the game does not save the in-play price as its opening and close', !card('g1').odds, JSON.stringify(card('g1').odds));
await analyzeLeague(DATE, 'eng.1', env, new Date(Date.parse(KO1) - 10 * 60000));
ok('nor inside the last 20 minutes (the lock)', !card('g1').odds);
await analyzeLeague(DATE, 'eng.1', env, new Date(Date.parse(KO1) - 3 * H));
ok('before the lock the price is taken as always', card('g1').odds && card('g1').odds.h === -150 && card('g1').odds.f);

// ---- 5. the shots numbers made before kickoff survive a re-analysis after the final whistle ----
reset();
await analyzeLeague(DATE, 'eng.1', env, before);
patch('g1', c => { c.sx = { h: [1, 2], a: [3, 4], mark: 'pre' }; });
setFeed(ev('g1', KO1, ARS, BHA, { done: true, hs: 2, as: 1 }), ev('g2', KO2, CHE, LIV));
await analyzeLeague(DATE, 'eng.1', env, new Date(Date.parse(KO1) + 3 * H));
ok('finished but not yet graded: the card keeps its shots numbers (the Shots record reads them)', card('g1').sx && card('g1').sx.mark === 'pre', JSON.stringify(card('g1').sx));

// ---- 6. grading: no grade on a missing score; the pick says which book its price came from ----
reset();
await analyzeLeague(DATE, 'eng.1', env, before);
setFeed(ev('g1', KO1, ARS, BHA, { done: true, score: false }), ev('g2', KO2, CHE, LIV));
const gn = await gradeLeague(DATE, 'eng.1', env, { force: true }, new Date(Date.parse(KO2) + 6 * H));
ok('a finished game with no score in the feed is left pending, not graded on NaN', gn.graded === 0 && !card('g1').final, JSON.stringify(gn));
patch('g1', c => { c.odds = { h: -400, d: 500, a: 1000, src: 'bet365', f: { h: -400, d: 500, a: 1000 } }; c.v6 = undefined; });
setFeed(ev('g1', KO1, ARS, BHA, { done: true, hs: 2, as: 0 }), ev('g2', KO2, CHE, LIV, { done: true, hs: 1, as: 1 }));
await gradeLeague(DATE, 'eng.1', env, { force: true }, new Date(Date.parse(KO2) + 6 * H));
const L = card('g1').lean;
ok('a pick priced from a stand-in book is labelled with that book (pbk)', L && (L.price == null || L.pbk === 'bet365'), JSON.stringify(L));
ok('a pick priced at DraftKings carries no book label', card('g2').lean && card('g2').lean.pbk === undefined, JSON.stringify(card('g2').lean));

// ---- 7. a game saved on two days counts once in the records ----
{
  const t0 = await (await worker.fetch(new Request('https://hub.test/api/tally', { headers: { 'x-admin-token': 'secret' } }), env)).json();
  const d = day(); kv.set('day:2026-11-22', JSON.stringify({ date: '2026-11-22', cards: d.cards.filter(c => c.id === 'g1') }));
  const t1 = await (await worker.fetch(new Request('https://hub.test/api/tally', { headers: { 'x-admin-token': 'secret' } }), env)).json();
  ok('tally: a graded game saved on two days (moved by ESPN) counts once', t1.newlyGraded === t0.newlyGraded && t1.v2.n === t0.v2.n && t1.leans.n === t0.leans.n, `${t0.newlyGraded} -> ${t1.newlyGraded}`);
  kv.delete('day:2026-11-22');
}

console.log(fails ? `\n${fails} FAILED` : '\nAll data-integrity checks passed');
process.exit(fails ? 1 : 0);
