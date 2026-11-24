// Grading, round 2 (Nov 18, 2026, docs/audit-2026-11-18/round2-agent1.md):
//   * Model bets / the headline profit count DraftKings prices only (a stand-in or another book's both-score price is kept, not counted);
//   * a finished game with no lineup read takes ESPN's DraftKings close for the Movement tab and closing-line value, after the pick locked;
//   * the grading slot looks back to today -3, and the early-payout lead is tried again (3 tries in all) when ESPN's goal list was missing.
// Real Worker code, fake ESPN-shaped answers, in-memory KV (the same set-up as test/integrity.mjs).
import worker, { analyzeLeague, gradeLeague, runSlot, LEAD_TRIES, espnCloseSoccer } from '../src/worker.js';
import { priceFor, priceVerdict } from '../src/pick.js';

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
const H = 3600000, DATE = '2026-11-21', KO1 = '2026-11-21T15:00:00Z', KO2 = '2026-11-21T20:00:00Z';
const team = (id, name) => ({ id, displayName: name, abbreviation: name.slice(0, 3).toUpperCase() });
const DK = (h, d, a) => ({ provider: { name: 'DraftKings' }, moneyline: { home: { close: { odds: h } }, draw: { close: { odds: d } }, away: { close: { odds: a } } } });
const ev = (id, date, hm, aw, { done = false, hs = 0, as = 0, odds = [DK('-150', '+260', '+400')], details } = {}) => ({ id, date, competitions: [{ status: { type: { completed: done } }, odds, ...(details ? { details } : {}),
  competitors: [{ homeAway: 'home', team: team(...hm), score: String(hs) }, { homeAway: 'away', team: team(...aw), score: String(as) }] }] });
const ARS = [359, 'Arsenal'], BHA = [331, 'Brighton'], CHE = [363, 'Chelsea'], LIV = [364, 'Liverpool'];
let feed = {}, hits = 0;
const setFeed = (...evs) => { feed = {}; for (const e of evs) (feed[e.date.slice(0, 10).replace(/-/g, '')] ||= []).push(e); };
globalThis.fetch = async url => {
  const u = String(url), m = /\/eng\.1\/scoreboard\?dates=(\d{8})/.exec(u);
  if (m) { hits++; return new Response(JSON.stringify({ events: feed[m[1]] || [] })); }
  return new Response(JSON.stringify({ events: [] }));
};
const recent = ['2026-10-18', '2026-10-25', '2026-11-01', '2026-11-04', '2026-11-08'].map((d, i) => [`${d}T15:00:00Z`, 1 + (i % 2), i % 3]);
const club = (name, rank) => ({ name, season: { gf: 15, ga: 10, gp: 11 }, last: { gf: 60, ga: 40, gp: 38 }, form: { gf: 7, ga: 5, n: 5 }, recent, rank });
kv.set('ctx:eng.1', JSON.stringify({ v: 4, slug: 'eng.1', leagueAvg: 1.4, builtAt: 0, teams: Object.fromEntries([ARS, BHA, CHE, LIV].map(([id, n], i) => [String(id), club(n, i + 1)])) }));
const day = (d = DATE) => JSON.parse(kv.get(`day:${d}`));
const card = (id, d = DATE) => day(d).cards.find(c => c.id === id);
const patch = (id, f, d = DATE) => { const x = day(d); f(x.cards.find(c => c.id === id)); kv.set(`day:${d}`, JSON.stringify(x)); };
const fresh = async () => { kv.delete(`day:${DATE}`); setFeed(ev('g1', KO1, ARS, BHA), ev('g2', KO2, CHE, LIV)); await analyzeLeague(DATE, 'eng.1', env, new Date(Date.parse(KO1) - 24 * H)); };
const after = new Date(Date.parse(KO2) + 6 * H);
const goal = (t, disp, value) => ({ scoringPlay: true, team: { id: t }, clock: { displayValue: disp, value } });

