// The Analyst (src/analyst.js): its rules, one position per game and market, settling at the close and the result, the record,
// benching, and storage through the price read in src/worker.js.
import { view, RULES, decide, goalsSwap, setOf, SETS, settle, summary, isBenched, BENCH, analystLook, listAnalyst, getAnalyst, decideNhl, analystNhl, NHL_RULES } from '../src/analyst.js';
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
ok('totals: back in Analyst 1 (Nov 1), so decide places it again', !rule('totals').retired && rule('totals').set === 1 && decide([], [card()], '2026-10-28', NOW).some(b => b.rule === 'totals'));
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
// under waits for the lineup read: Over priced 56.9%, v2 and v4 below it
{
  const cu = card({ id: 'u1', v2: { over: 50 }, v4: { p: [10, 10, 80], over: 50, btts: 70 }, odds: { op: { h: 900, d: 500, a: -400 }, h: 900, d: 500, a: -400, tl: 2.5, to: -150, tu: 120 } });
  const at = m => new Date(new Date(KO).getTime() - m * 60000);
  ok('under: no bet 4 hours before kickoff (not the lineup read yet)', !decide([], [cu], '2026-10-28', at(240)).some(b => b.rule === 'under'));
  ok('under: bets at the lineup read, 30 minutes before', (b => b && b.key === 'U' && b.price === 120 && b.mins === 30)(decide([], [cu], '2026-10-28', at(30)).find(b => b.rule === 'under')));
}
// the hand-removed early Under on Colorado v Chicago Fire: deleted once on read; a lineup-read bet on the same game is kept
{
  const m = new Map(), e = { HUB: { get: async (k, t) => { const x = m.get(k); return x == null ? null : t === 'json' ? JSON.parse(x) : x; }, put: async (k, x) => { m.set(k, x); } } };
  const bet = o => ({ id: o.id, rule: 'under', key: 'U', date: '2026-10-31', home: 'Colorado Rapids', away: 'Chicago Fire FC', price: 135, mins: 240, kickoff: '2026-11-01T01:30:00Z', ...o });
  m.set('analyst', JSON.stringify({ v: 1, items: [bet({ id: 'early' }), bet({ id: 'late', mins: 30 }), bet({ id: 'other', home: 'Austin FC' })] }));
  const got = await getAnalyst(e);
  ok('drop: the early Colorado v Chicago Fire Under is removed and saved; others stay', got.items.map(b => b.id).join() === 'late,other' && JSON.parse(m.get('analyst')).items.length === 2);
}
{
  const m = new Map(), e = { HUB: { get: async (k, t) => { const x = m.get(k); return x == null ? null : t === 'json' ? JSON.parse(x) : x; }, put: async (k, x) => { m.set(k, x); } } };
  m.set('analyst', JSON.stringify({ v: 1, items: [
    { id: 'sunPre', rule: 'value', key: 'A', at: '2026-11-01T02:00:00Z', kickoff: '2026-11-01T14:00:00Z' },
    { id: 'sunNew', rule: 'move', key: 'H', at: '2026-11-01T10:00:00Z', kickoff: '2026-11-01T14:00:00Z' },
    { id: 'satDone', rule: 'under', key: 'U', at: '2026-10-31T12:00:00Z', kickoff: '2026-10-31T19:00:00Z', res: 'win' },
    { id: 'nhlPre', sport: 'nhl', rule: 'hprice', key: 'H', at: '2026-11-01T02:00:00Z', kickoff: '2026-11-01T23:00:00Z' } ] }));
  const got = await getAnalyst(e);
  ok('drop: soccer bets placed before the Nov 1 rules on games not yet started are removed; later bets, settled games and hockey stay', got.items.map(b => b.id).join() === 'sunNew,satDone,nhlPre', got.items.map(b => b.id).join());
}
ok('totals: no bet when v4 is on the other side', rule('totals').pick(view({ v4: { p: [52, 25, 23], over: 40 }, open: card().odds.op, now: card().odds, openT: card().odds.opt })) === null);
const Vv = view({ v4: { p: [30, 25, 45], over: 50 }, open: { h: 120, d: 240, a: 220 }, now: { h: 120, d: 240, a: 220 } });
ok('value: v4 5+ above the price on an away win with no move', (rule('value').pick(Vv) || {}).key === 'A');
ok('value: never a draw', rule('value').pick(view({ v4: { p: [30, 45, 25], over: 50 }, open: { h: 120, d: 240, a: 220 }, now: { h: 120, d: 240, a: 220 } })) === null);
const Vf = view({ v4: { p: [30, 25, 45], over: 50 }, open: { h: 150, d: 230, a: 190 }, now: { h: 110, d: 240, a: 240 } });
ok('fade: away drifted 4+ but v4 still rates it above the price now', (rule('fade').pick(Vf) || {}).key === 'A', JSON.stringify(Vf.d));

