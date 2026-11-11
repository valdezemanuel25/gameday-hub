// Soccer Trends (Nov 8, 2026). Three situations that held up on seven European leagues' past matches (football-data.co.uk closing prices,
// found on 2023-25 and re-checked on 2025-26 and this season), and a read on each game of a day. Pure functions: the Worker loads the
// saved days and the page draws what comes back (public/index.html, Trends tab, right of Analyst). A read of past results, never a model
// bet: it feeds no pick.
//   roadloss2  the road team has lost its last 2+ league games -> the DRAW. 1,095 matches: 29.3% drew, the price expected 24.4%.
//   homeshort  the home-win price shortened 3+ points since the opening AND Over 2.5 is priced at 55%+ (margin removed) -> OVER 2.5.
//              584 matches: 69.9% went Over, the price expected 62.6%.
// Nov 11, 2026 rescan (tools/soccer-trend-scan, 8,389 matches of 2023-24 to Oct 2026, closing prices; found on 2023-25, checked on 2025-27):
// 107 conditions and their pairs on five markets, 7,185 tests. Nothing new cleared a strict bar, and at a loose bar 11 passed where luck
// gives about 11. What the scan did show is the two situations below, in a wider and a sharper form:
//   * the Draw edge starts at 2 straight road losses, not 3 (run of 0: +0.1 points over the price, 1: +0.4, exactly 2: +3.9, 3: +5.7,
//     4: +8.4, 5+: +5.3), in both periods (27.7% v 24.2%, then 32.5% v 24.7%) and above the price in all seven leagues. roadloss3
//     (429 matches) became roadloss2 (1,095): the same rule, 2.5 times as many games flagged.
//   * the Over edge of a shortened home price is all in games where Over is already priced at 55%+: 69.9% v 62.6% (584 matches, the same
//     in both periods); under 55% it was 47.8% v 47.7% (527 matches), nothing. So homeshort now needs the 55%.
// Also checked and NOT added: a road price up 3+ points -> road win looked good in the Hub's own saved games (40 of 67, priced 45%) but
// was flat on the 752 past matches (43.9% v 43.2%); the Hub-only signals (v2 / v4 / v6, Forebet, SportsMole, agreement, form, rank) gave
// 5 of 89 at |z| 2+ on 389 priced games where luck gives 4.
//   bttsno     BTTS Yes priced at 65%+ (margin removed) AND v4's BTTS No chance at or above the No price's breakeven -> BTTS NO. Shown only
//              when both hold, so it does not flag every game (about 1 game in 6 on a full slate; at 58.2%+ it was 1 in 2). Found in this
//              season's saved games (45 games with both prices and v4: No won 40%, the price needed 33%, +26% ROI on No), so it is untested
//              on past seasons (those files have no BTTS prices): Strong here means "passed this season's test", not "proven".
// Both are Watch: small edges, from one scan each. They were tested on EPL, Championship, Bundesliga, Ligue 1, Serie A, Eredivisie and La Liga;
// in any other league the read says so. Streaks are counted from the Hub's saved league games only.
const imp = o => (o > 0 ? 100 / (o + 100) : -o / (-o + 100));
const norm = a => { if (a.some(x => !Number.isFinite(x))) return null; const p = a.map(imp), t = p.reduce((s, x) => s + x, 0); return p.map(x => x / t); };
export const SITUATIONS = [
  { id: 'roadloss2', market: 'D', label: 'Road team lost its last 2+ league games', pick: 'Draw', hist: { n: 1095, rate: 29, priced: 24 } },
  { id: 'bttsno', market: 'B', label: 'BTTS Yes priced at 65%+ and v4 rates No above the breakeven', pick: 'BTTS No', hist: { n: 45, rate: 40, priced: 33 }, seasonOnly: true },
  { id: 'homeshort', market: 'O', label: 'Home-win price shortened 3+ points since the open and Over priced at 55%+', pick: 'Over 2.5', hist: { n: 584, rate: 70, priced: 63 } },
];
export const ROAD_LOSSES = 2, OVER_MIN = 0.55; // straight road losses for the Draw read; the Over price (margin removed) the home-shortened read needs
export const TESTED = new Set(['eng.1', 'eng.2', 'ger.1', 'esp.1', 'ita.1', 'fra.1', 'ned.1']);
const domestic = c => c && c.league && !String(c.league).startsWith('uefa') && c.home && c.away && c.kickoff;

