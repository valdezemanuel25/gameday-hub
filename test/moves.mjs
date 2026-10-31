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
ok('a first price saved without a total takes the first total seen later', (n => n.f.h === -150 && n.f.tl === 2.5 && n.f.to === -130 && n.h === -160)(withOdds({ h: -150, d: 280, a: 400, f: { h: -150, d: 280, a: 400 } }, { h: -160, d: 290, a: 420, tl: 2.5, to: -130, tu: 105 })));
ok('a first total, once saved, is kept', withOdds({ h: 1, d: 2, a: 3, f: { h: 1, d: 2, a: 3, tl: 2.5, to: -110, tu: -110 } }, { h: 1, d: 2, a: 3, tl: 2.5, to: -150, tu: 120 }).f.to === -110);
// fa: when the Hub first grabbed the price, shown above "Opening"
{
  const T = new Date('2026-10-31T14:00:00Z'), T2 = new Date('2026-10-31T18:00:00Z');
  const a = withOdds(null, { h: -150, d: 280, a: 400 }, T), b = withOdds(a, { h: -160, d: 290, a: 420 }, T2);
  ok('first-grab time: set on the first price and kept on later prices', a.fa === T.toISOString() && b.fa === T.toISOString(), JSON.stringify(b));
  ok('first-grab time: a price saved before this existed gets none (no made-up time)', withOdds({ h: -150, d: 280, a: 400, f: { h: -150, d: 280, a: 400 } }, { h: -160, d: 290, a: 420 }, T2).fa === undefined);
  const g = { kickoff: '2026-11-01T00:00:00Z' };
  setPrice(g, { h: -130, a: 110 }, T); const fa1 = g.px.fa; setPrice(g, { h: -140, a: 120 }, T2, true);
  ok('first-grab time (hockey): set on the first price and kept', fa1 === T.toISOString() && g.px.fa === T.toISOString(), JSON.stringify(g.px));
  const o = { kickoff: '2026-11-01T00:00:00Z', px: { h: -130, a: 110, f: { h: -130, a: 110 }, rd: T.toISOString() } }; setPrice(o, { h: -150, a: 125 }, T2, true);
  ok('first-grab time (hockey): an older price gets none', o.px.fa === undefined);
}
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
  const M2 = blankMarket(); addMarket(M2, { final: { h: 1, a: 1 }, odds, v6o: { btts: 50 }, v6: { btts: 56, p: [40, 30, 30] } }); addMarket(M2, { final: { h: 2, a: 0 }, odds, v6o: { btts: 50 }, v6: { btts: 54, p: [40, 30, 30] } }); addMarket(M2, { final: { h: 2, a: 0 }, odds, v6o: { btts: 50 }, v6: { btts: 50, p: [40, 30, 30] } });
  ok('both score: two moved 1+ points, one went the way of the move; no move, not counted', (b => b.n === 2 && b.follow === 1)(finishMarket(M2).moves.btts), JSON.stringify(finishMarket(M2).moves.btts));
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

