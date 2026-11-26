// The Data Keeper (docs/data-keeper-plan.md): every game in the leagues we price should have what we track (prices, closing prices,
// Forebet, hockey goalies and line, a result, settled Analyst bets). This file finds what is missing; a later step re-runs the read that
// fills it, one repair per cron run, and logs what it did.
//
// The checker, missing(days, now, opts), lists what is missing, most urgent first. It reads only what it is handed: no fetches, no
// KV reads or writes. The tests for "missing" are the shared ones in src/gaps.js, so the Keeper, the health report (src/health.js) and
// the nightly stats files (src/sweepdata.js) agree on which game lacks what.
// The fixer, keeperStep(env, now), runs once per cron run (src/worker.js) after the price reads and the rotating job: it re-runs the read
// for the first item that is not waiting, if the run's call budget allows, and keeps what it did in one record, meta:keeper.
//
// Scope: the priced first divisions (FIRST_DIV), the two cups with a model (CUP_MODEL) and the NHL. La Liga 2 and 2. Bundesliga
// (SECOND_PRICED) are checked too but sorted after everything else, so they only get calls that are left over. Other leagues: nothing.
import { FIRST_DIV, CUP_MODEL, SECOND_PRICED, localDate } from './data.js';
import { LINEUP_READ, PRICE_LOCK, BTTS_RESERVE, refreshOdds, gradeLeague, oddsKeys, oddsCost, readCredits, putDay } from './jobs.js';
import { LINEUP_READ as NHL_READ, PRICE_LOCK as NHL_LOCK, nhlLineupStep, nhlForebet, nhlStep } from './nhl.js';
import { FB_PAGES, forebetFetch } from './forebetpage.js';
import { analystLook, analystNhl, getAnalyst } from './analyst.js';
import { getDay } from './fixes.js';
import { ask, budget, coalesce } from './store.js';
import { getPush, sendAll } from './push.js';
import { KEEPER_KEY, LOG_MAX, readKeeper, hourKey, HOURS_KEEP } from './keeperlog.js';
import { HOUR, koOf, tracked, closed, noResult, noSoccerPrice, noSoccerClose, noBtts, noForebet, noHockeyPrice, noGoalie, noLine, noHockeyClose, betOpen, betNoClose } from './gaps.js';

// A result is "too late" this many hours after kickoff: the game's 2 hours (GAME_HOURS) plus 4. Normal grading runs at kickoff + 5 h.
export const RESULT_H = 6;
// Results are looked for back to today - 3, as the grading slot does (src/jobs.js runSlot slot 1).
export const LOOK_BACK = 3;
// Prices and both-score prices are wanted for games starting in the next 24 hours.
export const PRICE_AHEAD_H = 24;
// The order repairs are tried in: games in the lineup window first (the closing read cannot wait), then overdue results, then the rest.
export const TIER = { lineup: 0, result: 1, other: 2 };

const TOP = new Set([...FIRST_DIV, ...CUP_MODEL.map(l => l.slug)]);
const addDays = (d, n) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
// In the lineup window: from `read` down to `lock` minutes before kickoff (soccer 30..20, hockey 45..20).
const inWindow = (mins, read, lock) => mins > lock && mins <= read;
// The repair an item needs, as one key: the read, the day, the league (Forebet: and the table), and |w for the lineup-window read, so a
// price given up on hours out is still tried at the closing read.
const rkOf = (fix, date, league, tier, kind) => fix ? `${fix}|${date}|${league}${fix === 'forebetFetch' ? `|${kind || '1x2'}` : ''}${tier === TIER.lineup ? '|w' : ''}` : null;
// Which soccer leagues are in scope: 'top', 'second', or null (left alone).
export const scopeOf = slug => TOP.has(slug) ? 'top' : SECOND_PRICED.has(slug) ? 'second' : null;

