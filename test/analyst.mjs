// The Analyst (src/analyst.js): its rules, one position per game and market, settling at the close and the result, the record,
// benching, and storage through the price read in src/worker.js.
import { view, RULES, decide, settle, summary, isBenched, BENCH, analystLook, listAnalyst, getAnalyst, decideNhl, analystNhl, NHL_RULES } from '../src/analyst.js';
import { refreshOdds, analystShop, analystSharp, readSharpNote } from '../src/worker.js';
import { bestPrices, fetchBest, sharpOf, fetchSharp } from '../src/btts.js';
let bad = 0; const ok = (n, c, x = '') => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (c ? '' : ' ' + x)); if (!c) bad++; };
const rule = id => RULES.find(r => r.id === id);
const KO = '2026-10-28T19:00:00Z', NOW = new Date('2026-10-28T12:00:00Z');
const card = (o = {}) => ({ id: 'g1', league: 'eng.1', leagueName: 'Premier League', home: 'Arsenal', away: 'Brighton', kickoff: KO,
  v4: { p: [52, 25, 23], over: 58, btts: 50 }, odds: { op: { h: 150, d: 230, a: 190 }, h: 110, d: 240, a: 240, tl: 2.5, to: -120, tu: 100, opt: { tl: 2.5, to: 100, tu: -120 }, by: -160, bn: 130 }, ...o });

// --- rules ---
const V = view({ v4: card().v4, open: card().odds.op, now: card().odds, openT: card().odds.opt });
ok('view: home chance rose since the opening price', V.d[0] > 3 && V.d[2] < 0, JSON.stringify(V.d));
ok('follow: backs the side the money moved to when v4 rated it above the opening price', (rule('follow').pick(V) || {}).key === 'H');
ok('follow: silent when v4 rated it below the opening price', rule('follow').pick(view({ v4: { p: [30, 30, 40], over: 50 }, open: card().odds.op, now: card().odds })) === null);
ok('totals: Over moved 3+ and v4 is on the Over side of the price now', (rule('totals').pick(V) || {}).key === 'O');
ok('totals: retired, so decide never places it', !!rule('totals').retired && !decide([], [card()], '2026-10-28', NOW).some(b => b.rule === 'totals'));
// under: Over priced 55%+ and both v2 and v4 below it
const Vu = view({ v4: { p: [40, 30, 30], over: 50 }, v2: { over: 52 }, open: { h: 150, d: 230, a: 190 }, now: { h: 150, d: 230, a: 190, tl: 2.5, to: -150, tu: 120 } });
ok('under: Over priced 55%+ (56.9%), v4 50% and v2 52% below it: bet Under at +120', (b => b && b.key === 'U' && b.price === 120)(rule('under').pick(Vu)), JSON.stringify(Vu.ou));
ok('under: no bet when v2 is above the price', rule('under').pick(view({ v4: { p: [40, 30, 30], over: 50 }, v2: { over: 60 }, open: { h: 150, d: 230, a: 190 }, now: { h: 150, d: 230, a: 190, tl: 2.5, to: -150, tu: 120 } })) === null);
ok('under: no bet when Over is priced under 55%', rule('under').pick(view({ v4: { p: [40, 30, 30], over: 40 }, v2: { over: 40 }, open: { h: 150, d: 230, a: 190 }, now: { h: 150, d: 230, a: 190, tl: 2.5, to: -120, tu: 100 } })) === null);
// bttsNo: Yes priced 58%+ and v4 below it, DraftKings price only
const bv = (o, v4b = 50) => view({ v4: { p: [40, 30, 30], over: 50, btts: v4b }, open: { h: 150, d: 230, a: 190 }, now: { h: 150, d: 230, a: 190, ...o } });
ok('bttsNo: Yes priced 58.6%, v4 50%: bet No at +130', (b => b && b.key === 'N' && b.price === 130)(rule('bttsNo').pick(bv({ by: -160, bn: 130 }))));
ok('bttsNo: no bet when v4 rates Yes above the price', rule('bttsNo').pick(bv({ by: -160, bn: 130 }, 65)) === null);
ok('bttsNo: no bet when Yes is priced under 58%', rule('bttsNo').pick(bv({ by: -125, bn: 100 })) === null);
ok('bttsNo: no bet on a Pinnacle stand-in price', rule('bttsNo').pick(bv({ by: -160, bn: 130, bk: 'pinnacle' })) === null);
ok('settle: both score No settles on the score and closes at the both-score price', (() => { const x = { key: 'N', price: 130, kickoff: KO, mins: 60 }; settle(x, card({ odds: { ...card().odds, bn: 120 }, final: { h: 2, a: 0 } }), new Date('2026-10-29T01:00:00Z')); return x.res === 'win' && x.units === 1.3 && x.close === 120; })());
ok('totals: no bet when v4 is on the other side', rule('totals').pick(view({ v4: { p: [52, 25, 23], over: 40 }, open: card().odds.op, now: card().odds, openT: card().odds.opt })) === null);
const Vv = view({ v4: { p: [30, 25, 45], over: 50 }, open: { h: 120, d: 240, a: 220 }, now: { h: 120, d: 240, a: 220 } });
ok('value: v4 5+ above the price on an away win with no move', (rule('value').pick(Vv) || {}).key === 'A');
ok('value: never a draw', rule('value').pick(view({ v4: { p: [30, 45, 25], over: 50 }, open: { h: 120, d: 240, a: 220 }, now: { h: 120, d: 240, a: 220 } })) === null);
const Vf = view({ v4: { p: [30, 25, 45], over: 50 }, open: { h: 150, d: 230, a: 190 }, now: { h: 110, d: 240, a: 240 } });
ok('fade: away drifted 4+ but v4 still rates it above the price now', (rule('fade').pick(Vf) || {}).key === 'A', JSON.stringify(Vf.d));

