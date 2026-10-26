// Models against the market on history: v4, v5 and the v6 score card next to the market's average pre-match price, 2019-2026.
// Data: github.com/xgabora/Club-Football-Match-Data-2000-2025 (built from football-data.co.uk; average 1X2 and Over/Under 2.5 prices,
// not closing prices). Ratings are refit every week on earlier games only. Blend weights are chosen on games before July 2023 and
// scored on July 2023 to September 2026. Result on Oct 26, 2026: docs/odds-history-2026-10-26.md.
// Closing-price test: the football-data.co.uk season files (E0 E1 SP1 I1 D1 F1 N1, 2023/24 to 2026/27) add Pinnacle's and the market
// average's pre-match and closing prices. Every pick is bet at the average pre-match price and judged against both closing prices:
// closing-line value (did the pick's chance, margin removed, go up by kickoff?) and the return the closing price says the bet was worth.
// Games in those files that the xgabora copy lacks (the newest weeks) are added to the history.
// Run: node tools/backtest-odds.mjs [dir]  (downloads a 45 MB file from raw.githubusercontent.com and 28 files from football-data.co.uk,
// kept in dir, default $TMPDIR/football-data; a file already in dir is read instead of downloaded; about 10 seconds after that)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { V4, fit, grid } from '../src/v4core.js';
import { eloRun, predict5 } from '../src/v5core.js';
import { scoreCard } from '../src/v6core.js';
const DAY = 86400000, DIV = { E0: 'eng.1', E1: 'eng.2', SP1: 'esp.1', SP2: 'esp.2', I1: 'ita.1', D1: 'ger.1', D2: 'ger.2', F1: 'fra.1', N1: 'ned.1' };
const res0 = await fetch('https://raw.githubusercontent.com/xgabora/Club-Football-Match-Data-2000-2025/main/data/Matches.csv');
if (!res0.ok) throw new Error(`download failed: ${res0.status}`);
const lines = (await res0.text()).split(/\r?\n/), H = lines[0].split(','), ix = k => H.indexOf(k), G = [];
for (const ln of lines.slice(1)) {
  const c = ln.split(','), lg = DIV[c[ix('Division')]]; if (!lg) continue;
  const d = Math.floor(Date.parse(c[ix('MatchDate')]) / DAY), n = k => (c[ix(k)] === '' ? null : +c[ix(k)]);
  if (!(d >= Date.parse('2016-07-01') / DAY) || n('FTHome') == null) continue;
  G.push({ lg, d, h: c[ix('HomeTeam')], a: c[ix('AwayTeam')], hg: n('FTHome'), ag: n('FTAway'), odds: [n('OddHome'), n('OddDraw'), n('OddAway')], ou: n('Over25') && n('Under25') ? [n('Over25'), n('Under25')] : null });
}
// The football-data.co.uk season files: closing prices for the games above, and any game the xgabora copy does not have yet.
const FD = { E0: 'eng.1', E1: 'eng.2', SP1: 'esp.1', I1: 'ita.1', D1: 'ger.1', F1: 'fra.1', N1: 'ned.1' }, SEASONS = ['2324', '2425', '2526', '2627'];
const dir = process.argv[2] || join(tmpdir(), 'football-data'), miss = [], byTeams = new Map(); mkdirSync(dir, { recursive: true });
for (const g of G) { const k = `${g.lg}|${g.h}|${g.a}`; if (!byTeams.has(k)) byTeams.set(k, []); byTeams.get(k).push(g); }
for (const ss of SEASONS) for (const [dv, lg] of Object.entries(FD)) {
  const f = join(dir, `${ss}_${dv}.csv`);
  if (!existsSync(f)) {
    const r = await fetch(`https://www.football-data.co.uk/mmz4281/${ss}/${dv}.csv`).catch(e => ({ ok: false, status: e.message }));
    if (!r.ok) { miss.push(`${ss}/${dv} (${r.status})`); continue; }
    writeFileSync(f, Buffer.from(await r.arrayBuffer()));
  }
  const rows = readFileSync(f, 'latin1').replace(/^\uFEFF/, '').split(/\r?\n/), K = rows[0].split(','), at = k => K.indexOf(k);
  for (const ln of rows.slice(1)) {
    const c = ln.split(','), n = k => (at(k) < 0 || c[at(k)] === '' || c[at(k)] == null ? null : +c[at(k)]), tri = (a, b, e) => { const t = [n(a), n(b), n(e)]; return t.every(x => x > 1) ? t : null; };
    const pr = (a, b) => (n(a) > 1 && n(b) > 1 ? [n(a), n(b)] : null), dm = (c[at('Date')] || '').split('/');
    if (dm.length !== 3 || n('FTHG') == null || n('FTAG') == null) continue;
    const d = Math.floor(Date.UTC(dm[2].length === 2 ? 2000 + +dm[2] : +dm[2], dm[1] - 1, +dm[0]) / DAY), h = c[at('HomeTeam')], a = c[at('AwayTeam')];
    const cl = { ps: tri('PSH', 'PSD', 'PSA'), psc: tri('PSCH', 'PSCD', 'PSCA'), av: tri('AvgH', 'AvgD', 'AvgA'), avc: tri('AvgCH', 'AvgCD', 'AvgCA'),
      ou: { ps: pr('P>2.5', 'P<2.5'), psc: pr('PC>2.5', 'PC<2.5'), av: pr('Avg>2.5', 'Avg<2.5'), avc: pr('AvgC>2.5', 'AvgC<2.5') } };
    const g = (byTeams.get(`${lg}|${h}|${a}`) || []).find(x => Math.abs(x.d - d) <= 3);
    if (g) g.cl = cl; else if (cl.av) G.push({ lg, d, h, a, hg: n('FTHG'), ag: n('FTAG'), odds: cl.av, ou: cl.ou.av, cl });
  }
}
if (miss.length) throw new Error(`football-data.co.uk download failed for ${miss.join(', ')}; put the files in ${dir} as <season>_<div>.csv (e.g. 2324_E0.csv)`);
G.sort((x, y) => x.d - y.d);
const lgt = p => Math.log(p / (1 - p)), sg = x => 1 / (1 + Math.exp(-x)), recs = [], start = Math.floor(Date.parse('2019-07-01') / DAY);
for (const lg of Object.values(DIV)) {
  const L = G.filter(g => g.lg === lg); let warm = null;
  for (let wk = start; wk <= L[L.length - 1].d; wk += 7) {
    const test = L.filter(g => g.d >= wk && g.d < wk + 7 && g.odds.every(x => x > 1)); if (!test.length) continue;
    const train = L.filter(g => g.d < wk), R = fit(lg, train, wk * DAY, warm), E = eloRun(train);
    warm = Object.fromEntries(Object.entries(R.t).map(([k, v]) => [k, [v[0], v[1]]]));
    for (const g of test) {
      const th = R.t[g.h], ta = R.t[g.a]; if (!th || !ta || th[2] < V4.MIN_GAMES || ta[2] < V4.MIN_GAMES) continue;
      const lh = R.muH * th[0] * ta[1], la = R.muA * ta[0] * th[1], q = grid(lh, la, false), pull = (raw, i) => sg(lgt(R.base[i]) + V4.CAL_SLOPE * (lgt(raw) - lgt(R.mean[i])));
      const p4 = { home: q.home, draw: q.draw, away: q.away, over25: pull(q.over25, 0), bttsYes: pull(q.bttsYes, 1), lambda: { home: lh, away: la }, topScores: [] }, p5 = predict5(p4, E, g.h, g.a);
      if (p5) recs.push({ ...g, v4: [p4.home, p4.draw, p4.away], v4o: p4.over25, v4b: p4.bttsYes, v5: [p5.home, p5.draw, p5.away] });
    }
  }
}
const cut = Date.parse('2023-07-01') / DAY, tune = recs.filter(r => r.d < cut), test = recs.filter(r => r.d >= cut);
const nrm = p => { const s = p[0] + p[1] + p[2]; return p.map(x => x / s); }, mk = r => nrm(r.odds.map(o => 1 / o)), res = r => (r.hg > r.ag ? 0 : r.hg === r.ag ? 1 : 2);
const am = d => (d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1)));
const score = (rs, f) => { const per = rs.map(r => { const p = nrm(f(r)), o = res(r); return { ll: -Math.log(Math.max(1e-9, p[o])), rps: ((p[0] - (o === 0)) ** 2 + (p[0] + p[1] - (o <= 1)) ** 2) / 2 }; }); return { per, ll: per.reduce((s, x) => s + x.ll, 0) / per.length, rps: per.reduce((s, x) => s + x.rps, 0) / per.length }; };
const zOf = (a, b) => { const d = a.per.map((x, i) => x.ll - b.per[i].ll), n = d.length, mu = d.reduce((s, x) => s + x, 0) / n, sd = Math.sqrt(d.reduce((s, x) => s + (x - mu) ** 2, 0) / (n - 1)); return { gain: +mu.toFixed(4), z: +(mu / (sd / Math.sqrt(n))).toFixed(1) }; };
const r4 = x => +x.toFixed(4), M = score(test, mk), A4 = score(test, r => r.v4), A5 = score(test, r => r.v5);
const share = m => { const blend = (r, w) => mk(r).map((x, i) => Math.exp((1 - w) * Math.log(x) + w * Math.log(Math.max(1e-6, r[m][i])))); return [0, 0.05, 0.1, 0.2, 0.3].map(w => [w, score(tune, r => blend(r, w)).ll]).sort((a, b) => a[1] - b[1])[0][0]; };
const value = m => { let n = 0, u = 0; for (const r of test) { const q = mk(r), p = nrm(r[m]), e = p.map((x, i) => x - q[i]), i = e.indexOf(Math.max(...e)); if (e[i] >= 0.05) { n++; u += res(r) === i ? r.odds[i] - 1 : -1; } } return { bets: n, units: +u.toFixed(1), roi: +(100 * u / n).toFixed(1) }; };
const bl = (p, y) => -Math.log(Math.max(1e-9, y ? p : 1 - p)), ov = r => r.hg + r.ag >= 3, bt = r => r.hg > 0 && r.ag > 0, TO = test.filter(r => r.ou);
const pO = tune.filter(ov).length / tune.length, pB = tune.filter(bt).length / tune.length, s = { om: 0, o6: 0, o4: 0, ob: 0, b6: 0, b4: 0, bb: 0 };
for (const r of TO) {
  const card = scoreCard({ h: am(r.odds[0]), d: am(r.odds[1]), a: am(r.odds[2]), tl: 2.5, to: am(r.ou[0]), tu: am(r.ou[1]) }), mo = (1 / r.ou[0]) / (1 / r.ou[0] + 1 / r.ou[1]);
  s.om += bl(mo, ov(r)); s.o6 += bl(card.over25, ov(r)); s.o4 += bl(r.v4o, ov(r)); s.ob += bl(pO, ov(r)); s.b6 += bl(card.bttsYes, bt(r)); s.b4 += bl(r.v4b, bt(r)); s.bb += bl(pB, bt(r));
}
const n = TO.length;
// Closing prices. Picks are bet at the average pre-match price. clv: the pick's chance (margin removed) at the close over the same
// book's pre-match chance, minus 1 (the app's closing-line value). ev: the bet price times the closing chance, minus 1 (what the close
// says the bet was worth: far less noisy than the result). roi: what the bet actually returned. z: the mean over its standard error.
const mz = xs => { const k = xs.length, mu = xs.reduce((a, x) => a + x, 0) / k, sd = Math.sqrt(xs.reduce((a, x) => a + (x - mu) ** 2, 0) / (k - 1)); return { avg: +(100 * mu).toFixed(2), z: +(mu / (sd / Math.sqrt(k))).toFixed(1) }; };
const C = test.filter(r => r.cl && r.cl.ps && r.cl.psc && r.cl.av && r.cl.avc), fair = o => nrm(o.map(x => 1 / x)), fair2 = o => { const t = 1 / o[0] + 1 / o[1]; return [1 / o[0] / t, 1 / o[1] / t]; };
const judge = bets => { // bets: [{ i, bet, won, pre: { ps, av }, cl: { psc, avc } }] with chances, not prices, in pre and cl
  if (!bets.length) return { bets: 0 };
  const v = k => bets.map(b => b.cl[k] / b.pre[k === 'psc' ? 'ps' : 'av'] - 1), e = k => bets.map(b => b.bet * b.cl[k] - 1), cv = v('psc');
  return { bets: bets.length, roi: +(100 * bets.reduce((a, b) => a + (b.won ? b.bet - 1 : -1), 0) / bets.length).toFixed(1), beatPinnacleClose: +(100 * cv.filter(x => x > 0).length / cv.length).toFixed(1),
    clv: { pinnacle: mz(cv), average: mz(v('avc')) }, ev: { pinnacleClose: mz(e('psc')), averageClose: mz(e('avc')) } };
};
const pick1x2 = rule => C.flatMap(r => { const i = rule(r); if (i == null) return []; const F = k => fair(r.cl[k])[i];
  return [{ i, bet: r.cl.av[i], won: res(r) === i, pre: { ps: F('ps'), av: F('av') }, cl: { psc: F('psc'), avc: F('avc') } }]; });
