// The card's "likeliest score that agrees" must match the model's pick, Over 2.5 side and both-score side.
import fs from 'fs';
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const fn = html.match(/function agreeScore\(m\) \{[\s\S]*?\n\}\n/)[0];
const agreeScore = new Function(fn + '; return agreeScore;')();
let fails = 0; const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`); };
const side = (s) => { const [x, y] = s.split('–').map(Number); return { out: x > y ? 'H' : x === y ? 'D' : 'A', over: x + y >= 3, btts: x > 0 && y > 0 }; };
const cases = [
  { lam: [2.0, 0.9], pick: 'H', over: 64, btts: 53 },
  { lam: [1.4, 1.2], pick: 'A', over: 55, btts: 58 },
  { lam: [1.1, 1.0], pick: 'D', over: 40, btts: 45 },
  { lam: [1.6, 1.5], pick: 'D', over: 60, btts: 60 },
  { lam: [2.4, 0.6], pick: 'H', over: 45, btts: 30 },
];
for (const m of cases) {
  const a = agreeScore(m), s = a && side(a.s);
  ok(`${JSON.stringify(m)} -> ${a && a.s} (${a && a.p}%)`, a && s.out === m.pick && s.over === m.over >= 50 && s.btts === m.btts >= 50 && a.p > 0);
}
ok('home win, Over, both-score lean gives a score where both teams score', side(agreeScore(cases[0]).s).btts);
ok('no goals data means no agreeing score', agreeScore({ pick: 'H', over: 50 }) === null);
console.log(fails ? `\n${fails} FAILED` : '\nAll agreeing-score checks passed'); process.exit(fails ? 1 : 0);
