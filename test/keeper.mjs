// The Data Keeper's checker (src/keeper.js missing): one list of what is missing, most urgent first, from made-up days. Reads only
// what it is handed, so no stubs are needed.
import { missing, scopeOf, TIER, RESULT_H, keeperStep, recentFrom, costOf, KEEPER_KEY, BACKOFF_MIN, GIVE_UP, BLOCK_H, LOG_MAX, keeperAlerts, alertMessage } from '../src/keeper.js';
import { keeperStatus, keeperHealth, readKeeper } from '../src/keeperlog.js';
import { budget, writeKind } from '../src/store.js';
import { gameChecks } from '../src/health.js';
import { dayGaps } from '../src/sweepdata.js';
let fail = 0; const ok = (n, c, x = '') => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (c ? '' : ' ' + x)); if (!c) fail++; };
const M = 60000, H = 3600000;

// Nov 25, 2026, 20:00 Central (standard time, UTC-6) = Nov 26, 02:00 UTC: Central's "today" is the 25th while UTC's is the 26th.
const NOW = Date.parse('2026-11-26T02:00:00Z'), at = ms => new Date(NOW + ms).toISOString();
const T = '2026-11-25', Y = '2026-11-24';
const PRICE = { h: -120, d: 250, a: 300 }, FULL = { ...PRICE, by: -110, bn: -110 };
const card = (id, league, ko, x = {}) => ({ id, league, home: `H${id}`, away: `A${id}`, kickoff: at(ko), v4: {}, fb: { p: [40, 30, 30] }, odds: FULL, ...x });
const has = (list, check, id) => list.some(i => i.check === check && i.id === id);
const only = (list, id) => list.filter(i => i.id === id).map(i => i.check).sort().join(',');

// --- soccer: each row of the plan's table ---
const soccer = {
  [T]: [
    card('ok', 'eng.1', 3 * H),                                                         // has everything: nothing listed
    card('p1', 'eng.1', 3 * H, { odds: undefined }),                                    // no price, 3 h out (also no both-score price)
    card('p2', 'ita.1', 3 * H, { odds: { by: -110, bn: -110, pn: {} } }),               // a price record with no home / draw / away price
    card('p3', 'eng.1', 25 * H, { odds: undefined }),                                   // no price, but more than 24 h out
    card('w1', 'esp.1', 25 * M, { odds: { ...FULL } }),                                 // in the lineup window, priced, no close
    card('w2', 'esp.1', 25 * M, { odds: { ...FULL, cl: at(-M) } }),                     // in the window with its close
    card('w3', 'fra.1', 28 * M, { odds: undefined }),                                   // in the window with no price at all
    card('w4', 'fra.1', 15 * M, { odds: { ...FULL } }),                                 // past the price lock: not the lineup read any more
    card('b1', 'ger.1', 5 * H, { odds: { ...PRICE } }),                                 // no both-score price
    card('f1', 'ned.1', 2 * H, { fb: undefined }),                                      // no Forebet, today
    card('f2', 'usa.1', -30 * M, { fb: undefined }),                                    // no Forebet but already kicked off
    card('cup', 'uefa.champions', 2 * H, { fb: undefined, odds: undefined }),           // a cup with a model: in scope
    card('sec', 'esp.2', 2 * H, { fb: undefined, odds: undefined }),                    // a second division: listed, but last
    card('out', 'uefa.nations', 2 * H, { fb: undefined, odds: undefined }),             // not a league we price: nothing
    card('sk', 'eng.1', 2 * H, { skipped: 'Club not found', odds: undefined }),        // skipped: nothing
    card('nv', 'eng.1', 2 * H, { v4: undefined, odds: undefined }),                     // no model pick: nothing
    card('pp', 'eng.1', 2 * H, { void: 'POSTPONED', odds: undefined, fb: undefined }), // postponed: nothing
    card('r0', 'eng.1', -5.5 * H),                                                      // 5.5 h after kickoff, no result: not yet late
    card('r1', 'eng.1', -6.5 * H),                                                      // 6.5 h after kickoff, no result: late
    card('r2', 'eng.1', -7 * H, { final: { h: 1, a: 0 } }),                             // has its result
    card('rv', 'eng.1', -9 * H, { void: 'ft: no 90-minute score' }),                    // void after the game: never missing a result
    card('rs', 'ger.2', -8 * H),                                                        // second division result: last
  ],
  [Y]: [card('old', 'mex.1', -26 * H)],                                                // yesterday, no result
  '2026-11-21': [card('vold', 'bra.1', -100 * H)],                                     // 4 days back: past the look-back
};

