// Bet analyzer and tracker: probabilities, parlays, same-game legs, settling and summary.
import { suggest, analyze, jointProb, legProb, scoreGrid, settle, summary, addBet, listBets, changeBet, test } from '../src/bets.js';
let fail = 0;
const ok = (n, c, x = '') => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (c ? '' : ' ' + x)); if (!c) fail++; };
const card = (id, home, away, v2, v4, fb, extra = {}) => ({ id, league: 'esp.1', leagueName: 'La Liga', home, away, kickoff: new Date(Date.now() + 86400000).toISOString(), ko: '3:00 PM', v2, v4, fb, final: null, ...extra });
const mdl = (p, over, btts, lam) => ({ p, over, btts, lam });
const C1 = card('1', 'Barcelona', 'Getafe', mdl([72, 17, 11], 70, 52, [2.5, 0.9]), mdl([68, 19, 13], 66, 50, [2.3, 0.95]), { p: [70, 18, 12], over: 64, btts: 49 });
const C2 = card('2', 'Girona', 'Osasuna', mdl([46, 27, 27], 48, 47, [1.4, 1.1]), null, null);
const D = new Date().toISOString().slice(0, 10), cards = new Map([[`${D}|esp.1|1`, C1], [`${D}|esp.1|2`, C2]]);
const L = (id, market, sel, line) => ({ date: D, league: 'esp.1', id, market, sel, ...(line != null ? { line } : {}) });

// single legs: the model's own published number where the card has it
let a = analyze(cards, [L('1', 'win', 'H')]);
ok('winner leg uses the card numbers', Math.abs(a.p.v2 - 0.72) < 1e-9 && Math.abs(a.p.v4 - 0.68) < 1e-9 && Math.abs(a.p.fb - 0.70) < 1e-9, JSON.stringify(a.p));
a = analyze(cards, [L('1', 'ou', 'O', 2.5)]);
ok('Over 2.5 is the card number, Under is the rest', Math.abs(a.p.v2 - 0.70) < 1e-9 && Math.abs(analyze(cards, [L('1', 'ou', 'U', 2.5)]).p.v2 - 0.30) < 1e-9);
a = analyze(cards, [L('1', 'ou', 'O', 3.5)]);
ok('Over 3.5 comes from the score grid and is lower than Over 2.5', a.p.v2 > 0.2 && a.p.v2 < 0.70 && a.legs[0].grid === true && a.p.fb === null, JSON.stringify(a.p));
ok('higher lines are never likelier than lower lines', [0.5, 1.5, 2.5, 3.5, 4.5, 5.5].map(l => legProb(C1, L('1', 'ou', 'O', l), 'v2')).every((x, i, arr) => i === 0 || x <= arr[i - 1] + 1e-9));
ok('Over and Under at the same line add to 1', Math.abs(legProb(C1, L('1', 'ou', 'O', 3.5), 'v2') + legProb(C1, L('1', 'ou', 'U', 3.5), 'v2') - 1) < 1e-9);
ok('double chance adds the two outcomes', Math.abs(analyze(cards, [L('1', 'dc', '1X')]).p.v2 - 0.89) < 1e-9 && Math.abs(analyze(cards, [L('1', 'dc', '12')]).p.v2 - 0.83) < 1e-9);
ok('Both teams to score Yes / No', Math.abs(analyze(cards, [L('1', 'btts', 'Y')]).p.v2 - 0.52) < 1e-9 && Math.abs(analyze(cards, [L('1', 'btts', 'N')]).p.v2 - 0.48) < 1e-9);
ok('a model with no card number gives nothing (no v4 or Forebet on that game)', analyze(cards, [L('2', 'win', 'H')]).p.v4 === null && analyze(cards, [L('2', 'win', 'H')]).p.fb === null);

