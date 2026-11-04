// Scout, the free-rein analyst (Nov 3, 2026): a scheduled Claude session, not code in the Worker. It has no rules. It starts every look
// at the Hub's own models (this board), may check outside sources (news, injuries, lineups, weather, other models) to confirm or change
// its thesis, and logs paper bets with what it took and why. Its only job is to find an edge using the Hub's system.
//
//   Read:  GET /api/scout/board?k=<HEALTH_TOKEN> (read-only, the sweep's token): the next 36 hours of priced soccer and hockey games with
//          every model the Hub has on them, DraftKings' prices now and at the open, the Analyst's bets on them, and Scout's own record.
//   Write: Scout commits public/scout.json (only that file) to main, like the Brew pollers commit brew.json. The Worker never writes it.
//   Grade: on read, from the Hub's saved days (the same settle() as the Analyst: closing price, result, void after 4 days). No KV writes.
//
//   Honesty checks, done here and not trusted to the log: a bet logged later than LOCK_MIN minutes before kickoff counts as void
//   ('late'), the market must be one the Hub can grade (soccer: home / draw / away, Over / Under 2.5, Both score; hockey: moneyline,
//   the total on the card's line), and the stake is held to STAKE. Paper only: nothing here ever stakes real money.
import { settle } from './analyst.js';
import { devig } from './v6core.js';
import { shotsOver, SHOTS, SHOTS2, LEAGUES as SX1, LEAGUES2 as SX2, WATCH as SXW } from './shots.js';
import { leanPick, hockeyPick } from './pick.js';
const safe = f => { try { return f() || null; } catch (e) { return null; } };

export const SCOUT_SINCE = '2026-11-04';
export const STAKE = { min: 0.5, max: 3 };
export const LOCK_MIN = 20; // the Hub's price locks 20 minutes before kickoff (PRICE_LOCK)
export const WINDOW_H = 36;
const SOCCER_KEYS = new Set(['H', 'D', 'A', 'O', 'U', 'B', 'N']), NHL_KEYS = new Set(['H', 'A', 'O', 'U']);
export const MKT = (sport, k) => (sport === 'nhl' ? (k === 'O' || k === 'U' ? 'total' : 'moneyline') : k === 'O' || k === 'U' ? 'ou' : k === 'B' || k === 'N' ? 'btts' : '1x2');
export const LABEL = { H: 'Home', D: 'Draw', A: 'Away', O: 'Over', U: 'Under', B: 'Both score Yes', N: 'Both score No' };
const r1 = x => (x == null || !Number.isFinite(x) ? null : Math.round(10 * x) / 10);
const fin = x => Number.isFinite(x);
const pct = a => (a ? a.map(x => r1(100 * x)) : null);
const HOUR = 3600000;

