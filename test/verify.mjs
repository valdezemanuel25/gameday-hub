// Verify and assign: games a fetch could not match by name are kept as suggestions and can be assigned to a card.
import worker from '../src/worker.js';
import { forebetFetch } from '../src/forebetpage.js';

const kv = new Map();
const env = { ADMIN_TOKEN: 's', ASSETS: { fetch: () => new Response('a') }, HUB: {
  get: async (k, t) => { const v = kv.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => { kv.set(k, v); },
  list: async ({ prefix }) => ({ keys: [...kv.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }) } };
let fail = 0;
const ok = (n, c, x = '') => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (c ? '' : ' ' + x)); if (!c) fail++; };
const call = async (path, body) => (await worker.fetch(new Request('https://x' + path, { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined, headers: { 'x-admin-token': 's' } }), env)).json();

const date = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const ko = new Date(Date.now() + 30 * 3600000).toISOString();
const dayKey = 'day:' + date;
kv.set(dayKey, JSON.stringify({ date, analyzed: {}, cards: [
  { id: '1', league: 'ger.1', home: 'Eintracht Frankfurt', away: 'Totally Different FC', kickoff: ko, final: null, v2: { p: [40, 30, 30], pick: 'H', over: 50, btts: 50, scores: [['1–1', 10]], lam: [1, 1], best: { pick: 'x', p: 50 } } },
  { id: '2', league: 'ger.1', home: 'Mainz', away: 'Bochum', kickoff: ko, final: null, v2: { p: [40, 30, 30], pick: 'H', over: 50, btts: 50, scores: [['1–1', 10]], lam: [1, 1], best: { pick: 'x', p: 50 } } },
] }));
const row = (h, a, p, pr) => `<div class="rcnt"><span itemprop="homeTeam"><span itemprop="name">${h}</span></span><span itemprop="awayTeam"><span itemprop="name">${a}</span></span><time itemprop="startDate" datetime="${date}">x</time><div class="fprc"><span>${p[0]}</span><span>${p[1]}</span><span>${p[2]}</span></div><span class="forepr"><span>${pr}</span></span></div>`;
// Forebet lists Mainz–Bochum (matches) and Frankfurt against a name we cannot match
const html = row('Mainz', 'Bochum', [50, 25, 25], '1') + row('Eintracht Frankfurt', 'Koeln Neustadt', [45, 28, 27], '1');
const r = await forebetFetch(env, 'ger.1', '1x2', new Date(), async () => ({ ok: true, text: async () => html }));
ok('the matching game is saved on its card', r.saved === 1 && JSON.parse(kv.get(dayKey)).cards[1].fb?.p[0] === 50, JSON.stringify(r));
let c = await call('/api/candidates?date=' + date);
ok('the leftover row is offered for the card that has no Forebet data', c.items.length === 1 && c.items[0].cardId === '1' && /Frankfurt/.test(c.items[0].title), JSON.stringify(c));
const w0 = [...kv.keys()].length;
await forebetFetch(env, 'ger.1', '1x2', new Date(), async () => ({ ok: true, text: async () => html }));
ok('the same suggestions are not stored again', JSON.stringify(JSON.parse(kv.get('meta:unm')).items.length) === '1');
const a = await call('/api/assign', { date, league: 'ger.1', id: '1', key: c.items[0].key });
const card = JSON.parse(kv.get(dayKey)).cards[0];
ok('assigning puts the Forebet numbers on the card', a.assigned && card.fb.p.join('/') === '45/28/27' && card.fb.how === 'assigned by you', JSON.stringify(a));
c = await call('/api/candidates?date=' + date);
ok('the suggestion is gone once assigned', c.items.length === 0);
// dismiss
kv.set('meta:unm', JSON.stringify({ items: [{ src: 'fb', key: 'k1', cardId: '2', date, slug: 'ger.1', kind: '1x2', title: 'X vs Y', row: { home: 'X', away: 'Y', date, p: [34, 33, 33] } }] }));
const d = await call('/api/assign', { date, league: 'ger.1', id: '2', key: 'k1', dismiss: true });
ok('dismissing removes a wrong suggestion and changes no card', d.dismissed && (await call('/api/candidates?date=' + date)).items.length === 0);
// started game
kv.set(dayKey, JSON.stringify({ date, cards: [{ id: '3', league: 'ger.1', home: 'A', away: 'B', kickoff: new Date(Date.now() - 3600000).toISOString(), final: null }] }));
kv.set('meta:unm', JSON.stringify({ items: [{ src: 'fb', key: 'k2', cardId: '3', date, slug: 'ger.1', kind: '1x2', title: 'A vs B', row: { home: 'A', away: 'B', date, p: [34, 33, 33] } }] }));
const s2 = await call('/api/assign', { date, league: 'ger.1', id: '3', key: 'k2' });
ok('a game that already started is refused', /already started/.test(s2.error || ''), JSON.stringify(s2));
// Use all: one game with a 1X2, an Over/Under and a Both score table waiting; the button applies each one in turn
{
  kv.set(dayKey, JSON.stringify({ date, cards: [{ id: '5', league: 'eng.2', home: 'Southampton', away: 'Queens Park Rangers', kickoff: ko, final: null }] }));
  const it = (kind, extra) => ({ src: 'fb', key: `fb|eng.2|${kind}|5|0`, cardId: '5', date, slug: 'eng.2', kind, title: 'Southampton vs QPR', row: { home: 'Southampton', away: 'Queens Park Rangers', date, ...extra } });
  kv.set('meta:unm', JSON.stringify({ items: [it('1x2', { p: [55, 25, 20], pred: '1' }), it('ou', { over: 58 }), it('btts', { btts: 52 })] }));
  const items = (await call('/api/candidates?date=' + date)).items;
  const rs = []; for (const i of items) rs.push(await call('/api/assign', { date, league: 'eng.2', id: '5', key: i.key }));
  const fb = JSON.parse(kv.get(dayKey)).cards[0].fb || {};
  ok('Use all: every Forebet table lands on the one game', rs.every(r => r.assigned) && fb.p?.join('/') === '55/25/20' && fb.over === 58 && fb.btts === 52, JSON.stringify({ rs, fb }));
  ok('Use all: nothing is left waiting for that game', (await call('/api/candidates?date=' + date)).items.length === 0);
}
// SportsMole: no name match, but a preview with one matching club is suggested; assigning reads its "We say" line
{
  const { smLeague } = await import('../src/worker.js');
  kv.set(dayKey, JSON.stringify({ date, cards: [{ id: '4', league: 'ger.1', home: 'Eintracht Frankfurt', away: 'Zebra United', kickoff: ko, final: null, v2: { p: [40, 30, 30], pick: 'H', over: 50, btts: 50, scores: [['1–1', 10]], lam: [1, 1], best: { pick: 'x', p: 50 } } }] }));
  kv.delete('sm:list'); kv.delete('sm:seen'); kv.set('meta:unm', JSON.stringify({ items: [] }));
  const realFetch = globalThis.fetch;
  globalThis.fetch = async url => url.includes('/preview/') && !url.includes('_123') ? { ok: true, text: async () => '<a href="/football/preview/eintracht-frankfurt-vs-fc-koln-prediction-team-news-lineups_123.html">x</a>' } : { ok: true, text: async () => '<h2>We say: Eintracht Frankfurt 2-1 FC Koln</h2>' };
  const r = await smLeague(date, 'ger.1', env, new Date(), { force: true });
  const c = await call('/api/candidates?date=' + date);
  ok('SportsMole: the unmatched preview is offered', r.found === 0 && c.items.length === 1 && c.items[0].src === 'sm' && /Frankfurt/.test(c.items[0].title), JSON.stringify(c));
  const a = await call('/api/assign', { date, league: 'ger.1', id: '4', key: c.items[0].key });
  const card = JSON.parse(kv.get(dayKey)).cards[0];
  ok('SportsMole: assigning reads and saves the "We say" score', a.assigned && card.sm && card.sm.h === 2 && card.sm.a === 1, JSON.stringify(a));
  globalThis.fetch = realFetch;
}
console.log(fail ? `\n${fail} verify checks FAILED` : '\nAll verify checks passed');
process.exit(fail ? 1 : 0);
