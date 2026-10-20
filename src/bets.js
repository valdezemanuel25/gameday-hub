// Bet analyzer and tracker (soccer). Pure functions plus two small storage helpers.
//   A bet is one or more legs. A leg is one pick on one game: { date, league, id, market, sel, line? }.
//     market 'win'  sel H | D | A              market 'dc'   sel 1X | X2 | 12 (home or draw, away or draw, no draw)
//     market 'ou'   sel O | U, line 0.5 .. 5.5   market 'btts' sel Y | N
//   Probabilities come from the cards' own v2 and v4 numbers (and Forebet where it publishes the same market). Odds are never used.
//   Legs on different games multiply; legs on the same game are scored together on that model's score grid.
//   Settlement reads the finished score the Hub already grades from: a bet is stored once and settles by itself.

const MAXG = 11;
export const LINES = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5];
const MODELS = ['v2', 'v4', 'fb'];

function pois(l) { const p = [Math.exp(-l)]; for (let k = 1; k < MAXG; k++) p.push(p[k - 1] * l / k); return p; }
// The model's score grid: P(home scores x, away scores y), rescaled to add up to 1.
export function scoreGrid(lh, la) {
  const ph = pois(lh), pa = pois(la), cells = []; let tot = 0;
  for (let x = 0; x < MAXG; x++) for (let y = 0; y < MAXG; y++) { const p = ph[x] * pa[y]; tot += p; cells.push([x, y, p]); }
  return cells.map(([x, y, p]) => [x, y, p / tot]);
}

export function validLeg(l) {
  if (!l || !l.date || !l.league || !l.id) return 'Pick a game first.';
  const ok = { win: ['H', 'D', 'A'], dc: ['1X', 'X2', '12'], ou: ['O', 'U'], btts: ['Y', 'N'] }[l.market];
  if (!ok || !ok.includes(l.sel)) return 'Pick what you are betting on.';
  if (l.market === 'ou' && !LINES.includes(Number(l.line))) return 'Choose a goals line between 0.5 and 5.5.';
  return null;
}
// The rule a final score has to meet for this leg to win.
export function test(l) {
  const line = Number(l.line);
  switch (l.market) {
    case 'win': return (h, a) => (l.sel === 'H' ? h > a : l.sel === 'D' ? h === a : h < a);
    case 'dc': return (h, a) => (l.sel === '1X' ? h >= a : l.sel === 'X2' ? h <= a : h !== a);
    case 'ou': return (h, a) => (l.sel === 'O' ? h + a > line : h + a < line);
    default: return (h, a) => ((h > 0 && a > 0) === (l.sel === 'Y'));
  }
}
export function label(l, c) {
  const home = c ? c.home : 'Home', away = c ? c.away : 'Away';
  if (l.market === 'win') return l.sel === 'H' ? `${home} to win` : l.sel === 'A' ? `${away} to win` : 'Draw';
  if (l.market === 'dc') return l.sel === '1X' ? `${home} or draw` : l.sel === 'X2' ? `${away} or draw` : `${home} or ${away} (no draw)`;
  if (l.market === 'ou') return `${l.sel === 'O' ? 'Over' : 'Under'} ${Number(l.line)} goals`;
  return l.sel === 'Y' ? 'Both teams to score' : 'Both teams not to score';
}

// What a model says about a game, in one shape. Forebet only has 1X2, Over/Under 2.5 and Both teams to score.
const srcOf = (c, m) => { const x = c && (m === 'fb' ? c.fb : c[m]); return x ? { p: x.p || null, over: x.over ?? null, btts: x.btts ?? null, lam: m === 'fb' ? null : x.lam || null } : null; };

// One leg on one model. Uses the model's own published number where the card has it (winner, Over/Under 2.5, Both score);
// any other goals line comes from that model's score grid.
export function legProb(c, l, m) {
  const s = srcOf(c, m); if (!s) return null;
  if (l.market === 'win' || l.market === 'dc') {
    if (!s.p) return null; const [h, d, a] = s.p.map(x => x / 100);
    return l.market === 'win' ? (l.sel === 'H' ? h : l.sel === 'D' ? d : a) : (l.sel === '1X' ? h + d : l.sel === 'X2' ? d + a : h + a);
  }
  if (l.market === 'ou' && Number(l.line) === 2.5 && s.over != null) return l.sel === 'O' ? s.over / 100 : 1 - s.over / 100;
  if (l.market === 'btts' && s.btts != null) return l.sel === 'Y' ? s.btts / 100 : 1 - s.btts / 100;
  return s.lam ? jointProb(c, [l], m, true) : null;
}
// Several legs on the same game, together: the chance that one final score satisfies all of them.
export function jointProb(c, legs, m, force = false) {
  if (!force && legs.length === 1) return legProb(c, legs[0], m);
  const s = srcOf(c, m); if (!s || !s.lam) return null;
  const tests = legs.map(test); let sum = 0;
  for (const [x, y, p] of scoreGrid(s.lam[0], s.lam[1])) if (tests.every(f => f(x, y))) sum += p;
  return sum;
}
export const gameKey = l => `${l.date}|${l.league}|${l.id}`;

