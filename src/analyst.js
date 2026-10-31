// The Analyst: a paper bettor that watches every soccer price read and places its own bets from the price movement and v4.
// Pure functions here; storage and the hooks into the price reads are at the bottom.
//
//   It looks at a card each time its price is read (every 6 hours, hourly in the last 3, and the lineup read 30-20 minutes before
//   kickoff) until the price locks, and bets the first time one of its rules fires, at the price of that read. One bet per rule per
//   game. Every bet is 1 unit, so the record reads straight off as units won and ROI.
//   Each bet is scored two ways:
//     * profit at the price taken (what counts, but it needs hundreds of bets to mean anything),
//     * closing-line value: the price taken against the closing price (the lineup read). Beating the close is the quickest honest
//       sign of an edge, and it is known as soon as the game kicks off.
//   Price shopping: when a rule fires, the bet takes the best price among the US books (src/btts.js fetchBest, through The Odds API)
//   if one beats DraftKings, which is the price the rule was read on. The DraftKings price is kept on the bet (dk) so the record shows
//   both: units at the best price and units had every bet gone on at DraftKings. clvDk is DraftKings' own price against its close: the
//   rule's skill on its own, without the shopping gain (clv includes it). Without the API key, or with few credits left, it
//   bets at DraftKings. The rule never reads the other books: a better price only changes what the bet pays.
//   A rule that is losing on both after BENCH.n bets is benched (no new bets) until a later look says otherwise; it is never deleted.
//   Stale price (rule 'stale', first in RULES): DraftKings' price against a sharp book's price at the same moment (Pinnacle, else the
//   Betfair or Matchbook exchange, src/btts.js fetchSharp), margin removed. When DraftKings pays STALE.ev or more above the sharp book's
//   fair chance, DraftKings has not caught up with the market: bet DraftKings. No model is read. It needs the ODDS_API_KEY secret and
//   costs 2 credits per look at a league, so src/worker.js analystSharp limits how often it looks.
//   Backtest (tools/backtest-analyst.mjs, walk-forward v4 against Bet365's opening and closing prices, 1,929 league games): at the
//   closing price none of these rules made money; see the numbers in the comments on RULES. The live test is whether betting at
//   earlier reads, before a move has finished, does better than the close.
import { devig } from './v6core.js';
import { leanHit, hockeyHit } from './pick.js';
import { hockeyMove } from './moves.js';

export const SINCE = '2026-10-27';
export const STALE = { ev: 0.02, maxPrice: 400 }; // stale price: DraftKings pays 2%+ over the sharp fair price; nothing longer than +400
// late rules bet only at the lineup read (30-20 minutes before kickoff, src/worker.js LINEUP_READ / PRICE_LOCK); 35 allows for a slow read
export const LATE = 35;
export const BENCH = { n: 40, clv: 0, roi: 0 }; // benched when, after n settled bets, average closing-line value and ROI are both <= these
const K = 'HDA', r1 = x => Math.round(10 * x) / 10;
const dec = m => (m > 0 ? 1 + m / 100 : 1 + 100 / -m);
const hdaOf = o => (o ? devig(o.h, o.d, o.a) : null);
const ouOf = o => (o && o.tl === 2.5 && Number.isFinite(o.to) && Number.isFinite(o.tu) ? devig(o.to, o.tu) : null);
const openOf = odds => odds && (odds.op || odds.f);
const openTotal = odds => odds && (odds.opt || (odds.f && odds.f.tl != null ? odds.f : null));

