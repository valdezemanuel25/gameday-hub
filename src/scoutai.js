// Scout, run inside the Worker (Nov 3, 2026): the free-rein analyst on Cloudflare's own AI (Workers AI, the free daily allowance), so
// it costs no Claude usage. Twice a day (5:43 AM and 3:43 PM Central, a cron of its own) the Worker:
//   1. grades Scout's open bets from the saved days and writes the results into its log,
//   2. builds the board (src/scout.js board: the next 36 hours of priced games with every Hub model on them),
//   3. finds the edges in code (candidates): every market on every game, each Hub model's chance against DraftKings' margin-free
//      chance, how many models are above the price, and the move since the open; the best 10 go on, at most 2 a game, each with what
//      the Hub's own tests say about that kind of bet (evidence). The model does no arithmetic; every idea starts from the Hub.
//   4. reads ESPN's game summary for each of those games (injuries, lineups once posted, the last five results, headlines that name
//      a club): the outside check,
//   5. asks the model for the bets, with complete freedom (any market on those games, any number including none, stake 0.5-3 units),
//      each as a thesis in set parts: the edge in numbers, the models for it and against it, the price move, what ESPN said, what
//      would make it wrong, and whether the outside check confirmed, strengthened, weakened or flipped the idea,
//   6. asks the model again, as a critic, to argue against each bet; only bets that survive are taken (the critic's reason is kept),
//   7. saves the log (KV 'scout', one write a run).
// The model never sets a price: each bet takes DraftKings' price from the board at that moment. Market, stake, duplicates and timing are
// checked here (src/scout.js problem), not trusted to the model. Paper only.
import { board, problem, grade, record, daysToRead, cardsFrom, STAKE, LABEL } from './scout.js';
import { getAnalyst } from './analyst.js';

export const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
export const KEY = 'scout';
export const RUN_HOURS = [5, 15]; // Central; the cron fires at :43 of the UTC hours that can be these (standard and daylight time)
const KEEP_RUNS = 120, KEEP_BETS = 1500, KEEP_SHADOW = 2500;
const LEADS = ['v4', 'v5', 'v6', 'v2', 'move', 'shots', 'shotsGoalie', 'forebet', 'sportsmole', 'consensus', 'analyst', 'goalies', 'combo'];
const CHECKS = ['confirmed', 'strengthened', 'weakened', 'flipped', 'none'];
const am = m => (m > 0 ? '+' + m : String(m));
const ct = iso => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
const hourCT = now => +new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hourCycle: 'h23' }).format(now);
export const isRunTime = now => RUN_HOURS.includes(hourCT(now));

export async function getScout(env) { const d = await env.HUB.get(KEY, 'json'); return d && d.v === 1 && Array.isArray(d.bets) ? { ...d, runs: d.runs || [], shadow: d.shadow || [] } : { v: 1, bets: [], runs: [], shadow: [] }; }