// --- Nov 1, 2026: value / fade / follow retired, 'move' added, winner long shots swapped to a goals pick ---
ok('two rule sets: the original rules are Analyst 1, the new ones Analyst 2, none retired', ['stale', 'follow', 'value', 'fade', 'totals'].every(id => rule(id).set === 1 && !rule(id).retired) && ['move', 'under', 'bttsNo', 'longshot'].every(id => rule(id).set === 2) && RULES.every(r => SETS[r.set]));
ok('setOf: a bet\'s set comes from its rule (full bets and packed rows); an unknown rule counts as Analyst 1', setOf({ rule: 'fade' }) === 1 && setOf({ rule: 'move' }) === 2 && setOf(['2026-10-01', 'under', 'U']) === 2 && setOf({ rule: 'gone' }) === 1);
ok('decide: Analyst 1 bets follow again', decide([], [card()], '2026-10-28', NOW).some(b => b.rule === 'follow'));
ok('move: backs the side whose chance rose 3+, no v4 check', (rule('move').pick(view({ v4: { p: [30, 30, 40], over: 50 }, open: card().odds.op, now: card().odds })) || {}).key === 'H');
ok('move: never a draw', rule('move').pick(view({ v4: { p: [30, 30, 40], over: 50 }, open: { h: 150, d: 400, a: 150 }, now: { h: 150, d: 250, a: 200 } })) === null);
ok('decide: move bets a home win at +110 (short enough)', (b => b && b.rule === 'move' && b.key === 'H' && b.price === 110)(decide([], [card()], '2026-10-28', NOW).find(b => b.rule === 'move')));
{
  // Levante v Atlético style: the move goes to the away long shot at +410. Over 2.5 priced about 61% and v4 60%: Over replaces it.
  const ls = card({ id: 'ls', home: 'Levante', away: 'Atlético', v4: { p: [25, 25, 50], over: 60, btts: 45 },
    odds: { op: { h: -200, d: 350, a: 700 }, h: -150, d: 300, a: 410, tl: 2.5, to: -165, tu: 135, by: -110, bn: -110 } });
  const got = decide([], [ls], '2026-10-28', NOW), w = got.find(b => 'HDA'.includes(b.key) && setOf(b) === 2), sw = got.find(b => b.rule === 'longshot');
  ok('long shot: Analyst 1 still bets the winner long shot, as before Nov 1', got.some(b => b.rule === 'follow' && b.key === 'A' && b.price === 410), JSON.stringify(got.map(b => [b.rule, b.key, b.price])));
  ok('long shot: Analyst 2 makes no winner bet at +410', !w, JSON.stringify(got.map(b => [b.rule, b.key, b.price])));
  ok('long shot: swapped to Over 2.5 at -165, noting the long shot it replaced', sw && sw.key === 'O' && sw.price === -165 && sw.from.key === 'A' && sw.from.price === 410 && /long shot/.test(sw.why), JSON.stringify(sw));
  ok('long shot: no swap when neither Over nor Both score Yes is priced 50%+ with v4 within 3 points', !decide([], [card({ ...ls, v4: { p: [25, 25, 50], over: 50, btts: 40 } })], '2026-10-28', NOW).some(b => b.rule === 'longshot'));
  ok('long shot: Over/Under already held, so it takes Both score Yes (priced 50%, v4 52%)', (b => b && b.key === 'B')(decide([{ date: '2026-10-28', league: 'eng.1', gid: 'ls', rule: 'under', key: 'U' }], [card({ ...ls, v4: { ...ls.v4, btts: 52 } })], '2026-10-28', NOW).find(b => b.rule === 'longshot')));
  ok('long shot: no swap when both goals markets are held', !decide([{ date: '2026-10-28', league: 'eng.1', gid: 'ls', rule: 'under', key: 'U' }, { date: '2026-10-28', league: 'eng.1', gid: 'ls', rule: 'bttsNo', key: 'N' }], [ls], '2026-10-28', NOW).some(b => b.rule === 'longshot'));
  ok('goalsSwap: never Under or Both score No', goalsSwap({ ou: { p1: 30, e: -5, px: [200, -250] }, bt: { p1: 30, v4: 25, px: [200, -250] } }) === null);
  ok('goalsSwap: Over first, Both score Yes when Over is not priced', goalsSwap({ ou: { p1: 55, e: 0, px: [-125, 105] }, bt: { p1: 60, v4: 60, px: [-150, 125] } }).key === 'O' && goalsSwap({ bt: { p1: 60, v4: 60, px: [-150, 125] } }).key === 'B');
  // a long-shot game: Both score Yes priced 61.5% and v4 50% would fire the Both score No rule, but it sits out; Over 2.5 is taken
  ok('long shot: the Under and Both score No rules sit out the game', (g => g.length === 1 && g[0].rule === 'longshot' && g[0].key === 'O')(decide([], [card({ ...ls, v4: { ...ls.v4, btts: 50 }, odds: { ...ls.odds, by: -175, bn: 140 } })], '2026-10-28', NOW).filter(b => setOf(b) === 2)));
  // later reads of a long-shot game (the sweep's Nov 1 bugs): one swap only, and the game stays a long-shot game
  const ls2 = card({ ...ls, v4: { ...ls.v4, btts: 55 }, odds: { ...ls.odds, by: -115, bn: -105 } }), T1 = new Date('2026-10-28T13:00:00Z');
  const g1 = decide([], [ls2], '2026-10-28', NOW).filter(b => setOf(b) === 2);
  ok('long shot: the first read swaps to Over 2.5', g1.length === 1 && g1[0].rule === 'longshot' && g1[0].key === 'O', JSON.stringify(g1.map(b => [b.rule, b.key])));
  ok('long shot: the next read adds no Both score Yes (one swap per game)', !decide(g1, [ls2], '2026-10-28', T1).some(b => setOf(b) === 2), JSON.stringify(decide(g1, [ls2], '2026-10-28', T1).map(b => [b.rule, b.key])));
  const back = card({ ...ls, v4: { ...ls.v4, btts: 45 }, odds: { ...ls.odds, h: -200, d: 350, a: 700, by: -175, bn: 140 } });
  ok('long shot: the price drifts back, and Both score No still sits the game out', !decide(g1, [back], '2026-10-28', T1).some(b => setOf(b) === 2), JSON.stringify(decide(g1, [back], '2026-10-28', T1).map(b => [b.rule, b.key])));
  const short = card({ ...ls, odds: { ...ls.odds, h: 300, d: 280, a: 140 } });
  ok('long shot: the price shortens to +140, and Analyst 2 still makes no winner bet on the game', !decide(g1, [short], '2026-10-28', T1).some(b => setOf(b) === 2 && 'HDA'.includes(b.key)));
}