// What the Analyst sees on one card: the move since the opening price and v4 against the price now, for home / draw / away and Over 2.5.
// v4: { p: [h, d, a] %, over % }; open / now: American prices { h, d, a, tl, to, tu }.
export function view({ v4, open, now, openT, v2 = null }) {
  const a = hdaOf(open), b = hdaOf(now);
  if (!a || !b || !v4 || !Array.isArray(v4.p)) return null;
  const p0 = a.map(x => 100 * x), p1 = b.map(x => 100 * x);
  const out = { p0, p1, d: p1.map((x, i) => x - p0[i]), e: v4.p.map((x, i) => x - p1[i]), e0: v4.p.map((x, i) => x - p0[i]), px: [now.h, now.d, now.a], ou: null };
  const x = ouOf(openT || open), y = ouOf(now);
  // the move needs an opening total (p0 / d are null without one); the price now is enough for the Under rule
  if (y && typeof v4.over === 'number') out.ou = { p0: x ? 100 * x[0] : null, p1: 100 * y[0], d: x ? 100 * (y[0] - x[0]) : null, e: v4.over - 100 * y[0], px: [now.to, now.tu], v2: v2 && typeof v2.over === 'number' ? v2.over : null };
  // Both teams to score: only a DraftKings price (the card sometimes carries Pinnacle's or another book's when DraftKings has none)
  const bt = Number.isFinite(now.by) && Number.isFinite(now.bn) && (!now.bk || now.bk === 'draftkings') ? devig(now.by, now.bn) : null;
  if (bt && typeof v4.btts === 'number') out.bt = { p1: 100 * bt[0], v4: v4.btts, v2: v2 && typeof v2.btts === 'number' ? v2.btts : null, px: [now.by, now.bn] };
  return out;
}
const pickIdx = (vals, ok) => { let j = -1; vals.forEach((v, i) => { if (ok(i) && (j < 0 || v > vals[j])) j = i; }); return j; };
const why1 = (V, i, s) => `${['Home', 'Draw', 'Away'][i]} ${r1(V.p0[i])}%→${r1(V.p1[i])}% (${V.d[i] >= 0 ? '+' : ''}${r1(V.d[i])}), v4 ${r1(V.p1[i] + V.e[i])}%: ${s}`;
// The rules. pick(V, S) -> { key, price, why } | null: V is the move and v4 (view), S the sharp price (sharpOf in src/btts.js); a rule
// is only asked when it has what it needs (sharp: true rules need S, the others V). Backtest at the closing price (1 unit a bet, first
// half / second half of the window):
export const RULES = [
  { id: 'stale', mk: ['1x2', 'ou'], sharp: true, name: 'Stale price: DraftKings behind the sharp book', rule: 'DraftKings pays 2%+ more than the sharp book\'s fair chance (Pinnacle or a betting exchange, margin removed) on a result or Over/Under 2.5, at +400 or shorter',
    // Bet365 against Pinnacle at the same moment (data/football-data, 8,389 games): opening prices +9% on 447 bets at 0%+, -5% at 2%+;
    // closing prices -3% / -4%. Bet365 is not DraftKings: the live test is whether DraftKings lags more.
    pick: (V, S) => { let best = null;
      for (const k of ['H', 'D', 'A', 'O', 'U']) { const m = S.dk[k], q = S.fair[k]; if (!Number.isFinite(m) || q == null || m > STALE.maxPrice) continue;
        const ev = q * dec(m) - 1; if (ev >= STALE.ev && (!best || ev > best.ev)) best = { key: k, price: m, ev, q }; }
      return best && { key: best.key, price: best.price, sharp: { book: S.book, fair: r1(100 * best.q), ev: r1(100 * best.ev) },
        why: `${LABEL[best.key]} DraftKings ${best.price > 0 ? '+' : ''}${best.price} pays ${r1(100 * best.ev)}% over ${BOOKN[S.book] || S.book}'s fair ${r1(100 * best.q)}%: DraftKings has not caught up` }; } },
  { id: 'follow', mk: ['1x2'], name: 'Follow the move, v4 agrees', rule: 'A result\'s chance rose 3+ points since the opening price and v4 rated it above the opening price too',
    // close: 249 bets, -24% / +2% (-10% overall)
    pick: V => { const i = pickIdx(V.d, i => V.d[i] >= 3 && V.e0[i] > 0); return i < 0 ? null : { key: K[i], price: V.px[i], why: why1(V, i, 'the money moved the way v4 already leaned') }; } },
  { id: 'value', mk: ['1x2'], name: 'v4 value, price not against it', rule: 'v4 rates a home or away win 5+ points above the price now, and that price has not drifted 1+ points away from it',
    // close: 439 bets, -19% / -1% (-10% overall)
    pick: V => { const i = pickIdx(V.e, i => i !== 1 && V.e[i] >= 5 && V.d[i] > -1); return i < 0 ? null : { key: K[i], price: V.px[i], why: why1(V, i, 'v4 sees value and the money is not fighting it') }; } },
  { id: 'fade', mk: ['1x2'], name: 'Fade the drift, v4 disagrees with it', rule: 'A result\'s chance fell 4+ points since the opening price but v4 still rates it at or above the price now',
    // close: 218 bets, -3% / -14% (-9% overall)
    pick: V => { const i = pickIdx(V.d.map(x => -x), i => V.d[i] <= -4 && V.e[i] >= 0); return i < 0 ? null : { key: K[i], price: V.px[i], why: why1(V, i, 'the price drifted but v4 says it went too far') }; } },
  { id: 'totals', mk: ['ou'], retired: '2026-10-31', name: 'Goals move, v4 agrees', rule: 'Over 2.5 moved 3+ points since the opening price (either way) and v4 is on the same side of the price now',
    // close: 146 bets, +3% / -12% (-5% overall). Retired Oct 31, 2026 for 'under' below: on the Hub's own games (Oct 13-31) following
    // a 3-point Over/Under move went 7 of 14 at about -30%. Its bets stay in the record; it places no new ones.
    pick: V => { const o = V.ou; if (!o || o.d == null) return null; const k = o.d >= 3 && o.e >= 0 ? 'O' : o.d <= -3 && o.e <= 0 ? 'U' : null; if (!k) return null;
      return { key: k, price: o.px[k === 'O' ? 0 : 1], why: `Over 2.5 ${r1(o.p0)}%→${r1(o.p1)}% (${o.d >= 0 ? '+' : ''}${r1(o.d)}), v4 ${r1(o.p1 + o.e)}%: goals money agrees with v4` }; } },
  // Front test from Oct 31, 2026. Backtest on the Hub's own games, Oct 13-31 at DraftKings' closing price (small samples: a live test only).
  // DraftKings' prices ran high on Yes and Over: Yes implied 59% and both scored 54%; Over implied 53% and 46% went over.
  { id: 'under', mk: ['ou'], late: true, name: 'Under: price too high on Over', rule: 'At the lineup read (30-20 minutes before kickoff), DraftKings rates Over 2.5 at 55%+ (margin removed) and both v2 and v4 rate it lower: bet Under 2.5',
    // From Oct 31 it waits for the lineup read: the backtest picked its bets on the closing price, and the few games with an earlier
    // price went 2 of 5 (-14%) when checked early, so betting early had no support (and the price can move against it after).
    // 17 bets, 65% hit, +46% (first half +74%, second half +14%)
    pick: V => { const o = V.ou; if (!o || o.v2 == null || o.p1 < 55 || !(o.p1 + o.e < o.p1) || !(o.v2 < o.p1)) return null;
      return { key: 'U', price: o.px[1], why: `Over 2.5 priced ${r1(o.p1)}%, v4 ${r1(o.p1 + o.e)}%, v2 ${r1(o.v2)}%: the price leans Over more than both models` }; } },
  { id: 'bttsNo', mk: ['btts'], name: 'Both score No: price too high on Yes', rule: 'DraftKings rates both teams to score Yes at 58%+ (margin removed) and v4 rates it lower: bet No',
    // 67 bets, 46% hit, +26% (first half +24%, second half +29%); also needing v2 below the price: 41 bets, +25%
    pick: V => { const t = V.bt; if (!t || t.p1 < 58 || !(t.v4 < t.p1)) return null;
      return { key: 'N', price: t.px[1], why: `Both score Yes priced ${r1(t.p1)}%, v4 ${r1(t.v4)}%: the price leans Yes more than v4` }; } },
];

