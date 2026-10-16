// Walk-forward test of v4 on the games stored in src/v4seed.js: refit every 7 days on everything before that week,
// predict that week's games, score the predictions. No market odds anywhere. Run: node tools/backtest-v4.mjs [league]
import seed from '../src/v4seed.js';
import { V4, fit, grid } from '../src/v4core.js';
const DAY = 86400000, lgt = p => { const q = Math.min(1 - 1e-6, Math.max(1e-6, p)); return Math.log(q / (1 - q)); }, sg = x => 1 / (1 + Math.exp(-x));
const clip = (x, a, b) => Math.min(b, Math.max(a, x));
const only = process.argv[2];

function league(slug, opts) {
  const s = seed[slug], T = s.teams;
  const G = s.g.map(([d, h, a, hg, ag]) => ({ d, h: T[h], a: T[a], hg, ag })).sort((x, y) => x.d - y.d);
  const first = G[0].d, last = G[G.length - 1].d, startTest = Math.max(first + 420, last - 330);
  // rest days before each game for each club (capped at 10)
  const prev = new Map(); G.forEach(g => { g.rh = clip(g.d - (prev.get(g.h) ?? g.d - 7), 1, 10); g.ra = clip(g.d - (prev.get(g.a) ?? g.d - 7), 1, 10); prev.set(g.h, g.d); prev.set(g.a, g.d); });
  const old = V4.PARAMS[slug]; V4.PARAMS[slug] = { H: opts.H, K: opts.K };
  const acc = { n: 0, ll1: 0, llO: 0, llB: 0, br: 0, hit: 0, calO: [], calB: [] };
  for (let wk = startTest; wk <= last; wk += 7) {
    const train = G.filter(g => g.d < wk), test = G.filter(g => g.d >= wk && g.d < wk + 7);
    if (!test.length) continue;
    const R = fit(slug, train, (wk) * DAY);
    // per-club home residual (for the home-advantage experiment)
    const hres = {};
    if (opts.g) {
      const sum = {}, wsum = {};
      for (const g of train) { if (!(wk - g.d <= V4.MAX_AGE)) continue; const th = R.t[g.h], ta = R.t[g.a]; if (!th || !ta) continue;
        const lh = R.muH * th[0] * ta[1], la = R.muA * ta[0] * th[1], w = Math.pow(0.5, (wk - g.d) / R.H);
        sum[g.h] = (sum[g.h] || 0) + w * (Math.log((g.hg + .5) / (lh + .5)) - Math.log((g.ag + .5) / (la + .5))); wsum[g.h] = (wsum[g.h] || 0) + w; }
      for (const t in sum) hres[t] = sum[t] / (wsum[t] + opts.K2);
    }
    for (const g of test) {
      const th = R.t[g.h], ta = R.t[g.a]; if (!th || !ta || th[2] < V4.MIN_GAMES || ta[2] < V4.MIN_GAMES) continue;
      let lh = R.muH * th[0] * ta[1], la = R.muA * ta[0] * th[1];
      if (opts.b) { const r = clip(g.rh - g.ra, -4, 4); lh *= Math.exp(opts.b * r); la *= Math.exp(-opts.b * r); }
      if (opts.g) { const x = (hres[g.h] || 0) * opts.g; lh *= Math.exp(x / 2); la *= Math.exp(-x / 2); }
      const p = grid(lh, la, false), pull = (raw, base, mean) => sg(lgt(base) + V4.CAL_SLOPE * (lgt(raw) - lgt(mean)));
      const po = pull(p.over25, R.base[0], R.mean[0]), pb = pull(p.bttsYes, R.base[1], R.mean[1]);
      const o = g.hg > g.ag ? 0 : g.hg === g.ag ? 1 : 2, pr = [p.home, p.draw, p.away], ov = g.hg + g.ag >= 3 ? 1 : 0, bt = g.hg > 0 && g.ag > 0 ? 1 : 0;
      acc.n++; acc.ll1 -= Math.log(Math.max(1e-9, pr[o])); acc.llO -= Math.log(Math.max(1e-9, ov ? po : 1 - po)); acc.llB -= Math.log(Math.max(1e-9, bt ? pb : 1 - pb));
      acc.br += pr.reduce((s, q, i) => s + (q - (i === o ? 1 : 0)) ** 2, 0); acc.hit += pr.indexOf(Math.max(...pr)) === o ? 1 : 0;
      acc.calO.push([po, ov]); acc.calB.push([pb, bt]);
    }
  }
  V4.PARAMS[slug] = old;
  return acc;
}
const fmt = a => a.n ? { n: a.n, ll1: +(a.ll1 / a.n).toFixed(4), llO: +(a.llO / a.n).toFixed(4), llB: +(a.llB / a.n).toFixed(4), br: +(a.br / a.n).toFixed(4), hit: +(a.hit / a.n).toFixed(3) } : null;
export { league, fmt, seed };
if (process.argv[1].endsWith('backtest-v4.mjs')) {
  const slugs = Object.keys(seed).filter(s => !only || s === only);
  const out = {};
  for (const slug of slugs) {
    const cur = { ...V4.PARAMS[slug] };
    const base = fmt(league(slug, { ...cur }));
    const grid1 = []; for (const H of [90, 150, 240, 360]) for (const K of [3, 6, 10, 16]) grid1.push({ H, K, ...fmt(league(slug, { H, K })) });
    out[slug] = { cur, base, grid: grid1 };
    console.log(slug, JSON.stringify(cur), JSON.stringify(base));
  }
  console.log(JSON.stringify(out));
}