// --- decide: one position per game and market ---
const first = decide([], [card()], '2026-10-28', NOW);
ok('decide: one 1X2 and one both-score bet on the game', first.length === 2 && first.map(b => b.key).sort().join() === 'H,N', JSON.stringify(first.map(b => [b.rule, b.key])));
ok('decide: bet keeps the price, market chance, v4 chance, minutes to kickoff and a reason', first[0].price === 110 && first[0].mins === 420 && first[0].v4 === 52 && /v4/.test(first[0].why));
ok('decide: a later read never adds to or reverses a held position', decide(first, [card({ odds: { ...card().odds, h: 300, a: -150 } })], '2026-10-28', NOW).length === 0);
ok('decide: a benched rule places nothing', !decide([], [card()], '2026-10-28', NOW, new Set(['follow'])).some(b => b.rule === 'follow'));
ok('decide: no bet on a promoted-club stand-in or a card without a price', decide([], [card({ v4: { ...card().v4, promo: true } }), card({ id: 'g2', odds: null })], '2026-10-28', NOW).length === 0);

// --- settle ---
const b = { ...first[0] };
ok('settle: nothing before kickoff', settle(b, card(), NOW) === false && b.close == null);
settle(b, card({ odds: { ...card().odds, h: -105 } }), new Date('2026-10-28T19:05:00Z'));
ok('settle: closing price and closing-line value at kickoff', b.close === -105 && b.clv > 0 && !b.res, JSON.stringify(b));
settle(b, card({ odds: { ...card().odds, h: -105 }, final: { h: 2, a: 0 } }), new Date('2026-10-29T01:00:00Z'));
ok('settle: a win pays the price taken', b.res === 'win' && b.units === 1.1 && b.score === '2-0');
const v = { ...first[1] }; settle(v, null, new Date('2026-11-02T20:00:00Z'));
ok('settle: no result 4 days after kickoff is a void', v.res === 'void' && v.units === 0);

// --- summary and benching ---
const loser = i => ({ id: 'x' + i, rule: 'value', key: 'A', price: 200, kickoff: `2026-10-${String(1 + (i % 25)).padStart(2, '0')}T15:00:00Z`, mins: 300, res: 'loss', units: -1, clv: -2 });
const s = summary(Array.from({ length: BENCH.n }, (_, i) => loser(i)).concat([b]), [['2026-09-01T15:00:00Z', 'follow', 'H', 60, 'win', 0.5, 1.5]]);
const sv = s.rules.find(r => r.id === 'value'), sf = s.rules.find(r => r.id === 'follow');
ok('summary: per-rule units, ROI and closing-line value', sv.settled === BENCH.n && sv.units === -BENCH.n && sv.roi === -100 && sv.clv === -2);
ok('summary: a rule losing on price and profit after enough bets is benched', sv.benched && !sf.benched && isBenched(sv));
ok('summary: compact old rows still count', sf.settled === 2 && sf.wins === 2);
ok('summary: early and late bets kept apart', s.when.find(w => w.id === 'late').settled === 1 && s.when.find(w => w.id === 'early').settled === BENCH.n + 1);
ok('summary: running units curve in kickoff order', s.curve.length === BENCH.n + 2 && s.curve[0][0] === '2026-09-01');
ok('summary: the verdict waits for profit when there are few bets', /200\+/.test(s.verdict), s.verdict);

