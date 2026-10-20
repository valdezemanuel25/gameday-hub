// v4: opponent-adjusted, time-decayed goal ratings (shadow model; v2 stays the official model and is not touched).
//
// What it does
//   * Every team gets an attack and a defence rating, fitted on ~2.5 years of league games. Recent games
//     count more (half-life per competition) and each rating is compared with the opposition that was faced.
//   * Goals for the two teams come from a Poisson score grid (0-8 goals, normalised), like v2.
//   * Over 2.5 and Both-teams-to-score are pulled toward the league's recent scoring rate (their raw signal is weak).
// What it does NOT do: no betting odds, no lineups/injuries, no cup games (needs both clubs in the same league).
//
// Pure functions, no I/O (history and KV live in v4.js). Fitting ~1,000 games takes a few milliseconds.
const DAY = 86400000;
export const V4 = {
  // half-life (days) and shrink strength (pseudo-games), chosen on earlier seasons and checked on later ones
  PARAMS: {
    'eng.1': { H: 240, K: 8 }, 'eng.2': { H: 240, K: 8 }, 'ger.1': { H: 240, K: 8 }, 'ger.2': { H: 240, K: 8 },
    'esp.1': { H: 240, K: 8 }, 'esp.2': { H: 240, K: 8 }, 'ita.1': { H: 240, K: 8 }, 'fra.1': { H: 240, K: 8 },
    'ned.1': { H: 240, K: 8 }, 'usa.1': { H: 120, K: 8 }, 'mex.1': { H: 180, K: 4 }, 'bra.1': { H: 180, K: 6 },
  },
  MAX_AGE: 900,        // days of history used
  ITER: 20,
  WARM_ITER: 3,
  MIN_GAMES: 8,        // both clubs need this many games in the window, or v4 stays silent
  CAL_SLOPE: 0.55,     // how much of the model's own Over / BTTS signal is kept
  CAL_RECENT: 200,     // games used to find what the model says for an "average" game
  RATING_TTL_MS: 18 * 3600000,
  // A club with fewer than MIN_GAMES games in its league (newly promoted, usually) is not left out: it starts from a
  // somewhat weak prior (attack, defence; defence above 1 = leakier) that fades as its own games come in. Fitted on the
  // 2025 promoted clubs of England, Spain and Germany and checked on this season (tools/backtest-promoted.mjs).
  PROMO: { att: 0.866, def: 1.067, K: 16 },
};

// ---- club names: ESPN names -> the names used in the seed --------------------------------------
export const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/&/g, ' and ').replace(/[^a-z0-9 ]/g, ' ')
  .replace(/\b(fc|afc|cf|sc|club|cd|ud|ac|the|de|sv|vfl|vfb|tsv|tsg|1|fsv|1fc)\b/g, ' ').replace(/\s+/g, ' ').trim();

// ---- the fit -------------------------------------------------------------------------------------
const lg = p => { const q = Math.min(1 - 1e-6, Math.max(1e-6, p)); return Math.log(q / (1 - q)); };
const sg = x => 1 / (1 + Math.exp(-x));

// Poisson score grid, 0-8 goals each, normalised to 1.
export function grid(lamH, lamA, withTop = true) {
  const G = 9, ph = [Math.exp(-lamH)], pa = [Math.exp(-lamA)];
  for (let k = 1; k < G; k++) { ph[k] = ph[k - 1] * lamH / k; pa[k] = pa[k - 1] * lamA / k; }
  let home = 0, draw = 0, away = 0, over = 0, btts = 0, tot = 0; const sc = [];
  for (let x = 0; x < G; x++) for (let y = 0; y < G; y++) {
    const p = ph[x] * pa[y]; tot += p; if (withTop) sc.push([x, y, p]);
    if (x > y) home += p; else if (x === y) draw += p; else away += p;
    if (x + y >= 3) over += p; if (x > 0 && y > 0) btts += p;
  }
  if (withTop) sc.sort((u, v) => v[2] - u[2]);
  return { home: home / tot, draw: draw / tot, away: away / tot, over25: over / tot, bttsYes: btts / tot, top: withTop ? sc.slice(0, 3).map(s => ({ score: `${s[0]}–${s[1]}`, p: s[2] / tot })) : [] };
}

