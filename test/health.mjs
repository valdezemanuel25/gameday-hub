// Hub health for the nightly sweep (src/health.js, GET /api/health): read-only, its own secret, and what it flags.
import worker from '../src/worker.js';
import { gameChecks, analystChecks } from '../src/health.js';
let fail = 0; const ok = (n, c, x = '') => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (c ? '' : ' ' + x)); if (!c) fail++; };
const H = 3600000, NOW = Date.parse('2026-10-31T23:00:00Z'), at = h => new Date(NOW + h * H).toISOString();
const g = gameChecks({ '2026-10-31': [
  { id: 'a', league: 'eng.1', home: 'A', away: 'B', kickoff: at(-8), final: null, v4: {} },          // 8h past, no result: stuck
  { id: 'b', league: 'eng.1', home: 'C', away: 'D', kickoff: at(-8), final: { h: 1, a: 0 }, v4: {} }, // graded
  { id: 'c', league: 'eng.1', home: 'E', away: 'F', kickoff: at(5), final: null, v4: {} },           // 5h to go, no price
  { id: 'd', league: 'eng.1', home: 'G', away: 'H', kickoff: at(5), final: null, v4: {}, odds: { h: 1 } },
  { id: 'e', league: 'xyz.9', home: 'I', away: 'J', kickoff: at(5), final: null, v4: {} },           // league not priced
  { id: 'f', league: 'eng.1', home: 'K', away: 'L', kickoff: at(-9), final: null, skipped: true } ] }, NOW, { graceH: 6, priced: new Set(['eng.1']) });
ok('health: a game 8 hours past kickoff with no result is flagged; graded and skipped games are not', g.ungraded.length === 1 && /A v B/.test(g.ungraded[0].game) && g.ungraded[0].hoursPast === 8, JSON.stringify(g.ungraded));
ok('health: a priced-league game 5 hours out with no price is flagged; priced and unpriced-league games are not', g.unpriced.length === 1 && /E v F/.test(g.unpriced[0].game), JSON.stringify(g.unpriced));
const a = analystChecks({ items: [
  { rule: 'under', key: 'U', home: 'A', away: 'B', kickoff: at(-2), close: null, res: null, mins: 60 },
  { rule: 'under', key: 'U', home: 'C', away: 'D', kickoff: at(-2), close: 120, res: null, mins: 60 },
  { rule: 'bttsNo', key: 'N', home: 'E', away: 'F', kickoff: at(-60), close: 110, res: null, mins: 60 },
  { rule: 'move', key: 'H', home: 'G', away: 'H', kickoff: at(-30), close: 110, clv: 1, res: 'win', units: 1.1, price: 110, mins: 60 } ] }, NOW);
ok('health: an open bet past kickoff with no closing price is flagged', a.noClose.length === 1 && /A v B/.test(a.noClose[0].bet));
ok('health: a bet still open 2+ days after kickoff is flagged', a.stale.length === 1 && /E v F/.test(a.stale[0].bet));
const fo = a.soccer.find(r => r.id === 'move');
ok('health: each rule\'s record, with bets left before the bench check', fo.settled === 1 && fo.units === 1.1 && fo.toBench === a.bench.n - 1 && a.soccer.find(r => r.id === 'totals').retired, JSON.stringify(fo));
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
r = await go('/api/health', env({ HEALTH_TOKEN: 'hk' }), { 'x-health-token': 'hk' });
ok('route: the key also works as a header', r.status === 200);
kv.set('meta:errors', JSON.stringify({ 'ukr.1': { kind: 'sync', msg: 'old', at: '2020-01-01T00:00:00Z' }, 'eng.1': { kind: 'sync', msg: 'new', at: new Date().toISOString() } }));
r = await go('/api/health?k=hk', env({ HEALTH_TOKEN: 'hk' }));
ok('route: sync problems older than 3 days are left out', (j2 => Object.keys(j2.syncProblems).join() === 'eng.1')(await r.json()));
r = await go('/api/config?k=hk', env({ HEALTH_TOKEN: 'hk' }));
ok('route: the health key opens nothing else', r.status === 401);
ok('route: reading health writes nothing', puts.length === 0, puts.join());
console.log(fail ? `\n${fail} health check(s) FAILED` : '\nAll health checks passed'); process.exit(fail ? 1 : 0);