// One game as one line of text for the model (short: a busy Saturday has 60+ games)
export function line(g, n) {
  const P = g.price, M = g.models || {}, f = g.fair || {}, x = [];
  const px = Object.keys(P).filter(k => k !== 'line').map(k => `${k} ${am(P[k])}`).join(' ');
  x.push(`#${n} ${g.sport === 'nhl' ? 'NHL' : g.leagueName || g.league} | ${g.home} v ${g.away} | ${ct(g.kickoff)} CT (${Math.round(g.minsToKickoff / 60)}h)`);
  x.push(`price ${px}${P.line ? ' (total ' + P.line + ')' : ''}`);
  if (Object.keys(g.open || {}).length) x.push('open ' + Object.keys(g.open).filter(k => k !== 'line').map(k => `${k} ${am(g.open[k])}`).join(' '));
  if (g.sport === 'nhl') {
    if (f.ml) x.push(`fair home ${f.ml[0]}%${f.openMl ? ' (open ' + f.openMl[0] + '%)' : ''}${f.total ? ', over ' + f.total[0] + '%' : ''}`);
    for (const k of ['v2', 'v4', 'v5']) if (M[k]) x.push(`${k} home ${M[k].homeWin}% over ${M[k].over}%`);
    if (M.modelLine != null) x.push(`model over line ${M.modelLine}`);
    if (M.shotsGoalie) x.push(`shots+goalie over5.5 ${M.shotsGoalie.over['5.5']}% over6.5 ${M.shotsGoalie.over['6.5']}%`);
    if (M.goalies) x.push(`goalies ${M.goalies.home || '?'} / ${M.goalies.away || '?'}`);
  } else {
    if (f['1x2']) x.push(`fair H/D/A ${f['1x2'].join('/')}${f.open1x2 ? ' (open ' + f.open1x2.join('/') + ')' : ''}${f.ou ? ' over ' + f.ou[0] + (f.openOu ? ' (open ' + f.openOu[0] + ')' : '') : ''}${f.btts ? ' btts ' + f.btts[0] : ''}`);
    for (const k of ['v4', 'v5', 'v6', 'v2']) if (M[k]) x.push(`${k} ${M[k].p.join('/')} o${M[k].over} b${M[k].btts}${k === 'v4' && M[k].top ? ' top ' + M[k].top.map(s => s[0]).join(',') : ''}`);
    if (M.forebet) x.push(`forebet ${M.forebet.p ? M.forebet.p.join('/') : ''}${M.forebet.over != null ? ' o' + M.forebet.over : ''}${M.forebet.btts != null ? ' b' + M.forebet.btts : ''}${M.forebet.score ? ' ' + M.forebet.score.h + '-' + M.forebet.score.a : ''}`);
    if (M.sportsmole) x.push(`sportsmole "${String(M.sportsmole).slice(0, 80)}"`);
    if (M.shots && M.shots.over != null) x.push(`shots read over ${M.shots.over}% (${M.shots.vsPrice >= 0 ? '+' : ''}${M.shots.vsPrice} v price${M.shots.tested ? '' : ', untested league'})`);
  }
  if (M.hubPick) { const h = M.hubPick; x.push(`hub pick ${h.k || ''} ${h.key || h.pick || h.w || ''}${h.p != null ? ' ' + h.p + '%' : ''}`.replace(/\s+/g, ' ').trim()); }
  if (g.analystBets) x.push('analyst bet ' + g.analystBets.join('; '));
  if (g.scoutHas) x.push('you hold ' + g.scoutHas.join(', '));
  return x.join(' | ');
}

// What Scout has learned so far, for the prompt
export function lessons(R, settled) {
  const s = R.all, by = o => Object.entries(o).filter(([, v]) => v.settled).sort((a, b) => b[1].settled - a[1].settled).slice(0, 6).map(([k, v]) => `${k} ${v.wins}-${v.settled - v.wins} ${v.units >= 0 ? '+' : ''}${v.units}u clv ${v.clv ?? '-'}%`).join('; ');
  const head = s.settled ? `Your record: ${s.wins}-${s.settled - s.wins}, ${s.units >= 0 ? '+' : ''}${s.units}u, ROI ${s.roi}%, vs close ${s.clv ?? '-'}%. By lead: ${by(R.lead) || 'none yet'}. By market: ${by(R.market) || 'none yet'}. By outside check: ${by(R.outside) || 'none yet'}.` : 'No settled bets yet: this is the start of your record.';
  const last = settled.slice(0, 8).map(b => `${b.res} ${b.units >= 0 ? '+' : ''}${b.units}u clv ${b.clv ?? '-'}%: ${LABEL[b.key]}${b.line ? ' ' + b.line : ''} ${b.home} v ${b.away} (${b.lead}) "${String(b.why).slice(0, 120)}"`).join('\n');
  return head + (last ? '\nLatest results:\n' + last : '');
}

