// Backtest: starting ratings for newly promoted clubs. v4 stays silent for a club with fewer than MIN_GAMES games in its
// league's ratings. Here a promoted club starts from a prior built from its second-division rating (or a flat weak prior,
// or "average club"), and the prior fades as its own games come in. Walk-forward, no market odds. Run: node tools/backtest-promoted.mjs
import seed from '../src/v4seed.js';
import { V4, norm } from '../src/v4core.js';
import { grid } from '../src/v4core.js';
const DAY = 864e5, d = x => Math.floor(Date.parse(x) / DAY);
const lgt = p => { const q = Math.min(1 - 1e-6, Math.max(1e-6, p)); return Math.log(q / (1 - q)); }, sg = x => 1 / (1 + Math.exp(-x));
const ALIAS = { 'real oviedo': 'oviedo', 'santander': 'racing santander', 'la coruna': 'deportivo', 'koln': 'cologne' };
const key = n => { let k = norm(n); k = ALIAS[k] || k; return k; };
const same = (a, b) => { a = key(a); b = key(b); return a === b || a.startsWith(b + ' ') || b.startsWith(a + ' '); };
const PAIRS = [['eng.1', 'eng.2'], ['esp.1', 'esp.2'], ['ger.1', 'ger.2']];
const games = slug => seed[slug].g.map(([dd, h, a, hg, ag]) => ({ d: dd, h: seed[slug].teams[h], a: seed[slug].teams[a], hg, ag })).sort((x, y) => x.d - y.d);

// the v4 fit with an optional prior: prior[name] = [attack, defence] the club is pulled toward instead of 1
function fit(slug, gamesAll, nowDay, prior = {}, Kp = null) {
  const { H, K } = V4.PARAMS[slug] || { H: 240, K: 8 };
  const gs = gamesAll.filter(g => g.d < nowDay && nowDay - g.d <= V4.MAX_AGE);
  const names = [], idx = new Map(), id = n => { if (!idx.has(n)) { idx.set(n, names.length); names.push(n); } return idx.get(n); };
  gs.forEach(g => { id(g.h); id(g.a); });
  for (const n of Object.keys(prior)) id(n);
  const N = names.length, pA = new Float64Array(N).fill(1), pD = new Float64Array(N).fill(1), kk = new Float64Array(N).fill(K);
  names.forEach((nm, t) => { if (prior[nm]) { pA[t] = prior[nm][0]; pD[t] = prior[nm][1]; kk[t] = Kp ?? K; } });
  let W = 0, sh = 0, sa = 0; const w = gs.map(g => { const x = Math.pow(.5, (nowDay - g.d) / H); W += x; sh += x * g.hg; sa += x * g.ag; return x; });
  const muH = sh / W, muA = sa / W, A = new Float64Array(N).fill(1), D = new Float64Array(N).fill(1);
  const hi = gs.map(g => idx.get(g.h)), ai = gs.map(g => idx.get(g.a));
  for (let it = 0; it < V4.ITER; it++) {
    const sA = new Float64Array(N), eA = new Float64Array(N), sD = new Float64Array(N), eD = new Float64Array(N);
    for (let i = 0; i < gs.length; i++) { const h = hi[i], a = ai[i], wi = w[i];
      sA[h] += wi * gs[i].hg; eA[h] += wi * muH * D[a]; sA[a] += wi * gs[i].ag; eA[a] += wi * muA * D[h];
      sD[a] += wi * gs[i].hg; eD[a] += wi * muH * A[h]; sD[h] += wi * gs[i].ag; eD[h] += wi * muA * A[a]; }
    let ma = 0, md = 0;
    for (let t = 0; t < N; t++) { A[t] = (sA[t] + kk[t] * pA[t]) / (eA[t] + kk[t]); D[t] = (sD[t] + kk[t] * pD[t]) / (eD[t] + kk[t]); ma += A[t]; md += D[t]; }
    ma /= N; md /= N; for (let t = 0; t < N; t++) { A[t] /= ma; D[t] /= md; }
  }
  const cnt = new Int32Array(N); gs.forEach((g, i) => { cnt[hi[i]]++; cnt[ai[i]]++; });
  const R = { muH, muA, t: {} }; names.forEach((nm, t) => { R.t[nm] = [A[t], D[t], cnt[t]]; });
  const ly = gs.filter(g => nowDay - g.d <= 365); const rate = f => ly.length ? ly.filter(f).length / ly.length : .5;
  R.base = [rate(g => g.hg + g.ag >= 3), rate(g => g.hg > 0 && g.ag > 0)];
  const rec = gs.slice(-V4.CAL_RECENT); let mo = 0, mb = 0;
  for (const g of rec) { const th = R.t[g.h], ta = R.t[g.a], p = grid(R.muH * th[0] * ta[1], R.muA * ta[0] * th[1], false); mo += p.over25; mb += p.bttsYes; }
  R.mean = rec.length ? [mo / rec.length, mb / rec.length] : [.5, .5]; return R;
}
function pred(R, h, a, flat) {
  const th = R.t[h], ta = R.t[a]; if (!th || !ta) return null;
  const lh = R.muH * th[0] * ta[1], la = R.muA * ta[0] * th[1], p = flat ? grid(R.muH, R.muA, false) : grid(lh, la, false);
  const pull = (raw, base, mean) => sg(lgt(base) + V4.CAL_SLOPE * (lgt(raw) - lgt(mean)));
  return { pr: [p.home, p.draw, p.away], po: pull(p.over25, R.base[0], R.mean[0]), pb: pull(p.bttsYes, R.base[1], R.mean[1]) };
}
const ratingAt = (slug, day, nm, G) => { const R = fit(slug, G, day); const k = Object.keys(R.t).find(x => same(x, nm)); return k ? R.t[k] : null; };