// ---- one look at a set of cards: the new bets, if any ----
const MKT = k => (k === 'O' || k === 'U' ? 'ou' : k === 'B' || k === 'N' ? 'btts' : '1x2');
export const LABEL = { H: 'Home win', D: 'Draw', A: 'Away win', O: 'Over 2.5', U: 'Under 2.5', B: 'Both score Yes', N: 'Both score No' };
const BOOKN = { pinnacle: 'Pinnacle', betfair_ex_eu: 'Betfair', betfair_ex_uk: 'Betfair', matchbook: 'Matchbook' };
// The Analyst only bets a card with a v4 number that is not the rough promoted-club stand-in, and with a price to read.
export function lookCard(c) {
  if (!c || c.final || !c.odds || !c.v4 || !Array.isArray(c.v4.p) || c.v4.promo) return null;
  return view({ v4: c.v4, open: openOf(c.odds), now: c.odds, openT: openTotal(c.odds), v2: c.v2 });
}
// One position per game per market (1X2, Over/Under): the first rule to fire takes it, in RULES order, and later reads never add to it
// or bet the other side. A benched rule places nothing. sharp: Map(cardId -> sharpOf) for the stale-price rule, or null.
export function decide(items, cards, date, now = new Date(), benched = new Set(), sharp = null) {
  const held = new Set(items.map(b => `${b.date}|${b.league}|${b.gid}|${MKT(b.key)}`)), out = [];
  for (const c of cards) {
    if (!c || c.final || !c.odds) continue;
    const V = lookCard(c), S = sharp && sharp.get(c.id); if (!V && !S) continue;
    for (const r of RULES) {
      if (r.retired || benched.has(r.id) || (r.sharp ? !S : !V)) continue;
      if (r.late && (new Date(c.kickoff).getTime() - now.getTime()) / 60000 > LATE) continue; // not yet the lineup read
      const b = r.pick(V, S); if (!b || !Number.isFinite(b.price)) continue;
      const k = `${date}|${c.league}|${c.id}|${MKT(b.key)}`; if (held.has(k)) continue;
      held.add(k);
      const i = 'HDA'.indexOf(b.key), v4ok = c.v4 && Array.isArray(c.v4.p);
      const bt = b.key === 'B' || b.key === 'N';
      const mp = b.sharp ? b.sharp.fair : i >= 0 ? V.p1[i] : bt ? (b.key === 'B' ? V.bt.p1 : 100 - V.bt.p1) : b.key === 'O' ? V.ou.p1 : 100 - V.ou.p1;
      const v4p = !v4ok ? null : i >= 0 ? c.v4.p[i] : bt ? (typeof c.v4.btts !== 'number' ? null : b.key === 'B' ? c.v4.btts : 100 - c.v4.btts) : typeof c.v4.over !== 'number' ? null : b.key === 'O' ? c.v4.over : 100 - c.v4.over;
      out.push({ id: `${now.getTime().toString(36)}${out.length.toString(36)}${Math.random().toString(36).slice(2, 5)}`, at: now.toISOString(), date, league: c.league, gid: c.id,
        home: c.home, away: c.away, leagueName: c.leagueName || c.league, kickoff: c.kickoff, mins: Math.round((new Date(c.kickoff).getTime() - now.getTime()) / 60000),
        rule: r.id, key: b.key, price: b.price, mp: r1(mp), v4: v4p == null ? null : r1(v4p), why: b.why, ...(b.sharp ? { sharp: b.sharp } : {}), close: null, clv: null, res: null, units: null });
    }
  }
  return out;
}

