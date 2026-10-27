// Walk-forward test of the Analyst's betting rules (src/analyst.js) on the bundled history: v4 is refit every 7 days on the games
// before that week (as in tools/backtest-v4.mjs) and its chances are set against the real opening and closing prices in
// data/football-data (Bet365, the closest of those books to a US retail book's margin). Run: node tools/backtest-analyst.mjs
import fs from 'node:fs';
import seed from '../src/v4seed.js';
import { V4, fit, grid } from '../src/v4core.js';
import { devig } from '../src/v6core.js';
import { RULES, view } from '../src/analyst.js';

const DAY = 86400000, root = new URL('..', import.meta.url).pathname;
const { alias } = JSON.parse(fs.readFileSync(root + 'tools/v4-names.json', 'utf8'));
const FILES = { 'eng.1': 'E0', 'eng.2': 'E1', 'ger.1': 'D1', 'esp.1': 'SP1', 'ita.1': 'I1', 'fra.1': 'F1', 'ned.1': 'N1' };
const toAm = d => (d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1)));
const day = s => { const [d, m, y] = s.split('/').map(Number); return Math.floor(Date.UTC(y < 100 ? 2000 + y : y, m - 1, d) / DAY); };
function prices(code) {
  const m = new Map();
  for (const f of fs.readdirSync(root + 'data/football-data').filter(f => f.endsWith(`_${code}.csv`))) {
    const L = fs.readFileSync(root + 'data/football-data/' + f, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean), H = L[0].split(',');
    for (const l of L.slice(1)) {
      const c = l.split(','), r = Object.fromEntries(H.map((h, i) => [h, c[i]])), n = k => (+r[k] > 1 ? toAm(+r[k]) : NaN);
      const o = { h: n('B365H'), d: n('B365D'), a: n('B365A'), tl: 2.5, to: n('B365>2.5'), tu: n('B365<2.5') }, cl = { h: n('B365CH'), d: n('B365CD'), a: n('B365CA'), tl: 2.5, to: n('B365C>2.5'), tu: n('B365C<2.5') };
      if (!r.Date || !Number.isFinite(o.h) || !Number.isFinite(cl.h)) continue;
      m.set(`${day(r.Date)}|${alias[r.HomeTeam] || r.HomeTeam}|${alias[r.AwayTeam] || r.AwayTeam}`, { op: o, cl });
    }
  }
  return m;
}
// One game as the Analyst sees it at the lineup read: v4's numbers and the opening and closing price.
const games = [];
for (const [slug, code] of Object.entries(FILES)) {
  const s = seed[slug], P = prices(code), G = s.g.map(([d, h, a, hg, ag]) => ({ d, h: s.teams[h], a: s.teams[a], hg, ag })).sort((x, y) => x.d - y.d);
  const first = G[0].d, last = G[G.length - 1].d, start = Math.max(first + 420, last - 330);
  let warm = null;
  for (let wk = start; wk <= last; wk += 7) {
    const test = G.filter(g => g.d >= wk && g.d < wk + 7); if (!test.length) continue;
    const R = fit(slug, G.filter(g => g.d < wk), wk * DAY, warm); warm = Object.fromEntries(Object.entries(R.t).map(([k, v]) => [k, [v[0], v[1]]]));
    for (const g of test) {
      const th = R.t[g.h], ta = R.t[g.a], px = P.get(`${g.d}|${g.h}|${g.a}`); if (!px || !th || !ta || th[2] < V4.MIN_GAMES || ta[2] < V4.MIN_GAMES) continue;
      const q = grid(R.muH * th[0] * ta[1], R.muA * ta[0] * th[1], false);
      games.push({ slug, d: g.d, final: { h: g.hg, a: g.ag }, v4: { p: [q.home, q.draw, q.away].map(x => 100 * x), over: 100 * q.over25 }, op: px.op, cl: px.cl });
    }
  }
}
// Each rule bets 1 unit at the closing price (the latest price the Analyst sees; earlier entries are not in the files).
const won = (k, f) => (k === 'H' ? f.h > f.a : k === 'D' ? f.h === f.a : k === 'A' ? f.h < f.a : k === 'O' ? f.h + f.a >= 3 : f.h + f.a < 3);
const pay = m => (m > 0 ? m / 100 : 100 / -m);
const half = games.map(g => g.d).sort((a, b) => a - b)[games.length >> 1];
const out = {};
for (const r of RULES) {
  const t = [{ n: 0, w: 0, u: 0 }, { n: 0, w: 0, u: 0 }];
  for (const g of games) {
    const V = view({ v4: g.v4, open: g.op, now: g.cl }), b = V && r.pick(V); if (!b) continue;
    const x = t[g.d < half ? 0 : 1], hit = won(b.key, g.final); x.n++; x.w += hit; x.u += hit ? pay(b.price) : -1;
  }
  const f = x => ({ n: x.n, hit: x.n ? +(100 * x.w / x.n).toFixed(1) : null, roi: x.n ? +(100 * x.u / x.n).toFixed(1) : null });
  out[r.id] = { first: f(t[0]), second: f(t[1]), all: f({ n: t[0].n + t[1].n, w: t[0].w + t[1].w, u: t[0].u + t[1].u }) };
}
{ const t = { n: 0, u: 0 }; for (const g of games) { const b = devig(g.cl.h, g.cl.d, g.cl.a), i = b.indexOf(Math.max(...b)), hit = won('HDA'[i], g.final); t.n++; t.u += hit ? pay([g.cl.h, g.cl.d, g.cl.a][i]) : -1; } out.baseline = { note: 'every game, the closing favourite', n: t.n, roi: +(100 * t.u / t.n).toFixed(1) }; }
console.log(JSON.stringify({ games: games.length, half: new Date(half * DAY).toISOString().slice(0, 10) }));
for (const [k, v] of Object.entries(out)) console.log(k.padEnd(12), JSON.stringify(v));
