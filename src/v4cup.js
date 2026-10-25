// v4 for the Champions League and Europa League. Same idea as v4 (shadow test; v2 is not touched), but a cup game
// is between clubs from different leagues, so the ratings are built in three layers:
//   1. each club's domestic attack / defence rating (v4core, from the club's own league),
//   2. a strength factor for each league,
//   3. a small correction per club from its own cup games (Champions League + Europa League, last ~3 seasons).
// Clubs from leagues the Hub does not keep (Portugal, Turkey, Scotland ...) have no layer 1, so they rest on
// layers 2 and 3 and need at least CUP.MIN_CUP_GAMES cup games.  The settings were chosen on 2024-25 cup games and
// then tested on 2025-26 and 2026-27 (see README). Pure functions, no I/O.
import { grid, norm } from './v4core.js';
import { CLUBS } from './v4cupnames.js';

const DAY = 86400000;
export const CUP = {
  H: 365, MAX_AGE: 1100, KL: 10, KU: 40, KUU: 200, ITER: 8, WARM_ITER: 3,
  MIN_DOM_GAMES: 5, MIN_CUP_GAMES: 2, RATING_TTL_MS: 18 * 3600000,
  COMPS: ['CL', 'EL'],
  DOMESTIC: ['eng.1', 'esp.1', 'ger.1', 'ita.1', 'fra.1', 'ned.1'],
};
export const compIndex = slug => (slug === 'uefa.champions' ? 0 : slug === 'uefa.europa' ? 1 : -1);

// ---- club names ---------------------------------------------------------------------------------
export const info = new Map(CLUBS.map(c => [c.name, c]));
const byAlias = new Map(), byDom = new Map();
for (const c of CLUBS) {
  for (const a of [...(c.name === 'Paris' ? [] : [c.name]), ...(c.dom ? [c.dom[1]] : []), ...c.also]) {
    const k = norm(a); if (k && !byAlias.has(k)) byAlias.set(k, c.name);
  }
  if (c.dom) byDom.set(c.dom[0] + '|' + c.dom[1], c.name);
}
// dom: { slug, name } = where the Hub found the club domestically (its league and the ESPN name there).
export function resolveClub(name, dom = null) {
  if (dom) { const c = byDom.get(dom.slug + '|' + dom.name); if (c) return c; }
  return byAlias.get(norm(name)) || null;
}

