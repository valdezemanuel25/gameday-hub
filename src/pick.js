// The card's headline pick, as data. This is the same rule the page uses for the line a card leads with (public/index.html headline()),
// kept here so the server can lock the pick when a game is graded and the Model bets record can score it. test/pick.mjs checks both agree.
//   Every model gives one vote on the result, on Over/Under 2.5 and on both-score (SportsMole's vote comes from its score).
//   The card leads with the market's strongest call (the v6 score card, from the sportsbook price) once the game has a price, and
//   with v4's before that. The models vote agree / disagree on that call and the kind says how many back it; they never change it.
//   A card with no v4 falls back to the old rule (consensusPick: what most models back).
//   kind: 'best' (all models back v4's winner and v4 gives it at least 60%), 'lean' (a majority backs it), 'split' (no majority: v4's pick anyway),
//         'solo' (only one model had numbers: v4 on its own, or v2 on a card with no v4, its own strongest pick).
//   v2 was retired on Oct 26, 2026: it no longer votes when the card has v4.
export const sideOfScore = (h, a) => (h > a ? 'H' : h < a ? 'A' : 'D');
const hda = x => (x ? 'HDA'[x.indexOf(Math.max(...x))] : null);
export const KEYS = { H: 'Home win', D: 'Draw', A: 'Away win', O: 'Over 2.5', U: 'Under 2.5', B: 'Both score', N: 'Not both score' };