// cards: Map of gameKey -> card. Returns each leg with its label and probability per model, and the whole bet's chance.
export function analyze(cards, legs) {
  if (!Array.isArray(legs) || !legs.length) return { error: 'Add at least one pick.' };
  if (legs.length > 12) return { error: 'A bet can have up to 12 picks.' };
  for (const l of legs) { const e = validLeg(l); if (e) return { error: e }; }
  const groups = new Map();
  for (const l of legs) { const k = gameKey(l); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(l); }
  for (const [k, g] of groups) {
    const dup = new Set(g.map(l => l.market + (l.market === 'ou' ? l.line : '')));
    if (dup.size < g.length) return { error: 'Two picks on the same game use the same market. Remove one.' };
    const c = cards.get(k); if (!c) return { error: 'That game was not found. Reload and try again.' };
    if (!c.v2) return { error: `No prediction for ${c.home} vs ${c.away} yet.` };
    if (c.final) return { error: `${c.home} vs ${c.away} has finished, so it can't be analyzed.` };
  }
  const out = legs.map(l => { const c = cards.get(gameKey(l)); return { ...l, line: l.market === 'ou' ? Number(l.line) : undefined, label: label(l, c), home: c.home, away: c.away, leagueName: c.leagueName, kickoff: c.kickoff, ko: c.ko, p: Object.fromEntries(MODELS.map(m => [m, legProb(c, l, m)])), grid: l.market === 'ou' && Number(l.line) !== 2.5 }; });
  const p = {};
  for (const m of MODELS) {
    let acc = 1;
    for (const [k, g] of groups) { const v = jointProb(cards.get(k), g, m); if (v == null) { acc = null; break; } acc *= v; }
    p[m] = acc;
  }
  const sameGame = [...groups.values()].some(g => g.length > 1);
  return { legs: out, p, games: groups.size, sameGame, parlay: legs.length > 1 };
}

// ---- settling and summary ----
export function settle(bet, cards) {
  let changed = false;
  for (const l of bet.legs) {
    if (l.res) continue;
    const c = cards.get(gameKey(l));
    if (c && c.final) { l.res = test(l)(c.final.h, c.final.a) ? 'hit' : 'miss'; changed = true; }
  }
  const was = bet.status;
  bet.status = bet.legs.some(l => l.res === 'miss') ? 'miss' : bet.legs.every(l => l.res) ? (bet.legs.every(l => l.res === 'void') ? 'void' : 'hit') : 'pending';
  if (bet.status !== 'pending' && !bet.settledAt) { bet.settledAt = new Date().toISOString(); changed = true; }
  return changed || was !== bet.status;
}
// How the models did on the picks you tracked: what each said on average against how often those picks landed.
export function summary(items) {
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
  const dates = [...new Set(legs.map(l => l.date))], days = await Promise.all(dates.map(d => env.HUB.get(`day:${d}`, 'json'))), m = new Map();
  dates.forEach((d, i) => { for (const c of days[i]?.cards || []) m.set(`${d}|${c.league}|${c.id}`, c); });
  return m;
}
export async function addBet(env, legs, now = new Date()) {
  const cards = await loadCards(env, legs || []), a = analyze(cards, legs);
  if (a.error) return a;
  const bet = { id: now.getTime().toString(36) + Math.random().toString(36).slice(2, 6), at: now.toISOString(), status: 'pending', p: a.p, parlay: a.parlay, sameGame: a.sameGame,
    legs: a.legs.map(l => ({ date: l.date, league: l.league, id: l.id, market: l.market, sel: l.sel, ...(l.market === 'ou' ? { line: l.line } : {}), label: l.label, home: l.home, away: l.away, leagueName: l.leagueName, ko: l.ko, kickoff: l.kickoff, p: l.p, res: null })) };
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