// Every domestic card of every saved day with each side's current run of straight league losses just before that day.
export function withStreaks(days) {
  const out = [], run = new Map(); // `${league}|${team}` -> straight losses
  const sorted = (days || []).filter(d => d && d.date && Array.isArray(d.cards)).slice().sort((a, b) => a.date.localeCompare(b.date));
  for (const d of sorted) {
    const cards = d.cards.filter(domestic);
    for (const c of cards) out.push({ ...c, date: d.date, hl: run.get(`${c.league}|${c.home}`) || 0, al: run.get(`${c.league}|${c.away}`) || 0 });
    for (const c of cards) {
      if (!c.final || !Number.isFinite(c.final.h) || !Number.isFinite(c.final.a)) continue;
      const hk = `${c.league}|${c.home}`, ak = `${c.league}|${c.away}`;
      run.set(hk, c.final.h < c.final.a ? (run.get(hk) || 0) + 1 : 0); run.set(ak, c.final.a < c.final.h ? (run.get(ak) || 0) + 1 : 0);
    }
  }
  return out;
}
// Is the card in the situation? false, or { price, breakeven, priced } for the pick.
export function inSpot(s, c) {
  const o = c.odds; if (!o) return false;
  if (s.id === 'roadloss2') {
    if (!(c.al >= ROAD_LOSSES)) return false;
    const p = norm([o.h, o.d, o.a]); if (!p || !Number.isFinite(o.d)) return { price: null, breakeven: null, priced: null };
    return { price: o.d, breakeven: Math.round(imp(o.d) * 100), priced: p[1] };
  }
  if (s.id === 'bttsno') {
    const v = c.v4; if (!v || !Number.isFinite(v.btts) || !Number.isFinite(o.by) || !Number.isFinite(o.bn)) return false;
    const p = norm([o.by, o.bn]); if (!p || p[0] < 0.65) return false;
    const be = imp(o.bn) * 100; if (100 - v.btts < be) return false;
    return { price: o.bn, breakeven: Math.round(be), priced: p[1] };
  }
  if (s.id === 'homeshort') {
    const op = o.op; if (!op || o.tl !== 2.5) return false;
    const now = norm([o.h, o.d, o.a]), was = norm([op.h, op.d, op.a]); if (!now || !was || now[0] - was[0] < 0.03) return false;
    const ov = norm([o.to, o.tu]); if (!ov || ov[0] < OVER_MIN) return false;
    return { price: Number.isFinite(o.to) ? o.to : null, breakeven: Number.isFinite(o.to) ? Math.round(imp(o.to) * 100) : null, priced: ov ? ov[0] : null, moved: Math.round((now[0] - was[0]) * 100) };
  }
  return false;
}
function pickWon(s, c) {
  const f = c.final; if (!f || !Number.isFinite(f.h) || !Number.isFinite(f.a)) return null;
  return s.market === 'D' ? f.h === f.a : s.market === 'B' ? f.h === 0 || f.a === 0 : f.h + f.a > 2.5;
}
// How each situation has done in the Hub's own saved games (shown beside the past-seasons record).
export function live(ctx) {
  return SITUATIONS.map(s => { let n = 0, w = 0; for (const c of ctx) { if (!inSpot(s, c)) continue; const won = pickWon(s, c); if (won == null) continue; n++; if (won) w++; } return { id: s.id, w, n }; });
}
// A read for each domestic game of the date that is in a situation. Model: v4's draw (or Over) chance against the price's.
export function gameReads(ctx, date) {
  const lv = Object.fromEntries(live(ctx).map(x => [x.id, x]));
  return ctx.filter(c => c.date === date).map(c => {
    const reads = [];
    for (const s of SITUATIONS) {
      const sp = inSpot(s, c); if (!sp) continue;
      const v = c.v4 || c.v2, mp = v ? (s.market === 'D' ? v.p && v.p[1] : s.market === 'B' ? (Number.isFinite(v.btts) ? 100 - v.btts : null) : v.over) : null;
      const modelOk = mp == null || sp.priced == null ? null : mp >= Math.round(sp.priced * 100);
      reads.push({ won: pickWon(s, c), id: s.id, market: s.market, label: s.label, pick: s.pick, price: sp.price, breakeven: sp.breakeven, hist: s.hist, live: lv[s.id], moved: sp.moved ?? null, modelOk, model: mp == null || sp.priced == null ? null : `${mp}% vs ${Math.round(sp.priced * 100)}% price`, lab: modelOk === false ? 'Conflict' : s.seasonOnly ? 'Strong' : 'Watch', seasonOnly: !!s.seasonOnly, streak: s.id === 'roadloss2' ? c.al : null });
    }
    return { id: c.id, league: c.league, leagueName: c.leagueName || c.league, kickoff: c.kickoff, ko: c.ko, home: c.home, away: c.away, hId: c.hId, aId: c.aId, hRank: c.hRank, aRank: c.aRank, final: c.final || null, line: c.odds && c.odds.tl != null ? c.odds.tl : null, tested: TESTED.has(c.league), reads };
  }).filter(g => g.reads.length);
}
export function buildSoccerTrends(days, date) {
  const ctx = withStreaks(days), total = ctx.filter(c => c.date === date).length;
  return { date, games: total, days: new Set(ctx.map(c => c.date)).size, situations: SITUATIONS.map(s => ({ id: s.id, label: s.label, pick: s.pick, hist: s.hist })), live: live(ctx), cards: gameReads(ctx, date) };
}
