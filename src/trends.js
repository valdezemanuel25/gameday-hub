// Hockey Trends (Nov 8, 2026). Situations the Hub can count in its own saved days, how each has done, and a read on each game of a day.
// Pure functions, no I/O: the Worker loads the saved days and the page draws what comes back (public/nhl.html, Trends tab).
//
// A situation is a spot a game can be in (a road team on a back-to-back, a heavy home favorite, a first game of the day). For every
// graded game that was in it, the situation records how the SUBJECT did (the road team won, the home favorite won, the game went
// Over) and what the price expected for that subject, so a record is judged against the price and not against 50%.
//   z    = (wins - expected wins) / sqrt(sum p(1-p)); above 0 means the subject did better than its price.
//   tag  = Lean (|z| 1.5+), Watch (|z| 0.8+) or Noise (less than that, or fewer than 10 games); a Lean on fewer than 20 games is a Watch.
//   dir  = with the subject (z > 0) or against it (z < 0). A situation points at its subject when dir is with, at the other side when against.
// The game read adds up the points of the situations a game is in (Lean 2, Watch 1), then checks them against the Hub's own model
// (v4, else v2) and the price move. It is a read of past results, never a model bet, and it feeds no pick.
import { hockeyMove } from './moves.js';

const MIN_N = 10, LEAN_N = 20, LEAN_Z = 1.5, WATCH_Z = 0.8;
export const SITUATIONS = [
  { id: 'roadb2b', kind: 'ml', subject: 'A', who: 'road team', label: 'Road team on a back-to-back, home team rested', base: 0.45 },
  { id: 'homefav60', kind: 'ml', subject: 'H', who: 'home team', label: 'Home favorite at 60%+ implied', base: 0.64 },
  { id: 'homefav50', kind: 'ml', subject: 'H', who: 'home team', label: 'Slight home favorite, 50-55% implied', base: 0.52 },
  { id: 'b2bover', kind: 'ou', subject: 'O', who: 'Over', label: 'A team on a back-to-back, over', base: 0.5 },
  { id: 'firstover', kind: 'ou', subject: 'O', who: 'Over', label: 'First game of the day, over', base: 0.5 },
];
const imp = o => (o > 0 ? 100 / (o + 100) : -o / (-o + 100));
const two = (h, a) => { if (!Number.isFinite(h) || !Number.isFinite(a)) return null; const x = imp(h), y = imp(a), t = x + y; return [x / t, y / t]; };
export const lineOf = c => (c.ln && Number.isFinite(c.ln.v) ? c.ln.v : c.px && Number.isFinite(c.px.tl) ? c.px.tl : null);

// Every card of every saved day, in order, with each team's days of rest (days since it last played in the saved days; null for a team's
// first saved game) and whether it is the first game of its day. Rest is an honest null, not 0, when the days before were not saved.
export function withContext(days) {
  const out = [], last = new Map();
  const sorted = (days || []).filter(d => d && d.date && Array.isArray(d.cards)).slice().sort((a, b) => a.date.localeCompare(b.date));
  for (const d of sorted) {
    const D = Date.parse(d.date + 'T12:00:00Z'), cards = d.cards.filter(c => c && c.kickoff).slice().sort((a, b) => a.kickoff.localeCompare(b.kickoff));
    const first = cards.length ? cards[0].kickoff : null;
    for (const c of cards) {
      const rest = ab => (last.has(ab) ? Math.round((D - last.get(ab)) / 86400000) - 1 : null);
      out.push({ ...c, date: d.date, hrest: rest(c.hAbbr), arest: rest(c.aAbbr), firstGame: c.kickoff === first });
    }
    for (const c of cards) { last.set(c.hAbbr, D); last.set(c.aAbbr, D); }
  }
  return out;
}
// Is the card in the situation? Returns false, or { exp } with what the price (or the base rate with no price) expected for the subject.
function inSpot(s, c) {
  const px = c.px, hp = px && Number.isFinite(px.h) && Number.isFinite(px.a) ? imp(px.h) * 100 : null, ap = hp == null ? null : imp(px.a) * 100;
  const pr = px ? two(px.h, px.a) : null;
  if (s.id === 'roadb2b') return c.arest === 0 && (c.hrest || 0) >= 1 ? { exp: pr ? pr[1] : s.base } : false;
  if (s.id === 'homefav60') return hp != null && hp > ap && hp >= 60 ? { exp: pr[0] } : false;
  if (s.id === 'homefav50') return hp != null && hp > ap && hp >= 50 && hp < 55 ? { exp: pr[0] } : false;
  if (s.id === 'b2bover') return c.arest === 0 || c.hrest === 0 ? { exp: 0.5 } : false;
  if (s.id === 'firstover') return c.firstGame ? { exp: 0.5 } : false;
  return false;
}
// Did the subject win? true / false, or null when the game is not graded or has no line to grade an Over against (a push is null too).
function subjectWon(s, c) {
  const f = c.final; if (!f || !c.grade) return null;
  if (s.kind === 'ml') return s.subject === 'H' ? f.h > f.a : f.a > f.h;
  const ln = lineOf(c); if (ln == null || f.total === ln) return null;
  return f.total > ln;
}
export function tagOf(n, z) {
  if (n < MIN_N) return 'noise';
  const m = Math.abs(z) >= LEAN_Z ? 'lean' : Math.abs(z) >= WATCH_Z ? 'watch' : 'noise';
  return m === 'lean' && n < LEAN_N ? 'watch' : m;
}
export const pointsOf = tag => (tag === 'lean' ? 2 : tag === 'watch' ? 1 : 0);

