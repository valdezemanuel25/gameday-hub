// Bet analyzer and tracker (soccer). Pure functions plus two small storage helpers.
//   A bet is one or more legs. A leg is one pick on one game: { date, league, id, market, sel, line? }.
//     market 'win'  sel H | D | A              market 'dc'   sel 1X | X2 | 12 (home or draw, away or draw, no draw)
//     market 'ou'   sel O | U, line 0.5 .. 5.5   market 'btts' sel Y | N
//   Probabilities come from the cards' own v2 and v4 numbers (and Forebet where it publishes the same market). Odds are never used.
//   Legs on different games multiply; legs on the same game are scored together on that model's score grid.
//   Hockey (sport 'nhl', league 'nhl'): markets are the winner (overtime and shootout count, so no draw) and Over/Under at that card's
//   DraftKings line. The line is taken from the card when the bet is placed and kept on the bet, so a later line move changes nothing.
//   Settlement reads the finished score the Hub already grades from: a bet is stored once and settles by itself.

import { V4, dcTau } from './v4core.js';
import { CUP_MODEL } from './data.js';

const MAXG = 11;
export const LINES = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5];
const MODELS = ['v2', 'v4', 'fb'];
const CUP_GRID = new Set(CUP_MODEL.map(l => l.slug)); // v4's cup model is plain Poisson (see v4cup.js)

function pois(l) { const p = [Math.exp(-l)]; for (let k = 1; k < MAXG; k++) p.push(p[k - 1] * l / k); return p; }
// The model's score grid: P(home scores x, away scores y), rescaled to add up to 1. rho: v4's low-score correction (v2 has none).
export function scoreGrid(lh, la, rho = 0) {
  const ph = pois(lh), pa = pois(la), cells = []; let tot = 0;
  for (let x = 0; x < MAXG; x++) for (let y = 0; y < MAXG; y++) { const p = ph[x] * pa[y] * dcTau(x, y, lh, la, rho); tot += p; cells.push([x, y, p]); }
  return cells.map(([x, y, p]) => [x, y, p / tot]);
}

const isNhl = l => l && l.sport === 'nhl';
export function validLeg(l) {
  if (!l || !l.date || !l.league || !l.id) return 'Pick a game first.';
  const ok = (isNhl(l) ? { win: ['H', 'A'], ou: ['O', 'U'] } : { win: ['H', 'D', 'A'], dc: ['1X', 'X2', '12'], ou: ['O', 'U'], btts: ['Y', 'N'] })[l.market];
  if (!ok || !ok.includes(l.sel)) return 'Pick what you are betting on.';
  if (l.market === 'ou' && !isNhl(l) && !LINES.includes(Number(l.line))) return 'Choose a goals line between 0.5 and 5.5.';
  return null;
}
// The rule a final score has to meet for this leg to win.
export function test(l) {
  const line = Number(l.line);
  if (isNhl(l)) return l.market === 'win' ? (h, a) => (l.sel === 'H' ? h > a : a > h) : (h, a, total) => (l.sel === 'O' ? total > line : total < line);
  switch (l.market) {
    case 'win': return (h, a) => (l.sel === 'H' ? h > a : l.sel === 'D' ? h === a : h < a);
    case 'dc': return (h, a) => (l.sel === '1X' ? h >= a : l.sel === 'X2' ? h <= a : h !== a);
    case 'ou': return (h, a) => (l.sel === 'O' ? h + a > line : h + a < line);
    default: return (h, a) => ((h > 0 && a > 0) === (l.sel === 'Y'));
  }
}
export function label(l, c) {
  const home = c ? c.home : 'Home', away = c ? c.away : 'Away';
  if (isNhl(l)) return l.market === 'win' ? `${l.sel === 'H' ? home : away} to win` : `${l.sel === 'O' ? 'Over' : 'Under'} ${Number(l.line)} goals`;
  if (l.market === 'win') return l.sel === 'H' ? `${home} to win` : l.sel === 'A' ? `${away} to win` : 'Draw';
  if (l.market === 'dc') return l.sel === '1X' ? `${home} or draw` : l.sel === 'X2' ? `${away} or draw` : `${home} or ${away} (no draw)`;
  if (l.market === 'ou') return `${l.sel === 'O' ? 'Over' : 'Under'} ${Number(l.line)} goals`;
  return l.sel === 'Y' ? 'Both teams to score' : 'Both teams not to score';
}