// ---- the board: what Scout reads first ----
const mdl = m => m && Array.isArray(m.p) ? { p: m.p, over: m.over, btts: m.btts, ...(m.lam ? { lam: m.lam } : {}), ...(m.scores ? { top: m.scores.slice(0, 3) } : {}), ...(m.promo ? { promo: true } : {}) } : null;
const clean = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && !(typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)));
function soccerGame(date, c, now) {
  const o = c.odds || {}, own = !o.src; // a stand-in book's home / draw / away / total can't be closed against DraftKings: not offered
  const price = {}, open = {}, op = o.op || o.f || {}, ot = o.opt || (o.f && o.f.tl != null ? o.f : {});
  if (own && [o.h, o.d, o.a].every(fin)) Object.assign(price, { H: o.h, D: o.d, A: o.a });
  if (own && o.tl === 2.5 && fin(o.to) && fin(o.tu)) Object.assign(price, { O: o.to, U: o.tu });
  if (fin(o.by) && fin(o.bn)) Object.assign(price, { B: o.by, N: o.bn });
  if (!Object.keys(price).length) return null;
  if ([op.h, op.d, op.a].every(fin)) Object.assign(open, { H: op.h, D: op.d, A: op.a });
  if (ot.tl === 2.5 && fin(ot.to) && fin(ot.tu)) Object.assign(open, { O: ot.to, U: ot.tu });
  const fair = clean({ '1x2': price.H != null ? pct(devig(price.H, price.D, price.A)) : null, ou: price.O != null ? pct(devig(price.O, price.U)) : null, btts: price.B != null ? pct(devig(price.B, price.N)) : null,
    open1x2: open.H != null ? pct(devig(open.H, open.D, open.A)) : null, openOu: open.O != null ? pct(devig(open.O, open.U)) : null });
  let shots = null;
  if (c.sx && fair.ou) {
    const W = SX2.has(c.league) ? SHOTS2 : SHOTS, q = shotsOver(fair.ou[0], c.sx, W);
    shots = { over: r1(q), vsPrice: r1(q - fair.ou[0]), tested: SX1.has(c.league) || SX2.has(c.league), ...(SXW.has(c.league) ? { note: 'untested in this league' } : {}), sx: c.sx };
  } else if (c.sx) shots = { sx: c.sx, tested: SX1.has(c.league) || SX2.has(c.league) };
  const models = clean({ v2: mdl(c.v2), v4: mdl(c.v4), v5: mdl(c.v5), v6: mdl(c.v6), v4why: c.v4why || null,
    forebet: c.fb ? clean({ p: c.fb.p || null, over: c.fb.over ?? null, btts: c.fb.btts ?? null, score: c.fb.score || null }) : null,
    sportsmole: c.sm ? c.sm.text : null, shots, hubPick: safe(() => leanPick(c)) });
  return { sport: 'soccer', date, league: c.league, leagueName: c.leagueName, gid: c.id, kickoff: c.kickoff, minsToKickoff: Math.round((new Date(c.kickoff) - now) / 60000),
    home: c.home, away: c.away, ...(c.hRank != null ? { ranks: [c.hRank, c.aRank] } : {}), price, ...(fin(o.by) ? { bttsBook: o.bk || 'draftkings' } : {}), open, fair, priceAt: o.ts || null, models };
}
function nhlGame(date, c, now) {
  const x = c.px || {}, price = {}, open = {}, f = x.f || {};
  if (fin(x.h) && fin(x.a)) Object.assign(price, { H: x.h, A: x.a });
  if (fin(x.tl) && fin(x.to) && fin(x.tu)) Object.assign(price, { line: x.tl, O: x.to, U: x.tu });
  if (!Object.keys(price).length) return null;
  if (fin(f.h) && fin(f.a)) Object.assign(open, { H: f.h, A: f.a });
  if (fin(f.tl) && fin(f.to)) Object.assign(open, { line: f.tl, O: f.to, U: f.tu });
  const fair = clean({ ml: price.H != null ? pct(devig(price.H, price.A)) : null, total: price.O != null ? pct(devig(price.O, price.U)) : null, openMl: open.H != null ? pct(devig(open.H, open.A)) : null });
  const m = v => v && clean({ homeWin: v.w ?? null, over: v.o ?? null, line: v.line ?? null, topScore: v.sc ?? null });
  const models = clean({ v2: m(c.v2), v4: m(c.v4), v5: c.v5 ? m(c.v5) : null, goalsExpected: c.lam || null,
    shotsGoalie: c.sg ? clean({ over: c.sg.p, starters: c.sg.gs || null, note: 'tracking only, not yet tested on prices' }) : null,
    goalies: c.gk ? clean({ home: c.gk.h ? `${c.gk.h.n}${c.gk.h.st ? ' (' + c.gk.h.st + ')' : ''}` : null, away: c.gk.a ? `${c.gk.a.n}${c.gk.a.st ? ' (' + c.gk.a.st + ')' : ''}` : null }) : null,
    rest: c.rs || null, modelLine: c.ln ? c.ln.v : null, hubPick: safe(() => hockeyPick(c)) });
  return { sport: 'nhl', date, league: 'nhl', gid: c.id, kickoff: c.kickoff, minsToKickoff: Math.round((new Date(c.kickoff) - now) / 60000), home: c.home, away: c.away,
    abbr: [c.hAbbr, c.aAbbr], price, open, fair, priceAt: x.ts || null, models };
}
// days: { soccer: { date: cards }, nhl: { date: cards } }. Games from LOCK_MIN minutes to WINDOW_H hours away, priced, not skipped.
export function board(days, now = new Date(), analystItems = [], scoutBets = []) {
  const t = now.getTime(), out = [];
  const inWin = c => { const ko = new Date(c.kickoff).getTime(); return fin(ko) && ko - t > LOCK_MIN * 60000 && ko - t <= WINDOW_H * HOUR && !c.final && !c.skipped; };
  for (const [date, cards] of Object.entries(days.soccer || {})) for (const c of cards || []) if (inWin(c)) { const g = soccerGame(date, c, now); if (g) out.push(g); }
  for (const [date, cards] of Object.entries(days.nhl || {})) for (const c of cards || []) if (inWin(c)) { const g = nhlGame(date, c, now); if (g) out.push(g); }
  const k = (sport, date, league, gid) => `${sport}|${date}|${league}|${gid}`;
  const an = new Map(), sc = new Map();
  for (const b of analystItems) { const s = b.sport === 'nhl' ? 'nhl' : 'soccer', key = k(s, b.date, s === 'nhl' ? 'nhl' : b.league, b.gid); (an.get(key) || an.set(key, []).get(key)).push(`${b.rule}: ${LABEL[b.key] || b.key}${b.line ? ' ' + b.line : ''} at ${b.price > 0 ? '+' : ''}${b.price}`); }
  for (const b of scoutBets) { const key = k(b.sport, b.date, b.league, String(b.gid)); (sc.get(key) || sc.set(key, []).get(key)).push(`${LABEL[b.key] || b.key}${b.line ? ' ' + b.line : ''}`); }
  for (const g of out) { const key = k(g.sport, g.date, g.league, String(g.gid)); if (an.has(key)) g.analystBets = an.get(key); if (sc.has(key)) g.scoutHas = sc.get(key); }
  return out.sort((a, b) => (a.kickoff < b.kickoff ? -1 : a.kickoff > b.kickoff ? 1 : 0));
}

