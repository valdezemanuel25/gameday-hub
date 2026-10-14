// Wiring test: real Worker code, fake ESPN-shaped responses, in-memory KV.
// Proves sync -> analyze -> delayed grade -> tally works, one league per request.
// Does NOT prove ESPN's live JSON shape.
import worker, { runSlot, gradeLeague } from '../src/worker.js';

const kv = new Map();
const env = {
  ADMIN_TOKEN: 'secret', GAME_HOURS: '2', GRADE_DELAY_HOURS: '3',
  ASSETS: { fetch: () => new Response('asset') },
  HUB: {
    get: async (k, type) => { const v = kv.get(k); return v == null ? null : type === 'json' ? JSON.parse(v) : v; },
    put: async (k, v) => { kv.set(k, v); },
    list: async ({ prefix }) => ({ keys: [...kv.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }),
  },
};

const team = (id, name) => ({ id, displayName: name });
const ev = (id, date, h, a, hs, as, done) => ({
  id, date,
  competitions: [{
    status: { type: { completed: done } },
    competitors: [
      { homeAway: 'home', team: team(h[0], h[1]), score: String(hs ?? 0) },
      { homeAway: 'away', team: team(a[0], a[1]), score: String(as ?? 0) },
    ],
  }],
});
const entry = (id, name, gp, gf, ga) => ({
  team: { id, displayName: name },
  stats: [{ name: 'gamesPlayed', value: gp }, { name: 'pointsFor', value: gf }, { name: 'pointsAgainst', value: ga }],
});

let fixtureDone = false;
const history = [];
// Arsenal (359) last 5: 2-1, 0-3, 2-0, 2-1, 1-0 (7 scored, 5 conceded). Brighton (331): 7 scored, 4 conceded.
[[2, 1], [0, 3], [2, 0], [2, 1], [1, 0]].forEach(([f, a], i) =>
  history.push(ev(`a${i}`, `2026-09-${10 + i}T14:00:00Z`, [359, 'Arsenal'], [900 + i, `Opp${i}`], f, a, true)));
[[1, 0], [1, 2], [2, 0], [1, 0], [2, 2]].forEach(([f, a], i) =>
  history.push(ev(`b${i}`, `2026-09-${10 + i}T16:00:00Z`, [331, 'Brighton'], [800 + i, `Opp${i}`], f, a, true)));

const FX1_KO = '2026-10-14T19:00:00Z';
const calls = { fetch: 0 };
globalThis.fetch = async url => {
  calls.fetch++;
  const u = String(url);
  const send = body => new Response(JSON.stringify(body));
  if (u.includes('/standings')) {
    if (!u.includes('/eng.1/')) return send({});
    // this season: both clubs; last season: only Arsenal (Brighton plays the "promoted" stand-in path)
    const entries = u.includes('season=2026')
      ? [entry(359, 'Arsenal', 7, 14, 8), entry(331, 'Brighton', 7, 9, 8)]
      : [entry(359, 'Arsenal', 38, 70, 30)];
    return send({ children: [{ standings: { entries } }] });
  }
  if (u.includes('/eng.1/scoreboard')) {
    return send({ events: [...history, ev('fx1', FX1_KO, [359, 'Arsenal'], [331, 'Brighton'], 2, 1, fixtureDone)] });
  }
  if (u.includes('/uefa.champions/scoreboard')) {
    return send({ events: [
      ev('ucl1', '2026-10-14T19:00:00Z', [359, 'Arsenal'], [331, 'Brighton'], 0, 0, false),
      ev('ucl2', '2026-10-15T19:00:00Z', [777, 'Unknown FC'], [359, 'Arsenal'], 0, 0, false),
    ] });
  }
  return send({ events: [] });
};

const call = (path, method = 'GET', token) =>
  worker.fetch(new Request('https://hub.test' + path, { method, headers: token ? { 'x-admin-token': token } : {} }), env).then(r => r.json());

let fails = 0;
const ok = (name, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${extra}`); };

// ---- auth + one-league-per-request ----
ok('rejects missing token', (await call('/api/analyze?league=eng.1&date=2026-10-14', 'POST')).error?.includes('token'));
ok('requires a league (never "all at once")', (await call('/api/analyze?date=2026-10-14', 'POST', 'secret')).error?.includes('one league'));

// ---- analyze before sync asks for a sync ----
const pre = await call('/api/analyze?league=eng.1&date=2026-10-14', 'POST', 'secret');
ok('analyze before sync -> needsSync [eng.1]', JSON.stringify(pre.needsSync) === '["eng.1"]', JSON.stringify(pre));

// ---- sync in small windows until caught up ----
let s, rounds = 0;
do { s = await call('/api/sync?league=eng.1', 'POST', 'secret'); rounds++; } while (!s.caughtUp && rounds < 10);
ok('sync advances in windows and catches up', s.caughtUp && rounds >= 2 && rounds <= 5, `rounds=${rounds} ${JSON.stringify(s)}`);
ok('sync built a context', s.context === true);

// ---- analyze one league ----
const a = await call('/api/analyze?league=eng.1&date=2026-10-14', 'POST', 'secret');
ok('analyze eng.1 -> 1 card', a.cards === 1 && !a.skipped, JSON.stringify(a));
const day = await call('/api/day?date=2026-10-14');
const c = day.cards.find(x => x.id === 'fx1');
ok('card has v2 and v3', !!(c?.v2 && c?.v3));
ok('v2 λ = 1.21 / 0.95 (same inputs as the real Arsenal–Lille card)', c.v2.lam[0] === 1.21 && c.v2.lam[1] === 0.95, JSON.stringify(c.v2.lam));
ok('v2 / v3 sum to ~100', Math.abs(c.v2.p.reduce((x, y) => x + y) - 100) <= 1 && Math.abs(c.v3.p.reduce((x, y) => x + y) - 100) <= 1);
ok('card carries the Hub tab key', c.leagueKey === 'epl');

// ---- other league with no games is a cheap no-op ----
const empty = await call('/api/analyze?league=ger.1&date=2026-10-14', 'POST', 'secret');
ok('league with no fixtures -> 0, no sync demanded', empty.fixtures === 0 && !empty.needsSync, JSON.stringify(empty));

// ---- cup fixtures use domestic data ----
const ucl = await call('/api/analyze?league=uefa.champions&date=2026-10-14', 'POST', 'secret');
ok('UCL card built from clubs\' domestic data', ucl.cards === 1 && !ucl.skipped, JSON.stringify(ucl));
const unknown = await call('/api/analyze?league=uefa.champions&date=2026-10-15', 'POST', 'secret');
ok('UCL club not synced yet -> needsSync, nothing half-saved', Array.isArray(unknown.needsSync) && unknown.needsSync.length > 0 && !(await call('/api/day?date=2026-10-15')).cards.length);

// ---- grading waits: last kickoff + 2h game + 3h delay ----
const ko = new Date(FX1_KO).getTime(), H = 3600000;
fixtureDone = true;
const early = await gradeLeague('2026-10-14', 'eng.1', env, {}, new Date(ko + 4 * H));
ok('4h after kickoff: still waiting (nothing graded)', early.waiting === true && early.graded === 0, JSON.stringify(early));
const idle = await runSlot(env, new Date(ko + 4 * H), 1);
ok('cron grade slot: nothing due yet', idle.idle === true, JSON.stringify(idle));
// Two leagues are due (UCL's game isn't final in the feed, eng.1's is). One league per run, and a
// stuck league must not block the others: the cron rotates by least-recently-tried.
const run1 = await runSlot(env, new Date(ko + 6 * H), 1);
const run2 = await runSlot(env, new Date(ko + 6 * H + 30 * 60000), 1);
ok('cron grade slot: each run handles exactly ONE league', run1.league && run2.league && run1.league !== run2.league, `${run1.league} then ${run2.league}`);
ok('cron grade slot: stuck league does not block eng.1', [run1, run2].some(r => r.league === 'eng.1' && r.graded === 1), JSON.stringify([run1, run2]));

// ---- other cron slots each do one small job ----
const syncJob = await runSlot(env, new Date(ko + 6 * H), 0);
ok('cron sync slot: picks the least-recently-synced league', syncJob.job === 'sync' && syncJob.league !== 'eng.1', JSON.stringify(syncJob));
const anJob = await runSlot(env, new Date('2026-10-13T20:00:00Z'), 2);
ok('cron analyze slot: one league per run', anJob.job === 'analyze', JSON.stringify(anJob));

// ---- totals include the imported history ----
const t = await call('/api/tally');
ok('v2 total = 280 imported + 1 new', t.v2.n === 281, `n=${t.v2.n}`);
ok('imported outcome hits 139 (+1 new) = 140', t.v2.outcome === 140, `got ${t.v2.outcome}`);
ok('imported O/U hits 154 (+0 new)', t.v2.ou === 154, `got ${t.v2.ou}`);
ok('imported BTTS hits 168 (+0 new)', t.v2.btts === 168, `got ${t.v2.btts}`);
ok('head-to-head = 58 shadow + 1 new, both models', t.h2h.v2.n === 59 && t.h2h.v3.n === 59);

// ---- never overwrite a graded card ----
await call('/api/analyze?league=eng.1&date=2026-10-14', 'POST', 'secret');
const kept = (await call('/api/day?date=2026-10-14')).cards.find(x => x.id === 'fx1');
ok('re-analyzing never overwrites a graded card', !!kept.final && !!kept.grade, JSON.stringify(kept.final));

console.log(fails ? `\n${fails} FAILED` : '\nAll wiring checks passed');
process.exit(fails ? 1 : 0);
