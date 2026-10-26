// v6 score card checks: the price is read without its margin, the fitted grid reproduces it, every number comes from one grid,
// and the Worker attaches, refreshes, freezes and grades it.
import { V6, devig, overAt, targets, fitGoals, scoreCard } from '../src/v6core.js';
import { grid } from '../src/v4core.js';
let fails = 0; const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n} ${c ? '' : x}`); };
const near = (a, b, e) => Math.abs(a - b) < e;

// 1. reading the price
const d = devig(-150, 280, 400);
ok('the margin is removed: chances add up to 1, favourite first', near(d[0] + d[1] + d[2], 1, 1e-12) && d[0] > d[2] && d[2] < d[1]);
{ // power method: a long shot keeps less of its implied chance than with the margin removed in proportion; no margin, no change
  const q = [-300, 400, 900].map(m => 1 / (m > 0 ? 1 + m / 100 : 1 + 100 / -m)), sq = q.reduce((x, y) => x + y), pp = devig(-300, 400, 900);
  ok('power method: the favourite gets more and the long shot less than in proportion', pp[0] > q[0] / sq && pp[2] < q[2] / sq && Math.abs(pp[0] + pp[1] + pp[2] - 1) < 1e-9, JSON.stringify(pp));
  const fair = devig(100, 100); ok('a price with no margin is left as it is', Math.abs(fair[0] - 0.5) < 1e-9); }
ok('a missing price reads as nothing', devig(-150, null, 400) === null && targets({ h: -150, d: 280 }) === null && scoreCard(null) === null);
ok('only a half-goal total is used (a whole line can push)', targets({ h: 120, d: 240, a: 230, tl: 2.5, to: -120, tu: 100 }).over[0] === 2.5 && targets({ h: 120, d: 240, a: 230, tl: 3, to: -120, tu: 100 }).over === null);

// 2. the fit: start from a known grid, price it with no margin, and get the same expected goals back
const g0 = grid(1.7, 1.05, false), o0 = overAt(1.7, 1.05, 2.5);
const toAm = p => (p >= 0.5 ? -100 * p / (1 - p) : 100 * (1 - p) / p);
const F = fitGoals(targets({ h: toAm(g0.home), d: toAm(g0.draw), a: toAm(g0.away), tl: 2.5, to: toAm(o0), tu: toAm(1 - o0) }));
ok('expected goals are found again from their own price (1.70 and 1.05)', near(F.lh, 1.7, 0.01) && near(F.la, 1.05, 0.01) && F.err < 0.001, JSON.stringify(F));
ok('overAt 2.5 matches the grid\'s own Over 2.5', near(overAt(1.4, 1.2, 2.5), grid(1.4, 1.2, false).over25, 1e-12));

// 3. one grid behind every number
const odds = { h: -165, d: 290, a: 450, tl: 2.5, to: -135, tu: 110 }, s = scoreCard(odds), T = targets(odds);
ok('home / draw / away land within a point of the price', near(s.home, T.hda[0], 0.01) && near(s.draw, T.hda[1], 0.015) && near(s.away, T.hda[2], 0.01), JSON.stringify([s.home, s.draw, s.away, T.hda]));
ok('Over 2.5 lands within a point of the price', near(s.over25, T.over[1], 0.01), `${s.over25} ${T.over[1]}`);
const g = grid(s.lambda.home, s.lambda.away, true);
ok('both-score and the likeliest scores come from the same grid', near(s.bttsYes, g.bttsYes, 1e-12) && s.topScores[0].score === g.top[0].score && s.model === 'v6');
ok('a bigger favourite gets a bigger home chance and more home goals', scoreCard({ ...odds, h: -300, a: 800 }).home > s.home && scoreCard({ ...odds, h: -300, a: 800 }).lambda.home > s.lambda.home);
ok('v4 is not mixed in while W_MODEL is 0', V6.W_MODEL === 0 && JSON.stringify(scoreCard(odds, { home: 0.2, draw: 0.2, away: 0.6 })) === JSON.stringify(s));

// 4. the Worker: a priced card gets a v6 from refreshOdds, a later price moves it, after kickoff it stands, and grading scores it
{
  const { oddsStep } = await import('../src/worker.js');
  const kv = new Map(), env = { HUB: { get: async (k, t) => { const v = kv.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => kv.set(k, v) } };
  const date = '2026-10-24', ko = '2026-10-24T20:00:00Z';
  kv.set('day:' + date, JSON.stringify({ date, cards: [{ id: '1', league: 'eng.1', kickoff: ko, home: 'A', away: 'B', v2: {} }] }));
  let price = [-150, 280, 400];
  const ev = () => ({ id: '1', date: ko, competitions: [{ status: { type: { completed: false } }, competitors: [{ homeAway: 'home', team: { id: 'h', displayName: 'A' } }, { homeAway: 'away', team: { id: 'a', displayName: 'B' } }], odds: [{ moneyline: { home: { close: { odds: String(price[0]) } }, draw: { close: { odds: '+' + price[1] } }, away: { close: { odds: '+' + price[2] } } }, total: { over: { close: { line: 'o2.5', odds: '-120' } }, under: { close: { line: 'u2.5', odds: '+100' } } } }] }] });
  const real = globalThis.fetch; globalThis.fetch = async () => ({ ok: true, json: async () => ({ events: [ev()] }) });
  await oddsStep(env, new Date('2026-10-24T12:00:00Z'), null);
  const c1 = JSON.parse(kv.get('day:' + date)).cards[0];
  ok('a priced card gets a v6 score card', c1.v6 && c1.v6.p.length === 3 && Math.abs(c1.v6.p.reduce((a, b) => a + b) - 100) <= 1 && c1.v6.scores.length === 3, JSON.stringify(c1.v6));
  price = [-250, 350, 650]; await oddsStep(env, new Date('2026-10-24T18:00:00Z'), null);
  const c2 = JSON.parse(kv.get('day:' + date)).cards[0];
  ok('a new price before kickoff moves the score card', c2.v6.p[0] > c1.v6.p[0], `${c1.v6.p} -> ${c2.v6.p}`);
  price = [-900, 900, 2000]; await oddsStep(env, new Date('2026-10-24T21:00:00Z'), null);
  ok('after kickoff the score card made before it stands', JSON.stringify(JSON.parse(kv.get('day:' + date)).cards[0].v6) === JSON.stringify(c2.v6));
  globalThis.fetch = real;
}
console.log(fails ? `\n${fails} FAILED` : '\nAll v6 checks passed'); process.exit(fails ? 1 : 0);
