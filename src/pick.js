// The card's headline pick, as data. This is the same rule the page uses for the line a card leads with (public/index.html headline()),
// kept here so the server can lock the pick when a game is graded and the Model bets record can score it. test/pick.mjs checks both agree.
//   Every model gives one vote on the result, on Over/Under 2.5 and on both-score (SportsMole's vote comes from its score).
//   A pick only leads when most of the models that were asked back it. No odds are used anywhere.
//   kind: 'best' (all agree and average at least 60%), 'lean' (a majority backs it), 'split' (no majority: v2's own pick),
//         'solo' (only v2 had numbers: its own strongest pick).
export const sideOfScore = (h, a) => (h > a ? 'H' : h < a ? 'A' : 'D');
const hda = x => (x ? 'HDA'[x.indexOf(Math.max(...x))] : null);
export const KEYS = { H: 'Home win', D: 'Draw', A: 'Away win', O: 'Over 2.5', U: 'Under 2.5', B: 'Both score', N: 'Not both score' };

export function leanPick(c) {
  const v = c && c.v2; if (!v || !v.p) return null;
  const f = c.fb || {};
  const M = [{ n: 'v2', w: v.pick, p: v.p, over: v.over, btts: v.btts, po: v.over, pb: v.btts }];
  if (c.v4) M.push({ n: 'v4', w: c.v4.pick, p: c.v4.p, over: c.v4.over, btts: c.v4.btts, po: c.v4.over, pb: c.v4.btts });
  if (f.p || f.score) M.push({ n: 'Forebet', w: f.p ? hda(f.p) : sideOfScore(f.score.h, f.score.a), p: f.p || null, over: f.over != null ? f.over : f.score ? (f.score.h + f.score.a >= 3 ? 100 : 0) : null, btts: f.btts != null ? f.btts : f.score ? (f.score.h > 0 && f.score.a > 0 ? 100 : 0) : null, po: f.over != null ? f.over : null, pb: f.btts != null ? f.btts : null });
  if (c.sm) M.push({ n: 'SportsMole', w: sideOfScore(c.sm.h, c.sm.a), p: null, over: c.sm.h + c.sm.a >= 3 ? 100 : 0, btts: c.sm.h > 0 && c.sm.a > 0 ? 100 : 0, po: null, pb: null });
  const O = [['H', m => m.w === 'H', m => m.p && m.p[0]], ['D', m => m.w === 'D', m => m.p && m.p[1]], ['A', m => m.w === 'A', m => m.p && m.p[2]],
    ['O', m => m.over != null && m.over > 50, m => m.po], ['U', m => m.over != null && m.over < 50, m => (m.po == null ? null : 100 - m.po)],
    ['B', m => m.btts != null && m.btts > 50, m => m.pb], ['N', m => m.btts != null && m.btts < 50, m => (m.pb == null ? null : 100 - m.pb)]];
  const asked = o => M.filter(m => (o === 'H' || o === 'D' || o === 'A') ? true : (o === 'O' || o === 'U') ? m.over != null : m.btts != null);
  const rows = O.map(([key, back, pr]) => { const a = asked(key), yes = a.filter(back), ps = a.map(pr).filter(x => typeof x === 'number'); return { key, a, yes, no: a.filter(m => !back(m)), p: ps.length ? Math.round(ps.reduce((x, y) => x + y, 0) / ps.length) : null }; });
  const score = r => [r.a.length ? r.yes.length / r.a.length : 0, r.yes.length, r.p == null ? 0 : r.p];
  const best = rows.filter(r => r.a.length >= 2).sort((x, y) => { const a = score(x), b = score(y); return b[0] - a[0] || b[1] - a[1] || b[2] - a[2]; })[0];
  if (!best) {
    const mx = Math.max(...v.p), wi = v.p.indexOf(mx);
    const alts = [[mx, 'HDA'[wi]], [v.over, 'O'], [100 - v.over, 'U'], [v.btts, 'B'], [100 - v.btts, 'N']].filter(x => typeof x[0] === 'number').sort((x, y) => y[0] - x[0])[0];
    return { k: 'solo', key: alts[1], p: alts[0], y: 1, a: 1, by: ['v2'], no: [] };
  }
  const maj = best.yes.length * 2 > best.a.length, all = best.yes.length === best.a.length;
  if (!maj) { const mx = Math.max(...v.p), wi = v.p.indexOf(mx); return { k: 'split', key: 'HDA'[wi], p: mx, y: best.yes.length, a: best.a.length, by: ['v2'], no: [] }; }
  return { k: all && best.p != null && best.p >= 60 ? 'best' : 'lean', key: best.key, p: best.p, y: best.yes.length, a: best.a.length, by: best.yes.map(m => m.n), no: best.no.map(m => m.n) };
}
// Did the pick land on this final score? Over/Under use 2.5 goals.
export function leanHit(key, f) {
  const t = f.h + f.a;
  return key === 'H' ? f.h > f.a : key === 'D' ? f.h === f.a : key === 'A' ? f.h < f.a : key === 'O' ? t >= 3 : key === 'U' ? t < 3 : key === 'B' ? f.h > 0 && f.a > 0 : !(f.h > 0 && f.a > 0);
}