// parlays
a = analyze(cards, [L('1', 'win', 'H'), L('2', 'btts', 'Y')]);
ok('legs on different games multiply', Math.abs(a.p.v2 - 0.72 * 0.47) < 1e-9 && a.parlay && !a.sameGame && a.games === 2, JSON.stringify(a.p));
ok('a parlay is blank for a model that is missing on any game', a.p.v4 === null && a.p.fb === null);
a = analyze(cards, [L('1', 'win', 'H'), L('1', 'ou', 'O', 3.5)]);
const j = jointProb(C1, [L('1', 'win', 'H'), L('1', 'ou', 'O', 3.5)], 'v2');
ok('same-game legs are scored together, not multiplied', a.sameGame && Math.abs(a.p.v2 - j) < 1e-12 && a.p.v2 < legProb(C1, L('1', 'win', 'H'), 'v2') && a.p.v2 < legProb(C1, L('1', 'ou', 'O', 3.5), 'v2'), JSON.stringify(a.p));
ok('home win and Over 3.5 together are likelier than if they were independent (a big win means goals)', j > legProb(C1, L('1', 'win', 'H'), 'v2') * legProb(C1, L('1', 'ou', 'O', 3.5), 'v2'));
ok('Forebet has no same-game number', a.p.fb === null);
ok('the score grid adds to 1', Math.abs(scoreGrid(1.7, 1.1).reduce((s, c) => s + c[2], 0) - 1) < 1e-12);
ok('the identical pick twice is refused', !!analyze(cards, [L('1', 'win', 'H'), L('1', 'win', 'H')]).error);
ok('several different picks on one game are allowed (winner, Over 2.5, both score)', (() => { const a = analyze(cards, [L('1', 'win', 'H'), { ...L('1', 'ou', 'O'), line: 2.5 }, L('1', 'btts', 'Y')]); return !a.error && a.sameGame && a.p.v2 > 0 && a.p.v2 < .7; })());
ok('two Over/Under lines on one game are allowed', !analyze(cards, [{ ...L('1', 'ou', 'O'), line: 1.5 }, { ...L('1', 'ou', 'O'), line: 3.5 }]).error);
ok('picks that cannot both happen give 0% with a note', (() => { const a = analyze(cards, [L('1', 'win', 'H'), L('1', 'win', 'A')]); return !a.error && a.p.v2 === 0 && a.notes.some(n => /cannot all happen/.test(n)); })());
ok('bad picks are refused', !!analyze(cards, [{ ...L('1', 'ou', 'O', 3) }]).error && !!analyze(cards, [{ ...L('1', 'win', 'X') }]).error && !!analyze(cards, []).error && !!analyze(cards, [L('9', 'win', 'H')]).error);
ok('a finished game cannot be analyzed', !!analyze(new Map([[`${D}|esp.1|1`, { ...C1, final: { h: 1, a: 0 } }]]), [L('1', 'win', 'H')]).error);

// rules
ok('settling rules', test(L('1', 'win', 'H'))(2, 1) && !test(L('1', 'win', 'H'))(1, 1) && test(L('1', 'dc', 'X2'))(0, 0) && !test(L('1', 'dc', '12'))(1, 1) && test(L('1', 'ou', 'O', 3.5))(3, 1) && !test(L('1', 'ou', 'O', 3.5))(2, 1) && test(L('1', 'ou', 'U', 3.5))(2, 1) && test(L('1', 'btts', 'Y'))(1, 1) && test(L('1', 'btts', 'N'))(2, 0));

