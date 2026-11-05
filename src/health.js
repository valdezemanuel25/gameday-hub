// Hub health for the nightly sweep (a scheduled task that only reads): GET /api/health with the HEALTH_TOKEN secret (?k=… or the
// x-health-token header), or signed in as usual. Reads only, never writes. What it looks for is what goes wrong quietly:
//   * games past kickoff with no result (grading stuck), games coming up in the priced leagues with no price,
//   * Analyst bets past kickoff with no closing price, or open long after the game,
//   * the daily KV write budget, Odds API credits, the last sync problem per league,
//   * each Analyst rule's record (the weekly check-in reads it), with how close it is to being benched.
import { getAnalyst, summary, RULES, NHL_RULES, SINCE, NHL_SINCE, BENCH, setOf, tiers } from './analyst.js';

const HOUR = 3600000;
const lbl = c => `${c.away && c.home ? `${c.home} v ${c.away}` : c.id} (${c.league || 'nhl'}, ${c.kickoff})`;

// A soccer card is priced only with a home / draw / away price from ESPN: a price record holding just Pinnacle's or the both-score
// price does not count (Nov 1, 2026: Frankfurt v Hamburg had no ESPN price, which a bare !c.odds check missed).
export const noSoccerPrice = c => !c.odds || ![c.odds.h, c.odds.d, c.odds.a].every(Number.isFinite);
// cards: { date: [cards] }; graceH: hours after kickoff a game should have a result by. standIn: games priced from another book than
// DraftKings (c.odds.src, src/data.js parseOdds), for a note: the board shows them, the Analyst sits them out.
export function gameChecks(days, now, { graceH, priced = null, needPrice = noSoccerPrice }) {
  const ungraded = [], unpriced = [], standIn = [];
  for (const [date, cards] of Object.entries(days)) for (const c of cards || []) {
    if (!c || c.skipped) continue;
    const ko = new Date(c.kickoff).getTime(); if (!Number.isFinite(ko)) continue;
    if (!c.final && now - ko > graceH * HOUR) ungraded.push({ date, game: lbl(c), hoursPast: Math.round((now - ko) / HOUR) });
    // a game with a model pick, starting in the next 1 to 24 hours, in a league that is priced, with no price yet
    if (!c.final && ko - now > HOUR && ko - now < 24 * HOUR && (c.v2 || c.v4) && (!priced || priced.has(c.league)) && needPrice(c)) unpriced.push({ date, game: lbl(c), hoursToGo: Math.round((ko - now) / HOUR) });
    if (!c.final && ko > now && c.odds && c.odds.src) standIn.push({ date, game: lbl(c), book: c.odds.src });
  }
  return { ungraded, unpriced, standIn };
}

export function analystChecks(doc, now) {
  const items = doc.items || [], old = doc.old || [];
  const noClose = [], stale = [];
  for (const b of items) {
    if (b.res) continue;
    const ko = new Date(b.kickoff).getTime();
    if (now - ko > 30 * 60000 && b.close == null) noClose.push({ bet: `${b.rule} ${b.key} ${b.home} v ${b.away}`, kickoff: b.kickoff });
    if (now - ko > 2 * 86400000) stale.push({ bet: `${b.rule} ${b.key} ${b.home} v ${b.away}`, kickoff: b.kickoff });
  }
  const rec = (its, ol, rules, since) => summary(its, ol, rules, since).rules.map(r => ({ id: r.id, ...(rules === RULES ? { set: setOf({ rule: r.id }) } : {}), name: r.name, bets: r.n, settled: r.settled, games: r.games, hit: r.hit, units: r.units, roi: r.roi, clv: r.clv, cv: r.cv, cvN: r.cvN, clvPin: r.clvPin, pinN: r.pinN,
    // the bench check counts top-division games (one per game) and judges on close value (Pinnacle's fair close first): src/analyst.js isBenched
    benched: r.benched, retired: r.retired || null, benchCheck: r.benchCheck, toBench: r.retired || r.benched ? null : Math.max(0, BENCH.n - r.benchCheck.games) }));
  return {
    noClose, stale,
    soccer: rec(items.filter(b => b.sport !== 'nhl'), old.filter(b => b[10] !== 'nhl'), RULES, SINCE),
    nhl: rec(items.filter(b => b.sport === 'nhl'), old.filter(b => b[10] === 'nhl'), NHL_RULES, NHL_SINCE),
    bench: BENCH,
    // each soccer rule set's record split into top divisions and second divisions (La Liga 2, 2. Bundesliga)
    tiers: Object.fromEntries([1, 2].map(n => { const its = items.filter(b => b.sport !== 'nhl' && setOf(b) === n), ol = old.filter(b => b[10] !== 'nhl' && setOf(b) === n), rs = RULES.filter(r => r.set === n);
      return [n, Object.fromEntries(Object.entries(tiers(its, ol, rs)).map(([t, a]) => [t, { bets: a.n, settled: a.settled, games: a.games, hit: a.hit, units: a.units, roi: a.roi, clv: a.clv, cv: a.cv, cvN: a.cvN }]))]; })),
  };
}

export async function hubHealth(env, { today, addDays, priced, readCredits, writesToday, writeLimit, saverAt }, now = Date.now()) {
  const t = today(), ds = [addDays(t, -1), t, addDays(t, 1)];
  const [sd, nd, errs, wt, doc] = await Promise.all([
    Promise.all(ds.map(d => env.HUB.get(`day:${d}`, 'json'))), Promise.all(ds.map(d => env.HUB.get(`nhl:day:${d}`, 'json'))),
    env.HUB.get('meta:errors', 'json'), writesToday(env.HUB, new Date(now)), getAnalyst(env, { readOnly: true })]);
  const soc = Object.fromEntries(ds.map((d, i) => [d, sd[i]?.cards || []])), hk = Object.fromEntries(ds.map((d, i) => [d, nd[i]?.cards || []]));
  return {
    at: new Date(now).toISOString(), today: t,
    soccer: gameChecks(soc, now, { graceH: 6, priced }),
    nhl: gameChecks(hk, now, { graceH: 5, needPrice: c => !c.px }),
    analyst: analystChecks(doc, now),
    writes: { used: wt.used, limit: writeLimit, by: wt.by, saver: wt.used >= saverAt * writeLimit }, // by = which job wrote what today; saver = background job skipping low-priority saves
    oddsApiCredits: await readCredits(0),
    oddsApiCredits2: env.ODDS_API_KEY_2 ? await readCredits(1) : null, // the backup key (ODDS_API_KEY_2); null when it is not set
    // only problems from the last 3 days: older entries are leagues ESPN stopped answering for long ago, not news
    syncProblems: Object.fromEntries(Object.entries(errs || {}).filter(([, e]) => e && e.at && now - Date.parse(e.at) <= 3 * 86400000)),
  };
}
