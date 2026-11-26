// The Data Keeper (docs/data-keeper-plan.md): every game in the leagues we price should have what we track (prices, closing prices,
// Forebet, hockey goalies and line, a result, settled Analyst bets). This file finds what is missing; a later step re-runs the read that
// fills it, one repair per cron run, and logs what it did.
//
// Step 1, the checker: missing(days, now, opts) lists what is missing, most urgent first. Reads only what it is handed: no fetches, no
// KV reads or writes. The tests for "missing" are the shared ones in src/gaps.js, so the Keeper, the health report (src/health.js) and
// the nightly stats files (src/sweepdata.js) agree on which game lacks what.
//
// Scope: the priced first divisions (FIRST_DIV), the two cups with a model (CUP_MODEL) and the NHL. La Liga 2 and 2. Bundesliga
// (SECOND_PRICED) are checked too but sorted after everything else, so they only get calls that are left over. Other leagues: nothing.
import { FIRST_DIV, CUP_MODEL, SECOND_PRICED, localDate } from './data.js';
import { LINEUP_READ, PRICE_LOCK } from './jobs.js';
import { LINEUP_READ as NHL_READ, PRICE_LOCK as NHL_LOCK } from './nhl.js';
import { FB_PAGES } from './forebetpage.js';
import { koOf, tracked, closed, noResult, noSoccerPrice, noSoccerClose, noBtts, noForebet, noHockeyPrice, noGoalie, noLine, noHockeyClose, betOpen, betNoClose } from './gaps.js';

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
//   fix:   the existing read that fills it (src/jobs.js, src/nhl.js, src/forebetpage.js, src/analyst.js)
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
    if (ahead && noBtts(c)) add('soccer', date, c, 'btts', 'refreshBtts', TIER.other);
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
      kickoff: b.kickoff, check, fix: sport === 'nhl' ? 'analystNhl' : 'analystLook', tier: TIER.other, second: sport !== 'nhl' && scopeOf(b.league) === 'second',
      bet: b.id, rule: b.rule, market: b.key });
  }

  // Most urgent first: second divisions after everything else; then by tier; in the lineup window and for the rest the soonest kickoff
  // first, and for results the oldest kickoff first (the longest overdue).
  return out.sort((a, b) => (a.second - b.second) || (a.tier - b.tier) || (koOf(a) - koOf(b)) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