// ---- item 2: the profit record counts DraftKings prices only ----
await fresh();
ok('setup: both cards carry DraftKings prices', card('g1').odds && !card('g1').odds.src && card('g2').odds && card('g2').odds.h === -150);
patch('g2', c => { c.odds = { ...c.odds, src: 'bet365', h: -400, d: 500, a: 1000 }; });
setFeed(ev('g1', KO1, ARS, BHA, { done: true, hs: 2, as: 0 }), ev('g2', KO2, CHE, LIV, { done: true, hs: 1, as: 1 }));
const lock1 = priceFor(card('g1').odds, 'H'); // the price on the card when the pick locks
await gradeLeague(DATE, 'eng.1', env, { force: true }, after);
const L1 = card('g1').lean, L2 = card('g2').lean;
ok('a DraftKings price is the pick\'s price (counted) and carries no book', L1 && L1.key === 'H' && L1.price === lock1 && lock1 === -150 && !L1.pbk && L1.spx === undefined, JSON.stringify(L1));
ok('the saved price tag (vd) is the Results tab\'s own (priceVerdict: v4 against DraftKings), so a backup matches the page', L1.vd != null && L1.vd === priceVerdict(card('g1'), L1), JSON.stringify(L1));
ok('a stand-in price is kept on the pick (spx, with its book) but not as its counted price', L2 && L2.price === undefined && L2.vd === undefined && L2.pbk === 'bet365' && Number.isFinite(L2.spx), JSON.stringify(L2));
// both-score: Pinnacle's price is not counted, DraftKings' is
{
  await fresh();
  const btts = bk => c => { c.v6 = { ...(c.v6 || {}), p: [30, 30, 40], over: 45, btts: 80, pick: 'A' }; c.odds = { ...c.odds, by: -200, bn: 160, bk }; };
  patch('g1', btts('pinnacle')); patch('g2', btts('draftkings'));
  setFeed(ev('g1', KO1, ARS, BHA, { done: true, hs: 1, as: 1 }), ev('g2', KO2, CHE, LIV, { done: true, hs: 2, as: 1 }));
  await gradeLeague(DATE, 'eng.1', env, { force: true }, after);
  const a = card('g1').lean, b = card('g2').lean;
  ok('both-score pick at Pinnacle\'s price: book named, not counted', a && a.key === 'B' && a.price === undefined && a.pbk === 'pinnacle' && a.spx === -200, JSON.stringify(a));
  ok('both-score pick at DraftKings\' price: counted', b && b.key === 'B' && b.price === -200 && !b.pbk, JSON.stringify(b));
  // the Results page: an earlier pick locked at a stand-in price keeps its price and still counts (records are not rewritten)
  kv.set('day:2026-11-10', JSON.stringify({ date: '2026-11-10', cards: [{ id: 'old', league: 'eng.1', leagueName: 'Premier League', home: 'X', away: 'Y', kickoff: '2026-11-10T15:00:00Z', v2: { p: [50, 25, 25] },
    final: { h: 1, a: 0 }, grade: { v2: { outcomeHit: 1, ouHit: 0, bttsHit: 0, brier: 0.3 } }, lean: { k: 'lean', key: 'H', p: 50, y: 1, a: 1, hit: true, price: 150, pbk: 'pinnacle', vd: 'fair' } }] }));
  const t = await (await worker.fetch(new Request('https://hub.test/api/tally', { headers: { 'x-admin-token': 'secret' } }), env)).json();
  ok('Results: profit counts the DraftKings pick and the earlier stand-in pick as saved, not the new Pinnacle one', t.leans.pl && t.leans.pl.n === 2 && t.leans.n === 3, JSON.stringify({ pl: t.leans.pl && t.leans.pl.n, n: t.leans.n }));
  kv.delete('day:2026-11-10');
}

