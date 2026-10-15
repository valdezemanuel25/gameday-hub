// Forebet picks, entered by hand (pasted from the league page) and only RECORDED + GRADED.
// Nothing here is read by v2, v4 or any model. card.fb = { p:[home,draw,away] percent, score:{h,a}|null, pred:'1'|'X'|'2'|null, at, how }
import { norm, sameTeam } from './sportsmole.js';
import seed from './fbseed.js';

const is = (a, b) => sameTeam(norm(a), norm(b));
const INT = /^\d{1,3}$/, SCORE = /^(\d{1,2})\s*[-–]\s*(\d{1,2})$/;

// Read the probabilities and predicted score that follow "home ... away" in a pasted Forebet table.
function readAfter(tok, from) {
  for (let i = from; i < Math.min(tok.length - 2, from + 14); i++) {
    if (!(INT.test(tok[i]) && INT.test(tok[i + 1]) && INT.test(tok[i + 2]))) continue;
    const p = [+tok[i], +tok[i + 1], +tok[i + 2]], sum = p[0] + p[1] + p[2];
    if (sum < 97 || sum > 103) continue;
    let pred = null, score = null;
    for (let j = i + 3; j < Math.min(tok.length, i + 8); j++) {
      if (!pred && /^[1X2]$/i.test(tok[j])) pred = tok[j].toUpperCase();
      const m = SCORE.exec(tok[j]); if (m) { score = { h: +m[1], a: +m[2] }; break; }
    }
    return { p, score, pred };
  }
  return null;
}

// text = what you get from copying the league table. Cards = the day's cards for that league.
// Returns { found: Map(cardId -> fb), missing: [cardId] }. Handles a home/away swap (flips the numbers).
export function parseForebet(text, cards) {
  const tok = String(text || '').split(/\r?\n|\t| {2,}/).map(s => s.trim()).filter(Boolean);
  const found = new Map(), missing = [];
  for (const c of cards) {
    let hit = null;
    for (let i = 0; i < tok.length && !hit; i++) {
      for (const [a, b, swap] of [[c.home, c.away, false], [c.away, c.home, true]]) {
        if (!is(tok[i], a)) continue;
        for (let j = i + 1; j <= i + 3 && j < tok.length; j++) {
          if (!is(tok[j], b)) continue;
          const r = readAfter(tok, j + 1);
          if (r) hit = swap ? { p: [r.p[2], r.p[1], r.p[0]], score: r.score && { h: r.score.a, a: r.score.h }, pred: r.pred === '1' ? '2' : r.pred === '2' ? '1' : r.pred } : r;
          break;
        }
        if (hit) break;
      }
    }
    if (hit) found.set(c.id, { ...hit, how: 'pasted' }); else missing.push(c.id);
  }
  return { found, missing };
}

// Built-in picks captured before kickoff (src/fbseed.js), matched to cards by team names.
export function seedFb(card, date) {
  const day = seed[date]; if (!day) return null;
  for (const [h, a, p1, p2, p3, sc] of day.rows) {
    const fwd = is(h, card.home) && is(a, card.away), rev = is(h, card.away) && is(a, card.home);
    if (!fwd && !rev) continue;
    const m = SCORE.exec(sc);
    const p = fwd ? [p1, p2, p3] : [p3, p2, p1];
    const score = m ? (fwd ? { h: +m[1], a: +m[2] } : { h: +m[2], a: +m[1] }) : null;
    return { p, score, pred: p[0] >= p[1] && p[0] >= p[2] ? '1' : p[2] >= p[1] ? '2' : 'X', at: day.capturedAt, how: 'saved before kickoff' };
  }
  return null;
}

// Winner hit, exact-score hit and the same 3-way Brier score the models use.
export function fbGrade(fb, final) {
  const outcome = final.h > final.a ? 'H' : final.h === final.a ? 'D' : 'A';
  const probs = fb.p.map(x => x / 100), actual = [outcome === 'H' ? 1 : 0, outcome === 'D' ? 1 : 0, outcome === 'A' ? 1 : 0];
  const top = probs.indexOf(Math.max(...probs)), pick = ['H', 'D', 'A'][top];
  return {
    outcomeHit: pick === outcome,
    scoreHit: !!fb.score && fb.score.h === final.h && fb.score.a === final.a,
    brier: probs.reduce((s, p, i) => s + (p - actual[i]) ** 2, 0),
  };
}