// The record of every situation over the saved days (ctx = withContext(days)).
export function situations(ctx) {
  return SITUATIONS.map(s => {
    let n = 0, w = 0, exp = 0, v = 0;
    for (const c of ctx) {
      const sp = inSpot(s, c); if (!sp) continue;
      const won = subjectWon(s, c); if (won == null) continue;
      n++; if (won) w++; exp += sp.exp; v += sp.exp * (1 - sp.exp);
    }
    const z = v > 0 ? (w - exp) / Math.sqrt(v) : 0, tag = tagOf(n, z);
    return { id: s.id, kind: s.kind, label: s.label, who: s.who, w, l: n - w, n, exp: Math.round(10 * exp) / 10, z: Math.round(100 * z) / 100, tag, dir: z >= 0 ? 'with' : 'against' };
  });
}
const sgn = x => (x > 0 ? 1 : x < 0 ? -1 : 0);
// A read for each game of one day. Score is toward the home team (moneyline) or the Over (total); the sign is the side.
export function gameReads(ctx, stats, date) {
  const byId = Object.fromEntries(stats.map(s => [s.id, s]));
  return ctx.filter(c => c.date === date).map(c => {
    const ml = [], ou = [];
    for (const s of SITUATIONS) {
      if (!inSpot(s, c)) continue;
      const st = byId[s.id], pts = pointsOf(st.tag) * (st.dir === 'with' ? 1 : -1); if (!pts) continue;
      // toward the home team / the Over
      const toward = s.kind === 'ml' ? pts * (s.subject === 'H' ? 1 : -1) : pts;
      (s.kind === 'ml' ? ml : ou).push({ id: s.id, label: s.label, w: st.w, l: st.l, n: st.n, who: s.who, tag: st.tag, dir: st.dir, toward });
    }
    const m = c.v4 || c.v2, hm = c.px ? hockeyMove(c.px) : null, line = lineOf(c), out = { id: c.id, date: c.date, kickoff: c.kickoff, ko: c.ko, aAbbr: c.aAbbr, hAbbr: c.hAbbr, away: c.away, home: c.home, line, hrest: c.hrest, arest: c.arest };
    const ms = ml.reduce((a, x) => a + x.toward, 0);
    if (ms !== 0) {
      const home = ms > 0, team = home ? c.hAbbr : c.aAbbr, price = c.px ? (home ? c.px.h : c.px.a) : null;
      const modelHome = m ? m.w >= 50 : null, modelOk = modelHome == null ? null : modelHome === home;
      const d = hm && hm.ml ? hm.ml.d : null, mvOn = d != null && Math.abs(d) >= 3 ? (d > 0) === home : null;
      out.ml = { side: home ? 'H' : 'A', team, price, score: Math.abs(ms), ev: ml, modelOk, model: m ? `${modelHome ? c.hAbbr : c.aAbbr} ${modelHome ? m.w : 100 - m.w}%` : null, move: d, moveWith: mvOn, ...rate(Math.abs(ms), modelOk, mvOn) };
    }
    const os = ou.reduce((a, x) => a + x.toward, 0);
    if (os !== 0 && line != null && m) {
      const over = os > 0, modelOver = m.o >= 50, modelOk = modelOver === over;
      const d = hm && hm.ou && hm.ou.line === line ? hm.ou.d : null, mvOn = d != null && Math.abs(d) >= 3 ? (d > 0) === over : null;
      out.ou = { side: over ? 'Over' : 'Under', line, score: Math.abs(os), ev: ou, modelOk, model: `${modelOver ? 'Over' : 'Under'} ${modelOver ? m.o : 100 - m.o}%`, move: d, moveWith: mvOn, ...rate(Math.abs(os), modelOk, mvOn) };
    }
    return out;
  });
}
// Strength: the points, plus one when the model agrees, plus or minus one when the price moved 3+ points with or against it.
// A model that disagrees makes it a Conflict (no play).
export function rate(score, modelOk, mvOn) {
  if (modelOk === false) return { lab: 'Conflict', total: score };
  const t = score + (modelOk ? 1 : 0) + (mvOn === true ? 1 : 0) - (mvOn === false ? 1 : 0);
  return { lab: t >= 4 ? 'Strong' : t === 3 ? 'Medium' : t >= 1 ? 'Weak' : 'None', total: t };
}
// What /api/nhl/trends sends: the situations, and a read for each game of the date.
export function buildTrends(days, date) {
  const ctx = withContext(days), stats = situations(ctx);
  return { date, games: ctx.filter(c => c.final && c.grade).length, days: new Set(ctx.map(c => c.date)).size, situations: stats, cards: gameReads(ctx, stats, date) };
}
