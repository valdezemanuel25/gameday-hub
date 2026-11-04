// Scout, run inside the Worker (Nov 3, 2026): the free-rein analyst on Cloudflare's own AI (Workers AI, the free daily allowance), so
// it costs no Claude usage. Twice a day (5:43 AM and 3:43 PM Central, a cron of its own) the Worker:
//   1. grades Scout's open bets from the saved days and writes the results into its log,
//   2. builds the board (src/scout.js board: the next 36 hours of priced games with every Hub model on them),
//   3. asks the model for a shortlist: the games where something in the Hub's models looks like an edge (the one prerequisite: every
//      idea starts from the board),
//   4. reads ESPN's game summary for each shortlisted game (injuries, lineups once posted, the last five results, headlines that name
//      a club): the outside check,
//   5. asks the model for the bets, with complete freedom (any market the Hub prices, any number including none, stake 0.5-3 units),
//      what it took and why, and whether the outside check confirmed, strengthened, weakened or flipped the idea,
//   6. saves the log (KV 'scout', one write a run).
// The model never sets a price: each bet takes DraftKings' price from the board at that moment. Market, stake, duplicates and timing are
// checked here (src/scout.js problem), not trusted to the model. Paper only.
import { board, problem, grade, record, daysToRead, cardsFrom, STAKE, LABEL } from './scout.js';
import { getAnalyst } from './analyst.js';

export const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
export const KEY = 'scout';
export const RUN_HOURS = [5, 15]; // Central; the cron fires at :43 of the UTC hours that can be these (standard and daylight time)
const SHORT = 6, KEEP_RUNS = 120, KEEP_BETS = 1500;
const LEADS = ['v4', 'v5', 'v6', 'v2', 'move', 'shots', 'shotsGoalie', 'forebet', 'sportsmole', 'consensus', 'analyst', 'goalies', 'combo'];
const CHECKS = ['confirmed', 'strengthened', 'weakened', 'flipped', 'none'];
const am = m => (m > 0 ? '+' + m : String(m));
const ct = iso => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
const hourCT = now => +new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hourCycle: 'h23' }).format(now);
export const isRunTime = now => RUN_HOURS.includes(hourCT(now));

export async function getScout(env) { const d = await env.HUB.get(KEY, 'json'); return d && d.v === 1 && Array.isArray(d.bets) ? { ...d, runs: d.runs || [] } : { v: 1, bets: [], runs: [] }; }

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

const SYS = `You are Scout, a free-rein paper bettor for the Game Day Hub. Your job: find an edge using the Hub's system.
You have no rules on what to take: any market listed in a game's price (soccer H D A = home/draw/away, O U = Over/Under 2.5, B N = Both score Yes/No; NHL H A = moneyline, O U = the total shown), any number of bets including none, stake 0.5 to 3 units by conviction. You may agree or disagree with the Analyst and any model.
The one prerequisite: every idea must start from the Hub's board (a model against the margin-free price, a price move from the open, the shots read, shots+goalie, Forebet/SportsMole, models agreeing or disagreeing, the Analyst's bet). Outside news may confirm or change the idea but is never the starting point.
Think in numbers: an edge is a model chance above the margin-free price, or a move the models back. Beating the closing price is the first sign of a real edge. Paper bets only.
Answer with JSON only.`;

async function ask(env, user, schema, maxTokens) {
  const r = await env.AI.run(env.SCOUT_MODEL || MODEL, { messages: [{ role: 'system', content: SYS }, { role: 'user', content: user }], max_tokens: maxTokens, temperature: 0.4,
    response_format: { type: 'json_schema', json_schema: schema } });
  const out = r && r.response !== undefined ? r.response : r;
  if (out && typeof out === 'object') return out;
  const t = String(out || ''), a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('the model gave no JSON');
  return JSON.parse(t.slice(a, b + 1));
}
const S1 = { type: 'object', properties: { shortlist: { type: 'array', items: { type: 'object', properties: { n: { type: 'integer' }, idea: { type: 'string' } }, required: ['n', 'idea'] } } }, required: ['shortlist'] };
const S2 = { type: 'object', properties: { bets: { type: 'array', items: { type: 'object', properties: {
  n: { type: 'integer' }, key: { type: 'string', enum: ['H', 'D', 'A', 'O', 'U', 'B', 'N'] }, stake: { type: 'number' }, conf: { type: 'integer' }, lead: { type: 'string', enum: LEADS },
  why: { type: 'string' }, models: { type: 'object', additionalProperties: { type: 'string' } }, outsideCheck: { type: 'string', enum: CHECKS }, used: { type: 'array', items: { type: 'integer' } } },
  required: ['n', 'key', 'stake', 'lead', 'why', 'outsideCheck'] } }, note: { type: 'string' } }, required: ['bets', 'note'] };

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
    models: x.models && typeof x.models === 'object' ? Object.fromEntries(Object.entries(x.models).slice(0, 6).map(([k, v]) => [String(k).slice(0, 30), String(v).slice(0, 80)])) : {},
    outside: used, outsideCheck: CHECKS.includes(x.outsideCheck) ? x.outsideCheck : used.length ? 'confirmed' : 'none', by: 'workers-ai' };
  return problem(b) ? null : b;
}

