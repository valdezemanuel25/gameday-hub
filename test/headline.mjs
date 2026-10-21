// The card's headline follows the majority of the models, not v2 alone.
import fs from 'fs';
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const grab = n => html.match(new RegExp(`(?:function ${n}\\([^)]*\\) \\{|const ${n} = )[\\s\\S]*?\\n(?:\\}\\n|(?=const |function ))`))[0];
const code = ['esc', 'strip', 'sideOfScore', 'goalsCons', 'headline'].map(grab).join('\n');
const api = new Function(`${code}; return { headline, goalsCons };`)();
let fails = 0; const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`); };
const mk = o => ({ home: 'Lille', away: 'Galatasaray', v2: { pick: 'H', p: [52, 26, 21], over: 41, btts: 43 }, v4: { pick: 'H', p: [60, 20, 20], over: 65, btts: 61 }, fb: { p: [48, 26, 26], over: 64, btts: 63, score: { h: 3, a: 1 } }, sm: { h: 2, a: 1, text: 'x' }, ...o });
{ const c = mk({}); const h = api.headline(c), g = api.goalsCons(c).join(' | ');
  ok('Lille game: majority says Over, so the card leads with Over 2.5', /Over 2\.5 goals|Lille to win/.test(h), h);
  ok('all 4 agree on Lille but only about 53%: a Lean, not a Best pick', /Lean/.test(h) && /All 4 models agree/.test(h), h);
  ok('goals chip counts SportsMole: 3 of 4 say Over', /3 of 4 say Over 2\.5/.test(g), g); }
{ const c = mk({ v2: { pick: 'H', p: [52, 26, 21], over: 41, btts: 43 }, v4: { pick: 'A', p: [20, 30, 50], over: 65, btts: 61 }, fb: { p: [30, 30, 40], over: 64, btts: 63 }, sm: { h: 2, a: 1, text: 'x' } });
  const h = api.headline(c); ok('Over has 3 of 4 backers and leads', /Over 2\.5 goals/.test(h) && /3 of 4 back it/.test(h) && /v2 disagrees/.test(h), h); }
{ const c = mk({ v2: { pick: 'H', p: [60, 20, 20], over: 70, btts: 60 }, v4: { pick: 'H', p: [62, 20, 18], over: 72, btts: 65 }, fb: { p: [58, 22, 20], over: 68, btts: 61 }, sm: { h: 2, a: 1, text: 'x' } });
  const h = api.headline(c); ok('everyone agrees: Best pick, all models agree', /Best pick/.test(h) && /All 4 models agree/.test(h), h); }
{ const c = mk({ v2: { pick: 'H', p: [40, 30, 30], over: 50, btts: 50 }, v4: { pick: 'A', p: [30, 30, 40], over: 50, btts: 50 }, fb: null, sm: null });
  const h = api.headline(c); ok('a 1-1 split has no majority: Split', /Split/.test(h) && /no majority/.test(h), h); }
{ const c = mk({ v4: null, fb: null, sm: null }); const h = api.headline(c); ok('v2 alone keeps its own strongest pick', /xhl/.test(h) && !/Split|models agree/.test(h), h); }
console.log(fails ? `\n${fails} FAILED` : '\nAll headline checks passed'); process.exit(fails ? 1 : 0);
