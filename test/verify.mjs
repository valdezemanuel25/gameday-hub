import { v2, v2Lambdas, grade, pickOutcome } from '../src/model.js';

const pct = x => Math.round(x * 100);
let failures = 0;
const check = (name, got, want) => {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${got}, Hub card says ${want}`);
};

// Arsenal (home) vs Lille (away), card from the Hub, Oct 13.
// Arsenal last 5: scored 7, conceded 5. Lille last 5: scored 7, conceded 4.
const r = v2({ gf: 7, ga: 5, n: 5 }, { gf: 7, ga: 4, n: 5 });
check('Arsenal λ', r.lambda.home.toFixed(2), '1.21');
check('Lille λ', r.lambda.away.toFixed(2), '0.95');
check('Over 2.5 %', pct(r.over25), 37);
check('Under 2.5 %', pct(r.under25), 63);
check('BTTS yes %', pct(r.bttsYes), 43);
check('BTTS no %', pct(r.bttsNo), 57);
check('Top score 1–0', r.topScores[0].score, '1–0');
check('Top score 1–0 %', pct(r.topScores[0].p), 14);
check('2nd score', r.topScores[1].score, '1–1');
check('2nd score %', pct(r.topScores[1].p), 13);
console.log('1X2:', pct(r.home), pct(r.draw), pct(r.away), '(Hub card does not print v2 1X2 in the lines I read)');

// grading sanity
const g = grade(r, { h: 2, a: 1 });
check('grade outcome', g.outcome, 'H');
check('grade over/under hit (3 goals, model says U)', g.ouHit, false);
check('grade BTTS hit (model says N, was Y)', g.bttsHit, false);

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