// The run. opts.force: run now whatever the hour (the "Run Scout now" button). Never throws.
export async function scoutStep(env, now = new Date(), fetchFn = fetch, { force = false } = {}) {
  if (!force && !isRunTime(now)) return { skipped: 'not a run time' };
  if (!env.AI) return { error: 'Workers AI is not bound (wrangler.toml [ai] binding = "AI")' };
  const doc = await getScout(env);
  try {
    if (!force && doc.runs[0] && !doc.runs[0].error && now.getTime() - new Date(doc.runs[0].at).getTime() < 3 * 3600000) return { skipped: 'ran in the last 3 hours' };
    // 1. results into the log
    const names = daysToRead(doc.bets), docs = await Promise.all(names.map(n => env.HUB.get(n, 'json')));
    const G = grade(doc.bets, cardsFrom(names, docs), now), byId = new Map(G.map(b => [b.id, b]));
    for (const b of doc.bets) { const x = byId.get(b.id); if (!b.res && x && x.res) Object.assign(b, { res: x.res, units: x.units, close: x.close, clv: x.clv, ...(x.score ? { score: x.score } : {}) }); }
    const R = record(G), settled = G.filter(b => b.status === 'settled').sort((a, b) => (a.kickoff < b.kickoff ? 1 : -1));
    // 2. the board
    const d0 = localDay(now), dates = [d0, addDay(d0, 1), addDay(d0, 2)];
    const [sd, nd, an] = await Promise.all([Promise.all(dates.map(d => env.HUB.get(`day:${d}`, 'json'))), Promise.all(dates.map(d => env.HUB.get(`nhl:day:${d}`, 'json'))), getAnalyst(env, { readOnly: true }).catch(() => ({ items: [] }))]);
    const games = board({ soccer: Object.fromEntries(dates.map((d, i) => [d, sd[i]?.cards || []])), nhl: Object.fromEntries(dates.map((d, i) => [d, nd[i]?.cards || []])) }, now, (an.items || []).filter(b => !b.res), doc.bets)
      .filter(g => g.minsToKickoff >= 30).slice(0, 70);
    let took = [], note = '';
    if (!games.length) note = 'No priced games in the next 36 hours.';
    else {
      const lines = games.map((g, i) => line(g, i)).join('\n');
      // 3. shortlist
      const a1 = await ask(env, `${lessons(R, settled)}\n\nThe board (next 36 hours, prices are DraftKings American odds, fair = margin-free %):\n${lines}\n\nPick up to ${SHORT} games where the Hub's numbers point to an edge worth checking. For each: n (the game number) and idea (one line, with the numbers). Return {"shortlist":[...]}; an empty list is fine.`, S1, 700);
      const short = [...new Set(((a1 && a1.shortlist) || []).map(s => s && Number(s.n)).filter(n => Number.isInteger(n) && games[n]))].slice(0, SHORT);
      const ideas = new Map(((a1 && a1.shortlist) || []).map(s => [Number(s.n), String(s.idea || '')]));
      if (!short.length) note = 'Read the board: nothing in the Hub\'s numbers looked like an edge worth a bet.';
      else {
        // 4. outside check
        const srcs = [], per = await Promise.all(short.map(n => outside(games[n], fetchFn)));
        const blocks = short.map((n, k) => `${line(games[n], n)}\nyour idea: ${ideas.get(n) || ''}\noutside:\n${per[k].map(s => { srcs.push(s); return `  [${srcs.length - 1}] ${s.src}: ${s.note}`; }).join('\n') || '  (ESPN had nothing on this game)'}`).join('\n\n');
        // 5. the bets
        const a2 = await ask(env, `${lessons(R, settled)}\n\nYour shortlist, with the outside check:\n${blocks}\n\nDecide your bets. For each: n, key (a market in that game's price), stake (0.5-3), conf (1-5), lead (the Hub signal it started from), why (2-3 sentences with the numbers and the reason), models (what each Hub model said, short), outsideCheck (confirmed, strengthened, weakened, flipped = not where the Hub's models pointed, or none) and used (the [numbers] of the outside notes you relied on). Then note: up to 3 sentences on what you took, notable passes and why, and one lesson from your record. Return {"bets":[...],"note":"..."}; no bets is fine.`, S2, 1800);
        for (const x of (a2 && a2.bets) || []) { const g = games[Number(x.n)]; if (!short.includes(Number(x.n))) continue; const b = makeBet(x, g, srcs, now); if (b && !doc.bets.some(o => o.id === b.id) && !took.some(o => o.id === b.id)) took.push(b); }
        note = String((a2 && a2.note) || '').slice(0, 600) || (took.length ? '' : 'Checked the shortlist and passed.');
      }
    }
    // 6. save
    doc.bets = [...took, ...doc.bets].slice(0, KEEP_BETS);
    doc.runs = [{ at: now.toISOString(), looked: games.length, took: took.length, note, model: env.SCOUT_MODEL || MODEL }, ...doc.runs].slice(0, KEEP_RUNS);
    doc.updated = now.toISOString();
    await env.HUB.put(KEY, JSON.stringify(doc));
    return { ok: true, looked: games.length, took: took.length, bets: took.map(b => `${b.home} v ${b.away}: ${LABEL[b.key]}${b.line ? ' ' + b.line : ''} ${am(b.price)} x${b.stake}`) };
  } catch (e) {
    const msg = String(e && e.message || e).slice(0, 160);
    try { doc.runs = [{ at: now.toISOString(), looked: 0, took: 0, note: `The run failed: ${msg}`, error: true }, ...doc.runs].slice(0, KEEP_RUNS); await env.HUB.put(KEY, JSON.stringify(doc)); } catch (e2) { /* nothing more to do */ }
    return { error: msg };
  }
}
const localDay = now => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
const addDay = (d, n) => new Date(new Date(d + 'T12:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);