// days: { soccer: { date: [cards] }, nhl: { date: [cards] } } (either may be missing). now: a Date or ms.
// opts.bets: the Analyst's items (src/analyst.js getAnalyst().items), to find bets left open or settled with no close.
// Returns [{ key, rk, sport, date, league, id, game, kickoff, check, fix, tier, second, need?, why? }], most urgent first.
//   key:   "<check>|<date>|<id>", one game's gap
//   rk:    the repair that fills it, "<fix>|<date>|<league or nhl>[|w]" (|w: the lineup-window read). One read fills every game of a
//          league (or the whole hockey day), so the fixer keeps its back-off clock and its tries per repair, not per game.
//   check: price | close | btts | forebet | result | nhl-lineup | nhl-forebet | bet-settle | bet-close
//   fix:   the existing read that fills it (src/jobs.js, src/nhl.js, src/forebetpage.js, src/analyst.js); null when none can (why says so)
export function missing(days, now, { bets = [], resultH = RESULT_H, lookBack = LOOK_BACK } = {}) {
  const t = +now, today = localDate(new Date(t).toISOString()), from = addDays(today, -lookBack), out = [];
  const add = (sport, date, c, check, fix, tier, extra = {}) => { const league = sport === 'nhl' ? 'nhl' : c.league; out.push({
    key: `${check}|${date}|${c.id}`, rk: rkOf(fix, date, league, tier, extra.kind), sport, date, league, id: c.id, game: `${c.home} v ${c.away}`, kickoff: c.kickoff,
    check, fix, tier, second: sport !== 'nhl' && scopeOf(c.league) === 'second', ...extra }); };
  const recent = date => date >= from && date <= today;

  for (const [date, cards] of Object.entries((days && days.soccer) || {})) for (const c of cards || []) {
    if (!tracked(c) || !scopeOf(c.league)) continue;
    const ko = koOf(c); if (!Number.isFinite(ko)) continue;
    if (closed(c)) continue; // a result is in, or void (postponed, canceled...): nothing more to fill
    const mins = (ko - t) / 60000, ahead = mins > 0 && mins <= PRICE_AHEAD_H * 60, win = inWindow(mins, LINEUP_READ, PRICE_LOCK);
    // Price, close and both-score price are all filled by the league's price read (src/jobs.js refreshOdds): in the lineup window it is
    // the close too (noted in odds.cl, as the background job's own read), and it brings the both-score price, Pinnacle first.
    if (ahead && noSoccerPrice(c)) add('soccer', date, c, 'price', 'refreshOdds', win ? TIER.lineup : TIER.other);
    else if (win && noSoccerClose(c)) add('soccer', date, c, 'close', 'refreshOdds', TIER.lineup);
    // Both-score price only once the game has its ESPN price, and until the price locks (the price read leaves a game alone after that).
    if (ahead && mins > PRICE_LOCK && !noSoccerPrice(c) && noBtts(c)) add('soccer', date, c, 'btts', 'refreshOdds', win ? TIER.lineup : TIER.other);
    if (date === today && mins > 0 && FB_PAGES[c.league] && noForebet(c)) add('soccer', date, c, 'forebet', 'forebetFetch', TIER.other, { kind: '1x2' });
    if (recent(date) && noResult(c, t, resultH)) add('soccer', date, c, 'result', 'gradeLeague', TIER.result);
  }

  for (const [date, cards] of Object.entries((days && days.nhl) || {})) for (const c of cards || []) {
    if (!tracked(c)) continue;
    const ko = koOf(c); if (!Number.isFinite(ko) || closed(c)) continue;
    const mins = (ko - t) / 60000;
    if (inWindow(mins, NHL_READ, NHL_LOCK)) {
      const need = [noHockeyPrice(c) && 'price', noGoalie(c) && 'goalie', noLine(c) && 'line', !noHockeyPrice(c) && noHockeyClose(c) && 'close'].filter(Boolean);
      // The lineup read (src/nhl.js nhlLineupStep) fills the price, its close and the goalies. The line comes only from the hockey job's
      // full read (which also reads Forebet and goalie logs: too heavy for a repair), so a game missing just its line is listed, not repaired.
      const lineOnly = need.length === 1 && need[0] === 'line';
      if (need.length) add('nhl', date, c, 'nhl-lineup', lineOnly ? null : 'nhlLineupStep', TIER.lineup, { need, ...(lineOnly ? { why: 'the line is read by the hockey job, not the lineup read' } : {}) });
    }
    if (date === today && mins > 0 && noForebet(c)) add('nhl', date, c, 'nhl-forebet', 'nhlForebet', TIER.other);
    // The hockey results read (nhlStep) covers yesterday onward; an older game is listed, not repaired.
    if (recent(date) && noResult(c, t, resultH)) add('nhl', date, c, 'result', date >= addDays(today, -1) ? 'nhlStep' : null, TIER.result, date >= addDays(today, -1) ? {} : { why: 'the hockey results read covers yesterday onward' });
  }

  // Analyst bets of the last few days: still open though the game is closed, or settled with no closing price.
  for (const b of bets || []) {
    if (!b) continue;
    const sport = b.sport === 'nhl' ? 'nhl' : 'soccer';
    if (!recent(b.date) || (sport === 'soccer' && !scopeOf(b.league))) continue;
    const c = (((days && days[sport]) || {})[b.date] || []).find(x => x && x.id === b.gid);
    const check = betOpen(b, c) ? 'bet-settle' : betNoClose(b) ? 'bet-close' : null; if (!check) continue;
    // A settled bet's close cannot be filled: the settle pass (src/analyst.js settle) never goes back to a settled bet, so there is no read to re-run.
    const fix = check === 'bet-close' ? null : sport === 'nhl' ? 'analystNhl' : 'analystLook', league = sport === 'nhl' ? 'nhl' : b.league;
    out.push({ key: `${check}|${b.date}|${b.id}`, rk: rkOf(fix, b.date, league, TIER.other), sport, date: b.date, league, id: b.gid, game: `${b.home} v ${b.away}`,
      kickoff: b.kickoff, check, fix, tier: TIER.other, second: sport !== 'nhl' && scopeOf(b.league) === 'second',
      bet: b.id, rule: b.rule, market: b.key, ...(fix ? {} : { why: 'settled with no closing price; the settle pass never goes back to a settled bet' }) });
  }

  // Most urgent first: second divisions after everything else; then by tier; in the lineup window and for the rest the soonest kickoff
  // first, and for results the oldest kickoff first (the longest overdue).
  return out.sort((a, b) => (a.second - b.second) || (a.tier - b.tier) || (koOf(a) - koOf(b)) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

// ---- the fixer ----------------------------------------------------------------------------------------------------------------------
export { KEEPER_KEY, LOG_MAX, readKeeper };
// After a failed repair: wait 30 minutes, then 1 hour; the third failed try gives up (the nightly checks pick up give-ups). A repair that
// filled some of its games but not all waits the first step again without counting a try.
export const BACKOFF_MIN = [30, 60], GIVE_UP = 3;
// After a Forebet 403 or 429 (the Keeper's read, or Forebet's own job), no Forebet repair for this long.
export const BLOCK_H = 2;
// A source another job read this recently is not read again by the Keeper. A Forebet page read fine is left alone FB_OK_H hours, as
// Forebet's own job does (src/forebetpage.js forebetStep).
export const RECENT_MIN = 5, FB_OK_H = 3;
// The calls kept back for the alerts after the Keeper (src/push.js pushStep: one per game about to start).
export const ALERTS_KEEP = 4;

// Which source each read uses: a read of the same source (and league and day) by another job in this run means the Keeper leaves it be.
export const SOURCE = { refreshOdds: 'prices', gradeLeague: 'results', forebetFetch: 'forebet', nhlForebet: 'forebet', nhlLineupStep: 'nhl-prices', nhlStep: 'nhl-results', analystLook: 'analyst', analystNhl: 'analyst' };

// What this run's other jobs read, from their answers (src/worker.js): [{ source, league?, date? }]. No league means the whole source.
export function recentFrom(answers) {
  const out = [];
  for (const r of answers || []) {
    if (!r || typeof r !== 'object') continue;
    if (r.job === 'odds') for (const x of [r, ...(Array.isArray(r.also) ? r.also : [])]) { if (x.league && !x.waiting) out.push({ source: 'prices', league: x.league, date: x.date }); }
    if ((r.job === 'grade' || r.job === 'lead') && r.league) out.push({ source: 'results', league: r.league, date: r.date });
    if (r.job === 'forebet' || r.job === 'nhl-forebet') out.push({ source: 'forebet' });
    if (r.job === 'nhl-lineup') out.push({ source: 'nhl-prices' });
    if (r.job === 'nhl') { out.push({ source: 'nhl-results' }, { source: 'nhl-prices' }); if (r.forebet) out.push({ source: 'forebet' }); }
  }
  return out;
}
const isRecent = (recent, it) => recent.some(r => r.source === SOURCE[it.fix] && (!r.league || r.league === it.league) && (!r.date || r.date === it.date));

// Outside calls each read may make, an upper estimate asked of the run's budget before it runs (measured Nov 26, 2026). Only the hockey
// lineup read asks the budget itself (for its goalie logs), so it is the one held to the grant; the others are estimated high enough.
//   price read: ESPN, Pinnacle and the Odds API calls (oddsCost; none when the keys are left out for want of credits)
//   results: the league's ESPN day plus the moved-game lookup (6); hockey results: 3 scoreboards and up to 6 game summaries (9)
//   hockey lineup: the scoreboard plus 2 goalie logs; Forebet: one page; the Analyst's settle pass: KV only
export function costOf(it, env, days) {
  const cards = ((days && days[it.sport]) || {})[it.date] || [], open = cards.filter(c => c && !c.final && !c.void && (it.sport === 'nhl' || c.league === it.league)).length;
  switch (it.fix) {
    case 'refreshOdds': return oddsCost(env, Math.max(1, open));
    case 'gradeLeague': return 6;
    case 'nhlStep': return 9;
    case 'nhlLineupStep': return 3;
    case 'forebetFetch': case 'nhlForebet': return 1;
    default: return 0;
  }
}

// The reads themselves: the existing code, called as the cron calls it.
const closedOn = async (env, date, sport, league) => ((await getDay(env, date, sport))?.cards || []).filter(c => (sport === 'nhl' || c.league === league) && (c.final || c.void));
export const REPAIRS = {
  // The league's price read. Games still missing the both-score price have Pinnacle's 3-hour retry wait cleared first (odds.pbt), so the
  // read asks Pinnacle for it now (free) before the Odds API (only with credits above the reserve). The day is saved once, only if changed.
  refreshOdds: async (env, it, now) => {
    const batch = coalesce(async d => { const day = await getDay(env, d); for (const c of day?.cards || []) if (c.league === it.league && c.odds && c.odds.by == null) delete c.odds.pbt; return day; }, (d, day) => putDay(env, d, day));
    const r = await refreshOdds(env, it.date, it.league, now, fetch, batch); await batch.flush(); return r;
  },
  gradeLeague: (env, it, now) => gradeLeague(it.date, it.league, env, { force: true }, now),
  forebetFetch: (env, it, now) => forebetFetch(env, it.league, it.kind || '1x2', now),
  nhlForebet: (env, it, now) => nhlForebet(env, now),
  nhlLineupStep: (env, it, now) => nhlLineupStep(env, now),
  nhlStep: (env, it, now) => nhlStep(env, now, fetch, { mode: 'results' }),
  // The Analyst's settle pass, handed only the closed games of the day: with no open game in the list it places no new bet.
  analystLook: async (env, it, now) => analystLook(env, it.date, await closedOn(env, it.date, 'soccer', it.league), now),
  analystNhl: async (env, it, now) => analystNhl(env, it.date, await closedOn(env, it.date, 'nhl'), now),
};

// Is any Odds API key above the credit reserve? (Credits left are noted per key in the edge cache; unknown counts as yes, as
// src/jobs.js viaOddsKey does.) With none, the Keeper's price reads run without the keys, so they fill from ESPN and Pinnacle only.
async function creditsToSpend(env) {
  const keys = oddsKeys(env); if (!keys.length) return false;
  const v = env.BTTS_RESERVE, reserve = v == null || v === '' || Number.isNaN(+v) ? BTTS_RESERVE : +v;
  for (let i = 0; i < keys.length; i++) { const c = await readCredits(i); if (!c || c.left == null || c.left > reserve) return true; }
  return false;
}
// Forebet's last read of this page (meta:fb per league and table; nhl:fbmeta for hockey), by the Keeper or Forebet's own job:
// -> 'block' (refused with 403 / 429 in the last BLOCK_H hours), 'wait' (read in the last RECENT_MIN minutes, or read fine in the last
// FB_OK_H hours), or null (go ahead).
async function forebetState(env, it, t) {
  try {
    const m = it.fix === 'forebetFetch' ? ((await env.HUB.get('meta:fb', 'json')) || {})[`${it.league}|${it.kind || '1x2'}`] : await env.HUB.get('nhl:fbmeta', 'json');
    const at = m && Date.parse(m.at); if (!Number.isFinite(at)) return null;
    if (!m.ok && /\b(403|429)\b/.test(String(m.msg || '')) && t - at < BLOCK_H * 3600000) return { block: new Date(at + BLOCK_H * 3600000).toISOString() };
    if (t - at < RECENT_MIN * 60000 || (m.ok && t - at < FB_OK_H * 3600000)) return 'wait';
  } catch (e) { /* unknown: go ahead */ }
  return null;
}

// The days the checker looks at: soccer today - LOOK_BACK to tomorrow; hockey yesterday to tomorrow (its results read reaches no further).
async function loadDays(env, today) {
  const dates = n0 => { const a = []; for (let n = n0; n <= 1; n++) a.push(addDays(today, n)); return a; };
  const sd = dates(-LOOK_BACK), hd = dates(-1);
  const [s, h] = await Promise.all([Promise.all(sd.map(d => getDay(env, d).catch(() => null))), Promise.all(hd.map(d => getDay(env, d, 'nhl').catch(() => null)))]);
  return { soccer: Object.fromEntries(sd.map((d, i) => [d, s[i]?.cards || []])), nhl: Object.fromEntries(hd.map((d, i) => [d, h[i]?.cards || []])) };
}
const short = e => String((e && e.message) || e).slice(0, 120);
// The env a repair runs on: its own grant of calls, its KV writes counted (for the Keeper's write count), and without the Odds API keys
// when no key is above the credit reserve.
function repairEnv(env, cost, noKeys, w) {
  const base = env.HUB, hub = Object.create(base);
  hub.put = (...a) => { w.n++; return base.put(...a); };
  return { ...env, HUB: hub, BUDGET: budget(cost), ...(noKeys ? { ODDS_API_KEY: '', ODDS_API_KEY_2: '' } : {}) };
}
// Per-hour counts (UTC hours, the last HOURS_KEEP): f filled, m still missing, g gave up, s skipped, r repairs run, w KV writes caused
// (the repairs' saves and the Keeper's own record). The health report sums the last 24.
const bump = (st, t, k, n = 1) => { const h = hourKey(t), o = st.hours[h] || (st.hours[h] = {}); o[k] = (o[k] || 0) + n; };

// One repair per run, at most. opts (for tests and the worker): days / bets (already loaded), recent (recentFrom of this run's answers),
// repairs (the reads), send (the phone alert). Answers { job: 'keeper', missing, did, skipped, alerted } (and, not enumerated, the days as
// read after the repair, for the alerts step) and never throws an error of a read: a read that throws counts as a failed try.
// meta:keeper is written once, only when a repair ran, a new budget or block skip was noted, a give-up cleared, or an alert went out.
export async function keeperStep(env, now = new Date(), { days = null, bets = null, recent = [], repairs = REPAIRS, send = sendAlert } = {}) {
  const t = +now, today = localDate(new Date(t).toISOString());
  const st = await readKeeper(env);
  let D = days || await loadDays(env, today);
  const B = bets || (await getAnalyst(env, { readOnly: true }).catch(() => ({ items: [] }))).items || [];
  const list = missing(D, t, { bets: B });
  const out = { job: 'keeper', missing: list.length, did: null, skipped: null, alerted: 0 };
  // Back-off clocks of repairs no longer needed (filled by another job, or the game is past): dropped. A give-up dropped is news.
  const live = new Set(list.map(x => x.rk).filter(Boolean));
  let dirty = false;
  for (const k of Object.keys(st.wait)) if (!live.has(k)) { if (st.wait[k].gaveUp) dirty = true; delete st.wait[k]; }
  let blocked = st.blocks.forebet && Date.parse(st.blocks.forebet) > t;
  let spend = null, first = null, filled = new Set();
  const pass = (it, why) => { if (!first) first = { it, why }; };
  const seen = new Set();
  for (const it of list) {
    if (!it.fix || seen.has(it.rk)) continue; // nothing can fill it (listed for the health report), or its repair was looked at already
    seen.add(it.rk);
    const w = st.wait[it.rk];
    if (w && (w.gaveUp || Date.parse(w.next) > t)) continue;
    if (env.SAVER && it.tier !== TIER.lineup && it.tier !== TIER.result) continue; // saver mode: the lineup window and results only (not noted: saves are scarce)
    if (SOURCE[it.fix] === 'forebet' && !blocked) { const fs = await forebetState(env, it, t); if (fs && fs.block) { st.blocks.forebet = fs.block; blocked = true; dirty = true; } else if (fs === 'wait') continue; }
    if (blocked && SOURCE[it.fix] === 'forebet') { pass(it, 'block'); continue; }
    if (isRecent(recent, it)) continue; // the same read just ran: the other job did it
    if (it.fix === 'refreshOdds' && spend == null) spend = await creditsToSpend(env);
    const noKeys = it.fix === 'refreshOdds' && !spend, cost = costOf(it, noKeys ? { ...env, ODDS_API_KEY: '', ODDS_API_KEY_2: '' } : env, D);
    if (!ask(env, cost, ALERTS_KEEP)) { pass(it, 'budget'); continue; }
    const group = list.filter(x => x.rk === it.rk), wn = { n: 0 };
    let r = null, err = null;
    try { r = await repairs[it.fix](repairEnv(env, cost, noKeys, wn), it, new Date(t)); } catch (e) { err = short(e); }
    if (!err && r && r.error) err = short(r.error);
    if (err && SOURCE[it.fix] === 'forebet' && /\b(403|429)\b/.test(err)) st.blocks.forebet = new Date(t + BLOCK_H * 3600000).toISOString();
    // Filled or not: the same checker, on the day (and bets) read again after the read, for every game this repair covers
    const after = await readAfter(env, it, D, B, t);
    D = after.D;
    const left = new Set(missing(after.D, t, { bets: after.B }).filter(x => x.rk === it.rk).map(x => x.key));
    const got = group.filter(x => !left.has(x.key)); for (const x of got) filled.add(x.key);
    let result;
    if (got.length === group.length) { delete st.wait[it.rk]; result = 'filled'; }
    else if (got.length) { st.wait[it.rk] = { tries: (w && w.tries) || 0, next: new Date(t + BACKOFF_MIN[0] * 60000).toISOString(), why: 'partly filled' }; result = 'still missing'; }
    else {
      const tries = ((w && w.tries) || 0) + 1, why = err || (noKeys && oddsKeys(env).length ? 'still missing (no Odds API credits above the reserve: ESPN and Pinnacle only)' : 'still missing after the read');
      if (tries >= GIVE_UP) { st.wait[it.rk] = { tries, gaveUp: true, why, at: new Date(t).toISOString(), ...about(it, group) }; result = `gave up: ${why}`; }
      else { st.wait[it.rk] = { tries, next: new Date(t + BACKOFF_MIN[tries - 1] * 60000).toISOString(), why }; result = 'still missing'; }
    }
    out.did = { ...logOf(it, t, it.fix, result, group), filled: got.length };
    st.log.unshift(out.did);
    bump(st, t, 'r'); bump(st, t, 'f', got.length); if (/^gave up/.test(result)) bump(st, t, 'g', group.length - got.length); else bump(st, t, 'm', group.length - got.length);
    bump(st, t, 'w', wn.n); dirty = true;
    break;
  }
  if (!out.did && first) { // nothing run: note the most urgent repair passed over (budget, Forebet block), once per repair and reason
    const w = st.wait[first.it.rk] || {};
    out.skipped = logOf(first.it, t, first.it.fix, `skipped: ${first.why}`, list.filter(x => x.rk === first.it.rk));
    if (w.skip !== first.why) { st.wait[first.it.rk] = { ...w, skip: first.why }; st.log.unshift(out.skipped); bump(st, t, 's'); dirty = true; }
  }
  // The phone alert: a result still missing 6 hours after kickoff, or a priced game with no price 2 hours before it. Once per game and
  // problem; one message for all of them. A game this run just filled is not in it.
  const due = keeperAlerts(list.filter(x => !filled.has(x.key)), D, t, st.sent);
  if (due.length) {
    try { const r = await send(env, alertMessage(due), t); if (r && r.sent > 0) { for (const a of due) st.sent[a.key] = t; out.alerted = due.length; dirty = true; } } catch (e) { /* tried again next run */ }
  }
  if (dirty) { bump(st, t, 'w'); await saveKeeper(env, st, today, t); }
  Object.defineProperty(out, 'days', { value: D, enumerable: false });
  return out;
}
const about = (it, group) => ({ sport: it.sport, league: it.league, game: label(it, group), check: it.check, games: group.length });
const label = (it, group) => group.length > 1 ? `${it.game} and ${group.length - 1} more` : it.game;

// ---- the phone alerts ---------------------------------------------------------------------------------------------------------------
// A missing result is alerted from kickoff + RESULT_H up to ALERT_RESULT_MAX_H after kickoff (older ones are the nightly sweep's, so a
// first run does not alert on the last 3 days); a missing price from ALERT_PRICE_MIN minutes before kickoff. Second divisions never.
export const ALERT_RESULT_MAX_H = 24, ALERT_PRICE_MIN = 120, SENT_KEEP_D = 3;
export function keeperAlerts(list, days, now, sent = {}) {
  const t = +now, out = [], seen = new Set();
  const add = (problem, it, line) => { const key = `${problem}|${it.date}|${it.id}`; if (sent[key] || seen.has(key)) return; seen.add(key); out.push({ key, problem, sport: it.sport, line }); };
  for (const it of list || []) {
    if (it.second) continue;
    const ko = koOf(it), mins = (ko - t) / 60000;
    if (it.check === 'result' && t - ko <= ALERT_RESULT_MAX_H * HOUR) add('result', it, `${it.game}: no result ${Math.round((t - ko) / HOUR)} h after kickoff`);
    if (it.check === 'price' && mins > 0 && mins <= ALERT_PRICE_MIN) add('price', it, `${it.game}: no price, ${Math.round(mins)} min to kickoff`);
  }
  // Hockey prices: the checker asks for them at the lineup read only; the alert looks from 2 hours out.
  for (const [date, cards] of Object.entries((days && days.nhl) || {})) for (const c of cards || []) {
    if (!tracked(c) || closed(c) || !noHockeyPrice(c)) continue;
    const mins = (koOf(c) - t) / 60000;
    if (mins > 0 && mins <= ALERT_PRICE_MIN) add('price', { sport: 'nhl', date, id: c.id }, `${c.home} v ${c.away}: no price, ${Math.round(mins)} min to puck drop`);
  }
  return out;
}
export function alertMessage(due) {
  const lines = due.slice(0, 4).map(a => a.line), more = due.length - lines.length;
  return { title: due.length === 1 ? 'Data Keeper: a game needs a look' : `Data Keeper: ${due.length} games need a look`, body: lines.join('\n') + (more > 0 ? `\nand ${more} more` : ''),
    tag: 'keeper', url: due.every(a => a.sport === 'nhl') ? '/nhl' : '/soccer' };
}
// Sends to every device (src/push.js sendAll), one call each, from what is left of the run's calls.
async function sendAlert(env, msg, now) {
  const d = await getPush(env); if (!d.subs.length) return { sent: 0 };
  if (!ask(env, d.subs.length)) return { sent: 0, waiting: 'budget' };
  return sendAll(env, msg, now);
}
const logOf = (it, t, action, result, group = [it]) => ({ at: new Date(t).toISOString(), sport: it.sport, date: it.date, league: it.league, game: label(it, group), check: it.check, action, result, games: group.length });
// The repaired day (and the bets, for a bet repair) read again. On a failed read the old copy stands, so the gap counts as still there.
async function readAfter(env, it, D, B, t) {
  try {
    const day = await getDay(env, it.date, it.sport), D2 = { ...D, [it.sport]: { ...(D[it.sport] || {}), [it.date]: day?.cards || [] } };
    const B2 = it.check.startsWith('bet-') ? (await getAnalyst(env, { readOnly: true })).items || [] : B;
    return { D: D2, B: B2 };
  } catch (e) { return { D, B }; }
}
// One write: the last LOG_MAX actions, the back-off clocks of repairs still needed, the blocks, the alerts of the last 3 days and the
// hourly counts of the last HOURS_KEEP hours.
async function saveKeeper(env, st, today, t) {
  const sent = Object.fromEntries(Object.entries(st.sent || {}).filter(([, at]) => t - at <= SENT_KEEP_D * 86400000));
  const hours = Object.fromEntries(Object.entries(st.hours || {}).filter(([h]) => t - Date.parse(`${h}:00:00Z`) < HOURS_KEEP * 3600000));
  await env.HUB.put(KEEPER_KEY, JSON.stringify({ log: st.log.slice(0, LOG_MAX), wait: st.wait, blocks: st.blocks, sent, hours }));
}