// --- storage through the worker's price read ---
const kv = new Map(), env = { HUB: { get: async (k, t) => { const x = kv.get(k); return x == null ? null : t === 'json' ? JSON.parse(x) : x; }, put: async (k, x) => { kv.set(k, x); }, list: async () => ({ keys: [] }) } };
kv.set('day:2026-10-28', JSON.stringify({ date: '2026-10-28', cards: [card({ v2: { p: [50, 25, 25] } })] }));
const r = await analystLook(env, '2026-10-28', JSON.parse(kv.get('day:2026-10-28')).cards, NOW);
ok('analystLook: places and saves the bets', r.placed === 2 && (await getAnalyst(env)).items.length === 2);
const r2 = await analystLook(env, '2026-10-28', JSON.parse(kv.get('day:2026-10-28')).cards, NOW);
ok('analystLook: the same read again places nothing', r2.placed === 0 && (await getAnalyst(env)).items.length === 2);
ok('analystLook: no bet once the price has locked', (await analystLook({ HUB: { get: async () => null, put: async () => { throw new Error('no write expected'); } } }, '2026-10-28', [card()], new Date('2026-10-28T18:45:00Z'))).placed === 0);
const d = JSON.parse(kv.get('day:2026-10-28')); d.cards[0].final = { h: 0, a: 1 }; kv.set('day:2026-10-28', JSON.stringify(d));
const L = await listAnalyst(env, new Date('2026-10-29T01:00:00Z'));
ok('listAnalyst: settles finished games when the tab opens', L.items.every(x => x.res) && L.summary.all.settled === 2 && L.summary.all.units === 0.3, JSON.stringify(L.summary.all));
ok('listAnalyst: the record split by market adds up, each with only its own rules', L.mk['1x2'].all.n + L.mk.ou.all.n + L.mk.btts.all.n === L.summary.all.n && L.mk.btts.all.n === 1 && L.mk.btts.rules.map(r => r.id).join() === 'bttsNo' && L.mk['1x2'].rules.every(r => r.id !== 'under') && L.mk.ou.rules.some(r => r.id === 'stale') && !('btts' in L.nhl.mk), JSON.stringify(Object.fromEntries(Object.entries(L.mk).map(([k, v]) => [k, v.all.n]))));
// refreshOdds hands the Analyst the fresh prices: fake ESPN with one priced game
globalThis.fetch = async () => new Response(JSON.stringify({ events: [] }));
kv.set('day:2026-10-30', JSON.stringify({ date: '2026-10-30', cards: [card({ v2: { p: [50, 25, 25] }, kickoff: '2026-10-30T19:00:00Z' })] }));
const ro = await refreshOdds(env, '2026-10-30', 'eng.1', new Date('2026-10-30T12:00:00Z'));
ok('refreshOdds: the Analyst looks at the league after its price read', ro.games === 1 && ro.analyst && ro.analyst.placed === 2 && (await getAnalyst(env)).items.filter(x => x.date === '2026-10-30').length === 2, JSON.stringify(ro));

// --- price shopping ---
const ev = { id: 'e1', home_team: 'Arsenal', away_team: 'Brighton and Hove Albion', commence_time: KO, bookmakers: [
  { key: 'draftkings', markets: [{ key: 'h2h', outcomes: [{ name: 'Arsenal', price: 110 }, { name: 'Draw', price: 240 }, { name: 'Brighton and Hove Albion', price: 240 }] }, { key: 'totals', outcomes: [{ name: 'Over', price: -120, point: 2.5 }, { name: 'Under', price: 100, point: 2.5 }] }] },
  { key: 'fanduel', markets: [{ key: 'h2h', outcomes: [{ name: 'Arsenal', price: 120 }, { name: 'Draw', price: 230 }, { name: 'Brighton and Hove Albion', price: 250 }] }, { key: 'totals', outcomes: [{ name: 'Over', price: -110, point: 2.5 }, { name: 'Over', price: 150, point: 3.5 }] }] },
  { key: 'bovada', markets: [{ key: 'h2h', outcomes: [{ name: 'Arsenal', price: 200 }] }] }] };
