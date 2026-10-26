// Price moves: opening -> now / close, the big-move flag, the lineup read 30 minutes before kickoff and the lock after it,
// and the Results tallies (results following the move, your own picks against the close). The page's moveOf matches the server's.
import fs from 'fs';
import { moveOf, hockeyMove, BIG_MOVE } from '../src/moves.js';
import { parseHockeyOdds, setPrice, nhlTally } from '../src/nhl.js';
import { parseOdds } from '../src/data.js';
import { withOdds, oddsStep, LINEUP_READ, PRICE_LOCK } from '../src/worker.js';
import { blankMarket, addMarket, finishMarket } from '../src/market.js';
let fails = 0; const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n} ${c ? '' : x}`); };

// 1. the move
const odds = { h: -150, d: 280, a: 400, tl: 2.5, to: -120, tu: 100, op: { h: 110, d: 250, a: 240 }, opt: { tl: 2.5, to: 105, tu: -125 } };
const mv = moveOf(odds);
ok('opening price is ESPN\'s opening line when there is one', mv.from === 'open');
ok('home moved up, away down, and the three moves add to about 0', mv.d[0] > 10 && mv.d[2] < 0 && Math.abs(mv.d[0] + mv.d[1] + mv.d[2]) < 0.3, JSON.stringify(mv.d));
ok('the biggest move is home and it is a big move (5+ points)', mv.top === 0 && mv.big && BIG_MOVE === 5);
ok('Over 2.5 moved up too (same line at open and now)', mv.ou && mv.ou.line === 2.5 && mv.ou.d > 5, JSON.stringify(mv.ou));
ok('no Over/Under move when the opening total was another line', moveOf({ ...odds, opt: { tl: 3.5, to: 105, tu: -125 } }).ou === null);
const small = moveOf({ h: -150, d: 280, a: 400, f: { h: -145, d: 280, a: 390 } });
ok('without an opening line the first price seen is used, and a small move is not big', small.from === 'first' && !small.big && small.size < 2, JSON.stringify(small));
ok('no opening or first price: no move', moveOf({ h: -150, d: 280, a: 400 }) === null && moveOf(null) === null);

// 2. the page's copy gives the same answer
{
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const grab = n => html.match(new RegExp(`(?:function ${n}\\([^)]*\\) \\{|const ${n} = )[\\s\\S]*?\\n(?:\\}\\n|(?=const |function ))`))[0];
  const page = new Function(`${['BIG_MOVE', 'devigP', 'moveOf'].map(grab).join('\n')}; return moveOf;`)();
  const cases = [odds, { ...odds, opt: null }, { h: -150, d: 280, a: 400, f: { h: -145, d: 280, a: 390, tl: 2.5, to: -110, tu: -110 }, tl: 2.5, to: -125, tu: 105 }, { h: 300, d: 260, a: -110 }];
  ok('page and server agree on every case', cases.every(o => JSON.stringify(page(o)) === JSON.stringify(moveOf(o))), JSON.stringify(cases.map(o => [page(o), moveOf(o)])));
}

// 3. capture: the opening total is read, and the first price keeps the total
const p = parseOdds([{ moneyline: { home: { open: { odds: '+110' }, close: { odds: '-150' } }, draw: { open: { odds: '+250' }, close: { odds: '+280' } }, away: { open: { odds: '+240' }, close: { odds: '+400' } } },
  total: { over: { open: { line: 'o2.5', odds: '+105' }, close: { line: 'o2.5', odds: '-120' } }, under: { open: { line: 'u2.5', odds: '-125' }, close: { line: 'u2.5', odds: '+100' } } } }]);
ok('ESPN\'s opening total is kept apart from the current one', p.opt && p.opt.tl === 2.5 && p.opt.to === 105 && p.opt.tu === -125 && p.to === -120, JSON.stringify(p));
const w = withOdds(null, { h: -150, d: 280, a: 400, tl: 2.5, to: -120, tu: 100 });
ok('the first price seen keeps the total too', w.f.tl === 2.5 && w.f.to === -120 && w.f.tu === 100);
ok('a fresh price keeps the lineup-read and last-change times', withOdds({ h: -150, d: 280, a: 400, ts: 'T1', cl: 'T2' }, { h: -160, d: 290, a: 420 }).cl === 'T2' && withOdds({ h: 1, d: 1, a: 1, ts: 'T1' }, { h: -160, d: 290, a: 420 }).ts === 'T1');

// 4. the schedule: hourly in the last 3 hours, a read 30-20 minutes before kickoff (after the lineups), then the price is locked
{
  ok('the lineup read is 30 minutes before kickoff and prices lock at 20', LINEUP_READ === 30 && PRICE_LOCK === 20);
  const date = '2026-10-24', ko = Date.parse('2026-10-24T20:00:00Z'), at = m => new Date(ko - m * 60000), kv = new Map();
  const env = { HUB: { get: async (k, t) => { const v = kv.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => kv.set(k, v) } };
  let price = -150, ttls = [];
  const cache = { match: async () => undefined, put: async (r, res) => { ttls.push(+/max-age=(\d+)/.exec(res.headers.get('cache-control'))[1]); } };
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ events: [{ id: '1', date: new Date(ko).toISOString(), competitions: [{ status: { type: { completed: false } }, competitors: [{ homeAway: 'home', team: { id: 'h', displayName: 'A' } }, { homeAway: 'away', team: { id: 'a', displayName: 'B' } }], odds: [{ moneyline: { home: { close: { odds: String(price) } }, draw: { close: { odds: '+280' } }, away: { close: { odds: '+400' } } } }] }] }] }) });
  kv.set('day:' + date, JSON.stringify({ date, cards: [{ id: '1', league: 'eng.1', kickoff: new Date(ko).toISOString(), home: 'A', away: 'B', v4: { p: [50, 25, 25] } }] }));
  await oddsStep(env, at(600), cache); await oddsStep(env, at(150), cache); await oddsStep(env, at(50), cache);
  ok('reads before the lineup window are not the close', !JSON.parse(kv.get('day:' + date)).cards[0].odds.cl);
  ok('10 hours out: next look in 6 hours; 2.5 hours out: in an hour; 50 minutes out: exactly at 30 minutes before', ttls[0] === 21600 && ttls[1] === 3600 && ttls[2] === 1200, JSON.stringify(ttls));
  price = -170; await oddsStep(env, at(28), cache);
  const c28 = JSON.parse(kv.get('day:' + date)).cards[0];
  ok('the read 28 minutes before kickoff (lineups out) is taken', c28.odds.h === -170, JSON.stringify(c28.odds));
  ok('that read is noted as the closing (lineup) read, and when the price changed', c28.odds.cl === at(28).toISOString() && c28.odds.ts === at(28).toISOString(), JSON.stringify(c28.odds));
  price = -250; const r = await oddsStep(env, at(15), cache);
  const c15 = JSON.parse(kv.get('day:' + date)).cards[0];
  ok('15 minutes before kickoff the price is locked: the lineup read stands as the close', c15.odds.h === -170 && r === null, JSON.stringify([c15.odds, r]));
  globalThis.fetch = real;
}

// 5. Results: results following the move, and your own picks against the close
{
  const M = blankMarket();
  addMarket(M, { final: { h: 2, a: 0 }, v4: { p: [55, 25, 20] }, odds, mine: 'H' });                     // big home move, home won: followed; your pick shortened
  addMarket(M, { final: { h: 0, a: 1 }, v4: { p: [55, 25, 20] }, odds, mine: 'A' });                     // big home move, away won: not followed; your pick drifted
  addMarket(M, { final: { h: 1, a: 1 }, v4: { p: [40, 30, 30] }, odds: { h: 150, d: 230, a: 180, f: { h: 150, d: 230, a: 180 } } }); // no move
  const R = finishMarket(M);
  ok('moves: two games moved, one followed; both big', R.moves.n === 2 && R.moves.follow === 1 && R.moves.big === 2 && R.moves.bigFollow === 1, JSON.stringify(R.moves));
  ok('v4 had already leaned home on both big moves', R.moves.modelWith === 2 && R.moves.modelAgainst === 0);
  ok('your picks: two, one beat the close (from the first price seen, else the opening line)', R.mine.n === 2 && R.mine.beat === 1, JSON.stringify(R.mine));
}
// 6. hockey: moneyline and total, the same schedule, the page's copy and the Results tally
{
  const px = parseHockeyOdds([{ moneyline: { home: { open: { odds: '-120' }, close: { odds: '-150' } }, away: { open: { odds: '+100' }, close: { odds: '+130' } } },
    total: { over: { open: { line: 'o6.5', odds: '+105' }, close: { line: 'o6.5', odds: '-115' } }, under: { open: { line: 'u6.5', odds: '-125' }, close: { line: 'u6.5', odds: '-105' } } } }]);
  ok('hockey: moneyline and total read, opening kept apart', px.h === -150 && px.a === 130 && px.op.h === -120 && px.op.a === 100 && px.tl === 6.5 && px.to === -115 && px.opt.to === 105, JSON.stringify(px));
  ok('hockey: the old flat block still gives the moneyline and total', (q => q.h === -200 && q.a === 170 && q.tl === 5.5 && q.to === -110)(parseHockeyOdds([{ homeTeamOdds: { moneyLine: -200 }, awayTeamOdds: { moneyLine: 170 }, overUnder: 5.5, overOdds: -110, underOdds: -110 }])));
  const hm = hockeyMove(px);
  ok('hockey: home moneyline chance went up, Over went up, the bigger one is the moneyline', hm.ml.d > 0 && hm.ou.d > 0 && hm.from === 'open' && Math.abs(hm.ml.p0 + (100 - hm.ml.p0) - 100) < 1e-9, JSON.stringify(hm));
  const html = fs.readFileSync(new URL('../public/nhl.html', import.meta.url), 'utf8');
  const grab = n => html.match(new RegExp(`(?:function ${n}\\([^)]*\\) \\{|const ${n} = )[\\s\\S]*?\\n(?:\\}\\n|(?=const |function ))`))[0];
  const page = new Function(`${['BIG_MOVE', 'devigP', 'hockeyMove'].map(grab).join('\n')}; return hockeyMove;`)();
  const cases = [px, { ...px, op: null, f: { h: -140, a: 120, tl: 6.5, to: -110, tu: -110 } }, { h: -110, a: -110 }, { tl: 5.5, to: -120, tu: 100, opt: { tl: 6.5, to: 100, tu: -120 } }];
  ok('hockey: page and server agree', cases.every(o => JSON.stringify(page(o)) === JSON.stringify(hockeyMove(o))), JSON.stringify(cases.map(o => [page(o), hockeyMove(o)])));
  // schedule: first sight, not due again for 6 hours, hourly in the last 3, the pre-game read, then locked
  const ko = Date.parse('2026-10-26T23:00:00Z'), at = m => new Date(ko - m * 60000), c = { kickoff: new Date(ko).toISOString() };
  const p0 = { h: -150, a: 130, tl: 6.5, to: -115, tu: -105 };
  ok('first sight keeps the price as the first price', setPrice(c, p0, at(600)) && c.px.f.h === -150 && c.px.rd === at(600).toISOString());
  ok('a new price 2 hours later is not taken (not due for 6 hours)', !setPrice(c, { ...p0, h: -160 }, at(480)) && c.px.h === -150);
  ok('2 hours before puck drop it is due again and the new price is taken', setPrice(c, { ...p0, h: -170 }, at(120)) && c.px.h === -170 && c.px.f.h === -150);
  ok('30 minutes later it is not due yet (hourly in the last 3 hours)', !setPrice(c, { ...p0, h: -180 }, at(90)));
  ok('the read 28 minutes before is taken and noted as the close', setPrice(c, { ...p0, h: -190 }, at(28)) && c.px.h === -190 && c.px.cl === at(28).toISOString());
  ok('15 minutes before the price is locked', !setPrice(c, { ...p0, h: -300 }, at(15)) && c.px.h === -190);
  ok('an unchanged price that is due writes nothing', !setPrice({ kickoff: c.kickoff, px: { ...p0, f: p0, rd: at(900).toISOString() } }, p0, at(300)));
  // the Results tally
  const card = (id, final, pxx) => ({ id, kickoff: '2026-10-25T23:00:00Z', home: 'H', away: 'A', hAbbr: 'H', aAbbr: 'A', final, grade: { line: 6.5 }, v2: { w: 55, o: 50 }, px: pxx });
  const days = { 'nhl:day:2026-10-25': { date: '2026-10-25', cards: [card('1', { h: 3, a: 1, total: 4, last: 'REG' }, px), card('2', { h: 1, a: 4, total: 5, last: 'REG' }, px)] } };
  const env = { HUB: { list: async () => ({ keys: Object.keys(days).map(name => ({ name })) }), get: async k => days[k] || null } };
  const T = await nhlTally(env);
  ok('hockey Results: winner followed the moneyline move once in two, totals went against the Over move twice', T.moves.ml.n === 2 && T.moves.ml.follow === 1 && T.moves.ou.n === 2 && T.moves.ou.follow === 0, JSON.stringify(T.moves));
}
console.log(fails ? `\n${fails} FAILED` : '\nAll price-move checks passed'); process.exit(fails ? 1 : 0);