// Both-score book prices (The Odds API): opening on the first read, close at the lineup read, credits kept for closing reads.
{
  const { bttsMove } = await import('../src/moves.js');
  const { addBtts, withOdds } = await import('../src/worker.js');
  const { blankMarket, addMarket, finishMarket } = await import('../src/market.js');
  const bm = bttsMove({ bf: { by: -120, bn: 100 }, by: -150, bn: 120 });
  ok('both-score move from the book price: Yes chance rose', bm && bm.d > 0 && bm.b0[0] === -120 && bm.b1[0] === -150, JSON.stringify(bm));
  ok('no first both-score price: no book move', bttsMove({ by: -150, bn: 120 }) === null);
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const grab = n => html.match(new RegExp(`(?:function ${n}\\([^)]*\\) \\{|const ${n} = )[\\s\\S]*?\\n(?:\\}\\n|(?=const |function ))`))[0];
  const page = new Function(`${['devigP', 'bttsMove'].map(grab).join('\n')}; return bttsMove;`)();
  const bc = [{ bf: { by: -120, bn: 100 }, by: -150, bn: 120 }, { by: -150, bn: 120 }, { bf: { by: 105, bn: -125 }, by: 105, bn: -125 }];
  ok('page and server agree on the both-score move', bc.every(o => JSON.stringify(page(o)) === JSON.stringify(bttsMove(o))));
  ok('a fresh ESPN price keeps the both-score prices and their history', (() => { const n = withOdds({ h: 1, d: 2, a: 3, by: -110, bn: -110, bf: { by: -105, bn: -115 }, bk: 'draftkings', bcl: 'x' }, { h: 4, d: 5, a: 6 }); return n.by === -110 && n.bf.by === -105 && n.bk === 'draftkings' && n.bcl === 'x'; })());

  const now = new Date('2026-10-26T12:00:00Z');
  const ev = (id, h, a, t) => ({ id, home_team: h, away_team: a, commence_time: t });
  const T1 = '2026-10-26T12:25:00Z', T2 = '2026-10-26T18:00:00Z';
  const events = [ev('e1', 'Paris Saint Germain', 'Lyon', T1), ev('e2', 'Lille', 'Nice', T2)];
  const price = { e1: [-140, 110], e2: [-115, -105] };
  const mk = (left, log) => async u => { log.push(u); const id = (u.match(/events\/(\w+)\/odds/) || [])[1];
    return { ok: true, headers: { get: k => (k === 'x-requests-remaining' ? String(left) : null) }, json: async () => (id ? { bookmakers: [{ key: 'draftkings', markets: [{ key: 'btts', outcomes: [{ name: 'Yes', price: price[id][0] }, { name: 'No', price: price[id][1] }] }] }] } : events) }; };
  const cards = () => [
    { id: '1', home: 'Paris Saint-Germain', away: 'Lyon', kickoff: T1, odds: { h: -310, d: 475, a: 750, bf: { by: -120, bn: 100 }, by: -120, bn: 100 } }, // in the lineup window, opened earlier
    { id: '2', home: 'Lille', away: 'Nice', kickoff: T2, odds: { h: 120, d: 240, a: 230 } }, // first read: opening
  ];
  let log = [], cs = cards();
  const n = await addBtts({ ODDS_API_KEY: 'k' }, cs, 'fra.1', now, mk(400, log));
  ok('lineup read: the close is read and noted, the opening kept', cs[0].odds.by === -140 && cs[0].odds.bf.by === -120 && cs[0].odds.bcl === now.toISOString(), JSON.stringify(cs[0].odds));
  ok('first read: the opening both-score price is stored', cs[1].odds.bf && cs[1].odds.bf.by === -115 && cs[1].odds.by === -115 && !cs[1].odds.bcl && n === 2, JSON.stringify(cs[1].odds));
  log = []; await addBtts({ ODDS_API_KEY: 'k' }, cs, 'fra.1', now, mk(400, log));
  ok('nothing left to read: only the free events list is fetched', log.length === 0, JSON.stringify(log));
  log = []; cs = cards(); await addBtts({ ODDS_API_KEY: 'k' }, cs, 'fra.1', now, mk(50, log));
  ok('credits low: the closing read still happens, the opening read waits', cs[0].odds.bcl && !cs[1].odds.bf && log.filter(u => u.includes('/odds')).length === 1, JSON.stringify(log));
  log = []; cs = cards(); const n0 = await addBtts({}, cs, 'fra.1', now, mk(400, log));
  ok('no key: no read at all', n0 === 0 && log.length === 0);
  cs = [{ id: '3', home: 'A', away: 'B', kickoff: T2, odds: { h: 1, d: 2, a: 3, by: -110, bn: -110 } }];
  await addBtts({ ODDS_API_KEY: 'k' }, cs, 'fra.1', now, mk(400, []));
  ok('a price read by the button before becomes the opening one', cs[0].odds.bf && cs[0].odds.bf.by === -110);

  const M = blankMarket();
  addMarket(M, { odds: { h: -150, d: 280, a: 400, bf: { by: -120, bn: 100 }, by: -150, bn: 120 }, final: { h: 1, a: 1 }, v6o: { btts: 60 }, v6: { btts: 55 } });
  ok('Results: the book both-score move is used ahead of the score card', finishMarket(M).moves.btts.n === 1 && finishMarket(M).moves.btts.follow === 1 && finishMarket(M).moves.btts.book === 1, JSON.stringify(finishMarket(M).moves.btts));
}

// Hockey lineup read on every cron run: a game inside 45-20 minutes before puck drop gets its closing read even when the NHL job has no slot.
{
  const { nhlLineupStep } = await import('../src/nhl.js');
  const now = new Date('2026-10-26T22:20:00Z'), ko = '2026-10-26T23:00:00Z', later = '2026-10-27T02:30:00Z';
  const days = { 'nhl:day:2026-10-26': { date: '2026-10-26', cards: [
    { id: 'g1', kickoff: ko, final: null, px: { h: -135, a: 114, f: { h: -135, a: 114 }, rd: '2026-10-26T20:00:00Z' } },
    { id: 'g2', kickoff: later, final: null, px: { h: -135, a: 114, f: { h: -135, a: 114 } } } ] } };
  let puts = 0, gets = 0;
  const env = { HUB: { get: async k => days[k] ? JSON.parse(JSON.stringify(days[k])) : null, put: async (k, v) => { puts++; days[k] = JSON.parse(v); } } };
  const comp = id => ({ id, date: id === 'g1' ? ko : later, competitions: [{ status: { type: { completed: false } }, competitors: [{ homeAway: 'home', team: { displayName: 'New York Rangers', abbreviation: 'NYR' } }, { homeAway: 'away', team: { displayName: 'Los Angeles Kings', abbreviation: 'LA' } }],
    odds: [{ moneyline: { home: { open: { odds: '-135' }, close: { odds: '-150' } }, away: { open: { odds: '+114' }, close: { odds: '+125' } } } }] }] });
  const f = async () => { gets++; return { ok: true, json: async () => ({ events: [comp('g1'), comp('g2')] }) }; };
  const r = await nhlLineupStep(env, now, f);
  const g = days['nhl:day:2026-10-26'].cards;
  ok('hockey: the game in the lineup window gets its closing read', r && r.read.join() === 'g1' && g[0].px.cl === now.toISOString() && g[0].px.h === -150, JSON.stringify(g[0].px));
  ok('hockey: a later game is left for its own window', !g[1].px.cl && g[1].px.h === -135);
  const before = gets; await nhlLineupStep(env, new Date(now.getTime() + 5 * 60000), f);
  ok('hockey: not read again within 10 minutes', gets === before && puts === 1, `${gets} ${puts}`);
  await nhlLineupStep(env, new Date(now.getTime() + 10 * 60000), f);
  ok('hockey: read again 10 minutes later, the close moves to the newer read', gets === before + 1 && days['nhl:day:2026-10-26'].cards[0].px.cl === new Date(now.getTime() + 10 * 60000).toISOString());
  gets = 0; await nhlLineupStep(env, new Date('2026-10-26T22:42:00Z'), f);
  ok('hockey: nothing once the price is locked (20 minutes before)', gets === 0);
  gets = 0; await nhlLineupStep(env, new Date('2026-10-26T20:00:00Z'), f);
  ok('hockey: nothing in the window, no ESPN read', gets === 0);
}

