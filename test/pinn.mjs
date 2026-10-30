// Pinnacle prices from PinnOdds: trimming the fixture list, matching games, the request budget and failures, and what a card keeps.
import fs from 'fs';
import { reduceEvents, matchPinn, fetchPinn, pinnEvents, pinnPrice, specialsSample } from '../src/pinn.js';
import { pinnMove } from '../src/moves.js';
import { addPinn, pinnCheck, withOdds } from '../src/worker.js';
let fails = 0; const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n} ${c ? '' : x}`); };

const ev = (id, lg, home, away, starts, ml, tot, extra = {}) => ({ event_id: id, league_name: lg, home, away, starts, event_type: 'prematch', periods: { num_0: { money_line: ml, totals: tot || {} } }, ...extra });
const T1 = '2026-10-30T22:30:00Z';
const fixtures = { sport_id: 1, events: [
  ev(1, 'Brazil - Serie A', 'Gremio', 'Athletico Paranaense', T1, { home: 2.3, draw: 3.4, away: 3.2 }, { '2.5': { points: 2.5, over: 1.95, under: 1.9 }, '3.5': { points: 3.5, over: 3, under: 1.4 } }),
  ev(2, 'Brazil - Serie A', 'Santos', 'Fortaleza', T1, { home: 2.8, draw: 3.2, away: 2.6 }),
  ev(3, 'Brazil - Serie A', 'Gremio (Women)', 'Athletico Paranaense (Women)', T1, { home: 2, draw: 3, away: 4 }),
  ev(4, 'Spain - La Liga', 'Real Madrid', 'Girona', T1, { home: 1.4, away: 7 }),                       // 2-way: no draw price
  ev(5, 'Spain - La Liga', 'Elche', 'Getafe', T1, { home: 2.4, draw: 3, away: 3 }, {}, { special: 'Exact Score' }),
  ev(6, 'Spain - La Liga', 'Elche', 'Getafe', 'not a date', { home: 2.4, draw: 3, away: 3 }),
  ev(7, 'Brazil - Serie A Bookings', 'Gremio', 'Athletico Paranaense', T1, { home: 1.9, draw: 3.5, away: 3.9 }), ev(8, 'Brazil - Serie A (Corners)', 'Santos', 'Fortaleza', T1, { home: 2, draw: 4, away: 3 }) ] };
const red = reduceEvents(fixtures);
ok('trimmed: the two good fixtures only (women, no-draw, special, bad-date and Bookings / Corners rows left out)', red.length === 2 && red[0].home === 'Gremio' && red[1].home === 'Santos', JSON.stringify(red.map(e => e.home)));
ok('prices are American, and only the 2.5 total is kept', red[0].h === 130 && red[0].d === 240 && red[0].a === 220 && red[0].tl === 2.5 && red[0].to === -105 && red[0].tu === -111 && red[1].tl === undefined, JSON.stringify(red[0]));
const card = { id: '1', home: 'Grêmio', away: 'Athletico-PR', kickoff: T1 };
ok('matched by team names (Athletico-PR spelled out) and kickoff', matchPinn(card, red).id === 1 && matchPinn({ ...card, kickoff: '2026-10-31T22:30:00Z' }, red) === null && matchPinn({ ...card, home: 'Other' }, red) === null);

const hd = o => ({ get: k => o[k.toLowerCase()] ?? null });
const mk = (log, o = {}) => async (u, init) => { log.push([u, init && init.headers]); return { ok: o.status ? o.status < 400 : true, status: o.status || 200, headers: hd(o.headers || { 'x-data-status': 'fresh', 'x-data-age-ms': '3000' }), text: async () => JSON.stringify(fixtures) }; };
{ const log = [], r = await fetchPinn('KEY', mk(log));
  ok('one request, soccer prematch, key in the x-portal-apikey header', log.length === 1 && log[0][0] === 'https://pinnodds.com/kit/v1/prematch/fixtures?sport_id=1' && log[0][1]['x-portal-apikey'] === 'KEY' && r.events.length === 2 && r.age === 3000 && r.bytes > 100); }
ok('no key: error, no request', (await fetchPinn('', mk([]))).error.includes('PINNODDS_KEY'));
{ const r = await fetchPinn('K', mk([], { status: 429, headers: { 'retry-after': '41' } })); ok('rate limited: flagged with the wait', r.limited && r.retryMs === 41000); }
ok('401 and stale are errors, not prices', (await fetchPinn('K', mk([], { status: 401 }))).error.includes('401') && (await fetchPinn('K', mk([], { headers: { 'x-data-status': 'stale' } }))).error.includes('stale'));
ok('a network failure does not throw', (await fetchPinn('K', async () => { throw new Error('down'); })).error.includes('down'));

// addPinn: opening once, the close at the lineup window, the retry limits
const now = new Date('2026-10-30T15:00:00Z'), cards = () => [{ id: '1', home: 'Grêmio', away: 'Athletico-PR', kickoff: T1, odds: { h: 125, d: 240, a: 205 } }, { id: '9', home: 'Nobody', away: 'Nowhere', kickoff: T1, odds: { h: 100, d: 200, a: 300 } }];
{ const log = [], cs = cards(), n = await addPinn({ PINNODDS_KEY: 'K' }, cs, now, mk(log));
  ok('first read: the price is kept as now and as the first seen; one request for both games', cs[0].odds.pn.h === 130 && cs[0].odds.pf.h === 130 && !cs[0].odds.pcl && log.length === 1 && n === 2, JSON.stringify(cs[0].odds));
  ok('a game with no match notes the try', !cs[1].odds.pn && !!cs[1].odds.pat);
  const log2 = []; await addPinn({ PINNODDS_KEY: 'K' }, cs, new Date(now.getTime() + 3600e3), mk(log2));
  ok('nothing left to read: no request (the unmatched game waits 3 hours)', log2.length === 0);
  const log3 = []; await addPinn({ PINNODDS_KEY: 'K' }, cs, new Date(now.getTime() + 4 * 3600e3 - 60000), mk(log3));
  ok('the unmatched game is tried again after 3 hours', log3.length === 1);
  const close = new Date('2026-10-30T22:10:00Z'), log4 = []; fixtures.events[0].periods.num_0.money_line = { home: 2.1, draw: 3.4, away: 3.6 };
  await addPinn({ PINNODDS_KEY: 'K' }, cs, close, mk(log4));
  ok('the lineup read updates the price, notes the close and keeps the first price', cs[0].odds.pn.h === 110 && cs[0].odds.pf.h === 130 && cs[0].odds.pcl === close.toISOString(), JSON.stringify(cs[0].odds));
  const log5 = []; await addPinn({ PINNODDS_KEY: 'K' }, cs, new Date(close.getTime() + 60000), mk(log5));
  ok('once the close is read: no more requests for it', log5.length === 0); }
ok('no key: nothing runs', (await addPinn({}, cards(), now, mk([]))) === 0);
{ const log = [], cs = cards(); const n = await addPinn({ PINNODDS_KEY: 'K' }, cs, now, mk(log, { status: 401 })); ok('a failed read changes nothing and does not throw', n === 0 && !cs[0].odds.pn); }
ok('a fresh ESPN price keeps the Pinnacle prices', (n => n.pn && n.pf && n.pcl === 'x' && n.pat === 'y')(withOdds({ h: 1, d: 2, a: 3, pn: { h: 1 }, pf: { h: 2 }, pcl: 'x', pat: 'y' }, { h: 4, d: 5, a: 6 })));

// the move and the page's copy of it
const odds = { h: 125, d: 240, a: 205, pf: { h: 150, d: 250, a: 190, tl: 2.5, to: -105, tu: -111 }, pn: { h: 130, d: 240, a: 220, tl: 2.5, to: -115, tu: -105 } };
const pm = pinnMove(odds);
ok('move: first seen to now, DraftKings gap and the total', pm && pm.d[0] > 0 && pm.d[2] < 0 && pm.gap.length === 3 && pm.ou && pm.ou.p1 > pm.ou.p0, JSON.stringify(pm));
ok('move: needs both prices', pinnMove({ ...odds, pf: null }) === null && pinnMove({ h: 1, d: 2, a: 3 }) === null);
{ const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const grab = n => html.match(new RegExp(`(?:function ${n}\\([^)]*\\) \\{|const ${n} = )[\\s\\S]*?\\n(?:\\}\\n|(?=const |function ))`))[0];
  const page = new Function(`${['devigP', 'pinnMove'].map(grab).join('\n')}; return pinnMove;`)();
  ok('page and server agree on the Pinnacle move', [odds, { ...odds, pn: { h: 130, d: 240, a: 220 } }, { ...odds, pf: null }].every(o => JSON.stringify(page(o)) === JSON.stringify(pinnMove(o))));
  const note = new Function(`const esc = s => String(s), sgn = x => (x > 0 ? '+' : '') + x, sideOf = (c, i) => (i === 1 ? 'Draw' : i === 0 ? c.home : c.away), tmCT = () => '7:00 PM'; ${['devigP', 'pinnMove', 'pinnNote'].map(grab).join('\n')}; return pinnNote;`)();
  const t = note({ home: 'Grêmio', away: 'Athletico-PR' }, { ...odds, h: 100, d: 240, a: 300, pcl: '2026-10-30T22:00:00Z' });
  ok('Movement card line names Pinnacle, the close and where DraftKings sits', t.includes('Pinnacle (closing read ✓ 7:00 PM)') && t.includes('Grêmio') && t.includes('DraftKings is'), t);
  ok('no Pinnacle price, no line', note({ home: 'a', away: 'b' }, { h: 100, d: 200, a: 300 }) === ''); }

// the shared list and the check page
{ const log = [], env = { PINNODDS_KEY: 'K' }; const a = await pinnEvents(env, mk(log)), b = await pinnEvents(env, mk(log));
  ok('without an edge cache each look asks again (the cache is a Workers feature)', a.events.length === 2 && b.events.length === 2 && log.length === 2); }
{ const env = { PINNODDS_KEY: 'K', HUB: { get: async k => (k === '2026-10-30' || k.endsWith('2026-10-30') ? { cards: [{ id: '1', league: 'bra.1', home: 'Grêmio', away: 'Athletico-PR', kickoff: T1, odds: { h: 125, d: 240, a: 205 } }] } : null) } };
  const r = await pinnCheck(env, 'bra.1', mk([]), new Date('2026-10-30T15:00:00Z'));
  ok('check page: request count, size, leagues, and each game matched with both prices', r.requests === 1 && r.fixtures === 2 && r.dataStatus === 'fresh' && r.games[0].matched.includes('Brazil - Serie A') && r.games[0].pinnacle.h === 110 && r.games[0].draftkings.h === 125 && r.leagueNames[0][0] === 'Brazil - Serie A', JSON.stringify(r));
  const env2 = { PINNODDS_KEY: 'K', HUB: { get: async k => (k.endsWith('2026-10-30') ? { cards: [{ id: '5', league: 'bra.1', home: 'Santos', away: 'Gremio', kickoff: T1, odds: { h: 1, d: 2, a: 3 } }] } : null) } };
  const r2 = await pinnCheck(env2, 'bra.1', mk([]), new Date('2026-10-30T15:00:00Z'));
  ok('check page: an unmatched game lists the nearest fixtures and whether it has started', r2.games[0].matched === null && r2.games[0].nearest.length === 1 && r2.games[0].nearest[0].includes('Santos v Fortaleza') && r2.games[0].started === false, JSON.stringify(r2.games[0])); }

// Both teams to score: its own special row, joined to the match by parent_id (or names + kickoff)
{
  const sp = (id, parent, name, extra) => ({ event_id: id, parent_id: parent, league_name: 'Brazil - Serie A', home: 'Gremio', away: 'Athletico Paranaense', starts: T1, special: name, periods: {}, ...extra });
  const j = JSON.parse(JSON.stringify(fixtures));
  j.events.push(sp(101, 1, 'Both Teams To Score', { special_markets: { num_0: [{ type: 'moneyline', prices: [{ name: 'No', price: 2.1 }, { name: 'Yes', price: 1.75 }] }] } }));
  j.events.push(sp(102, 2, 'Both Teams to Score', { periods: { num_0: { money_line: { home: 1.8, away: 2.0 } } }, special_outcomes: { home: 'Yes', away: 'No' }, home: 'Santos', away: 'Fortaleza' }));
  j.events.push(sp(103, 1, 'Both Teams To Score - 1st Half', { special_markets: { num_0: [{ prices: [{ name: 'Yes', price: 5 }, { name: 'No', price: 1.1 }] }] } }));
  const r = reduceEvents(j);
  ok('both score, new shape: Yes and No by name (order does not matter), joined by parent_id', r[0].bty === -133 && r[0].btn === 110, JSON.stringify(r[0]));
  ok('both score, old shape: money-line slots named by special_outcomes', r[1].bty === -125 && r[1].btn === 100, JSON.stringify(r[1]));
  ok('a half or combined both-score row is not the match one', r[0].bty !== 400);
  const unk = JSON.parse(JSON.stringify(fixtures)); unk.events.push(sp(104, 1, 'Both Teams To Score', { periods: { num_0: { money_line: { home: 1.8, away: 2.0 } } }, special_outcomes: ['Yes', 'No'] }));
  ok('slots that cannot be told apart: no both-score price, never guessed', reduceEvents(unk)[0].bty === undefined);
  ok('a fixture with no both-score row has none', reduceEvents(fixtures)[0].bty === undefined);
  const byName = JSON.parse(JSON.stringify(fixtures)); byName.events.push(sp(105, undefined, 'Both Teams To Score', { special_markets: { num_0: [{ prices: [{ name: 'Yes', price: 1.9 }, { name: 'No', price: 1.9 }] }] } }));
  ok('no parent id: joined by team names and kickoff', reduceEvents(byName)[0].bty === -111);
  const sm = specialsSample(j);
  ok('check page: special names counted and raw both-score rows shown with what the Hub parsed', sm.names[0][1] >= 1 && sm.raw.length === 3 && sm.raw[0].parsed.by === -133, JSON.stringify(sm).slice(0, 300));
  ok('the price a card keeps includes both score', pinnPrice(r[0]).bty === -133);
  const o2 = { h: 125, d: 240, a: 205, pf: { h: 150, d: 250, a: 190, bty: -120, btn: 100 }, pn: { h: 130, d: 240, a: 220, bty: -150, btn: 125 } };
  const pm2 = pinnMove(o2); ok('move: both score first seen to now', pm2.bt && pm2.bt.p1 > pm2.bt.p0, JSON.stringify(pm2.bt));
  const html2 = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8'), grab2 = n => html2.match(new RegExp(`(?:function ${n}\\([^)]*\\) \\{|const ${n} = )[\\s\\S]*?\\n(?:\\}\\n|(?=const |function ))`))[0];
  const page2 = new Function(`${['devigP', 'pinnMove'].map(grab2).join('\n')}; return pinnMove;`)();
  ok('page and server agree with both score in the move', JSON.stringify(page2(o2)) === JSON.stringify(pinnMove(o2)));
}
console.log(fails ? `\n${fails} FAILED` : '\nAll Pinnacle checks passed'); process.exit(fails ? 1 : 0);