// ---- hockey (since Oct 28, 2026): the same idea on the NHL cards (src/nhl.js), DraftKings moneyline and total from ESPN ----
// Hockey's official model is v2 (v4 there is a shadow), so the rules read v2: w = home win % (overtime and shootout count),
// o = Over % at the card's line. A total counts only when the book's line is the line the model was rated at. No hockey backtest:
// there is no price history for hockey, so these rules are a live test only, kept apart from the soccer record.
export const NHL_SINCE = '2026-10-28';
const hk = (c, k) => (k === 'H' ? c.hAbbr || c.home : c.aAbbr || c.away);
const hwhy = (c, hm, k, s) => { const up = k === 'H', a = up ? hm.ml.p0 : 100 - hm.ml.p0, b = up ? hm.ml.p1 : 100 - hm.ml.p1, w = up ? c.v2.w : 100 - c.v2.w;
  return `${hk(c, k)} ${r1(a)}%→${r1(b)}% (${b - a >= 0 ? '+' : ''}${r1(b - a)}), v2 ${r1(w)}%: ${s}`; };
export const NHL_RULES = [
  { id: 'hfollow', mk: ['1x2'], name: 'Follow the move, v2 agrees', rule: 'A team\'s moneyline chance rose 3+ points since the opening price and v2 rated it above the opening price too',
    pick: (c, hm) => { const m = hm.ml; if (!m) return null; const k = m.d >= 3 && c.v2.w > m.p0 ? 'H' : m.d <= -3 && c.v2.w < m.p0 ? 'A' : null;
      return k && { key: k, price: k === 'H' ? c.px.h : c.px.a, why: hwhy(c, hm, k, 'the money moved the way v2 already leaned') }; } },
  { id: 'hfade', mk: ['1x2'], name: 'Fade the drift, v2 disagrees with it', rule: 'A team\'s moneyline chance fell 4+ points since the opening price but v2 still rates it at or above the price now',
    pick: (c, hm) => { const m = hm.ml; if (!m) return null; const k = m.d <= -4 && c.v2.w >= m.p1 ? 'H' : m.d >= 4 && c.v2.w <= m.p1 ? 'A' : null;
      return k && { key: k, price: k === 'H' ? c.px.h : c.px.a, why: hwhy(c, hm, k, 'the price drifted but v2 says it went too far') }; } },
  { id: 'htotals', mk: ['ou'], name: 'Goals move, v2 agrees', rule: 'The Over moved 3+ points since the opening price (either way) and v2, rated at the same line, is on the same side of the price now',
    pick: (c, hm) => { const o = hm.ou; if (!o || !c.ln || c.ln.v !== o.line || typeof c.v2.o !== 'number') return null;
      const k = o.d >= 3 && c.v2.o >= o.p1 ? 'O' : o.d <= -3 && c.v2.o <= o.p1 ? 'U' : null; if (!k) return null;
      return { key: k, price: k === 'O' ? c.px.to : c.px.tu, line: o.line, why: `Over ${o.line} ${r1(o.p0)}%→${r1(o.p1)}% (${o.d >= 0 ? '+' : ''}${r1(o.d)}), v2 ${r1(c.v2.o)}%: goals money agrees with v2` }; } },
];
export function decideNhl(items, cards, date, now = new Date(), benched = new Set()) {
  const held = new Set(items.map(b => `${b.date}|${b.league}|${b.gid}|${MKT(b.key)}`)), out = [];
  for (const c of cards) {
    if (!c || c.final || c.skipped || !c.px || !c.v2 || c.v2.w == null) continue;
    const hm = hockeyMove(c.px); if (!hm) continue;
    for (const r of NHL_RULES) {
      if (benched.has(r.id)) continue;
      const b = r.pick(c, hm); if (!b || !Number.isFinite(b.price)) continue;
      const k = `${date}|nhl|${c.id}|${MKT(b.key)}`; if (held.has(k)) continue;
      held.add(k);
      const mp = b.key === 'H' ? hm.ml.p1 : b.key === 'A' ? 100 - hm.ml.p1 : b.key === 'O' ? hm.ou.p1 : 100 - hm.ou.p1, v2p = b.key === 'H' ? c.v2.w : b.key === 'A' ? 100 - c.v2.w : b.key === 'O' ? c.v2.o : 100 - c.v2.o;
      out.push({ id: `${now.getTime().toString(36)}${out.length.toString(36)}${Math.random().toString(36).slice(2, 5)}`, at: now.toISOString(), sport: 'nhl', date, league: 'nhl', gid: c.id,
        home: c.home, away: c.away, hAbbr: c.hAbbr, aAbbr: c.aAbbr, leagueName: 'NHL', kickoff: c.kickoff, mins: Math.round((new Date(c.kickoff).getTime() - now.getTime()) / 60000),
        rule: r.id, key: b.key, ...(b.line != null ? { line: b.line } : {}), price: b.price, dk: b.price, bk: 'draftkings', mp: r1(mp), v2: r1(v2p), why: b.why, close: null, clv: null, res: null, units: null });
    }
  }
  return out;
}

