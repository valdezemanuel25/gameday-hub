// Soccer Trends (Nov 8, 2026). Two situations that held up on seven European leagues' past matches (football-data.co.uk closing prices,
// found on 2023-25 and re-checked on 2025-26 and this season), and a read on each game of a day. Pure functions: the Worker loads the
// saved days and the page draws what comes back (public/index.html, Trends tab, right of Analyst). A read of past results, never a model
// bet: it feeds no pick.
//   roadloss3  the road team has lost its last 3+ league games -> the DRAW. 472 matches: 28.8% drew, the price expected 23.7%.
//   homeshort  the home-win price shortened 3+ points since the opening -> OVER 2.5. 945 matches: 61% went Over, the price expected 56%.
// Both are Watch: small edges, from one scan each. They were tested on EPL, Championship, Bundesliga, Ligue 1, Serie A, Eredivisie and La Liga;
// in any other league the read says so. Streaks are counted from the Hub's saved league games only.
const imp = o => (o > 0 ? 100 / (o + 100) : -o / (-o + 100));
const norm = a => { if (a.some(x => !Number.isFinite(x))) return null; const p = a.map(imp), t = p.reduce((s, x) => s + x, 0); return p.map(x => x / t); };
export const SITUATIONS = [
  { id: 'roadloss3', market: 'D', label: 'Road team lost its last 3+ league games', pick: 'Draw', hist: { n: 472, rate: 29, priced: 24 } },
  { id: 'homeshort', market: 'O', label: 'Home-win price shortened 3+ points since the open', pick: 'Over 2.5', hist: { n: 945, rate: 61, priced: 56 } },
];
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
  if (s.id === 'roadloss3') {
    if (!(c.al >= 3)) return false;
    const p = norm([o.h, o.d, o.a]); if (!p || !Number.isFinite(o.d)) return { price: null, breakeven: null, priced: null };
    return { price: o.d, breakeven: Math.round(imp(o.d) * 100), priced: p[1] };
  }
  if (s.id === 'homeshort') {
    const op = o.op; if (!op || o.tl !== 2.5) return false;
    const now = norm([o.h, o.d, o.a]), was = norm([op.h, op.d, op.a]); if (!now || !was || now[0] - was[0] < 0.03) return false;
    const ov = norm([o.to, o.tu]); return { price: Number.isFinite(o.to) ? o.to : null, breakeven: Number.isFinite(o.to) ? Math.round(imp(o.to) * 100) : null, priced: ov ? ov[0] : null, moved: Math.round((now[0] - was[0]) * 100) };
  }
  return false;
}
function pickWon(s, c) {
  const f = c.final; if (!f || !Number.isFinite(f.h) || !Number.isFinite(f.a)) return null;
  return s.market === 'D' ? f.h === f.a : f.h + f.a > 2.5;
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
      const v = c.v4 || c.v2, mp = v ? (s.market === 'D' ? v.p && v.p[1] : v.over) : null;
      const modelOk = mp == null || sp.priced == null ? null : mp >= Math.round(sp.priced * 100);
      reads.push({ won: pickWon(s, c), id: s.id, market: s.market, label: s.label, pick: s.pick, price: sp.price, breakeven: sp.breakeven, hist: s.hist, live: lv[s.id], moved: sp.moved ?? null, modelOk, model: mp == null || sp.priced == null ? null : `${mp}% vs ${Math.round(sp.priced * 100)}% price`, lab: modelOk === false ? 'Conflict' : 'Watch', streak: s.id === 'roadloss3' ? c.al : null });
    }
    return { id: c.id, league: c.league, leagueName: c.leagueName || c.league, kickoff: c.kickoff, ko: c.ko, home: c.home, away: c.away, hId: c.hId, aId: c.aId, hRank: c.hRank, aRank: c.aRank, final: c.final || null, line: c.odds && c.odds.tl != null ? c.odds.tl : null, tested: TESTED.has(c.league), reads };
  }).filter(g => g.reads.length);
}
export function buildSoccerTrends(days, date) {
  const ctx = withStreaks(days), total = ctx.filter(c => c.date === date).length;
  return { date, games: total, days: new Set(ctx.map(c => c.date)).size, situations: SITUATIONS.map(s => ({ id: s.id, label: s.label, pick: s.pick, hist: s.hist })), live: live(ctx), cards: gameReads(ctx, date) };
}
