// v5 checks: the Elo, the blend with v4, the ratings it is stored with, and that it still beats v4 on the bundled history.
import { execFileSync } from 'child_process';
import { V5, eloRun, predict5 } from '../src/v5core.js';
import { getRatings, predict, resolve } from '../src/v4.js';
let fails = 0; const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n} ${c ? '' : x}`); };
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;

// 1. Elo
{ const E = eloRun([{ d: 1, h: 'A', a: 'B', hg: 3, ag: 0 }]);
  ok('a home win moves the winner up and the loser down by the same amount', E.t.A > 1500 && near(E.t.A - 1500, 1500 - E.t.B, 1e-6), JSON.stringify(E));
  const big = eloRun([{ d: 1, h: 'A', a: 'B', hg: 5, ag: 0 }]), one = eloRun([{ d: 1, h: 'A', a: 'B', hg: 1, ag: 0 }]);
  ok('a bigger win moves the ratings more', big.t.A > one.t.A);
  const gap = eloRun([{ d: 1, h: 'A', a: 'B', hg: 3, ag: 0 }, { d: 100, h: 'C', a: 'D', hg: 0, ag: 0 }]), nogap = eloRun([{ d: 1, h: 'A', a: 'B', hg: 3, ag: 0 }, { d: 5, h: 'C', a: 'D', hg: 0, ag: 0 }]);
  ok('after a break between seasons ratings move part of the way back to the average', gap.t.A < nogap.t.A && gap.t.A > 1500); }

// 2. the blend, against the formula it was fitted with
{ const p4 = { home: 0.5, draw: 0.26, away: 0.24, over25: 0.55, bttsYes: 0.52, bttsNo: 0.48, lambda: { home: 1.6, away: 1.1 }, topScores: [] };
  const E = { t: { A: 1560, B: 1500 }, hfa: 55 }, p = predict5(p4, E, 'A', 'B');
  const sg = x => 1 / (1 + Math.exp(-x)), x = (60 + 55) / 100, [a1, a2, b] = V5.ORD, e = [sg(a1 + b * x), sg(a2 + b * x) - sg(a1 + b * x), 1 - sg(a2 + b * x)];
  const [w4, we, d0, dt, dv] = V5.POOL, dx = d0 + dt * (Math.log(2.7) - Math.log(2.7)) - dv * Math.abs(Math.log(1.6 / 1.1));
  const q = [0.5, 0.26, 0.24].map((v, i) => Math.exp(w4 * Math.log(v) + we * Math.log(e[i]) + (i === 1 ? dx : 0))), s = q[0] + q[1] + q[2];
  ok('home / draw / away match the fitted formula and add up to 1', near(p.home, q[0] / s) && near(p.draw, q[1] / s) && near(p.home + p.draw + p.away, 1), JSON.stringify(p));
  const ov = o => predict5({ ...p4, over25: o }, E, 'A', 'B').over25;
  ok('Over 2.5 is v4\'s re-scaled: flatter (75% comes down, 40% goes up) and in the same order; both-score is v4\'s', ov(0.75) < 0.75 && ov(0.4) > 0.4 && ov(0.6) > ov(0.5) && p.bttsYes === 0.52);
  ok('no Elo for a club: no v5', predict5(p4, E, 'A', 'Nobody') === null && predict5(p4, null, 'A', 'B') === null); }

// 3. the stored ratings carry the Elo (the bundled history until the cron rebuilds), and a real fixture gets a v5
{ const kv = new Map(), env = { HUB: { get: async k => kv.get(k) ?? null, put: async (k, v) => kv.set(k, v) } };
  const R = await getRatings({ slug: 'eng.1' }, env), h = resolve('eng.1', 'Arsenal'), a = resolve('eng.1', 'Chelsea');
  ok('ratings from the bundled history carry v5\'s Elo', R.elo && R.elo.n > 500 && R.elo.t[h] != null);
  const p4 = predict(R, h, a), p5 = predict5(p4, R.elo, h, a);
  ok('Arsenal v Chelsea: v5 gives a prediction close to v4\'s', p5 && near(p5.home + p5.draw + p5.away, 1, 1e-9) && Math.abs(p5.home - p4.home) < 0.15, JSON.stringify([p4.home, p5 && p5.home])); }

// 4. still better than v4 on the bundled history (guards against a constant being changed by mistake)
{ const r = JSON.parse(execFileSync(process.execPath, [new URL('../tools/backtest-v5.mjs', import.meta.url).pathname]).toString());
  ok(`walk-forward on ${r.games} games: v5 log loss ${r.v5.logloss} below v4's ${r.v4.logloss}`, r.games > 3000 && r.v5.logloss < r.v4.logloss && r.v5.rps <= r.v4.rps, JSON.stringify(r)); }
console.log(fails ? `\n${fails} FAILED` : '\nAll v5 checks passed'); process.exit(fails ? 1 : 0);