// Hockey: a finished game that missed its lineup read takes ESPN's closing line as the close, once.
{
  const { espnClose } = await import('../src/nhl.js');
  const c = { kickoff: '2026-10-27T00:30:00Z', final: { h: 2, a: 4 }, px: { h: 114, a: -135, tl: 6.5, to: -120, tu: 100, f: { h: 114, a: -135 }, ts: 'x' } };
  const done = parseHockeyOdds([{ moneyline: { home: { open: { odds: '+114' }, close: { odds: '+125' } }, away: { open: { odds: '-135' }, close: { odds: '-148' } } }, total: { over: { open: { line: 'o6.5', odds: '-112' }, close: { line: 'o6.5', odds: '-125' } }, under: { open: { line: 'u6.5', odds: '-108' }, close: { line: 'u6.5', odds: '+105' } } } }]);
  ok('hockey: ESPN close fills a missed lineup read', espnClose(c, done) && c.px.h === 125 && c.px.a === -148 && c.px.cls === 'espn' && c.px.cl === c.kickoff && c.px.f.h === 114, JSON.stringify(c.px));
  ok('hockey: only once', espnClose(c, done) === false);
  const r = { kickoff: 'k', px: { h: 1, a: 2, cl: 'read' } };
  ok('hockey: a real lineup read is never overwritten', espnClose(r, done) === false && r.px.h === 1);
  ok('hockey: no ESPN odds on the finished game, nothing changes', espnClose({ kickoff: 'k', px: { h: 1, a: 2 } }, null) === false);
}

// Hockey raw odds page: ESPN's odds block per game with what the Hub reads and what the card holds.
{
  const { nhlOddsRaw } = await import('../src/nhl.js');
  const odds = [{ moneyline: { home: { close: { odds: '+125' } }, away: { close: { odds: '-148' } } } }];
  const f = async () => ({ ok: true, json: async () => ({ events: [{ id: '9', shortName: 'TOR @ CGY', competitions: [{ status: { type: { shortDetail: 'Final' } }, odds }] }] }) });
  const env = { HUB: { get: async () => ({ cards: [{ id: '9', px: { h: 114, a: -135 } }] }) } };
  const r = await nhlOddsRaw(env, '2026-10-26', f);
  ok('hockey raw odds: raw block, the Hub read and the card', r.games[0].read.h === 125 && r.games[0].card.h === 114 && r.games[0].raw === odds && r.games[0].status === 'Final', JSON.stringify(r));
  ok('hockey raw odds: bad date refused', !!(await nhlOddsRaw(env, 'x', f)).error);
}

// Hockey goalie rest: days since tonight's starter last started, from the starters saved on the three days before.
{
  const { priorStarts, gkRestOf, gkRest } = await import('../src/nhl.js');
  const card = (h, a, gh, ga) => ({ hAbbr: h, aAbbr: a, gk: { h: gh ? { n: gh, st: 'c' } : null, a: ga ? { n: ga, st: 'c' } : null } });
  const days = { 'nhl:day:2026-10-28': { cards: [card('TBL', 'BOS', 'Andrei Vasilevskiy', 'Jeremy Swayman')] },
                 'nhl:day:2026-10-27': { cards: [card('WPG', 'MIN', 'Eric Comrie', 'Filip Gustavsson')] },
                 'nhl:day:2026-10-26': { cards: [card('WPG', 'CHI', 'Connor Hellebuyck', null)] } };
  const env = { HUB: { get: async k => days[k] || null } };
  const P = await priorStarts(env, '2026-10-29');
  ok('goalie rest: started yesterday is a back-to-back', gkRestOf(P, 'TBL', 'Andrei Vasilevskiy') === 1);
  ok('goalie rest: the team played yesterday with another goalie, so tonight\'s backup is rested longer', gkRestOf(P, 'TBL', 'Jonas Johansson') === 4);
  ok('goalie rest: last start three days ago (backup played in between)', gkRestOf(P, 'WPG', 'Connor Hellebuyck') === 3);
  ok('goalie rest: no start in three known days is 3+ days', gkRestOf(P, 'EDM', 'Stuart Skinner') === 4);
  ok('goalie rest: ESPN spelling a little different still matches', gkRestOf(P, 'BOS', 'Jeremy Swaymann') === 1);
  ok('goalie rest: a team card with no starter named is unknown', gkRestOf(P, 'CHI', 'Spencer Knight') === null);
  const P2 = await priorStarts({ HUB: { get: async () => null } }, '2026-10-29');
  ok('goalie rest: unknown days give null, never a guess', gkRestOf(P2, 'TBL', 'Andrei Vasilevskiy') === null);
  const P3 = await priorStarts({ HUB: { get: async () => null } }, '2026-10-29', new Set(['2026-10-28', '2026-10-27', '2026-10-26']));
  ok('goalie rest: days known to have had no games count as rest', gkRestOf(P3, 'TBL', 'Andrei Vasilevskiy') === 4);
  const r = gkRest(P, { hAbbr: 'TBL', aAbbr: 'WPG' }, { h: { n: 'Andrei Vasilevskiy' }, a: { n: 'Connor Hellebuyck' } });
  ok('goalie rest: both sides on the card', r.h === 1 && r.a === 3, JSON.stringify(r));
  const html = fs.readFileSync(new URL('../public/nhl.html', import.meta.url), 'utf8');
  const fn = html.match(/function gkRestTags\(c\) \{[\s\S]*?\n\}\n/)[0];
  const tags = new Function(`const esc = s => String(s); ${fn}; return gkRestTags;`)();
  const t = tags({ aAbbr: 'WPG', hAbbr: 'TBL', gk: { a: { n: 'Connor Hellebuyck' }, h: { n: 'Andrei Vasilevskiy' } }, gr: { a: 4, h: 1 } });
  ok('Movement card: his own rest in the Board\'s wording (back-to-back, 2 days rest, 3+ days rest)', t.includes('TBL · Andrei Vasilevskiy · Expected: back-to-back') && t.includes('WPG · Connor Hellebuyck · Expected: 3+ days rest') && tags({ aAbbr: 'A', hAbbr: 'B', gk: { a: { n: 'x', st: 'c' } }, gr: { a: 2 } }) === '<div class="mvgk"><span class="gc">A · x · Confirmed: 2 days rest</span></div>', t);
  ok('Movement card: his rest unknown falls back to the team\'s rest, said as the team\'s', tags({ aAbbr: 'NJD', hAbbr: 'VGK', gk: { a: { n: 'Connor Hellebuyck', st: 'e' }, h: { n: 'Carter Hart', st: 'e' } }, rs: { a: 2, h: 3 }, v5: { in: { bk: [0, 1] } } }) === '<div class="mvgk"><span class="gc e x">NJD · Connor Hellebuyck · Expected · Backup: team 2 days rest</span><span class="gc x">VGK · Carter Hart · Expected: team 3 days rest</span></div>');
  ok('Movement card: nothing known says rest unknown', tags({ aAbbr: 'A', hAbbr: 'B', gk: { a: { n: 'x', st: 'c' } } }).includes('x · Confirmed · rest unknown'));
  ok('Movement card: no goalie listed, no tag', tags({ aAbbr: 'A', hAbbr: 'B' }) === '');
}

