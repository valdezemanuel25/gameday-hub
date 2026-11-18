// The price tag of a locked pick (Nov 18, 2026, audit finding #13): v4's chance against the DraftKings price, not v6's chance against its
// own price with the margin removed (which read "fair" every time). No tag on a stand-in price. The Results tab's profit split and its label.
import { readFileSync } from 'node:fs';
import worker from '../src/worker.js';
import { priceVerdict, v4Chance, verdictOf, needP } from '../src/pick.js';
import { devig } from '../src/v6core.js';

let fails = 0;
const ok = (name, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${cond ? '' : extra}`); };

const v4 = { p: [60, 22, 18], over: 41, btts: 47 };
const odds = { h: 100, d: 250, a: 300, tl: 2.5, to: -120, tu: 100, by: -110, bn: -110, bk: 'draftkings' };
const card = (o = {}) => ({ v4, odds: { ...odds }, ...o });

// v4's number for each market
ok('v4Chance: home / draw / away, Under from Over, Not both score from both score', v4Chance(v4, 'H') === 60 && v4Chance(v4, 'D') === 22 && v4Chance(v4, 'A') === 18 && v4Chance(v4, 'O') === 41 && v4Chance(v4, 'U') === 59 && v4Chance(v4, 'B') === 47 && v4Chance(v4, 'N') === 53);
ok('v4Chance: no v4, or no goals numbers, is null', v4Chance(null, 'H') === null && v4Chance({ p: [50, 25, 25] }, 'O') === null && v4Chance({ p: [50, 25, 25] }, 'N') === null);

// The tag compares v4 with the DraftKings break-even
ok('tag: v4 60% on a +100 home price (needs 50%) is Value', priceVerdict(card(), { key: 'H', price: 100 }) === 'val');
ok('tag: v4 22% on a +250 draw (needs 28.6%) is Not worth it', priceVerdict(card(), { key: 'D', price: 250 }) === 'no');
ok('tag: v4 59% Under at +100 (needs 50%) is Value; 41% Over at -120 (needs 54.5%) is Not worth it', priceVerdict(card(), { key: 'U', price: 100 }) === 'val' && priceVerdict(card(), { key: 'O', price: -120 }) === 'no');
ok('tag: v4 53% Not both score at -110 (needs 52.4%) is Fair', priceVerdict(card(), { key: 'N', price: -110 }) === 'fair');
ok('tag: it is verdictOf on v4\'s chance and the saved price', priceVerdict(card(), { key: 'A', price: 300 }) === verdictOf(18, 300));

// The old tag: v6's chance is read off the same price with the margin removed, so it sits a margin's share under break-even every time.
{ const fair = devig(odds.h, odds.d, odds.a).map(x => x * 100), L = { key: 'H', price: 100, p: Math.round(fair[0]) };
  ok('old tag: v6\'s own de-margined chance against its own price only ever says Fair (the bug)', verdictOf(L.p, 100) === 'fair' && L.p < needP(100), `${L.p}`);
  ok('new tag: the same pick tagged by v4 (60% against 50%) is Value', priceVerdict(card(), L) === 'val'); }

// No tag when the price is not DraftKings'
ok('stand-in: a Bet365 or Pinnacle home / draw / away price gets no tag', priceVerdict(card({ odds: { ...odds, src: 'bet365' } }), { key: 'H', price: 100 }) === null && priceVerdict(card({ odds: { ...odds, src: 'pinnacle' } }), { key: 'U', price: 100 }) === null);
ok('stand-in: a pick the lock marked with another book (lean.pbk) gets no tag', priceVerdict(card(), { key: 'H', price: 100, pbk: 'bet365' }) === null);
ok('both score: Pinnacle\'s both-score price gets no tag; DraftKings\' does, even on a card whose result price is a stand-in', priceVerdict(card({ odds: { ...odds, bk: 'pinnacle' } }), { key: 'N', price: -110 }) === null && priceVerdict(card({ odds: { ...odds, src: 'bet365' } }), { key: 'N', price: -110 }) === 'fair');
ok('no tag: no saved price, no v4, a promoted club\'s starting rating, or no v4 number for the market', priceVerdict(card(), { key: 'H' }) === null && priceVerdict(card({ v4: null }), { key: 'H', price: 100 }) === null && priceVerdict(card({ v4: { ...v4, promo: true } }), { key: 'H', price: 100 }) === null && priceVerdict(card({ v4: { p: [60, 22, 18] } }), { key: 'O', price: -120 }) === null);

// The Results tab's profit split (tally) uses the new tag, whatever the lock saved in lean.vd
const kv = new Map();
const env = { ADMIN_TOKEN: 'secret', ASSETS: { fetch: () => new Response('') }, HUB: {
  get: async (k, t) => { const v = kv.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => { kv.set(k, v); },
  list: async ({ prefix }) => ({ keys: [...kv.keys()].filter(k => k.startsWith(prefix)).sort().map(name => ({ name })), list_complete: true }) } };
const g = { outcomeHit: true, ouHit: true, bttsHit: true, brier: 0.4 };
const graded = (id, lean, o = {}) => ({ id, league: 'eng.1', home: `H${id}`, away: `A${id}`, kickoff: '2026-11-14T15:00:00Z', v2: { p: [50, 25, 25], over: 50, btts: 50 }, v4, odds: { ...odds }, final: { h: 1, a: 0 },
  grade: { v2: g, v4: g }, lean: { k: 'lean', y: 2, a: 3, by: ['v4'], no: [], src: 'market', hit: true, ...lean }, ...o });
kv.set('day:2026-11-14', JSON.stringify({ date: '2026-11-14', cards: [
  graded('1', { key: 'H', p: 48, price: 100, vd: 'fair' }),                                     // v4 60 vs 50: Value (the lock said fair)
  graded('2', { key: 'D', p: 27, price: 250, vd: 'fair' }),                                     // v4 22 vs 28.6: Not worth it
  graded('3', { key: 'H', p: 48, price: 100, vd: 'fair', pbk: 'bet365' }, { odds: { ...odds, src: 'bet365' } }), // stand-in: no tag
] }));
const T = await (await worker.fetch(new Request('https://hub.test/api/tally', { headers: { 'x-admin-token': 'secret' } }), env)).json();
const P = T.leans.pl;
ok('tally: every priced pick still counts in the profit', P.n === 3, JSON.stringify(P));
ok('tally: the tag split is v4 against DraftKings (Value 1, Not worth it 1), not the saved "fair"', P.byVerdict.val?.n === 1 && P.byVerdict.no?.n === 1 && !P.byVerdict.fair, JSON.stringify(P.byVerdict));
ok('tally: the stand-in-priced pick has no tag, and the kind x tag split follows', P.byCombo['lean|val']?.n === 1 && P.byCombo['lean|no']?.n === 1 && Object.values(P.byCombo).reduce((a, x) => a + x.n, 0) === 2, JSON.stringify(P.byCombo));

// The page says what the tag is
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
ok('page: the profit split is labelled "Price tags: v4 against DraftKings" and says stand-ins get no tag', /Price tags: v4 against DraftKings \(Value \/ Fair \/ Not worth it\)/.test(html) && /Stand-in prices \(Bet365, Pinnacle\)[^<]*get no tag/.test(html) && !/Retired price tags/.test(html));

console.log(fails ? `\n${fails} price tag check(s) FAILED` : '\nAll price tag checks passed'); process.exit(fails ? 1 : 0);
