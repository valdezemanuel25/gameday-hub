// v5: v4's attack / defence ratings blended with a goal-difference Elo rating (shadow model, tracked next to v4 and Forebet).
//
// What it does
//   * Elo: every league game moves both clubs' ratings by K x (result - expected), more for bigger wins; home advantage is learned
//     per league; between seasons (a 40+ day break) ratings move a quarter of the way back to the league average.
//   * The Elo gap is turned into home / draw / away with an ordered logistic curve, then pooled with v4's chances (a weighted
//     geometric mean). The draw gets a small extra term: likelier when v4 expects more goals than usual (the Poisson grid
//     under-counts those draws) and when the two clubs are level.
//   * Over 2.5 is v4's number re-scaled on the history: a little flatter, and nudged up in the middle (v4 ran slightly low on it).
//     Both-score is v4's (nothing tried beat it).
// How it was chosen: walk-forward on the bundled history (refit each week on earlier games only). Settings tuned on the first
// stretch of each league, then checked on the last ~11 months (3,803 games): log loss 0.0018 a game better than v4 (z = 1.9,
// fitted on one half of that window and scored on the other). Small: it is tracked on the Results tab before it is trusted.
// What it does NOT do: no odds, no lineups, no cup games (Elo needs both clubs in the same league).
// Pure functions, no I/O. Rating a league's ~1,300 games takes well under a millisecond.

export const V5 = {
  ELO: { K: 18, HFA0: 60, HK: 0.02, INIT: 1500, NEW: -60, REVERT: 0.25, BREAK: 40 },
  ORD: [-0.5934, 0.5426, 0.6155],          // Elo gap (per 100 points) -> P(home), P(home or draw)
  POOL: [0.6639, 0.3977, 0.0542, 0.3419, 0.0895], // v4 weight, Elo weight, draw offset, draw x expected goals, draw x evenness
  OVER: [0.1048, 0.8022],                  // Over 2.5 = sigmoid(a + b * logit(v4 Over))
};

const sg = x => 1 / (1 + Math.exp(-x)), lg = p => { const q = Math.min(1 - 1e-6, Math.max(1e-6, p)); return Math.log(q / (1 - q)); };

// games: [{ d (day number), h, a, hg, ag }] in date order. Returns { t: { club: rating }, hfa, n }.
export function eloRun(games) {
  const { K, HFA0, HK, INIT, NEW, REVERT, BREAK } = V5.ELO, R = new Map();
  let hfa = HFA0, last = null;
  const mean = () => { let s = 0; for (const v of R.values()) s += v; return s / R.size; };
  const get = t => { if (!R.has(t)) R.set(t, R.size > 15 ? mean() + NEW : INIT); return R.get(t); };
  for (const g of games) {
    if (last != null && g.d - last > BREAK && R.size) { const m = mean(); for (const [t, v] of R) R.set(t, m + (v - m) * (1 - REVERT)); }
    last = g.d;
    const rh = get(g.h), ra = get(g.a), E = 1 / (1 + Math.pow(10, -(rh - ra + hfa) / 400));
    const W = g.hg > g.ag ? 1 : g.hg === g.ag ? 0.5 : 0, gd = Math.abs(g.hg - g.ag), M = gd <= 1 ? 1 : gd === 2 ? 1.5 : (11 + gd) / 8;
    const dl = K * M * (W - E);
    R.set(g.h, rh + dl); R.set(g.a, ra - dl); hfa += HK * dl;
  }
  const t = {}; for (const [k, v] of R) t[k] = +v.toFixed(2);
  return { t, hfa: +hfa.toFixed(2), n: games.length };
}

// v5 for one match from v4's prediction (home / draw / away / over25 / bttsYes / lambda) and the league's Elo. null if a club has no Elo.
export function predict5(p4, E, h, a) {
  if (!p4 || !E || E.t[h] == null || E.t[a] == null) return null;
  const x = (E.t[h] - E.t[a] + E.hfa) / 100, [a1, a2, b] = V5.ORD, ph = sg(a1 + b * x), phd = sg(a2 + b * x);
  const e = [ph, Math.max(1e-6, phd - ph), Math.max(1e-6, 1 - phd)];
  const [w4, we, d0, dt, dv] = V5.POOL, lh = p4.lambda.home, la = p4.lambda.away;
  const dx = d0 + dt * (Math.log(lh + la) - Math.log(2.7)) - dv * Math.abs(Math.log(lh / la));
  const q = [p4.home, p4.draw, p4.away].map((v, i) => Math.exp(w4 * Math.log(Math.max(1e-6, v)) + we * Math.log(e[i]) + (i === 1 ? dx : 0)));
  const s = q[0] + q[1] + q[2], over25 = sg(V5.OVER[0] + V5.OVER[1] * lg(p4.over25));
  return {
    lambda: p4.lambda, home: q[0] / s, draw: q[1] / s, away: q[2] / s,
    over25, under25: 1 - over25, bttsYes: p4.bttsYes, bttsNo: p4.bttsNo,
    topScores: p4.topScores, drawRisk: false, model: 'v5', elo: [Math.round(E.t[h]), Math.round(E.t[a])],
  };
}