// --- decide: one position per game and market ---
const first = decide([], [card()], '2026-10-28', NOW);
ok('decide: each set takes its own positions on the game (Analyst 1: follow H, totals O; Analyst 2: move H, Both score No)', first.length === 4 && first.filter(b => setOf(b) === 1).map(b => b.rule + b.key).join() === 'followH,totalsO' && first.filter(b => setOf(b) === 2).map(b => b.rule + b.key).join() === 'moveH,bttsNoN', JSON.stringify(first.map(b => [b.rule, b.key])));
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
const loser = i => ({ id: 'x' + i, rule: 'under', key: 'A', price: 200, kickoff: `2026-10-${String(1 + (i % 25)).padStart(2, '0')}T15:00:00Z`, mins: 300, res: 'loss', units: -1, clv: -2 });
const s = summary(Array.from({ length: BENCH.n }, (_, i) => loser(i)).concat([b]), [['2026-09-01T15:00:00Z', 'follow', 'H', 60, 'win', 0.5, 1.5]]);
const sv = s.rules.find(r => r.id === 'under'), sf = s.rules.find(r => r.id === 'follow');
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
ok('analystLook: places and saves the bets (both sets, one save)', r.placed === 4 && (await getAnalyst(env)).items.length === 4);
const r2 = await analystLook(env, '2026-10-28', JSON.parse(kv.get('day:2026-10-28')).cards, NOW);
ok('analystLook: the same read again places nothing', r2.placed === 0 && (await getAnalyst(env)).items.length === 4);
ok('analystLook: no bet once the price has locked', (await analystLook({ HUB: { get: async () => null, put: async () => { throw new Error('no write expected'); } } }, '2026-10-28', [card()], new Date('2026-10-28T18:45:00Z'))).placed === 0);
const d = JSON.parse(kv.get('day:2026-10-28')); d.cards[0].final = { h: 0, a: 1 }; kv.set('day:2026-10-28', JSON.stringify(d));
const L = await listAnalyst(env, new Date('2026-10-29T01:00:00Z'));
ok('listAnalyst: settles finished games when the tab opens', L.items.every(x => x.res) && L.summary.all.settled === 4 && L.summary.all.units === -1.7, JSON.stringify(L.summary.all));
ok('listAnalyst: one record per set, adding up to the whole (Analyst 2: move lost, Both score No won = +0.3u)', L.sets[1].summary.all.n + L.sets[2].summary.all.n === L.summary.all.n && L.sets[2].summary.all.units === 0.3 && L.sets[1].summary.all.units === -2 && L.sets[1].rules.map(r => r.id).join() === 'stale,follow,value,fade,totals' && L.sets[2].rules.map(r => r.id).join() === 'move,under,bttsNo,longshot' && L.sets[2].mk.btts.all.n === 1 && L.sets[1].items.every(b => setOf(b) === 1), JSON.stringify([L.sets[1].summary.all, L.sets[2].summary.all]));
ok('listAnalyst: the record split by market adds up, each with only its own rules', L.mk['1x2'].all.n + L.mk.ou.all.n + L.mk.btts.all.n === L.summary.all.n && L.mk.btts.all.n === 1 && L.mk.btts.rules.map(r => r.id).join() === 'bttsNo,longshot' && L.mk['1x2'].rules.every(r => r.id !== 'under') && L.mk.ou.rules.some(r => r.id === 'stale') && !('btts' in L.nhl.mk), JSON.stringify(Object.fromEntries(Object.entries(L.mk).map(([k, v]) => [k, v.all.n]))));
// refreshOdds hands the Analyst the fresh prices: fake ESPN with one priced game
globalThis.fetch = async () => new Response(JSON.stringify({ events: [] }));
kv.set('day:2026-10-30', JSON.stringify({ date: '2026-10-30', cards: [card({ v2: { p: [50, 25, 25] }, kickoff: '2026-10-30T19:00:00Z' })] }));
const ro = await refreshOdds(env, '2026-10-30', 'eng.1', new Date('2026-10-30T12:00:00Z'));
ok('refreshOdds: the Analyst looks at the league after its price read', ro.games === 1 && ro.analyst && ro.analyst.placed === 4 && (await getAnalyst(env)).items.filter(x => x.date === '2026-10-30').length === 4, JSON.stringify(ro));

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
const { hockeyMove } = await import('../src/moves.js');
const hr = id => NHL_RULES.find(r => r.id === id);
// the three move rules are retired (Oct 31): their logic is kept for the record, and decideNhl never places them
ok('hockey: follow / fade / goals-move rules are retired', ['hfollow', 'hfade', 'htotals'].every(id => hr(id).retired) && !decideNhl([], [hc()], '2026-10-28', NOW).some(b => ['hfollow', 'hfade', 'htotals'].includes(b.rule)));
ok('hockey (retired logic): follow the move on EDM and the Over', hr('hfollow').pick(hc(), hockeyMove(hc().px)).key === 'H' && hr('htotals').pick(hc(), hockeyMove(hc().px)).key === 'O');
// Price over v2: at the lineup read, v2 3+ points off the moneyline chance -> the side the price rates higher
const at = m => new Date(new Date(KO).getTime() - m * 60000);
const gkc = { h: { n: 'Stuart Skinner', st: 'c' }, a: { n: 'Cam Talbot', st: 'c' } }, gke = { h: { n: 'Stuart Skinner', st: 'e' }, a: { n: 'Cam Talbot', st: 'c' } };
const lr = (o = {}) => hc({ v2: { w: 60, o: 50 }, gk: gkc, px: { ...hc().px, cl: at(40).toISOString() }, ...o }); // EDM priced ~68%, v2 60%
ok('hprice: no bet before the lineup read', !decideNhl([], [lr({ px: { ...hc().px } })], '2026-10-28', at(40)).some(b => b.rule === 'hprice'));
const p1 = decideNhl([], [lr()], '2026-10-28', at(40)).find(b => b.rule === 'hprice');
ok('hprice: lineup read, both goalies confirmed, v2 8 points under the price on EDM: bet EDM at -230', p1 && p1.key === 'H' && p1.price === -230 && /confirmed/.test(p1.why) && /Skinner/.test(p1.why), JSON.stringify(p1));
ok('hprice: a goalie only expected 40 minutes out: wait for the next read', !decideNhl([], [lr({ gk: gke })], '2026-10-28', at(40)).some(b => b.rule === 'hprice'));
const p2 = decideNhl([], [lr({ gk: gke, px: { ...hc().px, cl: at(25).toISOString() } })], '2026-10-28', at(25)).find(b => b.rule === 'hprice');
ok('hprice: the last read before the lock bets with the expected goalie, noted on the bet', p2 && p2.key === 'H' && /expected/.test(p2.why), JSON.stringify(p2));
ok('hprice: v2 within 3 points of the price: no bet', !decideNhl([], [lr({ v2: { w: 66, o: 50 } })], '2026-10-28', at(40)).some(b => b.rule === 'hprice'));
const p3 = decideNhl([], [lr({ v2: { w: 75, o: 50 } })], '2026-10-28', at(40)).find(b => b.rule === 'hprice');
ok('hprice: v2 higher than the price on EDM: bet DET at +190', p3 && p3.key === 'A' && p3.price === 190);
ok('hprice: no opening price needed', !!decideNhl([], [lr({ px: { h: -230, a: 190, cl: at(40).toISOString() } })], '2026-10-28', at(40)).find(b => b.rule === 'hprice'));
// settling hockey bets
const hw = { ...p1 }, ho = { sport: 'nhl', rule: 'htotals', key: 'O', line: 6.5, price: -125, kickoff: KO, mins: 60, close: null, res: null };
const fin = hc({ px: { ...hc().px, h: -250 } }); fin.final = { h: 4, a: 3, total: 6, last: 'SO' };
settle(hw, fin, new Date('2026-10-29T04:00:00Z')); settle(ho, fin, new Date('2026-10-29T04:00:00Z'));
ok('hockey: a shootout win counts for the winner, close and CLV from the locked price', hw.res === 'win' && hw.close === -250 && hw.clv > 0 && /SO/.test(hw.score), JSON.stringify(hw));
ok('hockey: the shootout goal does not count toward the total (6 < 6.5: Over loses)', ho.res === 'loss' && ho.units === -1);
const push = { ...ho, res: null, close: null, line: 6 }; settle(push, hc({ final: { h: 3, a: 3, total: 6, last: 'OT' } }), new Date('2026-10-29T04:00:00Z'));
ok('hockey: a total exactly on a whole-number line is a push', push.res === 'void' && push.units === 0);
const kv4 = new Map(), env4 = { HUB: { get: async (k, t) => { const x = kv4.get(k); return x == null ? null : t === 'json' ? JSON.parse(x) : x; }, put: async (k, x) => { kv4.set(k, x); } } };
await analystNhl(env4, '2026-10-28', [lr()], at(40));
kv4.set('nhl:day:2026-10-28', JSON.stringify({ date: '2026-10-28', cards: [{ ...lr(), final: { h: 2, a: 1, total: 3, last: 'REG' } }] }));
const LN = await listAnalyst(env4, new Date('2026-10-29T04:00:00Z'));
ok('hockey: kept apart from soccer, settled from the hockey day when the tab opens', LN.items.length === 0 && LN.nhl.items.length === 1 && LN.nhl.items[0].rule === 'hprice' && LN.nhl.summary.all.settled === 1 && LN.nhl.summary.rules.length === NHL_RULES.length, JSON.stringify(LN.nhl.summary.all));
console.log(bad ? `\n${bad} FAILED` : '\nAll Analyst checks passed');
process.exit(bad ? 1 : 0);
