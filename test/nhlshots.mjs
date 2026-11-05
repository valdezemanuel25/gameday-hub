// Hockey shots + goalie read (src/nhlshots.js, tracking only): the read, the goalie's effect, adding graded games from ESPN's summary,
// and the card's read (src/nhl.js setSg).
import { getShots, readOf, svOf, addGame, goaliesFromSummary, SG } from '../src/nhlshots.js';
import { setSg } from '../src/nhl.js';
import SEED from '../src/nhlshotseed.js';
let bad = 0; const ok = (n, c, x = '') => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (c ? '' : ' ' + x)); if (!c) bad++; };
const env = { HUB: { get: async () => null, put: async () => {} } };
const S = await getShots(env);
ok('seed: 32 clubs with 10 games each, the league totals and the fitted weights for 5.5 and 6.5', Object.keys(S.teams).length === 32 && Object.values(S.teams).every(L => L.length === 10) && S.lsa > 200000 && SG.weights['5.5'].length === 5 && SG.weights['6.5'].length === 5);
const r = readOf(S, 'BOS', 'TOR', null, null);
ok('read: Over 5.5 and 6.5 chances in a sensible range, Over 5.5 above Over 6.5', r && r.p['5.5'] > 35 && r.p['5.5'] < 80 && r.p['6.5'] > 20 && r.p['6.5'] < r.p['5.5'], JSON.stringify(r));
// a poor goalie (10% of shots go in) against a good one (5%), same games
const T = JSON.parse(JSON.stringify(S)); T.goalies.poor = [2000, 200]; T.goalies.good = [2000, 100];
const poor = readOf(T, 'BOS', 'TOR', 'poor', 'poor'), good = readOf(T, 'BOS', 'TOR', 'good', 'good');
ok('goalie: two poor starters read higher on Over than two good ones; an unknown goalie counts as league average', poor.p['5.5'] > good.p['5.5'] + 1 && Math.abs(svOf(T, 'nobody') - (1 - T.lga / T.lsa)) < 1e-9, `${poor.p['5.5']} v ${good.p['5.5']}`);
ok('read: a club with too few games gives no read', readOf({ ...S, teams: { ...S.teams, BOS: S.teams.BOS.slice(0, 3) } }, 'BOS', 'TOR') === null);
// ESPN summary shape: boxscore.players[].statistics[] with a goalies group
const goalie = (id, sa, ga, toi) => ({ athlete: { id, displayName: 'G' + id }, stats: [String(ga), String(sa), '0', '0', String(sa - ga), '.900', '0', '0', '0', toi, '0', '0'] });
const summary = (h, a) => ({ boxscore: { players: [
  { team: { abbreviation: 'TB' }, statistics: [{ name: 'goalies', labels: ['GA', 'SA', 'SOS', 'SOSA', 'SV', 'SV%', 'ESSV', 'PPSV', 'SHSV', 'TOI', 'YTDG', 'PIM'], athletes: h }] },
  { team: { abbreviation: 'FLA' }, statistics: [{ name: 'goalies', labels: ['GA', 'SA', 'SOS', 'SOSA', 'SV', 'SV%', 'ESSV', 'PPSV', 'SHSV', 'TOI', 'YTDG', 'PIM'], athletes: a }] }] } });
const j = summary([goalie('g1', 30, 3, '60:00')], [goalie('g2', 20, 1, '40:00'), goalie('g3', 8, 1, '19:00')]);
const G = goaliesFromSummary(j);
ok('summary: team codes as the Hub writes them (TB -> TBL), starter = most ice time, both goalies counted for the team', G.TBL && G.TBL.st.id === 'g1' && G.FLA.st.id === 'g2' && G.FLA.sa === 28 && G.FLA.ga === 2, JSON.stringify(G));
const U = JSON.parse(JSON.stringify(S)), before = U.lsa;
ok('add: a game at or before the seed\'s last kickoff is skipped', addGame(U, 'x0', SEED.last, 'TBL', 'FLA', 2, 3, j) === false);
ok('add: a later game goes in: rows for both clubs (shots on goal = the other side\'s goalies\' shots faced), the starters and the league totals',
  addGame(U, 'x1', '2026-11-05T00:00Z', 'TBL', 'FLA', 2, 3, j) && U.teams.TBL.at(-1).join() === '2,3,28,30' && U.teams.FLA.at(-1).join() === '3,2,30,28' && U.teams.TBL.length === 10 && U.goalies.g1.join() === '30,3' && U.goalies.g2.join() === '20,1' && U.lsa === before + 58);