// Update NHL now: a manual read takes the price off-schedule up to puck drop, and in the last 45 minutes it is the close.
{
  const now = new Date('2026-10-29T23:20:00Z');
  const mk = ko => ({ kickoff: ko, px: { h: -180, a: 150, f: { h: -180, a: 150 }, rd: '2026-10-29T23:00:00Z' } });
  const fresh = { h: -162, a: 136 };
  const a = mk('2026-10-29T23:30:00Z'); // 10 minutes out: past the lock
  ok('manual: past the 20-minute lock the button still takes the final price as the close', setPrice(a, fresh, now, true) && a.px.h === -162 && a.px.cl === now.toISOString() && a.px.cby === 'you', JSON.stringify(a.px));
  const b = mk('2026-10-29T23:30:00Z');
  ok('schedule: past the lock nothing changes', setPrice(b, fresh, now) === false && b.px.h === -180);
  const c = mk('2026-10-30T02:00:00Z'); // hours out, read 20 minutes ago
  ok('manual: hours out the price is taken off-schedule but is not the close', setPrice(c, fresh, now, true) && c.px.h === -162 && !c.px.cl);
  const d = mk('2026-10-29T23:10:00Z');
  ok('manual: after puck drop nothing changes', setPrice(d, fresh, now, true) === false);
}

// Goalie rest from his ESPN game log when the saved cards cannot tell (days before starters were saved).
{
  const { gamelogRest, restFor } = await import('../src/nhl.js');
  const log = { events: { a: { gameDate: '2026-10-26T23:00Z' }, b: { gameDate: '2026-10-24T23:00Z' } }, seasonTypes: [{ categories: [{ events: [{ eventId: 'a' }] }] }] };
  let calls = 0; const f = async u => { calls++; return { ok: true, json: async () => (u.includes('/999/') ? {} : log) }; };
  ok('game log: last game 3 days before is 3', await gamelogRest(f, '1', '2026-10-29') === 3);
  ok('game log: played yesterday is a back-to-back', await gamelogRest(f, '1', '2026-10-27') === 1);
  ok('game log: nothing readable is unknown', await gamelogRest(f, '999', '2026-10-29') === null);
  const P = [new Map([['DET', null]]), new Map(), new Map()]; // DET played yesterday with no goalie saved
  const c = { hAbbr: 'DET', aAbbr: 'CHI' }, gk = { h: { n: 'John Gibson', id: '1', st: 'c' }, a: { n: 'Spencer Knight', st: 'c' } };
  calls = 0; const r = await restFor(c, gk, P, '2026-10-29', f, { n: 8 });
  ok('rest: the unknown side is read from the game log; a side with no ESPN id stays as the cards say', r.h === 3 && r.a === 4 && calls === 1, JSON.stringify(r));
  c.gk = gk; c.gr = r; calls = 0; const r2 = await restFor(c, gk, P, '2026-10-29', f, { n: 8 });
  ok('rest: the same goalie keeps his worked-out rest, no second read', r2.h === 3 && calls === 0);
  calls = 0; await restFor({ hAbbr: 'DET', aAbbr: 'CHI' }, gk, P, '2026-10-29', f, { n: 0 });
  ok('rest: no read budget left, no read', calls === 0);
}