// ---- the edges, found in code ----
const IDX = { H: 0, D: 1, A: 2 };
const num = x => (typeof x === 'number' && Number.isFinite(x) ? x : null);
// One market on one game: DraftKings' margin-free chance now and at the open, and each Hub model's chance -> { fair, open, models: [[name, %]] } | null
export function readsFor(g, key) {
  const f = g.fair || {}, M = g.models || {}, out = [];
  const side = (v, k) => (v == null ? null : k ? v : 100 - v);
  let fair = null, open = null;
  if (g.sport === 'nhl') {
    if (key === 'H' || key === 'A') { const i = key === 'H' ? 0 : 1; fair = f.ml ? f.ml[i] : null; open = f.openMl ? f.openMl[i] : null;
      for (const k of ['v2', 'v4', 'v5']) if (M[k] && num(M[k].homeWin) != null) out.push([k, side(M[k].homeWin, key === 'H')]); }
    else { fair = f.total ? f.total[key === 'O' ? 0 : 1] : null; const ln = g.price.line;
      if (M.modelLine != null && M.modelLine === ln) for (const k of ['v2', 'v4', 'v5']) if (M[k] && num(M[k].over) != null) out.push([k, side(M[k].over, key === 'O')]);
      const sg = M.shotsGoalie && M.shotsGoalie.over && num(M.shotsGoalie.over[String(ln)]); if (sg != null) out.push(['shots+goalie', side(sg, key === 'O')]); }
  } else {
    if (key in IDX) { fair = f['1x2'] ? f['1x2'][IDX[key]] : null; open = f.open1x2 ? f.open1x2[IDX[key]] : null; }
    else if (key === 'O' || key === 'U') { fair = f.ou ? f.ou[key === 'O' ? 0 : 1] : null; open = f.openOu ? f.openOu[key === 'O' ? 0 : 1] : null; }
    else fair = f.btts ? f.btts[key === 'B' ? 0 : 1] : null;
    const one = (name, m) => { if (!m) return; const v = key in IDX ? (Array.isArray(m.p) ? num(m.p[IDX[key]]) : null) : key === 'O' || key === 'U' ? side(num(m.over), key === 'O') : side(num(m.btts), key === 'B'); if (v != null) out.push([name, v]); };
    for (const k of ['v4', 'v5', 'v6', 'v2']) one(k, M[k]);
    one('forebet', M.forebet);
    if ((key === 'O' || key === 'U') && M.shots && num(M.shots.over) != null) out.push(['shots', side(M.shots.over, key === 'O')]);
  }
  return fair == null || !out.length ? null : { fair, open, models: out.map(([n, v]) => [n, Math.round(10 * v) / 10]) };
}
// Every market on every game, ranked: average edge over the price, the best single edge, and a move toward it count. -> top N (2 a game at most)
export function candidates(games, N = 10) {
  const all = [];
  games.forEach((g, gi) => { for (const key of Object.keys(g.price)) { if (key === 'line') continue; const r = readsFor(g, key); if (!r) continue;
    const e = r.models.map(([, v]) => v - r.fair), avg = e.reduce((a, b) => a + b, 0) / e.length, best = Math.max(...e), move = r.open != null ? r.fair - r.open : null;
    const shots = r.models.find(([n]) => n === 'shots' || n === 'shots+goalie'), se = shots ? shots[1] - r.fair : null;
    if (!(avg >= 2 || best >= 5 || (se != null && se >= 3))) continue;
    all.push({ gi, key, price: g.price[key], fair: r.fair, open: r.open, models: r.models, avg: Math.round(10 * avg) / 10, best: Math.round(10 * best) / 10, agree: e.filter(x => x > 0).length, n: e.length, move: move == null ? null : Math.round(10 * move) / 10, score: avg + 0.25 * best + (move > 0 ? 0.2 * move : 0) }); } });
  all.sort((a, b) => b.score - a.score);
  const per = new Map(), out = [];
  for (const c of all) { const k = per.get(c.gi) || 0; if (k >= 2) continue; per.set(c.gi, k + 1); out.push(c); if (out.length >= N) break; }
  return out;
}
// What the Hub's own tests and live record say about this kind of bet (README: backtests and the live reviews)
export function evidence(g, c) {
  const e = [], k = c.key, M = g.models || {}, f = g.fair || {};
  if (g.sport === 'nhl') {
    if (k === 'H') e.push("In the Hub's live hockey review so far, home teams have been overrated (won less often than expected); small sample.");
    if (k === 'O') e.push("Overs have been hitting in the Hub's live hockey sample.");
    if (c.models.some(([n]) => n === 'shots+goalie')) e.push('Shots + goalie is tracking only: in the backtest it improved the Over 5.5 read a little (log loss 0.679 v 0.682); when the goalie moved it 3+ points up, Over hit 70% (10 games).');
    if (c.models.some(([n]) => n === 'v2')) e.push("Betting the price over v2 went 6-6, -16% out of sample in the hockey review.");
    if (c.models.some(([n]) => n === 'v5')) e.push('v5 has not beaten v4 in hockey so far.');
  } else {
    if (k in IDX && c.price > 150) e.push('Winner bets longer than +150 lost about 15% in the two-season backtest (following the move); the Analyst no longer takes them.');
    if (k in IDX && c.move != null && c.move >= 3) e.push('Following a 3+ point winner move at +150 or shorter: -3.8% at the closing price in the backtest. The move alone is not an edge.');
    const sh = c.models.find(([n]) => n === 'shots');
    if (k === 'O' && sh && sh[1] - c.fair >= 3) e.push(M.shots && M.shots.tested ? 'Shots read 3+ points over the price on Over 2.5: +6.5% out of sample in the top-league backtest (second divisions +4.5%).' : 'The shots read is untested in this league (it helped MLS a little in a no-price backtest and made the Brasileirao worse).');
    if (k === 'U') e.push('Under 2.5 at the lineup read lost 9.2% in the two-season backtest; the Analyst benched it.');
    const dog = f['1x2'] && f.open1x2 ? [0, 2].find(i => f['1x2'][i] < 35 && f['1x2'][i] - f.open1x2[i] >= 3) : undefined;
    if (dog !== undefined && k === 'B') e.push('Games where the underdog was backed down 3+ points: Both score Yes hit 65% in the Hub sample.');
    if (dog !== undefined && k === 'O') e.push('Over 2.5 in place of a backed long-shot winner: +3.2% in the backtest (+12% at Pinnacle prices).');
  }
  return e;
}
const sg = x => (x > 0 ? '+' : '') + x;
export const candText = (g, c) => `  Candidate ${LABEL[c.key]}${g.sport === 'nhl' && (c.key === 'O' || c.key === 'U') ? ' ' + g.price.line : ''} at ${am(c.price)}: fair ${c.fair}% | ${c.models.map(([n, v]) => `${n} ${v} (${sg(Math.round(10 * (v - c.fair)) / 10)})`).join(', ')} | ${c.agree} of ${c.n} models above the price${c.move != null ? ` | price move ${sg(c.move)} since the open` : ''}`
  + (evidence(g, c).length ? '\n    Hub evidence: ' + evidence(g, c).join(' ') : '');