// What a model says about a game, in one shape. Forebet only has 1X2, Over/Under 2.5 and Both teams to score.
const srcOf = (c, m, l) => {
  const x = c && (m === 'fb' ? c.fb : c[m]);
  if (x && isNhl(l)) { // hockey cards: w = home win % (overtime counts), o = Over % at the card's line, p = Forebet [home, away]; only v2 has a score grid
    return m === 'fb' ? { w: x.p ? x.p[0] : null, o: null, lam: null } : { w: x.w, o: x.o, lam: m === 'v2' && c.lam ? c.lam : null };
  }
  return x ? { p: x.p || null, over: x.over ?? null, btts: x.btts ?? null, lam: m === 'fb' ? null : x.lam || null } : null;
};

// One leg on one model. Uses the model's own published number where the card has it (winner, Over/Under 2.5, Both score);
// any other goals line comes from that model's score grid.
export function legProb(c, l, m) {
  const s = srcOf(c, m, l); if (!s) return null;
  if (isNhl(l)) {
    if (l.market === 'win') return s.w == null ? null : l.sel === 'H' ? s.w / 100 : 1 - s.w / 100;
    return s.o == null || !(c.ln && c.ln.v === Number(l.line)) ? null : l.sel === 'O' ? s.o / 100 : 1 - s.o / 100;
  }
  if (l.market === 'win' || l.market === 'dc') {
    if (!s.p) return null; const [h, d, a] = s.p.map(x => x / 100);
    return l.market === 'win' ? (l.sel === 'H' ? h : l.sel === 'D' ? d : a) : (l.sel === '1X' ? h + d : l.sel === 'X2' ? d + a : h + a);
  }
  if (l.market === 'ou' && Number(l.line) === 2.5 && s.over != null) return l.sel === 'O' ? s.over / 100 : 1 - s.over / 100;
  if (l.market === 'btts' && s.btts != null) return l.sel === 'Y' ? s.btts / 100 : 1 - s.btts / 100;
  return s.lam ? jointProb(c, [l], m, true) : null;
}
// Hockey: a level regulation score goes to overtime or a shootout, so each tied cell is split evenly between the two winners, and the
// total is one higher when overtime (not a shootout) decides it: also an even split. v2 only; the other models have no score grid.
function hockeyJoint(lam, legs) {
  const N = 16, pois = l => { const p = [Math.exp(-l)]; for (let k = 1; k < N; k++) p.push(p[k - 1] * l / k); return p; }, ph = pois(lam[0]), pa = pois(lam[1]), tests = legs.map(test);
  let sum = 0, tot = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const x = ph[i] * pa[j]; tot += x;
    const outs = i === j ? [[i + 1, i, 2 * i + 1, .25], [i + 1, i, 2 * i, .25], [i, i + 1, 2 * i + 1, .25], [i, i + 1, 2 * i, .25]] : [[i, j, i + j, 1]];
    for (const [h, a, t, w] of outs) if (tests.every(f => f(h, a, t))) sum += x * w;
  }
  return sum / tot;
}
// Several legs on the same game, together: the chance that one final score satisfies all of them.
export function jointProb(c, legs, m, force = false) {
  if (!force && legs.length === 1) return legProb(c, legs[0], m);
  const s = srcOf(c, m, legs[0]); if (!s || !s.lam) return null;
  if (isNhl(legs[0])) return hockeyJoint(s.lam, legs);
  const tests = legs.map(test); let sum = 0;
  for (const [x, y, p] of scoreGrid(s.lam[0], s.lam[1], m === 'v4' && !CUP_GRID.has(c.league) ? V4.RHO : 0)) if (tests.every(f => f(x, y))) sum += p;
  return sum;
}
export const gameKey = l => `${l.date}|${l.league}|${l.id}`;

