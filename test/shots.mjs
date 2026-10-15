// Shot tracking: ESPN-shaped finished games with and without shots, through the real syncLeague.
// Proves: shots are stored as a 9th element, zero/missing shots count as "no shots", a game stored
// without shots is backfilled later, old 8-element games stay readable, and coverage counts add up.
import { syncLeague, shotsCoverage, leagueBySlug } from '../src/data.js';

const kv = new Map();
const env = { HUB: {
  get: async (k, t) => { const v = kv.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; },
  put: async (k, v) => { kv.set(k, v); },
} };
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : ' ' + x}`); };

const stat = (shots, sot) => shots == null ? [] : [{ name: 'totalShots', displayValue: String(shots) }, { name: 'shotsOnTarget', value: sot }];
const ev = (id, h, a, hs, as, done, hSh, aSh) => ({ id, date: '2026-10-14T19:00:00Z', competitions: [{
  status: { type: { completed: done } },
  competitors: [
    { homeAway: 'home', team: { id: h[0], displayName: h[1] }, score: String(hs), statistics: stat(...hSh) },
    { homeAway: 'away', team: { id: a[0], displayName: a[1] }, score: String(as), statistics: stat(...aSh) },
  ] }] });

let phase = 1;
globalThis.fetch = async url => {
  if (!String(url).includes('/scoreboard?dates=20261014')) return new Response(JSON.stringify({ events: [] }));
  const evs = [
    ev('1', [1, 'Man City'], [2, 'Paris'], 2, 4, true, [16, 6], [17, 9]),   // full shots
    ev('2', [3, 'Roma'], [4, 'Real Madrid'], 3, 4, true, [0, 0], [0, 0]),   // finished but zero placeholder -> none
    ev('3', [5, 'Como'], [6, 'Feyenoord'], 3, 2, true, [null], [null]),     // no statistics at all -> none
    ev('4', [7, 'Porto'], [8, 'Betis'], 0, 0, false, [0, 0], [0, 0]),       // not played
  ];
  if (phase === 2) evs[1] = ev('2', [3, 'Roma'], [4, 'Real Madrid'], 3, 4, true, [11, 5], [13, 6]); // shots appear later
  return new Response(JSON.stringify({ events: evs }));
};

const league = leagueBySlug('uefa.champions');
const now = new Date('2026-10-15T12:00:00Z');
let r, n = 0; do { r = await syncLeague(league, env, now); n++; } while (!r.caughtUp && n < 12);
let st = JSON.parse(kv.get('res:uefa.champions'));
const g = id => st.games.find(x => x[0] === id);
ok('three finished games stored, the unplayed one is not', st.games.length === 3, JSON.stringify(st.games.map(x => x[0])));
ok('full shots stored as [hShots, hOnTarget, aShots, aOnTarget]', JSON.stringify(g('1')[8]) === '[16,6,17,9]', JSON.stringify(g('1')));
ok('zero placeholder shots count as none', g('2')[8] === null);
ok('missing statistics count as none', g('3')[8] === null);
ok('existing columns unchanged', g('1')[4] === 2 && g('1')[5] === 4 && g('1')[6] === 'Man City' && g('1')[7] === 'Paris');
let c = shotsCoverage(st.games);
ok('coverage: 3 checked, 1 with shots', c.checked === 3 && c.withShots === 1, JSON.stringify(c));

phase = 2; // ESPN fills in shots for game 2 on a later pass
st.through = '2026-10-13T00:00:00.000Z'; kv.set('res:uefa.champions', JSON.stringify(st));
await syncLeague(league, env, now);
st = JSON.parse(kv.get('res:uefa.champions'));
ok('a game stored without shots is backfilled when they appear', JSON.stringify(g('2')[8]) === '[11,5,13,6]' && st.games.length === 3, JSON.stringify(g('2')));
c = shotsCoverage(st.games);
ok('coverage now 2 of 3', c.checked === 3 && c.withShots === 2, JSON.stringify(c));

const old = [['9', 'x', '1', '2', 1, 0, 'A', 'B']]; // stored by an earlier build: 8 elements
ok('old 8-element games are not counted as checked', shotsCoverage(old).checked === 0 && shotsCoverage(undefined).checked === 0);

console.log(fail ? `\n${fail} shot checks FAILED` : '\nAll shot-tracking checks passed');
process.exit(fail ? 1 : 0);
