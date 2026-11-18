// Full-history summaries kept in the edge cache (Nov 18, 2026, audit P6, src/summaries.js): /api/tally, /api/trends, /api/nhl/tally,
// /api/nhl/trends, the hockey backup and the sweep give the same answer as before, built again only when a finished game they read
// changes, never kept when the build fails, and built as before without caches. Also: list() is paged, and the backup reads each day once.
import worker, { counted } from '../src/worker.js';
import { stampPut, listKeys, summary, clearSummaries, dayPart, settledView } from '../src/summaries.js';
import { nhlTally } from '../src/nhl.js';

let fails = 0;
const ok = (name, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${cond ? '' : extra}`); };

// Workers KV in memory: metadata, getWithMetadata, and list() pages of PAGE keys with a cursor (the real one stops at 1,000).
const PAGE = 4;
const mkKV = () => { const m = new Map(); let gets = 0, lists = 0, failGet = null; return {
  m, count: () => ({ gets, lists }), reset() { gets = 0; lists = 0; }, failOn(k) { failGet = k; },
  async get(k, t) { gets++; if (k === failGet) throw new Error('KV read failed'); const v = m.get(k); return v ? (t === 'json' ? JSON.parse(v.value) : v.value) : null; },
  async getWithMetadata(k, t) { gets++; if (k === failGet) throw new Error('KV read failed'); const v = m.get(k); return v ? { value: t === 'json' ? JSON.parse(v.value) : v.value, metadata: v.metadata } : { value: null, metadata: null }; },
  async put(k, value, o) { m.set(k, { value: String(value), metadata: o && o.metadata !== undefined ? o.metadata : null }); },
  async list({ prefix, cursor }) { lists++; const names = [...m.keys()].filter(k => k.startsWith(prefix)).sort(), at = cursor ? Number(cursor) : 0, page = names.slice(at, at + PAGE), done = at + PAGE >= names.length;
    return { keys: page.map(name => ({ name, ...(m.get(name).metadata ? { metadata: m.get(name).metadata } : {}) })), list_complete: done, ...(done ? {} : { cursor: String(at + PAGE) }) }; },
}; };
// The edge cache (caches.default), in memory; `broken` makes every call throw.
const store = new Map(); let broken = false;
const fakeCache = { async match(r) { if (broken) throw new Error('cache down'); const x = store.get(r.url); return x == null ? undefined : new Response(x); },
  async put(r, res) { if (broken) throw new Error('cache down'); store.set(r.url, await res.text()); }, async delete(r) { return store.delete(r.url); } };
const cachesOn = () => { globalThis.caches = { default: fakeCache }; }, cachesOff = () => { delete globalThis.caches; };

// ---- the write id on saves ----
{ const o = stampPut('day:2026-11-14', undefined), n = stampPut('nhl:day:2026-11-14', { expirationTtl: 60 });
  ok('stamp: a saved soccer or hockey day gets a write id as metadata (other options kept)', o && o.metadata && typeof o.metadata.w === 'string' && n.metadata.w && n.expirationTtl === 60 && o.metadata.w !== stampPut('day:x').metadata.w);
  ok('stamp: other keys are left alone, and metadata a caller set is kept', stampPut('analyst', undefined) === undefined && stampPut('meta:writes', { a: 1 }).metadata === undefined && stampPut('day:x', { metadata: { mine: 1 } }).metadata.mine === 1); }
{ const kv = mkKV(), c = counted({ HUB: kv });
  await c.env.HUB.put('day:2026-11-14', '{}'); await c.env.HUB.put('analyst', '{}');
  ok('stamp: saves through the Worker\'s write counter carry it to KV (day only); getWithMetadata goes through too', kv.m.get('day:2026-11-14').metadata?.w && kv.m.get('analyst').metadata === null && typeof c.env.HUB.getWithMetadata === 'function' && (await c.env.HUB.getWithMetadata('day:2026-11-14', 'json')).metadata.w === kv.m.get('day:2026-11-14').metadata.w); }

// ---- days ----
const g = { outcomeHit: true, ouHit: false, bttsHit: true, brier: 0.41 };
const sCard = (id, date, done) => ({ id, league: 'eng.1', leagueName: 'Premier League', home: `Home${id}`, away: `Away${id}`, hAbbr: 'HOM', aAbbr: 'AWY', kickoff: `${date}T15:00:00Z`,
  v2: { p: [50, 25, 25], pick: 'H', over: 55, btts: 50 }, v4: { p: [52, 25, 23], pick: 'H', over: 54, btts: 51 }, v6: { p: [49, 26, 25], over: 56, btts: 52 },
  odds: { h: 110, d: 250, a: 240, tl: 2.5, to: -120, tu: 100, op: { h: 120, d: 250, a: 220 }, opt: { tl: 2.5, to: -110, tu: -110 } }, sx: { sot: 4.5, gl: 2.7, sh: 23 },
  ...(done ? { final: { h: 2, a: 1 }, grade: { v2: g, v4: g, v6: g }, lean: { k: 'lean', key: 'H', p: 49, y: 2, a: 3, by: ['v4'], no: [], src: 'market', hit: true, price: 110 } } : {}) });
const hCard = (id, date, done, h = 3, a = 2) => ({ id, kickoff: `${date}T23:00:00Z`, hAbbr: `H${id % 7}`, aAbbr: `A${id % 5}`, home: `H${id % 7}`, away: `A${id % 5}`, v2: { w: 55, o: 52 }, v4: { w: 57, o: 51 },
  px: { h: -140, a: 120, tl: 6.5, to: -110, tu: -110, op: { h: -130, a: 110 } }, ln: { v: 6.5 },
  ...(done ? { final: { h, a, total: h + a }, grade: { v2: { win: h > a ? 1 : 0, ou: h + a > 6.5 ? 1 : 0, brier: 0.24 }, v4: { win: h > a ? 1 : 0, ou: 0, brier: 0.23 }, line: 6.5 }, lean: { k: 'lean', key: 'H', p: 57, y: 2, a: 3, by: ['v4'], no: [], hit: h > a, r: 2 } } : {}) });
const DATES = ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16'], TODAY = '2026-11-17';
const kv = mkKV(), env = { ADMIN_TOKEN: 'secret', ASSETS: { fetch: () => new Response('') }, HUB: kv, CF_VERSION_METADATA: { id: 'deploy-1' } };
const save = async (k, d) => { const c = counted(env); await c.env.HUB.put(k, JSON.stringify(d)); }; // as the cron and the buttons save
for (const [i, d] of DATES.entries()) {
  await save(`day:${d}`, { date: d, cards: [sCard(`${i}1`, d, true), sCard(`${i}2`, d, true)] });
  await save(`nhl:day:${d}`, { date: d, cards: [hCard(i * 10 + 1, d, true, 3 + (i % 2), 2), hCard(i * 10 + 2, d, true, 1, 4)] });
}
await save(`day:${TODAY}`, { date: TODAY, cards: [sCard('91', TODAY, true), sCard('92', TODAY, false)] });
await save(`nhl:day:${TODAY}`, { date: TODAY, cards: [hCard(91, TODAY, false), hCard(92, TODAY, false)] });
const edit = async (k, f) => { const d = JSON.parse(kv.m.get(k).value); f(d); await save(k, d); };

// ---- list() is paged ----
{ const ks = await listKeys(kv, 'day:');
  ok(`paging: listKeys follows the cursor past one page (${PAGE} keys a page here, 1,000 in KV) and keeps date order`, ks.length === DATES.length + 1 && ks.every((k, i) => !i || ks[i - 1].name < k.name) && ks[0].metadata?.w, String(ks.length));
  cachesOff(); kv.reset();
  const T = await (await worker.fetch(new Request(`https://hub.test/api/tally`, { headers: { 'x-admin-token': 'secret' } }), env)).json();
  ok('paging: tally counts the games on every page of days (it saw only the first page before)', T.leans.n === (DATES.length + 1) * 2 - 1 && T.newlyGraded === T.leans.n, `${T.leans.n}`);
  const N = await nhlTally(env);
  ok('paging: nhlTally counts the games on every page of days', N.graded === DATES.length * 2, `${N.graded}`); }

