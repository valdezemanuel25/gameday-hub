// The Data Keeper's checker (src/keeper.js missing): one list of what is missing, most urgent first, from made-up days. Reads only
// what it is handed, so no stubs are needed.
import { missing, scopeOf, TIER, RESULT_H } from '../src/keeper.js';
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
ok('close: no price at all in the window is one price item (the read is the close too), in the lineup tier', only(L, 'w3') === 'btts,price' && L.find(i => i.id === 'w3' && i.check === 'price').tier === TIER.lineup, only(L, 'w3'));
ok('close: past the price lock it is no longer a lineup-read item', !has(L, 'close', 'w4'));
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
ok('bets: settled with no close: bet-close', bt('b2') && bt('b2').check === 'bet-close');
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

console.log(fail ? `\n${fail} FAILED` : '\nall keeper checks passed');
process.exit(fail ? 1 : 0);