// What each Hub model said on a bet, from the numbers (not the model's words)
export function modelsOf(g, key) { const r = readsFor(g, key); if (!r) return {}; const o = { DraftKings: `${r.fair}% fair${r.open != null ? ', ' + r.open + '% at the open' : ''}` }; for (const [n, v] of r.models) o[n] = `${v}% (${sg(Math.round(10 * (v - r.fair)) / 10)})`; return o; }

const SYS = `You are Scout, a free-rein paper bettor for the Game Day Hub. Your job: find an edge using the Hub's system.
You have no rules on what to take: any market listed in a game's price (soccer H D A = home/draw/away, O U = Over/Under 2.5, B N = Both score Yes/No; NHL H A = moneyline, O U = the total shown), any number of bets including none, stake 0.5 to 3 units by conviction. You may agree or disagree with the Analyst and any model.
The one prerequisite: every idea must start from the Hub's board (a model against the margin-free price, a price move from the open, the shots read, shots+goalie, Forebet/SportsMole, models agreeing or disagreeing, the Analyst's bet). Outside news may confirm or change the idea but is never the starting point.
Think in numbers: an edge is a model chance above the margin-free price, or a move the models back. Beating the closing price is the first sign of a real edge. Paper bets only.
Answer with JSON only.`;

async function ask(env, user, schema, maxTokens, sys = SYS) {
  const r = await env.AI.run(env.SCOUT_MODEL || MODEL, { messages: [{ role: 'system', content: sys }, { role: 'user', content: user }], max_tokens: maxTokens, temperature: 0.4,
    response_format: { type: 'json_schema', json_schema: schema } });
  const out = r && r.response !== undefined ? r.response : r;
  if (out && typeof out === 'object') return out;
  const t = String(out || ''), a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('the model gave no JSON');
  return JSON.parse(t.slice(a, b + 1));
}
const TH = ['edge', 'agree', 'against', 'move', 'outsideSaid', 'risk'];
const S2 = { type: 'object', properties: { bets: { type: 'array', items: { type: 'object', properties: {
  n: { type: 'integer' }, key: { type: 'string', enum: ['H', 'D', 'A', 'O', 'U', 'B', 'N'] }, stake: { type: 'number' }, conf: { type: 'integer' }, lead: { type: 'string', enum: LEADS },
  edge: { type: 'string' }, agree: { type: 'string' }, against: { type: 'string' }, move: { type: 'string' }, outsideSaid: { type: 'string' }, risk: { type: 'string' },
  why: { type: 'string' }, outsideCheck: { type: 'string', enum: CHECKS }, used: { type: 'array', items: { type: 'integer' } } },
  required: ['n', 'key', 'stake', 'lead', 'edge', 'agree', 'against', 'risk', 'why', 'outsideCheck'] } }, note: { type: 'string' } }, required: ['bets', 'note'] };
