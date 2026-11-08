// The Analyst (src/analyst.js): its rules, one position per game and market, settling at the close and the result, the record,
// benching, and storage through the price read in src/worker.js.
import { pinFair, cvOf, view, RULES, decide, goalsSwap, setOf, SETS, tiers, tierOf, settle, summary, isBenched, BENCH, analystLook, listAnalyst, getAnalyst, decideNhl, analystNhl, NHL_RULES } from '../src/analyst.js';
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
  const ub = rule('under').bench; delete rule('under').bench; // the timing logic, with the hand bench lifted for these two checks
  ok('under: no bet 4 hours before kickoff (not the lineup read yet)', !decide([], [cu], '2026-10-28', at(240)).some(b => b.rule === 'under'));
  ok('under: bets at the lineup read, 30 minutes before', (b => b && b.key === 'U' && b.price === 120 && b.mins === 30)(decide([], [cu], '2026-10-28', at(30)).find(b => b.rule === 'under')));
  rule('under').bench = ub;
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

// Nov 3, 2026: the Under rule is benched by hand: it places nothing, its record stays and shows as benched
ok('under: benched by hand, so decide never places it', !!rule('under').bench && !decide([], [card({ id: 'u2', v2: { over: 50 }, v4: { p: [10, 10, 80], over: 50, btts: 70 }, odds: { op: { h: 900, d: 500, a: -400 }, h: 900, d: 500, a: -400, tl: 2.5, to: -150, tu: 120 } })], '2026-10-28', new Date(new Date(KO).getTime() - 30 * 60000)).some(b => b.rule === 'under'));
ok('under: shows as benched in the record', summary([], []).rules.find(r => r.id === 'under').benched === true);
// --- decide: one position per game and market ---
const first = decide([], [card()], '2026-10-28', NOW);
ok('decide: each set takes its own positions on the game (Analyst 1: follow H, totals O; Analyst 2: move H, Both score No)', first.length === 4 && first.filter(b => setOf(b) === 1).map(b => b.rule + b.key).join() === 'followH,totalsO' && first.filter(b => setOf(b) === 2).map(b => b.rule + b.key).join() === 'moveH,bttsNoN', JSON.stringify(first.map(b => [b.rule, b.key])));
ok('decide: bet keeps the price, market chance, v4 chance, minutes to kickoff and a reason', first[0].price === 110 && first[0].mins === 420 && first[0].v4 === 52 && /v4/.test(first[0].why));
ok('decide: a later read never adds to or reverses a held position', decide(first, [card({ odds: { ...card().odds, h: 300, a: -150 } })], '2026-10-28', NOW).length === 0);
ok('decide: a benched rule places nothing', !decide([], [card()], '2026-10-28', NOW, new Set(['follow'])).some(b => b.rule === 'follow'));
ok('decide: no bet on a stand-in book price (ESPN had no DraftKings price)', decide([], [card({ odds: { ...card().odds, src: 'bet365' } })], '2026-10-28', NOW).length === 0);
ok('settle: a stand-in price is never taken as the close', (() => { const x = { key: 'H', price: 110, kickoff: KO, mins: 60 }; settle(x, card({ odds: { h: -120, d: 250, a: 300, src: 'bet365' } }), new Date('2026-10-28T19:05:00Z')); return x.close == null; })());
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

