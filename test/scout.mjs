// Scout (src/scout.js): the board it reads, the honesty checks on its log, grading on read, and public/scout.json itself.
// Scout runs `node test/scout.mjs` before it commits its log: a FAIL here means the log must not be committed.
import { readFileSync } from 'node:fs';
import { board, problem, validLog, grade, record, daysToRead, cardsFrom, STAKE } from '../src/scout.js';
import worker from '../src/worker.js';
let bad = 0; const ok = (c, m) => { if (!c) { bad++; console.log('FAIL', m); } };

// the committed log is valid
const file = JSON.parse(readFileSync(new URL('../public/scout.json', import.meta.url), 'utf8'));
const errs = validLog(file); ok(!errs.length, 'public/scout.json is valid: ' + errs.join('; '));

const now = new Date('2026-11-07T12:00:00Z');
const soc = { id: '1', league: 'eng.1', leagueName: 'Premier League', kickoff: '2026-11-07T15:00:00Z', home: 'Arsenal', away: 'Chelsea', final: null,
  v2: { p: [50, 25, 25], over: 55, btts: 52 }, v4: { p: [55, 24, 21], over: 58, btts: 54, lam: [1.6, 1.1], scores: [['1-0', 11], ['2-1', 9], ['1-1', 9], ['2-0', 8]] },
  sx: { sot: 9.2, gl: 3.0, sh: 25.6, n: 8 }, odds: { h: -120, d: 260, a: 320, tl: 2.5, to: -115, tu: -105, by: -110, bn: -110, op: { h: -110, d: 250, a: 300 } } };
const late = { ...soc, id: '2', kickoff: '2026-11-07T12:10:00Z' }, far = { ...soc, id: '3', kickoff: '2026-11-09T12:10:00Z' }, nopx = { ...soc, id: '4', odds: null };
const stand = { ...soc, id: '5', odds: { h: -120, d: 260, a: 320, src: 'bet365', by: -105, bn: -115 } };
const hk = { id: '9', kickoff: '2026-11-08T00:00:00Z', home: 'Toronto Maple Leafs', away: 'Utah Mammoth', hAbbr: 'TOR', aAbbr: 'UTA', v2: { w: 55, o: 52 }, v4: { w: 57, o: 54 },
  px: { h: -140, a: 120, tl: 6.5, to: 105, tu: -125, f: { h: -130, a: 110, tl: 6.5, to: 100, tu: -120 } }, sg: { p: { '5.5': 58, '6.5': 41 }, gs: ['confirmed', 'expected'] }, gk: { h: { n: 'J. Woll', st: 'confirmed' } } };
const B = board({ soccer: { '2026-11-07': [soc, late, far, nopx, stand] }, nhl: { '2026-11-07': [hk] } }, now, [{ sport: 'soccer', date: '2026-11-07', league: 'eng.1', gid: '1', rule: 'move', key: 'H', price: -120 }],
  [{ sport: 'nhl', date: '2026-11-07', league: 'nhl', gid: '9', key: 'O', line: 6.5 }]);
ok(B.length === 3, 'board: priced games in the window only (not locked, not 36h+ away, not unpriced) ' + B.map(g => g.gid));
const g1 = B.find(g => g.gid === '1');
ok(g1 && g1.price.H === -120 && g1.price.O === -115 && g1.price.B === -110 && g1.open.H === -110, 'board: soccer prices now and at the open');
ok(g1 && g1.fair['1x2'].length === 3 && Math.abs(g1.fair['1x2'].reduce((a, b) => a + b, 0) - 100) < 0.5, 'board: margin-free chances');
ok(g1 && g1.models.v4 && g1.models.v4.top.length === 3 && g1.models.shots && g1.models.shots.tested && g1.models.shots.over != null, 'board: v4 and the shots read');
ok(g1 && g1.analystBets && /move/.test(g1.analystBets[0]), "board: the Analyst's bets on the game");
const g5 = B.find(g => g.gid === '5'); ok(g5 && g5.price.H == null && g5.price.B === -105, 'board: a stand-in book is not offered (it could not be closed)');
const g9 = B.find(g => g.gid === '9'); ok(g9 && g9.price.line === 6.5 && g9.models.shotsGoalie && g9.scoutHas && g9.scoutHas[0] === 'Over 6.5', 'board: hockey line, shots + goalie, what Scout already holds');