// ---- item 3: ESPN's close on a finished game with no lineup read (DraftKings only), after the pick locked ----
{
  await fresh();
  patch('g2', c => { c.odds.cl = '2026-11-21T19:35:00Z'; c.odds.h = -160; }); // g2 had its lineup read
  const v6 = JSON.stringify(card('g1').v6), pre = card('g1').odds;
  setFeed(ev('g1', KO1, ARS, BHA, { done: true, hs: 2, as: 0, odds: [DK('-200', '+300', '+550')] }), ev('g2', KO2, CHE, LIV, { done: true, hs: 0, as: 1, odds: [DK('-300', '+400', '+700')] }));
  const g = await gradeLeague(DATE, 'eng.1', env, { force: true }, after);
  const c1 = card('g1'), c2 = card('g2');
  ok('no lineup read: ESPN\'s close is saved (cl = kickoff, cls espn)', c1.odds.cl === KO1 && c1.odds.cls === 'espn' && c1.odds.h === -200 && c1.odds.d === 300 && c1.odds.a === 550 && g.closed === 1, JSON.stringify(c1.odds));
  ok('...the opening price is kept (Movement compares one book)', JSON.stringify(c1.odds.f) === JSON.stringify(pre.f));
  ok('...and the pick\'s price is the one shown when it locked, not the close', c1.lean && c1.lean.key === 'H' && c1.lean.price === pre.h && pre.h === -150 && c1.odds.h === -200, JSON.stringify([c1.lean, pre]));
  ok('...v6 (frozen at kickoff) is not touched', JSON.stringify(c1.v6) === v6);
  ok('a card with its own lineup read keeps it', c2.odds.cl === '2026-11-21T19:35:00Z' && c2.odds.h === -160 && !c2.odds.cls, JSON.stringify(c2.odds));
  const st = { kickoff: KO1, odds: { h: -400, d: 500, a: 1000, src: 'bet365' } };
  ok('a stand-in card is never given a close (one book; the Analyst never takes a stand-in close)', !espnCloseSoccer(st, { h: -380, d: 480, a: 900, src: 'bet365' }) && !espnCloseSoccer(st, { h: -380, d: 480, a: 900 }) && !st.odds.cl);
  ok('ESPN\'s close in another book\'s odds is not taken on a DraftKings card', !espnCloseSoccer({ kickoff: KO1, odds: { h: -150, d: 260, a: 400 } }, { h: -380, d: 480, a: 900, src: 'bet365' }));
}