// --- Nov 5, 2026: the bench check judges on close value (Pinnacle first), one game at a time, top divisions only ---
{ const pn = { h: 120, d: 250, a: 230, tl: 2.5, to: -110, tu: -110, bty: -120, btn: 100 };
  ok('pinFair: only a Pinnacle price read at the lineup window counts as its close', pinFair({ pn }, 'H') === null && Math.abs(pinFair({ pn, pcl: 'x' }, 'O') - 0.5) < 1e-9 && pinFair({ pn: { ...pn, tl: 3 }, pcl: 'x' }, 'O') === null && pinFair({ pn, pcl: 'x' }, 'B') > 0.5);
  const bb = { id: 'p1', rule: 'move', key: 'H', price: 130, kickoff: '2026-11-05T15:00:00Z', mins: 200, date: '2026-11-05', gid: 'g1', league: 'eng.1' };
  settle(bb, { odds: { h: 120, d: 250, a: 230, pn, pcl: '2026-11-05T14:35:00Z' } }, new Date('2026-11-05T15:01:00Z'));
  const q = pinFair({ pn, pcl: 'x' }, 'H');
  // Nov 6, 2026: why a bet has no Pinnacle close, noted once at kickoff (the health report lists only real misses)
  { const at = new Date('2026-11-05T15:01:00Z'), sb = key => ({ rule: 'move', key, price: 130, kickoff: '2026-11-05T15:00:00Z', mins: 200, date: '2026-11-05', gid: 'g9', league: 'eng.1' });
    const o = { h: 120, d: 250, a: 230 }, line = sb('O'), btts = sb('B'), read = sb('H'), got = sb('H');
    settle(line, { odds: { ...o, to: -110, tu: -110, tl: 2.5, pn: { ...pn, tl: 3 }, pcl: 'x' } }, at);
    settle(btts, { odds: { ...o, by: -120, bn: 100, pn: { h: 120, d: 250, a: 230 }, pcl: 'x' } }, at);
    settle(read, { odds: o }, at); settle(got, { odds: { ...o, pn, pcl: 'x' } }, at);
    const pre = sb('H'); settle(pre, { odds: o }, new Date('2026-11-05T14:00:00Z'));
    ok('settle: no Pinnacle close says why (another total line, no both-score price, no closing read); none when there is one or before kickoff',
      line.pinNo === 'line' && btts.pinNo === 'btts' && read.pinNo === 'read' && got.pinNo === undefined && got.clvPin != null && pre.pinNo === undefined, JSON.stringify([line.pinNo, btts.pinNo, read.pinNo, got.pinNo, pre.pinNo]));
    ok('settle: the reason is noted once (a later read changes nothing)', settle(read, { odds: o }, new Date('2026-11-05T15:20:00Z')) === false); }
  ok('settle: close value against Pinnacle\'s fair close is kept next to DraftKings\' close', bb.clv != null && Math.abs(bb.clvPin - Math.round(1000 * (q * 2.3 - 1)) / 10) < 0.11 && cvOf(bb) === bb.clvPin, JSON.stringify(bb));
  const mk = (i, o) => ({ id: 'q' + i, rule: 'follow', key: 'H', price: 110, kickoff: '2026-10-20T15:00:00Z', mins: 200, date: '2026-10-20', gid: 'g' + i, league: 'eng.1', res: 'win', units: 1.1, clv: -1, ...o });
  // 40 games, winning money but losing to the close: benched (profit no longer saves it)
  const win40 = Array.from({ length: 40 }, (_, i) => mk(i));
  const r1 = summary(win40).rules.find(r => r.id === 'follow');
  ok('bench: 40 top-division games behind the close are benched even while winning money', r1.benched && r1.units > 0 && r1.benchCheck.games === 40 && r1.benchCheck.cv === -1, JSON.stringify(r1.benchCheck));
  // Nov 6, 2026: the bench check carries its size and when the rule went onto the bench (the kickoff of the bet that tipped it)
  const dated = Array.from({ length: 41 }, (_, i) => mk(i, { kickoff: new Date(Date.UTC(2026, 9, 1 + i, 15)).toISOString(), clv: i < 20 ? 2 : -3 }));
  const rd = summary(dated.slice(0, 40)).rules.find(r => r.id === 'follow'), rd41 = summary(dated).rules.find(r => r.id === 'follow');
  ok('bench: the check says how many games it needs, and the date the rule was benched', r1.benchCheck.n === BENCH.n && rd.benched && rd.benchCheck.since === dated[39].kickoff && rd41.benchCheck.since === dated[39].kickoff, JSON.stringify([rd.benchCheck, rd41.benchCheck]));
  const back = summary(dated.slice(0, 40).concat(Array.from({ length: 30 }, (_, i) => mk(100 + i, { kickoff: new Date(Date.UTC(2026, 10, 15 + i, 15)).toISOString(), clv: 5 })))).rules.find(r => r.id === 'follow');
  ok('bench: a rule that climbs back above the close is off the bench, with no date', !back.benched && back.benchCheck.since === undefined, JSON.stringify(back.benchCheck));
  ok('bench: a rule benched by hand carries no close-value date', summary([]).rules.find(r => r.id === 'under').benchCheck.since === undefined);
  // losing money but beating the close: not benched
  const r2 = summary(Array.from({ length: 40 }, (_, i) => mk(i, { res: 'loss', units: -1, clv: 2 }))).rules.find(r => r.id === 'follow');
  ok('bench: losing money but beating the close is not benched', !r2.benched && r2.units < 0);
  // two bets on one game count once: 39 games with an extra bet on one are not yet 40
  const r3 = summary(Array.from({ length: 39 }, (_, i) => mk(i)).concat([mk(0, { id: 'q0b', key: 'O' })])).rules.find(r => r.id === 'follow');
  ok('bench: two bets on one game count as one game', r3.settled === 40 && r3.games === 39 && !r3.benched);
  // a game's two bets are averaged before the games are: +4 and -2 on one game and -1 on another give (1 + -1) / 2 = 0
  const r4 = summary([mk(1, { clv: 4 }), mk(1, { id: 'q1b', key: 'O', clv: -2 }), mk(2, { clv: -1 })]).rules.find(r => r.id === 'follow');
  ok('close value is averaged a game at a time', r4.cv === 0 && r4.cvN === 2, JSON.stringify([r4.cv, r4.cvN]));
  // second divisions stay out of the bench check
  const r5 = summary(Array.from({ length: 40 }, (_, i) => mk(i, { league: 'ger.2' }))).rules.find(r => r.id === 'follow');
  ok('bench: second-division games do not count toward it', !r5.benched && r5.benchCheck.games === 0 && r5.games === 40);
  // the packed rows kept for old bets carry Pinnacle's close value, the game and the league
  const old = summary([], [['2026-09-01T15:00:00Z', 'follow', 'H', 60, 'win', 0.5, 1.5, 120, null, null, null, -3, '2026-09-01|g9', 'ger.2']]).rules.find(r => r.id === 'follow');
  ok('old rows: Pinnacle close value, the game and the division are kept', old.cv === -3 && old.pinN === 1 && old.benchCheck.games === 0 && tierOf(['', '', '', '', '', '', '', '', '', '', '', '', '', 'ger.2']) === 'second'); }
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
ok('listAnalyst: one record per set, adding up to the whole (Analyst 2: move lost, Both score No won = +0.3u)', L.sets[1].summary.all.n + L.sets[2].summary.all.n === L.summary.all.n && L.sets[2].summary.all.units === 0.3 && L.sets[1].summary.all.units === -2 && L.sets[1].rules.map(r => r.id).join() === 'stale,follow,value,fade,totals' && L.sets[2].rules.map(r => r.id).join() === 'move,under,shotsOver,shotsOver2,bttsNo,longshot' && L.sets[2].mk.btts.all.n === 1 && L.sets[1].items.every(b => setOf(b) === 1), JSON.stringify([L.sets[1].summary.all, L.sets[2].summary.all]));
ok('listAnalyst: the record split by market adds up, each with only its own rules', L.mk['1x2'].all.n + L.mk.ou.all.n + L.mk.btts.all.n === L.summary.all.n && L.mk.btts.all.n === 1 && L.mk.btts.rules.map(r => r.id).join() === 'bttsNo,longshot' && L.mk['1x2'].rules.every(r => r.id !== 'under') && L.mk.ou.rules.some(r => r.id === 'stale') && !('btts' in L.nhl.mk), JSON.stringify(Object.fromEntries(Object.entries(L.mk).map(([k, v]) => [k, v.all.n]))));
// refreshOdds hands the Analyst the fresh prices: fake ESPN with one priced game
globalThis.fetch = async () => new Response(JSON.stringify({ events: [] }));
kv.set('day:2026-10-30', JSON.stringify({ date: '2026-10-30', cards: [card({ v2: { p: [50, 25, 25] }, kickoff: '2026-10-30T19:00:00Z' })] }));
const ro = await refreshOdds(env, '2026-10-30', 'eng.1', new Date('2026-10-30T12:00:00Z'));
ok('refreshOdds: the Analyst looks at the league after its price read', ro.games === 1 && ro.analyst && ro.analyst.placed === 4 && (await getAnalyst(env)).items.filter(x => x.date === '2026-10-30').length === 4, JSON.stringify(ro));