// ---- the fit --------------------------------------------------------------------------------------
// games: [{ d (day number), c (0 = CL, 1 = EL), h, a (cup names), hg, ag }]
// domOf(slug, espnName) -> [attack, defence, games] from the club's own league, or null.
// warm: the previous fit's R.w; with it 3 passes are enough (a full fit needs CUP.ITER).
// Each factor is "goals scored + k" over "goals expected with that factor left out + k", so k pulls it toward 1.
export function fitCup(games, domOf, nowMs, warm = null) {
  const now = nowMs / DAY;
  const gs = games.filter(g => g.d < now && now - g.d <= CUP.MAX_AGE);
  const names = [], idx = new Map(), id = n => { if (!idx.has(n)) { idx.set(n, names.length); names.push(n); } return idx.get(n); };
  const m = gs.length, hi = new Int32Array(m), ai = new Int32Array(m), cp = new Uint8Array(m), hg = new Float64Array(m), ag = new Float64Array(m), w = new Float64Array(m);
  gs.forEach((g, j) => { hi[j] = id(g.h); ai[j] = id(g.a); cp[j] = g.c; hg[j] = g.hg; ag[j] = g.ag; w[j] = Math.pow(0.5, (now - g.d) / CUP.H); });
  const n = names.length, gnames = [], grp = new Map(), gi = new Int32Array(n);
  names.forEach((nm, i) => { const k = info.get(nm).group; if (!grp.has(k)) { grp.set(k, gnames.length); gnames.push(k); } gi[i] = grp.get(k); });
  const nc = gnames.length;
  const a0 = new Float64Array(n).fill(1), d0 = new Float64Array(n).fill(1), cov = new Uint8Array(n);
  names.forEach((nm, i) => { const c = info.get(nm); if (c.dom) { const r = domOf(c.dom[0], c.dom[1]); if (r && r[2] >= CUP.MIN_DOM_GAMES) { a0[i] = r[0]; d0[i] = r[1]; cov[i] = 1; } } });
  const W = [0, 0], SH = [0, 0], SA = [0, 0];
  for (let j = 0; j < m; j++) { W[cp[j]] += w[j]; SH[cp[j]] += w[j] * hg[j]; SA[cp[j]] += w[j] * ag[j]; }
  const MH = [W[0] ? SH[0] / W[0] : 1.5, W[1] ? SH[1] / W[1] : 1.5], MA = [W[0] ? SA[0] / W[0] : 1.2, W[1] ? SA[1] / W[1] : 1.2];
  const La = new Float64Array(nc).fill(1), Ld = new Float64Array(nc).fill(1), ua = new Float64Array(n).fill(1), vd = new Float64Array(n).fill(1);
  if (warm) { names.forEach((nm, i) => { if (warm.ua[nm]) { ua[i] = warm.ua[nm]; vd[i] = warm.vd[nm]; } }); gnames.forEach((g, c) => { if (warm.La[g]) { La[c] = warm.La[g]; Ld[c] = warm.Ld[g]; } }); }
  const att = new Float64Array(n), def = new Float64Array(n);
  const sA = new Float64Array(n), eA = new Float64Array(n), sD = new Float64Array(n), eD = new Float64Array(n);
  const cA = new Float64Array(nc), cEA = new Float64Array(nc), cD = new Float64Array(nc), cED = new Float64Array(nc);
  const upd = () => { for (let i = 0; i < n; i++) { att[i] = La[gi[i]] * a0[i] * ua[i]; def[i] = Ld[gi[i]] * d0[i] * vd[i]; } };
  const passes = warm ? CUP.WARM_ITER : CUP.ITER;
  for (let it = 0; it < passes; it++) {
    upd(); sA.fill(0); eA.fill(0); sD.fill(0); eD.fill(0);
    for (let j = 0; j < m; j++) {
      const h = hi[j], a = ai[j], wj = w[j], mh = MH[cp[j]], ma = MA[cp[j]];
      sA[h] += wj * hg[j]; eA[h] += wj * mh * (att[h] / ua[h]) * def[a]; sA[a] += wj * ag[j]; eA[a] += wj * ma * (att[a] / ua[a]) * def[h];
      sD[a] += wj * hg[j]; eD[a] += wj * mh * att[h] * (def[a] / vd[a]); sD[h] += wj * ag[j]; eD[h] += wj * ma * att[a] * (def[h] / vd[h]);
    }
    for (let i = 0; i < n; i++) { const k = cov[i] ? CUP.KU : CUP.KUU; ua[i] = (sA[i] + k) / (eA[i] + k); vd[i] = (sD[i] + k) / (eD[i] + k); }
    upd(); cA.fill(0); cEA.fill(0); cD.fill(0); cED.fill(0);
    for (let j = 0; j < m; j++) {
      const h = hi[j], a = ai[j], ch = gi[h], ca = gi[a], wj = w[j], mh = MH[cp[j]], ma = MA[cp[j]];
      cA[ch] += wj * hg[j]; cEA[ch] += wj * mh * (att[h] / La[ch]) * def[a]; cA[ca] += wj * ag[j]; cEA[ca] += wj * ma * (att[a] / La[ca]) * def[h];
      cD[ca] += wj * hg[j]; cED[ca] += wj * mh * att[h] * (def[a] / Ld[ca]); cD[ch] += wj * ag[j]; cED[ch] += wj * ma * att[a] * (def[h] / Ld[ch]);
    }
    for (let c = 0; c < nc; c++) { La[c] = (cA[c] + CUP.KL) / (cEA[c] + CUP.KL); Ld[c] = (cD[c] + CUP.KL) / (cED[c] + CUP.KL); }
    upd(); let mA = 0, mD = 0; for (let i = 0; i < n; i++) { mA += att[i]; mD += def[i]; } mA /= n; mD /= n;
    for (let c = 0; c < nc; c++) { La[c] /= mA; Ld[c] /= mD; }
  }
  upd();
  const cnt = new Int32Array(n); for (let j = 0; j < m; j++) { cnt[hi[j]]++; cnt[ai[j]]++; }
  const f4 = x => +x.toFixed(4), R = { fitDay: Math.floor(now), mu: { CL: [f4(MH[0]), f4(MA[0])], EL: [f4(MH[1]), f4(MA[1])] }, t: {}, w: { ua: {}, vd: {}, La: {}, Ld: {} } };
  names.forEach((nm, i) => { R.t[nm] = [f4(att[i]), f4(def[i]), cnt[i], cov[i]]; R.w.ua[nm] = f4(ua[i]); R.w.vd[nm] = f4(vd[i]); });
  gnames.forEach((g, c) => { R.w.La[g] = f4(La[c]); R.w.Ld[g] = f4(Ld[c]); });
  return R;
}

// Prediction for one cup game; h / a are cup names (see resolveClub). null when a club is unknown or too thin.
export function predictCup(R, comp, h, a) {
  const th = R?.t[h], ta = R?.t[a], mu = R?.mu[CUP.COMPS[comp]];
  if (!th || !ta || !mu) return null;
  if ((!th[3] && th[2] < CUP.MIN_CUP_GAMES) || (!ta[3] && ta[2] < CUP.MIN_CUP_GAMES)) return null;
  const lh = mu[0] * th[0] * ta[1], la = mu[1] * ta[0] * th[1], p = grid(lh, la, true, 0); // plain Poisson: the cup model was tested without the low-score correction
  return {
    lambda: { home: lh, away: la }, home: p.home, draw: p.draw, away: p.away,
    over25: p.over25, under25: 1 - p.over25, bttsYes: p.bttsYes, bttsNo: 1 - p.bttsYes,
    topScores: p.top, drawRisk: false, model: 'v4',
  };
}
