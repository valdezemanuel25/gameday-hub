// v6 "score card": one score grid behind every number on the card, anchored to the sportsbook price (shadow model, tracked).
//
// What it does
//   * Takes the card's DraftKings price (home / draw / away, and the main total with its Over / Under prices), removes the book's margin
//     (power method, see devig), and finds the expected goals for each side whose score grid (Poisson with v4's low-score correction)
//     best reproduces those
//     chances. Two numbers fit four prices to within about half a point on the Oct 13-25 games.
//   * Winner, Over 2.5, both-score and the likeliest scores are all read off that one grid, so they always agree with each other.
//   * W_MODEL: how much of v4's own home / draw / away is mixed in before fitting. 0 for now: on the priced games so far the best
//     v4 + market mix was 0% v4 (src/market.js). Raise it only when that mix says v4 adds something.
// Why: the market beat every model by about 0.03 log loss a game, and on the 72 priced games the grid's Over 2.5 and both-score
// beat v4's and the base rates (its both-score also landed within 2 points of the book's own both-score price, which it never saw).
// No price, no v6. Pure functions, no I/O; one fit is a few hundred small grid evaluations (well under a millisecond).
import { grid, dcTau, V4 } from './v4core.js';

// BTTS_SHIFT: added to the both-score chance on the log-odds scale (about +2.6 points at 50%). The grid fitted to 1X2 and the total
// under-counts games where both score: on 8,389 closing prices (data/football-data) it said 53% where 55-57% happened. Tuned on
// 2023/24-2024/25 and checked on 2025/26-2026/27 (3,169 games): said 55.6% vs 56.6% happened, log loss 0.6777 -> 0.6753.
export const V6 = { W_MODEL: 0, ITER: 200, BTTS_SHIFT: 0.105 };
const sgm = x => 1 / (1 + Math.exp(-x)), lgt = p => Math.log(p / (1 - p));

const dec = m => (m > 0 ? 1 + m / 100 : 1 + 100 / -m);
// American prices -> chances adding to 1 with the book's margin removed, or null when one is missing. Power method: each implied
// chance q is raised to the same power k (found by bisection) so that they add to 1. Books load more margin onto long shots, so
// this takes more out of them than removing it in proportion. On 8,389 closing prices (2023-2026, data/football-data) favourites
// rated 60%+ came out at 70.9% against 70.8% won (proportional: 69.9% against 71.8%), log loss 0.9743 against 0.9748.
export function devig(...ms) {
  if (!ms.every(Number.isFinite)) return null;
  const q = ms.map(m => 1 / dec(m));
  let lo = 0.5, hi = 2, k = 1;
  for (let i = 0; i < 50; i++) { k = (lo + hi) / 2; const s = q.reduce((a, x) => a + Math.pow(x, k), 0); if (s > 1) lo = k; else hi = k; }
  const p = q.map(x => Math.pow(x, k)), s = p.reduce((a, b) => a + b, 0);
  return p.map(x => x / s);
}
// P(more goals than a half-goal line) on the same grid as v4core.grid (0-8 goals each, low-score correction, normalised).
export function overAt(lh, la, line, rho = V4.RHO) {
  const G = 9, ph = [Math.exp(-lh)], pa = [Math.exp(-la)];
  for (let k = 1; k < G; k++) { ph[k] = ph[k - 1] * lh / k; pa[k] = pa[k - 1] * la / k; }
  let o = 0, t = 0;
  for (let x = 0; x < G; x++) for (let y = 0; y < G; y++) { const p = ph[x] * pa[y] * dcTau(x, y, lh, la, rho); t += p; if (x + y > line) o += p; }
  return o / t;
}
// What the price says: { hda: [h, d, a], over: [line, P(over)] | null } with the margin removed. Only a half-goal total is used
// (a whole-number line can push, which the plain over / under prices do not say how to split).
export function targets(odds) {
  const hda = odds ? devig(odds.h, odds.d, odds.a) : null; if (!hda) return null;
  const ou = odds.tl % 1 === 0.5 ? devig(odds.to, odds.tu) : null;
  return { hda, over: ou ? [odds.tl, ou[0]] : null };
}
// Expected goals { lh, la } whose grid best matches the targets (least squares on the chances), found by a small pattern search.
export function fitGoals(T) {
  const f = ([a, b]) => {
    const lh = Math.exp(a), la = Math.exp(b), g = grid(lh, la, false);
    let e = (g.home - T.hda[0]) ** 2 + (g.draw - T.hda[1]) ** 2 + (g.away - T.hda[2]) ** 2;
    if (T.over) e += (overAt(lh, la, T.over[0]) - T.over[1]) ** 2;
    return e;
  };
  let x = [Math.log(1.5), Math.log(1.2)], fx = f(x), step = 0.3;
  for (let it = 0; it < V6.ITER && step > 1e-5; it++) {
    let moved = false;
    for (const [da, db] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const y = [x[0] + da * step, x[1] + db * step], fy = f(y); if (fy < fx) { x = y; fx = fy; moved = true; }
    }
    if (!moved) step /= 2;
  }
  return { lh: Math.exp(x[0]), la: Math.exp(x[1]), err: Math.sqrt(fx / (T.over ? 4 : 3)) };
}
// The score card for one game from its price (and v4's home / draw / away when W_MODEL > 0). null without a full 1X2 price.
export function scoreCard(odds, p4 = null) {
  const T = targets(odds); if (!T) return null;
  if (V6.W_MODEL > 0 && p4) {
    const w = V6.W_MODEL, q = T.hda.map((m, i) => Math.exp((1 - w) * Math.log(m) + w * Math.log(Math.max(1e-6, [p4.home, p4.draw, p4.away][i])))), s = q[0] + q[1] + q[2];
    T.hda = q.map(v => v / s);
  }
  const F = fitGoals(T), g = grid(F.lh, F.la, true), btts = sgm(lgt(g.bttsYes) + V6.BTTS_SHIFT);
  return {
    lambda: { home: F.lh, away: F.la }, home: g.home, draw: g.draw, away: g.away,
    over25: g.over25, under25: 1 - g.over25, bttsYes: btts, bttsNo: 1 - btts,
    topScores: g.top, drawRisk: false, model: 'v6', fit: +F.err.toFixed(4),
  };
}