// --- top divisions v second divisions (La Liga 2, 2. Bundesliga) ---
{
  const its = [{ league: 'eng.1', rule: 'follow', key: 'H', kickoff: KO, mins: 60, res: 'win', units: 1.1, clv: 1 }, { league: 'ger.2', rule: 'follow', key: 'A', kickoff: KO, mins: 60, res: 'loss', units: -1, clv: -2 },
    { league: 'esp.2', rule: 'move', key: 'H', kickoff: KO, mins: 60, res: null, units: null, clv: null }];
  const t = tiers(its, [['2026-09-01T15:00:00Z', 'follow', 'H', 60, 'win', 0.5, 1.5]]);
  ok('tiers: second divisions are La Liga 2 and 2. Bundesliga; packed old rows count as top divisions', tierOf(its[1]) === 'second' && tierOf(its[0]) === 'top' && tierOf(['x', 'follow']) === 'top' && t.top.n === 2 && t.top.units === 1.6 && t.second.n === 2 && t.second.settled === 1 && t.second.units === -1, JSON.stringify(t));
  ok('listAnalyst: each set carries its record split by division, adding up to the set', [1, 2].every(k => L.sets[k].tiers.top.n + L.sets[k].tiers.second.n === L.sets[k].summary.all.n));
}

// --- second divisions: Pinnacle's both-score price stands in for DraftKings' (Nov 2, 2026) ---
{
  const pin = { ...card().odds, by: -160, bn: 130, bk: 'pinnacle' };
  const g2 = card({ id: 'p2', league: 'ger.2', odds: pin }), g1 = card({ id: 'p1', league: 'eng.1', odds: pin });
  const d2 = decide([], [g2], '2026-10-28', NOW), d1 = decide([], [g1], '2026-10-28', NOW);
  ok('second division: Both score No bets on Pinnacle\'s both-score price, tagged Pinnacle', (b => b && b.key === 'N' && b.price === 130 && b.book === 'pinnacle')(d2.find(b => b.rule === 'bttsNo')), JSON.stringify(d2));
  ok('first division: a Pinnacle both-score price is still not bet (DraftKings only)', !d1.some(b => b.rule === 'bttsNo'));
  ok('second division: the other bets on the game stay DraftKings bets', d2.filter(b => b.key !== 'N').every(b => !b.book));
  const m2 = new Map([['day:2026-10-28', JSON.stringify({ date: '2026-10-28', cards: [g2] })]]), e2 = { HUB: { get: async (k, t) => { const x = m2.get(k); return x == null ? null : t === 'json' ? JSON.parse(x) : x; }, put: async (k, x) => { m2.set(k, x); } } };
  await analystLook(e2, '2026-10-28', [g2], NOW);
  const pb = (await getAnalyst(e2)).items.find(b => b.rule === 'bttsNo');
  ok('second division: saved with book Pinnacle and no DraftKings price', pb && pb.bk === 'pinnacle' && pb.dk == null && !('book' in pb), JSON.stringify(pb));
  const x = { ...pb }; settle(x, card({ id: 'p2', league: 'ger.2', odds: { ...pin, bn: 115 } }), new Date('2026-10-28T19:05:00Z'));
  ok('second division: a Pinnacle bet closes at Pinnacle\'s both-score price', x.close === 115 && x.clv > 0, JSON.stringify(x));
  const y = { ...pb }; settle(y, card({ id: 'p2', league: 'ger.2', odds: { ...pin, bn: 115, bk: 'draftkings' } }), new Date('2026-10-28T19:05:00Z'));
  ok('second division: a Pinnacle bet never closes at a DraftKings price (and the other way round)', y.close == null);
}