// ---- settling: the closing price once the game has kicked off, the result once it is graded ----
const closeOf = (odds, key) => { const dkB = odds && (!odds.bk || odds.bk === 'draftkings'); const m = odds && ({ H: odds.h, D: odds.d, A: odds.a, O: odds.tl === 2.5 ? odds.to : null, U: odds.tl === 2.5 ? odds.tu : null, B: dkB ? odds.by : null, N: dkB ? odds.bn : null })[key]; return Number.isFinite(m) ? m : null; };
const VOID_AFTER = 4 * 86400000; // a game with no result 4 days after kickoff (postponed, abandoned) is voided: the stake comes back
const closeNhl = (px, b) => { const m = px && ({ H: px.h, A: px.a, O: px.tl === b.line ? px.to : null, U: px.tl === b.line ? px.tu : null })[b.key]; return Number.isFinite(m) ? m : null; };
export function settle(b, c, now = new Date()) {
  if (b.res) return false;
  if (b.sport === 'nhl') return settleNhl(b, c, now);
  let ch = false; const ko = new Date(b.kickoff).getTime();
  if (b.close == null && c && c.odds && now.getTime() >= ko) {
    const m = closeOf(c.odds, b.key);
    if (m != null) { b.close = m; b.clv = r1(100 * (dec(b.price) / dec(m) - 1)); if (b.dk != null) b.clvDk = r1(100 * (dec(b.dk) / dec(m) - 1)); ch = true; }
  }
  if (c && c.final) { const hit = leanHit(b.key, c.final); b.res = hit ? 'win' : 'loss'; b.units = +(hit ? dec(b.price) - 1 : -1).toFixed(3); if (b.dk != null) b.udk = +(hit ? dec(b.dk) - 1 : -1).toFixed(3); b.score = `${c.final.h}-${c.final.a}`; ch = true; }
  else if (now.getTime() - ko > VOID_AFTER) { b.res = 'void'; b.units = 0; ch = true; }
  return ch;
}

