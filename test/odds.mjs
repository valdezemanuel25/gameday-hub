import { parseOdds } from '../src/data.js';
import { priceFor, unitsWon, needP, verdictOf, bandOf } from '../src/pick.js';
let bad = 0; const ok = (n, c) => { console.log((c ? 'PASS  ' : 'FAIL  ') + n); if (!c) bad++; };
const a = parseOdds([{ provider: { name: 'DraftKings' }, moneyline: { home: { close: { odds: '-150' } }, draw: { close: { odds: '+280' } }, away: { close: { odds: '+400' } } }, total: { over: { close: { line: 'o2.5', odds: '-120' } }, under: { close: { line: 'u2.5', odds: '+100' } } } }]);
ok('moneyline and 2.5 total read from the new block', a && a.h === -150 && a.d === 280 && a.a === 400 && a.over === -120 && a.under === 100);
const b = parseOdds([{ homeTeamOdds: { moneyLine: -200 }, drawOdds: { moneyLine: 300 }, awayTeamOdds: { moneyLine: 550 }, overUnder: 3.5 }]);
ok('old block: moneylines read, a 3.5 total is ignored', b && b.h === -200 && b.d === 300 && b.a === 550 && b.over === undefined);
ok('EVEN is +100', parseOdds([{ moneyline: { home: { close: { odds: 'EVEN' } } } }]).h === 100);
ok('no odds -> null', parseOdds([]) === null && parseOdds(undefined) === null && parseOdds([{ details: 'x' }]) === null);
ok('junk prices ignored', parseOdds([{ moneyline: { home: { close: { odds: 'abc' } } } }]) === null);
ok('priceFor maps the pick key', priceFor(a, 'H') === -150 && priceFor(a, 'O') === -120 && priceFor(a, 'B') === null && priceFor(null, 'H') === null);
ok('units: a -200 hit wins 0.5, a miss loses 1, a +150 hit wins 1.5', unitsWon(-200, true) === 0.5 && unitsWon(-200, false) === -1 && unitsWon(150, true) === 1.5);
ok('break-even: -500 needs 83%, -110 needs 52%, +150 needs 40%', Math.round(needP(-500)) === 83 && Math.round(needP(-110)) === 52 && Math.round(needP(150)) === 40);
ok('tags: 70% at -500 not worth it, 80% at -500 only fair, 60% at +100 value, 52% at -110 fair', verdictOf(70, -500) === 'no' && verdictOf(80, -500) === 'fair' && verdictOf(60, 100) === 'val' && verdictOf(52, -110) === 'fair' && verdictOf(null, -110) === null);
ok('bands: -500 and -300 short, -200 and -150 next, -110 and +140 middle, +150 long', bandOf(-500) === 'b1' && bandOf(-300) === 'b1' && bandOf(-200) === 'b2' && bandOf(-150) === 'b2' && bandOf(-110) === 'b3' && bandOf(140) === 'b3' && bandOf(150) === 'b4');
{ // prices are attached to cards already analyzed, only before kickoff, with no write when nothing changed
  const { oddsStep } = await import('../src/worker.js');
  const now = new Date('2026-10-24T15:00:00Z'), kv = new Map(), writes = [];
  const date = '2026-10-24', soon = '2026-10-24T20:00:00Z', started = '2026-10-24T14:00:00Z';
  kv.set('day:' + date, JSON.stringify({ date, cards: [
    { id: '1', league: 'eng.1', kickoff: soon, home: 'A', away: 'B', v2: {} }, { id: '2', league: 'eng.1', kickoff: started, home: 'C', away: 'D', v2: {} }, { id: '3', league: 'eng.2', kickoff: soon, home: 'E', away: 'F', v2: {} }] }));
  const env = { HUB: { get: async (k, t) => { const v = kv.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => { kv.set(k, v); writes.push(k); } } };
  const ev = (id, iso, odds) => ({ id, date: iso, competitions: [{ status: { type: { completed: false } }, competitors: [{ homeAway: 'home', team: { id: id + 'h', displayName: 'H' + id } }, { homeAway: 'away', team: { id: id + 'a', displayName: 'A' + id } }], odds }] });
  const board = [ev('1', soon, [{ moneyline: { home: { close: { odds: '-300' } }, draw: { close: { odds: '+400' } }, away: { close: { odds: '+800' } } } }]), ev('2', started, [{ moneyline: { home: { close: { odds: '-110' } } } }])];
  const realFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return { ok: true, json: async () => ({ events: board }) }; };
  const seen = new Set(), cache = { match: async r => seen.has(r.url) ? new Response('1') : undefined, put: async (r) => { seen.add(r.url); } };
  const r1 = await oddsStep(env, now, cache), day = JSON.parse(kv.get('day:' + date));
  ok('price attached to the game that has not started', r1 && r1.changed === 1 && day.cards[0].odds && day.cards[0].odds.h === -300 && day.cards[0].odds.a === 800);
  ok('a game that already started is left alone', !day.cards[1].odds);
  ok('a second division is not touched', !day.cards[2].odds);
  const w0 = writes.length, c0 = calls, r2 = await oddsStep(env, now, cache);
  ok('the same league is not looked at again for hours, and nothing is written', calls === c0 && writes.length === w0 && !(r2 && r2.league === 'eng.1'));
  seen.clear(); const r3 = await oddsStep(env, now, cache);
  ok('an unchanged price writes nothing', r3 && r3.changed === 0 && writes.length === w0);
  globalThis.fetch = realFetch;
}
process.exit(bad ? 1 : 0);
