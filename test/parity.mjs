// Parity check: the standalone v2 model vs. every readable v2 card in the OLD Hub.
// test/hub-cards.json holds the inputs (last-5 goals for/against) and the numbers the Hub printed
// for 120 cards: expected goals, win/draw/loss, over 2.5, BTTS, top two scores.
import fs from 'fs';
import { v2 } from '../src/model.js';

const cards = JSON.parse(fs.readFileSync(new URL('./hub-cards.json', import.meta.url)));
const R = x => Math.round(x * 100);
const f = { lam: 0, x12: 0, x12within1: 0, over: 0, btts: 0, scores: 0, all: 0 };
const bad = [];
for (const c of cards) {
  const r = v2({ gf: c.gf[0][0], ga: c.gf[0][1], n: 5 }, { gf: c.gf[1][0], ga: c.gf[1][1], n: 5 });
  const lam = +r.lambda.home.toFixed(2) === c.ls[0] && +r.lambda.away.toFixed(2) === c.ls[1];
  const mine = [R(r.home), R(r.draw), R(r.away)];
  const x12 = mine.every((v, i) => v === c.segs[i]);
  const x12w = mine.every((v, i) => Math.abs(v - c.segs[i]) <= 1); // the Hub nudged bar widths to total 100
  const over = R(r.over25) === c.over, btts = R(r.bttsYes) === c.btts;
  const scores = r.topScores[0].score === c.s1 && R(r.topScores[0].p) === c.p1 && r.topScores[1].score === c.s2 && R(r.topScores[1].p) === c.p2;
  f.lam += lam; f.x12 += x12; f.x12within1 += x12w; f.over += over; f.btts += btts; f.scores += scores;
  if (lam && x12w && over && btts && scores) f.all++; else bad.push(c.fx);
}
console.log(`Compared ${cards.length} Hub cards:`, f);
const ok = f.all === cards.length;
console.log(ok ? 'PASS  every card matches (win/draw/loss within the Hub\'s ±1 bar rounding)' : 'FAIL  mismatches: ' + bad.join(', '));
process.exit(ok ? 0 : 1);
