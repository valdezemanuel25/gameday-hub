// Shots Over (Nov 3, 2026): a shots-on-target read on Over 2.5 for the Analyst (rule 'shotsOver' in src/analyst.js). Paper test only:
// nothing here feeds v2, v4, v5 or v6.
//
//   Each club's last 8 league games before kickoff (games ESPN gave shots for; 5 needed) from the results store (src/data.js keeps
//   [totalShots, shotsOnTarget] per side). The game's numbers are home attack against away defence plus away attack against home
//   defence: shots on target (sot), goals (gl) and total shots (sh). The read starts from DraftKings' Over chance (margin removed)
//   and moves it with those three, weights fitted on 2024-25 (walk-forward, 7 European leagues, data/football-data):
//       logit(Over) = C + M * logit(price) + S * z(sot) + G * z(gl) + T * z(sh)
//   It bets Over when the read is EDGE+ points above the price. At Bet365's closing price: 2024-25 128 bets +6.5%, 2025-26 to Nov
//   2026 58 bets +7.0% (that period was not used to fit). The games it picks: Over already favoured (about 57%) and clubs that
//   shoot less than usual but more accurately (38% of shots on target vs 34%). Tested only on LEAGUES.
export const SHOTS = { C: -0.0442, M: 1.1388, S: 0.0483, G: 0.0188, T: -0.1384,
  mean: { sot: 8.626, gl: 2.787, sh: 24.84 }, sd: { sot: 1.123, gl: 0.516, sh: 2.104 }, N: 8, MIN: 5, EDGE: 3 };
export const LEAGUES = new Set(['eng.1', 'eng.2', 'ger.1', 'esp.1', 'ita.1', 'fra.1', 'ned.1']);
// Tracking only (Nov 3, 2026): the shots numbers are saved on these cards next to DraftKings' Over/Under price, but no read is shown and
// the Analyst never bets them. In an ESPN backtest (2023 to Nov 2026, fit before 2025, tested after) shots helped predict Over 2.5 in
// MLS (shots pushing Over up 3+ points: 72% went Over vs 60% expected, 166 games) and a little in Liga MX (56% vs 53%); in the
// Brasileirão they made it worse, so it is left out. There are no past prices for these leagues, so the rule waits for a few hundred
// priced games here to be refit on.
export const WATCH = new Set(['usa.1', 'mex.1']);
const r2 = x => Math.round(100 * x) / 100;

// One club's averages over its last N league games with shots before iso. recent rows: [iso, gf, ga, shF, sotF, shA, sotA]
// (older rows have only [iso, gf, ga] and are skipped). -> { n, gf, ga, shF, sotF, shA, sotA } | null
export function shotsAt(team, iso) {
  const t = new Date(iso).getTime();
  const g = (team && team.recent || []).filter(x => x.length >= 7 && x.slice(3, 7).every(Number.isFinite) && new Date(x[0]).getTime() < t).slice(-SHOTS.N);
  if (g.length < SHOTS.MIN) return null;
  const m = i => g.reduce((s, x) => s + x[i], 0) / g.length;
  return { n: g.length, gf: m(1), ga: m(2), shF: m(3), sotF: m(4), shA: m(5), sotA: m(6) };
}
// The game's numbers from both clubs' averages. -> { sot, gl, sh, n } (n = the fewer games of the two) | null
export function matchup(h, a) {
  if (!h || !a) return null;
  return { sot: r2((h.sotF + a.sotA) / 2 + (a.sotF + h.sotA) / 2), gl: r2((h.gf + a.ga) / 2 + (a.gf + h.ga) / 2), sh: r2((h.shF + a.shA) / 2 + (a.shF + h.shA) / 2), n: Math.min(h.n, a.n) };
}
// The shots read on Over 2.5, in %, from the price's Over % (margin removed) and the game's numbers.
export function shotsOver(priceOver, sx) {
  const p = Math.min(99, Math.max(1, priceOver)) / 100, z = k => (sx[k] - SHOTS.mean[k]) / SHOTS.sd[k];
  const x = SHOTS.C + SHOTS.M * Math.log(p / (1 - p)) + SHOTS.S * z('sot') + SHOTS.G * z('gl') + SHOTS.T * z('sh');
  return 100 / (1 + Math.exp(-x));
}
