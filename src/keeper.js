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
import { LINEUP_READ, PRICE_LOCK, BTTS_RESERVE, refreshOdds, refreshCardClose, refreshBtts, gradeLeague, oddsKeys, oddsCost, readCredits } from './jobs.js';
import { LINEUP_READ as NHL_READ, PRICE_LOCK as NHL_LOCK, nhlLineupStep, nhlCardClose, nhlForebet, nhlStep } from './nhl.js';
import { FB_PAGES, forebetFetch } from './forebetpage.js';
import { analystLook, analystNhl, getAnalyst } from './analyst.js';
import { getDay } from './fixes.js';
import { ask, budget } from './store.js';
import { getPush, sendAll } from './push.js';
import { KEEPER_KEY, LOG_MAX, readKeeper } from './keeperlog.js';
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
// Which soccer leagues are in scope: 'top', 'second', or null (left alone).
export const scopeOf = slug => TOP.has(slug) ? 'top' : SECOND_PRICED.has(slug) ? 'second' : null;

// days: { soccer: { date: [cards] }, nhl: { date: [cards] } } (either may be missing). now: a Date or ms.
// opts.bets: the Analyst's items (src/analyst.js getAnalyst().items), to find bets left open or settled with no close.
// Returns [{ key, sport, date, league, id, game, kickoff, check, fix, tier, second, need? }], most urgent first.
//   key:   "<check>|<date>|<id>", what the fixer keeps its back-off clock under
//   check: price | close | btts | forebet | result | nhl-lineup | nhl-forebet | bet-settle | bet-close
//   fix:   the existing read that fills it (src/jobs.js, src/nhl.js, src/forebetpage.js, src/analyst.js); null when none can
export function missing(days, now, { bets = [], resultH = RESULT_H, lookBack = LOOK_BACK } = {}) {
  const t = +now, today = localDate(new Date(t).toISOString()), from = addDays(today, -lookBack), out = [];
  const add = (sport, date, c, check, fix, tier, extra = {}) => out.push({
    key: `${check}|${date}|${c.id}`, sport, date, league: sport === 'nhl' ? 'nhl' : c.league, id: c.id, game: `${c.home} v ${c.away}`, kickoff: c.kickoff,
    check, fix, tier, second: sport !== 'nhl' && scopeOf(c.league) === 'second', ...extra });
  const recent = date => date >= from && date <= today;

  for (const [date, cards] of Object.entries((days && days.soccer) || {})) for (const c of cards || []) {
    if (!tracked(c) || !scopeOf(c.league)) continue;
    const ko = koOf(c); if (!Number.isFinite(ko)) continue;
    if (closed(c)) continue; // a result is in, or void (postponed, canceled...): nothing more to fill
    const mins = (ko - t) / 60000, ahead = mins > 0 && mins <= PRICE_AHEAD_H * 60, win = inWindow(mins, LINEUP_READ, PRICE_LOCK);
    if (ahead && noSoccerPrice(c)) add('soccer', date, c, 'price', 'refreshOdds', win ? TIER.lineup : TIER.other); // in the window this read is the close too
    else if (win && noSoccerClose(c)) add('soccer', date, c, 'close', 'refreshCardClose', TIER.lineup);
    // Both-score price only once the game has its ESPN price: the price read brings it along (Pinnacle first, no credit), so a game
    // with neither waits for the price read instead of spending Odds API credits first.
    if (ahead && !noSoccerPrice(c) && noBtts(c)) add('soccer', date, c, 'btts', 'refreshBtts', TIER.other);
    if (date === today && mins > 0 && FB_PAGES[c.league] && noForebet(c)) add('soccer', date, c, 'forebet', 'forebetFetch', TIER.other, { kind: '1x2' });
    if (recent(date) && noResult(c, t, resultH)) add('soccer', date, c, 'result', 'gradeLeague', TIER.result);
  }

  for (const [date, cards] of Object.entries((days && days.nhl) || {})) for (const c of cards || []) {
    if (!tracked(c)) continue;
    const ko = koOf(c); if (!Number.isFinite(ko) || closed(c)) continue;
    const mins = (ko - t) / 60000;
    if (inWindow(mins, NHL_READ, NHL_LOCK)) {
      const need = [noHockeyPrice(c) && 'price', noGoalie(c) && 'goalie', noLine(c) && 'line', !noHockeyPrice(c) && noHockeyClose(c) && 'close'].filter(Boolean);
      // just the close missing: the one-game close read; anything else: the lineup read (price, goalies and line together)
      if (need.length) add('nhl', date, c, 'nhl-lineup', need.length === 1 && need[0] === 'close' ? 'nhlCardClose' : 'nhlLineupStep', TIER.lineup, { need });
    }
    if (date === today && mins > 0 && noForebet(c)) add('nhl', date, c, 'nhl-forebet', 'nhlForebet', TIER.other);
    if (recent(date) && noResult(c, t, resultH)) add('nhl', date, c, 'result', 'nhlStep', TIER.result);
  }

  // Analyst bets of the last few days: still open though the game is closed, or settled with no closing price.
  for (const b of bets || []) {
    if (!b) continue;
    const sport = b.sport === 'nhl' ? 'nhl' : 'soccer';
    if (!recent(b.date) || (sport === 'soccer' && !scopeOf(b.league))) continue;
    const c = (((days && days[sport]) || {})[b.date] || []).find(x => x && x.id === b.gid);
    const check = betOpen(b, c) ? 'bet-settle' : betNoClose(b) ? 'bet-close' : null; if (!check) continue;
    out.push({ key: `${check}|${b.date}|${b.id}`, sport, date: b.date, league: sport === 'nhl' ? 'nhl' : b.league, id: b.gid, game: `${b.home} v ${b.away}`,
      // A settled bet's close cannot be filled: the settle pass (src/analyst.js settle) never goes back to a settled bet, so there is no read to re-run.
      kickoff: b.kickoff, check, fix: check === 'bet-close' ? null : sport === 'nhl' ? 'analystNhl' : 'analystLook', tier: TIER.other, second: sport !== 'nhl' && scopeOf(b.league) === 'second',
      bet: b.id, rule: b.rule, market: b.key });
  }

  // Most urgent first: second divisions after everything else; then by tier; in the lineup window and for the rest the soonest kickoff
  // first, and for results the oldest kickoff first (the longest overdue).
  return out.sort((a, b) => (a.second - b.second) || (a.tier - b.tier) || (koOf(a) - koOf(b)) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

// ---- the fixer ----------------------------------------------------------------------------------------------------------------------
export { KEEPER_KEY, LOG_MAX, readKeeper };
// After a failed try: wait 30 minutes, then 1 hour, then 2 hours; the third failed try gives up (the nightly sweep picks up give-ups).
export const BACKOFF_MIN = [30, 60, 120], GIVE_UP = 3;
// After a Forebet 403 or 429, no Forebet repair for this long.
export const BLOCK_H = 2;
// A source another job read this recently is not read again by the Keeper.
export const RECENT_MIN = 5;
// The calls kept back for the alerts after the Keeper (src/push.js pushStep: one per game about to start).
export const ALERTS_KEEP = 4;

// Which source each read uses: a read of the same source (and league and day) by another job in this run, or in the last RECENT_MIN
// minutes, means the Keeper leaves it be.
export const SOURCE = { refreshOdds: 'prices', refreshCardClose: 'prices', refreshBtts: 'prices', gradeLeague: 'results', forebetFetch: 'forebet', nhlForebet: 'forebet',
  nhlLineupStep: 'nhl-prices', nhlCardClose: 'nhl-prices', nhlStep: 'nhl-results', analystLook: 'analyst', analystNhl: 'analyst' };
const PRICE_FIX = new Set(['refreshOdds', 'refreshCardClose', 'refreshBtts']);

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

// Outside calls each read may make (an upper estimate, asked of the run's budget before it runs). The read runs on exactly that grant,
// so a read that asks the budget itself (the hockey lineup read's goalie logs) stays inside it.
export function costOf(it, env, days) {
  const cards = ((days && days[it.sport]) || {})[it.date] || [], open = cards.filter(c => c && !c.final && !c.void && (it.sport === 'nhl' || c.league === it.league)).length;
  switch (it.fix) {
    case 'refreshOdds': return oddsCost(env, Math.max(1, open)) + 2; // + the shots context and the Analyst's price shopping
    case 'refreshCardClose': return oddsCost(env, 1);
    case 'refreshBtts': return 2 + Math.max(1, open);
    case 'gradeLeague': return 3;
    case 'nhlLineupStep': return 3;
    case 'nhlStep': return Math.min(20, 3 + 2 * open);
    case 'forebetFetch': case 'nhlForebet': case 'nhlCardClose': return 1;
    default: return 0; // the Analyst's settle pass reads KV only
  }
}

// The reads themselves: the existing code, called as the buttons and the cron call it.
const closedOn = async (env, date, sport, league) => ((await getDay(env, date, sport))?.cards || []).filter(c => (sport === 'nhl' || c.league === league) && (c.final || c.void));
export const REPAIRS = {
  refreshOdds: (env, it, now) => refreshOdds(env, it.date, it.league, now),
  refreshCardClose: (env, it, now) => refreshCardClose(env, it.date, it.league, it.id, now),
  refreshBtts: (env, it, now) => refreshBtts(env, it.date, it.league, now),
  gradeLeague: (env, it, now) => gradeLeague(it.date, it.league, env, { force: true }, now),
  forebetFetch: (env, it, now) => forebetFetch(env, it.league, it.kind || '1x2', now),
  nhlForebet: (env, it, now) => nhlForebet(env, now),
  nhlLineupStep: (env, it, now) => nhlLineupStep(env, now),
  nhlCardClose: (env, it, now) => nhlCardClose(env, it.date, it.id, now),
  nhlStep: (env, it, now) => nhlStep(env, now, fetch, { mode: 'results' }),
  // The Analyst's settle pass, handed only the closed games of the day: with no open game in the list it places no new bet.
  analystLook: async (env, it, now) => analystLook(env, it.date, await closedOn(env, it.date, 'soccer', it.league), now),
  analystNhl: async (env, it, now) => analystNhl(env, it.date, await closedOn(env, it.date, 'nhl'), now),
};

// Is any Odds API key above the credit reserve? (Credits left are noted per key in the edge cache; unknown counts as yes, as
// src/jobs.js viaOddsKey does.) With none, the Keeper's reads run without the keys, so they fill from ESPN and Pinnacle only.
async function creditsToSpend(env) {
  const keys = oddsKeys(env); if (!keys.length) return false;
  const v = env.BTTS_RESERVE, reserve = v == null || v === '' || Number.isNaN(+v) ? BTTS_RESERVE : +v;
  for (let i = 0; i < keys.length; i++) { const c = await readCredits(i); if (!c || c.left == null || c.left > reserve) return true; }
  return false;
}
// Read back a source's last read time (Forebet's own pages note it in meta:fb, hockey's in nhl:fbmeta), for the RECENT_MIN rule.
async function forebetReadAt(env, it) {
  try {
    if (it.fix === 'forebetFetch') { const m = await env.HUB.get('meta:fb', 'json'); return m && m[`${it.league}|${it.kind || '1x2'}`] ? Date.parse(m[`${it.league}|${it.kind || '1x2'}`].at) : NaN; }
    if (it.fix === 'nhlForebet') { const m = await env.HUB.get('nhl:fbmeta', 'json'); return m ? Date.parse(m.at) : NaN; }
  } catch (e) { /* unknown: go ahead */ }
  return NaN;
}

// The days the checker looks at: today - LOOK_BACK to tomorrow, both sports (read only; the cron's own reads are KV reads, not calls).
async function loadDays(env, today) {
  const dates = []; for (let n = -LOOK_BACK; n <= 1; n++) dates.push(addDays(today, n));
  const [s, h] = await Promise.all(['soccer', 'nhl'].map(sp => Promise.all(dates.map(d => getDay(env, d, sp).catch(() => null)))));
  return { soccer: Object.fromEntries(dates.map((d, i) => [d, s[i]?.cards || []])), nhl: Object.fromEntries(dates.map((d, i) => [d, h[i]?.cards || []])) };
}
const short = e => String((e && e.message) || e).slice(0, 120);

// One repair per run, at most. opts (for tests and the worker): days / bets (already loaded), recent (recentFrom of this run's answers),
// repairs (the reads), send (the phone alert). Answers { job: 'keeper', missing, did, skipped, alerted } and never throws an error of a read: a read that throws counts as a
// failed try. meta:keeper is written once, only when something was done, a new skip noted or an alert sent.
export async function keeperStep(env, now = new Date(), { days = null, bets = null, recent = [], repairs = REPAIRS, send = sendAlert } = {}) {
  const t = +now, today = localDate(new Date(t).toISOString());
  const st = await readKeeper(env);
  const D = days || await loadDays(env, today);
  const B = bets || (await getAnalyst(env, { readOnly: true }).catch(() => ({ items: [] }))).items || [];
  const list = missing(D, t, { bets: B });
  const out = { job: 'keeper', missing: list.length, did: null, skipped: null, alerted: 0 };
  const blocked = st.blocks.forebet && Date.parse(st.blocks.forebet) > t;
  let spend = null, first = null, filledKey = null; // first: the most urgent item passed over, and why (noted once per item and reason)
  const pass = (it, why) => { if (!first) first = { it, why }; };
  for (const it of list) {
    const w = st.wait[it.key];
    if (w && (w.gaveUp || Date.parse(w.next) > t)) continue;
    if (!it.fix) { // nothing can fill it: given up at once, with the reason
      st.wait[it.key] = { tries: 0, gaveUp: true, why: 'settled with no closing price; the settle pass never goes back to a settled bet', at: new Date(t).toISOString(), ...about(it) };
      out.did = logOf(it, t, 'none', `gave up: ${st.wait[it.key].why}`); st.log.unshift(out.did); break;
    }
    if (env.SAVER && it.tier !== TIER.lineup && it.tier !== TIER.result) { pass(it, 'saver'); continue; } // saver mode: the lineup window and results only
    if (blocked && SOURCE[it.fix] === 'forebet') { pass(it, 'block'); continue; }
    if (isRecent(recent, it)) continue; // the same read just ran: not a skip, the other job did it
    if (SOURCE[it.fix] === 'forebet') { const last = await forebetReadAt(env, it); if (Number.isFinite(last) && t - last < RECENT_MIN * 60000) continue; }
    const cost = costOf(it, env, D);
    if (!ask(env, cost, ALERTS_KEEP)) { pass(it, 'budget'); continue; }
    if (PRICE_FIX.has(it.fix) && spend == null) spend = await creditsToSpend(env);
    // the read runs on its grant only; with no Odds API key above the reserve it runs without the keys (ESPN and Pinnacle only)
    const renv = { ...env, BUDGET: budget(cost), ...(PRICE_FIX.has(it.fix) && !spend ? { ODDS_API_KEY: '', ODDS_API_KEY_2: '' } : {}) };
    let r = null, err = null;
    try { r = await repairs[it.fix](renv, it, new Date(t)); } catch (e) { err = short(e); }
    if (!err && r && r.error) err = short(r.error);
    if (err && SOURCE[it.fix] === 'forebet' && /\b(403|429)\b/.test(err)) st.blocks.forebet = new Date(t + BLOCK_H * 3600000).toISOString();
    // Filled or not: the same checker, on the day (and bets) read again after the read
    const still = await stillMissing(env, it, D, B, t);
    let result;
    if (!still) { delete st.wait[it.key]; result = 'filled'; filledKey = it.key; }
    else {
      const tries = ((w && w.tries) || 0) + 1, why = err || 'still missing after the read';
      if (tries >= GIVE_UP) { st.wait[it.key] = { tries, gaveUp: true, why, at: new Date(t).toISOString(), ...about(it) }; result = `gave up: ${why}`; }
      else { st.wait[it.key] = { tries, next: new Date(t + BACKOFF_MIN[tries - 1] * 60000).toISOString(), why }; result = 'still missing'; }
    }
    out.did = logOf(it, t, it.fix, result); st.log.unshift(out.did);
    break;
  }
  if (!out.did && first) { // nothing run: note the most urgent item passed over, once per item and reason
    const w = st.wait[first.it.key] || {};
    out.skipped = logOf(first.it, t, first.it.fix, `skipped: ${first.why}`);
    if (w.skip === first.why) first = null; else { st.wait[first.it.key] = { ...w, skip: first.why }; st.log.unshift(out.skipped); }
  }
  // The phone alert: a result still missing 6 hours after kickoff, or a priced game with no price 2 hours before it. Once per game and
  // problem; one message for all of them. A game this run just filled is not in it.
  const due = keeperAlerts(list.filter(x => x.key !== filledKey), D, t, st.sent); let sent = false;
  if (due.length) {
    try { const r = await send(env, alertMessage(due), t); if (r && r.sent > 0) { for (const a of due) st.sent[a.key] = t; out.alerted = due.length; sent = true; } } catch (e) { /* tried again next run */ }
  }
  if (out.did || first || sent) await saveKeeper(env, st, today, t);
  return out;
}
const about = it => ({ sport: it.sport, league: it.league, game: it.game, check: it.check });

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
const logOf = (it, t, action, result) => ({ at: new Date(t).toISOString(), sport: it.sport, date: it.date, league: it.league, game: it.game, check: it.check, action, result });
async function stillMissing(env, it, D, B, t) {
  try {
    const day = await getDay(env, it.date, it.sport), D2 = { ...D, [it.sport]: { ...(D[it.sport] || {}), [it.date]: day?.cards || [] } };
    const B2 = it.check.startsWith('bet-') ? (await getAnalyst(env, { readOnly: true })).items || [] : B;
    return missing(D2, t, { bets: B2 }).some(x => x.key === it.key);
  } catch (e) { return true; }
}
// One write: the last LOG_MAX actions, the back-off clocks of games still in the look-back, the blocks, and the alerts of the last 3 days.
async function saveKeeper(env, st, today, t) {
  const from = addDays(today, -LOOK_BACK - 1);
  const wait = Object.fromEntries(Object.entries(st.wait).filter(([k]) => (k.split('|')[1] || '') >= from));
  const sent = Object.fromEntries(Object.entries(st.sent || {}).filter(([, at]) => t - at <= SENT_KEEP_D * 86400000));
  await env.HUB.put(KEEPER_KEY, JSON.stringify({ log: st.log.slice(0, LOG_MAX), wait, blocks: st.blocks, sent }));
}
