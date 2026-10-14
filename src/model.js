// Poisson goal-expectancy model for soccer: v2 (official) and v3 / v3+xG (shadow).
// Pure functions, no I/O. Runs in Cloudflare Workers and Node.

export const V2 = { PRIOR: 1.56, HOME: 1.17, AWAY: 0.83, FORM_WEIGHT: 0.6 };

export const V3 = {
  HOME: 1.17,
  AWAY: 0.83,
  SEASON_WEIGHT: 0.65,        // 65% season-long rating, 35% last-5 form
  FORM_WEIGHT: 0.35,
  LAST_SEASON_GAMES: 8,       // last season counts as 8 extra games
  BASE_RATES: [0.44, 0.27, 0.29], // home / draw / away
  BASE_BLEND: 0.2,            // 20% shrink toward base rates
  XG_SHARE: 0.7,              // v3+xG: 70% xG + 30% actual goals
  DRAW_RISK_GAP: 10,          // points
  DRAW_RISK_MIN_DRAW: 26,     // percent
};

// Rough a-priori league-strength tiers (from the Hub's method note; not fitted).
export const LEAGUE_STRENGTH = {
  ENG: 1.0, ESP: 1.0, ITA: 0.97, GER: 0.97, FRA: 0.93, POR: 0.9,
  NED: 0.88, BEL: 0.85, TUR: 0.83, CZE: 0.8, NOR: 0.75, AZE: 0.65,
};

// The Hub's original calculation used a 0-8 goal grid and did NOT rescale the tail. Matching that exactly
// reproduces all 120 comparable v2 cards in the old Hub (see test/parity.mjs).
const MAX_GOALS = 8;

function poissonPmf(lambda) {
  const p = new Array(MAX_GOALS + 1);
  p[0] = Math.exp(-lambda);
  for (let k = 1; k <= MAX_GOALS; k++) p[k] = (p[k - 1] * lambda) / k;
  return p;
}

// Score grid -> markets. All probabilities are 0..1.
export function markets(lamH, lamA) {
  const ph = poissonPmf(lamH);
  const pa = poissonPmf(lamA);
  let home = 0, draw = 0, away = 0, over25 = 0, btts = 0;
  const scores = [];
  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      const p = ph[h] * pa[a];
      if (h > a) home += p; else if (h === a) draw += p; else away += p;
      if (h + a >= 3) over25 += p;
      if (h > 0 && a > 0) btts += p;
      scores.push({ h, a, p });
    }
  }
  scores.sort((x, y) => y.p - x.p);
  return {
    home, draw, away,
    over25, under25: 1 - over25,
    bttsYes: btts, bttsNo: 1 - btts,
    topScores: scores.slice(0, 3).map(s => ({ score: `${s.h}–${s.a}`, p: s.p })),
  };
}

// ---- v2 ----
// form: { gf, ga, n } = goals for / against over the last n (usually 5) domestic league games.
export function v2Lambdas(homeForm, awayForm, c = V2) {
  const w = c.FORM_WEIGHT;
  const att = f => w * (f.gf / f.n) + (1 - w) * c.PRIOR;
  const def = f => w * (f.ga / f.n) + (1 - w) * c.PRIOR;
  return {
    home: (att(homeForm) * def(awayForm) / c.PRIOR) * c.HOME,
    away: (att(awayForm) * def(homeForm) / c.PRIOR) * c.AWAY,
  };
}

export function v2(homeForm, awayForm) {
  const lam = v2Lambdas(homeForm, awayForm);
  return { lambda: lam, ...markets(lam.home, lam.away) };
}

