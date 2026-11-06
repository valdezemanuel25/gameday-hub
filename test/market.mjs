// Model vs market checks: devig, the three scores, the blend weight, closing-line value and v4 value bets.
import { devig, scoreOne, blankMarket, addMarket, finishMarket } from '../src/market.js';
import { withOdds } from '../src/worker.js';
import { parseOdds } from '../src/data.js';
let bad = 0; const ok = (n, c, x = '') => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (c ? '' : ' ' + x)); if (!c) bad++; };
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;

const p = devig({ h: -150, d: 280, a: 400 });
ok('devig adds to 1 and keeps the order of the prices', near(p[0] + p[1] + p[2], 1) && p[0] > p[2] && p[2] < p[1]);
ok('a missing price gives no chances', devig({ h: -150, d: 280 }) === null && devig(null) === null);
ok('even prices with a margin come out even', near(devig({ h: -110, d: -110, a: -110 })[0], 1 / 3));
const s = scoreOne([50, 30, 20], 0);
ok('scores for a home win at 50/30/20: RPS 0.145, log loss ln 2, Brier 0.38', near(s.rps, 0.145) && near(s.ll, Math.log(2)) && near(s.brier, 0.38), JSON.stringify(s));
ok('RPS punishes an away pick less on a draw than on a home win', scoreOne([10, 20, 70], 1).rps < scoreOne([10, 20, 70], 0).rps);

const M = blankMarket();
const card = (final, v4, odds, lean, extra = {}) => ({ final, v4: { p: v4 }, odds, lean, ...extra });
// v4 agrees with the market: the blend should not move far from it
addMarket(M, card({ h: 2, a: 0 }, [60, 25, 15], { h: -150, d: 280, a: 400, f: { h: -120, d: 260, a: 330 } }, { key: 'H' }));
addMarket(M, card({ h: 0, a: 1 }, [30, 30, 40], { h: 200, d: 230, a: 130, f: { h: 180, d: 230, a: 150 } }, { key: 'A' }));
addMarket(M, card({ h: 1, a: 1 }, [45, 30, 25], { h: 120, d: 220, a: 250 }, { key: 'O' })); // no first price, Over pick: no CLV
addMarket(M, card({ h: 1, a: 1 }, [45, 30, 25], null, { key: 'H' })); // no price at all: left out
addMarket(M, card({ h: 3, a: 0 }, [70, 20, 10], { h: -300, d: 400, a: 800 }, null, { v4: { p: [70, 20, 10], promo: true }, v2: { p: [65, 20, 15] } })); // promoted club: v4 left out, v2 counted
const R = finishMarket(M);
ok('only priced, finished games count', R.n === 4, JSON.stringify(R));
ok('v4 is paired with the market on its own games, a promoted club left out', R.pairs.v4.n === 3 && R.pairs.v2.n === 1 && R.pairs.fb.n === 0);
ok('the blend weight is between 0 and 1 and never worse than either side', R.blend.n === 3 && R.blend.w >= 0 && R.blend.w <= 1 && R.blend.ll <= R.blend.llMarket + 1e-9 && R.blend.ll <= R.blend.llV4 + 1e-9, JSON.stringify(R.blend));
ok('CLV: two result picks with a first price, both shortened to the close', R.clv.n === 2 && R.clv.beat === 2 && R.clv.avg > 0, JSON.stringify(R.clv));
ok('value bets: v4 5+ points over the first price, settled at that price', R.value.n >= 1 && Number.isFinite(R.value.units), JSON.stringify(R.value));

// prices on the card: the first price seen is kept, the both-score prices too, and ESPN's opening line is read
const f1 = withOdds(null, { h: -120, d: 260, a: 330 });
const f2 = withOdds(f1, { h: -150, d: 280, a: 400 });
const f3 = withOdds({ h: -110, d: 250, a: 300, by: -130, bn: 100 }, { h: -150, d: 280, a: 400 });
ok('the first price seen is kept as f, the latest one is the close', f2.f.h === -120 && f2.h === -150 && JSON.stringify(withOdds(f2, { h: -150, d: 280, a: 400 })) === JSON.stringify(f2));
ok('a card priced before f existed keeps its old price as the first one, and its both-score prices', f3.f.h === -110 && f3.by === -130 && f3.bn === 100);
const op = parseOdds([{ moneyline: { home: { open: { odds: '-120' }, close: { odds: '-150' } }, draw: { open: { odds: '+260' }, close: { odds: '+280' } }, away: { open: { odds: '+330' }, close: { odds: '+400' } } } }]);
ok('ESPN\'s opening moneyline is kept apart from the close', op.h === -150 && op.op && op.op.h === -120 && op.op.a === 330);
ok('no opening line, no op', parseOdds([{ moneyline: { home: { close: { odds: '-150' } } } }]).op === undefined);
// --- the model scoreboard (Nov 5, 2026): each model against the closing price per market, paired game by game ---
{ const { blankMarket: bm, addMarket: am, finishMarket: fm, BOARD_MIN } = await import('../src/market.js');
  const B = bm(); const g = (i, over) => ({ league: 'eng.1', final: i % 2 ? { h: 2, a: 1 } : { h: 0, a: 0 }, odds: { h: 150, d: 230, a: 190, tl: 2.5, to: -110, tu: -110, by: -110, bn: -110 },
    v4: { p: [40, 30, 30], over, btts: 50 }, v2: { p: [34, 33, 33], over: 50, btts: 50 }, sx: { sot: 8.6, gl: 2.8, sh: 24.8 } });
  // v4's Over 2.5 is 80% in the games that went over and 20% in those that did not: it beats a 50/50 price clearly
  for (let i = 0; i < BOARD_MIN + 10; i++) am(B, g(i, i % 2 ? 80 : 20));
  am(B, { ...g(1, 80), odds: { ...g(1, 80).odds, src: 'bet365' } }); // a stand-in price is not the close: left out
  const F = fm(B).board;
  ok('scoreboard: a model clearly better than the price beats it', F.ou.v4.verdict === 'beats' && F.ou.v4.diff < 0 && F.ou.v4.n === BOARD_MIN + 10, JSON.stringify(F.ou.v4));
  ok('scoreboard: a model saying 50% against a 50% price is level with it', F.ou.v2.verdict === 'level' && Math.abs(F.ou.v2.diff) < 1e-9 && F.btts.v4.verdict === 'level');
  ok('scoreboard: the result market and the shots read are scored too', F['1x2'].v4.n === BOARD_MIN + 10 && F.ou.shots.n === BOARD_MIN + 10 && F['1x2'].v5.n === 0);
  const E = bm(); for (let i = 0; i < 5; i++) am(E, g(i, i % 2 ? 80 : 20)); ok('scoreboard: under 50 games it is too early to say', fm(E).board.ou.v4.verdict === 'early'); }
{ const { BOARD_MODELS } = await import('../src/market.js');
  ok('scoreboard: the score card is not scored on the prices it is fitted to (result, Over/Under) but is on both score', !BOARD_MODELS['1x2'].includes('v6') && !BOARD_MODELS.ou.includes('v6') && BOARD_MODELS.btts.includes('v6')); }
const html2 = (await import('node:fs')).readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
ok('page: the scoreboard sits on the Results tab after Models against the market', /marketView\(t\) \+ scoreboardView\(t\)/.test(html2) && /function scoreboardView\(t\)/.test(html2));
console.log(bad ? `\n${bad} FAILED` : '\nAll market checks passed');
process.exit(bad ? 1 : 0);
