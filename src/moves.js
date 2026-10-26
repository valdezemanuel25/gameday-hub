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