const L = missing({ soccer }, NOW);
ok('scope: a first division, a cup with a model, a second division and a league outside scope', scopeOf('eng.1') === 'top' && scopeOf('uefa.champions') === 'top' && scopeOf('esp.2') === 'second' && scopeOf('uefa.nations') === null);
ok('price: a game with everything listed nothing', only(L, 'ok') === '', only(L, 'ok'));
ok('price: no price within 24 h is listed, fixed by refreshOdds', has(L, 'price', 'p1') && L.find(i => i.id === 'p1' && i.check === 'price').fix === 'refreshOdds');
ok('price: a price record with only Pinnacle / both-score numbers counts as no price', has(L, 'price', 'p2'));
ok('price: no price more than 24 h out is not listed yet', only(L, 'p3') === '', only(L, 'p3'));
ok('close: priced, in the lineup window, no close: listed for refreshCardClose', has(L, 'close', 'w1') && L.find(i => i.id === 'w1').fix === 'refreshCardClose' && L.find(i => i.id === 'w1').tier === TIER.lineup);
ok('close: a game that has its close is not listed', only(L, 'w2') === '', only(L, 'w2'));
ok('close: no price at all in the window is one price item (the read is the close too, and brings the both-score price), in the lineup tier', only(L, 'w3') === 'price' && L.find(i => i.id === 'w3' && i.check === 'price').tier === TIER.lineup, only(L, 'w3'));
ok('close: past the price lock it is no longer a lineup-read item', !has(L, 'close', 'w4'));
ok('btts: a game with no ESPN price is not listed for its both-score price (the price read brings it)', only(L, 'p1') === 'price', only(L, 'p1'));
ok('btts: no both-score price within 24 h is listed, fixed by refreshBtts', has(L, 'btts', 'b1') && L.find(i => i.id === 'b1').fix === 'refreshBtts' && only(L, 'b1') === 'btts', only(L, 'b1'));
ok('forebet: no Forebet on a game today is listed, fixed by forebetFetch (1x2)', has(L, 'forebet', 'f1') && L.find(i => i.id === 'f1').fix === 'forebetFetch' && L.find(i => i.id === 'f1').kind === '1x2');
ok('forebet: a game already kicked off is not', !has(L, 'forebet', 'f2'));
ok('scope: a cup with a model is checked', has(L, 'price', 'cup') && has(L, 'forebet', 'cup'));
ok('scope: nothing listed for a league outside scope', only(L, 'out') === '', only(L, 'out'));
ok('skipped cards and cards with no model pick list nothing', only(L, 'sk') === '' && only(L, 'nv') === '');
ok('void: a postponed game lists nothing', only(L, 'pp') === '', only(L, 'pp'));
ok('void: a game closed as void after the game is never missing a result', only(L, 'rv') === '', only(L, 'rv'));
ok(`result: none ${RESULT_H} h after kickoff is listed for gradeLeague; 5.5 h is not yet`, has(L, 'result', 'r1') && L.find(i => i.id === 'r1').fix === 'gradeLeague' && !has(L, 'result', 'r0'));
ok('result: a graded game is not listed', only(L, 'r2') === '');
ok('result: yesterday is looked at, 4 days back is not', has(L, 'result', 'old') && only(L, 'vold') === '');

// --- a game crossing midnight Central: saved on the 25th, kickoff 23:30 Central (05:30 UTC on the 26th) ---
const midT = '2026-11-25', MID = { soccer: { [midT]: [card('mn', 'eng.1', 3.5 * H, { kickoff: '2026-11-26T05:30:00Z', fb: undefined, odds: { ...PRICE } })] } };
ok('midnight: at 20:00 Central (02:00 UTC the next day) a game saved for today is "today" for Forebet', has(missing(MID, NOW), 'forebet', 'mn'));
const at6 = Date.parse('2026-11-26T05:30:00Z') + 6 * H + M; // 05:31 Central on the 26th: "today" is now the 26th
ok('midnight: 6 h after its kickoff, the next Central day, its missing result is still found', has(missing(MID, at6), 'result', 'mn'));
ok('midnight: but it is no longer "today" for Forebet or due a price', only(missing(MID, at6), 'mn') === 'result', only(missing(MID, at6), 'mn'));

// --- hockey ---
const px = { ml: [-130, 110], cl: at(-5 * M) }, gk = { h: { n: 'A' }, a: { n: 'B' } }, ln = { v: 6.5 };
const hk = (id, ko, x = {}) => ({ id, home: `H${id}`, away: `A${id}`, hAbbr: 'H', aAbbr: 'A', kickoff: at(ko), v2: {}, fb: { pick: 'H' }, px, gk, ln, ...x });
const nhl = { [T]: [
  hk('n0', 40 * M),                              // in the window with everything
  hk('n1', 40 * M, { px: undefined }),           // no price at the lineup read
  hk('n2', 30 * M, { gk: undefined, ln: undefined }), // no goalies, no line
  hk('n3', 35 * M, { px: { ml: [-130, 110] } }), // priced, no close: the one-game close read
  hk('n4', 3 * H, { px: undefined, gk: undefined }), // not in the window yet: not a lineup item
  hk('n5', 3 * H, { fb: undefined }),            // no Forebet today
  hk('n6', -6.5 * H),                             // no result 6.5 h on
  hk('n7', -6.5 * H, { void: 'POSTPONED' }),      // postponed
] };
const N = missing({ nhl }, NOW);
const it = id => N.find(i => i.id === id);
ok('hockey: a game with everything at the lineup read lists nothing', only(N, 'n0') === '', only(N, 'n0'));
ok('hockey: no price at the lineup read is listed for nhlLineupStep', it('n1') && it('n1').check === 'nhl-lineup' && it('n1').fix === 'nhlLineupStep' && it('n1').need.join() === 'price' && it('n1').tier === TIER.lineup);
ok('hockey: no goalie or line: both named in one item', it('n2') && it('n2').need.join() === 'goalie,line');
ok('hockey: only the close missing goes to nhlCardClose', it('n3') && it('n3').fix === 'nhlCardClose' && it('n3').need.join() === 'close');
ok('hockey: outside the lineup window nothing is asked of the lineup read', !has(N, 'nhl-lineup', 'n4'));
ok('hockey: no Forebet on a game today is listed for nhlForebet', has(N, 'nhl-forebet', 'n5') && it('n5').fix === 'nhlForebet');
ok('hockey: a missing result is listed for nhlStep (results)', has(N, 'result', 'n6') && it('n6').fix === 'nhlStep' && it('n6').league === 'nhl');
ok('hockey: a postponed game lists nothing', only(N, 'n7') === '');