// ---- the log (public/scout.json) ----
// Check one logged bet before it counts. -> null when fine, else the reason it does not count
export function problem(b) {
  if (!b || typeof b !== 'object') return 'not a bet';
  if (b.sport !== 'soccer' && b.sport !== 'nhl') return 'sport must be soccer or nhl';
  for (const f of ['id', 'at', 'date', 'gid', 'kickoff', 'home', 'away', 'key', 'why']) if (b[f] == null || b[f] === '') return `missing ${f}`;
  if (!(b.sport === 'nhl' ? NHL_KEYS : SOCCER_KEYS).has(b.key)) return `market ${b.key} is not one the Hub grades for ${b.sport}`;
  if (b.sport === 'soccer' && !b.league) return 'missing league';
  if (b.sport === 'nhl' && (b.key === 'O' || b.key === 'U') && !fin(b.line)) return 'a hockey total needs its line';
  if (!fin(b.price) || (b.price > -100 && b.price < 100)) return 'price must be American odds (e.g. -120, +150)';
  if (!fin(b.stake) || b.stake < STAKE.min || b.stake > STAKE.max) return `stake must be ${STAKE.min} to ${STAKE.max} units`;
  const at = Date.parse(b.at), ko = Date.parse(b.kickoff);
  if (!fin(at) || !fin(ko)) return 'bad time';
  if (ko - at < LOCK_MIN * 60000) return 'late';
  return null;
}
export function validLog(doc) {
  const errs = [];
  if (!doc || doc.v !== 1 || !Array.isArray(doc.bets) || !Array.isArray(doc.runs)) return ['scout.json must be { v: 1, bets: [], runs: [] }'];
  const ids = new Set();
  doc.bets.forEach((b, i) => { const p = problem(b); if (p && p !== 'late') errs.push(`bet ${i} (${b && b.id}): ${p}`); if (b && ids.has(b.id)) errs.push(`bet ${i}: duplicate id ${b.id}`); if (b) ids.add(b.id); });
  doc.runs.forEach((r, i) => { if (!r || !r.at || typeof r.note !== 'string') errs.push(`run ${i}: needs at and note`); });
  return errs;
}