ok('add: the same game twice is skipped', addGame(U, 'x1', '2026-11-05T00:00Z', 'TBL', 'FLA', 2, 3, j) === false);
// the card's read
const c = { id: 'c1', hAbbr: 'BOS', aAbbr: 'TOR', kickoff: '2026-11-08T00:00Z', final: null, gk: { h: { n: 'A', id: '4697394', st: 'e' }, a: { n: 'B', id: '3069285', st: 'e' } } };
const now = new Date('2026-11-07T18:00:00Z');
ok('card: the read is set with the listed goalies and their status', setSg(S, c, now) && c.sg.p['5.5'] && c.sg.gs.join() === 'e,e' && !c.sg.cl);
ok('card: nothing changed, nothing written', setSg(S, c, new Date('2026-11-07T19:00:00Z')) === false);
c.gk.h.st = 'c'; c.gk.a.st = 'c';
ok('card: at the lineup read with confirmed goalies the read is marked as the closing one', setSg(S, c, new Date('2026-11-07T23:35:00Z'), true) && c.sg.cl === 1 && c.sg.gs.join() === 'c,c');
ok('card: a finished game is left alone', setSg(S, { ...c, final: { h: 1, a: 2 } }, now) === false);
// --- the read at any total line (Nov 5, 2026): page-side, estimated through the goals average ---
{ const h = (await import('node:fs')).readFileSync(new URL('../public/nhl.html', import.meta.url), 'utf8');
  const a = h.indexOf('function pTot('), b = h.indexOf('function sgRow(');
  const F = new Function(h.slice(a, b) + '; return { pTot, lamAt, sgAt };')();
  const pois = (lam, k) => { let t = Math.exp(-lam), c = t; for (let i = 1; i <= k; i++) { t *= lam / i; c += t; } return c; };
  ok('totals: Poisson Over 5.5', Math.abs(F.pTot(6, 5.5) - (1 - pois(6, 5))) < 1e-12);
  ok('totals: a whole line leaves the push out', Math.abs(F.pTot(6, 6) - (1 - pois(6, 6)) / (1 - (pois(6, 6) - pois(6, 5)))) < 1e-12);
  const s = { p: { '5.5': 55, '6.5': 38 } };
  ok('totals: the fitted lines are read as they are', F.sgAt(s, 5.5).p === 55 && !F.sgAt(s, 5.5).est && F.sgAt(s, '6.5').p === 38);
  const s6 = F.sgAt(s, 6), s75 = F.sgAt(s, 7.5), s45 = F.sgAt(s, 4.5);
  ok('totals: other lines are estimated and fall in order (4.5 > 5.5 > 6 > 6.5 > 7.5)', s6.est && s45.p > 55 && 55 > s6.p && s6.p > 38 && 38 > s75.p, JSON.stringify([s45.p, s6.p, s75.p]));
  ok('totals: a read carried back to its own line gives itself', Math.abs(100 * F.pTot(F.lamAt(0.55, 5.5), 5.5) - 55) < 0.01);
  ok('totals: nothing to read, nothing shown', F.sgAt(null, 6) === null && F.sgAt({ p: {} }, 6) === null); }
console.log(bad ? `\n${bad} FAILED` : '\nAll hockey shots checks passed');
if (bad) process.exit(1);