const data = {};
for (const [L, L2] of PAIRS) data[L] = { G: games(L), G2: games(L2), L2 };
const clubsIn = (G, a, b) => { const s = new Set(); for (const g of G) if (g.d >= d(a) && g.d < d(b)) { s.add(g.h); s.add(g.a); } return [...s]; };
const has = (arr, t) => arr.find(x => same(x, t));
// cohorts: promoted clubs for each summer
const cohort = (L, y) => { const { G, G2 } = data[L], prev = clubsIn(G, `${y - 1}-07-01`, `${y}-07-01`), cur = clubsIn(G, `${y}-07-01`, `${y + 1}-07-01`);
  return cur.filter(t => !has(prev, t) && has(clubsIn(G2, `${y - 1}-07-01`, `${y}-07-01`), t)).map(t => ({ name: t, l2: has(clubsIn(G2, `${y - 1}-07-01`, `${y}-07-01`), t) })); };

// 1) how strong were the 2025 promoted clubs in their first top-flight season, against their second-division rating?
const pairs = [];
for (const [L] of PAIRS) {
  const { G, G2 } = data[L];
  for (const c of cohort(L, 2025)) {
    const r2 = ratingAt(L.replace('.1', '.2'), d('2025-06-30'), c.l2, G2), rl = ratingAt(L, d('2026-06-30'), c.name, G);
    if (r2 && rl) pairs.push({ L, name: c.name, a2: r2[0], d2: r2[1], aL: rl[0], dL: rl[1], nL: rl[2] });
  }
}
console.log('2025 promoted clubs: second-division rating -> first-season top-flight rating (1.00 = league average)');
for (const p of pairs) console.log(`  ${p.L} ${p.name.padEnd(16)} L2 att ${p.a2.toFixed(2)} def ${p.d2.toFixed(2)}  ->  top flight att ${p.aL.toFixed(2)} def ${p.dL.toFixed(2)}  (${p.nL} games)`);
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const cA0 = Math.exp(mean(pairs.map(p => Math.log(p.aL)))), cD0 = Math.exp(mean(pairs.map(p => Math.log(p.dL))));
console.log(`flat promoted prior (no second-division info): att ${cA0.toFixed(3)} def ${cD0.toFixed(3)}`);
const ols = (x, y) => { const mx = mean(x), my = mean(y); let sxy = 0, sxx = 0; x.forEach((v, i) => { sxy += (v - mx) * (y[i] - my); sxx += (v - mx) ** 2; }); const b = sxy / sxx; return { b, c: my - b * mx }; };
const fa = ols(pairs.map(p => Math.log(p.a2)), pairs.map(p => Math.log(p.aL))), fd = ols(pairs.map(p => Math.log(p.d2)), pairs.map(p => Math.log(p.dL)));
console.log(`regression slope: attack ${fa.b.toFixed(2)}, defence ${fd.b.toFixed(2)} (n=${pairs.length})`);