const get = async p => { const r = await worker.fetch(new Request(`https://hub.test${p}`, { headers: { 'x-admin-token': 'secret' } }), env, { waitUntil() {} }); return { r, h: r.headers.get('x-hub-cache'), text: await r.text() }; };
const ROUTES = ['/api/tally', `/api/trends?date=${TODAY}`, '/api/nhl/tally', `/api/nhl/trends?date=${TODAY}`];
// What each route answers with no cache at all (the old behaviour: every day read and the answer built)
const fresh = async p => { cachesOff(); const x = await get(p); return x; };

// ---- no caches (Node tests, some local runs): built every time, as before ----
for (const p of ROUTES) { const a = await fresh(p), b = await fresh(p); ok(`no caches: ${p.split('?')[0]} is built every time (x-hub-cache: off)`, a.h === 'off' && b.h === 'off' && a.text === b.text && a.r.status === 200); }

// ---- with the edge cache ----
for (const p of ROUTES) {
  const want = (await fresh(p)).text;
  cachesOn(); store.clear(); clearSummaries(); kv.reset();
  const a = await get(p); const reads1 = kv.count().gets; kv.reset();
  const b = await get(p); const reads2 = kv.count().gets;
  clearSummaries(); kv.reset(); const c = await get(p); const reads3 = kv.count().gets;
  ok(`cache: ${p.split('?')[0]} built once (miss), then from this isolate's memory, then (fresh isolate) from the edge cache, with no day read`, a.h === 'miss' && b.h === 'mem' && c.h === 'edge' && reads1 >= DATES.length && reads2 === 0 && reads3 === 0, `${a.h} ${b.h} ${c.h} reads ${reads1}/${reads2}/${reads3}`);
  ok(`cache: ${p.split('?')[0]} answers exactly what it answers with no cache`, a.text === want && b.text === want && c.text === want);
}