// Every model's vote on every market (result, Over/Under 2.5, both-score), with how many were asked and the average chance.
function rowsOf(c) {
  const v = c.v2;
  const f = c.fb || {};
  // v2 was retired on Oct 26, 2026: it only votes on a card v4 has no numbers for.
  const M = c.v4 && c.v4.p ? [{ n: 'v4', w: c.v4.pick, p: c.v4.p, over: c.v4.over, btts: c.v4.btts, po: c.v4.over, pb: c.v4.btts }] : [{ n: 'v2', w: v.pick, p: v.p, over: v.over, btts: v.btts, po: v.over, pb: v.btts }];
  if (f.p || f.score) M.push({ n: 'Forebet', w: f.p ? hda(f.p) : sideOfScore(f.score.h, f.score.a), p: f.p || null, over: f.over != null ? f.over : f.score ? (f.score.h + f.score.a >= 3 ? 100 : 0) : null, btts: f.btts != null ? f.btts : f.score ? (f.score.h > 0 && f.score.a > 0 ? 100 : 0) : null, po: f.over != null ? f.over : null, pb: f.btts != null ? f.btts : null });
  if (c.sm) M.push({ n: 'SportsMole', w: sideOfScore(c.sm.h, c.sm.a), p: null, over: c.sm.h + c.sm.a >= 3 ? 100 : 0, btts: c.sm.h > 0 && c.sm.a > 0 ? 100 : 0, po: null, pb: null });
  const O = [['H', m => m.w === 'H', m => m.p && m.p[0]], ['D', m => m.w === 'D', m => m.p && m.p[1]], ['A', m => m.w === 'A', m => m.p && m.p[2]],
    ['O', m => m.over != null && m.over > 50, m => m.po], ['U', m => m.over != null && m.over < 50, m => (m.po == null ? null : 100 - m.po)],
    ['B', m => m.btts != null && m.btts > 50, m => m.pb], ['N', m => m.btts != null && m.btts < 50, m => (m.pb == null ? null : 100 - m.pb)]];
  const asked = o => M.filter(m => (o === 'H' || o === 'D' || o === 'A') ? true : (o === 'O' || o === 'U') ? m.over != null : m.btts != null);
  const rows = O.map(([key, back, pr]) => { const a = asked(key), yes = a.filter(back), ps = a.map(pr).filter(x => typeof x === 'number'); return { key, a, yes, no: a.filter(m => !back(m)), p: ps.length ? Math.round(ps.reduce((x, y) => x + y, 0) / ps.length) : null }; });
  return rows;
}
export function consensusPick(c) {
  const v = c && c.v2; if (!v || !v.p) return null;
  const rows = rowsOf(c);
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

// The card's headline: the market's single strongest call (the v6 score card, built from the sportsbook price: result, Over/Under 2.5
// or both-score, whichever it rates highest), with the models counted as agree / disagree on that same market. From Oct 27, 2026:
// the price beat every model and a v4 + market mix was best at 0% v4 (docs/model-review-2026-10-25.md), so the models do not move
// the pick. A card with no price yet leads with v4's strongest call the same way; a card with no v4 falls back to consensusPick.
export function leanPick(c) {
  const base = consensusPick(c); if (!base) return null;
  const mk = c.v6 && c.v6.p ? c.v6 : null, q = mk || c.v4; if (!q || !q.p) return base;
  const src = mk ? 'market' : 'v4';
  const opts = [[q.p[0], 'H'], [q.p[1], 'D'], [q.p[2], 'A'], [q.over, 'O'], [typeof q.over === 'number' ? 100 - q.over : null, 'U'], [q.btts, 'B'], [typeof q.btts === 'number' ? 100 - q.btts : null, 'N']].filter(x => typeof x[0] === 'number');
  if (!opts.length) return base;
  const top = opts.reduce((m, x) => (x[0] > m[0] ? x : m)), key = top[1], p = Math.round(top[0]);
  const r = rowsOf(c).find(x => x.key === key); if (!r) return base;
  // The market leads: the models (v4, Forebet, SportsMole) are only counted as agree / disagree. It is never changed by them.
  if (mk) {
    if (!r.a.length) return { k: 'solo', key, p, y: 0, a: 0, by: [], no: [], src };
    const maj = r.yes.length * 2 > r.a.length, all = r.no.length === 0;
    return { k: !maj ? 'split' : all && p >= 60 ? 'best' : 'lean', key, p, y: r.yes.length, a: r.a.length, by: r.yes.map(m => m.n), no: r.no.map(m => m.n), src };
  }
  if (r.a.length < 2) return { k: 'solo', key, p, y: 1, a: 1, by: ['v4'], no: [], src }; // no other model has numbers yet
  const maj = r.yes.length * 2 > r.a.length, all = r.no.length === 0;
  if (!maj) return { k: 'split', key, p, y: r.yes.length, a: r.a.length, by: ['v4'], no: [], src };
  return { k: all && p >= 60 ? 'best' : 'lean', key, p, y: r.yes.length, a: r.a.length, by: r.yes.map(m => m.n), no: r.no.map(m => m.n), src };
}
// Did the pick land on this final score? Over/Under use 2.5 goals.
export function leanHit(key, f) {
  const t = f.h + f.a;
  return key === 'H' ? f.h > f.a : key === 'D' ? f.h === f.a : key === 'A' ? f.h < f.a : key === 'O' ? t >= 3 : key === 'U' ? t < 3 : key === 'B' ? f.h > 0 && f.a > 0 : !(f.h > 0 && f.a > 0);
}

// ---- hockey ----
// The same idea for a hockey card: each model gives one vote on the winner (overtime counts, so no draw) and, when the game has a
// sportsbook total, on Over or Under at THAT line. v2 and v4 vote Over when their Over chance is above 50% (Under when below);
// Forebet votes from its predicted total. A total exactly on the line is no vote. No odds are used beyond which number "Over" means.
//   'best' = all three models agree (the Top tab's "All agree"), 'lean' = a majority, 'split' = no majority (v2's own winner), 'solo' = only v2.
export function hockeyPick(c) {
  if (!c || !c.v2 || c.skipped || c.v2.w == null) return null;
  const f = c.fb || {}, line = c.ln ? c.ln.v : null, tot = f.score ? f.score.h + f.score.a : null;
  const M = [{ n: 'v2', w: c.v2.w >= 50 ? 'H' : 'A', ph: c.v2.w, o: line != null ? c.v2.o : null }];
  if (c.v4 && c.v4.w != null) M.push({ n: 'v4', w: c.v4.w >= 50 ? 'H' : 'A', ph: c.v4.w, o: line != null ? c.v4.o : null });
  if (f.pick) M.push({ n: 'Forebet', w: f.pick, ph: f.p ? f.p[0] : null, o: line != null && tot != null && tot !== line ? (tot > line ? 100 : 0) : null, fbo: true });
  const O = [['H', m => m.w === 'H', m => m.ph], ['A', m => m.w === 'A', m => (m.ph == null ? null : 100 - m.ph)],
    ['O', m => m.o != null && m.o > 50, m => (m.fbo ? null : m.o)], ['U', m => m.o != null && m.o < 50, m => (m.fbo || m.o == null ? null : 100 - m.o)]];
  const asked = k => M.filter(m => (k === 'H' || k === 'A') ? true : m.o != null);
  const rows = O.map(([key, back, pr]) => { const a = asked(key), yes = a.filter(back), ps = a.map(pr).filter(x => typeof x === 'number'); return { key, a, yes, no: a.filter(m => !back(m)), p: ps.length ? Math.round(ps.reduce((x, y) => x + y, 0) / ps.length) : null }; });
  const score = r => [r.a.length ? r.yes.length / r.a.length : 0, r.yes.length, r.p == null ? 0 : r.p];
  const best = rows.filter(r => r.a.length >= 2).sort((x, y) => { const a = score(x), b = score(y); return b[0] - a[0] || b[1] - a[1] || b[2] - a[2]; })[0];
  const ln = key => (key === 'O' || key === 'U' ? { line } : {});
  const own = c.v2.w >= 50 ? ['H', c.v2.w] : ['A', 100 - c.v2.w];
  if (!best) return { k: 'solo', key: own[0], p: Math.round(own[1]), y: 1, a: 1, by: ['v2'], no: [] };
  const maj = best.yes.length * 2 > best.a.length, all = best.yes.length === best.a.length;
  if (!maj) return { k: 'split', key: own[0], p: Math.round(own[1]), y: best.yes.length, a: best.a.length, by: ['v2'], no: [] };
  return { k: all && best.a.length >= 3 ? 'best' : 'lean', key: best.key, p: best.p, y: best.yes.length, a: best.a.length, by: best.yes.map(m => m.n), no: best.no.map(m => m.n), ...ln(best.key) };
}
// true / false, or null when an Over/Under pick lands exactly on a whole-number line (a push: no result).
export function hockeyHit(key, f, line) {
  const t = f.total != null ? f.total : f.h + f.a;
  return key === 'H' ? f.h > f.a : key === 'A' ? f.h < f.a : t === line ? null : key === 'O' ? t > line : t < line;
}

// The saved price (American odds) for a pick's bet, or null when the book did not offer it.
// Over/Under prices count only when the book's own total is 2.5, because the tracked bet is Over/Under 2.5.
export function priceFor(odds, key) { const m = odds && ({ H: odds.h, D: odds.d, A: odds.a, O: odds.tl === 2.5 ? odds.to : null, U: odds.tl === 2.5 ? odds.tu : null, B: odds.by, N: odds.bn })[key]; return Number.isFinite(m) ? m : null; }
// Units won by 1 unit staked at a price: a hit pays the price, a miss loses the stake.
export const unitsWon = (m, hit) => hit ? (m > 0 ? m / 100 : 100 / -m) : -1;
// Break-even win rate (%) for an American price, and the tag for a pick: model chance 5+ points above it is Value, 5+ below is Not worth it.
export const needP = m => m < 0 ? -m / (-m + 100) * 100 : 100 / (m + 100) * 100;
export const verdictOf = (p, m) => p == null || m == null ? null : p - needP(m) >= 5 ? 'val' : p - needP(m) <= -5 ? 'no' : 'fair';
// Price bands for the profit breakdown (American odds).
export const BANDS = [['b1', '-300 or shorter'], ['b2', '-299 to -150'], ['b3', '-149 to +149'], ['b4', '+150 or longer']];
export const bandOf = m => m <= -300 ? 'b1' : m <= -150 ? 'b2' : m < 150 ? 'b3' : 'b4';