// cards: Map of gameKey -> card. Returns each leg with its label and probability per model, and the whole bet's chance.
export function analyze(cards, legs0) {
  if (!Array.isArray(legs0) || !legs0.length) return { error: 'Add at least one pick.' };
  if (legs0.length > 12) return { error: 'A bet can have up to 12 picks.' };
  for (const l of legs0) { const e = validLeg(l); if (e) return { error: e }; }
  // A hockey Over/Under is always at that card's own line.
  const legs = [];
  for (const l0 of legs0) {
    const l = { ...l0 };
    if (isNhl(l) && l.market === 'ou') { const c = cards.get(gameKey(l)); if (c) { if (!c.ln) return { error: `No Over/Under line for ${c.home} vs ${c.away} yet. Set it on the NHL page first.` }; l.line = c.ln.v; l.src = c.ln.src || 'sportsbook'; } }
    legs.push(l);
  }
  const groups = new Map();
  for (const l of legs) { const k = gameKey(l); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(l); }
  for (const [k, g] of groups) {
    const dup = new Set(g.map(l => `${l.market}|${l.sel}|${l.market === 'ou' && !isNhl(l) ? l.line : ''}`));
    if (dup.size < g.length) return { error: 'The same pick is on this bet twice. Remove one.' };
    const c = cards.get(k); if (!c) return { error: 'That game was not found. Reload and try again.' };
    if (!c.v2) return { error: `No prediction for ${c.home} vs ${c.away} yet.` };
    if (isNhl(g[0]) && c.skipped) return { error: `${c.home} vs ${c.away} has no prediction (${c.skipped}).` };
    if (c.final) return { error: `${c.home} vs ${c.away} has finished, so it can't be analyzed.` };
  }
  const out = legs.map(l => { const c = cards.get(gameKey(l)); return { ...l, line: l.market === 'ou' ? Number(l.line) : undefined, label: label(l, c), home: c.home, away: c.away, leagueName: isNhl(l) ? 'NHL' : c.leagueName, kickoff: c.kickoff, ko: c.ko, p: Object.fromEntries(MODELS.map(m => [m, legProb(c, l, m)])), grid: !isNhl(l) && l.market === 'ou' && Number(l.line) !== 2.5 }; });
  const p = {};
  for (const m of MODELS) {
    let acc = 1;
    for (const [k, g] of groups) { const v = jointProb(cards.get(k), g, m); if (v == null) { acc = null; break; } acc *= v; }
    p[m] = acc;
  }
  const sameGame = [...groups.values()].some(g => g.length > 1), notes = [];
  if ([...groups.values()].some(g => g.length > 1 && isNhl(g[0]))) notes.push('Hockey picks on the same game are worked out on v2\'s score grid only (v4 and Forebet show n/a), with overtime treated as an even split.');
  if (legs.some(l => isNhl(l) && l.market === 'ou' && Number.isInteger(l.line))) notes.push('On a whole-number line, a total exactly on the line is a push and refunds that pick. The Over chance shown leaves pushes out.');
  if (sameGame && p.v2 === 0) notes.push('These picks on the same game cannot all happen at once, so the chance is 0%.');
  return { legs: out, p, games: groups.size, sameGame, parlay: legs.length > 1, notes };
}

// ---- settling and summary ----
export function settle(bet, cards) {
  let changed = false;
  for (const l of bet.legs) {
    if (l.res) continue;
    const c = cards.get(gameKey(l));
    if (c && c.final) {
      const total = c.final.total ?? c.final.h + c.final.a; // hockey totals leave out the shootout goal
      l.res = isNhl(l) && l.market === 'ou' && total === Number(l.line) ? 'void' : test(l)(c.final.h, c.final.a, total) ? 'hit' : 'miss'; changed = true;
    }
  }
  const was = bet.status;
  bet.status = bet.legs.some(l => l.res === 'miss') ? 'miss' : bet.legs.every(l => l.res) ? (bet.legs.every(l => l.res === 'void') ? 'void' : 'hit') : 'pending';
  if (bet.status !== 'pending' && !bet.settledAt) { bet.settledAt = new Date().toISOString(); changed = true; }
  return changed || was !== bet.status;
}
// How the models did on the picks you tracked: what each said on average against how often those picks landed.
// Your own bets and any model parlays tracked earlier are kept apart: the top-level numbers are your bets, `model` is the model parlays.
export function summary(items) {
  return { ...summarize(items.filter(b => b.src !== 'model')), model: summarize(items.filter(b => b.src === 'model')) };
}
function summarize(items) {
  const bets = { n: items.length, hit: 0, miss: 0, pending: 0, void: 0 }, legs = { n: 0, hit: 0 }, per = Object.fromEntries(MODELS.map(m => [m, { n: 0, sum: 0, hit: 0, brier: 0 }]));
  for (const b of items) {
    bets[b.status === 'pending' ? 'pending' : b.status]++;
    for (const l of b.legs) {
      if (l.res !== 'hit' && l.res !== 'miss') continue;
      legs.n++; legs.hit += l.res === 'hit' ? 1 : 0;
      for (const m of MODELS) { const p = l.p && l.p[m]; if (p == null) continue; const o = per[m]; o.n++; o.sum += p; o.hit += l.res === 'hit' ? 1 : 0; o.brier += (p - (l.res === 'hit' ? 1 : 0)) ** 2; }
    }
  }
  return { bets, legs, models: Object.fromEntries(MODELS.map(m => { const o = per[m]; return [m, { n: o.n, said: o.n ? +(100 * o.sum / o.n).toFixed(1) : null, hit: o.n ? +(100 * o.hit / o.n).toFixed(1) : null, brier: o.n ? +(o.brier / o.n).toFixed(3) : null }]; })) };
}