// Hockey: the close is the card's locked price (the lineup read, or ESPN's close for a game that missed it); a total exactly on a
// whole-number line is a push (void, stake back).
function settleNhl(b, c, now) {
  let ch = false; const ko = new Date(b.kickoff).getTime();
  if (b.close == null && c && c.px && (now.getTime() >= ko || c.final)) {
    const m = closeNhl(c.px, b);
    if (m != null) { b.close = m; b.clv = r1(100 * (dec(b.price) / dec(m) - 1)); b.clvDk = b.clv; ch = true; }
  }
  if (c && c.final) {
    const hit = hockeyHit(b.key, c.final, b.line);
    if (hit == null) { b.res = 'void'; b.units = 0; }
    else { b.res = hit ? 'win' : 'loss'; b.units = +(hit ? dec(b.price) - 1 : -1).toFixed(3); b.udk = b.units; }
    b.score = `${c.final.a}-${c.final.h}${c.final.last && c.final.last !== 'REG' ? ' ' + c.final.last : ''}`; ch = true;
  } else if (now.getTime() - ko > VOID_AFTER) { b.res = 'void'; b.units = 0; ch = true; }
  return ch;
}

// ---- the record ----
const blank = () => ({ n: 0, open: 0, settled: 0, wins: 0, units: 0, clvN: 0, clvSum: 0, beat: 0, shopN: 0, better: 0, gain: 0, dkN: 0, udk: 0, cdN: 0, cd: 0 });
function add(t, b) {
  t.n++;
  if (b.clv != null) { t.clvN++; t.clvSum += b.clv; t.beat += b.clv > 0 ? 1 : 0; }
  if (b.dk != null) { t.shopN++; const g = dec(b.price) / dec(b.dk) - 1; t.gain += g; t.better += g > 0 ? 1 : 0; }
  if (b.udk != null) { t.dkN++; t.udk += b.udk; }
  if (b.clvDk != null) { t.cdN++; t.cd += b.clvDk; }
  if (!b.res) { t.open++; return; }
  if (b.res === 'void') return;
  t.settled++; t.wins += b.res === 'win' ? 1 : 0; t.units += b.units;
}
const done = t => ({ n: t.n, open: t.open, settled: t.settled, wins: t.wins, hit: t.settled ? r1(100 * t.wins / t.settled) : null, units: +t.units.toFixed(2),
  roi: t.settled ? r1(100 * t.units / t.settled) : null, clv: t.clvN ? +(t.clvSum / t.clvN).toFixed(2) : null, clvN: t.clvN, beat: t.clvN ? r1(100 * t.beat / t.clvN) : null,
  // price shopping: how many bets found a better price than DraftKings, the average gain in payout, and units had they all gone on at DraftKings
  shop: t.shopN ? { n: t.shopN, better: t.better, gain: +(100 * t.gain / t.shopN).toFixed(2), dkN: t.dkN, unitsDk: +t.udk.toFixed(2), clvDk: t.cdN ? +(t.cd / t.cdN).toFixed(2) : null } : null });
export const isBenched = s => s.settled >= BENCH.n && s.clv != null && s.clv <= BENCH.clv && s.roi <= BENCH.roi;
// When the bet was placed: the early reads are where an edge over the close could come from.
const WHEN = [['early', '3+ hours before kickoff', m => m >= 180], ['late', 'last 3 hours (incl. the lineup read)', m => m < 180]];
export function summary(items0, old = [], rules0 = RULES, since = SINCE) {
  const items = [...items0, ...old.map(unpack)];
  const all = blank(), per = Object.fromEntries(rules0.map(r => [r.id, blank()])), when = Object.fromEntries(WHEN.map(w => [w[0], blank()])), mk = { '1x2': blank(), ou: blank(), btts: blank() };
  const curve = []; let cum = 0;
  for (const b of [...items].sort((x, y) => (x.kickoff < y.kickoff ? -1 : 1))) {
    add(all, b); if (per[b.rule]) add(per[b.rule], b); add(when[WHEN.find(w => w[2](b.mins))[0]], b); add(mk[MKT(b.key)], b);
    if (b.res === 'win' || b.res === 'loss') { cum += b.units; curve.push([b.kickoff.slice(0, 10), +cum.toFixed(2)]); }
  }
  const rules = rules0.map(r => { const s = done(per[r.id]); return { id: r.id, name: r.name, rule: r.rule, ...s, benched: !r.retired && isBenched(s), ...(r.retired ? { retired: r.retired } : {}) }; });
  return { since, bench: BENCH, all: done(all), rules, when: WHEN.map(w => ({ id: w[0], name: w[1], ...done(when[w[0]]) })), markets: { '1x2': done(mk['1x2']), ou: done(mk.ou), btts: done(mk.btts) }, curve, verdict: verdict(done(all)) };
}
// The Analyst's own read of its record, in one line. CLV first: it settles in tens of bets, profit needs hundreds.
export function verdict(s) {
  if (!s.n) return 'No bets yet. The Analyst bets as prices are read, when one of its rules fires.';
  if (s.clvN < 30) return `Too early to say: ${s.clvN} bet${s.clvN === 1 ? '' : 's'} with a closing price so far (30+ needed for the first read on closing-line value).`;
  const edge = s.clv > 0 ? `beating the closing price by ${s.clv}% a bet on average` : `losing ${-s.clv}% a bet to the closing price on average`;
  if (s.settled < 200) return `${s.clv > 0 ? 'Promising' : 'No edge yet'}: ${edge} (${s.beat}% of bets beat the close). Profit (${s.units >= 0 ? '+' : ''}${s.units}u over ${s.settled}) needs 200+ settled bets before it means much.`;
  return s.clv > 0 && s.roi > 0 ? `Edge holding: ${edge}, ${s.roi}% ROI over ${s.settled} bets.` : `No proven edge: ${edge}, ${s.roi}% ROI over ${s.settled} bets. Do not stake real money on these rules.`;
}

