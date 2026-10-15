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
    return send({ events: [...history, ev('fx1', FX1_KO, [359, 'Arsenal'], [331, 'Brighton'], 2, 1, fixtureDone), ev('fx2', '2026-10-15T19:00:00Z', [359, 'Arsenal'], [331, 'Brighton'], 0, 0, false)] });
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
  worker.fetch(new Request('https://hub.test' + path, { method, headers: (token ?? (method === 'GET' ? 'secret' : '')) ? { 'x-admin-token': token ?? 'secret' } : {} }), env).then(r => r.json());

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
ok('sync advances in windows and catches up', s.caughtUp && rounds >= 2 && rounds <= 9, `rounds=${rounds} ${JSON.stringify(s)}`);
ok('sync built a context', s.context === true);

// ---- analyze one league ----
const a = await call('/api/analyze?league=eng.1&date=2026-10-14', 'POST', 'secret');
ok('analyze eng.1 -> 1 card', a.cards === 1 && !a.skipped, JSON.stringify(a));
const day = await call('/api/day?date=2026-10-14');
const c = day.cards.find(x => x.id === 'fx1');
ok('card has v2 and v4', !!(c?.v2 && c?.v4));
ok('card no longer carries v3', c.v3 === undefined);
ok('v2 λ = 1.21 / 0.95 (same inputs as the real Arsenal–Lille card)', c.v2.lam[0] === 1.21 && c.v2.lam[1] === 0.95, JSON.stringify(c.v2.lam));
ok('v2 / v4 sum to ~100', Math.abs(c.v2.p.reduce((x, y) => x + y) - 100) <= 1 && Math.abs(c.v4.p.reduce((x, y) => x + y) - 100) <= 1);
ok('v4 has a pick, score list and expected goals', ['H', 'D', 'A'].includes(c.v4.pick) && c.v4.scores.length === 3 && c.v4.lam.length === 2, JSON.stringify(c.v4));
ok('card carries the Hub tab key', c.leagueKey === 'epl');

// ---- other league with no games is a cheap no-op ----
const empty = await call('/api/analyze?league=ger.1&date=2026-10-14', 'POST', 'secret');
ok('league with no fixtures -> 0, no sync demanded', empty.fixtures === 0 && !empty.needsSync, JSON.stringify(empty));

// ---- cup fixtures use domestic data ----
const ucl = await call('/api/analyze?league=uefa.champions&date=2026-10-14', 'POST', 'secret');
ok('UCL card built from clubs\' domestic data', ucl.cards === 1 && !ucl.skipped, JSON.stringify(ucl));
ok('cup game: v4 stays silent (null, not missing)', (await call('/api/day?date=2026-10-14')).cards.find(x => x.id === 'ucl1')?.v4 === null);
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
ok('v2 vs v4 test = the 1 graded game that has v4', t.h2h.v2.n === 1 && t.h2h.v4.n === 1, JSON.stringify(t.h2h));
ok('retired v3 test keeps the 58 imported shadow matches', t.h2hOld.v2.n === 58 && t.h2hOld.v3.n === 58, JSON.stringify(t.h2hOld));

// ---- 'Analyze leftover' keeps finished cards but fills in cards saved before v4 existed ----
{
  const key = 'day:2026-10-15';
  const v2x = { p: [41, 29, 30], pick: 'H', over: 50, btts: 50, scores: [['1–1', 10]], lam: [1, 1], best: { pick: 'x', p: 50 } };
  const mkDay = card => kv.set(key, JSON.stringify({ date: '2026-10-15', analyzed: {}, cards: [card] }));
  const card = { id: 'fx2', league: 'eng.1', home: 'Arsenal', away: 'Brighton', v2: v2x, final: null, kickoff: '2026-10-15T19:00:00Z' };
  mkDay({ ...card, v3: { p: [40, 30, 30], pick: 'H' } }); // saved before v4 existed: no v4 key
  await call('/api/analyze?league=eng.1&date=2026-10-15&leftover=1', 'POST', 'secret');
  const filled = JSON.parse(kv.get(key)).cards.find(x => x.id === 'fx2');
  ok('leftover: a card saved before v4 gets analyzed and now has a v4 key', 'v4' in filled && filled.v3 === undefined && filled.v2.lam[0] !== 1, JSON.stringify(filled.v4));
  mkDay({ ...card, v4: null });
  await call('/api/analyze?league=eng.1&date=2026-10-15&leftover=1', 'POST', 'secret');
  const kept = JSON.parse(kv.get(key)).cards.find(x => x.id === 'fx2');
  ok('leftover: a card that already has a v4 key is left exactly as it was', JSON.stringify(kept.v2) === JSON.stringify(v2x) && kept.v4 === null);
  kv.delete(key);
}

// ---- never overwrite a graded card ----
await call('/api/analyze?league=eng.1&date=2026-10-14', 'POST', 'secret');
const kept = (await call('/api/day?date=2026-10-14')).cards.find(x => x.id === 'fx1');
ok('re-analyzing never overwrites a graded card', !!kept.final && !!kept.grade, JSON.stringify(kept.final));


