// Hockey Trends (Nov 8, 2026; reads rebuilt on Nov 11, 2026). Situations the Hub can count in its own saved days, how each has done, and a
// read on each game of a day. Pure functions, no I/O: the Worker loads the saved days and the page draws what comes back (public/nhl.html,
// Lines tab).
//
// A situation is a spot a game can be in (a road team on a back-to-back, a heavy home favorite, a team on a losing streak, a first game of
// the day). For every graded game that was in it, the situation records how the SUBJECT did (the road team won, the home favorite won, the
// game went Over) and the chance the subject had going in, so a record is judged against that chance and not against 50%.
//   chance = the price with the margin removed; with no price, the Hub's model (v4, else v2) for the winner and 50% for the total.
//   z      = (wins - expected wins) / sqrt(sum p(1-p)); above 0 means the subject did better than its chance.
//   tag    = Lean (|z| 1.5+), Watch (|z| 0.8+) or Noise (less than that, or fewer than 10 games); a Lean on fewer than 20 games is a Watch.
//   lift   = 100 * (wins - expected wins) / (games + 30), in points: how far the subject ran ahead of its chance per game, pulled toward 0
//            as if 30 more games at exactly its chance had been played. A hot 12-game run moves little; the same rate over 60 games moves more.
//
// The game read (Nov 11, 2026). The old read added points (Lean 2, Watch 1) and picked the side the points fell on, whatever that side's
// chance of winning was: a trend could put a Strong on a +170 underdog. On the 178 graded games of Oct 15 to Nov 9, 2026 the chance
// was what decided the hit rate: sides at 55%+ won about 7 in 10, sides under 55% about half. So the read is now a chance:
//   chance of the home team (or the Over) = its chance going in + the lifts of the situations the game is in (12 points at most)
//   pick     = the side that ends above 50%
//   strength = that side's chance: Strong 65%+, Medium 58%+, Weak 53%+, under that a Pass (coin flip). A model on the other side is still
//              a Conflict (no play).
// A read still needs a situation: a game in none has no trend. The price move is no longer part of the strength (the price the chance
// starts from has already moved); the page still shows it. Reads of a day use only the games of earlier days, so a finished day shows the
// read as it stood, not one that already knew the result. It is a read of past results, never a model bet, and it feeds no pick.
import { hockeyMove } from './moves.js';

