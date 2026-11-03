// Shots Over (src/shots.js, rule 'shotsOver' in src/analyst.js): club shots form before kickoff, the game's numbers, the read on Over 2.5,
// the rule at the lineup read, and shots carried from the results store into each club's recent games (src/data.js buildContext).
import { shotsAt, matchup, shotsOver, SHOTS, LEAGUES } from '../src/shots.js';
import { RULES, view, decide } from '../src/analyst.js';
import { buildContext } from '../src/data.js';
let bad = 0; const ok = (n, c, x = '') => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (c ? '' : ' ' + x)); if (!c) bad++; };
const day = i => new Date(Date.UTC(2026, 8, 1 + 7 * i)).toISOString();
const team = (rows) => ({ recent: rows });
const row = (i, gf, ga, sh, sot, sha, sota) => [day(i), gf, ga, sh, sot, sha, sota];

// --- club form ---
const T = team([0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => row(i, 2, 1, 10, 5, 12, 3)));
const f = shotsAt(T, day(9));
ok('shotsAt: averages the last 8 games before kickoff', f && f.n === 8 && f.shF === 10 && f.sotF === 5 && f.shA === 12 && f.sotA === 3 && f.gf === 2, JSON.stringify(f));
ok('shotsAt: only games before kickoff (kickoff on game 6\'s date: games 0-5)', shotsAt(T, day(6)).n === 6);
ok('shotsAt: rows without shots are skipped; fewer than 5 with shots gives nothing', shotsAt(team([...[0, 1, 2, 3].map(i => row(i, 1, 1, 9, 3, 9, 3)), [day(4), 1, 0], [day(5), 2, 2]]), day(9)) === null);
const M = matchup(f, f);
ok('matchup: home attack v away defence plus away attack v home defence', M.sot === 8 && M.sh === 22 && M.gl === 3 && M.n === 8, JSON.stringify(M));

// --- the read ---
const avg = { sot: SHOTS.mean.sot, gl: SHOTS.mean.gl, sh: SHOTS.mean.sh };
ok('shotsOver: an average game stays near the price', Math.abs(shotsOver(55, avg) - 55) < 3, shotsOver(55, avg));
ok('shotsOver: fewer total shots (same on target) reads higher', shotsOver(55, { ...avg, sh: 21 }) > shotsOver(55, avg) + 3);
ok('shotsOver: tested leagues only', LEAGUES.has('eng.1') && !LEAGUES.has('usa.1') && !LEAGUES.has('mex.1'));

// --- the rule ---
const rule = RULES.find(r => r.id === 'shotsOver');
const odds = { op: { h: 150, d: 230, a: 190 }, h: 150, d: 230, a: 190, tl: 2.5, to: -135, tu: 110 };
const V = sx => view({ v4: { p: [40, 30, 30], over: 55, btts: 55 }, open: odds.op, now: odds, sx });
ok('shotsOver: bets Over at DraftKings\' price when the read is 3+ above it', (b => b && b.key === 'O' && b.price === -135 && /shots read/.test(b.why))(rule.pick(V({ sot: 8.4, gl: 3, sh: 21 }))));
ok('shotsOver: no bet on an average game', rule.pick(V(avg)) === null);
ok('shotsOver: no bet without shots numbers', rule.pick(V(null)) === null);
const KO = '2026-11-08T15:00:00Z', at = m => new Date(new Date(KO).getTime() - m * 60000);
const card = { id: 's1', league: 'eng.1', leagueName: 'Premier League', home: 'A', away: 'B', kickoff: KO, v2: { over: 55 }, v4: { p: [40, 30, 30], over: 55, btts: 55 }, odds, sx: { sot: 8.4, gl: 3, sh: 21, n: 8 } };
ok('shotsOver: waits for the lineup read', !decide([], [card], '2026-11-08', at(240)).some(b => b.rule === 'shotsOver'));
ok('shotsOver: Analyst 2 bets it at the lineup read', (b => b && b.key === 'O' && b.price === -135)(decide([], [card], '2026-11-08', at(30)).find(b => b.rule === 'shotsOver')));

// --- shots into the clubs' recent games ---
{
  const m = new Map(), env = { HUB: { get: async (k, t) => { const x = m.get(k); return x == null ? null : t === 'json' ? JSON.parse(x) : x; }, put: async (k, x) => { m.set(k, x); } } };
  const games = [0, 1, 2, 3, 4, 5].map(i => [`g${i}`, day(i), '1', '2', 2, 1, 'Home FC', 'Away FC', i === 5 ? null : [12, 6, 8, 2]]);
  m.set('res:eng.1', JSON.stringify({ v: 1, through: day(6), games }));
  m.set('std3:eng.1:2026', JSON.stringify({})); m.set('std3:eng.1:2025', JSON.stringify({}));
  const ctx = await buildContext({ slug: 'eng.1' }, env, new Date(day(6)));
  const h = ctx && ctx.teams['1'], a = ctx && ctx.teams['2'];
  ok('buildContext: shots kept on each club\'s recent games, the right way round; a game without shots stays plain',
    h && a && h.recent[0].join() === [day(0), 2, 1, 12, 6, 8, 2].join() && a.recent[0].join() === [day(0), 1, 2, 8, 2, 12, 6].join() && h.recent[5].length === 3, JSON.stringify(h && h.recent));
}
console.log(bad ? `\n${bad} FAILED` : '\nAll Shots Over checks passed');
if (bad) process.exit(1);