// honesty checks
const bet = { id: 'a', at: '2026-11-07T11:00:00Z', sport: 'soccer', date: '2026-11-07', league: 'eng.1', gid: '1', kickoff: '2026-11-07T15:00:00Z', home: 'Arsenal', away: 'Chelsea', key: 'O', price: -115, stake: 1, lead: 'shots', why: 'Shots read 6 points over the price; lineups full strength.', outsideCheck: 'confirmed' };
ok(problem(bet) === null, 'a good bet passes');
ok(problem({ ...bet, at: '2026-11-07T14:50:00Z' }) === 'late', 'logged inside 20 minutes = late');
ok(/stake/.test(problem({ ...bet, stake: STAKE.max + 1 })), 'stake held to the limit');
ok(/market/.test(problem({ ...bet, key: 'X' })), 'only markets the Hub grades');
ok(/line/.test(problem({ ...bet, sport: 'nhl', key: 'O', league: 'nhl' })), 'a hockey total needs its line');
ok(/American/.test(problem({ ...bet, price: 1.9 })), 'decimal odds refused');
ok(validLog({ v: 1, bets: [bet, bet], runs: [] }).some(e => /duplicate/.test(e)), 'duplicate ids refused');

// grading
const bets = [bet, { ...bet, id: 'b', key: 'H', price: -120, stake: 2, lead: 'v4' }, { ...bet, id: 'c', at: '2026-11-07T14:55:00Z' },
  { ...bet, id: 'd', sport: 'nhl', league: 'nhl', gid: '9', key: 'O', line: 6.5, price: 105, kickoff: '2026-11-08T00:00:00Z', lead: 'shotsGoalie' }];
ok(daysToRead(bets).join() === 'day:2026-11-07,nhl:day:2026-11-07', 'grading reads only the days with open bets');
const fin = { ...soc, final: { h: 2, a: 1 }, odds: { ...soc.odds, to: -125, tu: 105, h: -130 } }, hkf = { ...hk, final: { h: 4, a: 3 } };
const cards = cardsFrom(['day:2026-11-07', 'nhl:day:2026-11-07'], [{ cards: [fin] }, { cards: [hkf] }]);
const G = grade(bets, cards, new Date('2026-11-08T06:00:00Z')), by = Object.fromEntries(G.map(b => [b.id, b]));
ok(by.a.res === 'win' && by.a.status === 'settled' && Math.abs(by.a.units - 0.87) < 0.01 && by.a.clv > 0, 'Over wins, beat the close (-115 v -125)');
ok(by.b.res === 'win' && Math.abs(by.b.units - 2 * 100 / 120) < 0.01, 'stake 2 pays double');
ok(by.c.status === 'late' && by.c.units === 0, 'late bet does not count');
ok(by.d.res === 'win' && by.d.status === 'settled', 'hockey total 7 over 6.5 wins');
const R = record(G);
ok(R.all.settled === 3 && R.all.staked === 4 && R.lead.v4 && R.lead.v4.settled === 1 && R.sport.nhl.settled === 1 && R.market.ou.settled === 1, 'record: all, by lead, sport, market (late left out)');
const open = grade([bet], new Map(), new Date('2026-11-07T13:00:00Z'));
ok(open[0].status === 'open' && open[0].res == null, 'no result yet: open');
const kept = grade([{ ...bet, res: 'loss', units: -1, clv: -2 }], new Map(), now);
ok(kept[0].status === 'settled' && kept[0].units === -1, 'a result copied back into the log stands');

// routes: the board with the read-only token, the panel signed in, and nothing without either
const kv = new Map([['day:2026-11-07', JSON.stringify({ cards: [soc] })]]);
const env = { ADMIN_TOKEN: 'secret', HEALTH_TOKEN: 'tok', HUB: { get: async (k, t) => { const v = kv.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, put: async () => { throw new Error('Scout must not write'); }, list: async () => ({ keys: [], list_complete: true }) },
  ASSETS: { fetch: async req => new URL(req.url).pathname === '/scout.json' ? new Response(JSON.stringify({ v: 1, bets: [bet], runs: [{ at: '2026-11-07T11:00:00Z', note: 'test' }] })) : new Response('nf', { status: 404 }) } };
const r0 = await worker.fetch(new Request('https://x.test/api/scout/board'), env); ok(r0.status === 401, 'board without the token is refused');
const r1 = await worker.fetch(new Request('https://x.test/api/scout/board?k=tok'), env); ok(r1.status === 200, 'board with the token: ' + r1.status);
if (r1.status === 200) { const j = await r1.json(); ok(Array.isArray(j.games) && j.record && Array.isArray(j.open) && Array.isArray(j.copyBack) && Array.isArray(j.logProblems), 'board shape'); }
const r2 = await worker.fetch(new Request('https://x.test/api/scout?k=tok'), env); ok(r2.status === 401, 'the panel is not open to the token');
console.log(bad ? `${bad} failed` : 'scout ok'); process.exit(bad ? 1 : 0);
