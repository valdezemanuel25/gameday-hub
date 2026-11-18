// Lost saves, round 2 (Nov 18, 2026, docs/audit-2026-11-18/round2-agent1.md): a button's save goes to a side record (fix:<key>) that every
// read lays on top and the cron's next save carries in (src/fixes.js), so a button pressed near a cron save can no longer erase it, and
// the other way round. The KV below can serve one location's reads from a copy taken before the other location's last save, the way
// Cloudflare KV can serve a read up to about 60 seconds old.
import worker, { putDay, getDay, listDays, withFixes, writeKind, counted } from '../src/worker.js';
import { foldStep, FOLD_AFTER_MS, FIX_TTL, applyFix, readMerged } from '../src/fixes.js';
import { nhlSetLine } from '../src/nhl.js';
import { getAnalyst } from '../src/analyst.js';

let fails = 0;
const ok = (name, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${cond ? '' : extra}`); };

const live = new Map(); let lagged = null; const puts = [];
const hubFor = stale => ({
  get: async (k, t) => { const v = (stale && lagged ? lagged : live).get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; },
  put: async (k, v, o) => { live.set(k, v); puts.push({ k, o }); }, delete: async k => { live.delete(k); },
  list: async ({ prefix }) => ({ keys: [...live.keys()].filter(k => k.startsWith(prefix)).sort().map(name => ({ name })), list_complete: true }),
});
const freeze = () => { lagged = new Map(live); }; // the other location still sees the store as it is now
const thaw = () => { lagged = null; };
const base = { ADMIN_TOKEN: 'secret', ASSETS: { fetch: () => new Response('asset') } };
const cron = (stale = false) => withFixes({ ...base, HUB: hubFor(stale) }); // one scheduled run
const button = (stale = true) => withFixes({ ...base, HUB: hubFor(stale) }, { button: true }); // one request
const plain = (stale = false) => ({ ...base, HUB: hubFor(stale) }); // the store with no side records (the old way)
const DATE = '2026-11-21', KEY = `day:${DATE}`, KO = '2026-11-21T15:00:00Z';
const mkCard = (id, x = {}) => ({ id, league: 'eng.1', home: `H${id}`, away: `A${id}`, kickoff: KO, final: null, v2: { p: [45, 30, 25] }, odds: { h: -150, d: 260, a: 400, f: { h: -140, d: 250, a: 380 } }, ...x });
const seed = () => { live.clear(); thaw(); live.set(KEY, JSON.stringify({ date: DATE, analyzed: { 'eng.1': 1 }, cards: [mkCard('g1'), mkCard('g2')] })); };
const rawDay = () => JSON.parse(live.get(KEY));
const merged = async () => getDay(cron(), DATE);
const cardOf = (d, id) => d.cards.find(c => c.id === id);
// the cron's lineup read on g1: the closing price (what a lost save used to erase)
const cronClose = async (env = cron()) => { const d = await getDay(env, DATE); Object.assign(cardOf(d, 'g1').odds, { h: -170, cl: '2026-11-21T14:35:00Z' }); await putDay(env, DATE, d); };
// a button's read-modify-write of one card (Forebet numbers, as forebetPaste / assignCandidate do)
const buttonFb = async (env, id = 'g1', p = [40, 30, 30]) => { const d = await getDay(env, DATE); cardOf(d, id).fb = { p, how: 'assigned by you' }; await putDay(env, DATE, d); };

// ---- 1. the bug, the old way: a button that read the day before the cron's lineup read erases it ----
seed(); freeze();
await cronClose(plain(false));
await buttonFb(plain(true));
ok('the old way (one record, both write it): the lineup-window close is lost to a button\'s stale save', !cardOf(rawDay(), 'g1').odds.cl && cardOf(rawDay(), 'g1').fb, JSON.stringify(cardOf(rawDay(), 'g1').odds));

// ---- 2. the same race with side records: nothing is lost ----
seed(); freeze();
await cronClose();
const before = live.get(KEY); puts.length = 0;
await buttonFb(button(true));
let m = await merged();
ok('button: it never writes the day; its change is one write to the side record', live.get(KEY) === before && puts.length === 1 && puts[0].k === `fix:${KEY}` && puts[0].o && puts[0].o.expirationTtl === FIX_TTL, JSON.stringify(puts));
ok('read: the cron\'s close and the button\'s Forebet numbers are both on the card', cardOf(m, 'g1').odds.cl && cardOf(m, 'g1').odds.h === -170 && cardOf(m, 'g1').fb && cardOf(m, 'g1').fb.p[0] === 40, JSON.stringify(cardOf(m, 'g1')));
ok('the patch holds only what the button changed (the card\'s Forebet field)', JSON.stringify(Object.keys(JSON.parse(live.get(`fix:${KEY}`)).cards['eng.1|g1'].set)) === '["fb"]', live.get(`fix:${KEY}`));
ok('the router\'s day read (/api/day) shows the merged day', !!cardOf(await (await worker.fetch(new Request(`https://hub.test/api/day?date=${DATE}`, { headers: { 'x-admin-token': 'secret' } }), { ...base, HUB: hubFor(false) })).json(), 'g1').fb);

// ---- 3. the other way round: a cron save from a stale read cannot erase the button's change; the next fresh cron save carries it in ----
seed(); freeze();
await buttonFb(button(false)); // the button's location is up to date
{ const env = cron(true); const d = await getDay(env, DATE); cardOf(d, 'g2').v2 = { p: [50, 25, 25] }; await putDay(env, DATE, d); } // the cron read before the button saved
thaw(); m = await merged();
ok('a cron save from before the button\'s keeps nothing of it in the day, but the read still shows it', !cardOf(rawDay(), 'g1').fb && cardOf(m, 'g1').fb && cardOf(m, 'g2').v2.p[0] === 50, JSON.stringify(cardOf(m, 'g1')));
await cronClose(); // the next cron save (fresh read) carries the patch in
const r1 = rawDay();
ok('fold: the cron\'s next save carries the patch into the day and notes it (fxAt)', cardOf(r1, 'g1').fb && cardOf(r1, 'g1').odds.cl && r1.fxAt === JSON.parse(live.get(`fix:${KEY}`)).cards['eng.1|g1'].at, JSON.stringify(r1.fxAt));
ok('fold: a carried-in patch is not laid again (the read is the stored day itself)', applyFix(r1, JSON.parse(live.get(`fix:${KEY}`))) === r1);
// after the fold the cron moves the price on; a later button press on the same card must not bring the old patch back
{ const env = cron(); const d = await getDay(env, DATE); cardOf(d, 'g1').odds.h = -190; await putDay(env, DATE, d); }
{ const env = button(false); const d = await getDay(env, DATE); cardOf(d, 'g1').sm = { h: 2, a: 1 }; await putDay(env, DATE, d); }
m = await merged();
ok('an old patch the cron already carried in is dropped: the cron\'s later price stands', cardOf(m, 'g1').odds.h === -190 && cardOf(m, 'g1').sm && !JSON.parse(live.get(`fix:${KEY}`)).cards['eng.1|g1'].set.fb, JSON.stringify(cardOf(m, 'g1')));

// ---- 4. a stale button copy cannot take away a result, its locked pick or a close ----
seed(); freeze();
{ const env = cron(); const d = await getDay(env, DATE); Object.assign(cardOf(d, 'g2'), { final: { h: 2, a: 0 }, grade: { v2: { outcomeHit: 1 } }, lean: { k: 'lean', key: 'H', hit: true, price: -150 } }); await putDay(env, DATE, d); }
{ const env = button(true); const d = await getDay(env, DATE); const c = cardOf(d, 'g2'); c.odds = { ...c.odds, h: -160 }; c.fb = { p: [60, 20, 20] }; await putDay(env, DATE, d); }
m = await merged();
ok('the cron\'s grade and locked pick survive a stale button save on the same card', cardOf(m, 'g2').final && cardOf(m, 'g2').lean && cardOf(m, 'g2').lean.price === -150 && cardOf(m, 'g2').fb, JSON.stringify(cardOf(m, 'g2')));

// ---- 5. a day the button makes from nothing is written directly (nothing to erase); old days read as before ----
live.clear(); thaw(); puts.length = 0;
{ const env = button(false); const d = (await getDay(env, '2026-11-25')) || { date: '2026-11-25', cards: [], analyzed: {} }; d.cards.push(mkCard('n1')); await putDay(env, '2026-11-25', d); }
ok('a new day from a button (Analyze this day) is written as the day itself', live.has('day:2026-11-25') && !live.has('fix:day:2026-11-25'));
{ const old = { date: '2026-10-20', cards: [mkCard('o1', { final: { h: 1, a: 0 } })] }; live.set('day:2026-10-20', JSON.stringify(old));
  const g = await getDay(plain(), '2026-10-20');
  ok('a day saved before this change (no side record) reads exactly as stored', JSON.stringify(g) === JSON.stringify(old));
  const all = await listDays(plain());
  ok('listDays: every saved day, oldest first, merged', all.length === 2 && all[0].date === '2026-10-20' && all[1].date === '2026-11-25'); }

// ---- 6. hockey: a typed line (button) next to the cron's lineup read ----
{
  live.clear(); thaw(); const nd = '2026-11-21', nkey = `nhl:day:${nd}`, ko = new Date(Date.now() + 25 * 60000).toISOString();
  live.set(nkey, JSON.stringify({ date: nd, cards: [{ id: '9100', kickoff: ko, home: 'Edmonton Oilers', away: 'Detroit Red Wings', hAbbr: 'EDM', aAbbr: 'DET', final: null, px: { h: -150, a: 130, f: { h: -140, a: 120 } } }] }));
  freeze();
  { const env = cron(); const d = await getDay(env, nd, 'nhl'); Object.assign(d.cards[0].px, { h: -165, cl: new Date().toISOString() }); await env.HUB.put(nkey, JSON.stringify(d)); }
  const r = await nhlSetLine(button(true), nd, '9100', 6.5);
  const h = (await getDay(cron(), nd, 'nhl')).cards[0];
  ok('hockey: the line typed from a stale page and the cron\'s lineup read are both kept', r.saved && h.ln && h.ln.v === 6.5 && h.px.cl && h.px.h === -165 && !JSON.parse(live.get(nkey)).cards[0].ln, JSON.stringify(h));
}

// ---- 7. the Analyst's record: a bet placed from a button and one placed by the cron are both kept, once each ----
{
  live.clear(); thaw();
  const bet = (id, gid, key = 'H', x = {}) => ({ id, at: '2026-11-21T10:00:00Z', date: DATE, league: 'eng.1', gid, rule: 'move', key, price: -120, kickoff: KO, res: null, ...x });
  live.set('analyst', JSON.stringify({ v: 1, items: [bet('a1', 'g0')] }));
  freeze();
  { const env = cron(); const doc = await getAnalyst(env); doc.items.unshift(bet('c1', 'g1')); await env.HUB.put('analyst', JSON.stringify(doc)); } // the cron bets g1
  { const env = button(true); const doc = await getAnalyst(env); doc.items.unshift(bet('b1', 'g2'), bet('b2', 'g1')); await env.HUB.put('analyst', JSON.stringify(doc)); } // a stale button look bets g2, and g1 again
  const d = await readMerged(cron(), 'analyst'), ids = d.items.map(b => b.id).sort().join();
  ok('Analyst: the cron\'s bet survives a stale button save, the button\'s new bet is kept, and g1 holds one position', ids === 'a1,b1,c1' && JSON.parse(live.get('analyst')).items.length === 2, ids);
  { const env = button(false); const doc = await getAnalyst(env); Object.assign(doc.items.find(b => b.id === 'c1'), { res: 'win', units: 0.83, close: -130 }); await env.HUB.put('analyst', JSON.stringify(doc)); }
  ok('Analyst: a bet settled from a button (the Analyst tab) is kept settled', (await readMerged(cron(), 'analyst')).items.find(b => b.id === 'c1').res === 'win');
}

// ---- 8. the fold step: a patch no cron save carried in is saved after FOLD_AFTER_MS, one write ----
{
  seed(); await buttonFb(button(false)); puts.length = 0;
  const at = JSON.parse(live.get(`fix:${KEY}`)).cards['eng.1|g1'].at;
  ok('fold step: a fresh patch is left for the cron\'s own saves', (await foldStep(cron(), new Date(at + 60000))) === null && puts.length === 0);
  const f = await foldStep(cron(), new Date(at + FOLD_AFTER_MS + 60000));
  ok('fold step: an older patch is saved into the day with one write', f && f.folded === KEY && puts.length === 1 && cardOf(rawDay(), 'g1').fb && rawDay().fxAt === at, JSON.stringify(f));
  ok('fold step: then nothing is left to fold', (await foldStep(cron(), new Date(at + 2 * FOLD_AFTER_MS))) === null && puts.length === 1);
}

// ---- 9. a button through the router: one write, to the side record, counted as a button save ----
{
  seed(); puts.length = 0;
  live.set('meta:unm', JSON.stringify({ items: [{ src: 'fb', key: 'k1', cardId: 'g2', date: DATE, slug: 'eng.1', kind: '1x2', title: 'Hg2 vs Ag2', row: { home: 'Hg2', away: 'Ag2', date: DATE, p: [34, 33, 33] } }] }));
  const future = mkCard('g2', { kickoff: new Date(Date.now() + 86400000).toISOString() });
  live.set(KEY, JSON.stringify({ date: DATE, analyzed: {}, cards: [mkCard('g1'), future] }));
  const day0 = live.get(KEY);
  const r = await (await worker.fetch(new Request('https://hub.test/api/assign', { method: 'POST', headers: { 'x-admin-token': 'secret' }, body: JSON.stringify({ date: DATE, league: 'eng.1', id: 'g2', key: 'k1' }) }), { ...base, HUB: hubFor(false) })).json();
  m = await merged();
  ok('router: Assign saves the Forebet numbers as a patch and leaves the day record alone', r.assigned && live.get(KEY) === day0 && cardOf(m, 'g2').fb && cardOf(m, 'g2').fb.p[0] === 34, JSON.stringify(r));
  ok('write budget: the patch is counted under its own heading', writeKind(`fix:${KEY}`) === 'button saves' && writeKind('fix:nhl:day:2026-11-21') === 'button saves' && writeKind('fix:analyst') === 'button saves');
  const c = counted({ HUB: hubFor(false) }); const e = withFixes(c.env, { button: true }); const d = await getDay(e, DATE); cardOf(d, 'g1').sm = { h: 1, a: 1 };
  puts.length = 0; await putDay(e, DATE, d);
  ok('write budget: a button press costs one write, as before (it used to be the day\'s)', puts.length === 1 && puts[0].k === `fix:${KEY}`);
  const c2 = withFixes({ HUB: hubFor(false) }, { button: true }); puts.length = 0; await putDay(c2, DATE, await getDay(c2, DATE));
  ok('write budget: a button that changed nothing writes nothing', puts.length === 0);
}

// ---- 10. the kept Results summary (src/summaries.js, Agent 3) is rebuilt when a button's patch changes a finished game ----
{
  const { clearSummaries, listKeys } = await import('../src/summaries.js');
  // Workers KV with metadata (the write ids) and an edge cache, in memory
  const m = new Map();
  const HUB = { async get(k, t) { const v = m.get(k); return v ? (t === 'json' ? JSON.parse(v.value) : v.value) : null; },
    async getWithMetadata(k, t) { const v = m.get(k); return v ? { value: t === 'json' ? JSON.parse(v.value) : v.value, metadata: v.metadata } : { value: null, metadata: null }; },
    async put(k, value, o) { m.set(k, { value: String(value), metadata: o && o.metadata !== undefined ? o.metadata : null }); }, async delete(k) { m.delete(k); },
    async list({ prefix }) { return { keys: [...m.keys()].filter(k => k.startsWith(prefix)).sort().map(name => ({ name, ...(m.get(name).metadata ? { metadata: m.get(name).metadata } : {}) })), list_complete: true }; } };
  const store = new Map(); globalThis.caches = { default: { async match(r) { const x = store.get(r.url); return x == null ? undefined : new Response(x); }, async put(r, res) { store.set(r.url, await res.text()); }, async delete(r) { return store.delete(r.url); } } };
  clearSummaries();
  const env = { ...base, GAME_HOURS: '2', GRADE_DELAY_HOURS: '3', HUB };
  const ko = '2026-11-21T15:00:00Z', v = { p: [50, 25, 25], pick: 'H', over: 55, btts: 50, scores: [['1–0', 12]], lam: [1.5, 1], best: { pick: 'H', p: 50 } };
  { const c = counted(env); await c.env.HUB.put(KEY, JSON.stringify({ date: DATE, analyzed: {}, cards: [{ id: 'g9', league: 'eng.1', leagueName: 'Premier League', home: 'Arsenal', away: 'Brighton', kickoff: ko, final: null, v2: v, v4: v }] })); }
  const team = (id, n) => ({ id, displayName: n, abbreviation: n.slice(0, 3).toUpperCase() });
  const real = globalThis.fetch;
  globalThis.fetch = async u => new Response(JSON.stringify({ events: /eng\.1\/scoreboard\?dates=20261121/.test(String(u)) ? [{ id: 'g9', date: ko, competitions: [{ status: { type: { completed: true } }, odds: [],
    competitors: [{ homeAway: 'home', team: team(359, 'Arsenal'), score: '2' }, { homeAway: 'away', team: team(331, 'Brighton'), score: '0' }] }] }] : [] }));
  const call = (p, method = 'GET') => worker.fetch(new Request('https://hub.test' + p, { method, headers: { 'x-admin-token': 'secret' } }), env);
  const t0 = await call('/api/tally'), j0 = await t0.json(), t1 = await call('/api/tally');
  ok('summary: kept after the first build (the second load is served from it)', t0.headers.get('x-hub-cache') === 'miss' && t1.headers.get('x-hub-cache') !== 'miss' && j0.newlyGraded === 0, `${t0.headers.get('x-hub-cache')} ${t1.headers.get('x-hub-cache')}`);
  const g = await (await call(`/api/grade?league=eng.1&date=${DATE}`, 'POST')).json(); // the Grade button: a side patch, the day record untouched
  ok('setup: the Grade button graded the game into the side record, with a write id', g.graded === 1 && !JSON.parse(m.get(KEY).value).cards[0].final && m.get(`fix:${KEY}`) && m.get(`fix:${KEY}`).metadata && m.get(`fix:${KEY}`).metadata.w, JSON.stringify(g));
  const lk = await listKeys(HUB, 'day:');
  ok('listing: the day\'s id joins its side record\'s write id (a plain store is listed for it too)', lk[0].metadata && lk[0].metadata.w.endsWith('+' + m.get(`fix:${KEY}`).metadata.w), JSON.stringify(lk));
  const t2 = await call('/api/tally'), j2 = await t2.json();
  ok('summary: a button\'s patch on a finished game rebuilds the Results (not the kept answer)', t2.headers.get('x-hub-cache') === 'miss' && j2.newlyGraded === 1 && j2.leans.n === 1, `${t2.headers.get('x-hub-cache')} ${j2.newlyGraded}`);
  const t3 = await call('/api/tally');
  ok('summary: and is kept again until the next change', t3.headers.get('x-hub-cache') !== 'miss' && (await t3.json()).newlyGraded === 1);
  globalThis.fetch = real; delete globalThis.caches; clearSummaries();
}

console.log(fails ? `\n${fails} FAILED` : '\nAll side-record (lost saves) checks passed');
process.exit(fails ? 1 : 0);