// A price read on today's open game (what the cron saves all day): the Results summaries hold, reading only that day again.
cachesOn(); await get('/api/tally'); await get('/api/nhl/tally');
await edit(`day:${TODAY}`, d => { d.cards[1].odds.h += 5; d.cards[1].odds.ts = 'now'; });
await edit(`nhl:day:${TODAY}`, d => { d.cards[0].px.h -= 5; });
kv.reset(); const t1 = await get('/api/tally'), r1 = kv.count().gets; kv.reset(); const n1 = await get('/api/nhl/tally'), r2 = kv.count().gets;
ok('price save: an open game\'s new price keeps the Results summaries (one day read again, nothing rebuilt)', t1.h === 'mem' && n1.h === 'mem' && r1 === 1 && r2 === 1, `${t1.h} ${n1.h} ${r1} ${r2}`);
// ... but the Trends read of that date uses its prices: built again, with the new price
{ const before = JSON.parse((await fresh(`/api/trends?date=${TODAY}`)).text); cachesOn(); const x = await get(`/api/trends?date=${TODAY}`);
  ok('price save: the Trends read of that date is built again (its open games\' prices feed it)', x.h === 'miss' && x.text === JSON.stringify(before), x.h); }

// A new game added to today's day (a league's first analysis): the Results summaries hold, the Trends reads are built again.
{ cachesOn(); await get('/api/tally'); await get('/api/trends?date=' + DATES[3]);
  await edit(`day:${TODAY}`, d => { d.cards.push(sCard('93', TODAY, false)); });
  const a = await get('/api/tally'), b = await get('/api/trends?date=' + DATES[3]), want = (await fresh('/api/trends?date=' + DATES[3])).text;
  await edit(`day:${TODAY}`, d => { d.cards.pop(); });
  ok('new game: a card added to an open day keeps the Results summary; the Trends read (it counts the day\'s games) is built again', a.h === 'mem' && b.h === 'miss' && b.text === want, `${a.h} ${b.h}`); }