const over = (p, q, rule) => p - q >= 0.05 && p >= rule; // Edges-tab rule: the model 55%+ and 5+ points over the price
const edgeIx = (r, m, lo = 0) => { const q = mk(r), p = nrm(r[m]), e = p.map((x, i) => x - q[i]), i = e.indexOf(Math.max(...e)); return over(p[i], q[i], lo) ? i : null; };
const CO = test.filter(r => r.cl && r.cl.ou.ps && r.cl.ou.psc && r.cl.ou.av && r.cl.ou.avc), ouBets = CO.flatMap(r => {
  const q = fair2(r.cl.ou.av)[0], j = over(r.v4o, q, 0.55) ? 0 : over(1 - r.v4o, 1 - q, 0.55) ? 1 : null; if (j == null) return [];
  const F = k => fair2(r.cl.ou[k])[j]; return [{ i: j, bet: r.cl.ou.av[j], won: (r.hg + r.ag >= 3) === (j === 0), pre: { ps: F('ps'), av: F('av') }, cl: { psc: F('psc'), avc: F('avc') } }]; });
const SC = { avgPre: score(C, r => fair(r.cl.av)), pinnaclePre: score(C, r => fair(r.cl.ps)), avgClose: score(C, r => fair(r.cl.avc)), pinnacleClose: score(C, r => fair(r.cl.psc)), v4: score(C, r => r.v4), v5: score(C, r => r.v5) };
const shareC = m => [0, 0.05, 0.1, 0.2, 0.3].map(w => [w, score(C, r => fair(r.cl.psc).map((x, i) => Math.exp((1 - w) * Math.log(x) + w * Math.log(Math.max(1e-6, r[m][i]))))).ll]).sort((a, b) => a[1] - b[1])[0][0];
const closing = { games: C.length, from: new Date(C[0].d * DAY).toISOString().slice(0, 10), to: new Date(C[C.length - 1].d * DAY).toISOString().slice(0, 10),
  winner: Object.fromEntries(Object.entries(SC).map(([k, x]) => [k, { ll: r4(x.ll), rps: r4(x.rps) }])), pinnacleCloseOverV4: zOf(SC.v4, SC.pinnacleClose), pinnacleCloseOverAvgPre: zOf(SC.avgPre, SC.pinnacleClose),
  bestModelShareInPinnacleClose: { v4: shareC('v4'), v5: shareC('v5'), note: 'chosen on the same games: an upper bound' },
  picks: { marketFavourite: judge(pick1x2(r => { const q = mk(r); return q.indexOf(Math.max(...q)); })), v4Winner: judge(pick1x2(r => { const p = r.v4; return p.indexOf(Math.max(...p)); })),
    v5Winner: judge(pick1x2(r => { const p = r.v5; return p.indexOf(Math.max(...p)); })), v4Value5pts: judge(pick1x2(r => edgeIx(r, 'v4'))), v5Value5pts: judge(pick1x2(r => edgeIx(r, 'v5'))),
    edgesTabWinner: judge(pick1x2(r => edgeIx(r, 'v4', 0.55))), edgesTabOverUnder25: judge(ouBets) } };
console.log(JSON.stringify({ testGames: test.length, winner: { market: { ll: r4(M.ll), rps: r4(M.rps) }, v4: { ll: r4(A4.ll), rps: r4(A4.rps) }, v5: { ll: r4(A5.ll), rps: r4(A5.rps) }, marketOverV4: zOf(A4, M), v5OverV4: zOf(A4, A5) },
  bestModelShareInScoreCard: { v4: share('v4'), v5: share('v5') }, valueBets5pts: { v4: value('v4'), v5: value('v5') },
  over25: { marketPrice: r4(s.om / n), scoreCard: r4(s.o6 / n), v4: r4(s.o4 / n), baseRate: r4(s.ob / n) }, btts: { scoreCard: r4(s.b6 / n), v4: r4(s.b4 / n), baseRate: r4(s.bb / n) }, closing }, null, 1));