const S3 = { type: 'object', properties: { verdicts: { type: 'array', items: { type: 'object', properties: { i: { type: 'integer' }, keep: { type: 'boolean' }, reason: { type: 'string' } }, required: ['i', 'keep', 'reason'] } } }, required: ['verdicts'] };
const CRITIC = `You are the critic for Scout, a paper bettor. For each proposed bet, make the strongest honest case that it is NOT an edge: models that disagree, a thin edge (under 3 points), the price already past the models' fair number, Hub evidence against this kind of bet, outside news, a long price. Then judge: keep = true only if the case for the bet is still stronger. Answer with JSON only.`;

// ESPN's game summary for the outside check -> [{ src, url, note }] (numbered for the model to cite)
const SPORT_PATH = g => (g.sport === 'nhl' ? 'hockey/nhl' : `soccer/${g.league}`);
const pageOf = g => (g.sport === 'nhl' ? `https://www.espn.com/nhl/game/_/gameId/${g.gid}` : `https://www.espn.com/soccer/match/_/gameId/${g.gid}`);
export function outsideFrom(g, j) {
  const out = [], page = pageOf(g), words = n => String(n || '').toLowerCase().split(/\s+/).filter(w => w.length > 3);
  for (const t of (j && j.injuries) || []) {
    const list = (t.injuries || []).filter(x => x && x.status && !/^active$/i.test(x.status)).slice(0, 6)
      .map(x => `${x.athlete && x.athlete.displayName}${x.athlete && x.athlete.position ? ' (' + x.athlete.position.abbreviation + ')' : ''} ${x.status}${x.details && x.details.type ? ', ' + x.details.type : ''}${x.details && x.details.returnDate ? ', back ' + x.details.returnDate : ''}`);
    if (list.length) out.push({ src: 'ESPN injuries', url: page, note: `${t.team && t.team.abbreviation}: ${list.join('; ')}` });
  }
  for (const r of (j && j.rosters) || []) {
    const st = (r.roster || []).filter(x => x.starter);
    if (st.length) out.push({ src: 'ESPN lineup', url: page, note: `${r.team && r.team.abbreviation} lineup posted: ${st.map(x => x.athlete && x.athlete.displayName).join(', ')}` });
  }
  const l5 = ((j && j.lastFiveGames) || []).map(t => `${t.team && t.team.abbreviation} ${(t.events || []).map(e => (e.gameResult || '') + ' ' + (e.score || '')).join(', ')}`);
  if (l5.length) out.push({ src: 'ESPN last five', url: page, note: l5.join(' | ') });
  const names = [...words(g.home), ...words(g.away)];
  for (const a of ((j && j.news && j.news.articles) || []).filter(a => names.some(w => String(a.headline || '').toLowerCase().includes(w))).slice(0, 3))
    out.push({ src: 'ESPN news', url: (a.links && a.links.web && a.links.web.href) || page, note: `${a.headline}${a.description ? ': ' + String(a.description).slice(0, 140) : ''}` });
  return out;
}
async function outside(g, fetchFn) {
  try { const r = await fetchFn(`https://site.api.espn.com/apis/site/v2/sports/${SPORT_PATH(g)}/summary?event=${g.gid}`); return r.ok ? outsideFrom(g, await r.json()) : []; } catch (e) { return []; }
}

