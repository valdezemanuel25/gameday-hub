// Model vs market: the sportsbook's home / draw / away price as a benchmark. Pure functions, no I/O.
//   The price is turned into chances by removing the book's margin (devig, power method). Every model is scored on the games where
//   both it and the price exist, with the same three scores: RPS (ranked probability score: lower is better, and it knows a draw sits
//   between a home and an away win), log loss and Brier.
//   blend: the share of v4 that gives the best log loss when mixed with the market (0 = v4 adds nothing the price does not already know).
//   clv (closing-line value): did the price for a pick shorten between the first price the Hub saw and kickoff? Beating the closing price
//   is the quickest honest sign of an edge; hit rate and profit need hundreds of bets to say anything.
//   value: every game where v4 rates a result 5+ points above the market's first price, bet at that price. A game priced before the
//   first price was kept (Oct 26, 2026) uses its closing price instead, and has no closing-line value.
import { devig as devigPrices } from './v6core.js';
import { moveOf, bttsMove } from './moves.js';

const ix = k => 'HDA'.indexOf(k);
const dec = m => (m > 0 ? 1 + m / 100 : 1 + 100 / -m);
// American prices { h, d, a } -> chances [home, draw, away] adding to 1, or null when a price is missing. Same margin removal as the
// score card (power method, src/v6core.js), so the market here is the market the score card is built from.
export function devig(o) {
  if (!o) return null;
  return devigPrices(o.h, o.d, o.a);
}
const resOf = f => (f.h > f.a ? 0 : f.h === f.a ? 1 : 2);
const norm = p => { const s = p[0] + p[1] + p[2]; return s > 0 ? p.map(x => x / s) : null; };
// One game's scores for chances p (any scale) and result r (0 home, 1 draw, 2 away).
export function scoreOne(p0, r) {
  const p = norm(p0);
  const rps = ((p[0] - (r === 0)) ** 2 + (p[0] + p[1] - (r <= 1)) ** 2) / 2;
  return { rps, ll: -Math.log(Math.max(1e-6, p[r])), brier: p.reduce((s, q, i) => s + (q - (i === r)) ** 2, 0) };
}
const blankPair = () => ({ n: 0, model: { rps: 0, ll: 0, brier: 0 }, market: { rps: 0, ll: 0, brier: 0 } });
const W = Array.from({ length: 21 }, (_, i) => i / 20);
export function blankMarket() {
  return { n: 0, pairs: { v4: blankPair(), v5: blankPair(), v2: blankPair(), fb: blankPair() }, blend: W.map(() => 0), nBlend: 0,
    clv: { n: 0, sum: 0, beat: 0 }, value: { n: 0, hits: 0, units: 0, clvN: 0, clvSum: 0, beat: 0 },
    mine: { n: 0, sum: 0, beat: 0 }, moves: { n: 0, follow: 0, big: 0, bigFollow: 0, modelWith: 0, modelWithFollow: 0, modelAgainst: 0, modelAgainstFollow: 0, btts: { n: 0, follow: 0 } } };
}
// Fold one graded card in. The closing price is the card's last price before kickoff; the first price is `f` (or ESPN's opening line).
export function addMarket(M, c) {
  if (!c || !c.final || !c.odds) return;
  const mk = devig(c.odds); if (!mk) return;
  const r = resOf(c.final), sm = scoreOne(mk, r);
  M.n++;
  for (const k of ['v4', 'v5', 'v2', 'fb']) {
    const p = c[k] && Array.isArray(c[k].p) ? c[k].p : null; if (!p || (k === 'v4' && c.v4.promo)) continue;
    const s = scoreOne(p, r), t = M.pairs[k]; t.n++;
    for (const x of ['rps', 'll', 'brier']) { t.model[x] += s[x]; t.market[x] += sm[x]; }
  }
  const p4 = c.v4 && Array.isArray(c.v4.p) && !c.v4.promo ? norm(c.v4.p) : null;
  if (p4) { M.nBlend++; W.forEach((w, i) => { M.blend[i] -= Math.log(Math.max(1e-6, w * p4[r] + (1 - w) * mk[r])); }); }
  const first = devig(c.odds.f) || devig(c.odds.op), firstOdds = c.odds.f || c.odds.op;
  // The headline pick's closing-line value (result picks only: the first price is kept for home / draw / away).
  const L = c.lean;
  if (first && L && ix(L.key) >= 0) { const i = ix(L.key), v = mk[i] / first[i] - 1; M.clv.n++; M.clv.sum += v; M.clv.beat += v > 0 ? 1 : 0; }
  // Your own pick ("Your pick" on the card): closing-line value from the first price the Hub saw.
  if (first && c.mine && ix(c.mine) >= 0) { const i = ix(c.mine), v = mk[i] / first[i] - 1; M.mine.n++; M.mine.sum += v; M.mine.beat += v > 0 ? 1 : 0; }
  // Price moves from the opening price to the close: did the result go the way of the biggest move? On big moves, did v4 see it coming?
  const mv = moveOf(c.odds);
  if (mv && mv.size > 0) {
    const t = M.moves, fol = mv.d[r] > 0; // the result's own chance rose from open to close
    t.n++; t.follow += fol ? 1 : 0;
    if (mv.big) {
      t.big++; t.bigFollow += fol ? 1 : 0;
      if (p4) { const with4 = (100 * p4[mv.top] - mv.p0[mv.top] > 0) === (mv.d[mv.top] > 0); if (with4) { t.modelWith++; t.modelWithFollow += fol ? 1 : 0; } else { t.modelAgainst++; t.modelAgainstFollow += fol ? 1 : 0; } }
    }
  }
  // Both score: the book's own both-score price, first seen against the close (bttsMove) when it has both, else the score card's chance
  // at the opening price (v6o) against the close (v6). A move of 1+ points counts.
  const bm = bttsMove(c.odds), bd = bm ? bm.d : c.v6o && c.v6 ? c.v6.btts - c.v6o.btts : 0;
  if (Math.abs(bd) >= 1) { const b = M.moves.btts; b.n++; b.follow += (bd > 0) === (c.final.h > 0 && c.final.a > 0) ? 1 : 0; if (bm) b.book = (b.book || 0) + 1; }
  // v4 value bets against the first price (the closing one for older cards).
  if (p4) {
    const ref = first || mk, refOdds = first ? firstOdds : c.odds, e = p4.map((q, i) => q - ref[i]), i = e.indexOf(Math.max(...e));
    if (e[i] >= 0.05) {
      const m = [refOdds.h, refOdds.d, refOdds.a][i], hit = i === r, v = M.value;
      v.n++; v.hits += hit ? 1 : 0; v.units += hit ? dec(m) - 1 : -1;
      if (first) { const cl = mk[i] / first[i] - 1; v.clvN++; v.clvSum += cl; v.beat += cl > 0 ? 1 : 0; }
    }
  }
}
const r3 = x => +x.toFixed(3), r4 = x => +x.toFixed(4);
export function finishMarket(M) {
  const pair = t => (t.n ? { n: t.n, model: Object.fromEntries(Object.entries(t.model).map(([k, v]) => [k, r4(v / t.n)])), market: Object.fromEntries(Object.entries(t.market).map(([k, v]) => [k, r4(v / t.n)])) } : { n: 0 });
  let bi = 0; M.blend.forEach((v, i) => { if (v < M.blend[bi]) bi = i; });
  return {
    n: M.n,
    pairs: Object.fromEntries(Object.entries(M.pairs).map(([k, t]) => [k, pair(t)])),
    blend: M.nBlend ? { n: M.nBlend, w: W[bi], ll: r4(M.blend[bi] / M.nBlend), llMarket: r4(M.blend[0] / M.nBlend), llV4: r4(M.blend[W.length - 1] / M.nBlend) } : { n: 0 },
    clv: { n: M.clv.n, avg: M.clv.n ? r3(100 * M.clv.sum / M.clv.n) : null, beat: M.clv.beat },
    mine: { n: M.mine.n, avg: M.mine.n ? r3(100 * M.mine.sum / M.mine.n) : null, beat: M.mine.beat },
    moves: M.moves,
    value: { n: M.value.n, hits: M.value.hits, units: r3(M.value.units), roi: M.value.n ? r3(100 * M.value.units / M.value.n) : null, clv: M.value.clvN ? r3(100 * M.value.clvSum / M.value.clvN) : null, clvN: M.value.clvN, beat: M.value.beat },
  };
}