// The "v4 leaned this way" tag: a fraction of a point is not a lean, and v4's own pick is named when it is another result.
{
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const grab = n => html.match(new RegExp(`(?:function ${n}\\([^)]*\\) \\{|const ${n} = )[\\s\\S]*?\\n(?:\\}\\n|\\};\\n|(?=const |function ))`))[0];
  const read = new Function(`const strip = s => s, sideOf = (c, i) => (i === 1 ? 'Draw' : strip(i === 0 ? c.home : c.away)); ${grab('LEAN_MIN')}\n${grab('v4Read')}; return v4Read;`)();
  const c = { home: 'Grêmio', away: 'Athletico-PR', v4: { p: [36.3, 26.9, 36.8] } }, mv = { top: 0, p0: [35.9, 27, 37.1], d: [6.6, 0, -6] };
  const t = read(c, mv);
  ok('Grêmio case: v4 at the opening price is neutral, and its pick (Athletico-PR) is named', t === 'v4 neutral (v4 36%, picks Athletico-PR)', t);
  ok('a real lean (2+ points the same way) is in favor of v4', read({ ...c, v4: { p: [40, 27, 33] } }, mv) === 'in favor of v4 (v4 40%)');
  ok('v4 below the opening while the price rose: away from v4', read({ ...c, v4: { p: [30, 27, 43] } }, mv) === 'away from v4 (v4 30%, picks Athletico-PR)');
  const { blankMarket, addMarket, finishMarket } = await import('../src/market.js');
  const M = blankMarket();
  addMarket(M, { odds: { h: 125, d: 240, a: 205, op: { h: 165, d: 240, a: 155 } }, final: { h: 1, a: 1 }, v4: { p: [36.3, 26.9, 36.8] } });
  const mm = finishMarket(M).moves;
  ok('Results: a big move with v4 at the opening price counts as neither with nor against v4', mm.big === 1 && mm.modelWith === 0 && mm.modelAgainst === 0, JSON.stringify(mm));
}

// The goalie check page: what the card holds and what the game log gives, with the start of the first answer
{
  const { gkCheck, gamelogProbe } = await import('../src/nhl.js');
  const log = { events: { a: { gameDate: '2026-10-28T23:00Z' } }, seasonTypes: [{ categories: [{ events: [{ eventId: 'a' }] }] }] };
  let reads = 0; const f = async () => { reads++; return { ok: true, status: 200, text: async () => JSON.stringify(log) }; };
  const p = await gamelogProbe(f, '1', '2026-10-31');
  ok('probe: status, the dates found, the rest and the start of the answer', p.status === 200 && p.rest === 3 && p.dates.join() === '2026-10-28' && p.sample.startsWith('{'), JSON.stringify(p));
  const empty = await gamelogProbe(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ athlete: {}, filters: [] }) }), '1', '2026-10-31');
  ok('probe: an answer with no dates shows its top-level keys and has no rest', empty.rest === null && empty.keys.join() === 'athlete,filters');
  const env = { HUB: { get: async () => ({ cards: [{ aAbbr: 'NJD', hAbbr: 'VGK', final: null, gk: { a: { n: 'Connor Hellebuyck', id: '3', st: 'e' }, h: { n: 'Carter Hart', st: 'e' } }, rs: { a: 2, h: 3 }, gr: { a: 2 } }, { aAbbr: 'X', hAbbr: 'Y', final: { h: 1, a: 0 }, gk: { a: { n: 'z', id: '9' } } }] }) } };
  reads = 0; const r = await gkCheck(env, '2026-10-31', f);
  ok('check page: finished games left out, each starter with his id, rest and team rest; one read for the goalie that has an id', r.goalies.length === 2 && reads === 1 && r.goalies[0].espnId === '3' && r.goalies[0].log.rest === 3 && r.goalies[0].log.sample && r.goalies[0].cardRest === 2 && r.goalies[1].espnId === null && r.goalies[1].teamRest === 3, JSON.stringify(r));
  ok('check page: no saved day is an error', !!(await gkCheck({ HUB: { get: async () => null } }, '2026-10-31', f)).error);
}