const SOCCER_M = new Set(['H', 'D', 'A', 'O', 'U', 'B', 'N']), NHL_M = new Set(['H', 'A', 'O', 'U']);
// One bet from the model's answer, priced from the board; null when it can't be taken
export function makeBet(x, g, srcs, now) {
  if (!g || !x) return null;
  const key = String(x.key || '').toUpperCase();
  if (!(g.sport === 'nhl' ? NHL_M : SOCCER_M).has(key) || g.price[key] == null) return null;
  if ((g.scoutHas || []).some(h => h.startsWith(LABEL[key]))) return null;
  const used = Array.isArray(x.used) ? x.used.map(i => srcs[i]).filter(Boolean) : [];
  const b = { id: `${g.date}-${g.sport}-${g.gid}-${key}`, at: now.toISOString(), sport: g.sport, date: g.date, league: g.league, ...(g.leagueName ? { leagueName: g.leagueName } : {}), gid: String(g.gid),
    home: g.home, away: g.away, kickoff: g.kickoff, key, ...(g.sport === 'nhl' && (key === 'O' || key === 'U') ? { line: g.price.line } : {}), price: g.price[key],
    ...(key === 'B' || key === 'N' ? { bttsBook: g.bttsBook || 'draftkings' } : {}),
    stake: Math.min(STAKE.max, Math.max(STAKE.min, Math.round(2 * (Number(x.stake) || 1)) / 2)), conf: Math.min(5, Math.max(1, Math.round(Number(x.conf) || 3))),
    lead: LEADS.includes(x.lead) ? x.lead : 'combo', why: String(x.why || '').slice(0, 600),
    thesis: Object.fromEntries(TH.filter(t => x[t]).map(t => [t, String(x[t]).slice(0, 300)])), models: modelsOf(g, key),
    outside: used, outsideCheck: CHECKS.includes(x.outsideCheck) ? x.outsideCheck : used.length ? 'confirmed' : 'none', by: 'workers-ai' };
  return problem(b) ? null : b;
}

// The shadow log: the baseline (every code-found edge at 1 unit) and the bets the critic dropped, graded like Scout's own. Slim: only
// what grading needs. A game-market already in the shadow log for that kind is not added again.
export function shadowOf(g, key, kind, now, lead) {
  return { id: `${kind}-${g.date}-${g.sport}-${g.gid}-${key}`, kind, at: now.toISOString(), sport: g.sport, date: g.date, league: g.league, gid: String(g.gid), home: g.home, away: g.away, kickoff: g.kickoff, key,
    ...(g.sport === 'nhl' && (key === 'O' || key === 'U') ? { line: g.price.line } : {}), price: g.price[key], ...(key === 'B' || key === 'N' ? { bttsBook: g.bttsBook || 'draftkings' } : {}), stake: 1, lead: lead || 'combo', why: kind };
}
const shadowAdd = (doc, b) => { if (b && b.price != null && !doc.shadow.some(x => x.id === b.id)) doc.shadow.unshift(b); };

