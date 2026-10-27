// The Analyst (src/analyst.js): its rules, one position per game and market, settling at the close and the result, the record,
// benching, and storage through the price read in src/worker.js.
import { view, RULES, decide, settle, summary, isBenched, BENCH, analystLook, listAnalyst, getAnalyst } from '../src/analyst.js';
import { refreshOdds } from '../src/worker.js';
let bad = 0; const ok = (n, c, x = '') => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (c ? '' : ' ' + x)); if (!c) bad++; };
const rule = id => RULES.find(r => r.id === id);
const KO = '2026-10-28T19:00:00Z', NOW = new Date('2026-10-28T12:00:00Z');
const card = (o = {}) => ({ id: 'g1', league: 'eng.1', leagueName: 'Premier League', home: 'Arsenal', away: 'Brighton', kickoff: KO,
  v4: { p: [52, 25, 23], over: 58 }, odds: { op: { h: 150, d: 230, a: 190 }, h: 110, d: 240, a: 240, tl: 2.5, to: -120, tu: 100, opt: { tl: 2.5, to: 100, tu: -120 } }, ...o });

// --- rules ---
const V = view({ v4: card().v4, open: card().odds.op, now: card().odds, openT: card().odds.opt });
ok('view: home chance rose since the opening price', V.d[0] > 3 && V.d[2] < 0, JSON.stringify(V.d));
ok('follow: backs the side the money moved to when v4 rated it above the opening price', (rule('follow').pick(V) || {}).key === 'H');
ok('follow: silent when v4 rated it below the opening price', rule('follow').pick(view({ v4: { p: [30, 30, 40], over: 50 }, open: card().odds.op, now: card().odds })) === null);
ok('totals: Over moved 3+ and v4 is on the Over side of the price now', (rule('totals').pick(V) || {}).key === 'O');
ok('totals: no bet when v4 is on the other side', rule('totals').pick(view({ v4: { p: [52, 25, 23], over: 40 }, open: card().odds.op, now: card().odds, openT: card().odds.opt })) === null);
const Vv = view({ v4: { p: [30, 25, 45], over: 50 }, open: { h: 120, d: 240, a: 220 }, now: { h: 120, d: 240, a: 220 } });
ok('value: v4 5+ above the price on an away win with no move', (rule('value').pick(Vv) || {}).key === 'A');
ok('value: never a draw', rule('value').pick(view({ v4: { p: [30, 45, 25], over: 50 }, open: { h: 120, d: 240, a: 220 }, now: { h: 120, d: 240, a: 220 } })) === null);
const Vf = view({ v4: { p: [30, 25, 45], over: 50 }, open: { h: 150, d: 230, a: 190 }, now: { h: 110, d: 240, a: 240 } });
ok('fade: away drifted 4+ but v4 still rates it above the price now', (rule('fade').pick(Vf) || {}).key === 'A', JSON.stringify(Vf.d));

// --- decide: one position per game and market ---
const first = decide([], [card()], '2026-10-28', NOW);
ok('decide: one 1X2 and one Over/Under bet on the game', first.length === 2 && first.map(b => b.key).sort().join() === 'H,O', JSON.stringify(first.map(b => [b.rule, b.key])));
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
ok('listAnalyst: settles finished games when the tab opens', L.items.every(x => x.res) && L.summary.all.settled === 2 && L.summary.all.units < 0, JSON.stringify(L.summary.all));
// refreshOdds hands the Analyst the fresh prices: fake ESPN with one priced game
globalThis.fetch = async () => new Response(JSON.stringify({ events: [] }));
kv.set('day:2026-10-30', JSON.stringify({ date: '2026-10-30', cards: [card({ v2: { p: [50, 25, 25] }, kickoff: '2026-10-30T19:00:00Z' })] }));
const ro = await refreshOdds(env, '2026-10-30', 'eng.1', new Date('2026-10-30T12:00:00Z'));
ok('refreshOdds: the Analyst looks at the league after its price read', ro.games === 1 && ro.analyst && ro.analyst.placed === 2 && (await getAnalyst(env)).items.filter(x => x.date === '2026-10-30').length === 2, JSON.stringify(ro));
console.log(bad ? `\n${bad} FAILED` : '\nAll Analyst checks passed');
process.exit(bad ? 1 : 0);
