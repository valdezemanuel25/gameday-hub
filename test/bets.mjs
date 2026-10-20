// Bet analyzer and tracker: probabilities, parlays, same-game legs, settling and summary.
import { analyze, jointProb, legProb, scoreGrid, settle, summary, addBet, listBets, changeBet, test } from '../src/bets.js';
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
ok('same game, same market twice is refused', !!analyze(cards, [L('1', 'win', 'H'), L('1', 'win', 'A')]).error);
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
console.log(fail ? `\n${fail} bet checks FAILED` : '\nAll bet checks passed');
process.exit(fail ? 1 : 0);