// Colour code on the hockey Movement cards: red = check (goalie back-to-back, 5+ move), amber = watch (backup, team back-to-back, goalies not
// confirmed an hour out, 3-4 move), the card edge takes the highest.
{
  const html = fs.readFileSync(new URL('../public/nhl.html', import.meta.url), 'utf8');
  const grab = n => html.match(new RegExp(`(?:function ${n}\\([^)]*\\) \\{|const ${n} = )[\\s\\S]*?\\n(?:\\}\\n|(?=const |function ))`))[0];
  const f = new Function(`const esc = s => String(s), sgn = x => (x > 0 ? '+' : '') + x, HOT_MOVE = 3; ${['BIG_MV', 'mvLv', 'cardFlags'].map(grab).join('\n')}; return { mvLv, cardFlags };`)();
  const NOW = Date.parse('2026-10-31T20:00:00Z'), ko = m => new Date(NOW + m * 60000).toISOString();
  const card = o => ({ aAbbr: 'WPG', hAbbr: 'FLA', kickoff: ko(180), ...o });
  ok('levels: under 3 none, 3-4 amber, 5+ red', f.mvLv(2.4) === '' && f.mvLv(3) === 'a' && f.mvLv(-4.4) === 'a' && f.mvLv(5) === 'r' && f.mvLv(-7) === 'r' && f.mvLv(null) === '');
  const r1 = f.cardFlags(card({ kickoff: ko(50), gk: { a: { n: 'x', st: 'e' }, h: { n: 'y', st: 'c' } }, gr: { a: 1, h: 4 }, v5: { in: { bk: [0, 1] } } }), { ml: { d: 7 } }, NOW);
  ok('red card: goalie back-to-back, backup, not confirmed an hour out, big move', r1.level === 'r' && r1.items.map(x => x.t).join('|') === 'WPG goalie back-to-back|WPG backup in net|WPG goalie not confirmed|Big move: FLA +7', JSON.stringify(r1));
  const r2 = f.cardFlags(card({ gk: { a: { n: 'x', st: 'e' }, h: { n: 'y', st: 'e' } }, rs: { a: 1, h: 3 } }), { ml: { d: -3.4 } }, NOW);
  ok('amber card: team back-to-back (goalie rest unknown) and a 3-4 move; unconfirmed goalies are fine hours out', r2.level === 'a' && r2.items.map(x => x.t).join('|') === 'WPG team back-to-back|Move: WPG +3', JSON.stringify(r2));
  const r3 = f.cardFlags(card({ gk: { a: { n: 'x', st: 'c' }, h: { n: 'y', st: 'c' } }, gr: { a: 4, h: 3 } }), { ml: { d: 1 }, ou: { d: -2 } }, NOW);
  ok('clear card: confirmed, rested, small moves: no flags, no edge', r3.level === '' && r3.items.length === 0);
  const r4 = f.cardFlags(card({ gk: { a: { n: 'x', st: 'c' }, h: { n: 'y', st: 'c' } } }), { ou: { d: 4 } }, NOW);
  ok('a total move is flagged on its own', r4.level === 'a' && r4.items[0].t === 'Total: Over +4');
}

// Colour code on the soccer Movement cards (same scale as hockey): red = a 5+ move or DraftKings paying 4+ points more than Pinnacle, amber =
// a 3-4 move, a move against v4, both-score moving, DraftKings paying 2-3 more, no lineup read; green = v4 agrees.
{
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const grab = n => html.match(new RegExp(`(?:function ${n}\\([^)]*\\) \\{|const ${n} = )[\\s\\S]*?\\n(?:\\}\\n|(?=const |function ))`))[0];
  const f = new Function(`const esc = s => String(s), sgn = x => (x > 0 ? '+' : '') + x, BIG_MOVE = 5, LEAN_MIN = 2, strip = s => s, sideOf = (c, i) => (i === 1 ? 'Draw' : i === 0 ? c.home : c.away); ${['v4Read', 'HOT_MV', 'mvLv', 'socFlags'].map(grab).join('\n')}; return { mvLv, socFlags };`)();
  const c = { home: 'Grêmio', away: 'Athletico-PR', v4: { p: [36.3, 26.9, 36.8] } };
  const mv = (d, p0 = [36, 27, 37]) => ({ top: 0, p0, d: [d, 0, -d], ou: null });
  const x1 = f.socFlags(c, mv(7), { gap: [-5, 1, 4] }, { k: 'pend' });
  ok('red: big move, v4 neutral (plain), DraftKings paying 5 points more on the mover', x1.level === 'r' && x1.items.map(x => x.t + '/' + x.lv).join('|') === 'Big move: Grêmio +7/r|v4 neutral (v4 36%, picks Athletico-PR)/|DraftKings pays more than Pinnacle on Grêmio (5 pts)/r', JSON.stringify(x1));
  const x2 = f.socFlags({ ...c, v4: { p: [61, 22, 17] } }, mv(8, [53, 26, 21]), null, { k: 'pend' });
  ok('big move with v4 higher than the opening: red card, green v4 line', x2.level === 'r' && x2.items[1].lv === 'g' && x2.items[1].t === 'Move in favor of v4 (v4 61%)', JSON.stringify(x2));
  const x3 = f.socFlags({ ...c, v4: { p: [30, 28, 42] } }, mv(4, [40, 29, 32]), null, { k: 'pend' });
  ok('a 4 point move against v4: amber card', x3.level === 'a' && x3.items.map(x => x.t).join('|') === 'Move: Grêmio +4|Move away from v4 (v4 30%, picks Athletico-PR)', JSON.stringify(x3));
  ok('a move under 3 and no Pinnacle gap: clear', f.socFlags(c, mv(1), { gap: [0, 1, -1] }, { k: 'pend' }).level === '' && f.socFlags(c, mv(2.4), null, { k: 'ok' }).items.length === 0);
  const x4 = f.socFlags(c, { ...mv(1), ou: { line: 2.5, d: 4 } }, { gap: [0, 0, 0], bt: { p0: 50, p1: 54 } }, { k: 'miss' });
  ok('amber: the total moved, both score moved on Pinnacle, no lineup read', x4.level === 'a' && x4.items.map(x => x.t).join('|') === 'Over 2.5: +4|Both score (Pinnacle): +4|No lineup read: the last price is the close', JSON.stringify(x4));
  const x5 = f.socFlags(c, mv(1), { gap: [-2.6, 1, 1] }, { k: 'pend' });
  ok('DraftKings paying 2-3 points more than Pinnacle is amber; paying less (shorter) is not flagged', x5.level === 'a' && f.socFlags(c, mv(1), { gap: [3, -1, -1.5] }, { k: 'pend' }).level === '');
  ok('levels: under 3 none, 3-4 amber, 5+ red', f.mvLv(2.4) === '' && f.mvLv(3) === 'a' && f.mvLv(-4.4) === 'a' && f.mvLv(5) === 'r' && f.mvLv(null) === '');
}