// games: [{ d (day number), h, a, hg, ag }]; nowMs: fit "as of" this moment.
// warm: an earlier fit (or the seed's starting ratings). With it, 3 passes are enough, which keeps the fit
// well inside the free plan's 10 ms CPU limit. Without it, a full 20-pass fit is used.
export function fit(slug, games, nowMs = Date.now(), warm = null) {
  const { H, K } = V4.PARAMS[slug] || { H: 240, K: 8 };
  const now = nowMs / DAY;
  const gs = games.filter(g => g.d < now && now - g.d <= V4.MAX_AGE);
  const names = [], idx = new Map(), id = n => { if (!idx.has(n)) { idx.set(n, names.length); names.push(n); } return idx.get(n); };
  const hi = new Int32Array(gs.length), ai = new Int32Array(gs.length), hg = new Float64Array(gs.length), ag = new Float64Array(gs.length), w = new Float64Array(gs.length);
  let W = 0, sh = 0, sa = 0;
  gs.forEach((g, i) => { hi[i] = id(g.h); ai[i] = id(g.a); hg[i] = g.hg; ag[i] = g.ag; w[i] = Math.pow(0.5, (now - g.d) / H); W += w[i]; sh += w[i] * g.hg; sa += w[i] * g.ag; });
  const n = names.length, muH = sh / W, muA = sa / W;
  const A = new Float64Array(n).fill(1), D = new Float64Array(n).fill(1);
  const cnt = new Int32Array(n); for (let i = 0; i < gs.length; i++) { cnt[hi[i]]++; cnt[ai[i]]++; }
  // per-club prior target and shrink strength: everyone shrinks toward 1 with K; a club under MIN_GAMES toward PROMO with PROMO.K
  const pA = new Float64Array(n).fill(1), pD = new Float64Array(n).fill(1), kk = new Float64Array(n).fill(K), promo = new Uint8Array(n);
  for (let t = 0; t < n; t++) if (cnt[t] < V4.MIN_GAMES) { pA[t] = V4.PROMO.att; pD[t] = V4.PROMO.def; kk[t] = V4.PROMO.K; promo[t] = 1; }
  if (warm) names.forEach((nm, t) => { const w0 = warm[nm]; if (w0) { A[t] = w0[0]; D[t] = w0[1]; } });
  const passes = warm ? V4.WARM_ITER : V4.ITER;
  const sA = new Float64Array(n), eA = new Float64Array(n), sD = new Float64Array(n), eD = new Float64Array(n);
  for (let it = 0; it < passes; it++) {
    sA.fill(0); eA.fill(0); sD.fill(0); eD.fill(0);
    for (let i = 0; i < gs.length; i++) {
      const h = hi[i], a = ai[i], wi = w[i];
      sA[h] += wi * hg[i]; eA[h] += wi * muH * D[a]; sA[a] += wi * ag[i]; eA[a] += wi * muA * D[h];
      sD[a] += wi * hg[i]; eD[a] += wi * muH * A[h]; sD[h] += wi * ag[i]; eD[h] += wi * muA * A[a];
    }
    let ma = 0, md = 0;
    for (let t = 0; t < n; t++) { A[t] = (sA[t] + kk[t] * pA[t]) / (eA[t] + kk[t]); D[t] = (sD[t] + kk[t] * pD[t]) / (eD[t] + kk[t]); ma += A[t]; md += D[t]; }
    ma /= n; md /= n; for (let t = 0; t < n; t++) { A[t] /= ma; D[t] /= md; }
  }
  const R = { slug, fitDay: Math.floor(now), H, K, muH, muA, t: {} };
  names.forEach((nm, t) => { R.t[nm] = [+A[t].toFixed(4), +D[t].toFixed(4), cnt[t], promo[t]]; });

  // League context for the Over / BTTS pull: what the league actually did in the last year, and what the
  // raw model says on average for the most recent games.
  const lastYear = gs.filter(g => now - g.d <= 365);
  const rate = f => (lastYear.length ? lastYear.filter(f).length / lastYear.length : 0.5);
  R.base = [rate(g => g.hg + g.ag >= 3), rate(g => g.hg > 0 && g.ag > 0)];
  const rec = gs.slice(-V4.CAL_RECENT); let mo = 0, mb = 0;
  for (const g of rec) { const [lh, la] = lambdas(R, g.h, g.a), p = grid(lh, la, false); mo += p.over25; mb += p.bttsYes; }
  R.mean = rec.length ? [mo / rec.length, mb / rec.length] : [0.5, 0.5];
  return R;
}

function lambdas(R, h, a) {
  const th = R.t[h], ta = R.t[a];
  return [R.muH * th[0] * ta[1], R.muA * ta[0] * th[1]];
}

// Prediction for one match. h / a are seed names (see resolve). Returns null if either club has no games at all in
// this league's ratings. A club under MIN_GAMES is predicted from its starting prior and the result is flagged `promo`.
export function predict(R, h, a) {
  const th = R?.t[h], ta = R?.t[a];
  if (!th || !ta || th[2] < 1 || ta[2] < 1) return null;
  const [lh, la] = lambdas(R, h, a), p = grid(lh, la);
  const pull = (raw, base, mean) => sg(lg(base) + V4.CAL_SLOPE * (lg(raw) - lg(mean)));
  const over25 = pull(p.over25, R.base[0], R.mean[0]), bttsYes = pull(p.bttsYes, R.base[1], R.mean[1]);
  return {
    lambda: { home: lh, away: la }, home: p.home, draw: p.draw, away: p.away,
    over25, under25: 1 - over25, bttsYes, bttsNo: 1 - bttsYes,
    topScores: p.top, drawRisk: false, model: 'v4', promo: !!(th[3] || ta[3]),
  };
}