// A result: the open game is graded. Every summary that counts it is built again and shows it.
await edit(`day:${TODAY}`, d => { Object.assign(d.cards[1], { final: { h: 0, a: 3 }, grade: { v2: g, v4: g, v6: g }, lean: { k: 'best', key: 'A', p: 61, y: 3, a: 3, by: ['v4'], no: [], src: 'market', hit: true, price: 240 } }); });
await edit(`nhl:day:${TODAY}`, d => { Object.assign(d.cards[0], { final: { h: 5, a: 1, total: 6 }, grade: { v2: { win: 1, ou: 0, brier: 0.2 }, v4: { win: 1, ou: 0, brier: 0.2 }, line: 6.5 }, lean: { k: 'best', key: 'H', p: 58, y: 3, a: 3, by: ['v4'], no: [], hit: true, r: 2 } }); });
for (const p of ROUTES) { const want = (await fresh(p)).text; cachesOn(); const x = await get(p);
  ok(`result: ${p.split('?')[0]} is built again after a game is graded, and matches a fresh build`, x.h === 'miss' && x.text === want, x.h); }
{ cachesOn(); const T = JSON.parse((await get('/api/tally')).text), N = JSON.parse((await get('/api/nhl/tally')).text);
  ok('result: the new results are in the totals', T.leans.byKind.best?.n === 1 && N.leans.byKind.best?.n === 1, JSON.stringify([T.leans.byKind, N.leans.byKind])); }

// A change after grading on an older finished card (an early-payout lead, a close taken after the final): built again.
cachesOn(); await get('/api/tally');
await edit(`day:${DATES[2]}`, d => { d.cards[0].final.lead = { h: 2, a: 0 }; d.cards[0].lean.ep = true; });
{ const want = (await fresh('/api/tally')).text; cachesOn(); const x = await get('/api/tally');
  ok('late change: an early-payout lead added to a graded card days later rebuilds the Results summary', x.h === 'miss' && x.text === want && JSON.parse(x.text).leans.ep?.n === 1, x.h); }

// A new deploy (CF_VERSION_METADATA) starts afresh: the code that builds the summary may have changed.
{ cachesOn(); await get('/api/tally'); env.CF_VERSION_METADATA = { id: 'deploy-2' }; const x = await get('/api/tally'); const y = await get('/api/tally');
  ok('deploy: a new version id builds the summary again, then keeps it', x.h === 'miss' && y.h === 'mem', `${x.h} ${y.h}`); }

// A Trends read is kept per date
{ cachesOn(); const a = await get(`/api/trends?date=${DATES[3]}`), b = await get(`/api/trends?date=${TODAY}`), c = await get(`/api/trends?date=${DATES[3]}`);
  ok('dates: each Trends date has its own kept answer', JSON.parse(a.text).date === DATES[3] && JSON.parse(b.text).date === TODAY && c.h === 'mem' && c.text === a.text); }

// A failed build is never kept: a day that cannot be read makes the route fail; once it reads again the answer is right.
{ cachesOn(); store.clear(); clearSummaries(); await edit(`day:${DATES[1]}`, d => { d.cards[0].lean.p = 50; });
  kv.failOn(`day:${DATES[1]}`); const x = await get('/api/tally'); kv.failOn(null); const keptAfterError = [...store.keys()].filter(k => k.includes('/sum/tally/')).length;
  const want = (await fresh('/api/tally')).text; cachesOn(); const y = await get('/api/tally');
  ok('errors: a failed read answers an error and nothing is kept; the next load builds the right answer', x.r.status === 500 && keptAfterError === 0 && y.h === 'miss' && y.text === want, `${x.r.status} kept ${keptAfterError} ${y.h}`); }
// A build that throws is not kept either
{ cachesOn(); store.clear(); clearSummaries(); let threw = false;
  try { await summary(env, { kind: 'nhltally', prefix: 'nhl:day:', build: () => { throw new Error('bad day'); } }); } catch (e) { threw = true; }
  const z = await summary(env, { kind: 'nhltally', prefix: 'nhl:day:', build: () => ({ ok: 1 }) });
  ok('errors: a build that throws is passed on and not kept (the next call builds)', threw && z.cache === 'miss' && z.text === '{"ok":1}'); }

