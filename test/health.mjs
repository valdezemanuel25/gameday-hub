// Hub health for the nightly sweep (src/health.js, GET /api/health): read-only, its own secret, and what it flags.
import worker from '../src/worker.js';
import { gameChecks, analystChecks } from '../src/health.js';
let fail = 0; const ok = (n, c, x = '') => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (c ? '' : ' ' + x)); if (!c) fail++; };
const H = 3600000, NOW = Date.parse('2026-10-31T23:00:00Z'), at = h => new Date(NOW + h * H).toISOString();
const g = gameChecks({ '2026-10-31': [
  { id: 'a', league: 'eng.1', home: 'A', away: 'B', kickoff: at(-8), final: null, v4: {} },          // 8h past, no result: stuck
  { id: 'b', league: 'eng.1', home: 'C', away: 'D', kickoff: at(-8), final: { h: 1, a: 0 }, v4: {} }, // graded
  { id: 'c', league: 'eng.1', home: 'E', away: 'F', kickoff: at(5), final: null, v4: {} },           // 5h to go, no price
  { id: 'd', league: 'eng.1', home: 'G', away: 'H', kickoff: at(5), final: null, v4: {}, odds: { h: -120, d: 250, a: 300 } },
  { id: 'p', league: 'eng.1', home: 'M', away: 'N', kickoff: at(5), final: null, v4: {}, odds: { pn: { h: -150, d: 280, a: 400 }, by: -130, bn: 105 } }, // Pinnacle / both-score only: no ESPN price
  { id: 's', league: 'eng.1', home: 'O', away: 'P', kickoff: at(5), final: null, v4: {}, odds: { h: -182, d: 375, a: 425, src: 'bet365' } }, // Bet365 stand-in
  { id: 'e', league: 'xyz.9', home: 'I', away: 'J', kickoff: at(5), final: null, v4: {} },           // league not priced
  { id: 'f', league: 'eng.1', home: 'K', away: 'L', kickoff: at(-9), final: null, skipped: true } ] }, NOW, { graceH: 6, priced: new Set(['eng.1']) });
ok('health: a game 8 hours past kickoff with no result is flagged; graded and skipped games are not', g.ungraded.length === 1 && /A v B/.test(g.ungraded[0].game) && g.ungraded[0].hoursPast === 8, JSON.stringify(g.ungraded));
ok('health: a priced-league game 5 hours out with no price is flagged; priced and unpriced-league games are not', g.unpriced.length === 2 && /E v F/.test(g.unpriced[0].game), JSON.stringify(g.unpriced));
ok('health: a game with only Pinnacle or both-score prices (no home / draw / away from ESPN) counts as unpriced', g.unpriced.some(x => /M v N/.test(x.game)), JSON.stringify(g.unpriced));
ok('health: a Bet365 stand-in counts as priced, and is listed as a stand-in with its book', !g.unpriced.some(x => /O v P/.test(x.game)) && g.standIn.length === 1 && /O v P/.test(g.standIn[0].game) && g.standIn[0].book === 'bet365', JSON.stringify(g.standIn));
// Sweep's panel (public/sweep.js readHealth) names the stand-in games and the unpriced ones
{
  const src = (await import('fs')).readFileSync(new URL('../public/sweep.js', import.meta.url), 'utf8'), m = src.match(/function readHealth\(h\) \{[\s\S]*?return out;\n  \}/);
  const readHealth = m && new Function(`${m[0]}; return readHealth;`)();
  const f = readHealth ? readHealth({ soccer: g, nhl: { ungraded: [], unpriced: [] }, analyst: { noClose: [], stale: [] }, syncProblems: {} }) : [];
  ok("Sweep's panel: lists the unpriced games and the Bet365 stand-in", f.some(x => /2 upcoming games with no price/.test(x)) && f.some(x => /1 upcoming game priced from Bet365, not DraftKings/.test(x)), JSON.stringify(f));
}
const a = analystChecks({ items: [
  { rule: 'under', key: 'U', home: 'A', away: 'B', kickoff: at(-2), close: null, res: null, mins: 60 },
  { rule: 'under', key: 'U', home: 'C', away: 'D', kickoff: at(-2), close: 120, res: null, mins: 60 },
  { rule: 'bttsNo', key: 'N', home: 'E', away: 'F', kickoff: at(-60), close: 110, res: null, mins: 60 },
  { rule: 'move', key: 'H', home: 'G', away: 'H', kickoff: at(-30), close: 110, clv: 1, res: 'win', units: 1.1, price: 110, mins: 60 } ] }, NOW);
