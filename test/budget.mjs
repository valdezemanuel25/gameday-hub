// The run's outside calls (src/store.js budget): a busy cron run (five leagues in the lineup window with both price keys set, a results
// sync as the rotating job, alerts for several devices) stays under the free plan's 50 subrequests, and what it could not do waits.
import worker, { oddsStep, oddsCost, SLOT_COST, ODDS_KEEP, leadStep } from '../src/worker.js';
import { budget, ask, RUN_BUDGET } from '../src/store.js';
import { b64u } from '../src/push.js';
let fail = 0; const ok = (n, c, x = '') => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (c ? '' : ' ' + x)); if (!c) fail++; };

// ---- the budget itself ----
{ const b = budget(10);
  ok('take: granted while enough is left, and kept back for later steps', b.take(4) && b.left === 6 && !b.take(3, 4) && b.left === 6 && b.take(2, 4) && b.left === 4);
  const ch = b.child(3); ok('child: set aside from what is left', ch.left === 3 && b.left === 1 && ch.take(3) && !ch.take(1));
  b.spend(5); ok('spend: never below zero', b.left === 0);
  ok('no budget (a button): every ask is granted', ask({}, 99) === true && ask({ BUDGET: budget(1) }, 2) === false); }

// ---- a busy run ----
const KO = Date.parse('2026-11-28T15:00:00Z'), NOW = KO - 25 * 60000, DATE = '2026-11-28', LEAGUES = ['eng.1', 'esp.1', 'ger.1', 'ita.1', 'fra.1'];
const kv = new Map(), HUB = {
  get: async (k, t) => { const v = kv.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; },
  put: async (k, v) => { kv.set(k, v); }, delete: async k => { kv.delete(k); },
  list: async ({ prefix } = {}) => ({ keys: [...kv.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true }),
};
const games = l => Array.from({ length: 6 }, (_, i) => `${l}-${i}`);
kv.set(`day:${DATE}`, JSON.stringify({ date: DATE, analyzed: {}, cards: LEAGUES.flatMap(l => games(l).map(id => ({ id, league: l, leagueKey: l, kickoff: new Date(KO).toISOString(), home: 'H ' + id, away: 'A ' + id, ko: '9:00 AM',
  v2: { pick: 'H', p: [70, 18, 12], over: 70, btts: 60 }, v4: { pick: 'H', p: [68, 20, 12], over: 68, btts: 62 }, fb: { p: [66, 20, 14], over: 66, btts: 61 }, sm: { h: 2, a: 1, text: '2–1' } }))) }));
const phone = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']), pub = b64u(await crypto.subtle.exportKey('raw', phone.publicKey));
kv.set('push', JSON.stringify({ subs: Array.from({ length: 5 }, (_, i) => ({ endpoint: `https://push.example.com/d${i}`, keys: { p256dh: pub, auth: b64u(crypto.getRandomValues(new Uint8Array(16))) } })), sent: {} }));
let calls = 0;
const espn = u => { const slug = (u.match(/soccer\/([a-z.0-9]+)\/scoreboard/) || [])[1]; return { events: (LEAGUES.includes(slug) ? games(slug) : []).map(id => ({ id, date: new Date(KO).toISOString(), competitions: [{ status: { type: { completed: false } },
  odds: [{ provider: { name: 'DraftKings' }, moneyline: { home: { close: { odds: '-150' } }, draw: { close: { odds: '+260' } }, away: { close: { odds: '+400' } } } }],
  competitors: [{ homeAway: 'home', team: { id: 'h' + id, displayName: 'H ' + id } }, { homeAway: 'away', team: { id: 'a' + id, displayName: 'A ' + id } }] }] })) }; };
globalThis.fetch = async (u, init) => {
  calls++; u = String(u);
  if (/espn\.com/.test(u)) return new Response(JSON.stringify(espn(u)));
  if (/the-odds-api|odds-api/.test(u)) return new Response('[]', { headers: { 'x-requests-remaining': '400' } });
  if (/push\.example\.com/.test(u)) return new Response(null, { status: 201 });
  return new Response('[]');
};
const env = { ADMIN_TOKEN: 's', GAME_HOURS: '2', GRADE_DELAY_HOURS: '3', ODDS_API_KEY: 'k1', PINNODDS_KEY: 'p1', ASSETS: { fetch: () => new Response('a') }, HUB };
const realNow = Date.now; Date.now = () => NOW; const RealDate = Date;
globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } };
let p; await worker.scheduled({ scheduledTime: Math.floor(NOW / 1200000) * 1200000 }, env, { waitUntil: x => { p = x; } }); // slot 0: the results sync
try { await p; } catch (e) { /* the rotating job's own error still ends the run */ }
globalThis.Date = RealDate; Date.now = realNow;
const day = JSON.parse(kv.get(`day:${DATE}`)), read = LEAGUES.filter(l => day.cards.some(c => c.league === l && c.odds && c.odds.cl));
ok(`a busy run stays within the budget (${calls} outside calls of ${RUN_BUDGET}, the free plan allows 50)`, calls <= RUN_BUDGET, calls);
ok('...and still takes lineup reads (soonest first), leaving the rest for the next run', read.length >= 1 && read.length < LEAGUES.length, JSON.stringify(read));
ok('the price reads never eat into what the rotating job and the alerts need', oddsCost(env, 6) === 2 + 1 + 9 && ODDS_KEEP > SLOT_COST);

// ---- each step stops cleanly when it is out ----
{ const e = { HUB, BUDGET: budget(0) }; const before = calls;
  const r = await oddsStep(e, new Date(NOW), { match: async () => undefined, put: async () => {} });
  ok('oddsStep with no calls left: nothing fetched, every league waits', calls === before && r && [r, ...(r.also || [])].every(x => x.waiting === 'budget'), JSON.stringify(r)); }
{ kv.set('day:2026-11-27', JSON.stringify({ date: '2026-11-27', cards: [{ id: 'x', league: 'eng.1', kickoff: '2026-11-27T15:00:00Z', final: { h: 1, a: 0 } }] }));
  const before = calls, r = await leadStep({ HUB, GAME_HOURS: '2', GRADE_DELAY_HOURS: '3', BUDGET: budget(1) }, new Date('2026-11-28T12:00:00Z'), { '2026-11-27': JSON.parse(kv.get('day:2026-11-27')) }, null);
  ok('leadStep with too few calls left: no fetch, not counted as a try', calls === before && r && r.waiting === 'budget' && !JSON.parse(kv.get('day:2026-11-27')).cards[0].final.ldt, JSON.stringify(r)); }

console.log(fail ? `\n${fail} budget checks FAILED` : '\nAll budget checks passed'); process.exit(fail ? 1 : 0);