// A broken edge cache (or none on this host) is the same as a miss: the answer is built, never an error.
{ cachesOn(); clearSummaries(); broken = true; const want = (await fresh('/api/nhl/tally')).text; cachesOn(); const x = await get('/api/nhl/tally'); broken = false;
  ok('broken cache: every cache call failing still answers, built as with no cache', x.r.status === 200 && x.text === want, `${x.r.status} ${x.h}`); }

// ---- the hockey backup: every day read once, totals from those same days (or kept) ----
{ cachesOff(); kv.reset(); const r = await worker.fetch(new Request('https://hub.test/api/nhl/export', { headers: { 'x-admin-token': 'secret' } }), env); const j = await r.json(), reads = kv.count().gets;
  const want = await nhlTally(env);
  ok('backup: each hockey day is read once (it was read twice: once for the days, again for the totals)', reads === DATES.length + 1 + 1 + 1, `${reads} reads`); // + the analyst record and its side record (fix:analyst, src/fixes.js)
  ok('backup: the totals are the hockey Results summary of those days, and the days are all there', JSON.stringify(j.totals) === JSON.stringify(want) && j.days.length === DATES.length + 1);
  cachesOn(); await get('/api/nhl/tally'); kv.reset(); const r2 = await worker.fetch(new Request('https://hub.test/api/nhl/export', { headers: { 'x-admin-token': 'secret' } }), env); const j2 = await r2.json();
  ok('backup: with the summary kept, the totals come from the cache and still match', JSON.stringify(j2.totals) === JSON.stringify(want) && kv.count().gets === DATES.length + 3, String(kv.count().gets)); } // + fix:analyst

// ---- the sweep's Results files and the health check use the kept summaries ----
{ cachesOn(); store.clear(); clearSummaries(); const a = await summary(env, { kind: 'tally', prefix: 'day:', build: () => ({ built: 1 }) }), b = await summary(env, { kind: 'tally', prefix: 'day:', build: () => { throw new Error('should not build'); } });
  ok('summary(): the second call is served kept, without building', a.cache === 'miss' && b.cache === 'mem' && b.text === '{"built":1}'); }

// ---- the stamp's parts ----
{ const open = { date: 'd', cards: [{ id: 1, kickoff: 'k', league: 'eng.1', home: 'A', away: 'B', odds: { h: 100 } }, { id: 2, final: { h: 1, a: 0 } }] };
  const moved = JSON.parse(JSON.stringify(open)); moved.cards[0].odds.h = 120;
  ok('stamp: a day with an open game is described by its settled view (an open game\'s price does not change it, a result does)', await dayPart(open, 'w1') === await dayPart(moved, 'w2') && await dayPart(open, 'w1') !== await dayPart({ ...open, cards: [open.cards[0], { id: 2, final: { h: 1, a: 1 } }] }, 'w1') && !('odds' in settledView(open).cards[0]));
  ok('stamp: a finished day is described by its write id; a day saved before write ids existed by "-"', await dayPart({ date: 'd', cards: [{ final: { h: 0, a: 0 } }, { void: 'postponed' }] }, 'abc') === 'wabc wabc' && await dayPart({ date: 'd', cards: [{ grade: {} }] }, '-') === '- -');
  const more = { ...open, cards: [...open.cards, { id: 3, kickoff: 'k2', league: 'eng.1', home: 'C', away: 'D' }] }, [r1, t1] = (await dayPart(open, 'x')).split(' '), [r2, t2] = (await dayPart(more, 'y')).split(' ');
  ok('stamp: a new open game changes the Trends part only (tally and nhlTally skip open games)', r1 === r2 && t1 !== t2); }

cachesOff();
console.log(fails ? `\n${fails} summary cache check(s) FAILED` : '\nAll summary cache checks passed'); process.exit(fails ? 1 : 0);