const bp = bestPrices(ev);
ok('bestPrices: best home, away and Over among the US books', bp.H.m === 120 && bp.H.bk === 'fanduel' && bp.A.m === 250 && bp.O.m === -110 && bp.D.m === 240 && bp.D.bk === 'draftkings', JSON.stringify(bp));
ok('bestPrices: offshore books and other goal lines are ignored', bp.H.bk !== 'bovada' && bp.O.m !== 150);
ok('bestPrices: a BOOKS list limits the books', bestPrices(ev, ['draftkings']).H.m === 110);
let calls = 0; const fakeApi = async u => { calls++; return { ok: true, headers: { get: () => '400' }, json: async () => [ev] }; };
const fb = await fetchBest('k', 'eng.1', [card()], fakeApi);
ok('fetchBest: one call for the league, matched to the card', calls === 1 && fb.prices.get('g1').H.m === 120 && fb.left === 400);
const kv2 = new Map(), env2 = { HUB: { get: async (k, t) => { const x = kv2.get(k); return x == null ? null : t === 'json' ? JSON.parse(x) : x; }, put: async (k, x) => { kv2.set(k, x); } } };
calls = 0;
await analystLook(env2, '2026-10-28', [card()], NOW, analystShop({ ODDS_API_KEY: 'k' }, 'eng.1', fakeApi));
const sh = (await getAnalyst(env2)).items, hb = sh.find(x => x.key === 'H'), ob = sh.find(x => x.key === 'N');
ok('shopping: the bet takes the better price and keeps DraftKings (both score is not shopped)', hb.price === 120 && hb.bk === 'fanduel' && hb.dk === 110 && ob.price === 130 && ob.dk === 130 && ob.bk === 'draftkings', JSON.stringify(sh.map(x => [x.key, x.price, x.bk, x.dk])));
ok('shopping: asked once, only because a rule fired', calls === 1);
await analystLook(env2, '2026-10-28', [card()], NOW, analystShop({ ODDS_API_KEY: 'k' }, 'eng.1', fakeApi));
ok('shopping: no call when nothing new fires', calls === 1);
ok('shopping: no key, no call', analystShop({}, 'eng.1', fakeApi) === null);
ok('shopping: BOOKS = draftkings turns it off', analystShop({ ODDS_API_KEY: 'k', BOOKS: 'draftkings' }, 'eng.1', fakeApi) === null);
settle(hb, card({ odds: { ...card().odds, h: -105 }, final: { h: 1, a: 0 } }), new Date('2026-10-29T01:00:00Z'));
ok('shopping: units at the best price and at DraftKings, CLV with and without the gain', hb.units === 1.2 && hb.udk === 1.1 && hb.clv > hb.clvDk && hb.clvDk > 0, JSON.stringify(hb));
const ss = summary([hb]).all.shop;
ok('shopping: the record shows the gain and the DraftKings-only units', ss.n === 1 && ss.better === 1 && ss.gain > 0 && ss.unitsDk === 1.1 && ss.clvDk === hb.clvDk, JSON.stringify(ss));

// --- stale price: DraftKings against a sharp book ---
const sev = (dkH, pin) => ({ id: 'e2', home_team: 'Arsenal', away_team: 'Brighton and Hove Albion', commence_time: KO, bookmakers: [
  { key: 'draftkings', markets: [{ key: 'h2h', outcomes: [{ name: 'Arsenal', price: dkH }, { name: 'Draw', price: 240 }, { name: 'Brighton and Hove Albion', price: 240 }] }, { key: 'totals', outcomes: [{ name: 'Over', price: -120, point: 2.5 }, { name: 'Under', price: 100, point: 2.5 }] }] },
  ...(pin ? [{ key: pin, markets: [{ key: 'h2h', outcomes: [{ name: 'Arsenal', price: -110 }, { name: 'Draw', price: 270 }, { name: 'Brighton and Hove Albion', price: 300 }] }, { key: 'totals', outcomes: [{ name: 'Over', price: -115, point: 2.5 }, { name: 'Under', price: 105, point: 2.5 }] }] }] : [])] });