// ---- v3 / v3+xG ----
// team: {
//   season:  { gf, ga, gp }         this season, per-game source = totals
//   last:    { gf, ga, gp }         last season totals (use league-average-based stand-in if promoted)
//   form:    { gf, ga, n }          last-5 totals; with xG: { gf, ga, n, xgf, xga }
//   league:  'ENG' | 'FRA' ...      key into LEAGUE_STRENGTH
//   leagueAvg: goals per team per game in this team's league
// }
function rate(team, side, useXg) {
  // side: 'gf' | 'ga'. Returns { season, form } per-game rates.
  const x = side === 'gf' ? 'xgf' : 'xga';
  const mix = (actual, xg) =>
    useXg && xg != null ? V3.XG_SHARE * xg + (1 - V3.XG_SHARE) * actual : actual;

  const s = team.season, l = team.last, f = team.form;
  const lastRate = l.gp ? l[side] / l.gp : (side === 'gf' ? team.leagueAvg : team.leagueAvg);
  const seasonRate = (s[side] + V3.LAST_SEASON_GAMES * lastRate) / (s.gp + V3.LAST_SEASON_GAMES);
  const formActual = f[side] / f.n;
  const formRate = mix(formActual, f[x] != null ? f[x] / f.n : null);
  return V3.SEASON_WEIGHT * seasonRate + V3.FORM_WEIGHT * formRate;
}

export function v3(home, away, { xg = false } = {}) {
  const rel = (team, side) => rate(team, side, xg) / team.leagueAvg; // vs own league average
  const lsH = LEAGUE_STRENGTH[home.league] ?? 1;
  const lsA = LEAGUE_STRENGTH[away.league] ?? 1;
  const baseAvg = (home.leagueAvg + away.leagueAvg) / 2;

  let lamH = baseAvg * rel(home, 'gf') * rel(away, 'ga') * V3.HOME;
  let lamA = baseAvg * rel(away, 'gf') * rel(home, 'ga') * V3.AWAY;
  // cross-league scaling by ratio of league-strength factors
  lamH *= lsH / lsA;
  lamA *= lsA / lsH;

  const m = markets(lamH, lamA);
  const [bh, bd, ba] = V3.BASE_RATES, k = V3.BASE_BLEND;
  const blended = {
    home: (1 - k) * m.home + k * bh,
    draw: (1 - k) * m.draw + k * bd,
    away: (1 - k) * m.away + k * ba,
  };
  const gap = Math.abs(blended.home - blended.away) * 100;
  const drawRisk = gap <= V3.DRAW_RISK_GAP && blended.draw * 100 >= V3.DRAW_RISK_MIN_DRAW;
  return { lambda: { home: lamH, away: lamA }, ...m, ...blended, drawRisk, xg };
}

// ---- picks + grading ----
export function pickOutcome(p) {
  const arr = [['H', p.home], ['D', p.draw], ['A', p.away]];
  arr.sort((a, b) => b[1] - a[1]);
  return arr[0][0];
}

export function bestBet(m) {
  const opts = [
    ['Over 2.5 goals', m.over25], ['Under 2.5 goals', m.under25],
    ['Both teams to score: Yes', m.bttsYes], ['Both teams to score: No', m.bttsNo],
  ];
  opts.sort((a, b) => b[1] - a[1]);
  return { pick: opts[0][0], p: opts[0][1] };
}

// final: { h, a }. pred: output of v2()/v3().
export function grade(pred, final) {
  const outcome = final.h > final.a ? 'H' : final.h === final.a ? 'D' : 'A';
  const actual = [outcome === 'H' ? 1 : 0, outcome === 'D' ? 1 : 0, outcome === 'A' ? 1 : 0];
  const probs = [pred.home, pred.draw, pred.away];
  const brier = probs.reduce((s, p, i) => s + (p - actual[i]) ** 2, 0);
  const goals = final.h + final.a;
  const ou = pred.over25 >= 0.5 ? 'O' : 'U';
  const btts = pred.bttsYes >= 0.5 ? 'Y' : 'N';
  return {
    outcome,
    outcomeHit: pickOutcome(pred) === outcome,
    ouHit: ou === (goals >= 3 ? 'O' : 'U'),
    bttsHit: btts === (final.h > 0 && final.a > 0 ? 'Y' : 'N'),
    brier,
  };
}
