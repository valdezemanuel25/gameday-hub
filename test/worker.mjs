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

let fixtureDone = false, elDone = false, fx2Done = false;
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
    return send({ events: [...history, ev('fx1', FX1_KO, [359, 'Arsenal'], [331, 'Brighton'], 2, 1, fixtureDone), ev('fx2', '2026-10-15T19:00:00Z', [359, 'Arsenal'], [331, 'Brighton'], 0, 0, fx2Done)] });
  }
  if (u.includes('/uefa.champions/scoreboard')) {
    return send({ events: [
      ev('ucl1', '2026-10-14T19:00:00Z', [359, 'Arsenal'], [331, 'Brighton'], 0, 0, false),
      ev('ucl2', '2026-10-15T19:00:00Z', [777, 'Unknown FC'], [359, 'Arsenal'], 0, 0, false),
    ] });
  }
  if (u.includes('/uefa.europa/scoreboard')) {
    return send({ events: [
      ev('el1', '2026-10-15T19:00:00Z', [1929, 'Benfica'], [256, 'Celtic'], elDone ? 2 : 0, elDone ? 0 : 0, elDone),
      ev('el2', '2026-10-15T16:45:00Z', [167, 'Lyon'], [384, 'Crystal Palace'], 0, 0, false),
      ev('el3', '2026-10-15T16:45:00Z', [9999, 'Nobody FC'], [256, 'Celtic'], 0, 0, false),
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
ok('card has a v5 shadow prediction beside v4, adding to ~100', c.v5 && ['H', 'D', 'A'].includes(c.v5.pick) && Math.abs(c.v5.p.reduce((x, y) => x + y) - 100) <= 1, JSON.stringify(c.v5));
ok('cup game: no v5 (Elo needs both clubs in one league)', (await call('/api/day?date=2026-10-14')).cards.find(x => x.id === 'ucl1')?.v5 == null);
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
ok('Model bets: the graded card carries a locked headline pick and the tally counts it', t.leans && t.leans.n === 1 && typeof t.leans.hits === 'number' && t.leans.recent.length === 1 && t.leans.byKind[t.leans.recent[0].k].n === 1, JSON.stringify(t.leans));
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
  mkDay({ ...card, v4: null, v5: null });
  await call('/api/analyze?league=eng.1&date=2026-10-15&leftover=1', 'POST', 'secret');
  const kept = JSON.parse(kv.get(key)).cards.find(x => x.id === 'fx2');
  ok('leftover: a card that already has v4 and v5 keys is left exactly as it was', JSON.stringify(kept.v2) === JSON.stringify(v2x) && kept.v4 === null && kept.v5 === null);
  mkDay({ ...card, v4: null });
  await call('/api/analyze?league=eng.1&date=2026-10-15&leftover=1', 'POST', 'secret');
  const gained = JSON.parse(kv.get(key)).cards.find(x => x.id === 'fx2');
  ok('leftover: a card saved before v5 existed is analyzed once more and gets a v5 key', 'v5' in gained, JSON.stringify(gained.v5));
  kv.delete(key);
}

// ---- a v4 made before kickoff survives re-analysis after the game finished (but before it is graded) ----
{
  const key = 'day:2026-10-15', v4x = { p: [50, 25, 25], pick: 'H', over: 50, btts: 50, scores: [['1–0', 10]], lam: [1.4, 1] };
  const v2x = { p: [41, 29, 30], pick: 'H', over: 50, btts: 50, scores: [['1–1', 10]], lam: [1, 1], best: { pick: 'x', p: 50 } };
  const card = { id: 'fx2', league: 'eng.1', home: 'Arsenal', away: 'Brighton', v2: v2x, v4: v4x, final: null, kickoff: '2026-10-15T19:00:00Z' };
  kv.set(key, JSON.stringify({ date: '2026-10-15', analyzed: {}, cards: [card] }));
  await call('/api/analyze?league=eng.1&date=2026-10-15', 'POST', 'secret'); // the clock is past that kickoff
  const k = JSON.parse(kv.get(key)).cards.find(x => x.id === 'fx2');
  ok('re-analysis after kickoff keeps the v4 made before it', JSON.stringify(k.v4) === JSON.stringify(v4x) && !k.v4why, JSON.stringify(k.v4));
  kv.set(key, JSON.stringify({ date: '2026-10-15', analyzed: {}, cards: [{ ...card, v4: undefined }] }));
  fx2Done = true; await call('/api/analyze?league=eng.1&date=2026-10-15', 'POST', 'secret'); fx2Done = false;
  const n = JSON.parse(kv.get(key)).cards.find(x => x.id === 'fx2');
  ok('a game first seen after kickoff has no v4 and says why', n.v4 === null && /already played|not recognized|no games/.test(n.v4why || ''), JSON.stringify([n.v4, n.v4why]));
  kv.delete(key);
}

// ---- never overwrite a graded card ----
await call('/api/analyze?league=eng.1&date=2026-10-14', 'POST', 'secret');
const kept = (await call('/api/day?date=2026-10-14')).cards.find(x => x.id === 'fx1');
ok('re-analyzing never overwrites a graded card', !!kept.final && !!kept.grade, JSON.stringify(kept.final));


// ---- Europa League + v4 cup shadow: games v2 cannot cover still get a v4 prediction ----
{
  const el = await call('/api/analyze?league=uefa.europa&date=2026-10-15&partial=1', 'POST', 'secret');
  ok('Europa League is a league the Hub analyzes', el.fixtures === 3 && el.cards === 3, JSON.stringify(el));
  const d = (await call('/api/day?date=2026-10-15')).cards;
  const c1 = d.find(x => x.id === 'el1'), c2 = d.find(x => x.id === 'el2'), c3 = d.find(x => x.id === 'el3');
  ok('Benfica v Celtic: no v2 (leagues not kept), but a v4 cup prediction', !c1.v2 && !!c1.skipped && c1.v4 && c1.v4.p.length === 3 && Math.abs(c1.v4.p.reduce((x, y) => x + y) - 100) <= 1 && c1.leagueKey === 'uel', JSON.stringify(c1.v4));
  ok('Lyon v Crystal Palace: v4 cup prediction too', !!c2.v4 && c2.v4.lam.length === 2 && c2.v4.scores.length === 3);
  ok('an unknown club: no prediction, still listed', !c3.v2 && c3.v4 === undefined && !!c3.skipped);
  ok('cup tabs: Europa League is on the Hub', (await call('/api/config')).tabs.some(x => x.slug === 'uefa.europa' && x.key === 'uel'));
  const cron = await runSlot(env, new Date('2026-10-14T20:00:00Z'), 1);
  ok('cron grade slot ignores games that have not finished (an idle slot may read Forebet instead)', (cron.job === 'grade' || cron.job === 'forebet') && !cron.graded);
  // grade the v4-only card after the game: only v4 is graded, v2 totals do not move
  const t0 = await call('/api/tally');
  elDone = true;
  const g = await gradeLeague('2026-10-15', 'uefa.europa', env, { force: true }, new Date('2026-10-16T05:00:00Z'));
  const gd = JSON.parse(kv.get('day:2026-10-15')).cards.find(x => x.id === 'el1');
  ok('a v4-only card is graded (v4 only)', g.graded === 1 && gd.final.h === 2 && gd.grade.v4 && gd.grade.v2 === undefined, JSON.stringify(gd.grade));
  const t1 = await call('/api/tally');
  ok('tally: v4 counts every game it predicted, v2 totals and the head-to-head do not move', t1.v4.n === t0.v4.n + 1 && t1.v2.n === t0.v2.n && t1.h2h.v4.n === t0.h2h.v4.n, JSON.stringify([t1.v4, t1.v2.n, t1.h2h.v4.n]));
  ok('recent list only has v2 games', t1.recent.every(x => x.grade.v2));
  // leftover: a cup card whose v4 was null gets analyzed again; one with a prediction stays
  const r2 = await call('/api/analyze?league=uefa.europa&date=2026-10-15&partial=1&leftover=1', 'POST', 'secret');
  ok('leftover on the cup keeps the graded card', JSON.parse(kv.get('day:2026-10-15')).cards.find(x => x.id === 'el1').final.h === 2 && r2.cards === 3);
  // status shows the cups and cup rating state
  const st = await call('/api/status');
  ok('status lists the cups with their v4 ratings state', st.leagues.some(l => l.slug === 'uefa.europa' && l.v4 && 'ratingsAt' in l.v4) && st.leagues.some(l => l.slug === 'uefa.champions'));
  // a forced rebuild of the cup ratings from the Status tab
  const rb = await call('/api/ratings?league=cup', 'POST', 'secret');
  ok('POST /api/ratings?league=cup rebuilds the cup ratings', rb.ok && rb.league === 'cup' && kv.has('rat:cup'), JSON.stringify(rb));
  // the cup results store: sync works for a cup, builds no club context
  let sc, n = 0; do { sc = await call('/api/sync?league=uefa.europa', 'POST', 'secret'); n++; } while (!sc.caughtUp && n < 10);
  ok('syncing a cup stores results but builds no club context', sc.caughtUp && sc.context === false && kv.has('res:uefa.europa') && !kv.has('ctx:uefa.europa'), JSON.stringify(sc));
}

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
  { const L = st.leagues.find(l => l.slug === 'eng.1'); ok('status: each league carries SportsMole and Forebet source info', L && L.sm && 'found' in L.sm && 'total' in L.sm && L.fb && typeof L.fb === 'object'); }
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
  ok('calibration groups cover every graded v4 winner pick (v2 is retired)', t.calibration.length === 4 && tot === t.v4.n && tot > 0, `${tot} vs ${t.v4.n}`);
}
console.log(fails ? `\n${fails} FAILED` : '\nAll wiring checks passed (incl. pre-kickoff form)');
process.exit(fails ? 1 : 0);