ok('health: an open bet past kickoff with no closing price is flagged', a.noClose.length === 1 && /A v B/.test(a.noClose[0].bet));
ok('health: a bet still open 2+ days after kickoff is flagged', a.stale.length === 1 && /E v F/.test(a.stale[0].bet));
const fo = a.soccer.find(r => r.id === 'move');
ok('health: each rule\'s record, with bets left before the bench check', fo.settled === 1 && fo.units === 1.1 && fo.toBench === a.bench.n - 1 && !a.soccer.find(r => r.id === 'totals').retired, JSON.stringify(fo));
ok('health: each rule set\'s record split into top and second divisions', a.tiers && a.tiers[1].top && a.tiers[2].second && a.tiers[2].top.bets + a.tiers[2].second.bets === a.soccer.filter(r => r.set === 2).reduce((x, r) => x + r.bets, 0), JSON.stringify(a.tiers));
ok('health: each soccer rule carries its set (Analyst 1 original, Analyst 2 new); hockey rules carry none', fo.set === 2 && a.soccer.find(r => r.id === 'follow').set === 1 && a.soccer.every(r => r.set === 1 || r.set === 2) && a.nhl.every(r => !('set' in r)));
// the route: its own secret, read-only
const kv = new Map(), puts = []; kv.set('analyst', JSON.stringify({ v: 1, items: [] }));
const env = (o = {}) => ({ ADMIN_TOKEN: 'pw', ASSETS: { fetch: async () => new Response('x') }, HUB: { get: async (k, t) => { const v = kv.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => { puts.push(k); kv.set(k, v); }, list: async () => ({ keys: [] }) }, ...o });
const go = (path, e, h = {}) => worker.fetch(new Request('https://hub.test' + path, { headers: h }), e, { waitUntil() {} });
let r = await go('/api/health?k=nope', env({ HEALTH_TOKEN: 'hk' }));
ok('route: a wrong health key is refused', r.status === 401);
r = await go('/api/health?k=hk', env());
ok('route: no HEALTH_TOKEN set, the key does nothing', r.status === 401);
r = await go('/api/health?k=hk', env({ HEALTH_TOKEN: 'hk' }));
const j = r.status === 200 ? await r.json() : null;
ok('route: the right key reads the health report', j && j.soccer && j.nhl && j.analyst && j.writes && j.writes.limit === 1000, String(r.status));
ok('route: no backup Odds API key, no backup credits line', j && j.oddsApiCredits2 === null);
{ const r2 = await go('/api/health?k=hk', env({ HEALTH_TOKEN: 'hk', ODDS_API_KEY_2: 'b' })), j2 = await r2.json(); ok('route: the backup key\'s credits are listed when it is set', 'oddsApiCredits2' in j2 && j2.oddsApiCredits2 !== undefined); }
r = await go('/api/health', env({ HEALTH_TOKEN: 'hk' }), { 'x-health-token': 'hk' });
ok('route: the key also works as a header', r.status === 200);
kv.set('meta:errors', JSON.stringify({ 'ukr.1': { kind: 'sync', msg: 'old', at: '2020-01-01T00:00:00Z' }, 'eng.1': { kind: 'sync', msg: 'new', at: new Date().toISOString() } }));
r = await go('/api/health?k=hk', env({ HEALTH_TOKEN: 'hk' }));
ok('route: sync problems older than 3 days are left out', (j2 => Object.keys(j2.syncProblems).join() === 'eng.1')(await r.json()));
r = await go('/api/config?k=hk', env({ HEALTH_TOKEN: 'hk' }));
ok('route: the health key opens nothing else', r.status === 401);
ok('route: reading health writes nothing', puts.length === 0, puts.join());
// Scout's old log is deleted once by the cron, then left alone; after the cut-off date nothing is read
{ const { dropScout } = await import('../src/worker.js'); const m = new Map([['scout', '{}'], ['analyst', '{}']]); let reads = 0;
  const kvd = { get: async k => { reads++; return m.has(k) ? m.get(k) : null; }, delete: async k => { m.delete(k); } };
  const d1 = await dropScout(kvd, new Date('2026-11-05T12:00:00Z')), d2 = await dropScout(kvd, new Date('2026-11-05T12:05:00Z'));
  const r0 = reads, d3 = await dropScout({ ...kvd, get: async () => { reads++; return '{}'; } }, new Date('2026-11-12T00:00:00Z'));
  ok('Scout clean-up: deletes only the scout log, once; stops after the cut-off', d1 === true && d2 === false && !m.has('scout') && m.has('analyst') && d3 === false && reads === r0); }
// Nov 6, 2026: bets that fell back to DraftKings' close, rules benched on close value, and Pinnacle's state
{ const T = Date.parse('2026-11-06T06:00:00Z'), k = h => new Date(T + h * H).toISOString();
  const b = (o) => ({ rule: 'follow', key: 'H', home: 'A', away: 'B', price: 110, mins: 200, league: 'eng.1', date: '2026-11-05', ...o });
  const items = [b({ gid: 'p1', kickoff: k(-5), close: 100, clv: 1, clvPin: 0.5 }), b({ gid: 'p2', home: 'C', away: 'D', kickoff: k(-5), close: 100, clv: 1 }),
    b({ gid: 'p3', kickoff: k(-5), close: 100, clv: 1, league: 'ger.2' }), b({ gid: 'p4', kickoff: k(-100), close: 100, clv: 1, res: 'win', units: 1.1 }),
    b({ gid: 'p5', kickoff: k(-0.2), close: null })];
  const a2 = analystChecks({ items }, T);
  ok('health: a recent top-division bet with no Pinnacle close is listed (second divisions, old and unclosed bets are not)', a2.noPinClose.length === 1 && /C v D/.test(a2.noPinClose[0].bet), JSON.stringify(a2.noPinClose));
  const a2b = analystChecks({ items: [...items, b({ gid: 'p6', key: 'O', home: 'E', away: 'F', kickoff: k(-5), close: 100, clv: 1, pinNo: 'line' }),
    b({ gid: 'p7', key: 'B', home: 'G', away: 'H', kickoff: k(-5), close: 100, clv: 1, pinNo: 'btts' }), b({ gid: 'p8', home: 'I', away: 'J', kickoff: k(-5), close: 100, clv: 1, pinNo: 'read' })] }, T);
  ok('health: bets that can never have a Pinnacle close (another total line, no both-score price) are not listed; a missed read is, with why', a2b.noPinClose.length === 2 && !a2b.noPinClose.some(x => /E v F|G v H/.test(x.bet)) && a2b.noPinClose.find(x => /I v J/.test(x.bet)).why === 'read', JSON.stringify(a2b.noPinClose));
  const many = Array.from({ length: 40 }, (_, i) => b({ gid: 'g' + i, kickoff: new Date(T - (41 - i) * 86400000).toISOString(), close: 100, clv: -1, res: 'win', units: 1.1 }));
  const a3 = analystChecks({ items: many }, T), cb = a3.closeBenched.find(r => r.name.startsWith('Follow the move'));
  ok('health: a rule benched on close value is listed with the date it was benched', cb && cb.sport === 'soccer' && cb.since === many[39].kickoff && cb.games === 40 && cb.cv === -1, JSON.stringify(a3.closeBenched));
  ok('health: a rule benched by hand is not in that list', !a3.closeBenched.some(r => /Under/.test(r.name)));
  const { hubHealth } = await import('../src/health.js');
  const kv = { get: async () => null };
  const deps = { today: () => '2026-11-06', addDays: (d, n) => d, priced: null, readCredits: async () => null, writesToday: async () => ({ used: 0, by: {} }), writeLimit: 1000, saverAt: 0.8,
    pinnState: async () => ({ last: { at: '2026-11-06T05:50:00Z', n: 812 }, error: { error: 'PinnOdds: rate limited', limited: true, until: '2026-11-07T00:00:00.000Z' }, requestsToday: 100 }) };
  const hh = await hubHealth({ HUB: kv, PINNODDS_KEY: 'K' }, deps, T), h0 = await hubHealth({ HUB: kv }, deps, T);
  ok('health: Pinnacle\'s last list, its rate limit and today\'s requests are reported (null without the key)', hh.pinnacle && hh.pinnacle.limited && hh.pinnacle.until === '2026-11-07T00:00:00.000Z' && hh.pinnacle.requestsToday === 100 && hh.pinnacle.events === 812 && h0.pinnacle === null, JSON.stringify(hh.pinnacle));
  const src = (await import('fs')).readFileSync(new URL('../public/sweep.js', import.meta.url), 'utf8'), m = src.match(/function readHealth\(h\) \{[\s\S]*?return out;\n  \}/);
  const rh = new Function(`${m[0]}; return readHealth;`)(), base = { at: k(0), soccer: { ungraded: [], unpriced: [] }, nhl: { ungraded: [], unpriced: [] }, syncProblems: {} };
  const f1 = rh({ ...base, pinnacle: hh.pinnacle, analyst: { noClose: [], stale: [], noPinClose: [1, 2, 3], closeBenched: [{ sport: 'soccer', set: 1, name: 'Follow the move: x', since: k(-20), games: 40, cv: -1 }, { sport: 'nhl', name: 'Old one', since: k(-24 * 10), games: 40, cv: -2 }] } });
  ok("Sweep: flags the Pinnacle rate limit, missing Pinnacle closes and a rule benched in the last 3 days (not one benched long ago)", f1.some(x => /Pinnacle rate limited/.test(x)) && f1.some(x => /3 recent Analyst bets had no Pinnacle closing read/.test(x)) && f1.some(x => /benched set 1 Follow the move/.test(x)) && !f1.some(x => /Old one/.test(x)), JSON.stringify(f1));
  const f2 = rh({ ...base, pinnacle: null, analyst: { noClose: [], stale: [], noPinClose: [1, 2, 3, 4], closeBenched: [] } });
  ok('Sweep: without Pinnacle set up, missing Pinnacle closes are not news', f2.length === 0, JSON.stringify(f2)); }
console.log(fail ? `\n${fail} health check(s) FAILED` : '\nAll health checks passed'); process.exit(fail ? 1 : 0);
