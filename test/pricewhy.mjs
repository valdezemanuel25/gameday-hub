// The Movement tab's "No price" cards and their check (src/worker.js priceWhy, src/data.js oddsWhy), Nov 2, 2026.
import { priceWhy } from '../src/worker.js';
import { oddsWhy } from '../src/data.js';
import fs from 'fs';
let bad = 0; const ok = (n, c, x = '') => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (c ? '' : ' ' + x)); if (!c) bad++; };
const KO = '2026-11-07T15:00:00Z', NOW = new Date('2026-11-07T09:00:00Z'), D = '2026-11-07';
const mkEnv = cards => { const kv = new Map([[`day:${D}`, JSON.stringify({ date: D, cards })]]); return { kv, env: { HUB: { get: async (k, t) => { const x = kv.get(k); return x == null ? null : t === 'json' ? JSON.parse(x) : x; }, put: async (k, x) => { kv.set(k, x); }, list: async () => ({ keys: [] }) } } }; };
const card = { id: '9', league: 'ger.2', home: 'Hertha Berlin', away: 'VfL Wolfsburg', kickoff: KO, v2: { p: [40, 28, 32] }, v4: { p: [41, 27, 32], over: 55, btts: 55 } };
const { env } = mkEnv([card]);
const why = r => async () => r;
ok('why: a league the Hub does not price', (await priceWhy(env, D, 'por.1', '9', NOW, why({}))).kind === 'unpriced');
ok('why: ESPN does not answer', (x => x.kind === 'error' && /ESPN/.test(x.title))(await priceWhy(env, D, 'ger.2', '9', NOW, why({ error: '503' }))));
ok('why: the game is gone from ESPN for that day (postponed or moved)', (await priceWhy(env, D, 'ger.2', '9', NOW, why({ found: false }))).kind === 'gone');
ok('why: ESPN lists the game with no book yet', (x => x.kind === 'none' && /no sportsbook/.test(x.detail))(await priceWhy(env, D, 'ger.2', '9', NOW, why({ found: true, books: [], parsed: null, missing: [] }))));
ok('why: a book is listed without all three prices (names the missing one)', (x => x.kind === 'partial' && /DraftKings/.test(x.detail) && /draw/.test(x.detail))(await priceWhy(env, D, 'ger.2', '9', NOW, why({ found: true, books: ['DraftKings'], parsed: null, missing: ['draw'] }))));
ok('why: a price came after the lock is not taken', (x => x.kind === 'locked' && /\+160 \/ \+260 \/ \+140/.test(x.detail))(await priceWhy(env, D, 'ger.2', '9', new Date('2026-11-07T14:50:00Z'), why({ found: true, books: ['DraftKings'], parsed: { h: 160, d: 260, a: 140 }, missing: [] }))));
// ESPN has a price now: it is read and saved for the league at once
const ev = { id: '9', date: KO, status: { type: { name: 'STATUS_SCHEDULED' } }, competitions: [{ status: { type: { completed: false } }, odds: [{ provider: { name: 'DraftKings' }, moneyline: { home: { close: { odds: '+160' } }, draw: { close: { odds: '+260' } }, away: { close: { odds: '+140' } } } }],
  competitors: [{ homeAway: 'home', team: { id: '1', displayName: 'Hertha Berlin', abbreviation: 'BSC' } }, { homeAway: 'away', team: { id: '2', displayName: 'VfL Wolfsburg', abbreviation: 'WOB' } }] }] };