// ---- storage: one small document, written only when a bet is added, changed or settled ----
export async function getBets(env) { return (await env.HUB.get('bets', 'json')) || { v: 1, items: [] }; }
export const saveBets = (env, doc) => env.HUB.put('bets', JSON.stringify(doc));
// The cards a set of legs refers to, one read per day.
export async function loadCards(env, legs) {
  const keys = [...new Set(legs.map(l => `${isNhl(l) ? 'nhl:' : ''}${l.date}`))], days = await Promise.all(keys.map(k => env.HUB.get(k.startsWith('nhl:') ? `nhl:day:${k.slice(4)}` : `day:${k}`, 'json'))), m = new Map();
  keys.forEach((k, i) => { const nhl = k.startsWith('nhl:'), d = nhl ? k.slice(4) : k; for (const c of days[i]?.cards || []) m.set(`${d}|${nhl ? 'nhl' : c.league}|${c.id}`, c); });
  return m;
}
export async function addBet(env, legs, now = new Date(), source = null) {
  const cards = await loadCards(env, legs || []), a = analyze(cards, legs);
  if (a.error) return a;
  const bet = { id: now.getTime().toString(36) + Math.random().toString(36).slice(2, 6), at: now.toISOString(), status: 'pending', ...(source === 'model' ? { src: 'model' } : {}), p: a.p, parlay: a.parlay, sameGame: a.sameGame,
    legs: a.legs.map(l => ({ date: l.date, league: l.league, id: l.id, ...(l.sport ? { sport: l.sport } : {}), market: l.market, sel: l.sel, ...(l.market === 'ou' ? { line: l.line, ...(l.src ? { src: l.src } : {}) } : {}), label: l.label, home: l.home, away: l.away, leagueName: l.leagueName, ko: l.ko, kickoff: l.kickoff, p: l.p, res: null })) };
  const doc = await getBets(env); doc.items.unshift(bet); doc.items = doc.items.slice(0, 300);
  await saveBets(env, doc);
  return { saved: true, bet };
}
// Open the list: settle anything whose games have finished (and save only if something changed).
export async function listBets(env) {
  const doc = await getBets(env), open = doc.items.filter(b => b.status === 'pending');
  if (open.length) {
    const cards = await loadCards(env, open.flatMap(b => b.legs));
    let dirty = false; for (const b of open) dirty = settle(b, cards) || dirty;
    if (dirty) await saveBets(env, doc);
  }
  return { items: doc.items, summary: summary(doc.items) };
}
export async function changeBet(env, id, action) {
  const doc = await getBets(env), i = doc.items.findIndex(b => b.id === id);
  if (i < 0) return { error: 'That bet was not found.' };
  if (action === 'delete') doc.items.splice(i, 1);
  else if (action === 'void') { const b = doc.items[i]; for (const l of b.legs) if (!l.res) l.res = 'void'; settle(b, new Map()); }
  else return { error: 'Unknown action.' };
  await saveBets(env, doc);
  return { ok: true };
}
