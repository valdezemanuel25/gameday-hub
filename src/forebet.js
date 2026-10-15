// Forebet picks, entered by hand (pasted from the league page) and only RECORDED + GRADED.
// Nothing here is read by v2, v4 or any model. card.fb = { p:[home,draw,away] percent, score:{h,a}|null, pred:'1'|'X'|'2'|null, at, how }
import { norm, sameTeam } from './sportsmole.js';
import seed from './fbseed.js';

const is = (a, b) => sameTeam(norm(a), norm(b));
const INT = /^\d{1,3}$/, SCORE = /^(\d{1,2})\s*[-–]\s*(\d{1,2})$/;

// Two-way tables (Under/Over 2.5 and Both teams to score): the two percentages after the teams; the 2nd is Over / Yes.
function readTwoAfter(tok, from) {
  for (let i = from; i < Math.min(tok.length - 1, from + 14); i++) {
    if (!(INT.test(tok[i]) && INT.test(tok[i + 1]))) continue;
    const a = +tok[i], b = +tok[i + 1];
    if (a + b >= 97 && a + b <= 103) return b;
  }
  return null;
}

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
export function parseForebet(text, cards, kind = '1x2') {
  const tok = String(text || '').split(/\r?\n|\t| {2,}/).map(s => s.trim()).filter(Boolean);
  const found = new Map(), missing = [];
  for (const c of cards) {
    let hit = null;
    for (let i = 0; i < tok.length && !hit; i++) {
      for (const [a, b, swap] of [[c.home, c.away, false], [c.away, c.home, true]]) {
        if (!is(tok[i], a)) continue;
        for (let j = i + 1; j <= i + 3 && j < tok.length; j++) {
          if (!is(tok[j], b)) continue;
          if (kind !== '1x2') { const v = readTwoAfter(tok, j + 1); if (v != null) hit = kind === 'ou' ? { over: v } : { btts: v }; break; }
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
  for (const [h, a, p1, p2, p3, sc, over, btts] of day.rows) {
    const fwd = is(h, card.home) && is(a, card.away), rev = is(h, card.away) && is(a, card.home);
    if (!fwd && !rev) continue;
    const m = SCORE.exec(sc);
    const p = fwd ? [p1, p2, p3] : [p3, p2, p1];
    const score = m ? (fwd ? { h: +m[1], a: +m[2] } : { h: +m[2], a: +m[1] }) : null;
    return { p, score, pred: p[0] >= p[1] && p[0] >= p[2] ? '1' : p[2] >= p[1] ? '2' : 'X', over, btts, at: day.capturedAt, how: 'saved before kickoff' };
  }
  return null;
}

// Fill what a card is missing from the saved picks. Anything already on the card (e.g. pasted by you) wins.
export function mergeSeed(card, date) {
  const s = seedFb(card, date); if (!s) return;
  card.fb = { ...s, ...(card.fb || {}) };
}

// Winner hit, exact-score hit and the same 3-way Brier score the models use.
export function fbGrade(fb, final) {
  const outcome = final.h > final.a ? 'H' : final.h === final.a ? 'D' : 'A', out = {};
  if (fb.p) {
    const probs = fb.p.map(x => x / 100), actual = [outcome === 'H' ? 1 : 0, outcome === 'D' ? 1 : 0, outcome === 'A' ? 1 : 0];
    const pick = ['H', 'D', 'A'][probs.indexOf(Math.max(...probs))];
    out.outcomeHit = pick === outcome;
    out.scoreHit = !!fb.score && fb.score.h === final.h && fb.score.a === final.a;
    out.brier = probs.reduce((s, p, i) => s + (p - actual[i]) ** 2, 0);
  }
  // Ties (exactly 50) go to Under / No, as Forebet's own pick does.
  if (fb.over != null) out.ouHit = (fb.over > 50) === (final.h + final.a >= 3);
  if (fb.btts != null) out.bttsHit = (fb.btts > 50) === (final.h > 0 && final.a > 0);
  return out;
}