globalThis.fetch = async u => new Response(JSON.stringify(/espn/.test(String(u)) && /20261107/.test(String(u)) ? { events: [ev] } : { events: [] }));
const s1 = mkEnv([card]), sv = await priceWhy(s1.env, D, 'ger.2', '9', NOW);
ok('why: ESPN has a price now, so it is saved straight away', sv.kind === 'saved' && JSON.parse(s1.kv.get(`day:${D}`)).cards[0].odds.h === 160, JSON.stringify(sv));
// the check saw a price but the league read that follows missed the game (ESPN's second answer was empty): not "saved"
const evFetch = globalThis.fetch;
globalThis.fetch = async u => new Response(JSON.stringify({ events: [] }));
const s2 = mkEnv([card]), sv2 = await priceWhy(s2.env, D, 'ger.2', '9', NOW, why({ found: true, books: ['DraftKings'], parsed: { h: 160, d: 260, a: 140 }, missing: [] }));
ok('why: a price seen but not saved by the league read is an error, not "saved"', sv2.kind === 'error' && /not saved/.test(sv2.title) && !JSON.parse(s2.kv.get(`day:${D}`)).cards[0].odds, JSON.stringify(sv2));
globalThis.fetch = async u => { throw new Error('network down'); };
const sv3 = await priceWhy(mkEnv([card]).env, D, 'ger.2', '9', NOW, why({ found: true, books: ['DraftKings'], parsed: { h: 160, d: 260, a: 140 }, missing: [] }));
ok('why: the league read failing is an error too', sv3.kind === 'error', JSON.stringify(sv3));
globalThis.fetch = evFetch;
// oddsWhy reads the feed: a Bet365-only game is a stand-in price, a DraftKings entry missing the draw is partial
const w1 = await oddsWhy('ger.2', D, '9');
ok('oddsWhy: finds the game and reads the DraftKings price', w1.found && w1.books.join() === 'DraftKings' && w1.parsed.h === 160 && !w1.missing.length, JSON.stringify(w1));
globalThis.fetch = async u => new Response(JSON.stringify({ events: [{ ...ev, competitions: [{ ...ev.competitions[0], odds: [{ provider: { name: 'DraftKings' }, moneyline: { home: { close: { odds: '+160' } }, away: { close: { odds: '+140' } } } }] }] }] }));
const w2 = await oddsWhy('ger.2', D, '9');
ok('oddsWhy: a DraftKings entry with no draw price is named as missing the draw', w2.found && w2.missing.join() === 'draw', JSON.stringify(w2));
ok('why: home and away but no draw is an incomplete price, not saved', (await priceWhy(mkEnv([card]).env, D, 'ger.2', '9', NOW, async () => w2)).kind === 'partial');
globalThis.fetch = async u => new Response(JSON.stringify({ events: [{ ...ev, competitions: [{ ...ev.competitions[0], odds: [null] }] }] }));
ok('oddsWhy: no book at all', (x => x.found && !x.books.length && !x.parsed)(await oddsWhy('ger.2', D, '9')));
globalThis.fetch = async u => new Response(JSON.stringify({ events: [] }));
ok('oddsWhy: the game is not in the feed', (await oddsWhy('ger.2', D, '9')).found === false);
// the page: red cards only for priced leagues, and the No price signal is a button that asks /api/price-why
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
ok('page: no-price cards and the count at the top only for leagues the Hub prices (no card for Portugal)', /const np = day\.cards\.filter\(c => PRICED_LG\.has\(c\.league\)/.test(html) && /unpriced = day\.cards\.filter\(c => PRICED_LG\.has\(c\.league\)/.test(html) && !/PRICED_LG = new Set\(\[[^\]]*por\.1/.test(html));
ok('page: Refresh prices and Get Both-score prices are on the Movement tab too, and say why when a day has nothing left to price', /return oddsBar\(\) \+ seg \+ head/.test(html) && /if \(!n\) return `<div class="small"[^`]*Pick a later day above/.test(html));
ok('page: the No price signal is a button that asks the Hub why', /data-npwhy="\$\{esc\(c\.id\)\}"/.test(html) && /post\('\/api\/price-why'/.test(html));
console.log(bad ? `\n${bad} FAILED` : '\nAll no-price checks passed'); process.exit(bad ? 1 : 0);