// storage, settling, summary
const kv = new Map(), writes = [];
const env = { HUB: { get: async (k, t) => { const v = kv.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => { kv.set(k, v); writes.push(k); } } };
kv.set(`day:${D}`, JSON.stringify({ date: D, cards: [C1, C2] }));
let r = await addBet(env, [L('1', 'win', 'H'), L('1', 'ou', 'O', 3.5)]);
ok('a bet is saved with the models\' numbers at the time', r.saved && r.bet.status === 'pending' && r.bet.p.v2 > 0 && r.bet.legs[0].p.v2 === 0.72 && r.bet.legs[0].res === null, JSON.stringify(r).slice(0, 200));
const r2 = await addBet(env, [L('2', 'btts', 'Y')]);
ok('adding bets writes one small document', writes.every(k => k === 'bets') && (await listBets(env)).items.length === 2);
let w0 = writes.length; await listBets(env);
ok('opening the list with nothing finished writes nothing', writes.length === w0);
const dd = JSON.parse(kv.get(`day:${D}`)); dd.cards[0].final = { h: 3, a: 1 }; dd.cards[1].final = { h: 0, a: 2 }; kv.set(`day:${D}`, JSON.stringify(dd));
let l = await listBets(env);
const b1 = l.items.find(b => b.id === r.bet.id), b2 = l.items.find(b => b.id === r2.bet.id);
ok('3-1: Barcelona win hits and Over 3.5 hits, so the parlay hits', b1.status === 'hit' && b1.legs.every(x => x.res === 'hit'), JSON.stringify(b1.legs.map(x => x.res)));
ok('0-2: Both teams to score misses', b2.status === 'miss');
w0 = writes.length; await listBets(env);
ok('a settled bet is not written again', writes.length === w0);
const s = l.summary;
ok('summary counts bets and legs', s.bets.n === 2 && s.bets.hit === 1 && s.bets.miss === 1 && s.legs.n === 3 && s.legs.hit === 2, JSON.stringify(s));
ok('summary compares what v2 said with what landed', s.models.v2.n === 3 && s.models.v2.said > 0 && s.models.v2.hit === 66.7 && s.models.v4.n === 2, JSON.stringify(s.models));
// a parlay is lost as soon as one leg misses, even with other games still to play
const e2 = { HUB: { get: async (k, t) => { const v = kv.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => kv.set(k, v) } };
const bet = { legs: [{ ...L('1', 'win', 'A'), res: null }, { ...L('9', 'win', 'H'), res: null }], status: 'pending' };
settle(bet, new Map([[`${D}|esp.1|1`, { ...C1, final: { h: 3, a: 1 } }]]));
ok('one missed leg loses a parlay straight away', bet.status === 'miss' && bet.legs[1].res === null);
dd.cards[0].final = null; kv.set(`day:${D}`, JSON.stringify(dd));
const v = await addBet(e2, [L('1', 'win', 'H')]);
ok('voiding a bet closes it with no result', (await changeBet(e2, v.bet.id, 'void')).ok && (await listBets(e2)).items.find(b => b.id === v.bet.id).status === 'void');
ok('a bet can be removed', (await changeBet(e2, v.bet.id, 'delete')).ok && !(await listBets(e2)).items.some(b => b.id === v.bet.id));

// ---- hockey: winner and Over/Under at the card's own line ----
{
  const H = (id, extra = {}) => ({ id, home: 'Utah Mammoth', away: 'Edmonton Oilers', hAbbr: 'UTA', aAbbr: 'EDM', kickoff: new Date(Date.now() + 5 * 3600000).toISOString(), ko: '7:00 PM', v2: { w: 55, o: 52, sc: { h: 4, a: 3, p: 7 } }, v4: { w: 56, o: 50 }, fb: { p: [41, 59], pick: 'A', score: { h: 3, a: 4 } }, lam: [3.54, 3.24], ln: { v: 6.5, src: 'DraftKings' }, final: null, ...extra });
  const hk = new Map([[`${D}|nhl|9`, H('9')], [`${D}|nhl|10`, H('10', { ln: undefined })], [`${D}|nhl|11`, H('11', { ln: { v: 6, src: 'DraftKings' }, v2: { w: 55, o: 55, push: 15 }, v4: { w: 56, o: 53 } })], [`${D}|esp.1|1`, C1]]);
  const N = (id, market, sel) => ({ date: D, league: 'nhl', sport: 'nhl', id, market, sel });
  let a = analyze(hk, [N('9', 'win', 'H')]);
  ok('hockey winner: v2, v4 and Forebet home win chances', Math.abs(a.p.v2 - .55) < 1e-9 && Math.abs(a.p.v4 - .56) < 1e-9 && Math.abs(a.p.fb - .41) < 1e-9 && a.legs[0].label === 'Utah Mammoth to win' && a.legs[0].leagueName === 'NHL', JSON.stringify(a));
  ok('hockey away win is the rest', Math.abs(analyze(hk, [N('9', 'win', 'A')]).p.v2 - .45) < 1e-9 && Math.abs(analyze(hk, [N('9', 'win', 'A')]).p.fb - .59) < 1e-9);
  a = analyze(hk, [N('9', 'ou', 'O')]);
  ok('hockey Over takes the card\'s line, v2 and v4 give a chance, Forebet none', a.legs[0].line === 6.5 && a.legs[0].label === 'Over 6.5 goals' && Math.abs(a.p.v2 - .52) < 1e-9 && Math.abs(a.p.v4 - .50) < 1e-9 && a.p.fb === null && a.legs[0].grid === false, JSON.stringify(a));
  ok('hockey Under is the rest', Math.abs(analyze(hk, [N('9', 'ou', 'U')]).p.v2 - .48) < 1e-9);
  ok('a line sent by the page is ignored: the card\'s line wins', analyze(hk, [{ ...N('9', 'ou', 'O'), line: 3.5 }]).legs[0].line === 6.5);
  ok('no Over/Under without a line on the card', /No Over\/Under line/.test(analyze(hk, [N('10', 'ou', 'O')]).error || '') && !analyze(hk, [N('10', 'win', 'H')]).error);
  ok('no draw, no puck line, no both-score in hockey', !!analyze(hk, [N('9', 'win', 'D')]).error && !!analyze(hk, [N('9', 'dc', '1X')]).error && !!analyze(hk, [N('9', 'btts', 'Y')]).error);
  a = analyze(hk, [N('9', 'win', 'H'), N('9', 'ou', 'O')]);
  const pw = legProb(hk.get(`${D}|nhl|9`), N('9', 'win', 'H'), 'v2'), po = legProb(hk.get(`${D}|nhl|9`), { ...N('9', 'ou', 'O'), line: 6.5 }, 'v2');
  ok('hockey same-game: v2 only, below each leg, with a note', a.sameGame && a.p.v2 > 0 && a.p.v2 < Math.min(pw, po) && a.p.v4 === null && a.p.fb === null && a.notes.some(n => /same game/.test(n)), JSON.stringify([a.p, a.notes]));
  ok('hockey same-game chance is sane against the model\'s own numbers', Math.abs(a.p.v2 - pw * po) < 0.12, JSON.stringify([a.p.v2, pw * po]));
  a = analyze(hk, [N('9', 'win', 'H'), { date: D, league: 'esp.1', id: '1', market: 'win', sel: 'H' }]);
  ok('a hockey pick and a soccer pick multiply in one parlay', Math.abs(a.p.v2 - .55 * .72) < 1e-9 && a.p.v4 === .56 * .68 && a.p.fb === null || Math.abs(a.p.v4 - .56 * .68) < 1e-9, JSON.stringify(a.p));
  a = analyze(hk, [N('11', 'ou', 'O')]);
  ok('a whole-number line adds the push note', a.notes.some(n => /push/.test(n)) && a.legs[0].line === 6);
  // settling
  const sl = (l, final) => { const b = { legs: [{ ...l, res: null }], status: 'pending' }; settle(b, new Map([[`${D}|nhl|9`, H('9', { final })]])); return b; };
  ok('hockey winner settles on the final, overtime counts', sl({ ...N('9', 'win', 'H') }, { h: 4, a: 3, last: 'OT', total: 7 }).status === 'hit' && sl({ ...N('9', 'win', 'A') }, { h: 4, a: 3, last: 'OT', total: 7 }).status === 'miss');
  ok('hockey Over 6.5 settles on the total', sl({ ...N('9', 'ou', 'O'), line: 6.5 }, { h: 4, a: 3, last: 'REG', total: 7 }).status === 'hit' && sl({ ...N('9', 'ou', 'O'), line: 6.5 }, { h: 4, a: 2, last: 'REG', total: 6 }).status === 'miss' && sl({ ...N('9', 'ou', 'U'), line: 6.5 }, { h: 4, a: 2, last: 'REG', total: 6 }).status === 'hit');
  ok('a shootout goal is not in the total (3-2 shootout = 5)', sl({ ...N('9', 'ou', 'O'), line: 5.5 }, { h: 3, a: 2, last: 'SO', total: 4 }).status === 'miss');
  ok('a total exactly on a whole-number line is a push: the pick is void', sl({ ...N('9', 'ou', 'O'), line: 6 }, { h: 4, a: 2, last: 'REG', total: 6 }).status === 'void');
  // stored with the line, settles from the hockey day document
  const kv2 = new Map(), env2 = { HUB: { get: async (k, t) => { const v = kv2.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => kv2.set(k, v) } };
  kv2.set(`nhl:day:${D}`, JSON.stringify({ date: D, cards: [H('9')] }));
  const r = await addBet(env2, [N('9', 'win', 'H'), N('9', 'ou', 'O')]);
  ok('a hockey bet keeps its sport, line and source', r.saved && r.bet.legs[1].line === 6.5 && r.bet.legs[1].src === 'DraftKings' && r.bet.legs[0].sport === 'nhl' && r.bet.legs[1].p.v2 === .52, JSON.stringify(r.bet && r.bet.legs));
  const moved = JSON.parse(kv2.get(`nhl:day:${D}`)); moved.cards[0].ln = { v: 5.5, src: 'DraftKings' }; moved.cards[0].final = { h: 4, a: 3, last: 'OT', total: 7 }; kv2.set(`nhl:day:${D}`, JSON.stringify(moved));
  const lb = (await listBets(env2)).items[0];
  ok('the bet settles from the finished hockey game at the line it was placed on', lb.status === 'hit' && lb.legs.every(x => x.res === 'hit'), JSON.stringify(lb.legs.map(x => x.res)));
}

// suggested parlays: two picks, different games, above 45% together for most models, each pick backed by most models
{
  const A = card('11', 'Alpha', 'Beta', mdl([70, 18, 12], 66, 50, [2.2, 0.8]), mdl([66, 20, 14], 62, 48, [2.0, 0.8]), { p: [68, 20, 12], over: 60, btts: 44 });
  const B = card('12', 'Gamma', 'Delta', mdl([72, 18, 10], 40, 40, [1.9, 0.7]), mdl([70, 20, 10], 42, 41, [1.8, 0.7]), { p: [69, 20, 11], over: 41, btts: 40 });
  const Z = card('13', 'Even', 'Steven', mdl([34, 30, 36], 50, 50, [1.2, 1.2]), mdl([35, 30, 35], 50, 50, [1.2, 1.2]), { p: [35, 30, 35], over: 50, btts: 50 });
  const F = card('14', 'Done', 'Gone', mdl([80, 10, 10], 60, 50, [2.5, .6]), mdl([80, 10, 10], 60, 50, [2.5, .6]), null, { final: { h: 1, a: 0 } });
  const cs = new Map([[`${D}|esp.1|11`, A], [`${D}|esp.1|12`, B], [`${D}|esp.1|13`, Z], [`${D}|esp.1|14`, F]]);
  const s = suggest(cs);
  ok('suggestions pair picks from different games only', s.length > 0 && s.every(x => x.legs[0].id !== x.legs[1].id));
  ok('every suggestion is above 45% for most models', s.every(x => ['v2', 'v4', 'fb'].filter(m => x.p[m] != null && x.p[m] > 0.45).length >= 2));
  ok('finished and coin-flip games are left out, and double chance is never suggested', s.every(x => x.legs.every(l => l.id !== '14' && l.id !== '13' && l.market !== 'dc')));
  ok('a pair is the product of each model\'s two leg numbers', s.every(x => Math.abs(x.p.v2 - x.legs[0].p.v2 * x.legs[1].p.v2) < 1e-9));
  ok('a pick most models put under 50% is never suggested (Over on Gamma-Delta)', s.every(x => !x.legs.some(l => l.id === '12' && l.market === 'ou' && l.sel === 'O')));
  ok('best pair first', s.every((x, i) => i === 0 || (x.p.v2 + x.p.v4 + x.p.fb) <= (s[i - 1].p.v2 + s[i - 1].p.v4 + s[i - 1].p.fb) + 1e-9));
  ok('nothing when no two games qualify', suggest(new Map([[`${D}|esp.1|13`, Z]])).length === 0);
}

// model parlays are tracked apart from your own bets
{
  const kv = new Map(), env = { HUB: { get: async (k, t) => { const v = kv.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => kv.set(k, v) } };
  kv.set(`day:${D}`, JSON.stringify({ date: D, cards: [C1, C2] }));
  const m = await addBet(env, [L('1', 'win', 'H'), L('2', 'btts', 'Y')], new Date(), 'model'), mine = await addBet(env, [L('1', 'win', 'H')]);
  ok('a model parlay is stored with its source, your own bet is not', m.bet.src === 'model' && mine.bet.src === undefined);
  const sm = summary((await listBets(env)).items);
  ok('the summary keeps your bets and model parlays apart', sm.bets.n === 1 && sm.model.bets.n === 1 && sm.model.bets.pending === 1, JSON.stringify(sm.bets) + JSON.stringify(sm.model.bets));
}
console.log(fail ? `\n${fail} bet checks FAILED` : '\nAll bet checks passed');
process.exit(fail ? 1 : 0);
