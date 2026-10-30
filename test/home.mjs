// Home screen summary: counts, the next kickoff, Best picks still to play (same rule as the phone alerts), and the Brew line.
import { homeSummary } from '../src/home.js';
import worker from '../src/worker.js';
let fail = 0; const ok = (n, c, x = '') => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (c ? '' : ' ' + x)); if (!c) fail++; };
const T0 = Date.parse('2026-10-22T18:00:00Z'), at = m => new Date(T0 + m * 60000).toISOString();
const soc = (id, m, o = {}) => ({ id, league: 'uefa.champions', leagueKey: 'ucl', home: 'Club Brugge', away: 'Lens', ko: `KO${id}`, kickoff: at(m), final: null,
  v2: { pick: 'H', p: [70, 18, 12], over: 70, btts: 60 }, v4: { pick: 'H', p: [68, 20, 12], over: 68, btts: 62 }, fb: { p: [66, 20, 14], over: 66, btts: 61 }, sm: { h: 2, a: 1, text: '2–1' }, ...o });
const split = { v4: { pick: 'A', p: [20, 20, 60], over: 40, btts: 40 }, sm: { h: 0, a: 1, text: '0–1' } };
const soccer = [soc('a', -120, { final: { h: 1, a: 0 } }), soc('b', 30), soc('c', 90, split), soc('d', 200), soc('e', 60, { skipped: true })];
const brew = [{ source: 'Morning Brew', date: '2026-10-22', title: 'MB', markets: [] },
  { source: 'Brew Markets', date: '2026-10-22', title: 'Heist', markets: [{ label: 'Nasdaq', value: '1', change: -2.83 }, { label: 'S&P 500', value: '2', change: -2.09 }] },
  { source: 'Brew Markets', date: '2026-10-21', title: 'Old', markets: [] }];
const h = homeSummary({ soccer, hockey: [], brew, today: '2026-10-22', now: T0 });
ok('skipped games are not counted', h.soccer.games === 4, JSON.stringify(h.soccer));
ok('finished games are not left to play', h.soccer.left === 3);
ok('next kickoff is the soonest game still to start', h.soccer.next && h.soccer.next.ko === 'KOb');
ok('Best picks still to play match the alert rule (split card excluded)', h.soccer.best === 2 && h.soccer.nextBest.ko === 'KOb' && /^Best pick:/.test(h.soccer.nextBest.title));
ok('a Best pick to play makes the card glow', h.soccer.attention === true);
ok('a day with no hockey games is calm', h.nhl.games === 0 && h.nhl.next === null && h.nhl.attention === false);
ok('Brew leads with today\'s Brew Markets issue and its index moves', h.brew.count === 2 && h.brew.title === 'Heist' && h.brew.sp === -2.09 && h.brew.nasdaq === -2.83);
ok('Brew never glows', h.brew.attention === false);
const later = homeSummary({ soccer, hockey: null, brew: null, today: '2026-10-22', now: T0 + 300 * 60000 });
ok('once every game has started nothing glows', later.soccer.left === 0 && later.soccer.best === 0 && later.soccer.attention === false);
ok('missing data does not break it', later.brew.count === 0 && later.brew.title === null);
// the route is behind the password and answers once signed in
const kv = new Map(), env = { ADMIN_TOKEN: 's', ASSETS: { fetch: async () => new Response(JSON.stringify({ issues: brew })) }, HUB: { get: async (k, t) => { const v = kv.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => { kv.set(k, v); }, list: async () => ({ keys: [] }) } };
const r0 = await worker.fetch(new Request('https://hub.test/api/home'), env, {});
ok('signed out: /api/home is refused', r0.status === 401);
const r1 = await worker.fetch(new Request('https://hub.test/api/home', { headers: { 'x-admin-token': 's' } }), env, {});
const j = r1.status === 200 ? await r1.json() : null;
ok('signed in: /api/home answers with all three sections', j && j.soccer && j.nhl && j.brew, String(r1.status));
if (fail) { console.log(`\n${fail} home check(s) failed`); process.exit(1); } else console.log('\nAll home checks passed');
