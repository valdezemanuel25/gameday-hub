// Data-integrity checks (Nov 18, 2026 audit, docs/audit-2026-11-18/agent1-data-integrity.md): a game must not lose a step of its
// lifecycle (card, models, prices, pick, result) to a feed hiccup, a re-analysis or the cron's turns, and the records and the backups
// must count and carry each game once. Real Worker code, fake ESPN-shaped answers, in-memory KV.
import worker, { analyzeLeague, gradeLeague, runSlot, NO_GAMES_RECHECK_H } from '../src/worker.js';

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
const ev = (id, date, h, a, { done = false, hs = 0, as = 0, odds = [DK], score = true, st = null, details = undefined } = {}) => ({ id, date, competitions: [{ status: { type: { completed: done, ...(st ? { name: st } : {}) } }, odds, ...(details ? { details } : {}),
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

// ---- 8. the cron's analyze slot: first analyses first, hockey gets every other turn, empty leagues are looked at less often ----
{
  const slot2 = (nhlTurn, base = Date.parse('2026-11-21T18:00:00Z')) => { let t = base; while ((Math.floor(t / 1200000) % 2 === 1) !== nhlTurn) t += 1200000; return new Date(t); };
  const LGS = ['eng.1', 'ger.1', 'esp.1', 'esp.2', 'ita.1', 'ned.1', 'ger.2', 'fra.1', 'eng.2', 'usa.1', 'mex.1', 'bra.1', 'uefa.champions', 'uefa.europa', 'uefa.nations'];
  const seed = (now, ago, skip = null) => { for (const d of ['2026-11-21', '2026-11-22']) kv.set(`day:${d}`, JSON.stringify({ date: d, analyzed: Object.fromEntries(LGS.filter(l => l !== skip).map(l => [l, now.getTime() - ago])),
    cards: d === '2026-11-21' ? [{ id: 'z1', league: 'eng.1', kickoff: '2026-11-22T01:00:00Z', v2: { p: [40, 30, 30] }, final: null }] : [] })); };
  let now = slot2(true); seed(now, 7 * H);
  const r1 = await runSlot(env, now, 2);
  ok('analyze slot: a re-analysis gives every other turn to the hockey job', r1.job === 'nhl', JSON.stringify(r1));
  now = slot2(false); seed(now, 7 * H);
  const r2 = await runSlot(env, now, 2);
  ok('analyze slot: on the other turn the re-analysis runs (the league with games)', r2.job === 'analyze' && r2.league === 'eng.1' && r2.date === '2026-11-21', JSON.stringify(r2));
  now = slot2(true); seed(now, 7 * H, 'fra.1');
  const r3 = await runSlot(env, now, 2);
  ok('analyze slot: a league never analyzed for the day goes first, even on hockey\'s turn', r3.job === 'analyze' && r3.league === 'fra.1', JSON.stringify(r3));
  now = slot2(false); seed(now, 7 * H); kv.set('day:2026-11-21', JSON.stringify({ ...JSON.parse(kv.get('day:2026-11-21')), cards: [] }));
  const r4 = await runSlot(env, now, 2);
  ok(`analyze slot: a league with no games that day waits ${NO_GAMES_RECHECK_H} hours, not 6`, r4.job === 'nhl', JSON.stringify(r4));
  now = slot2(false); seed(now, (NO_GAMES_RECHECK_H + 1) * H); kv.set('day:2026-11-21', JSON.stringify({ ...JSON.parse(kv.get('day:2026-11-21')), cards: [] }));
  const r5 = await runSlot(env, now, 2);
  ok('analyze slot: ...and is looked at again after that', r5.job === 'analyze' && r5.league === 'eng.1', JSON.stringify(r5));
  for (const d of ['2026-11-21', '2026-11-22']) kv.delete(`day:${d}`);
}

// ---- 9. the backups carry the records kept outside the day cards ----
{
  kv.set('analyst', JSON.stringify({ v: 1, items: [{ id: 's1', rule: 'move', key: 'H', date: DATE, gid: 'g1', league: 'eng.1' }, { id: 'h1', sport: 'nhl', rule: 'hmove', key: 'A', date: DATE, gid: '9001' }],
    old: [['2026-11-01T15:00:00Z', 'move', 'H', 200, 'win', 0.8, 1.2, -120, -120, 0.8, null, null, '2026-11-01|g0', 'eng.1'], ['2026-11-01T23:00:00Z', 'hmove', 'A', 100, 'loss', -1, 0, 110, null, null, 'nhl', null, '2026-11-01|9000', null]] }));
  kv.set('bets', JSON.stringify({ v: 1, items: [{ id: 'b1', legs: [{ date: DATE, id: 'g1', key: 'H' }] }] }));
  kv.set('nhl:day:2026-11-21', JSON.stringify({ date: '2026-11-21', cards: [] }));
  const get = p => worker.fetch(new Request('https://hub.test' + p, { headers: { 'x-admin-token': 'secret' } }), env);
  const x = await (await get('/api/backup-extra')).json();
  ok('soccer backup: the Analyst\'s soccer bets (open and short rows) and the tracked bets', x.analyst.items.length === 1 && x.analyst.items[0].id === 's1' && x.analyst.old.length === 1 && x.analyst.old[0][1] === 'move' && x.analyst.oldFields.length === 14 && x.bets.items[0].id === 'b1', JSON.stringify(x));
  const n = await (await get('/api/nhl/export')).json();
  ok('hockey backup: the Analyst\'s hockey bets only', n.analyst.items.length === 1 && n.analyst.items[0].id === 'h1' && n.analyst.old.length === 1 && n.analyst.old[0][10] === 'nhl' && n.days.length === 1, JSON.stringify(n.analyst));
}

// ---- 10. extra time is graded on the 90 minutes; postponed games are void (Agent 3's findings) ----
{
  const goal = (team, disp, value) => ({ scoringPlay: true, team: { id: team }, clock: { displayValue: disp, value } });
  reset();
  await analyzeLeague(DATE, 'eng.1', env, before);
  kv.set('analyst', JSON.stringify({ v: 1, items: [{ id: 'pp', rule: 'move', key: 'H', price: -150, kickoff: KO2, mins: 200, date: DATE, gid: 'g2', league: 'eng.1', home: 'Chelsea', away: 'Liverpool' }] }));
  // g1: 1-1 after 90 minutes (the equaliser in stoppage time), 2-1 after extra time. g2: postponed.
  setFeed(ev('g1', KO1, ARS, BHA, { done: true, hs: 2, as: 1, st: 'STATUS_FINAL_AET', details: [goal(359, "12'", 720), goal(331, "90'+4'", 5640), goal(359, "104'", 6240)] }),
    ev('g2', KO2, CHE, LIV, { st: 'STATUS_POSTPONED' }));
  const g = await gradeLeague(DATE, 'eng.1', env, { force: true }, new Date(Date.parse(KO2) + 6 * H));
  const c1 = card('g1'), c2 = card('g2'), b = JSON.parse(kv.get('analyst')).items.find(x => x.id === 'pp');
  ok('after extra time: graded on the 90-minute score (1-1, a draw), ESPN\'s 2-1 kept as ft', c1.final && c1.final.h === 1 && c1.final.a === 1 && c1.final.et === 'aet' && c1.final.ft.join() === '2,1' && c1.grade && c1.lean && c1.lean.hit === (c1.lean.key === 'D' || c1.lean.key === 'B' || c1.lean.key === 'U'), JSON.stringify(c1.final));
  ok('after extra time: the early-payout lead is the 90 minutes\' lead', c1.final.lead && c1.final.lead.join() === '1,0', JSON.stringify(c1.final.lead));
  ok('postponed: the card is closed as void, not graded and not left pending', c2.void === 'postponed' && !c2.final && g.voided === 1 && g.pending === 0, JSON.stringify(g));
  ok('postponed: the Analyst\'s bet on it is void', b && b.res === 'void' && b.units === 0, JSON.stringify(b));
  const due = await runSlot(env, new Date(Date.parse(KO2) + 7 * H), 1);
  ok('postponed: the league is no longer due in the grading slot', due.league !== 'eng.1' || due.date !== DATE, JSON.stringify(due));
  await analyzeLeague(DATE, 'eng.1', env, new Date(Date.parse(KO2) + 8 * H));
  ok('postponed: a re-analysis keeps the card void', card('g2').void === 'postponed');
  // penalties with a goal whose minute cannot be told: void, never graded on the wrong score
  reset();
  await analyzeLeague(DATE, 'eng.1', env, before);
  setFeed(ev('g1', KO1, ARS, BHA, { done: true, hs: 1, as: 1, st: 'STATUS_FINAL_PEN', details: [goal(359, undefined, 5700), goal(331, "30'", 1800)] }), ev('g2', KO2, CHE, LIV, { done: true, hs: 0, as: 0 }));
  await gradeLeague(DATE, 'eng.1', env, { force: true }, new Date(Date.parse(KO2) + 6 * H));
  ok('penalties, 90-minute score unknown: void with ESPN\'s score kept, not graded', card('g1').void && /pen/.test(card('g1').void) && !card('g1').final && card('g1').ft.join() === '1,1', JSON.stringify(card('g1')));
  ok('a normal final in the same league is graded as always', card('g2').final && card('g2').final.h === 0 && !card('g2').final.et);
  kv.delete('analyst');
}

// ---- 11. SportsMole is not attached to a game that has started ----
{
  reset();
  await analyzeLeague(DATE, 'eng.1', env, before);
  kv.set('sm:list', JSON.stringify({ at: Date.parse(KO1), links: [] }));
  const r = await runSlot(env, new Date(Date.parse(KO2) + 30 * 60000), 3); // both games under way
  ok('SportsMole slot: games under way are not looked up', r.job !== 'sportsmole' || r.idle, JSON.stringify(r));
  const { smLeague } = await import('../src/worker.js');
  const r2 = await smLeague(DATE, 'eng.1', env, new Date(Date.parse(KO2) + 30 * 60000), { force: true });
  ok('SportsMole button (force): nothing to do once the games have started', r2.idle === true && !card('g1').sm, JSON.stringify(r2));
}

// ---- 13. hockey: a postponed game is void, not left waiting ----
{
  const { nhlStep } = await import('../src/nhl.js');
  const nd = '2026-11-20', nkey = `nhl:day:${nd}`;
  kv.set(nkey, JSON.stringify({ date: nd, cards: [{ id: '9101', kickoff: '2026-11-21T00:00:00Z', home: 'Edmonton Oilers', away: 'Detroit Red Wings', hAbbr: 'EDM', aAbbr: 'DET', final: null, v2: { w: 55, o: 50 } }] }));
  const hev = { id: '9101', date: '2026-11-21T00:00:00Z', competitions: [{ status: { type: { completed: false, name: 'STATUS_POSTPONED', shortDetail: 'Postponed' } },
    competitors: [{ homeAway: 'home', team: { abbreviation: 'EDM', displayName: 'Edmonton Oilers' }, score: '0' }, { homeAway: 'away', team: { abbreviation: 'DET', displayName: 'Detroit Red Wings' }, score: '0' }] }] };
  const fetchH = async u => new Response(JSON.stringify({ events: String(u).includes('dates=20261120') ? [hev] : [] }));
  const r = await nhlStep(env, new Date('2026-11-21T12:00:00Z'), fetchH, { mode: 'results' });
  ok('hockey: a postponed game\'s card is closed as void', JSON.parse(kv.get(nkey)).cards[0].void === 'postponed' && r.voided === 1, JSON.stringify(r));
}

console.log(fails ? `\n${fails} FAILED` : '\nAll data-integrity checks passed');
process.exit(fails ? 1 : 0);