// --- the cards' Analyst line (public/index.html anByGame / anLine), built from listAnalyst's sets ---
{
  const html = (await import('fs')).readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const grab = re => { const m = html.match(re); if (!m) throw new Error('not found: ' + re); return m[0]; };
  const src = [grab(/const AN_SHORT = [^\n]+/), grab(/function anLine\(c\) \{[\s\S]*?\n\}/), grab(/function anByGame\(A\) \{[^\n]+/)].join('\n');
  const mk = new Function('esc', 'strip', 'fmtOdds', `let ANB = null; ${src}; return { set: m => { ANB = m; }, anLine, anByGame };`);
  const P = mk(x => String(x), x => x, m => (m > 0 ? '+' : '') + m);
  P.set(P.anByGame(L));
  const line = P.anLine(card({ v2: { p: [50, 25, 25] } }));
  ok('card line: both sets\' bets on the game, Original first, with the price and the result', /Analyst/.test(line) && line.indexOf('Original') < line.indexOf('New') && /Arsenal \+110/.test(line) && /Not both score \+130/.test(line) && /✓/.test(line) && /✗/.test(line), line);
  ok('card line: blank on a game neither set bet', P.anLine(card({ id: 'nobody' })) === '');
  P.set(P.anByGame({ sets: { 1: { items: [] }, 2: { items: [{ gid: 'g9', key: 'O', price: -165, res: null }] } } }));
  const one = P.anLine({ ...card(), id: 'g9' });
  ok('card line: only the set that bet is shown, and the tap opens that set', !/Original/.test(one) && /New: <b>Over 2.5 -165<\/b>/.test(one) && /data-anopen="2"/.test(one), one);
}

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
ok('analystSharp: no look for a league with no Odds API source (La Liga 2, 2. Bundesliga), so the day\'s looks and the last-look note are left alone', analystSharp({ ODDS_API_KEY: 'k' }, 'ger.2', countSharp, NOW) === null && analystSharp({ ODDS_API_KEY: 'k' }, 'esp.2', countSharp, NOW) === null && sc === 1 && (await readSharpNote()).league !== 'ger.2');
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
// Rested team against a back-to-back (Nov 8, 2026): lineup read, exactly one team tired, rested team priced 35-65%, not already moved 3+ for it
const rc = (b2b, o = {}) => lr({ v2: { w: 50, o: 50 }, v5: { in: { b2b, bk: [0, 0] } }, px: { h: -110, a: -110, cl: at(40).toISOString() }, ...o }); // 50/50, v2 agrees: no hprice
const rb = (b2b, o, n = at(40)) => decideNhl([], [rc(b2b, o)], '2026-10-28', n).filter(b => b.rule === 'hrest');
const r1b = rb([0, 1]);
ok('hrest: visitor on a back-to-back, home rested at 50%: bet the home moneyline', r1b.length === 1 && r1b[0].key === 'H' && r1b[0].price === -110 && /back-to-back/.test(r1b[0].why) && /DET/.test(r1b[0].why), JSON.stringify(r1b));
const r2b = rb([1, 0]);
ok('hrest: home on a back-to-back: bet the visitor', r2b.length === 1 && r2b[0].key === 'A');
ok('hrest: both tired, neither tired, or rest unknown: no bet', !rb([1, 1]).length && !rb([0, 0]).length && !rb([0, null]).length && !rb(null).length);
ok('hrest: no bet before the lineup read', !rb([0, 1], { px: { h: -110, a: -110 } }).length);
ok('hrest: rested team priced over 65%: no bet', !rb([0, 1], { px: { h: -230, a: 190, cl: at(40).toISOString() } }).length);
ok('hrest: rested team priced under 35%: no bet', !rb([1, 0], { px: { h: -230, a: 190, cl: at(40).toISOString() } }).length);
// opening EDM -185 (~63%) -> now 50%: the visitor's chance rose ~13 points, so a rested visitor is skipped; a rested home team (fell) is still bet
ok('hrest: rested team\'s chance already rose 3+ points since the opening price: no bet', !rb([1, 0], { px: { op: { h: -185, a: 154 }, h: -110, a: -110, cl: at(40).toISOString() } }).length);
ok('hrest: rested team\'s chance fell since the opening price: still bet', rb([0, 1], { px: { op: { h: -185, a: 154 }, h: -110, a: -110, cl: at(40).toISOString() } }).length === 1);
const both = decideNhl([], [rc([0, 1], { v2: { w: 40, o: 50 } })], '2026-10-28', at(40));
ok('hrest: a game Price over v2 already bet on the moneyline is skipped (one moneyline position per game)', both.filter(b => 'HA'.includes(b.key)).length === 1 && both[0].rule === 'hprice', JSON.stringify(both.map(b => b.rule)));
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
