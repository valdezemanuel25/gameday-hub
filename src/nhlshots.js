// Hockey shots + goalie read (Nov 3, 2026): TRACKING ONLY. It never feeds v2, v4, v5, a pick, Model bets or the Analyst.
//
//   The read on Over 5.5 and Over 6.5 from four numbers, each against the league (ESPN backtest, 2023-24 to Nov 2026, fitted on 2023-25,
//   tested on 1,495 games from 2025-26 on):
//     lg  = the league's goals a game over its last 300 games
//     gl  = both clubs' recent goals for and against (last 10 games each), minus lg
//     sog = both clubs' recent shots on goal for and against, minus the league's shots a game
//     gk  = goals the two starting goalies let in over a league-average goalie on the shots expected against them (each goalie's
//           save % from every start the Hub has, pulled toward the league's with K shots)
//   logit(Over) = w0 + w1 z(lg) + w2 z(gl) + w3 z(sog) + w4 z(gk), weights per line. Test log loss: Over 5.5 0.679 (league level only
//   0.682), Over 6.5 0.691 (0.694). When the goalie moved the read 3+ points up, Over hit 70% vs 56% expected (10 games, 5.5). Small
//   samples and no hockey price history: the Hub saves this read next to DraftKings' line and price so it can be tested on prices later.
//
//   Data: KV 'nhl:shots', started from src/nhlshotseed.js and added to as each game is graded (ESPN's game summary: each goalie's shots
//   faced and goals against; a club's shots on goal = the other side's goalies' shots faced).
import SEED from './nhlshotseed.js';
import { code } from './nhl.js';

export const SG = { stats: SEED.stats, weights: SEED.weights, K: SEED.K, N: SEED.N, MIN: SEED.MIN };
export const SG_LINES = ['5.5', '6.5'];
const KEY = 'nhl:shots', RECENT = 300, KEEP_IDS = 600;
const fresh = () => ({ v: 1, teams: JSON.parse(JSON.stringify(SEED.teams)), goalies: JSON.parse(JSON.stringify(SEED.goalies)), recent: SEED.recent.slice(),
  lsa: SEED.lsa, lga: SEED.lga, last: SEED.last, applied: [] });
export async function getShots(env) { const s = await env.HUB.get(KEY, 'json'); return s && s.v === 1 ? s : fresh(); }
export const saveShots = (env, S) => env.HUB.put(KEY, JSON.stringify(S));

// A goalie's save %, pulled toward the league's: (goals against + K x league rate) / (shots faced + K). Unknown goalie = league average.
export function svOf(S, id) {
  const lsv = 1 - S.lga / S.lsa, g = (id && S.goalies[id]) || [0, 0];
  return 1 - (g[1] + SG.K * (1 - lsv)) / (g[0] + SG.K);
}
const form = (S, team) => {
  const L = (S.teams[team] || []).slice(-SG.N); if (L.length < SG.MIN) return null;
  const m = i => L.reduce((s, x) => s + x[i], 0) / L.length; return { gf: m(0), ga: m(1), sf: m(2), sa: m(3) };
};
const r1 = x => Math.round(10 * x) / 10, r3 = x => Math.round(1000 * x) / 1000;
// The read for one game. gh / ga: ESPN athlete ids of the starting goalies (or null). -> { p: { '5.5': %, '6.5': % }, lg, gl, sog, gk, gkn } | null
export function readOf(S, home, away, gh, ga) {
  const fh = form(S, home), fa = form(S, away), R = S.recent.slice(-RECENT);
  if (!fh || !fa || R.length < 150) return null;
  const lg = R.reduce((s, x) => s + x[0], 0) / R.length, ls = R.reduce((s, x) => s + x[1], 0) / R.length, lsv = 1 - S.lga / S.lsa;
  const shH = (fh.sf + fa.sa) / 2, shA = (fa.sf + fh.sa) / 2;
  const x = { lg, gl: (fh.gf + fa.ga) / 2 + (fa.gf + fh.ga) / 2 - lg, sog: shH + shA - ls, gk: shA * (lsv - svOf(S, gh)) + shH * (lsv - svOf(S, ga)) };
  const z = k => (x[k] - SG.stats[k][0]) / SG.stats[k][1], p = {};
  for (const line of SG_LINES) { const w = SG.weights[line]; p[line] = r1(100 / (1 + Math.exp(-(w[0] + w[1] * z('lg') + w[2] * z('gl') + w[3] * z('sog') + w[4] * z('gk'))))); }
  // gkn: how many shots each starter's save % rests on (0 = not known to the Hub, so treated as league average)
  return { p, lg: r3(lg), gl: r3(x.gl), sog: r3(x.sog), gk: r3(x.gk), gkn: [gh && S.goalies[gh] ? S.goalies[gh][0] : 0, ga && S.goalies[ga] ? S.goalies[ga][0] : 0] };
}

// Each side's goalies from ESPN's game summary: { [team code]: { st: { id, sa, ga }, sa, ga } } (st = the goalie with the most ice time).
export function goaliesFromSummary(j) {
  const out = {}, toi = s => { const [m, x] = String(s || '0:0').split(':').map(Number); return (m || 0) * 60 + (x || 0); };
  for (const t of (j && j.boxscore && j.boxscore.players) || []) {
    const grp = (t.statistics || []).find(x => x.name === 'goalies'); if (!grp || !t.team) continue;
    const lab = grp.labels || [], ix = n => lab.indexOf(n);
    const G = (grp.athletes || []).map(a => ({ id: a.athlete && a.athlete.id != null ? String(a.athlete.id) : null, sa: Number(a.stats[ix('SA')]), ga: Number(a.stats[ix('GA')]), toi: toi(a.stats[ix('TOI')]) }))
      .filter(g => Number.isFinite(g.sa) && Number.isFinite(g.ga));
    if (!G.length) continue; G.sort((a, b) => b.toi - a.toi);
    out[code(t.team.abbreviation)] = { st: G[0], sa: G.reduce((s, g) => s + g.sa, 0), ga: G.reduce((s, g) => s + g.ga, 0) };
  }
  return out;
}
// Add one finished game (home / away codes, final score as ESPN gives it, its summary). Games up to the seed's last kickoff, or already
// added, are skipped. -> true when added
export function addGame(S, id, kickoff, home, away, hs, as, summary) {
  if (!kickoff || kickoff <= S.last || S.applied.includes(id)) return false;
  const G = goaliesFromSummary(summary), H = G[home], A = G[away]; if (!H || !A) return false;
  const hsf = A.sa, asf = H.sa; // shots on goal for = the other side's goalies' shots faced
  const push = (t, row) => { const L = S.teams[t] || (S.teams[t] = []); L.push(row); if (L.length > SG.N) L.splice(0, L.length - SG.N); };
  push(home, [hs, as, hsf, asf]); push(away, [as, hs, asf, hsf]);
  S.recent.push([hs + as, hsf + asf]); if (S.recent.length > RECENT) S.recent.splice(0, S.recent.length - RECENT);
  for (const s of [H, A]) { S.lsa += s.sa; S.lga += s.ga; if (s.st.id) { const g = S.goalies[s.st.id] || (S.goalies[s.st.id] = [0, 0]); g[0] += s.st.sa; g[1] += s.st.ga; } }
  S.applied.push(id); if (S.applied.length > KEEP_IDS) S.applied.splice(0, S.applied.length - KEEP_IDS);
  return true;
}