// ---- item 4: grading reach (today -3) and the early-payout lead tried again ----
{
  // a league that could not be graded for three days is still graded by the cron (the Analyst voids at 4)
  await fresh();
  setFeed(ev('g1', KO1, ARS, BHA, { done: true, hs: 1, as: 0, details: [goal(359, "10'", 600)] }), ev('g2', KO2, CHE, LIV, { done: true, hs: 0, as: 0, details: [] }));
  const d3 = new Date('2026-11-24T18:00:00Z'); // Chicago: Nov 24, so Nov 21 is today -3
  const r = await runSlot(env, d3, 1);
  ok('grading slot: a league from today -3 is graded', r.job === 'grade' && r.date === DATE && r.graded === 2, JSON.stringify(r));
  await fresh();
  const r4 = await runSlot(env, new Date('2026-11-25T18:00:00Z'), 1);
  ok('grading slot: today -4 is past its reach (the Analyst has voided by then)', !(r4.job === 'grade' && r4.date === DATE), JSON.stringify(r4));

  // the lead: ESPN's goal list missing at grading -> try 1 of 3; later tries read it
  await fresh();
  setFeed(ev('g1', KO1, ARS, BHA, { done: true, hs: 3, as: 1 }), ev('g2', KO2, CHE, LIV, { done: true, hs: 0, as: 2, details: [goal(364, "5'", 300), goal(364, "50'", 3000)] }));
  await gradeLeague(DATE, 'eng.1', env, { force: true }, after);
  ok('grading with no goal list: no lead, and the try is counted on the card', !card('g1').final.lead && card('g1').final.ldt === 1 && card('g2').final.lead && card('g2').final.lead.join() === '0,2' && !card('g2').final.ldt, JSON.stringify([card('g1').final, card('g2').final]));
  patch('g2', c => { c.final.lead = undefined; c.final.ldt = LEAD_TRIES; }); // a card that has used its tries is left alone
  setFeed(ev('g1', KO1, ARS, BHA, { done: true, hs: 3, as: 1, details: [goal(331, "3'", 180), goal(359, "20'", 1200), goal(359, "40'", 2400), goal(359, "60'", 3600)] }), ev('g2', KO2, CHE, LIV, { done: true, hs: 0, as: 2, details: [goal(364, "5'", 300), goal(364, "50'", 3000)] }));
  hits = 0;
  const lr = await runSlot(env, new Date(Date.parse(KO2) + 7 * H), 1);
  const f1 = card('g1').final, l1 = card('g1').lean;
  ok('idle grading turn: the lead is read again and saved, the try count cleared', lr.job === 'lead' && lr.found === 1 && f1.lead && f1.lead.join() === '2,1' && f1.ldt === undefined, JSON.stringify([lr, f1]));
  ok('...the pick\'s early-payout mark is worked out from it (a home pick that won)', l1 && l1.key === 'H' && l1.hit && l1.ep === true, JSON.stringify(l1));
  ok('...a card that used its 3 tries is not read again', card('g2').final.ldt === LEAD_TRIES && !card('g2').final.lead);
  ok('...inside the request budget: two ESPN requests (one league, one day)', hits === 2, String(hits));
  patch('g1', c => { delete c.final.lead; c.final.ldt = 1; });
  setFeed(ev('g1', KO1, ARS, BHA, { done: true, hs: 3, as: 1 }), ev('g2', KO2, CHE, LIV, { done: true, hs: 0, as: 2 }));
  await runSlot(env, new Date(Date.parse(KO2) + 8 * H), 1);
  ok('a try that fails again is counted (2 of 3)', card('g1').final.ldt === 2 && !card('g1').final.lead, JSON.stringify(card('g1').final));
  await runSlot(env, new Date(Date.parse(KO2) + 9 * H), 1);
  const r5 = await runSlot(env, new Date(Date.parse(KO2) + 10 * H), 1);
  ok('after the third try the card is left alone', card('g1').final.ldt === LEAD_TRIES && r5.job !== 'lead', JSON.stringify([card('g1').final, r5.job]));
}

// ---- a finished game whose score ESPN sent empty or not at all is not graded (Number('') would read as 0) ----
{
  await fresh();
  const blank = (e, v) => { for (const c of e.competitions[0].competitors) if (v === undefined) delete c.score; else c.score = v; return e; };
  setFeed(blank(ev('g1', KO1, ARS, BHA, { done: true }), ''), blank(ev('g2', KO2, CHE, LIV, { done: true }), undefined));
  const r = await gradeLeague(DATE, 'eng.1', env, { force: true }, after);
  ok('empty or missing scores: no card is graded 0-0, both wait', r.graded === 0 && r.pending === 2 && !card('g1').final && !card('g2').final, JSON.stringify([r, card('g1').final]));
}
// ---- ESPN lists no game of the league that day: a game that already kicked off keeps its card, one not yet started goes ----
{
  await fresh();
  patch('g2', c => { c.void = 'postponed'; });
  setFeed();
  const mid = new Date(Date.parse(KO1) + H); // g1 kicked off, g2 (void) still to come
  await analyzeLeague(DATE, 'eng.1', env, mid);
  ok('empty listing: the kicked-off card and the void card are kept', !!card('g1') && card('g1').odds && card('g2') && card('g2').void === 'postponed', JSON.stringify(day().cards.map(c => c.id)));
  patch('g2', c => { delete c.void; });
  await analyzeLeague(DATE, 'eng.1', env, mid);
  ok('empty listing: a card not yet started and not void goes (the game moved)', !!card('g1') && !card('g2'), JSON.stringify(day().cards.map(c => c.id)));
}

console.log(fails ? `\n${fails} FAILED` : '\nAll round-2 grading checks passed');
process.exit(fails ? 1 : 0);
