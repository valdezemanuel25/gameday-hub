// Soccer Trends: straight-loss runs, the two situations, the model check and the read on each game of a day.
import { withStreaks, inSpot, SITUATIONS, gameReads, buildSoccerTrends, live, TESTED } from '../src/trendssoccer.js';
let fails = 0; const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n} ${c ? '' : x}`); };
const card = (id, kickoff, home, away, o = {}) => ({ id, kickoff, ko: '1:00 PM', league: 'eng.1', leagueName: 'Premier League', home, away, hId: id + 'h', aId: id + 'a', ...o });
const day = (date, cards) => ({ date, cards });
const lost = (id, d, home, away) => card(id, d + 'T15:00Z', home, away, { final: { h: 3, a: 0 } }); // the road team loses
const S = Object.fromEntries(SITUATIONS.map(s => [s.id, s]));

// 1. streaks: real losses only (a draw or a win ends the run), same league, counted from saved games
{
  const ctx = withStreaks([
    day('2026-11-01', [lost('a', '2026-11-01', 'H1', 'RRR')]), day('2026-11-02', [lost('b', '2026-11-02', 'H2', 'RRR')]), day('2026-11-03', [lost('c', '2026-11-03', 'H3', 'RRR')]),
    day('2026-11-05', [card('t', '2026-11-05T15:00Z', 'H4', 'RRR'), card('u', '2026-11-05T15:00Z', 'RRR2', 'H5', { league: 'esp.1' })]),
  ]);
  const t = ctx.find(c => c.id === 't');
  ok('three straight road losses count as a run of 3 before the next game', t.al === 3, String(t.al));
  ok('the first game has no run', ctx.find(c => c.id === 'a').al === 0);
  const d = withStreaks([day('2026-11-01', [lost('a', '2026-11-01', 'H1', 'RRR')]), day('2026-11-02', [card('b', '2026-11-02T15:00Z', 'H2', 'RRR', { final: { h: 1, a: 1 } })]), day('2026-11-03', [card('c', '2026-11-03T15:00Z', 'H3', 'RRR')])]);
  ok('a draw ends the run', d.find(c => c.id === 'c').al === 0);
  const cup = withStreaks([day('2026-11-01', [card('x', '2026-11-01T15:00Z', 'A', 'B', { league: 'uefa.champions' })])]);
  ok('cup cards are left out', cup.length === 0);
}
// 2. the two situations
const o = (h, d, a, extra = {}) => ({ h, d, a, tl: 2.5, to: -120, tu: 100, ...extra });
{
  const road3 = { ...card('r', '2026-11-05T15:00Z', 'H', 'A'), al: 3, hl: 0, odds: o(-120, 275, 310) };
  const sp = inSpot(S.roadloss3, road3);
  ok('road team on 3 straight losses is in the draw situation, priced at the draw price', sp && sp.price === 275 && sp.breakeven === 27, JSON.stringify(sp));
  ok('two straight losses is not', inSpot(S.roadloss3, { ...road3, al: 2 }) === false);
  const short = { ...card('s', '2026-11-05T15:00Z', 'H', 'A'), al: 0, hl: 0, odds: o(-150, 300, 400, { op: { h: -120, d: 270, a: 330 } }) };
  const sh = inSpot(S.homeshort, short);
  ok('home price up 3+ points since the open is the Over situation', sh && sh.moved >= 3 && sh.price === -120, JSON.stringify(sh));
  ok('a home price that drifted out is not', inSpot(S.homeshort, { ...short, odds: o(-110, 270, 330, { op: { h: -150, d: 300, a: 400 } }) }) === false);
  ok('another total line is not (tested on 2.5 only)', inSpot(S.homeshort, { ...short, odds: { ...short.odds, tl: 3 } }) === false);
  ok('no opening price: no read', inSpot(S.homeshort, { ...short, odds: o(-150, 300, 400) }) === false);
}
// 2b. BTTS No: only when Yes is priced at 65%+ AND v4's No chance reaches the No breakeven
{
  const b = (by, bn, btts, extra = {}) => ({ ...card('b', '2026-11-05T15:00Z', 'H', 'A'), al: 0, hl: 0, odds: { h: -120, d: 275, a: 310, by, bn, ...extra }, v4: { btts, over: 50, p: [40, 30, 30] } });
  const strong = inSpot(S.bttsno, b(-250, 190, 30)); // Yes ~71% devigged; No breakeven ~34.5%; model No 70%
  ok('Yes priced 65%+ and v4 No above the breakeven is a BTTS No spot', strong && strong.price === 190, JSON.stringify(strong));
  ok('Yes priced under 65% is not (the common case)', inSpot(S.bttsno, b(-165, 125, 40)) === false);
  ok('v4 No below the breakeven is not', inSpot(S.bttsno, b(-250, 190, 70)) === false);
  ok('no v4 BTTS number: no read', inSpot(S.bttsno, { ...b(-250, 190, 30), v4: undefined }) === false);
  ok('no BTTS price: no read', inSpot(S.bttsno, { ...b(-250, 190, 30), odds: { h: -120, d: 275, a: 310 } }) === false);
  const g = gameReads([{ ...b(-250, 190, 30), date: '2026-11-05' }], '2026-11-05');
  ok('the read is labelled Strong and says it is this season only', g.length === 1 && g[0].reads[0].lab === 'Strong' && g[0].reads[0].seasonOnly === true && g[0].reads[0].model === '70% vs 33% price', JSON.stringify(g[0] && g[0].reads));
}
// 3. the read on a day, with the model check
{
  const hist = [lost('a', '2026-11-01', 'H1', 'RRR'), lost('b', '2026-11-02', 'H2', 'RRR'), lost('c', '2026-11-03', 'H3', 'RRR')].map(c => day(c.kickoff.slice(0, 10), [c]));
  const t = card('t', '2026-11-05T15:00Z', 'H4', 'RRR', { odds: o(-120, 275, 310), v4: { p: [49, 27, 24], over: 50 } });
  const good = buildSoccerTrends([...hist, day('2026-11-05', [t])], '2026-11-05');
  ok('one game is in a situation; the draw read is Watch with the model at 27% vs the 25% price', good.cards.length === 1 && good.cards[0].reads[0].lab === 'Watch' && good.cards[0].reads[0].model === '27% vs 25% price', JSON.stringify(good.cards));
  ok('a tested league is marked tested; the situation records come with it', good.cards[0].tested === true && good.situations.length === 3 && TESTED.has('eng.1'));
  const bad = buildSoccerTrends([...hist, day('2026-11-05', [{ ...t, v4: { p: [60, 15, 25], over: 50 } }])], '2026-11-05');
  ok('a model that rates the draw below the price makes it a Conflict', bad.cards[0].reads[0].lab === 'Conflict');
  const mx = buildSoccerTrends([...hist.map(d => day(d.date, d.cards.map(c => ({ ...c, league: 'mex.1' })))), day('2026-11-05', [{ ...t, league: 'mex.1' }])], '2026-11-05');
  ok('a league outside the seven is marked untested', mx.cards.length === 1 && mx.cards[0].tested === false);
  ok('no days: nothing and no crash', buildSoccerTrends([], '2026-11-05').cards.length === 0 && buildSoccerTrends(null, '2026-11-05').games === 0);
  ok('live record counts only graded games', live([]).every(x => x.n === 0));
}
console.log(fails ? `\n${fails} FAILED` : '\nall soccer trends checks pass'); process.exit(fails ? 1 : 0);