// ---- storage: one document ('analyst'), written only when a bet is placed or settles ----
const KEEP = 600, LOCK_MIN = 20; // LOCK_MIN: the price locks 20 minutes before kickoff (PRICE_LOCK in src/worker.js)
// Bets removed by hand (DROP): matched, then deleted the first time the record is read, and saved once. Oct 31, 2026: the Under on
// Colorado Rapids v Chicago Fire was placed 4 hours early, before the Under rule waited for the lineup read; the new rule looks at that
// game again at its lineup read. The early bet had mins 240; a lineup-read bet has 35 or less, so it is never matched.
const DROP = [b => b.rule === 'under' && b.date === '2026-10-31' && /Colorado Rapids/.test(b.home || '') && /Chicago Fire/.test(b.away || '') && b.mins > LATE];
export async function getAnalyst(env) {
  const doc = (await env.HUB.get('analyst', 'json')) || { v: 1, items: [] }, n = doc.items.length;
  doc.items = doc.items.filter(b => !DROP.some(f => f(b)));
  if (doc.items.length !== n) await env.HUB.put('analyst', JSON.stringify(doc));
  return doc;
}
// Past KEEP bets, settled ones are kept only as a short row for the record (the page lists the latest 300 in full).
const pack = b => [b.kickoff, b.rule, b.key, b.mins, b.res, b.units, b.clv, b.price, b.dk, b.udk, b.sport || null],
  unpack = ([kickoff, rule, key, mins, res, units, clv, price, dk, udk, sport]) => ({ kickoff, rule, key, mins, res, units, clv, ...(dk != null ? { price, dk, udk } : {}), ...(sport ? { sport } : {}) });