const MIN_N = 10, LEAN_N = 20, LEAN_Z = 1.5, WATCH_Z = 0.8;
export const SHRINK = 30, CAP = 12, MIN_LIFT = 1; // games added at the chance; most points the lifts may move a read; smallest lift that counts
export const BANDS = { Strong: 65, Medium: 58, Weak: 53 };
const WATCH_SINCE = '2026-11-10'; // the backup the scan ran on had results through Nov 9, 2026
export const SITUATIONS = [
  { id: 'roadb2b', kind: 'ml', subject: 'A', who: 'road team', label: 'Road team on a back-to-back, home team rested', base: 0.45 },
  { id: 'homefav60', kind: 'ml', subject: 'H', who: 'home team', label: 'Home favorite at 60%+ implied', base: 0.64 },
  { id: 'homefav50', kind: 'ml', subject: 'H', who: 'home team', label: 'Slight home favorite, 50-55% implied', base: 0.52 },
  { id: 'homeloss2', kind: 'ml', subject: 'H', who: 'home team', label: 'Home team on a 2+ game losing streak', base: 0.54 },
  { id: 'roadloss2', kind: 'ml', subject: 'H', who: 'home team', label: 'Road team on a 2+ game losing streak', base: 0.6 },
  { id: 'resthome', kind: 'ml', subject: 'H', who: 'home team', label: 'Home team 2+ days rested, road team on a back-to-back', base: 0.58 },
  { id: 'b2bover', kind: 'ou', subject: 'O', who: 'Over', label: 'A team on a back-to-back, over', base: 0.5 },
  { id: 'firstover', kind: 'ou', subject: 'O', who: 'Over', label: 'First game of the day, over', base: 0.5 },
  // Tracked only (Nov 11, 2026). Found by scanning 124 candidate spots on the 178 graded games of Oct 15 to Nov 9, 2026. Only 8 of the 124
  // cleared |z| 1.5 where chance alone would give about 14, so none of these is proven: they are the ones that pointed the same way in both
  // halves of the sample and have a plain reason behind them. watch: true = counted and shown, but it moves no read. `since` is the first
  // day after the scan: the record from that day on (fresh) is the honest test. Move one into the read (drop watch) only once it has held
  // on 20+ fresh games.
  { id: 'homefav55', kind: 'ml', subject: 'H', who: 'home team', label: 'Home favorite at 55-60% chance', base: 0.57, watch: true, since: WATCH_SINCE },
  { id: 'fbhome60', kind: 'ml', subject: 'H', who: 'home team', label: 'Forebet gives the home team 60%+', base: 0.62, watch: true, since: WATCH_SINCE },
  { id: 'homeback', kind: 'ml', subject: 'H', who: 'home team', label: 'Home team in its first game back from the road', base: 0.55, watch: true, since: WATCH_SINCE },
  { id: 'roadtrip4', kind: 'ml', subject: 'A', who: 'road team', label: 'Road team on its 4th+ straight road game', base: 0.45, watch: true, since: WATCH_SINCE },
  { id: 'tired3in4', kind: 'ou', subject: 'O', who: 'Over', label: 'A team in its 3rd game in 4 nights, over', base: 0.5, watch: true, since: WATCH_SINCE },
];
const imp = o => (o > 0 ? 100 / (o + 100) : -o / (-o + 100));
const two = (h, a) => { if (!Number.isFinite(h) || !Number.isFinite(a)) return null; const x = imp(h), y = imp(a), t = x + y; return [x / t, y / t]; };
export const lineOf = c => (c.ln && Number.isFinite(c.ln.v) ? c.ln.v : c.px && Number.isFinite(c.px.tl) ? c.px.tl : null);