// The run. opts.force: run now whatever the hour (the "Run Scout now" button). Never throws.
export async function scoutStep(env, now = new Date(), fetchFn = fetch, { force = false, alert = null } = {}) {
  if (!force && !isRunTime(now)) return { skipped: 'not a run time' };
  if (!env.AI) return { error: 'Workers AI is not bound (wrangler.toml [ai] binding = "AI")' };
  const doc = await getScout(env);
  try {
    if (!force && doc.runs[0] && !doc.runs[0].error && now.getTime() - new Date(doc.runs[0].at).getTime() < 3 * 3600000) return { skipped: 'ran in the last 3 hours' };
    // 1. results into the log
    const names = daysToRead([...doc.bets, ...doc.shadow]), docs = await Promise.all(names.map(n => env.HUB.get(n, 'json'))), cards = cardsFrom(names, docs);
    const G = grade(doc.bets, cards, now), byId = new Map(G.map(b => [b.id, b]));
    for (const b of doc.bets) { const x = byId.get(b.id); if (!b.res && x && x.res) Object.assign(b, { res: x.res, units: x.units, close: x.close, clv: x.clv, ...(x.score ? { score: x.score } : {}) }); }
    const GS = grade(doc.shadow, cards, now), sById = new Map(GS.map(b => [b.id, b]));
    for (const b of doc.shadow) { const x = sById.get(b.id); if (!b.res && x && x.res) Object.assign(b, { res: x.res, units: x.units, clv: x.clv }); }
    const R = record(G), settled = G.filter(b => b.status === 'settled').sort((a, b) => (a.kickoff < b.kickoff ? 1 : -1));
    // 2. the board
    const d0 = localDay(now), dates = [d0, addDay(d0, 1), addDay(d0, 2)];
    const [sd, nd, an] = await Promise.all([Promise.all(dates.map(d => env.HUB.get(`day:${d}`, 'json'))), Promise.all(dates.map(d => env.HUB.get(`nhl:day:${d}`, 'json'))), getAnalyst(env, { readOnly: true }).catch(() => ({ items: [] }))]);
    const games = board({ soccer: Object.fromEntries(dates.map((d, i) => [d, sd[i]?.cards || []])), nhl: Object.fromEntries(dates.map((d, i) => [d, nd[i]?.cards || []])) }, now, (an.items || []).filter(b => !b.res), doc.bets)
      .filter(g => g.minsToKickoff >= 30).slice(0, 70);
    let took = [], note = '';
    if (!games.length) note = 'No priced games in the next 36 hours.';
    else {
      // 3. the edges, in code
      const C = candidates(games), gis = [...new Set(C.map(c => c.gi))];
      // the baseline: every code-found edge taken at 1 unit, graded beside Scout (does the model's judgment add anything?)
      for (const c of C) shadowAdd(doc, shadowOf(games[c.gi], c.key, 'baseline', now, c.models.reduce((a, m) => (m[1] - c.fair > a[1] - c.fair ? m : a))[0]));
      if (!C.length) note = "Read the board: no market had the Hub's models 2+ points above the price.";
      else {
        // 4. outside check
        const srcs = [], per = await Promise.all(gis.map(gi => outside(games[gi], fetchFn)));
        const blocks = gis.map((gi, k) => `${line(games[gi], gi)}\n${C.filter(c => c.gi === gi).map(c => candText(games[gi], c)).join('\n')}\n  Outside (ESPN):\n${per[k].map(x => { srcs.push(x); return `    [${srcs.length - 1}] ${x.src}: ${x.note}`; }).join('\n') || '    (ESPN had nothing on this game)'}`).join('\n\n');
        // 5. the bets, as theses
        const a2 = await ask(env, `${lessons(R, settled)}\n\nThe Hub's best edges right now (the code found them: model chance v DraftKings' margin-free chance; edges in points), with what the Hub's own tests say and ESPN's notes:\n\n${blocks}\n\nDecide your bets. You may take any market on these games (not only the candidates), several or none. For each bet give: n (the game #), key, stake (0.5-3), conf (1-5), lead (the Hub signal it started from), and the thesis in parts: edge (the edge in numbers), agree (models for it), against (models or evidence against it), move (the price move and what it means), outsideSaid (what ESPN said that matters, or nothing), risk (what would make it wrong), why (one sentence summing it up), outsideCheck (confirmed, strengthened, weakened, flipped = not where the Hub's models pointed, or none) and used (the [numbers] of the ESPN notes you relied on). Then note: up to 3 sentences on what you took, notable passes and why, and one lesson from your record. Return {"bets":[...],"note":"..."}.`, S2, 2200);
        const prop = [];
        for (const x of (a2 && a2.bets) || []) { const gi = Number(x.n); if (!gis.includes(gi)) continue; const b = makeBet(x, games[gi], srcs, now); if (b && !doc.bets.some(o => o.id === b.id) && !prop.some(o => o.id === b.id)) prop.push(b); }
        note = String((a2 && a2.note) || '').slice(0, 600);
        // 6. the critic
        if (prop.length) {
          let V = null;
          try { V = await ask(env, `Proposed bets:\n\n${prop.map((b, i) => { const g = games.find(x => String(x.gid) === b.gid && x.sport === b.sport); const c = C.find(y => games[y.gi] === g && y.key === b.key);
            return `[${i}] ${b.home} v ${b.away}: ${LABEL[b.key]}${b.line ? ' ' + b.line : ''} at ${am(b.price)}, stake ${b.stake}\n  the numbers: ${c ? candText(g, c).trim() : Object.entries(b.models).map(([k, v]) => k + ' ' + v).join(', ')}\n  thesis: ${TH.filter(t => b.thesis[t]).map(t => t + ': ' + b.thesis[t]).join(' | ')}\n  outside: ${b.outside.map(o => o.note).join(' | ') || 'none'}`; }).join('\n\n')}\n\nFor each bet [i]: keep (true or false) and reason (one or two sentences). Return {"verdicts":[...]}.`, S3, 900, CRITIC); } catch (e) { V = null; }
          const vs = new Map(((V && V.verdicts) || []).map(v => [Number(v.i), v]));
          const dropped = [];
          prop.forEach((b, i) => { const v = vs.get(i); if (v && v.keep === false) { shadowAdd(doc, { ...shadowOf(games.find(g => String(g.gid) === b.gid && g.sport === b.sport), b.key, 'dropped', now, b.lead), stake: b.stake }); dropped.push(`${LABEL[b.key]} ${b.home} v ${b.away} (${String(v.reason || '').slice(0, 120)})`); return; } if (v) b.critic = String(v.reason || '').slice(0, 300); else b.critic = V ? 'no verdict' : 'the critic did not answer'; took.push(b); });
          if (dropped.length) note = (note ? note + ' ' : '') + 'The critic dropped: ' + dropped.join('; ') + '.';
        }
        if (!note) note = took.length ? '' : 'Checked the edges and passed.';
      }
    }
    // 7. save
    for (const b of took) b.model = env.SCOUT_MODEL || MODEL;
    doc.bets = [...took, ...doc.bets].slice(0, KEEP_BETS);
    doc.shadow = doc.shadow.slice(0, KEEP_SHADOW);
    doc.runs = [{ at: now.toISOString(), looked: games.length, took: took.length, note, model: env.SCOUT_MODEL || MODEL }, ...doc.runs].slice(0, KEEP_RUNS);
    doc.updated = now.toISOString();
    await env.HUB.put(KEY, JSON.stringify(doc));
    if (took.length && alert) { try { await alert({ title: `Scout: ${took.length} new bet${took.length > 1 ? 's' : ''}`, body: took.map(b => `${LABEL[b.key]}${b.line ? ' ' + b.line : ''} ${b.home} v ${b.away} ${am(b.price)}, ${b.stake}u`).join(' · ').slice(0, 220), tag: 'scout', url: '/home?scout=1' }); } catch (e) { /* the bet stands; the alert is a bonus */ } }
    return { ok: true, looked: games.length, took: took.length, bets: took.map(b => `${b.home} v ${b.away}: ${LABEL[b.key]}${b.line ? ' ' + b.line : ''} ${am(b.price)} x${b.stake}`) };
  } catch (e) {
    const msg = String(e && e.message || e).slice(0, 160);
    try { doc.runs = [{ at: now.toISOString(), looked: 0, took: 0, note: `The run failed: ${msg}`, error: true }, ...doc.runs].slice(0, KEEP_RUNS); await env.HUB.put(KEY, JSON.stringify(doc)); } catch (e2) { /* nothing more to do */ }
    return { error: msg };
  }
}
const localDay = now => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
const addDay = (d, n) => new Date(new Date(d + 'T12:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);
