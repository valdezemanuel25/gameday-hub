// Model bets: the headline pick as data, how it is graded, and that the page's copy of the rule matches the server's.
import fs from 'fs';
import { leanPick, leanHit } from '../src/pick.js';
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const grab = n => html.match(new RegExp(`(?:function ${n}\\([^)]*\\) \\{|const ${n} = )[\\s\\S]*?\\n(?:\\}\\n|(?=const |function ))`))[0];
const code = ['esc', 'strip', 'sideOfScore', 'hdaOf', 'leanPick', 'leanHit', 'headline'].map(grab).join('\n');
const page = new Function(`${code}; return { leanPick, leanHit, headline };`)();
let fails = 0; const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`); };
const mk = o => ({ home: 'Club Brugge', away: 'Lens', v2: { pick: 'H', p: [52, 26, 21], over: 66, btts: 58 }, v4: { pick: 'H', p: [60, 20, 20], over: 65, btts: 61 }, fb: { p: [48, 26, 26], over: 64, btts: 56 }, sm: { h: 2, a: 1, text: '2–1' }, ...o });
// Brugge game: all four back Brugge, Over and both-score; the card leads with the most-backed, highest-average pick
{ const l = leanPick(mk({}));
  ok('all four agree: the pick is a Best pick or Lean with everyone backing it', (l.k === 'best' || l.k === 'lean') && l.y === 4 && l.a === 4, JSON.stringify(l));
  ok('the headline picks Over 2.5 (highest average of the all-agree markets)', l.key === 'O', JSON.stringify(l)); }
{ const l = leanPick(mk({ v2: { pick: 'H', p: [40, 30, 30], over: 50, btts: 50 }, v4: { pick: 'A', p: [30, 30, 40], over: 50, btts: 50 }, fb: null, sm: null }));
  ok('a 1-1 split is a Split with v2\'s own pick', l.k === 'split' && l.key === 'H', JSON.stringify(l)); }
{ const l = leanPick(mk({ v4: null, fb: null, sm: null })); ok('v2 alone is solo', l.k === 'solo' && l.a === 1, JSON.stringify(l)); }
ok('no v2, no pick', leanPick({ home: 'a', away: 'b' }) === null);
const F = (h, a) => ({ h, a });
ok('winner and draw are graded on the final score', leanHit('H', F(2, 1)) && !leanHit('H', F(1, 1)) && leanHit('D', F(0, 0)) && leanHit('A', F(0, 1)));
ok('Over 2.5 needs 3 goals, Under 2.5 needs 2 or fewer', leanHit('O', F(2, 1)) && !leanHit('O', F(1, 1)) && leanHit('U', F(1, 1)) && !leanHit('U', F(2, 1)));
ok('both score needs a goal each; not-both is the opposite', leanHit('B', F(1, 1)) && !leanHit('B', F(2, 0)) && leanHit('N', F(2, 0)) && !leanHit('N', F(1, 1)));
// the page's copy gives the same answer and the same headline text as the server's
const cases = [mk({}), mk({ sm: null }), mk({ v4: null, fb: null, sm: null }), mk({ v2: { pick: 'H', p: [40, 30, 30], over: 50, btts: 50 }, v4: { pick: 'A', p: [30, 30, 40], over: 50, btts: 50 }, fb: null, sm: null }),
  mk({ v2: { pick: 'A', p: [20, 17, 63], over: 82, btts: 75 }, v4: { pick: 'H', p: [65, 17, 19], over: 81, btts: 73 }, fb: { p: [58, 20, 22], over: 75, btts: 54 }, sm: { h: 2, a: 1 } }),
  mk({ v2: { pick: 'H', p: [70, 20, 10], over: 35, btts: 30 }, v4: { pick: 'H', p: [68, 20, 12], over: 40, btts: 33 }, fb: { p: [66, 20, 14], over: 38, btts: 36 }, sm: { h: 1, a: 0 } })];
for (const [i, c] of cases.entries()) {
  const a = leanPick(c), b = page.leanPick(c), h = page.headline(c), word = { H: 'Club Brugge to win', D: 'Draw', A: 'Lens to win', O: 'Over 2.5 goals', U: 'Under 2.5 goals', B: 'Both teams score', N: 'Not both teams score' }[a.key], kind = { best: 'Best pick', lean: 'Lean', split: 'Split', solo: null }[a.k];
  ok(`case ${i + 1}: page and server give the same pick`, JSON.stringify(a) === JSON.stringify(b), JSON.stringify([a, b]));
  ok(`case ${i + 1}: the card headline says the same thing`, h.includes(`<b>${word}</b>`) && (kind == null || h.includes(`>${kind}<`)), h);
}
console.log(fails ? `\n${fails} FAILED` : '\nAll pick checks passed'); process.exit(fails ? 1 : 0);
