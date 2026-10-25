// Refit v5's constants (src/v5core.js V5.ORD, V5.POOL, V5.OVER) on the bundled history, and check them honestly first.
//   1. Walk-forward records: every game after a 240-day burn-in, with v4's prediction from ratings fitted on games before that week and
//      the Elo gap from the same games (exactly what tools/backtest-v5.mjs scores).
//   2. Honest check: fit on the tuning stretch + one half of the test window, score the other half, and the reverse.
//   3. Final constants: fit on every record. Paste the printed numbers into V5 in src/v5core.js.
// Slow on purpose (a plain Nelder-Mead over ~6,000 games): a few minutes. Run: node tools/fit-v5.mjs
import seed from '../src/v4seed.js';
import { V4, fit, grid } from '../src/v4core.js';
import { eloRun } from '../src/v5core.js';
const DAY = 86400000, sg = x => 1 / (1 + Math.exp(-x)), lg = p => Math.log(p / (1 - p));
const recs = [];
for (const slug of Object.keys(seed)) {
  const s = seed[slug], G = s.g.map(([d, h, a, hg, ag]) => ({ d, h: s.teams[h], a: s.teams[a], hg, ag })).sort((x, y) => x.d - y.d);
  const first = G[0].d, last = G[G.length - 1].d, startTest = Math.max(first + 420, last - 330);
  let warm = null;
  for (let wk = first + 240; wk <= last; wk += 7) {
    const test = G.filter(g => g.d >= wk && g.d < wk + 7); if (!test.length) continue;
    const train = G.filter(g => g.d < wk), R = fit(slug, train, wk * DAY, warm), E = eloRun(train);
    warm = Object.fromEntries(Object.entries(R.t).map(([k, v]) => [k, [v[0], v[1]]]));
    for (const g of test) {
      const th = R.t[g.h], ta = R.t[g.a]; if (!th || !ta || th[2] < V4.MIN_GAMES || ta[2] < V4.MIN_GAMES || E.t[g.h] == null || E.t[g.a] == null) continue;
      const lh = R.muH * th[0] * ta[1], la = R.muA * ta[0] * th[1], q = grid(lh, la, false);
      const ov = sg(lg(R.base[0]) + V4.CAL_SLOPE * (lg(q.over25) - lg(R.mean[0])));
      recs.push({ d: g.d, test: g.d >= startTest, v4: [q.home, q.draw, q.away], v4o: ov, lam: [lh, la], x: (E.t[g.h] - E.t[g.a] + E.hfa) / 100, o: g.hg > g.ag ? 0 : g.hg === g.ag ? 1 : 2, over: g.hg + g.ag >= 3 });
    }
  }
}
function nm(f, x0, { iters = 800, step = 0.2 } = {}) { // Nelder-Mead
  const n = x0.length; let S = [x0.slice()]; for (let i = 0; i < n; i++) { const x = x0.slice(); x[i] += step; S.push(x); } let F = S.map(f);
  for (let it = 0; it < iters; it++) {
    const ix = F.map((v, i) => i).sort((a, b) => F[a] - F[b]); S = ix.map(i => S[i]); F = ix.map(i => F[i]);
    const c = Array(n).fill(0); for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += S[i][j] / n;
    const at = t => c.map((v, j) => v + t * (v - S[n][j])), xr = at(1), fr = f(xr);
    if (fr < F[0]) { const xe = at(2), fe = f(xe); [S[n], F[n]] = fe < fr ? [xe, fe] : [xr, fr]; }
    else if (fr < F[n - 1]) { S[n] = xr; F[n] = fr; }
    else { const xc = at(-0.5), fc = f(xc); if (fc < F[n]) { S[n] = xc; F[n] = fc; } else for (let i = 1; i <= n; i++) { S[i] = S[i].map((v, j) => S[0][j] + 0.5 * (v - S[0][j])); F[i] = f(S[i]); } }
  }
  return S[0];
}
const ord = (x, [a1, a2, b]) => { const ph = sg(a1 + b * x), phd = sg(a2 + b * x); return [ph, Math.max(1e-6, phd - ph), Math.max(1e-6, 1 - phd)]; };
const pool = (r, O, [w4, we, d0, dt, dv]) => { const e = ord(r.x, O), dx = d0 + dt * (Math.log(r.lam[0] + r.lam[1]) - Math.log(2.7)) - dv * Math.abs(Math.log(r.lam[0] / r.lam[1]));
  const q = r.v4.map((v, i) => Math.exp(w4 * Math.log(v) + we * Math.log(e[i]) + (i === 1 ? dx : 0))), s = q[0] + q[1] + q[2]; return q.map(v => v / s); };
const ll1 = (rs, f) => rs.reduce((s, r) => s - Math.log(Math.max(1e-9, f(r)[r.o])), 0) / rs.length;
const fitAll = rs => { const O = nm(x => ll1(rs, r => ord(r.x, x)), [0, 1, 0.5]); return { O, P: nm(x => ll1(rs, r => pool(r, O, x)), [0.6, 0.4, 0, 0, 0], { iters: 1200 }) }; };
const test = recs.filter(r => r.test).sort((a, b) => a.d - b.d), h = test.length >> 1, A = test.slice(0, h), B = test.slice(h), tune = recs.filter(r => !r.test);
const fa = fitAll([...tune, ...A]), fb = fitAll([...tune, ...B]);
const per = [...B.map(r => [r, fa]), ...A.map(r => [r, fb])].map(([r, F]) => -Math.log(Math.max(1e-9, r.v4[r.o])) + Math.log(Math.max(1e-9, pool(r, F.O, F.P)[r.o])));
const m = per.reduce((a, b) => a + b, 0) / per.length, sd = Math.sqrt(per.reduce((a, b) => a + (b - m) ** 2, 0) / (per.length - 1));
console.log(`honest check on ${per.length} test games: v5 log loss ${m.toFixed(5)} a game better than v4 (z = ${(m / (sd / Math.sqrt(per.length))).toFixed(2)})`);
const F = fitAll(recs), OV = nm(([a, b]) => recs.reduce((s, r) => { const p = Math.min(1 - 1e-6, Math.max(1e-6, sg(a + b * lg(r.v4o)))); return s - (r.over ? Math.log(p) : Math.log(1 - p)); }, 0) / recs.length, [0, 1]);
const r4 = a => a.map(v => +v.toFixed(4));
console.log(`final constants (${recs.length} games):\n  ORD: [${r4(F.O).join(', ')}],\n  POOL: [${r4(F.P).join(', ')}],\n  OVER: [${r4(OV).join(', ')}],`);