// ---- form never includes the match being predicted (or anything after kickoff) ----
const { formAt } = await import('../src/worker.js');
const tm = { form: { gf: 99, ga: 99, n: 5 }, recent: [['2026-10-01T15:00Z', 1, 1], ['2026-10-05T15:00Z', 2, 0], ['2026-10-09T15:00Z', 0, 1], ['2026-10-13T18:45Z', 5, 0], ['2026-10-16T15:00Z', 3, 3]] };
const ff = formAt(tm, '2026-10-13T18:45:00Z');
ok('form excludes the match itself and later games', ff.n === 3 && ff.gf === 3 && ff.ga === 2, JSON.stringify(ff));
// ---- standings with two groups (MLS East / West): both are read ----
{
  const { syncLeague } = await import('../src/data.js');
  const kv2 = new Map();
  const env2 = { HUB: { get: async (k, ty) => { const v = kv2.get(k); return v == null ? null : ty === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => { kv2.set(k, v); } } };
  const real = globalThis.fetch;
  globalThis.fetch = async url => {
    const u = String(url);
    if (u.includes('/standings')) return new Response(JSON.stringify({ children: [{ standings: { entries: [entry(1, 'East FC', 30, 40, 30)] } }, { standings: { entries: [entry(2, 'West FC', 30, 50, 35)] } }] }));
    if (u.includes('/scoreboard')) return new Response(JSON.stringify({ events: [ev('e1', '2026-10-01T23:00:00Z', [1, 'East FC'], [2, 'West FC'], 2, 1, true)] }));
    return new Response('{}');
  };
  let r; for (let i = 0; i < 12; i++) { r = await syncLeague({ slug: 'usa.1', calendar: true }, env2, new Date('2026-10-13T12:00:00Z')); if (r.caughtUp) break; }
  const ctx = JSON.parse(kv2.get('ctx:usa.1') || 'null');
  ok('two conferences: both East and West clubs are in the league context', !!(ctx?.teams?.['1'] && ctx?.teams?.['2']), JSON.stringify(Object.keys(ctx?.teams || {})));
  globalThis.fetch = real;
}

// ---- status panel, write counter, export list ----
{
  const get = path => worker.fetch(new Request('https://hub.test' + path, { headers: { 'x-admin-token': 'secret' } }), env).then(r => r.json());
  kv.set('meta:writes', JSON.stringify({ d: new Date().toISOString().slice(0, 10), n: 10 }));
  const before = 10;
  await call('/api/grade?league=eng.1&date=2026-10-14', 'POST', 'secret'); // may or may not write
  const st = await get('/api/status');
  ok('status: lists leagues with last sync', st.leagues.length > 5 && st.leagues.some(l => l.slug === 'eng.1'));
  ok('status: write counter present and limit is 1000', st.writes.limit === 1000 && st.writes.used >= 0, JSON.stringify(st.writes));
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('nope', { status: 500 });
  const sy = await call('/api/sync?league=eng.2', 'POST', 'secret');
  globalThis.fetch = origFetch;
  const st2 = await get('/api/status');
  ok('status: a failed sync is shown against its league', sy.error && st2.leagues.find(l => l.slug === 'eng.2')?.problem?.kind === 'sync', JSON.stringify(st2.leagues.find(l => l.slug === 'eng.2')?.problem));
  ok('status: counter went up after writes', st2.writes.used > before, String(st2.writes.used));
  const days = await get('/api/days');
  ok('export: lists saved days', Array.isArray(days.days) && days.days.length >= 1, JSON.stringify(days.days));
}

// ---- notes, own pick, calibration ----
{
  const day = JSON.parse(kv.get('day:2026-10-14'));
  const c0 = day.cards.find(c => c.v2);
  const post = (path, body) => worker.fetch(new Request('https://hub.test' + path, { method: 'POST', headers: { 'x-admin-token': 'secret' }, body: JSON.stringify(body) }), env).then(r => r.json());
  const r = await post(`/api/note?league=${c0.league}&date=2026-10-14`, { id: c0.id, note: 'Key striker out', mine: 'D' });
  ok('note saved on the card', r.saved && JSON.parse(kv.get('day:2026-10-14')).cards.find(c => c.id === c0.id).note === 'Key striker out');
  const bad = await post(`/api/note?league=${c0.league}&date=2026-10-14`, { id: 'nope', note: 'x' });
  ok('note on an unknown game is refused', !!bad.error);
  await call(`/api/analyze?league=${c0.league}&date=2026-10-14`, 'POST', 'secret');
  const after = JSON.parse(kv.get('day:2026-10-14')).cards.find(c => c.id === c0.id);
  ok('note and own pick survive a re-analyze', after?.note === 'Key striker out' && after?.mine === 'D');
  const t = await (await worker.fetch(new Request('https://hub.test/api/tally', { headers: { 'x-admin-token': 'secret' } }), env)).json();
  const tot = t.calibration.reduce((a, b) => a + b.n, 0);
  ok('calibration groups cover every graded winner pick', t.calibration.length === 4 && tot >= 280, String(tot));
}
console.log(fails ? `\n${fails} FAILED` : '\nAll wiring checks passed (incl. pre-kickoff form)');
process.exit(fails ? 1 : 0);