// Saturday 3 PM: several leagues kick off together. The lineup window is 10 minutes (two cron runs), so the leagues that need their lineup read
// are all done within them (3 a run, soonest kickoff first) instead of one league a run.
{
  const date = '2026-10-31', ko = Date.parse('2026-10-31T15:00:00Z'), now = new Date(ko - 28 * 60000), kv = new Map(), leagues = ['eng.1', 'ger.1', 'eng.2', 'fra.1', 'ita.1'];
  const env = { HUB: { get: async (k, t) => { const v = kv.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => kv.set(k, v) } };
  const real = globalThis.fetch;
  globalThis.fetch = async u => { const slug = (u.match(/soccer\/([a-z.0-9]+)\/scoreboard/) || [])[1]; return { ok: true, json: async () => ({ events: [{ id: slug, date: new Date(ko).toISOString(), competitions: [{ status: { type: { completed: false } }, competitors: [{ homeAway: 'home', team: { id: 'h' + slug, displayName: 'H ' + slug, abbreviation: 'H' } }, { homeAway: 'away', team: { id: 'a' + slug, displayName: 'A ' + slug, abbreviation: 'A' } }], odds: [{ provider: { name: 'Draft Kings' }, homeTeamOdds: { moneyLine: -150 }, awayTeamOdds: { moneyLine: 400 }, drawOdds: { moneyLine: 280 } }] }] }] }) }; };
  kv.set('day:' + date, JSON.stringify({ date, cards: leagues.map((l, i) => ({ id: l, league: l, kickoff: new Date(ko + (i === 2 ? 0 : 0)).toISOString(), home: 'H ' + l, away: 'A ' + l, v4: { p: [50, 25, 25] } })) }));
  const cache = { match: async () => undefined, put: async () => {} };
  const r1 = await oddsStep(env, now, cache);
  const got = () => JSON.parse(kv.get('day:' + date)).cards.filter(c => c.odds && c.odds.cl).map(c => c.league);
  ok('first run in the window: three leagues get their lineup read, not one', r1 && r1.also && r1.also.length === 2 && got().length === 3, JSON.stringify([got(), r1 && r1.also && r1.also.length]));
  const r2 = await oddsStep(env, new Date(now.getTime() + 5 * 60000), cache);
  const cs = JSON.parse(kv.get('day:' + date)).cards;
  ok('the next run takes the other two, and the first three keep the time of their read (not read again for the close)', got().length === 5 && r2.also.length === 1 && ['eng.1', 'ger.1', 'ita.1'].every(l => cs.find(c => c.league === l).odds.cl === now.toISOString()) && ['fra.1', 'eng.2'].every(l => cs.find(c => c.league === l).odds.cl === new Date(now.getTime() + 5 * 60000).toISOString()), JSON.stringify(cs.map(c => [c.league, c.odds.cl])));
  globalThis.fetch = real;
}

// "Get the final price" on one card: before kickoff the price now is the close; after the final, ESPN's closing line; in between, refused.
{
  const { refreshCardClose } = await import('../src/worker.js');
  const date = '2026-10-31', ko = Date.parse('2026-10-31T15:00:00Z'), kv = new Map();
  const env = { HUB: { get: async (k, t) => { const v = kv.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => kv.set(k, v) } };
  let done = false, price = -170, withOdds2 = true; const real = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ events: [{ id: '1', date: new Date(ko).toISOString(), competitions: [{ status: { type: { completed: done } }, competitors: [{ homeAway: 'home', team: { id: 'h', displayName: 'Sheffield United', abbreviation: 'SHU' } }, { homeAway: 'away', team: { id: 'a', displayName: 'Wrexham', abbreviation: 'WRX' } }], ...(withOdds2 ? { odds: [{ provider: { name: 'Draft Kings' }, homeTeamOdds: { moneyLine: price }, awayTeamOdds: { moneyLine: 400 }, drawOdds: { moneyLine: 280 } }] } : {}) }] }] }) });
  const card = () => ({ id: '1', league: 'eng.2', kickoff: new Date(ko).toISOString(), home: 'Sheffield United', away: 'Wrexham', v4: { p: [50, 25, 25] }, odds: { h: -150, d: 280, a: 400, ts: 'T0' } });
  const put = c => kv.set('day:' + date, JSON.stringify({ date, cards: [c] })), get = () => JSON.parse(kv.get('day:' + date)).cards[0];
  put(card()); const at = new Date(ko - 15 * 60000);
  const r1 = await refreshCardClose(env, date, 'eng.2', '1', at);
  ok('before kickoff, past the lock: the price now is taken as the close, marked as yours', r1.ok && get().odds.h === -170 && get().odds.cl === at.toISOString() && get().odds.cby === 'you' && get().odds.ts === at.toISOString(), JSON.stringify([r1, get().odds]));
  put(card()); const r2 = await refreshCardClose(env, date, 'eng.2', '1', new Date(ko + 10 * 60000));
  ok('started, not final: refused with the reason, nothing changes', !!r2.error && r2.error.includes('started') && get().odds.h === -150 && !get().odds.cl, JSON.stringify([r2, get().odds]));
  done = true; price = -180; put(card()); const r3 = await refreshCardClose(env, date, 'eng.2', '1', new Date(ko + 3 * 3600e3));
  ok('after the final: ESPN\'s closing line, noted as ESPN\'s', r3.ok && get().odds.h === -180 && get().odds.cls === 'espn' && get().odds.cl === new Date(ko).toISOString() && !get().odds.cby, JSON.stringify([r3, get().odds]));
  withOdds2 = false; put(card()); const r4 = await refreshCardClose(env, date, 'eng.2', '1', new Date(ko + 3 * 3600e3));
  ok('after the final with no closing line from ESPN: the last price stands, said plainly', !!r4.error && r4.error.includes('last price stands') && !get().odds.cl, JSON.stringify(r4));
  done = false; put(card()); const r5 = await refreshCardClose(env, date, 'eng.2', '1', at);
  ok('before kickoff but ESPN has no price: an error, nothing changes', !!r5.error && !get().odds.cl);
  ok('a game that is not saved, or a league that is not priced, is an error', !!(await refreshCardClose(env, date, 'eng.2', '9', at)).error && !!(await refreshCardClose(env, date, 'esp.2', '1', at)).error);
  globalThis.fetch = real;
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  ok('the Movement badge is a button when there is no lineup read or one is due, a plain label otherwise', html.includes('data-getclose=') && html.includes("act: true }") && html.includes("o.cby === 'you' ? ' (your update)'"));
}