// ---- grading, on read ----
// cards: Map('soccer|date|league|gid' or 'nhl|date|nhl|gid' -> card). A bet already carrying res (copied back into the log by Scout) is
// left as it is. -> a copy of each bet with res, units (stake-weighted), close, clv, score, and status ('open' | 'settled' | 'void' | 'late' | 'bad')
export const cardKey = b => `${b.sport}|${b.date}|${b.sport === 'nhl' ? 'nhl' : b.league}|${b.gid}`;
export function grade(bets, cards, now = new Date()) {
  return bets.map(b0 => {
    const p = problem(b0);
    if (p) return { ...b0, status: p === 'late' ? 'late' : 'bad', note: p, res: 'void', units: 0 };
    const b = { ...b0, gid: String(b0.gid), bk: b0.bk || (b0.key === 'B' || b0.key === 'N' ? b0.bttsBook || 'draftkings' : 'draftkings') };
    if (b0.res) return { ...b, status: b0.res === 'void' ? 'void' : 'settled' };
    const one = { ...b, res: null, units: null, close: null, clv: null };
    delete one.dk; // Scout bets at the board's price: no price shopping
    settle(one, cards.get(cardKey(b)) || null, now);
    const units = one.units == null ? null : +(one.units * b.stake).toFixed(3);
    return { ...one, units, status: !one.res ? 'open' : one.res === 'void' ? 'void' : 'settled' };
  });
}
const blank = () => ({ bets: 0, open: 0, settled: 0, wins: 0, staked: 0, units: 0, clvN: 0, clvSum: 0, beat: 0 });
function add(t, b) {
  t.bets++;
  if (b.clv != null) { t.clvN++; t.clvSum += b.clv; t.beat += b.clv > 0 ? 1 : 0; }
  if (b.status === 'open') { t.open++; return; }
  if (b.status !== 'settled' || b.res === 'void') return;
  t.settled++; t.wins += b.res === 'win' ? 1 : 0; t.staked += b.stake; t.units += b.units;
}
const done = t => ({ bets: t.bets, open: t.open, settled: t.settled, wins: t.wins, hit: t.settled ? r1(100 * t.wins / t.settled) : null, staked: +t.staked.toFixed(2), units: +t.units.toFixed(2),
  roi: t.staked ? r1(100 * t.units / t.staked) : null, clv: t.clvN ? +(t.clvSum / t.clvN).toFixed(2) : null, beat: t.clvN ? r1(100 * t.beat / t.clvN) : null });
// The record: all, by sport, by market, and by lead (the Hub model or read Scout's thesis started from) and by how the outside check went.
export function record(graded) {
  const all = blank(), by = { sport: {}, market: {}, lead: {}, outside: {} }, curve = []; let cum = 0;
  const put = (g, k, b) => add(by[g][k] || (by[g][k] = blank()), b);
  for (const b of [...graded].sort((x, y) => (x.kickoff < y.kickoff ? -1 : 1))) {
    if (b.status === 'bad' || b.status === 'late') continue;
    add(all, b); put('sport', b.sport, b); put('market', MKT(b.sport, b.key), b); put('lead', String(b.lead || 'other').toLowerCase(), b); put('outside', b.outsideCheck || 'none', b);
    if (b.status === 'settled' && b.res !== 'void') { cum += b.units; curve.push([b.kickoff.slice(0, 10), +cum.toFixed(2)]); }
  }
  const fold = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, done(v)]));
  return { since: SCOUT_SINCE, all: done(all), sport: fold(by.sport), market: fold(by.market), lead: fold(by.lead), outside: fold(by.outside), curve };
}
// Days to read for grading: every day with a bet that has no result yet (soccer 'day:', hockey 'nhl:day:')
export const daysToRead = bets => [...new Set(bets.filter(b => !b.res && !problem(b)).map(b => `${b.sport === 'nhl' ? 'nhl:day:' : 'day:'}${b.date}`))];
export function cardsFrom(names, docs) {
  const m = new Map();
  names.forEach((n, i) => { const h = n.startsWith('nhl:'), date = n.slice(h ? 8 : 4); for (const c of docs[i]?.cards || []) m.set(`${h ? 'nhl' : 'soccer'}|${date}|${h ? 'nhl' : c.league}|${c.id}`, c); });
  return m;
}
