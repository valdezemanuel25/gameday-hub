// Model bets: the headline pick as data, how it is graded, and that the page's copy of the rule matches the server's.
import fs from 'fs';
import { leanPick, leanHit, hockeyPick, hockeyHit } from '../src/pick.js';
import { gradeCard } from '../src/nhl.js';
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

// ---- hockey ----
const nhlHtml = fs.readFileSync(new URL('../public/nhl.html', import.meta.url), 'utf8');
const grabN = n => nhlHtml.match(new RegExp(`(?:function ${n}\\([^)]*\\) \\{|const ${n} = )[\\s\\S]*?\\n(?:\\}\\n|(?=const |function ))`))[0];
const hpage = new Function(`${['hockeyPick', 'hockeyHit'].map(grabN).join('\n')}; return { hockeyPick, hockeyHit };`)();
const hk = (o = {}) => ({ id: 'h1', home: 'Calgary Flames', away: 'Minnesota Wild', hAbbr: 'CGY', aAbbr: 'MIN', ln: { v: 5.5, src: 'DraftKings' }, v2: { w: 40, o: 40 }, v4: { w: 42, o: 44 }, fb: { pick: 'A', p: [43, 57], score: { h: 2, a: 3 } }, ...o });
{ const l = hockeyPick(hk());
  ok('hockey: all three back the away team and the Under: a Best pick', l.k === 'best' && l.a === 3 && l.y === 3 && (l.key === 'A' || l.key === 'U'), JSON.stringify(l));
  const u = hockeyPick(hk({ v2: { w: 40, o: 40 }, v4: { w: 55, o: 50 }, fb: { pick: 'A', p: [43, 57], score: { h: 4, a: 3 } } }));
  ok('hockey: 2 of 3 on the winner is a Lean', u.k === 'lean' && u.y === 2 && u.a === 3 && u.key === 'A', JSON.stringify(u));
  const o = hockeyPick(hk({ v2: { w: 55, o: 60 }, v4: { w: 45, o: 58 }, fb: { pick: 'H', p: [52, 48], score: { h: 4, a: 3 } } }));
  ok('hockey: Over at the card line carries the line', o.key === 'O' && o.line === 5.5 && o.k === 'best', JSON.stringify(o));
  const nl = hockeyPick(hk({ ln: null, v2: { w: 60, o: 70 }, v4: { w: 58, o: 70 }, fb: { pick: 'H', p: [57, 43], score: { h: 5, a: 4 } } }));
  ok('hockey: with no sportsbook line only the winner can be picked', nl.key === 'H' && nl.line === undefined, JSON.stringify(nl));
  const sp = hockeyPick(hk({ v2: { w: 60, o: 50 }, v4: { w: 40, o: 50 }, fb: null }));
  ok('hockey: 1-1 is a Split with v2\'s own side', sp.k === 'split' && sp.key === 'H', JSON.stringify(sp));
  ok('hockey: v2 alone is solo', hockeyPick(hk({ v4: null, fb: null, ln: null })).k === 'solo');
  ok('hockey: skipped or v2-less cards get no pick', hockeyPick(hk({ skipped: 'x' })) === null && hockeyPick(hk({ v2: null })) === null);
  ok('hockey: a total exactly on the line casts no Forebet vote', hockeyPick(hk({ ln: { v: 5 }, fb: { pick: 'A', p: [43, 57], score: { h: 3, a: 2 } } })).a >= 2);
}
ok('hockey: winners count overtime, no draws', hockeyHit('H', { h: 4, a: 3, total: 7 }, 5.5) === true && hockeyHit('A', { h: 4, a: 3, total: 7 }, 5.5) === false);
ok('hockey: Over/Under at the line, and a push has no result', hockeyHit('O', { h: 4, a: 3, total: 7 }, 5.5) === true && hockeyHit('U', { h: 4, a: 3, total: 7 }, 6.5) === false && hockeyHit('O', { h: 4, a: 2, total: 6 }, 6) === null);
for (const [i, c] of [hk(), hk({ ln: null }), hk({ v2: { w: 55, o: 60 }, v4: { w: 45, o: 58 }, fb: { pick: 'H', p: [52, 48], score: { h: 4, a: 3 } } }), hk({ v4: null, fb: null }), hk({ v2: { w: 60, o: 50 }, v4: { w: 40, o: 50 }, fb: null })].entries())
  ok(`hockey case ${i + 1}: page and server give the same pick`, JSON.stringify(hockeyPick(c)) === JSON.stringify(hpage.hockeyPick(c)), JSON.stringify([hockeyPick(c), hpage.hockeyPick(c)]));
{ const c = hk({ final: { h: 2, a: 4, last: 'REG', total: 6 } }); gradeCard(c);
  ok('grading a hockey card locks its pick and scores it', c.lean && c.lean.hit === true && c.lean.k === 'best', JSON.stringify(c.lean));
  const before = JSON.stringify(c.lean); c.ln = { v: 9, src: 'x' }; c.final = { h: 5, a: 0, last: 'REG', total: 5 }; gradeCard(c);
  ok('regrading never changes the locked pick', JSON.stringify(c.lean) === before); }
console.log(fails ? `\n${fails} FAILED` : '\nAll pick checks passed'); process.exit(fails ? 1 : 0);
