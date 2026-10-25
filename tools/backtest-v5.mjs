// Walk-forward check of v5 against v4 on the games in src/v4seed.js: refit v4 every 7 days on everything before that week,
// run v5's Elo on the same games, predict that week's games, score both on the last ~11 months of each league (3,800 games).
// The constants in src/v5core.js were fitted on this history, so this run is in-sample for those few numbers: the honest
// out-of-sample gain (fit on one half of the window, scored on the other) was 0.0018 log loss a game. Run: node tools/backtest-v5.mjs
import seed from '../src/v4seed.js';
import { V4, fit, grid } from '../src/v4core.js';
import { eloRun, predict5 } from '../src/v5core.js';
const DAY = 86400000;
const tot = { n: 0, v4: { ll: 0, rps: 0, hit: 0 }, v5: { ll: 0, rps: 0, hit: 0 } }, diffs = [];
const score = (t, p, o) => { t.ll -= Math.log(Math.max(1e-9, p[o])); t.rps += ((p[0] - (o === 0)) ** 2 + (p[0] + p[1] - (o <= 1)) ** 2) / 2; t.hit += p.indexOf(Math.max(...p)) === o ? 1 : 0; return -Math.log(Math.max(1e-9, p[o])); };
for (const slug of Object.keys(seed)) {
  const s = seed[slug], G = s.g.map(([d, h, a, hg, ag]) => ({ d, h: s.teams[h], a: s.teams[a], hg, ag })).sort((x, y) => x.d - y.d);
  const first = G[0].d, last = G[G.length - 1].d, startTest = Math.max(first + 420, last - 330);
  let warm = null;
  for (let wk = startTest; wk <= last; wk += 7) {
    const test = G.filter(g => g.d >= wk && g.d < wk + 7); if (!test.length) continue;
    const train = G.filter(g => g.d < wk), R = fit(slug, train, wk * DAY, warm), E = eloRun(train);
    warm = Object.fromEntries(Object.entries(R.t).map(([k, v]) => [k, [v[0], v[1]]]));
    for (const g of test) {
      const th = R.t[g.h], ta = R.t[g.a]; if (!th || !ta || th[2] < V4.MIN_GAMES || ta[2] < V4.MIN_GAMES) continue;
      const lh = R.muH * th[0] * ta[1], la = R.muA * ta[0] * th[1], q = grid(lh, la, false);
      const p4 = { home: q.home, draw: q.draw, away: q.away, over25: q.over25, bttsYes: q.bttsYes, bttsNo: 1 - q.bttsYes, lambda: { home: lh, away: la }, topScores: [] };
      const p5 = predict5(p4, E, g.h, g.a); if (!p5) continue;
      const o = g.hg > g.ag ? 0 : g.hg === g.ag ? 1 : 2; tot.n++;
      diffs.push(score(tot.v4, [p4.home, p4.draw, p4.away], o) - score(tot.v5, [p5.home, p5.draw, p5.away], o));
    }
  }
}
const n = tot.n, m = diffs.reduce((a, b) => a + b, 0) / n, sd = Math.sqrt(diffs.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1));
const f = t => ({ logloss: +(t.ll / n).toFixed(4), rps: +(t.rps / n).toFixed(4), hit: +(t.hit / n).toFixed(3) });
console.log(JSON.stringify({ games: n, v4: f(tot.v4), v5: f(tot.v5), v5GainPerGame: +m.toFixed(5), z: +(m / (sd / Math.sqrt(n))).toFixed(2) }));
