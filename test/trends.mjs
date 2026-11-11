// Hockey Trends: rest and first-game context, the situation records judged against the chance going in, tags, lifts, the game read as a chance, and the strength rule.
import { withContext, situations, tagOf, gameReads, rate, buildTrends, track, chanceHome, chanceOver } from '../src/trends.js';
let fails = 0; const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n} ${c ? '' : x}`); };

const card = (id, kickoff, a, h, o = {}) => ({ id, kickoff, ko: kickoff.slice(11, 16), aAbbr: a, hAbbr: h, away: a, home: h, ...o });
const day = (date, cards) => ({ date, cards });

// 1. rest: days since a team last played in the saved days; unknown stays null
{
  const ctx = withContext([
    day('2026-11-02', [card('1', '2026-11-02T19:00', 'AAA', 'BBB'), card('2', '2026-11-02T20:00', 'CCC', 'DDD')]),
    day('2026-11-03', [card('3', '2026-11-03T19:00', 'AAA', 'CCC')]),
    day('2026-11-05', [card('4', '2026-11-05T19:00', 'BBB', 'AAA')]),
  ]);
  const g = Object.fromEntries(ctx.map(c => [c.id, c]));
  ok('first saved game of a team has unknown rest (null, not 0)', g['1'].arest === null && g['1'].hrest === null);
  ok('a team that played yesterday has 0 days of rest', g['3'].arest === 0 && g['3'].hrest === 0);
  ok('rest counts the days between games', g['4'].hrest === 1 && g['4'].arest === 2, JSON.stringify([g['4'].hrest, g['4'].arest]));
  ok('only the earliest kickoff of a day is the first game', g['1'].firstGame && !g['2'].firstGame && g['3'].firstGame);
}
{
  const ctx = withContext([day('2026-11-02', [card('1', '2026-11-02T19:00', 'A', 'B'), card('2', '2026-11-02T19:00', 'C', 'D'), card('3', '2026-11-02T20:00', 'E', 'F')])]);
  ok('games tied at the earliest kickoff are all first games', ctx[0].firstGame && ctx[1].firstGame && !ctx[2].firstGame);
}

// 2. tags
ok('under 10 games is Noise whatever z says', tagOf(9, 3) === 'noise');
ok('z 1.5+ on 20+ games is Lean, on fewer is Watch', tagOf(25, 1.6) === 'lean' && tagOf(15, 1.6) === 'watch');
ok('z 0.8 to 1.5 is Watch, either direction; under 0.8 is Noise', tagOf(30, -1) === 'watch' && tagOf(30, 0.5) === 'noise');

// 3. record judged against the price: a home favorite at -200 that wins 12 of 20 did worse than its price
{
  const mk = (i, win) => card('h' + i, '2026-11-03T19:00', 'AAA', 'BBB', { px: { h: -200, a: 170, tl: 6 }, final: { h: win ? 4 : 1, a: win ? 1 : 4, total: 5 }, grade: true });
  const cards = []; for (let i = 0; i < 20; i++) cards.push(mk(i, i < 12));
  const st = situations(withContext([day('2026-11-03', cards)])).find(s => s.id === 'homefav60');
  ok('home favorite record counted', st.w === 12 && st.l === 8 && st.n === 20, JSON.stringify(st));
  ok('12-8 against a ~65% price reads against it, but 20 games is too few to call (Noise)', st.dir === 'against' && st.z < 0 && st.tag === 'noise', JSON.stringify(st));
  const un = situations(withContext([day('2026-11-03', [card('x', '2026-11-03T19:00', 'A', 'B', { px: { h: -200, a: 170 } })])])).find(s => s.id === 'homefav60');
  ok('ungraded games are not counted', un.n === 0);
}
{
  const c = card('o', '2026-11-03T19:00', 'A', 'B', { px: { h: -110, a: -110, tl: 6 }, final: { h: 3, a: 3, total: 6 }, grade: true });
  ok('a push on the total is not counted', situations(withContext([day('2026-11-03', [c])])).find(s => s.id === 'firstover').n === 0);
}

// 4. strength rule: the pick's chance, and a model on the other side is a Conflict
ok('model disagrees: Conflict, whatever the chance', rate(80, false) === 'Conflict');
ok('65%+ is Strong, 58%+ Medium, 53%+ Weak, under that a Pass', rate(65, true) === 'Strong' && rate(64, true) === 'Medium' && rate(58, null) === 'Medium' && rate(57, true) === 'Weak' && rate(53, null) === 'Weak' && rate(52, true) === 'Pass');
// 4b. the chance going in: the price with the margin removed, else the model; the total uses the price on its own line, else 50%
{
  ok('home chance from the price, margin removed', Math.abs(chanceHome({ px: { h: -110, a: -110 }, v4: { w: 70 } }) - 0.5) < 1e-9);
  ok('home chance from the model with no price; null with neither', chanceHome({ v4: { w: 62 } }) === 0.62 && chanceHome({ v2: { w: 55 } }) === 0.55 && chanceHome({}) === null);
  ok('over chance from the price on the graded line', chanceOver({ px: { tl: 6.5, to: -150, tu: 130 } }) > 0.55);
  ok('over chance is 50% with no price, or a price on another line', chanceOver({ ln: { v: 6 }, px: { tl: 6.5, to: -150, tu: 130 } }) === 0.5 && chanceOver({ ln: { v: 6 } }) === 0.5);
}
// 4c. lift: the gap per game, pulled toward 0 as if 30 more games at the chance had been played; none under 10 games
{
  const mk = (i, win, d) => card('q' + d + i, d + 'T19:00', 'AAA', 'BBB', { px: { h: -200, a: 170, tl: 6 }, final: { h: win ? 4 : 1, a: win ? 1 : 4, total: 5 }, grade: true });
  const few = situations(withContext([day('2026-11-03', Array.from({ length: 9 }, (_, i) => mk(i, true, '2026-11-03')))])).find(s => s.id === 'homefav60');
  ok('9 games: no lift yet', few.n === 9 && few.lift === 0, JSON.stringify(few));
  const hot = situations(withContext([day('2026-11-03', Array.from({ length: 30 }, (_, i) => mk(i, true, '2026-11-03')))])).find(s => s.id === 'homefav60');
  ok('30-0 at a ~65% chance lifts by (30 - 19.6) / 60, about 17 points', hot.lift > 16 && hot.lift < 18.5, JSON.stringify(hot));
  const cold = situations(withContext([day('2026-11-03', Array.from({ length: 30 }, (_, i) => mk(i, i < 12, '2026-11-03')))])).find(s => s.id === 'homefav60');
  ok('a record under its chance has a negative lift', cold.lift < 0, JSON.stringify(cold));
  const noPx = (i, win) => card('m' + i, '2026-11-03T19:00', 'AAA', 'BBB', { v4: { w: 70, o: 50 }, hloss: 0, final: { h: win ? 4 : 1, a: win ? 1 : 4, total: 5 }, grade: true });
  const ctx = withContext([day('2026-11-01', [card('p1', '2026-11-01T19:00', 'BBB', 'ZZZ', { final: { h: 3, a: 1, total: 4 }, grade: true })]), day('2026-11-02', [card('p2', '2026-11-02T19:00', 'BBB', 'YYY', { final: { h: 3, a: 1, total: 4 }, grade: true })]), day('2026-11-03', [noPx(1, true)])]);
  const hl = situations(ctx).find(s => s.id === 'homeloss2');
  ok('with no price the expected wins come from the model (70%), not a fixed base', hl.n === 1 && hl.exp === 0.7, JSON.stringify(hl));
}
// 5. a game read: the chance going in plus the lifts, from the days before the game only
{
  const hist = [], g = (i, hw) => card('f' + i, '2026-11-03T19:00', 'AAA', 'BBB', { px: { h: -170, a: 145, tl: 6 }, final: { h: hw ? 4 : 1, a: hw ? 1 : 4, total: 5 }, grade: true });
  for (let i = 0; i < 40; i++) hist.push(g(i, i < 35)); // 35-5 at a ~61% chance: way better than its chance
  const today = card('t', '2026-11-04T19:00', 'CCC', 'DDD', { px: { h: -170, a: 145, tl: 6 }, v4: { w: 62, o: 40 } });
  const out = buildTrends([day('2026-11-03', hist), day('2026-11-04', [today])], '2026-11-04');
  const r = out.cards.find(c => c.id === 't');
  ok('the read picks the home favorite and the model agrees', r.ml && r.ml.side === 'H' && r.ml.team === 'DDD' && r.ml.modelOk === true, JSON.stringify(r.ml));
  ok('the chance is the price chance plus the lift, capped at 12 points: Strong', r.ml.base === 61 && r.ml.shift === 12 && r.ml.chance === 73 && r.ml.lab === 'Strong', JSON.stringify(r.ml));
  ok('only that date\'s games get a read', out.cards.every(c => c.date === '2026-11-04'));
  const bad = buildTrends([day('2026-11-03', hist), day('2026-11-04', [{ ...today, v4: { w: 40, o: 40 } }])], '2026-11-04').cards[0];
  ok('a model on the other side makes it a Conflict', bad.ml.lab === 'Conflict', JSON.stringify(bad.ml));
  ok('no days saved: empty and no crash', buildTrends([], '2026-11-04').cards.length === 0 && buildTrends(null, '2026-11-04').games === 0);
  const past = buildTrends([day('2026-11-03', hist), day('2026-11-04', [today])], '2026-11-03').cards;
  ok('a past day is read from the days before it: its own results move nothing', past.length === 40 && past.every(c => !c.ml && !c.ou));
  // a trend against a heavy favorite lowers its chance but cannot hand the pick to a likely loser
  const lost = []; for (let i = 0; i < 40; i++) lost.push(card('u' + i, '2026-11-03T19:00', 'AAA', 'BBB', { px: { h: -250, a: 200, tl: 6 }, final: { h: i < 18 ? 4 : 1, a: i < 18 ? 1 : 4, total: 5 }, grade: true }));
  const fav = buildTrends([day('2026-11-03', lost), day('2026-11-04', [card('t2', '2026-11-04T19:00', 'CCC', 'DDD', { px: { h: -250, a: 200, tl: 6 }, v4: { w: 66, o: 40 } })])], '2026-11-04').cards[0];
  ok('18-22 at a ~68% chance pulls the favorite down, and it stays the pick', fav.ml.side === 'H' && fav.ml.shift < 0 && fav.ml.chance < fav.ml.base && fav.ml.chance >= 56, JSON.stringify(fav.ml));
  const flip = buildTrends([day('2026-11-03', lost.map(c => ({ ...c, px: { h: -120, a: 100, tl: 6 } })).map((c, i) => ({ ...c, id: 'v' + i }))), day('2026-11-04', [card('t3', '2026-11-04T19:00', 'CCC', 'DDD', { px: { h: -120, a: 100, tl: 6 }, v4: { w: 48, o: 40 } })])], '2026-11-04').cards[0];
  ok('a game near even with a trend against the slight favorite: the read goes to the other side, and its small chance makes it a Pass or Weak', flip.ml.side === 'A' && ['Pass', 'Weak'].includes(flip.ml.lab), JSON.stringify(flip.ml));
}
// 6. losing streaks and the rested-home spot
{
  const lose = (i, d, a, h) => card('l' + i, d + 'T19:00', a, h, { final: { h: 1, a: 3, total: 4 }, grade: true });
  const ctx = withContext([
    day('2026-11-02', [lose(1, '2026-11-02', 'RRR', 'HHH')]),
    day('2026-11-03', [card('w', '2026-11-03T19:00', 'HHH', 'XXX', { final: { h: 4, a: 1, total: 5 }, grade: true })]),
    day('2026-11-06', [card('t', '2026-11-06T19:00', 'XXX', 'HHH')]),
  ]);
  const t = ctx.find(c => c.id === 't'), w = ctx.find(c => c.id === 'w');
  ok('a loss starts the run at 1, a second straight loss makes it 2', w.aloss === 1 && t.hloss === 2, JSON.stringify([w.aloss, t.hloss]));
  ok('a win resets the run', t.aloss === 0);
  const st = situations(ctx);
  ok('the three new situations exist and count only graded games', ['homeloss2', 'roadloss2', 'resthome'].every(id => st.find(s => s.id === id) && st.find(s => s.id === id).n === 0));
  const rh = withContext([day('2026-11-02', [card('a', '2026-11-02T19:00', 'AAA', 'BBB')]), day('2026-11-03', [card('b', '2026-11-03T19:00', 'AAA', 'CCC')]), day('2026-11-06', [card('c', '2026-11-06T19:00', 'AAA', 'BBB')])]);
  const b = rh.find(c => c.id === 'b'), cc = rh.find(c => c.id === 'c');
  ok('road on a back-to-back with a home team 2+ days rested is the rested-home spot', b.arest === 0 && cc.arest === 2, JSON.stringify([b.arest, b.hrest, cc.arest]));
}
// 7. the track record panel: every game read from the days before it
{
  const g = (d, i, hw) => card('k' + d + i, d + 'T19:00', 'AAA', 'BBB', { px: { h: -170, a: 145, tl: 6 }, final: { h: hw ? 4 : 1, a: hw ? 1 : 4, total: 5 }, grade: true, v4: { w: 62, o: 40 } });
  const d1 = [], d2 = []; for (let i = 0; i < 40; i++) { d1.push(g('2026-11-03', i, i < 35)); d2.push(g('2026-11-04', i, i < 30)); }
  const tr = buildTrends([day('2026-11-03', d1), day('2026-11-04', d2)], '2026-11-05').track;
  ok('track is a list of groups with w <= n', Array.isArray(tr) && tr.length > 0 && tr.every(x => x.n >= x.w && x.n > 0 && x.label));
  const st = tr.find(x => x.id === 'ml-strong'), pl = tr.find(x => x.id === 'ml-play');
  ok('the first day has no earlier games, so only the second day is replayed', st && st.n === 40 && st.w === 30 && pl.n === 40, JSON.stringify(tr));
  ok('one day alone: nothing to replay', track(withContext([day('2026-11-03', d1)])).length === 0);
  ok('track is empty with no games', buildTrends([], '2026-11-04').track.length === 0);
}
{ // one rest fact counts once (Nov 10, 2026): home rested 2 days, road on a back-to-back fires roadb2b and resthome; the read keeps one
  const st0 = (id, lift) => ({ id, lift, w: 12, l: 8, n: 20 }), quiet = ['homeloss2', 'roadloss2', 'homefav60', 'homefav50', 'b2bover', 'firstover'].map(id => st0(id, 0));
  const st = (id, lift) => [st0(id, lift)], S2 = (a, b) => [...a, ...b, ...quiet];
  const g = card('r1', '2026-11-10T00:00:00Z', 'TOR', 'EDM', { date: '2026-11-09', hrest: 2, arest: 0, v4: { w: 55, o: 50 } });
  const both = gameReads([g], S2(st('roadb2b', -3), st('resthome', 6)), '2026-11-09')[0];
  ok('rest read: only one of roadb2b / resthome is counted', both.ml && both.ml.ev.length === 1 && both.ml.ev[0].id === 'resthome' && both.ml.shift === 6 && both.ml.chance === 61, JSON.stringify(both.ml));
  const tie = gameReads([g], S2(st('roadb2b', -6), st('resthome', 6)), '2026-11-09')[0];
  ok('rest read: a tie keeps resthome', tie.ml && tie.ml.ev.length === 1 && tie.ml.ev[0].id === 'resthome', JSON.stringify(tie.ml));
  const one = gameReads([{ ...g, hrest: 1 }], S2(st('roadb2b', -6), st('resthome', 6)), '2026-11-09')[0];
  ok('rest read: home rested 1 day still counts roadb2b', one.ml && one.ml.ev.length === 1 && one.ml.ev[0].id === 'roadb2b', JSON.stringify(one.ml));
  ok('a lift under 1 point does not make a read', !gameReads([{ ...g, hrest: 1 }], S2(st('roadb2b', -0.6), st('resthome', 0)), '2026-11-09')[0].ml);
  ok('no price and no model: no moneyline read', !gameReads([{ ...g, v4: undefined }], S2(st('roadb2b', -6), st('resthome', 6)), '2026-11-09')[0].ml);
}
console.log(fails ? `\n${fails} FAILED` : '\nall trends checks pass'); process.exit(fails ? 1 : 0);
