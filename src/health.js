// Hub health for the nightly sweep (a scheduled task that only reads): GET /api/health with the HEALTH_TOKEN secret (?k=… or the
// x-health-token header), or signed in as usual. Reads only, never writes. What it looks for is what goes wrong quietly:
//   * games past kickoff with no result (grading stuck), games coming up in the priced leagues with no price,
//   * Analyst bets past kickoff with no closing price, or open long after the game,
//   * the daily KV write budget, Odds API credits, the last sync problem per league,
//   * each Analyst rule's record (the weekly check-in reads it), with how close it is to being benched.
import { getAnalyst, summary, RULES, NHL_RULES, SINCE, NHL_SINCE, BENCH } from './analyst.js';

const HOUR = 3600000;
const lbl = c => `${c.away && c.home ? `${c.home} v ${c.away}` : c.id} (${c.league || 'nhl'}, ${c.kickoff})`;

// cards: { date: [cards] }; graceH: hours after kickoff a game should have a result by
export function gameChecks(days, now, { graceH, priced = null, needPrice = c => !c.odds }) {
  const ungraded = [], unpriced = [];
  for (const [date, cards] of Object.entries(days)) for (const c of cards || []) {
    if (!c || c.skipped) continue;
    const ko = new Date(c.kickoff).getTime(); if (!Number.isFinite(ko)) continue;
    if (!c.final && now - ko > graceH * HOUR) ungraded.push({ date, game: lbl(c), hoursPast: Math.round((now - ko) / HOUR) });
    // a game with a model pick, starting in the next 1 to 24 hours, in a league that is priced, with no price yet
    if (!c.final && ko - now > HOUR && ko - now < 24 * HOUR && (c.v2 || c.v4) && (!priced || priced.has(c.league)) && needPrice(c)) unpriced.push({ date, game: lbl(c), hoursToGo: Math.round((ko - now) / HOUR) });
  }
  return { ungraded, unpriced };
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
  const rec = (its, ol, rules, since) => summary(its, ol, rules, since).rules.map(r => ({ id: r.id, name: r.name, bets: r.n, settled: r.settled, hit: r.hit, units: r.units, roi: r.roi, clv: r.clv,
    benched: r.benched, retired: r.retired || null, toBench: r.retired || r.benched ? null : Math.max(0, BENCH.n - r.settled) }));
  return {
    noClose, stale,
    soccer: rec(items.filter(b => b.sport !== 'nhl'), old.filter(b => b[10] !== 'nhl'), RULES, SINCE),
    nhl: rec(items.filter(b => b.sport === 'nhl'), old.filter(b => b[10] === 'nhl'), NHL_RULES, NHL_SINCE),
    bench: BENCH,
  };
}

export async function hubHealth(env, { today, addDays, priced, readCredits, pendingWrites, writeLimit }, now = Date.now()) {
  const t = today(), ds = [addDays(t, -1), t, addDays(t, 1)];
  const [sd, nd, errs, w, doc] = await Promise.all([
    Promise.all(ds.map(d => env.HUB.get(`day:${d}`, 'json'))), Promise.all(ds.map(d => env.HUB.get(`nhl:day:${d}`, 'json'))),
    env.HUB.get('meta:errors', 'json'), env.HUB.get('meta:writes', 'json'), getAnalyst(env, { readOnly: true })]);
  const soc = Object.fromEntries(ds.map((d, i) => [d, sd[i]?.cards || []])), hk = Object.fromEntries(ds.map((d, i) => [d, nd[i]?.cards || []]));
  const ud = new Date(now).toISOString().slice(0, 10);
  return {
    at: new Date(now).toISOString(), today: t,
    soccer: gameChecks(soc, now, { graceH: 6, priced }),
    nhl: gameChecks(hk, now, { graceH: 5, needPrice: c => !c.px }),
    analyst: analystChecks(doc, now),
    writes: { used: (w && w.d === ud ? w.n : 0) + await pendingWrites(ud), limit: writeLimit },
    oddsApiCredits: await readCredits(0),
    // only problems from the last 3 days: older entries are leagues ESPN stopped answering for long ago, not news
    syncProblems: Object.fromEntries(Object.entries(errs || {}).filter(([, e]) => e && e.at && now - Date.parse(e.at) <= 3 * 86400000)),
  };
}
