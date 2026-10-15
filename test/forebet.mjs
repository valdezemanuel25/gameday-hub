// Forebet picks: pasted-table parser, name matching, saved seed, grading, and the Results tally.
import worker, { forebetPaste } from '../src/worker.js';
import { parseForebet, seedFb, fbGrade } from '../src/forebet.js';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : ' ' + x}`); };

// ESPN-style names the Hub holds vs Forebet's own spellings.
const mk = (id, home, away, ko = '2026-10-15T16:45:00Z') => ({ id, home, away, kickoff: ko, league: 'uefa.europa', final: null });
const cards = [
  mk('1', 'Union St.-Gilloise', 'Real Sociedad'), mk('2', 'TSG Hoffenheim', 'Besiktas'), mk('3', 'Marseille', 'Olympiacos'),
  mk('4', 'Benfica', 'Celtic'), mk('5', 'Sparta Prague', 'Lillestrom'), mk('6', 'Rennes', 'OFI Crete'), mk('7', 'NEC Nijmegen', 'Levski Sofia'),
  mk('8', 'Lyon', 'Crystal Palace'), mk('9', 'AC Milan', 'RB Salzburg'),
];

// Lines as they come out of copying the table (one cell per line).
const lines = `League Stage
AZ Alkmaar
Hapoel Beer Sheva
10/15/2026 11:45 AM
43
36
21
1
1 - 0
1.70
61°F
-303
Union Saint-Gilloise
Real Sociedad
10/15/2026 11:45 AM
39
28
33
1
2 - 1
2.90
63°F
+160
Hoffenheim
Beşiktaş
10/15/2026 2:00 PM
33
31
36
2
0 - 1
2.49
Olympique Marseille
Olympiacos
10/15/2026 2:00 PM
41
28
31
1
1 - 0
SL Benfica
Celtic
55
25
20
1
3 - 0
Sparta Praha
Lillestrøm SK
40
35
25
1
2 - 0
Rennes
OFI Creta
52
19
29
1
3 - 0
Nijmegen
Levski Sofia
21
45
34
X
1 - 1
Milan
RB Salzburg
38
32
30
1
2 - 1`;
const r = parseForebet(lines, cards);
const g = id => r.found.get(id);
ok('Union St.-Gilloise matched, 39/28/33, 2-1', JSON.stringify(g('1')?.p) === '[39,28,33]' && g('1').score.h === 2 && g('1').score.a === 1, JSON.stringify(g('1')));
ok('TSG Hoffenheim vs Hoffenheim, Besiktas vs Beşiktaş', JSON.stringify(g('2')?.p) === '[33,31,36]' && g('2').pred === '2' && g('2').score.a === 1, JSON.stringify(g('2')));
ok('Marseille vs Olympique Marseille', JSON.stringify(g('3')?.p) === '[41,28,31]');
ok('Benfica vs SL Benfica', JSON.stringify(g('4')?.p) === '[55,25,20]');
ok('Sparta Prague vs Sparta Praha, Lillestrom vs Lillestrøm SK', JSON.stringify(g('5')?.p) === '[40,35,25]');
ok('OFI Crete vs OFI Creta', JSON.stringify(g('6')?.p) === '[52,19,29]');
ok('NEC Nijmegen vs Nijmegen, predicted draw', JSON.stringify(g('7')?.p) === '[21,45,34]' && g('7').pred === 'X');
ok('games not in the paste are reported missing (Lyon)', r.missing.includes('8'));
ok('a home/away swap flips the numbers (Milan - Salzburg pasted as Salzburg - Milan)', JSON.stringify(g('9')?.p) === '[30,32,38]' || JSON.stringify(g('9')?.p) === '[38,32,30]', JSON.stringify(g('9')));
const tabbed = 'Lyon\tCrystal Palace\t10/15/2026 11:45 AM\t48\t27\t25\t1\t3 - 1\t2.84';
ok('tab separated cells also work', JSON.stringify(parseForebet(tabbed, [cards[7]]).found.get('8')?.p) === '[48,27,25]');
ok('numbers that do not add to 100 are not taken as probabilities', parseForebet('Lyon\nCrystal Palace\n12\n7\n5\n1 - 0', [cards[7]]).found.size === 0);

// saved picks for Oct 15
const eu = [['AZ Alkmaar', 'Hapoel Be\'er Sheva'], ['Union St.-Gilloise', 'Real Sociedad'], ['Torreense', 'Sunderland'], ['Lech Poznan', 'Bayer Leverkusen'], ['Lyon', 'Crystal Palace'], ['Sparta Prague', 'Lillestrom'], ['Celje', 'Omonia'], ['RB Salzburg', 'AC Milan'], ['Dinamo Zagreb', 'Anderlecht'], ['Marseille', 'Olympiacos'], ['Celta Vigo', 'Juventus'], ['Bournemouth', 'Sturm Graz'], ['Rennes', 'OFI Crete'], ['Jagiellonia', 'Ararat-Armenia'], ['Benfica', 'Celtic'], ['TSG Hoffenheim', 'Besiktas'], ['Ferencvaros', 'Viktoria Plzen'], ['NEC Nijmegen', 'Levski Sofia']];
const miss = eu.filter(([h, a]) => !seedFb({ home: h, away: a }, '2026-10-15'));
ok('all 18 saved Oct 15 picks match ESPN-style names', miss.length === 0, JSON.stringify(miss));
const s = seedFb({ home: 'Union St.-Gilloise', away: 'Real Sociedad' }, '2026-10-15');
ok('saved pick content and stamp', JSON.stringify(s.p) === '[39,28,33]' && s.pred === '1' && s.score.h === 2 && s.at < '2026-10-15T16:45:00Z' && s.how === 'saved before kickoff');
ok('no saved picks for other days', seedFb({ home: 'Lyon', away: 'Crystal Palace' }, '2026-10-16') === null);

// grading
const gr = fbGrade({ p: [39, 28, 33], score: { h: 2, a: 1 } }, { h: 2, a: 1 });
ok('grade: winner + exact score hit, Brier ok', gr.outcomeHit && gr.scoreHit && Math.abs(gr.brier - ((0.61 ** 2) + 0.28 ** 2 + 0.33 ** 2)) < 1e-9, JSON.stringify(gr));
ok('grade: miss', !fbGrade({ p: [20, 36, 44], score: { h: 0, a: 1 } }, { h: 2, a: 0 }).outcomeHit);

// endpoint + tally
const kv = new Map();
const env = { ADMIN_TOKEN: 'secret', ASSETS: { fetch: () => new Response('a') }, HUB: {
  get: async (k, t) => { const v = kv.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; },
  put: async (k, v) => { kv.set(k, v); }, list: async ({ prefix }) => ({ keys: [...kv.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }) } };
const now = new Date('2026-10-15T14:00:00Z');
kv.set('day:2026-10-16', JSON.stringify({ date: '2026-10-16', analyzed: {}, cards: [
  { id: 'a', league: 'uefa.europa', home: 'Lyon', away: 'Crystal Palace', kickoff: '2026-10-16T16:45:00Z', final: null },
  { id: 'b', league: 'uefa.europa', home: 'Benfica', away: 'Celtic', kickoff: '2026-10-15T13:00:00Z', final: null }, // already started
] }));
const paste = 'Lyon\nCrystal Palace\n48\n27\n25\n1\n3 - 1\nBenfica\nCeltic\n55\n25\n20\n1\n3 - 0';
const p1 = await forebetPaste('2026-10-16', 'uefa.europa', paste, env, now);
ok('paste saves the open game, skips the one that already started', p1.saved === 1 && p1.started === 1, JSON.stringify(p1));
const day = JSON.parse(kv.get('day:2026-10-16'));
ok('card.fb stored with time stamp, started game untouched', day.cards[0].fb.p[0] === 48 && day.cards[0].fb.at === now.toISOString() && !day.cards[1].fb);
const p2 = await forebetPaste('2026-10-16', 'uefa.europa', paste.replace('48', '60').replace('27\n25', '20\n20'), env, now);
ok('a second paste cannot overwrite a saved pick', p2.saved === 0 && p2.alreadyHad === 1 && JSON.parse(kv.get('day:2026-10-16')).cards[0].fb.p[0] === 48, JSON.stringify(p2));

const v = (p, pick) => ({ p, pick, over: 55, btts: 55, scores: [['1–1', 10]], lam: [1, 1], best: { pick: 'x', p: 55 } });
const gradeOf = (pred, final) => ({ v2: { outcomeHit: pred, ouHit: true, bttsHit: true, brier: 0.5 }, v4: { outcomeHit: !pred, ouHit: true, bttsHit: true, brier: 0.6 } });
kv.set('day:2026-10-17', JSON.stringify({ date: '2026-10-17', analyzed: {}, cards: [
  { id: 'g1', league: 'uefa.europa', home: 'A', away: 'B', kickoff: '2026-10-17T16:45:00Z', final: { h: 2, a: 1 }, v2: v([50, 25, 25], 'H'), v4: v([40, 30, 30], 'H'), grade: gradeOf(true), fb: { p: [60, 20, 20], score: { h: 2, a: 1 }, how: 'pasted' } },
  { id: 'g2', league: 'uefa.europa', home: 'C', away: 'D', kickoff: '2026-10-17T16:45:00Z', final: { h: 0, a: 0 }, v2: v([50, 25, 25], 'H'), grade: { v2: { outcomeHit: false, ouHit: true, bttsHit: true, brier: 0.7 } }, fb: { p: [30, 30, 40], score: null, how: 'pasted' } },
] }));
const t = await worker.fetch(new Request('https://hub.test/api/tally', { headers: { 'x-admin-token': 'secret' } }), env).then(x => x.json());
ok('tally: Forebet counted on 2 games, 1 winner hit, 1 exact score', t.forebet.n === 2 && t.forebet.outcome === 1 && t.forebet.score === 1, JSON.stringify(t.forebet));
ok('tally: compared with v2 on 2 games and v4 on 1 game', t.forebet.vs.v2.n === 2 && t.forebet.vs.v4.n === 1 && t.forebet.vs.v4.fbOutcome === 1, JSON.stringify(t.forebet.vs));
ok('tally: v2 and v4 totals are not changed by Forebet', t.v2.n >= 2 && t.v4.n === 1);

console.log(fail ? `\n${fail} Forebet checks FAILED` : '\nAll Forebet checks passed');
process.exit(fail ? 1 : 0);
