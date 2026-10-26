// Price moves: how far the book's own chances (margin removed, power method) moved between the opening price and now (the closing
// price once the game has started). Pure functions, no I/O. The page has the same rule in moveOf() (public/index.html).
//   Opening price: ESPN's opening line (odds.op) when it sends one, else the first price the Hub saw (odds.f).
//   A big move (5+ points on one result) is where news (team sheets, injuries, informed money) reaches the price: on 8,389 past
//   games the 8% of games that moved 5-10 points carried 40% of the price's gain in accuracy from open to close, and results went
//   the way of the move 56-57% of the time. A flag, never a bet.
import { devig } from './v6core.js';

export const BIG_MOVE = 5; // points
const r1 = x => Math.round(10 * x) / 10;
// { from: 'open' | 'first', p0, p1 (home / draw / away %), d (points), top (index of the biggest move), size, big, ou } or null.
export function moveOf(odds) {
  if (!odds) return null;
  const open = odds.op || odds.f, from = odds.op ? 'open' : 'first';
  const a = open && devig(open.h, open.d, open.a), b = devig(odds.h, odds.d, odds.a);
  if (!a || !b) return null;
  const p0 = a.map(x => r1(100 * x)), p1 = b.map(x => r1(100 * x)), d = p1.map((x, i) => r1(x - p0[i]));
  const top = d.reduce((m, x, i) => (Math.abs(x) > Math.abs(d[m]) ? i : m), 0), size = Math.abs(d[top]);
  // Over / Under: only when the opening total is on the same line as now
  const ot = odds.opt || (odds.f && odds.f.tl != null ? odds.f : null);
  let ou = null;
  if (ot && ot.tl === odds.tl) { const x = devig(ot.to, ot.tu), y = devig(odds.to, odds.tu); if (x && y) ou = { line: odds.tl, p0: r1(100 * x[0]), p1: r1(100 * y[0]), d: r1(100 * (y[0] - x[0])) }; }
  return { from, p0, p1, d, top, size, big: size >= BIG_MOVE, ou };
}

// Hockey (src/nhl.js keeps c.px): moneyline (home / away, overtime and shootout count) and the total with its Over / Under prices.
// { from, ml: { p0, p1, d } (home win %), ou: { line, p0, p1, d } (Over %) | null, top: 'ml' | 'ou', size, big } or null.
export function hockeyMove(px) {
  if (!px) return null;
  const open = px.op || px.f, from = px.op ? 'open' : 'first', a = open && devig(open.h, open.a), b = devig(px.h, px.a);
  const ml = a && b ? { p0: r1(100 * a[0]), p1: r1(100 * b[0]), d: r1(100 * (b[0] - a[0])) } : null;
  const ot = px.opt || (px.f && px.f.tl != null ? px.f : null);
  let ou = null;
  if (ot && px.tl != null && ot.tl === px.tl) { const x = devig(ot.to, ot.tu), y = devig(px.to, px.tu); if (x && y) ou = { line: px.tl, p0: r1(100 * x[0]), p1: r1(100 * y[0]), d: r1(100 * (y[0] - x[0])) }; }
  if (!ml && !ou) return null;
  const top = !ou || (ml && Math.abs(ml.d) >= Math.abs(ou.d)) ? 'ml' : 'ou', size = Math.abs((top === 'ml' ? ml : ou).d);
  return { from, ml, ou, top, size, big: size >= BIG_MOVE };
}

// Both score (book prices from The Odds API, src/btts.js): the first both-score price seen (odds.bf) against now / the close (odds.by,
// odds.bn). { b0: [yes, no], b1: [yes, no], p0, p1, d (Yes %) } or null without both prices.
export function bttsMove(odds) {
  const f = odds && odds.bf; if (!f || odds.by == null) return null;
  const a = devig(f.by, f.bn), b = devig(odds.by, odds.bn); if (!a || !b) return null;
  return { b0: [f.by, f.bn], b1: [odds.by, odds.bn], p0: r1(100 * a[0]), p1: r1(100 * b[0]), d: r1(100 * (b[0] - a[0])) };
}