// --- Analyst bets ---
const bet = (id, gid, x = {}) => ({ id, gid, date: T, league: 'eng.1', home: 'H', away: 'A', kickoff: at(-8 * H), rule: 'r1', key: 'H', close: -110, res: null, ...x });
const BD = { soccer: { [T]: [card('g1', 'eng.1', -8 * H, { final: { h: 1, a: 0 } }), card('g2', 'eng.1', -8 * H), card('g3', 'esp.2', -8 * H, { final: { h: 0, a: 0 } }), card('g4', 'eng.1', -8 * H, { void: 'POSTPONED' })] },
  nhl: { [T]: [hk('h1', -8 * H, { final: { h: 3, a: 2 } })] } };
const bets = [
  bet('b1', 'g1'),                                   // game graded, bet still open
  bet('b2', 'g1', { res: 'win', close: null }),      // settled with no close
  bet('b3', 'g1', { res: 'loss' }),                  // settled with a close: fine
  bet('b4', 'g2'),                                   // game not graded yet: the result item covers it
  bet('b5', 'g1', { res: 'void', close: null }),     // void: no close is expected
  bet('b6', 'g3', { league: 'esp.2' }),              // second division
  bet('b7', 'g4'),                                   // postponed game, bet open: settle it (as void)
  bet('b8', 'h1', { sport: 'nhl', league: 'nhl' }),  // hockey bet left open
  bet('b9', 'g1', { date: '2026-11-20', res: 'win', close: null }), // old: past the look-back
  bet('b10', 'x', { league: 'uefa.nations' }),       // outside scope
];
const B = missing(BD, NOW, { bets }), bt = id => B.find(i => i.bet === id);
ok('bets: graded game, open bet: bet-settle via analystLook', bt('b1') && bt('b1').check === 'bet-settle' && bt('b1').fix === 'analystLook');
ok('bets: settled with no close: bet-close, with no read that can fill it', bt('b2') && bt('b2').check === 'bet-close' && bt('b2').fix === null);
ok('bets: settled with a close, void, or game not graded yet: nothing', !bt('b3') && !bt('b4') && !bt('b5'));
ok('bets: a postponed game\'s open bet is listed to settle', bt('b7') && bt('b7').check === 'bet-settle');
ok('bets: a hockey bet goes to analystNhl', bt('b8') && bt('b8').fix === 'analystNhl' && bt('b8').sport === 'nhl');
ok('bets: old bets and leagues outside scope are left alone', !bt('b9') && !bt('b10'));
ok('bets: a second-division bet is listed, marked second', bt('b6') && bt('b6').second === true);

// --- priority order ---
const A = missing({ soccer, nhl }, NOW, { bets });
const firstSecond = A.findIndex(i => i.second), lastTop = A.map(i => i.second).lastIndexOf(false);
ok('order: every second-division item comes after every other item', firstSecond > lastTop && A.filter(i => i.second).length >= 3, `${firstSecond} ${lastTop}`);
const top = A.filter(i => !i.second), tiers = top.map(i => i.tier);
ok('order: lineup-window items first, then overdue results, then the rest', tiers.every((x, i) => i === 0 || tiers[i - 1] <= x) && tiers[0] === TIER.lineup && tiers.includes(TIER.result), tiers.join());
const res = top.filter(i => i.tier === TIER.result);
ok('order: the longest-overdue result first', res[0].id === 'old', res.map(i => i.id).join());
const win = top.filter(i => i.tier === TIER.lineup).map(i => i.id);
ok('order: in the lineup window the soonest kickoff first', win[0] === 'w1' && win.indexOf('w3') > win.indexOf('w1'), win.join());
ok('order: every key is check|date|id and unique', new Set(A.map(i => i.key)).size === A.length && A.every(i => i.key.split('|').length === 3));
ok('nothing handed in, nothing listed', missing({}, NOW).length === 0 && missing(null, NOW).length === 0);