// "Get the final price" on one hockey card: before puck drop the price now (the close inside 45 minutes, past the lock too); after the final
// ESPN's closing line if the card has none; in between, refused.
{
  const { nhlCardClose } = await import('../src/nhl.js');
  const date = '2026-10-31', ko = Date.parse('2026-10-31T23:00:00Z'), kv = new Map();
  const env = { HUB: { get: async (k, t) => { const v = kv.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => kv.set(k, v) } };
  let done = false, ml = -150, hasOdds = true;
  const f = async () => ({ ok: true, json: async () => ({ events: [{ id: 'g1', date: new Date(ko).toISOString(), competitions: [{ status: { type: { completed: done, shortDetail: done ? 'Final' : '7:00 PM' } }, competitors: [{ homeAway: 'home', score: '3', team: { displayName: 'Florida Panthers', abbreviation: 'FLA' } }, { homeAway: 'away', score: '2', team: { displayName: 'Winnipeg Jets', abbreviation: 'WPG' } }], ...(hasOdds ? { odds: [{ homeTeamOdds: { moneyLine: ml }, awayTeamOdds: { moneyLine: 130 }, overUnder: 6.5, overOdds: -110, underOdds: -110 }] } : {}) }] }] }) });
  const card = (o = {}) => ({ id: 'g1', kickoff: new Date(ko).toISOString(), home: 'Florida Panthers', away: 'Winnipeg Jets', hAbbr: 'FLA', aAbbr: 'WPG', final: null, px: { h: -135, a: 114, f: { h: -135, a: 114 }, ts: 'T0', ...o } });
  const put = c => kv.set('nhl:day:' + date, JSON.stringify({ date, cards: [c] })), get = () => JSON.parse(kv.get('nhl:day:' + date)).cards[0];
  put(card()); const at = new Date(ko - 15 * 60000);
  const r1 = await nhlCardClose(env, date, 'g1', at, f);
  ok('before puck drop, past the lock: the price now is the close, marked as yours', r1.ok && r1.closed && get().px.h === -150 && get().px.cl === at.toISOString() && get().px.cby === 'you', JSON.stringify([r1, get().px]));
  put(card()); const r2 = await nhlCardClose(env, date, 'g1', new Date(ko - 120 * 60000), f);
  ok('hours before puck drop: the price is refreshed but is not the close', r2.ok && !r2.closed && get().px.h === -150 && !get().px.cl, JSON.stringify([r2, get().px]));
  put(card()); const r3 = await nhlCardClose(env, date, 'g1', new Date(ko + 20 * 60000), f);
  ok('puck dropped, not final: refused, nothing changes', !!r3.error && r3.error.includes('started') && get().px.h === -135, JSON.stringify(r3));
  done = true; ml = -170; put(card()); const r4 = await nhlCardClose(env, date, 'g1', new Date(ko + 3 * 3600e3), f);
  ok('after the final: ESPN\'s closing line, noted as ESPN\'s', r4.ok && get().px.h === -170 && get().px.cls === 'espn', JSON.stringify([r4, get().px]));
  put(card({ cl: 'T1' })); const r5 = await nhlCardClose(env, date, 'g1', new Date(ko + 3 * 3600e3), f);
  ok('after the final with a read of its own: left alone', !!r5.error && r5.error.includes('already') && get().px.cl === 'T1');
  hasOdds = false; put(card()); const r6 = await nhlCardClose(env, date, 'g1', new Date(ko + 3 * 3600e3), f);
  ok('after the final with no closing line from ESPN: the last price stands, said plainly', !!r6.error && r6.error.includes('last price stands'));
  ok('a game that is not saved is an error', !!(await nhlCardClose(env, date, 'nope', at, f)).error);
  const nhlHtml2 = fs.readFileSync(new URL('../public/nhl.html', import.meta.url), 'utf8');
  ok('the hockey badge is a button when there is no read or one is due, and posts to the close route', nhlHtml2.includes('data-getclose=') && nhlHtml2.includes("'/api/nhl/close'") && nhlHtml2.includes('act: true }'));
}
console.log(fails ? `\n${fails} FAILED` : '\nAll price-move checks passed'); process.exit(fails ? 1 : 0);