// 2) walk-forward on games the current v4 cannot predict (a club under MIN_GAMES): 2026-27 season so far = out of sample
function run(label, methods, y) {
  const acc = {}; for (const m of Object.keys(methods)) acc[m] = { n: 0, l1: 0, lo: 0, lb: 0, hit: 0 };
  for (const [L] of PAIRS) {
    const { G, G2 } = data[L], co = cohort(L, y), start = d(`${y}-08-01`), end = d(`${y + 1}-06-30`);
    const pri = {}; // second-division ratings as of the end of the previous season
    for (const c of co) { const r2 = ratingAt(L.replace('.1', '.2'), d(`${y}-06-30`), c.l2, G2); if (r2) pri[c.name] = r2; }
    for (let wk = start; wk <= Math.min(end, d('2026-10-20')); wk += 7) {
      const base = fit(L, G, wk), test = G.filter(g => g.d >= wk && g.d < wk + 7 && g.d < d('2026-10-20'));
      const need = test.filter(g => [g.h, g.a].some(t => co.find(c => c.name === t) && (!base.t[t] || base.t[t][2] < V4.MIN_GAMES)));
      if (!need.length) continue;
      const Rs = {}; for (const [m, f] of Object.entries(methods)) Rs[m] = f({ L, G, wk, co, pri, base });
      for (const g of need) { const o = g.hg > g.ag ? 0 : g.hg === g.ag ? 1 : 2, ov = g.hg + g.ag >= 3, bt = g.hg > 0 && g.ag > 0;
        const ps = {}; let ok = true; for (const m of Object.keys(methods)) { ps[m] = Rs[m] && pred(Rs[m].R, g.h, g.a, Rs[m].flat); if (!ps[m]) ok = false; }
        if (!ok) continue;
        for (const m of Object.keys(methods)) { const q = ps[m], a = acc[m]; a.n++; a.l1 -= Math.log(q.pr[o]); a.lo -= Math.log(ov ? q.po : 1 - q.po); a.lb -= Math.log(bt ? q.pb : 1 - q.pb); a.hit += q.pr.indexOf(Math.max(...q.pr)) === o ? 1 : 0; } }
    }
  }
  console.log(`\n${label}`);
  for (const [m, a] of Object.entries(acc)) console.log(`  ${m.padEnd(28)} n=${a.n}  winner logloss ${(a.l1 / a.n).toFixed(3)}  O/U ${(a.lo / a.n).toFixed(3)}  BTTS ${(a.lb / a.n).toFixed(3)}  winner hit ${(100 * a.hit / a.n).toFixed(0)}%`);
}
const priorFor = (ctx, f) => { const pr = {}; for (const c of ctx.co) { const r2 = ctx.pri[c.name]; pr[c.name] = f(r2); } return pr; };
const M = (Kp, f) => ctx => ({ R: fit(ctx.L, ctx.G, ctx.wk, priorFor(ctx, f), Kp) });
const paramsFor = (excl, b) => { const ps = pairs.filter(p => p.L !== excl); return { cA0: Math.exp(mean(ps.map(p => Math.log(p.aL)))), cD0: Math.exp(mean(ps.map(p => Math.log(p.dL)))), ca: mean(ps.map(p => Math.log(p.aL) - b * Math.log(p.a2))), cd: mean(ps.map(p => Math.log(p.dL) - b * Math.log(p.d2))) }; };
// parameters are always fit on the OTHER leagues' 2025 clubs, so a club is never scored with its own result in the prior
const methodsFor = () => {
  const out = {
    'league average (no team info)': ctx => ({ R: ctx.base, flat: true }),
    'average club, shrink to 1': M(null, () => [1, 1]),
    'flat weak prior K=16': ctx => { const q = paramsFor(ctx.L, 0); return M(16, () => [q.cA0, q.cD0])(ctx); },
    'flat weak prior K=24': ctx => { const q = paramsFor(ctx.L, 0); return M(24, () => [q.cA0, q.cD0])(ctx); },
    'flat weak prior': ctx => { const q = paramsFor(ctx.L, 0); return M(8, () => [q.cA0, q.cD0])(ctx); },
  };
  for (const b of [0.25, 0.5, 1]) for (const Kp of [8, 16]) out[`2nd-div prior b=${b} K=${Kp}`] = ctx => { const q = paramsFor(ctx.L, b); return M(Kp, r2 => r2 ? [Math.exp(q.ca + b * Math.log(r2[0])), Math.exp(q.cd + b * Math.log(r2[1]))] : [q.cA0, q.cD0])(ctx); };
  return out;
};
run('2026-27 so far (promoted club under 8 games)', methodsFor(), 2026);
run('2025-26 season (promoted club under 8 games)', methodsFor(), 2025);