// --- the shared tests: the Keeper, the health report and the stats files agree ---
const hg = gameChecks({ [T]: soccer[T] }, NOW, { graceH: RESULT_H, priced: new Set(['eng.1']) });
ok('agree: the health report\'s late results match the Keeper\'s for the in-scope leagues', hg.ungraded.filter(u => / \(eng\.1,/.test(u.game)).length === L.filter(i => i.check === 'result' && i.league === 'eng.1' && i.date === T).length, JSON.stringify(hg.ungraded));
const sgT = dayGaps({ [T]: soccer[T] }, NOW, { priced: new Set(['ned.1']) }).days[0];
ok('agree: the stats files count the same Forebet gap', sgT.noForebet >= 1 && has(L, 'forebet', 'f1'));

// ====================================================================================================================================
// --- the fixer (keeperStep): an in-memory KV, the reads stubbed (nothing is fetched) ---
function mkEnv(seed = {}, x = {}) {
  const kv = new Map(Object.entries(seed).map(([k, v]) => [k, JSON.stringify(v)])), puts = [];
  return { kv, puts, ...x, HUB: {
    get: async (k, type) => { const v = kv.get(k); return v == null ? null : type === 'json' ? JSON.parse(v) : v; },
    put: async (k, v) => { puts.push(k); kv.set(k, v); },
    list: async ({ prefix }) => ({ keys: [...kv.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }),
  } };
}
const state = env => JSON.parse(env.kv.get(KEEPER_KEY) || 'null');
// A stub read for every fix: notes the call, and fills the gap in KV when told to (fill(kv, item)).
function stubs(fill = null, answer = {}) {
  const calls = [], R = {};
  for (const f of ['refreshOdds', 'refreshCardClose', 'refreshBtts', 'gradeLeague', 'forebetFetch', 'nhlForebet', 'nhlLineupStep', 'nhlCardClose', 'nhlStep', 'analystLook', 'analystNhl'])
    R[f] = async (env, it, now) => { calls.push({ fix: f, it, env }); if (fill) await fill(env, it); return typeof answer === 'function' ? answer(f) : answer; };
  return { calls, R };
}
const dayOf = (cards, sport = 'soccer') => ({ [sport === 'nhl' ? `nhl:day:${T}` : `day:${T}`]: { date: T, cards } });
const run = (env, at, R, o = {}) => keeperStep(env, new Date(at), { repairs: R, ...o });

// each gap gets the right read, with the right arguments
const one = [
  ['price', dayOf([card('p', 'eng.1', 3 * H, { odds: { by: -110, bn: -110 } })]), 'refreshOdds'],
  ['close', dayOf([card('w', 'esp.1', 25 * M, { odds: { ...FULL } })]), 'refreshCardClose'],
  ['btts', dayOf([card('b', 'ger.1', 5 * H, { odds: { ...PRICE } })]), 'refreshBtts'],
  ['forebet', dayOf([card('f', 'ned.1', 2 * H, { fb: undefined })]), 'forebetFetch'],
  ['result', dayOf([card('r', 'eng.1', -7 * H)]), 'gradeLeague'],
  ['nhl-lineup', dayOf([hk('n', 40 * M, { px: undefined })], 'nhl'), 'nhlLineupStep'],
  ['nhl-lineup (close)', dayOf([hk('n', 30 * M, { px: { ml: [-130, 110] } })], 'nhl'), 'nhlCardClose'],
  ['nhl-forebet', dayOf([hk('n', 3 * H, { fb: undefined })], 'nhl'), 'nhlForebet'],
  ['nhl result', dayOf([hk('n', -7 * H)], 'nhl'), 'nhlStep'],
  ['bet-settle', { ...dayOf([card('g', 'eng.1', -8 * H, { final: { h: 1, a: 0 } })]), analyst: { v: 1, items: [bet('x', 'g')] } }, 'analystLook'],
  ['hockey bet-settle', { ...dayOf([hk('h', -8 * H, { final: { h: 3, a: 2 } })], 'nhl'), analyst: { v: 1, items: [bet('y', 'h', { sport: 'nhl', league: 'nhl' })] } }, 'analystNhl'],
];
for (const [what, seed, fix] of one) {
  const env = mkEnv(seed, { BUDGET: budget(45) }), { calls, R } = stubs();
  await run(env, NOW, R);
  ok(`fixer: a ${what} gap gets ${fix}`, calls.length === 1 && calls[0].fix === fix, calls.map(c => c.fix).join());
}
{ // the item handed to the read carries what the read needs
  const env = mkEnv(dayOf([card('w', 'esp.1', 25 * M, { odds: { ...FULL } })]), { BUDGET: budget(45) }), { calls, R } = stubs();
  await run(env, NOW, R);
  ok('fixer: the read is handed the date, league and game', calls[0].it.date === T && calls[0].it.league === 'esp.1' && calls[0].it.id === 'w');
}

// one repair per run, the most urgent first
{
  const env = mkEnv(dayOf([card('r', 'eng.1', -7 * H), card('w', 'esp.1', 25 * M, { odds: { ...FULL } }), card('f', 'ned.1', 2 * H, { fb: undefined })]), { BUDGET: budget(45) }), { calls, R } = stubs();
  await run(env, NOW, R);
  ok('fixer: one repair per run, the lineup window first', calls.length === 1 && calls[0].fix === 'refreshCardClose');
  ok('fixer: meta:keeper is written once in the run', env.puts.filter(k => k === KEEPER_KEY).length === 1, env.puts.join());
}

// filled: the gap is gone when the day is read again
{
  const fill = async (env, it) => { const k = `day:${it.date}`, d = JSON.parse(env.kv.get(k)); d.cards.find(c => c.id === it.id).final = { h: 2, a: 1 }; env.kv.set(k, JSON.stringify(d)); };
  const env = mkEnv(dayOf([card('r', 'eng.1', -7 * H)]), { BUDGET: budget(45) }), { calls, R } = stubs(fill);
  const r = await run(env, NOW, R), s1 = state(env);
  ok('fixer: a read that fills the gap is logged "filled"', r.did && r.did.result === 'filled' && s1.log[0].result === 'filled' && s1.log[0].check === 'result' && s1.log[0].action === 'gradeLeague', JSON.stringify(r.did));
  ok('fixer: the log entry says when, which sport, day, league and game', s1.log[0].at === new Date(NOW).toISOString() && s1.log[0].sport === 'soccer' && s1.log[0].date === T && s1.log[0].league === 'eng.1' && s1.log[0].game === 'Hr v Ar');
  ok('fixer: a filled gap leaves no back-off clock', !s1.wait[`result|${T}|r`]);
}

// budget 0: nothing fetched
{
  const env = mkEnv(dayOf([card('r', 'eng.1', -7 * H), card('p', 'eng.1', 3 * H, { odds: undefined })]), { BUDGET: budget(0) }), { calls, R } = stubs();
  const r = await run(env, NOW, R);
  ok('budget: with no calls left nothing is read', calls.length === 0);
  ok('budget: the most urgent item is logged "skipped: budget"', r.skipped && r.skipped.result === 'skipped: budget' && state(env).log[0].result === 'skipped: budget');
  const n = env.puts.length; await run(env, NOW + 5 * M, R);
  ok('budget: the same skip again is not written again', env.puts.length === n && calls.length === 0, env.puts.join());
}
{ // the alerts' share is kept back
  const env = mkEnv(dayOf([card('r', 'eng.1', -7 * H)]), { BUDGET: budget(5) }), { calls, R } = stubs();
  await run(env, NOW, R);
  ok('budget: a read is not run if it would eat into the alerts\' share', calls.length === 0);
  const env2 = mkEnv(dayOf([card('r', 'eng.1', -7 * H)]), { BUDGET: budget(7) }), s2 = stubs();
  await run(env2, NOW, s2.R);
  ok('budget: with enough left it runs, on its own grant of calls', s2.calls.length === 1 && s2.calls[0].env.BUDGET.left === 3 && env2.BUDGET.left === 4, `${s2.calls[0] && s2.calls[0].env.BUDGET.left} ${env2.BUDGET.left}`);
}
{ // no budget at all (a button, a test): not limited
  const env = mkEnv(dayOf([card('r', 'eng.1', -7 * H)])), { calls, R } = stubs();
  await run(env, NOW, R);
  ok('budget: a run with no budget set is not limited', calls.length === 1);
}

// back-off: 30 min, then 1 h, then gave up after the third failed try
{
  const env = mkEnv(dayOf([card('r', 'eng.1', -7 * H)])), { calls, R } = stubs(null, { graded: 0, pending: 1 });
  const k = `result|${T}|r`;
  await run(env, NOW, R);
  ok('back-off: a read that leaves the gap is "still missing", and waits 30 minutes', calls.length === 1 && state(env).log[0].result === 'still missing' && state(env).wait[k].tries === 1 && Date.parse(state(env).wait[k].next) === NOW + BACKOFF_MIN[0] * M);
  await run(env, NOW + 29 * M, R);
  ok('back-off: not tried again before the wait is over', calls.length === 1);
  await run(env, NOW + 31 * M, R);
  ok('back-off: the second try, then a 1-hour wait', calls.length === 2 && state(env).wait[k].tries === 2 && Date.parse(state(env).wait[k].next) === NOW + 31 * M + BACKOFF_MIN[1] * M);
  await run(env, NOW + 31 * M + 59 * M, R);
  ok('back-off: still waiting at 59 minutes', calls.length === 2);
  await run(env, NOW + 31 * M + 61 * M, R);
  const w = state(env).wait[k];
  ok(`back-off: after ${GIVE_UP} failed tries it gives up, with the reason`, calls.length === 3 && w.gaveUp && /^gave up: still missing after the read/.test(state(env).log[0].result), JSON.stringify(w));
  await run(env, NOW + 10 * H, R);
  ok('back-off: a gave-up item is not tried again', calls.length === 3);
}
{ // the read's own error is the reason; a read that throws is a failed try, never thrown out of the step
  const env = mkEnv(dayOf([card('w', 'esp.1', 25 * M, { odds: { ...FULL } })])), R = { refreshCardClose: async () => { throw new Error('ESPN down'); } };
  let threw = false, r; try { r = await run(env, NOW, R); } catch (e) { threw = true; }
  ok('errors: a read that throws does not break the step, and its error is the reason', !threw && r.did.result === 'still missing' && state(env).wait[`close|${T}|w`].why === 'ESPN down');
}

// Forebet 403 / 429: no Forebet repair for 2 hours
{
  const seed = dayOf([card('f1', 'ned.1', 4 * H, { fb: undefined }), card('f2', 'eng.1', 5 * H, { fb: undefined })]);
  const env = mkEnv(seed), { calls, R } = stubs(null, f => f === 'forebetFetch' ? { error: 'HTTP 403' } : {});
  await run(env, NOW, R);
  ok('forebet: a 403 blocks Forebet for 2 hours', calls.length === 1 && Date.parse(state(env).blocks.forebet) === NOW + BLOCK_H * H);
  await run(env, NOW + 35 * M, R);
  ok('forebet: inside the block no Forebet read runs (another game\'s either)', calls.length === 1, calls.map(c => c.it.id).join());
  ok('forebet: the block is noted as a skip', state(env).log[0].result === 'skipped: block');
  await run(env, NOW + BLOCK_H * H + M, R);
  ok('forebet: after the block Forebet is read again', calls.length === 2);
  const env2 = mkEnv(dayOf([hk('n', 3 * H, { fb: undefined })], 'nhl')), s2 = stubs(null, { error: 'HTTP 429' });
  await run(env2, NOW, s2.R);
  ok('forebet: a 429 from the hockey page blocks Forebet too', state(env2).blocks.forebet && Date.parse(state(env2).blocks.forebet) > NOW);
  const env3 = mkEnv({ ...seed, 'meta:fb': { 'ned.1|1x2': { at: new Date(NOW - 2 * M).toISOString(), ok: false } } }), s3 = stubs();
  await run(env3, NOW, s3.R);
  ok('forebet: a page Forebet\'s own job read 2 minutes ago is not read again (the next one is)', s3.calls.length === 1 && s3.calls[0].it.id === 'f2', s3.calls.map(c => c.it.id).join());
}

// nothing to do: no write
{
  const env = mkEnv(dayOf([card('ok', 'eng.1', 3 * H)])), { calls, R } = stubs();
  const r = await run(env, NOW, R);
  ok('no write: nothing missing, nothing read, nothing written', calls.length === 0 && env.puts.length === 0 && r.did === null && r.missing === 0, env.puts.join());
  const env2 = mkEnv(dayOf([card('ok', 'uefa.nations', 3 * H, { odds: undefined, fb: undefined })])), s2 = stubs();
  await run(env2, NOW, s2.R);
  ok('no write: a gap outside scope is not the Keeper\'s', s2.calls.length === 0 && env2.puts.length === 0);
}

// saver mode: the lineup window and results only
{
  const seed = dayOf([card('p', 'eng.1', 3 * H, { odds: undefined }), card('r', 'eng.1', -7 * H)]);
  const env = mkEnv(seed, { SAVER: true }), { calls, R } = stubs();
  await run(env, NOW, R);
  ok('saver: a result is still repaired', calls.length === 1 && calls[0].fix === 'gradeLeague');
  const env2 = mkEnv(dayOf([card('p', 'eng.1', 3 * H, { odds: undefined }), card('f', 'ned.1', 2 * H, { fb: undefined })]), { SAVER: true }), s2 = stubs();
  const r2 = await run(env2, NOW, s2.R);
  ok('saver: prices outside the window and Forebet wait', s2.calls.length === 0 && r2.skipped && r2.skipped.result === 'skipped: saver');
  const env3 = mkEnv(dayOf([card('w', 'esp.1', 25 * M, { odds: { ...FULL } })]), { SAVER: true }), s3 = stubs();
  await run(env3, NOW, s3.R);
  ok('saver: the lineup-window read still runs', s3.calls.length === 1 && s3.calls[0].fix === 'refreshCardClose');
}

// credits: with no Odds API key above the reserve the read runs without the keys
{
  const seed = dayOf([card('b', 'ger.1', 5 * H, { odds: { ...PRICE } })]);
  globalThis.caches = { default: { match: async () => new Response(JSON.stringify({ left: 40, at: new Date(NOW).toISOString() })), put: async () => {} } };
  try {
    const env = mkEnv(seed, { ODDS_API_KEY: 'k1' }), { calls, R } = stubs();
    await run(env, NOW, R);
    ok('credits: below the reserve the both-score read runs with no Odds API key (Pinnacle / ESPN only)', calls.length === 1 && calls[0].env.ODDS_API_KEY === '' && env.ODDS_API_KEY === 'k1');
    globalThis.caches.default.match = async () => new Response(JSON.stringify({ left: 400, at: new Date(NOW).toISOString() }));
    const env2 = mkEnv(seed, { ODDS_API_KEY: 'k1' }), s2 = stubs();
    await run(env2, NOW, s2.R);
    ok('credits: above the reserve the key is used', s2.calls[0].env.ODDS_API_KEY === 'k1');
  } finally { delete globalThis.caches; }
}

// a source this run already read is left alone
{
  const seed = dayOf([card('w', 'esp.1', 25 * M, { odds: { ...FULL } }), card('r', 'eng.1', -7 * H)]);
  const rec = recentFrom([{ job: 'odds', league: 'esp.1', date: T, changed: 1 }, null, { job: 'grade', idle: true }]);
  ok('recent: the run\'s answers name what was read', rec.length === 1 && rec[0].source === 'prices' && rec[0].league === 'esp.1');
  const env = mkEnv(seed), { calls, R } = stubs();
  const r = await run(env, NOW, R, { recent: rec });
  ok('recent: the price read just made is not repeated; the next item is repaired', calls.length === 1 && calls[0].fix === 'gradeLeague' && !r.skipped);
  ok('recent: the hockey job and Forebet answers count too', recentFrom([{ job: 'nhl', forebet: { saved: 1 } }]).map(x => x.source).join() === 'nhl-results,nhl-prices,forebet' && recentFrom([{ job: 'forebet', slug: 'eng.1' }])[0].source === 'forebet');
}

// a settled bet with no close: nothing can fill it, so it is given up at once (no read)
{
  const env = mkEnv({ ...dayOf([card('g', 'eng.1', -8 * H, { final: { h: 1, a: 0 } })]), analyst: { v: 1, items: [bet('z', 'g', { res: 'win', close: null })] } }), { calls, R } = stubs();
  await run(env, NOW, R);
  ok('bets: a settled bet with no close is given up at once, with the reason, and no read', calls.length === 0 && /^gave up: settled with no closing price/.test(state(env).log[0].result));
  const n = env.puts.length; await run(env, NOW + 5 * M, R);
  ok('bets: and not written again', env.puts.length === n);
}

// the record stays small
{
  const env = mkEnv({ [KEEPER_KEY]: { log: Array.from({ length: LOG_MAX }, (_, i) => ({ at: 'x', i })), wait: { [`result|2026-11-01|old`]: { tries: 1 } }, blocks: {} }, ...dayOf([card('r', 'eng.1', -7 * H)]) }), { R } = stubs();
  await run(env, NOW, R);
  ok('record: the log keeps the last 100 actions, newest first', state(env).log.length === LOG_MAX && state(env).log[0].check === 'result');
  ok('record: back-off clocks of games past the look-back are dropped', !state(env).wait['result|2026-11-01|old']);
}
ok('writes: meta:keeper is counted as the Keeper\'s bookkeeping', writeKind(KEEPER_KEY) === 'bookkeeping: keeper');
ok('cost: a price read costs more than a Forebet read, the Analyst\'s settle pass costs no call', costOf({ fix: 'refreshOdds', sport: 'soccer', date: T, league: 'eng.1' }, {}, {}) > costOf({ fix: 'forebetFetch' }, {}, {}) && costOf({ fix: 'analystLook' }, {}, {}) === 0);

// ====================================================================================================================================
// --- step 3: give-ups name the game; the Status and health summaries; the phone alerts ---
{
  const env = mkEnv(dayOf([card('r', 'eng.1', -7 * H)])), { R } = stubs();
  for (const dt of [0, 31 * M, 92 * M]) await run(env, NOW + dt, R, { send: async () => ({ sent: 0 }) });
  const st = await readKeeper(env), g = keeperStatus(st, NOW + 2 * H, 'soccer');
  ok('give-ups: a give-up keeps the game, league and check, for the Status tab and the sweep', g.gaveUp.length === 1 && g.gaveUp[0].game === 'Hr v Ar' && g.gaveUp[0].league === 'eng.1' && g.gaveUp[0].check === 'result' && /still missing/.test(g.gaveUp[0].why), JSON.stringify(g.gaveUp));
  ok('status: the last actions newest first, of the sport asked for', g.last.length === 3 && /^gave up/.test(g.last[0].result) && keeperStatus(st, NOW, 'nhl').last.length === 0);
  const hh = keeperHealth(st, NOW + 2 * H);
  ok('health: counts of the last 24 hours (filled / still missing / gave up) and the give-up list', hh.last24h.stillMissing === 2 && hh.last24h.gaveUp === 1 && hh.last24h.filled === 0 && hh.gaveUp.length === 1 && hh.lastAction.check === 'result', JSON.stringify(hh.last24h));
  ok('health: actions older than 24 hours are not counted', keeperHealth(st, NOW + 30 * H).last24h.stillMissing === 0);
  ok('status: only the last 10 actions are shown', keeperStatus({ log: Array.from({ length: 30 }, () => ({ sport: 'soccer', result: 'filled', at: 'x' })), wait: {}, blocks: {} }).last.length === 10);
  ok('status: a Forebet block still running is shown, an old one is not', keeperStatus({ log: [], wait: {}, blocks: { forebet: new Date(NOW + H).toISOString() } }, NOW).forebetBlockedUntil && !keeperStatus({ log: [], wait: {}, blocks: { forebet: new Date(NOW - H).toISOString() } }, NOW).forebetBlockedUntil);
  ok('status: an empty or broken record reads as nothing', (await readKeeper(mkEnv())).log.length === 0 && (await readKeeper({ HUB: { get: async () => { throw new Error('x'); } } })).log.length === 0);
}
{ // which gaps alert
  const AD = { soccer: { [T]: [
      card('ar', 'eng.1', -6.5 * H),                       // no result 6.5 h after kickoff: alert
      card('ar2', 'ger.2', -6.5 * H),                      // second division: never
      card('ap', 'eng.1', 90 * M, { odds: undefined }),    // no price 90 min out: alert
      card('ap2', 'eng.1', 3 * H, { odds: undefined }),    // no price, 3 h out: not yet
      card('ap3', 'esp.2', 60 * M, { odds: undefined }),   // second division price: never
    ], [Y]: [card('aold', 'mex.1', -30 * H)] },            // 30 h without a result: the nightly sweep's, not a phone alert
    nhl: { [T]: [hk('hp', 90 * M, { px: undefined }), hk('hp2', 3 * H, { px: undefined }), hk('hq', 90 * M)] } };
  const due = keeperAlerts(missing(AD, NOW), AD, NOW, {}), keys = due.map(a => a.key).sort().join();
  ok('alerts: a result missing at kickoff + 6 h, a soccer and a hockey price missing 2 h before: and nothing else', keys === `price|${T}|ap,price|${T}|hp,result|${T}|ar`, keys);
  ok('alerts: already sent, not again', keeperAlerts(missing(AD, NOW), AD, NOW, { [`result|${T}|ar`]: NOW - H }).every(a => a.key !== `result|${T}|ar`));
  const m1 = alertMessage(due), m2 = alertMessage([...due, ...due, ...due]);
  ok('alerts: one message names the games', /3 games need a look/.test(m1.title) && /Har v Aar: no result 7 h after kickoff/.test(m1.body) && /no price, 90 min/.test(m1.body) && m1.tag === 'keeper', JSON.stringify(m1));
  ok('alerts: a long list is cut to 4 lines', m2.body.split('\n').length === 5 && /and 5 more$/.test(m2.body));
  ok('alerts: hockey-only alerts open the hockey page', alertMessage(due.filter(a => a.sport === 'nhl')).url === '/nhl' && m1.url === '/soccer');
}
{ // the alert is sent once, after the repair, and noted
  const sent = [], send = async (env, msg) => { sent.push(msg); return { sent: 1 }; };
  const env = mkEnv(dayOf([card('ar', 'eng.1', -6.5 * H)])), { R } = stubs();
  const r = await run(env, NOW, R, { send });
  ok('alerts: a result still missing after the repair is alerted, and noted in the record', sent.length === 1 && r.alerted === 1 && state(env).sent[`result|${T}|ar`] === NOW);
  await run(env, NOW + 31 * M, R, { send });
  ok('alerts: at most one alert per game per problem', sent.length === 1);
  const fill = async (e, it) => { const k = `day:${it.date}`, d = JSON.parse(e.kv.get(k)); d.cards.find(c => c.id === it.id).final = { h: 1, a: 1 }; e.kv.set(k, JSON.stringify(d)); };
  const env2 = mkEnv(dayOf([card('ar', 'eng.1', -6.5 * H)])), s2 = stubs(fill), sent2 = [];
  await run(env2, NOW, s2.R, { send: async (e, m) => { sent2.push(m); return { sent: 1 }; } });
  ok('alerts: a gap the Keeper just filled is not alerted', sent2.length === 0);
  const env3 = mkEnv(dayOf([card('ar', 'eng.1', -6.5 * H)])), s3 = stubs();
  await run(env3, NOW, s3.R, { send: async () => ({ sent: 0 }) });
  ok('alerts: not delivered (no device, or out of calls): not marked sent, tried again next run', !state(env3).sent[`result|${T}|ar`]);
  const env4 = mkEnv({ ...dayOf([card('ar', 'eng.1', -6.5 * H)]), push: { subs: [{ endpoint: 'https://push.example.com/a', keys: {} }, { endpoint: 'https://push.example.com/b', keys: {} }], sent: {} } }, { BUDGET: budget(1) }), s4 = stubs();
  let fetched = 0; const realFetch = globalThis.fetch; globalThis.fetch = async () => { fetched++; return new Response(null, { status: 201 }); };
  try { await run(env4, NOW, s4.R); } finally { globalThis.fetch = realFetch; }
  ok('alerts: with fewer calls left than devices, nothing is sent', fetched === 0 && !state(env4)?.sent?.[`result|${T}|ar`]);
}

console.log(fail ? `\n${fail} FAILED` : '\nall keeper checks passed');
process.exit(fail ? 1 : 0);