const sp = sharpOf(sev(120, 'pinnacle'));
ok('sharpOf: Pinnacle fair chances with the margin removed, next to DraftKings', sp.book === 'pinnacle' && Math.abs(sp.fair.H + sp.fair.D + sp.fair.A - 1) < 1e-9 && sp.fair.H > 0.5 && sp.dk.H === 120 && sp.fair.O > 0.5);
ok('sharpOf: an exchange stands in when Pinnacle is missing', sharpOf(sev(120, 'betfair_ex_eu')).book === 'betfair_ex_eu');
ok('sharpOf: no sharp book, nothing', sharpOf(sev(120, null)) === null);
const stale = rule('stale'), hit = stale.pick(null, sp);
ok('stale: DraftKings +120 against a fair ~51% home win is a bet', hit && hit.key === 'H' && hit.price === 120 && hit.sharp.ev >= 2 && /Pinnacle/.test(hit.why), JSON.stringify(hit));
ok('stale: no bet when DraftKings is in line with the sharp price', stale.pick(null, sharpOf(sev(-115, 'pinnacle'))) === null);
ok('stale: nothing longer than +400', stale.pick(null, { book: 'pinnacle', fair: { H: 0.3, D: 0.3, A: 0.4 }, dk: { A: 600 } }) === null);
const smap = new Map([['g1', sp]]);
const sd = decide([], [card({ v4: null })], '2026-10-28', NOW, new Set(), smap);
ok('decide: the stale rule bets a card with no v4, and goes first', sd.length === 1 && sd[0].rule === 'stale' && sd[0].sharp.book === 'pinnacle' && sd[0].v4 === null && sd[0].mp > 50, JSON.stringify(sd));
const sd2 = decide([], [card()], '2026-10-28', NOW, new Set(), smap);
ok('decide: with v4 too, stale takes the 1X2 position and both-score No its own market', sd2.find(b => b.key === 'H').rule === 'stale' && sd2.find(b => b.key === 'N').rule === 'bttsNo');
const fakeSharp = async () => ({ ok: true, headers: { get: () => '300' }, json: async () => [sev(120, 'pinnacle')] });
const fs1 = await fetchSharp('k', 'eng.1', [card()], fakeSharp);
ok('fetchSharp: one call, matched, books seen', fs1.prices.get('g1').book === 'pinnacle' && fs1.books.includes('pinnacle') && fs1.left === 300);
// throttling, with a stand-in for the edge cache
const store = new Map(); globalThis.caches = { default: { match: async k => { const v = store.get(String(k.url || k)); return v ? new Response(v) : undefined; }, put: async (k, r) => { store.set(String(k.url || k), await r.text()); }, delete: async k => store.delete(String(k.url || k)) } };
let sc = 0; const countSharp = async u => { sc++; return fakeSharp(u); };
const shf = analystSharp({ ODDS_API_KEY: 'k' }, 'eng.1', countSharp, NOW);
ok('analystSharp: looks once', (await shf([card()])).get('g1').book === 'pinnacle' && sc === 1);
ok('analystSharp: not again for the same league within the gap', (await shf([card()])) === null && sc === 1);
ok('analystSharp: notes the last look for the tab', (await readSharpNote()).sharp.includes('pinnacle') && (await readSharpNote()).matched === 1);
const cap = analystSharp({ ODDS_API_KEY: 'k', SHARP_PER_DAY: '1' }, 'ger.1', countSharp, NOW);
ok('analystSharp: stops at the daily limit', (await cap([card()])) === null && sc === 1);
ok('analystSharp: no key, no look', analystSharp({}, 'eng.1', countSharp) === null);
const kv3 = new Map(), env3 = { HUB: { get: async (k, t) => { const x = kv3.get(k); return x == null ? null : t === 'json' ? JSON.parse(x) : x; }, put: async (k, x) => { kv3.set(k, x); } } };
await analystLook(env3, '2026-10-28', [card({ v4: null })], NOW, null, async () => smap);
const st = (await getAnalyst(env3)).items;
ok('analystLook: places the stale bet from the sharp look', st.length === 1 && st[0].rule === 'stale' && st[0].price === 120 && st[0].dk === 120);
delete globalThis.caches;

