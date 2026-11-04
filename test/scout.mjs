// Scout (src/scout.js): the board it reads, the honesty checks on its log, grading on read, and public/scout.json itself.
import { board, problem, validLog, grade, record, daysToRead, cardsFrom, STAKE } from '../src/scout.js';
import worker from '../src/worker.js';
let bad = 0; const ok = (c, m) => { if (!c) { bad++; console.log('FAIL', m); } };


const now = new Date('2026-11-07T12:00:00Z');
const soc = { id: '1', league: 'eng.1', leagueName: 'Premier League', kickoff: '2026-11-07T15:00:00Z', home: 'Arsenal', away: 'Chelsea', final: null,
  v2: { p: [50, 25, 25], over: 55, btts: 52 }, v4: { p: [55, 24, 21], over: 58, btts: 54, lam: [1.6, 1.1], scores: [['1-0', 11], ['2-1', 9], ['1-1', 9], ['2-0', 8]] },
  sx: { sot: 11.5, gl: 3.6, sh: 23, n: 8 }, odds: { h: -120, d: 260, a: 320, tl: 2.5, to: -115, tu: -105, by: -110, bn: -110, op: { h: -110, d: 250, a: 300 } } };
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
const kv = new Map([['day:2026-11-07', JSON.stringify({ cards: [soc] })], ['scout', JSON.stringify({ v: 1, bets: [bet], runs: [{ at: '2026-11-07T11:00:00Z', note: 'test' }] })]]);
const env = { ADMIN_TOKEN: 'secret', HEALTH_TOKEN: 'tok', HUB: { get: async (k, t) => { const v = kv.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, put: async () => { throw new Error('Scout must not write'); }, list: async () => ({ keys: [], list_complete: true }) },
  ASSETS: { fetch: async () => new Response('nf', { status: 404 }) } };
const r0 = await worker.fetch(new Request('https://x.test/api/scout/board'), env); ok(r0.status === 401, 'board without the token is refused');
const r1 = await worker.fetch(new Request('https://x.test/api/scout/board?k=tok'), env); ok(r1.status === 200, 'board with the token: ' + r1.status);
if (r1.status === 200) { const j = await r1.json(); ok(Array.isArray(j.games) && j.record && j.record.all.bets === 1 && Array.isArray(j.open) && Array.isArray(j.copyBack) && Array.isArray(j.logProblems), 'board shape, log read from KV'); }
const r2 = await worker.fetch(new Request('https://x.test/api/scout?k=tok'), env); ok(r2.status === 401, 'the panel is not open to the token');

// ---- the run on Workers AI (src/scoutai.js), with a stand-in model ----
const { scoutStep, isRunTime, line, outsideFrom, makeBet, readsFor, candidates, evidence, candText, modelsOf } = await import('../src/scoutai.js');
ok(isRunTime(new Date('2026-11-04T11:43:00Z')) && isRunTime(new Date('2026-11-04T21:43:00Z')) && !isRunTime(new Date('2026-11-04T10:43:00Z')) && isRunTime(new Date('2026-07-04T10:43:00Z')), 'runs at 5:43 AM / 3:43 PM Central, standard or daylight time');
ok(/#0 Premier League \| Arsenal v Chelsea/.test(line(g1, 0)) && /shots read over/.test(line(g1, 0)) && /analyst bet/.test(line(g1, 0)), 'board line for the model: ' + line(g1, 0).slice(0, 80));
const ox = outsideFrom(g9, { injuries: [{ team: { abbreviation: 'TOR' }, injuries: [{ athlete: { displayName: 'A. Matthews', position: { abbreviation: 'C' } }, status: 'Out', details: { type: 'Knee', returnDate: '2026-11-20' } }] }],
  lastFiveGames: [{ team: { abbreviation: 'TOR' }, events: [{ gameResult: 'W', score: '4-2' }] }], news: { articles: [{ headline: 'Maple Leafs lose Matthews', links: { web: { href: 'https://espn.com/x' } } }, { headline: 'Unrelated story' }] } });
ok(ox.length === 3 && /Matthews \(C\) Out, Knee/.test(ox[0].note) && ox[2].url === 'https://espn.com/x', 'outside check: injuries, last five, news naming a club');
const mb = makeBet({ n: 0, key: 'O', stake: 9, conf: 7, lead: 'nonsense', why: 'x', outsideCheck: 'confirmed', used: [0, 99] }, g1, ox, now);
ok(mb && mb.price === g1.price.O && mb.stake === 3 && mb.conf === 5 && mb.lead === 'combo' && mb.outside.length === 1, 'the price comes from the board; stake, confidence and lead are held to their ranges');
ok(makeBet({ n: 0, key: 'X', stake: 1, why: 'x' }, g1, [], now) === null && makeBet({ n: 0, key: 'H', stake: 1, why: 'x' }, g9, [], now) && makeBet({ n: 0, key: 'D', stake: 1, why: 'x' }, g9, [], now) === null, 'only markets the game has');
ok(makeBet({ n: 0, key: 'O', stake: 1, why: 'x' }, { ...g1, scoutHas: ['Over'] }, [], now) === null, 'no second bet on a market Scout already holds');

// the edges, found in code
const rO = readsFor(g1, 'O'); ok(rO && Math.abs(rO.fair - g1.fair.ou[0]) < 0.01 && rO.models.find(m => m[0] === 'v4')[1] === 58 && rO.models.some(m => m[0] === 'shots'), 'readsFor: fair, models and the shots read on Over');
const rU = readsFor(g1, 'U'); ok(rU && rU.models.find(m => m[0] === 'v4')[1] === 42, 'Under = 100 - Over');
const rH = readsFor(g9, 'O'); ok(rH === null || rH.models.every(m => m[0] === 'shots+goalie'), 'hockey totals: the v-models only count when their line is the price line');
const C0 = candidates([g1, g9]); const cO = C0.find(c => c.gi === 0 && c.key === 'O');
ok(cO && C0.filter(c => c.gi === 0).length <= 2 && C0.some(c => c.gi === 1), 'candidates: Over first for the Arsenal game, at most 2 a game ' + JSON.stringify(C0.map(c => [c.gi, c.key, c.avg])));
ok(evidence(g1, cO).some(x => /\+6.5% out of sample/.test(x)), 'evidence: the tested shots read');
ok(evidence(g1, { key: 'A', price: 320, models: [], move: 0 }).some(x => /longer than \+150/.test(x)) && evidence(g1, { key: 'U', price: -105, models: [] }).some(x => /9.2%/.test(x)), 'evidence: long shots and Unders');
ok(evidence(g9, { key: 'H', price: -140, models: [['v2', 55]] }).some(x => /home teams/.test(x)), 'evidence: hockey home teams');
ok(/Candidate Over at -115: fair/.test(candText(g1, cO)), 'candidate text');
const store = new Map([['day:2026-11-07', JSON.stringify({ cards: [soc, hk] })], ['nhl:day:2026-11-07', JSON.stringify({ cards: [hk] })]]);
const calls = [];
let criticKeeps = true;
const AI = { run: async (model, inp) => { calls.push(inp); const sys = inp.messages[0].content;
  if (/^You are the critic/.test(sys)) return { response: { verdicts: [{ i: 0, keep: criticKeeps, reason: criticKeeps ? 'Edge is wide and backed by the tested shots read.' : 'Thin edge once the move is counted.' }] } };
  return { response: JSON.stringify({ bets: [{ n: 0, key: 'O', stake: 1.5, conf: 4, lead: 'shots', edge: 'v4 58 v 51 fair (+7)', agree: 'v4, v2, shots', against: 'none', move: 'flat', outsideSaid: 'Arsenal won 2-0 last time', risk: 'a cagey derby', why: 'Shots read 6 over the price.', outsideCheck: 'confirmed', used: [0] }, { n: 5, key: 'H', stake: 1, lead: 'v4', edge: 'x', agree: 'x', against: 'x', risk: 'x', why: 'not a game on the list', outsideCheck: 'none' }], note: 'Took the Over.' }) }; } };
const kv2 = { get: async (k, t) => { const v = store.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => { store.set(k, v); }, list: async () => ({ keys: [], list_complete: true }) };
const espn = async url => new Response(JSON.stringify({ lastFiveGames: [{ team: { abbreviation: 'ARS' }, events: [{ gameResult: 'W', score: '2-0' }] }] }));
const t0 = new Date('2026-11-07T11:43:00Z'); // 5:43 AM Central
const r = await scoutStep({ HUB: kv2, AI }, t0, espn);
const sd = JSON.parse(store.get('scout'));
ok(r.ok && r.took === 1 && sd.bets.length === 1 && sd.bets[0].key === 'O' && sd.bets[0].price === -115 && sd.bets[0].outside.length === 1 && sd.runs[0].note === 'Took the Over.', 'a run: edges, outside check, one bet at the board price ' + JSON.stringify(r));
const b0 = sd.bets[0];
ok(b0.thesis && b0.thesis.edge && b0.thesis.risk && b0.critic && /Edge is wide/.test(b0.critic), 'the bet keeps its thesis parts and the critic\'s reason');
ok(b0.models.DraftKings && /fair/.test(b0.models.DraftKings) && b0.models.v4 === `58% (+${Math.round(10 * (58 - b0.models.DraftKings.match(/[\d.]+/)[0])) / 10})` && /shots/.test(Object.keys(b0.models).join()), 'the models on the bet come from the numbers, not the model\'s words: ' + JSON.stringify(b0.models));
ok(calls.length === 2 && /Candidate Over at -115/.test(calls[0].messages[1].content) && /Hub evidence: Shots read 3\+/.test(calls[0].messages[1].content) && /ESPN last five/.test(calls[0].messages[1].content) && /^You are the critic/.test(calls[1].messages[0].content), 'one call for the bets (with edges, evidence and ESPN), one for the critic');
// the critic can drop a bet
{ criticKeeps = false; const st2 = new Map([...store].filter(([k]) => k !== 'scout')); const kv3 = { ...kv2, get: async (k, t) => { const v = st2.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => { st2.set(k, v); } };
  const r3 = await scoutStep({ HUB: kv3, AI }, t0, espn); const d3 = JSON.parse(st2.get('scout'));
  ok(r3.took === 0 && d3.bets.length === 0 && /critic dropped: Over Arsenal v Chelsea \(Thin edge/.test(d3.runs[0].note), 'a bet the critic rejects is not taken, and the run says why: ' + d3.runs[0].note); criticKeeps = true; }
const n0 = calls.length, again = await scoutStep({ HUB: kv2, AI }, new Date('2026-11-07T11:50:00Z'), espn);
ok(again.skipped && calls.length === n0, 'no second run within 3 hours');
ok((await scoutStep({ HUB: kv2, AI }, new Date('2026-11-07T13:43:00Z'), espn)).skipped === 'not a run time', 'other hours: nothing');
const bad2 = await scoutStep({ HUB: kv2, AI: { run: async () => { throw new Error('out of neurons'); } } }, new Date('2026-11-07T21:43:00Z'), espn);
ok(bad2.error && JSON.parse(store.get('scout')).runs[0].error, 'a failed run is noted, never thrown');
ok((await scoutStep({ HUB: kv2 }, t0, espn)).error, 'no AI binding: an error, nothing run');
// the cron hands Scout's run to its own invocation only
let ran = 0; const ctx = { waitUntil: p => p };
await worker.scheduled({ cron: '43 10,11,20,21 * * *' }, { HUB: kv2, AI: { run: async () => { ran++; return { response: { shortlist: [] } }; } } }, ctx);
ok(true, 'scheduled with Scout\'s cron does not throw');
console.log(bad ? `${bad} failed` : 'scout ok'); process.exit(bad ? 1 : 0);