const save = (env, doc) => {
  const extra = doc.items.slice(KEEP); doc.items = doc.items.slice(0, KEEP).concat(extra.filter(b => !b.res));
  if (extra.length) doc.old = (doc.old || []).concat(extra.filter(b => b.res).map(pack));
  return env.HUB.put('analyst', JSON.stringify(doc));
};
const cardKey = (date, league, id) => `${date}|${league}|${id}`;
// Called after a league's price read and after it is graded (src/worker.js refreshOdds, gradeLeague) with that day's cards for the
// league: bets on games whose price is still open, and settles that day's bets whose games have started or finished.
// shop(cards) -> Map(cardId -> { H: { m, bk }, ... }) | null gives the best prices across books (src/worker.js analystShop); it is
// only asked when a rule has fired. sharp(cards) -> Map(cardId -> sharpOf) | null gives DraftKings against a sharp book for the
// stale-price rule (src/worker.js analystSharp); asked before the rules, only when a game's price is still open.
// Never throws: the price read must not depend on it.
export async function analystLook(env, date, cards, now = new Date(), shop = null, sharp = null) {
  try {
    const doc = await getAnalyst(env), byKey = new Map(cards.map(c => [cardKey(date, c.league, c.id), c]));
    let dirty = false;
    for (const b of doc.items) if (!b.res && b.sport !== 'nhl') { const c = byKey.get(cardKey(b.date, b.league, b.gid)); if (c && settle(b, c, now)) dirty = true; }
    const s = summary(soc(doc.items), soc(doc.old || [], true)), benched = new Set(s.rules.filter(r => r.benched).map(r => r.id));
    const live = cards.filter(c => c.odds && !c.final && new Date(c.kickoff).getTime() - now.getTime() > LOCK_MIN * 60000);
    let sp = null;
    if (sharp && live.length && !benched.has('stale')) { try { sp = await sharp(live); } catch (e) { sp = null; } }
    const fresh = decide(doc.items, live, date, now, benched, sp);
    if (fresh.length) {
      let best = null;
      if (shop) { try { const want = cards.filter(c => fresh.some(b => b.gid === c.id && b.key !== 'B' && b.key !== 'N')); best = want.length ? await shop(want) : null; } catch (e) { best = null; } }
      for (const b of fresh) {
        b.dk = b.price; b.bk = 'draftkings';
        const x = best && best.get(b.gid) && best.get(b.gid)[b.key];
        if (x && dec(x.m) > dec(b.price)) { b.price = x.m; b.bk = x.bk; }
      }
      doc.items.unshift(...fresh); dirty = true;
    }
    if (dirty) await save(env, doc);
    return { placed: fresh.length };
  } catch (e) { return { error: String(e && e.message || e).slice(0, 120) }; }
}
const isNhl = (x, packed) => (packed ? x[10] : x.sport) === 'nhl', soc = (xs, packed) => xs.filter(x => !isNhl(x, packed)), nhl = (xs, packed) => xs.filter(x => isNhl(x, packed));
// Hockey: called after a hockey day is saved (src/nhl.js nhlStep, nhlLineupStep) with that day's cards. Bets games whose price is
// still open and settles that day's hockey bets. Never throws: the hockey job must not depend on it.
export async function analystNhl(env, date, cards, now = new Date()) {
  try {
    const doc = await getAnalyst(env), byId = new Map(cards.map(c => [c.id, c]));
    let dirty = false;
    for (const b of doc.items) if (!b.res && b.sport === 'nhl' && b.date === date) { const c = byId.get(b.gid); if (c && settle(b, c, now)) dirty = true; }
    const s = summary(nhl(doc.items), nhl(doc.old || [], true), NHL_RULES, NHL_SINCE), benched = new Set(s.rules.filter(r => r.benched).map(r => r.id));
    const fresh = decideNhl(doc.items, cards.filter(c => new Date(c.kickoff).getTime() - now.getTime() > LOCK_MIN * 60000), date, now, benched);
    if (fresh.length) { doc.items.unshift(...fresh); dirty = true; }
    if (dirty) await save(env, doc);
    return { placed: fresh.length };
  } catch (e) { return { error: String(e && e.message || e).slice(0, 120) }; }
}
// The Analyst tab: settle anything finished (one read per day it has open bets on), save only if something changed.
export async function listAnalyst(env, now = new Date()) {
  const doc = await getAnalyst(env), open = doc.items.filter(b => !b.res);
  if (open.length) {
    const days = [...new Set(open.map(b => `${b.sport === 'nhl' ? 'nhl:day:' : 'day:'}${b.date}`))], got = await Promise.all(days.map(d => env.HUB.get(d, 'json'))), m = new Map();
    days.forEach((d, i) => { const h = d.startsWith('nhl:'), dt = d.slice(h ? 8 : 4); for (const c of got[i]?.cards || []) m.set(cardKey(dt, h ? 'nhl' : c.league, c.id), c); });
    let dirty = false; for (const b of open) if (settle(b, m.get(cardKey(b.date, b.league, b.gid)), now)) dirty = true;
    if (dirty) await save(env, doc);
  }
  const old = doc.old || [];
  // The same record split by market (Winner, Over/Under, Both score) for the Analyst tab's filter: each with only the rules that bet it
  const byMk = (items, old, rules, since, mks) => Object.fromEntries(mks.map(m => [m, summary(items.filter(b => MKT(b.key) === m), old.filter(b => MKT(b[2]) === m), rules.filter(r => r.mk.includes(m)), since)]));
  return { items: soc(doc.items).slice(0, 300), summary: summary(soc(doc.items), soc(old, true)), mk: byMk(soc(doc.items), soc(old, true), RULES, SINCE, ['1x2', 'ou', 'btts']), rules: RULES.map(r => ({ id: r.id, name: r.name, rule: r.rule })),
    nhl: { items: nhl(doc.items).slice(0, 300), summary: summary(nhl(doc.items), nhl(old, true), NHL_RULES, NHL_SINCE), mk: byMk(nhl(doc.items), nhl(old, true), NHL_RULES, NHL_SINCE, ['1x2', 'ou']), rules: NHL_RULES.map(r => ({ id: r.id, name: r.name, rule: r.rule })) } };
}
