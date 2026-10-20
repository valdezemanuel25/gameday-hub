// Results tab: the side-by-side hit-rate table (v2, v4, Forebet) is built from graded cards.
import worker from '../src/worker.js';
import { grade } from '../src/model.js';

const kv = new Map();
const env = { ADMIN_TOKEN: 's', ASSETS: { fetch: () => new Response('a') }, HUB: {
  get: async (k, t) => { const v = kv.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => { kv.set(k, v); },
  list: async ({ prefix }) => ({ keys: [...kv.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }) } };
const toPred = s => ({ home: s.p[0] / 100, draw: s.p[1] / 100, away: s.p[2] / 100, over25: s.over / 100, bttsYes: s.btts / 100 });
const card = (id, v2, v4, fb, fin) => { const c = { id, league: 'uefa.europa', home: 'A' + id, away: 'B' + id, kickoff: '2026-10-15T16:45:00Z', final: fin, v2, v4, fb };
  c.grade = { v2: grade(toPred(v2), fin), v4: grade(toPred(v4), fin) }; return c; };
const m = (p, pick, over, btts) => ({ p, pick, over, btts, scores: [['1–0', 10]], lam: [1, 1] });
kv.set('day:2026-10-15', JSON.stringify({ date: '2026-10-15', analyzed: {}, cards: [
  card('1', m([60, 20, 20], 'H', 60, 60), m([40, 30, 30], 'H', 40, 40), { p: [50, 25, 25], over: 60, btts: 60, at: 'x', how: 'x' }, { h: 2, a: 1 }),   // all three right on winner, over, btts
  card('2', m([60, 20, 20], 'H', 60, 60), m([20, 30, 50], 'A', 40, 40), { p: [20, 30, 50], over: 40, btts: 40, at: 'x', how: 'x' }, { h: 0, a: 0 }), // v2 wrong winner; v4 wrong winner (draw); fb wrong winner
  card('3', m([60, 20, 20], 'H', 60, 60), m([40, 30, 30], 'H', 40, 40), null, { h: 1, a: 0 }),
  card('4', m([60, 20, 20], 'H', 60, 60), { ...m([40, 30, 30], 'H', 40, 40), promo: true }, { p: [50, 25, 25], over: 60, btts: 60, at: 'x', how: 'x' }, { h: 2, a: 1 }), // v4 on a newly promoted club: own line only                                                      // no Forebet: not in the same-games table
] }));
const t = await (await worker.fetch(new Request('https://x/api/tally', { headers: { 'x-admin-token': 's' } }), env)).json();
let fail = 0;
const ok = (n, c) => { console.log((c ? 'PASS  ' : 'FAIL  ') + n); if (!c) fail++; };
const S = t.board.same;
ok('same games = only games all three models have', S.n === 2);
ok('winner: each model got 1 of the 2 same games', ['v2', 'v4', 'fb'].every(k => S.models[k].outcome.join('/') === '1/2'));
ok('over/under and both-score counts match the cards', S.models.v2.ou[1] === 2 && S.models.fb.ou[1] === 2 && S.models.fb.btts[1] === 2);
ok('brier is a number for each model on the same games', ['v2', 'v4', 'fb'].every(k => typeof S.models[k].brier === 'number'));
ok('all-games view counts Forebet on its own games', t.board.all.models.fb.outcome[1] === 3 && t.board.all.models.v4.outcome[1] === 3);
ok('a promoted-club v4 game stays out of every v4 total', S.n === 2 && t.v4.n === 3 && t.h2h.v4.n === 3 && t.last30.v4.n === 3);
ok('it is counted on its own line, with v2 on the same game', t.promo.v4.n === 1 && t.promo.v2.n === 1 && t.promo.v4.outcome === 1);
console.log(fail ? `\n${fail} board checks FAILED` : '\nAll Results board checks passed');
process.exit(fail ? 1 : 0);