// --- hockey ---
const hc = (o = {}) => ({ id: 'n1', home: 'Edmonton Oilers', away: 'Detroit Red Wings', hAbbr: 'EDM', aAbbr: 'DET', kickoff: KO, final: null, ln: { v: 6.5 },
  v2: { w: 66, o: 56 }, px: { op: { h: -185, a: 154 }, opt: { tl: 6.5, to: -112, tu: -108 }, h: -230, a: 190, tl: 6.5, to: -125, tu: 105 }, ...o });
const nb = decideNhl([], [hc()], '2026-10-28', NOW);
ok('hockey: follow the move on EDM (63% -> 68%, v2 66%) and the Over (51% -> 54%, v2 56%)', nb.length === 2 && nb.find(b => b.key === 'H').rule === 'hfollow' && nb.find(b => b.key === 'O').rule === 'htotals' && nb.find(b => b.key === 'O').line === 6.5 && nb[0].sport === 'nhl', JSON.stringify(nb.map(b => [b.rule, b.key, b.price])));
ok('hockey: no follow when v2 rated the mover below its opening chance', !decideNhl([], [hc({ v2: { w: 60, o: 50 } })], '2026-10-28', NOW).some(b => b.rule === 'hfollow'));
ok('hockey: fade a drifted side v2 still rates at or above the price', (() => { const x = decideNhl([], [hc({ v2: { w: 40, o: 50 } })], '2026-10-28', NOW); return x.length && x[0].rule === 'hfade' && x[0].key === 'A'; })());
ok('hockey: no total bet when the book line is not the line v2 was rated at', !decideNhl([], [hc({ ln: { v: 5.5 } })], '2026-10-28', NOW).some(b => b.key === 'O' || b.key === 'U'));
ok('hockey: no bet on a card with no rating', decideNhl([], [hc({ skipped: 'x' })], '2026-10-28', NOW).length === 0);
const hw = { ...nb.find(b => b.key === 'H') }, ho = { ...nb.find(b => b.key === 'O') };
const fin = hc({ px: { ...hc().px, h: -250 }, final: { h: 3, a: 3 + 0, total: 6, last: 'SO' } });
fin.final = { h: 4, a: 3, total: 6, last: 'SO' };
settle(hw, fin, new Date('2026-10-29T04:00:00Z')); settle(ho, fin, new Date('2026-10-29T04:00:00Z'));
ok('hockey: a shootout win counts for the winner, close and CLV from the locked price', hw.res === 'win' && hw.close === -250 && hw.clv > 0 && /SO/.test(hw.score), JSON.stringify(hw));
ok('hockey: the shootout goal does not count toward the total (6 < 6.5: Over loses)', ho.res === 'loss' && ho.units === -1);
const push = { ...nb.find(b => b.key === 'O'), line: 6 }; settle(push, hc({ final: { h: 3, a: 3, total: 6, last: 'OT' } }), new Date('2026-10-29T04:00:00Z'));
ok('hockey: a total exactly on a whole-number line is a push', push.res === 'void' && push.units === 0);
const kv4 = new Map(), env4 = { HUB: { get: async (k, t) => { const x = kv4.get(k); return x == null ? null : t === 'json' ? JSON.parse(x) : x; }, put: async (k, x) => { kv4.set(k, x); } } };
await analystNhl(env4, '2026-10-28', [hc()], NOW);
kv4.set('nhl:day:2026-10-28', JSON.stringify({ date: '2026-10-28', cards: [{ ...hc(), final: { h: 2, a: 1, total: 3, last: 'REG' } }] }));
const LN = await listAnalyst(env4, new Date('2026-10-29T04:00:00Z'));
ok('hockey: kept apart from soccer, settled from the hockey day when the tab opens', LN.items.length === 0 && LN.nhl.items.length === 2 && LN.nhl.summary.all.settled === 2 && LN.nhl.summary.rules.length === NHL_RULES.length, JSON.stringify(LN.nhl.summary.all));
console.log(bad ? `\n${bad} FAILED` : '\nAll Analyst checks passed');
process.exit(bad ? 1 : 0);
