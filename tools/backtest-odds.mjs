// Models against the market on history: v4, v5 and the v6 score card next to the market's average pre-match price, 2019-2026.
// Data: github.com/xgabora/Club-Football-Match-Data-2000-2025 (built from football-data.co.uk; average 1X2 and Over/Under 2.5 prices,
// not closing prices). Ratings are refit every week on earlier games only. Blend weights are chosen on games before July 2023 and
// scored on July 2023 to September 2026. Result on Oct 26, 2026: docs/odds-history-2026-10-26.md.
// Run: node tools/backtest-odds.mjs  (downloads a 45 MB file from raw.githubusercontent.com; about 10 seconds after that)
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
console.log(JSON.stringify({ testGames: test.length, winner: { market: { ll: r4(M.ll), rps: r4(M.rps) }, v4: { ll: r4(A4.ll), rps: r4(A4.rps) }, v5: { ll: r4(A5.ll), rps: r4(A5.rps) }, marketOverV4: zOf(A4, M), v5OverV4: zOf(A4, A5) },
  bestModelShareInScoreCard: { v4: share('v4'), v5: share('v5') }, valueBets5pts: { v4: value('v4'), v5: value('v5') },
  over25: { marketPrice: r4(s.om / n), scoreCard: r4(s.o6 / n), v4: r4(s.o4 / n), baseRate: r4(s.ob / n) }, btts: { scoreCard: r4(s.b6 / n), v4: r4(s.b4 / n), baseRate: r4(s.bb / n) } }, null, 1));
