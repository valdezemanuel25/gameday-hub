// Does rating clubs on shots on target (as well as goals) predict better than v4's goals-only ratings? Walk-forward on the big five
// leagues, 2018-19 to 2025-26 (football-data.co.uk season files, read from the GitHub mirror datasets/football-datasets: goals,
// shots, shots on target; no odds). Ratings are refit every week on earlier games only. Settings are tuned on 2019-20 to 2022-23
// and scored on 2023-24 to 2025-26. The goals markets get the same calibration for both versions (fitted on the tuning seasons).
// Result on Oct 26, 2026 (docs/shots-rating-2026-10-26.md): 70% goals + 30% shots on target was only 0.0006 log loss a game better
// on the winner (z 1.0) and 0.0008 on Over 2.5 (z 2.2). Run: node tools/backtest-shots.mjs  (needs raw.githubusercontent.com)
import { V4, fit, grid } from '../src/v4core.js';
const DAY = 86400000, URL0 = 'https://raw.githubusercontent.com/datasets/football-datasets/main/datasets';
const LG = { 'premier-league': 'eng.1', 'la-liga': 'esp.1', 'serie-a': 'ita.1', bundesliga: 'ger.1', 'ligue-1': 'fra.1' };
const SEASONS = ['1819', '1920', '2021', '2122', '2223', '2324', '2425', '2526'], TUNE = new Set(['1920', '2021', '2122', '2223']);
const SHOTS = { W_GOALS: 0.7, H: 240, K: 3, PER_SOT: 0.321 }; // goals weight in the blend, shots half-life (days) and shrink, goals per shot on target
const G = [];
for (const [dir, lg] of Object.entries(LG)) for (const s of SEASONS) {
  const res = await fetch(`${URL0}/${dir}/season-${s}.csv`); if (!res.ok) { console.log(`skip ${dir} ${s}: ${res.status}`); continue; }
  const [head, ...rows] = (await res.text()).trim().split(/\r?\n/), H = head.split(','), at = (c, k) => c[H.indexOf(k)];
  for (const r of rows) { const c = r.split(','), d = Math.floor(Date.parse(at(c, 'Date')) / DAY), n = k => (at(c, k) === '' || at(c, k) == null ? null : +at(c, k));
    if (!Number.isNaN(d) && n('FTHG') != null && n('HST') != null) G.push({ lg, season: s, d, h: at(c, 'HomeTeam'), a: at(c, 'AwayTeam'), hg: n('FTHG'), ag: n('FTAG'), hst: n('HST'), ast: n('AST') }); }
}
G.sort((x, y) => x.d - y.d);
const recs = [], ws = t => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, [v[0], v[1]]]));
for (const lg of Object.values(LG)) {
  const L = G.filter(g => g.lg === lg); if (!L.length) continue;
  const keep = V4.PARAMS[lg], goals = L.map(g => ({ ...g })), sh = L.map(g => ({ ...g, hg: SHOTS.PER_SOT * g.hst, ag: SHOTS.PER_SOT * g.ast }));
  let wG = null, wS = null;
  for (let wk = L[0].d + 300; wk <= L[L.length - 1].d; wk += 7) {
    const test = L.filter(g => g.d >= wk && g.d < wk + 7 && g.season !== '1819'); if (!test.length) continue;
    const RG = fit(lg, goals.filter(g => g.d < wk), wk * DAY, wG); wG = ws(RG.t);
    V4.PARAMS[lg] = { H: SHOTS.H, K: SHOTS.K }; const RS = fit(lg, sh.filter(g => g.d < wk), wk * DAY, wS); wS = ws(RS.t); V4.PARAMS[lg] = keep;
    for (const g of test) {
      const a = RG.t[g.h], b = RG.t[g.a], s1 = RS.t[g.h], s2 = RS.t[g.a]; if (!a || !b || !s1 || !s2 || a[2] < 8 || b[2] < 8) continue;
      const lamG = [RG.muH * a[0] * b[1], RG.muA * b[0] * a[1]], lamS = [RG.muH * s1[0] * s2[1], RG.muA * s2[0] * s1[1]];
      const mk = l => { const q = grid(l[0], l[1], false); return { p: [q.home, q.draw, q.away], o: q.over25, b: q.bttsYes }; };
      recs.push({ tune: TUNE.has(g.season), hg: g.hg, ag: g.ag, goals: mk(lamG), blend: mk([0, 1].map(i => Math.exp(SHOTS.W_GOALS * Math.log(lamG[i]) + (1 - SHOTS.W_GOALS) * Math.log(lamS[i])))) });
    }
  }
}
const sg = x => 1 / (1 + Math.exp(-x)), lgt = p => Math.log(p / (1 - p)), bl = (p, y) => -Math.log(Math.max(1e-9, y ? p : 1 - p));
const tune = recs.filter(r => r.tune), test = recs.filter(r => !r.tune), ov = r => r.hg + r.ag >= 3, bt = r => r.hg > 0 && r.ag > 0;
const calib = (k, sub, y) => { let best = [0, 1], bv = Infinity; for (let a = -0.3; a <= 0.3001; a += 0.02) for (let b = 0.3; b <= 1.2001; b += 0.05) { const v = tune.reduce((s, r) => s + bl(sg(a + b * lgt(r[k][sub])), y(r)), 0); if (v < bv) { bv = v; best = [a, b]; } } return best; };
const per = k => { const cO = calib(k, 'o', ov), cB = calib(k, 'b', bt); return test.map(r => { const o = r.hg > r.ag ? 0 : r.hg === r.ag ? 1 : 2, p = r[k].p; return { ll: -Math.log(p[o]), rps: ((p[0] - (o === 0)) ** 2 + (p[0] + p[1] - (o <= 1)) ** 2) / 2, lo: bl(sg(cO[0] + cO[1] * lgt(r[k].o)), ov(r)), lb: bl(sg(cB[0] + cB[1] * lgt(r[k].b)), bt(r)) }; }); };
const A = per('goals'), B = per('blend'), m = (P, k) => +(P.reduce((s, x) => s + x[k], 0) / P.length).toFixed(4);
const z = k => { const d = A.map((x, i) => x[k] - B[i][k]), n = d.length, mu = d.reduce((s, x) => s + x, 0) / n, sd = Math.sqrt(d.reduce((s, x) => s + (x - mu) ** 2, 0) / (n - 1)); return { gain: +mu.toFixed(5), z: +(mu / (sd / Math.sqrt(n))).toFixed(1) }; };
console.log(JSON.stringify({ games: G.length, testGames: test.length, goalsOnly: { ll: m(A, 'll'), rps: m(A, 'rps'), over: m(A, 'lo'), btts: m(A, 'lb') }, withShots: { ll: m(B, 'll'), rps: m(B, 'rps'), over: m(B, 'lo'), btts: m(B, 'lb') }, gain: { winner: z('ll'), over: z('lo'), btts: z('lb') } }));