// Every card of every saved day, in order, with each team's days of rest (days since it last played in the saved days; null for a team's
// first saved game) and whether it is the first game of its day. Rest is an honest null, not 0, when the days before were not saved.
export function withContext(days) {
  const out = [], last = new Map(), losses = new Map(); // losses: a team's current run of straight losses in the saved graded games
  const sched = new Map(); // a team's saved games so far, oldest first: { D, home }
  const run = (ab, home) => { const h = sched.get(ab) || []; let n = 0; for (let i = h.length - 1; i >= 0 && h[i].home === home; i--) n++; return n; };
  const sorted = (days || []).filter(d => d && d.date && Array.isArray(d.cards)).slice().sort((a, b) => a.date.localeCompare(b.date));
  for (const d of sorted) {
    const D = Date.parse(d.date + 'T12:00:00Z'), cards = d.cards.filter(c => c && c.kickoff).slice().sort((a, b) => a.kickoff.localeCompare(b.kickoff));
    const first = cards.length ? cards[0].kickoff : null;
    for (const c of cards) {
      const rest = ab => (last.has(ab) ? Math.round((D - last.get(ab)) / 86400000) - 1 : null);
      const in4 = ab => (sched.get(ab) || []).filter(x => D - x.D <= 3 * 86400000).length; // games in the 3 days before this one
      // aroad: straight road games the road team has just played. hback: the home team's last game was on the road. hin4 / ain4: 2 = this is a 3rd game in 4 nights.
      out.push({ ...c, date: d.date, hrest: rest(c.hAbbr), arest: rest(c.aAbbr), firstGame: c.kickoff === first, hloss: losses.get(c.hAbbr) || 0, aloss: losses.get(c.aAbbr) || 0, aroad: run(c.aAbbr, false), hback: sched.has(c.hAbbr) && run(c.hAbbr, true) === 0, hin4: in4(c.hAbbr), ain4: in4(c.aAbbr) });
    }
    for (const c of cards) { if (!c.final || !c.grade) continue; const hw = c.final.h > c.final.a; losses.set(c.hAbbr, hw ? 0 : (losses.get(c.hAbbr) || 0) + 1); losses.set(c.aAbbr, hw ? (losses.get(c.aAbbr) || 0) + 1 : 0); }
    for (const c of cards) { last.set(c.hAbbr, D); last.set(c.aAbbr, D); for (const [ab, home] of [[c.hAbbr, true], [c.aAbbr, false]]) { if (!sched.has(ab)) sched.set(ab, []); sched.get(ab).push({ D, home }); } }
  }
  return out;
}
const clip = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
// The chance going in, 0-1. Home team: the price with the margin removed, else the model (v4, else v2), else null. Over: the price on the
// line the game is graded on, else 0.5.
export function chanceHome(c) {
  const pr = c.px ? two(c.px.h, c.px.a) : null; if (pr) return pr[0];
  const m = c.v4 || c.v2; return m && Number.isFinite(m.w) ? m.w / 100 : null;
}
export function chanceOver(c) {
  const ln = lineOf(c), pr = c.px && ln != null && c.px.tl === ln ? two(c.px.to, c.px.tu) : null;
  return pr ? pr[0] : 0.5;
}
// Is the card in the situation? Returns false, or { exp } with the subject's chance going in (the situation's base rate with no price and no model).
function inSpot(s, c) {
  const px = c.px, hp = px && Number.isFinite(px.h) && Number.isFinite(px.a) ? imp(px.h) * 100 : null, ap = hp == null ? null : imp(px.a) * 100;
  const ch = chanceHome(c), sub = s.kind === 'ou' ? chanceOver(c) : ch == null ? s.base : s.subject === 'H' ? ch : 1 - ch, hit = { exp: sub };
  if (s.id === 'roadb2b') return c.arest === 0 && (c.hrest || 0) >= 1 ? hit : false;
  if (s.id === 'homeloss2') return c.hloss >= 2 ? hit : false;
  if (s.id === 'roadloss2') return c.aloss >= 2 ? hit : false;
  if (s.id === 'resthome') return c.arest === 0 && (c.hrest || 0) >= 2 ? hit : false;
  if (s.id === 'homefav60') return hp != null && hp > ap && hp >= 60 ? hit : false;
  if (s.id === 'homefav50') return hp != null && hp > ap && hp >= 50 && hp < 55 ? hit : false;
  if (s.id === 'b2bover') return c.arest === 0 || c.hrest === 0 ? hit : false;
  if (s.id === 'firstover') return c.firstGame ? hit : false;
  if (s.id === 'homefav55') return ch != null && ch >= 0.55 && ch < 0.6 ? hit : false;
  if (s.id === 'fbhome60') return c.fb && Array.isArray(c.fb.p) && c.fb.p[0] >= 60 ? hit : false;
  if (s.id === 'homeback') return c.hback ? hit : false;
  if (s.id === 'roadtrip4') return c.aroad >= 3 ? hit : false;
  if (s.id === 'tired3in4') return c.hin4 >= 2 || c.ain4 >= 2 ? hit : false;
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

// The record of every situation over the saved days (ctx = withContext(days)).
export function situations(ctx) {
  return SITUATIONS.map(s => {
    let n = 0, w = 0, exp = 0, v = 0; const fresh = { w: 0, n: 0, exp: 0 };
    for (const c of ctx) {
      const sp = inSpot(s, c); if (!sp) continue;
      const won = subjectWon(s, c); if (won == null) continue;
      n++; if (won) w++; exp += sp.exp; v += sp.exp * (1 - sp.exp);
      if (s.since && c.date >= s.since) { fresh.n++; if (won) fresh.w++; fresh.exp += sp.exp; }
    }
    const z = v > 0 ? (w - exp) / Math.sqrt(v) : 0, tag = tagOf(n, z), lift = n >= MIN_N ? Math.round(1000 * (w - exp) / (n + SHRINK)) / 10 : 0;
    return { id: s.id, kind: s.kind, label: s.label, who: s.who, w, l: n - w, n, exp: Math.round(10 * exp) / 10, z: Math.round(100 * z) / 100, tag, dir: z >= 0 ? 'with' : 'against', lift, ...(s.watch ? { watch: true, since: s.since, fresh: { w: fresh.w, l: fresh.n - fresh.w, n: fresh.n, exp: Math.round(10 * fresh.exp) / 10 } } : {}) };
  });
}
// Strength of a read from the pick's chance (0-100). A model on the other side makes it a Conflict (no play).
export function rate(chance, modelOk) {
  if (modelOk === false) return 'Conflict';
  return chance >= BANDS.Strong ? 'Strong' : chance >= BANDS.Medium ? 'Medium' : chance >= BANDS.Weak ? 'Weak' : 'Pass';
}
const r0 = x => Math.round(x), r1 = x => Math.round(10 * x) / 10;
// One market of one game: the chance going in (0-1, toward the home team / the Over), moved by the lifts. null with no situation or no chance.
function readOf(base, ev) {
  if (base == null || !ev.length) return null;
  const shift = clip(ev.reduce((a, x) => a + x.toward, 0), -CAP, CAP), p = clip(100 * base + shift, 2, 98), up = p >= 50;
  return { up, chance: r0(up ? p : 100 - p), base: r0(up ? 100 * base : 100 - 100 * base), shift: r1(up ? shift : -shift) };
}
// A read for each game of one day, from the situation records in stats (buildTrends passes the records of the days before that day).
// ev[].toward is the situation's lift in points toward the home team (moneyline) or the Over (total); the sign is the side it backs.
export function gameReads(ctx, stats, date) {
  const byId = Object.fromEntries(stats.map(s => [s.id, s]));
  return ctx.filter(c => c.date === date).map(c => {
    const ml = [], ou = [], watch = [];
    for (const s of SITUATIONS) {
      if (!inSpot(s, c)) continue;
      // tracked only: listed on the game (the side its record backs so far), never part of the read
      if (s.watch) { const t = byId[s.id]; if (t) watch.push({ id: s.id, kind: s.kind, label: s.label, w: t.w, l: t.l, n: t.n, dir: t.dir, backs: s.kind === 'ou' ? (t.dir === 'with' ? 'Over' : 'Under') : (s.subject === 'H') === (t.dir === 'with') ? c.hAbbr : c.aAbbr }); continue; }
      const st = byId[s.id], lift = st && Number.isFinite(st.lift) ? st.lift : 0; if (Math.abs(lift) < MIN_LIFT) continue;
      const toward = s.kind === 'ml' && s.subject !== 'H' ? -lift : lift;
      (s.kind === 'ml' ? ml : ou).push({ id: s.id, label: s.label, w: st.w, l: st.l, n: st.n, who: s.who, tag: st.tag, dir: lift >= 0 ? 'with' : 'against', toward });
    }
    // One fact, one count (Nov 10, 2026): 'resthome' (home 2+ days rested, road on a back-to-back) is a subset of 'roadb2b', so when both fire
    // only the stronger one is kept (a tie keeps resthome, the narrower spot).
    const rb = ml.findIndex(x => x.id === 'roadb2b'), rh = ml.findIndex(x => x.id === 'resthome');
    if (rb >= 0 && rh >= 0) ml.splice(Math.abs(ml[rb].toward) > Math.abs(ml[rh].toward) ? rh : rb, 1);
    const m = c.v4 || c.v2, hm = c.px ? hockeyMove(c.px) : null, line = lineOf(c), out = { id: c.id, date: c.date, kickoff: c.kickoff, ko: c.ko, aAbbr: c.aAbbr, hAbbr: c.hAbbr, away: c.away, home: c.home, line, hrest: c.hrest, arest: c.arest, watch };
    const a = readOf(chanceHome(c), ml);
    if (a) {
      const home = a.up, team = home ? c.hAbbr : c.aAbbr, price = c.px ? (home ? c.px.h : c.px.a) : null;
      const modelHome = m ? m.w >= 50 : null, modelOk = modelHome == null ? null : modelHome === home;
      const d = hm && hm.ml ? hm.ml.d : null, mvOn = d != null && Math.abs(d) >= 3 ? (d > 0) === home : null;
      out.ml = { side: home ? 'H' : 'A', team, price, chance: a.chance, base: a.base, shift: a.shift, ev: ml, modelOk, model: m ? `${modelHome ? c.hAbbr : c.aAbbr} ${modelHome ? m.w : 100 - m.w}%` : null, move: d, moveWith: mvOn, lab: rate(a.chance, modelOk) };
    }
    const b = line != null ? readOf(chanceOver(c), ou) : null;
    if (b) {
      const over = b.up, modelOver = m && Number.isFinite(m.o) ? m.o >= 50 : null, modelOk = modelOver == null ? null : modelOver === over;
      const d = hm && hm.ou && hm.ou.line === line ? hm.ou.d : null, mvOn = d != null && Math.abs(d) >= 3 ? (d > 0) === over : null;
      out.ou = { side: over ? 'Over' : 'Under', line, chance: b.chance, base: b.base, shift: b.shift, ev: ou, modelOk, model: modelOver == null ? null : `${modelOver ? 'Over' : 'Under'} ${modelOver ? m.o : 100 - m.o}%`, move: d, moveWith: mvOn, lab: rate(b.chance, modelOk) };
    }
    return out;
  });
}
// The situation records as they stood before a day: only the graded games of earlier days.
export const statsBefore = (ctx, date) => situations(ctx.filter(c => c.date < date));
// How the reads have done: every graded game read with the records of the days before it (so it is a fair replay: no read knew its own
// result), grouped by strength. Each row is how often the trend pick won; on a Conflict it also says how often the model's pick won.
// A pushed total is left out.
const TRACK = [['Strong', 'Strong'], ['Medium', 'Medium'], ['Weak', 'Weak'], ['Pass', 'Pass (coin flip)'], ['Conflict', 'model disagrees (Conflict)']];
export function track(ctx) {
  const byKey = Object.fromEntries(ctx.map(c => [c.id + '|' + c.date, c])), G = {};
  const add = (id, label, won, mwon) => { const g = G[id] || (G[id] = { id, label, w: 0, n: 0, mw: 0, hasModel: mwon != null }); g.n++; if (won) g.w++; if (mwon) g.mw++; };
  const put = (k, name, x, won) => { const lb = TRACK.find(t => t[0] === x.lab); if (!lb) return; const cf = x.lab === 'Conflict';
    if (x.lab === 'Strong' || x.lab === 'Medium') add(k + '-play', `${name}, plays (Strong and Medium)`, won, null);
    add(k + '-' + x.lab.toLowerCase(), `${name}, ${lb[1]}`, won, cf ? !won : null); };
  for (const date of [...new Set(ctx.map(c => c.date))].sort()) {
    if (!ctx.some(c => c.date === date && c.final && c.grade)) continue;
    for (const r of gameReads(ctx, statsBefore(ctx, date), date)) {
      const c = byKey[r.id + '|' + date]; if (!c.final || !c.grade) continue;
      if (r.ml) put('ml', 'Moneyline', r.ml, (r.ml.side === 'H') === (c.final.h > c.final.a));
      if (r.ou && c.final.total !== r.line) put('ou', 'Total', r.ou, (r.ou.side === 'Over') === (c.final.total > r.line));
    }
  }
  return ['ml', 'ou'].flatMap(k => ['play', 'strong', 'medium', 'weak', 'pass', 'conflict'].map(x => G[k + '-' + x])).filter(Boolean);
}
// What /api/nhl/trends sends: the situations (every saved day), the replay, and a read for each game of the date (from the days before it).
export function buildTrends(days, date) {
  const ctx = withContext(days), stats = situations(ctx);
  return { date, games: ctx.filter(c => c.final && c.grade).length, days: new Set(ctx.map(c => c.date)).size, situations: stats, track: track(ctx), cards: gameReads(ctx, statsBefore(ctx, date), date) };
}
