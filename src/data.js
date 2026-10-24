// Data layer: ESPN's public soccer feed (no API key). Everything here works ONE LEAGUE AT A TIME
// and keeps stored data small, so each Worker request stays well inside the free plan's 10 ms CPU limit.
//
// NOTE: written against ESPN's public JSON shape but NOT run against the live feed from the build
// environment (network blocked there). First deploy: run Analyze for a day with games and check the
// "debug" list in the response if anything is off.

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const BASE_V2 = 'https://site.api.espn.com/apis/v2/sports/soccer';
export const TZ = 'America/Chicago';
const DAY = 86400000;
const LOOKBACK_DAYS = 80; // international breaks + midweek cups: 36 days left some clubs with <5 league games
const STORE_V = 3;
const CTX_V = 4; // contexts now carry dated history + rank // bump to discard cached results/contexts built by older code

// Second divisions: cards stay on the Board, but their results are not counted in any record (the model's edge there is a third of the top flights').
export const UNTRACKED = new Set(['esp.2', 'ger.2', 'eng.2']);

// Same order as the Hub's tabs. ls = league-strength key. calendar = season runs Jan-Dec.
export const LEAGUES = [
  { slug: 'uefa.champions', key: 'ucl', name: 'Champions League', cup: true, cupModel: true },
  { slug: 'uefa.europa', key: 'uel', name: 'Europa League', cup: true, cupModel: true },
  { slug: 'eng.1', key: 'epl', name: 'Premier League', ls: 'ENG' },
  { slug: 'ger.1', key: 'bundesliga', name: 'Bundesliga', ls: 'GER' },
  { slug: 'esp.1', key: 'laliga', name: 'La Liga', ls: 'ESP' },
  { slug: 'esp.2', key: 'laliga2', name: 'La Liga 2', ls: 'ESP' },
  { slug: 'ita.1', key: 'seriea', name: 'Serie A', ls: 'ITA' },
  { slug: 'ned.1', key: 'eredivisie', name: 'Eredivisie', ls: 'NED' },
  { slug: 'ger.2', key: 'bundesliga2', name: '2. Bundesliga', ls: 'GER' },
  { slug: 'fra.1', key: 'ligue1', name: 'Ligue 1', ls: 'FRA' },
  { slug: 'eng.2', key: 'championship', name: 'Championship', ls: 'ENG' },
  { slug: 'usa.1', key: 'mls', name: 'MLS', ls: null, calendar: true },
  { slug: 'mex.1', key: 'ligamx', name: 'Liga MX', ls: null },
  { slug: 'bra.1', key: 'brasileirao', name: 'Brasileirão', ls: null, calendar: true },
  { slug: 'uefa.nations', key: 'nationsleague', name: 'Nations League', cup: true },
  // Background leagues (no tab): only used to find clubs that play in the Champions League.
  { slug: 'por.1', key: 'por', name: 'Primeira Liga', ls: 'POR', support: true },
  { slug: 'tur.1', key: 'tur', name: 'Süper Lig', ls: 'TUR', support: true },
  { slug: 'bel.1', key: 'bel', name: 'Belgian Pro League', ls: 'BEL', support: true },
  { slug: 'nor.1', key: 'nor', name: 'Eliteserien', ls: 'NOR', calendar: true, support: true },
  { slug: 'sco.1', key: 'sco', name: 'Scottish Premiership', ls: null, support: true },
  { slug: 'gre.1', key: 'gre', name: 'Greek Super League', ls: null, support: true },
  { slug: 'aut.1', key: 'aut', name: 'Austrian Bundesliga', ls: null, support: true },
  { slug: 'den.1', key: 'den', name: 'Danish Superliga', ls: null, support: true },
];
export const VISIBLE = LEAGUES.filter(l => !l.support);
export const DOMESTIC = LEAGUES.filter(l => !l.cup);
// Cups whose results are stored too (res:<slug>) so the v4 cup model can learn from new games. No club context for these.
export const CUP_MODEL = LEAGUES.filter(l => l.cupModel);
// How many stored finished games were checked for shots (9th element present) and how many had them.
export function shotsCoverage(games) {
  let checked = 0, withShots = 0;
  for (const g of games || []) { if (g.length >= 9) { checked++; if (g[8]) withShots++; } }
  return { checked, withShots };
}
export const leagueBySlug = slug => LEAGUES.find(l => l.slug === slug);

const ymd = d => d.toISOString().slice(0, 10).replace(/-/g, '');

export function localDate(iso) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(iso)); // YYYY-MM-DD
}
export function localTime(iso) {
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

async function getJson(url, debug) {
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'gameday-hub/1.0' } });
    if (!res.ok) { debug?.push(`${res.status} ${url}`); return null; }
    return await res.json();
  } catch (e) { debug?.push(`fetch failed ${url}: ${e.message}`); return null; }
}

// Shots as ESPN reports them per team: [totalShots, shotsOnTarget] or null. A finished game with 0 total
// shots is a placeholder, not a real count, so it counts as "no shots".
function teamShots(c) {
  const v = n => { const s = c.statistics?.find(x => x.name === n); const x = s ? Number(s.value ?? s.displayValue) : NaN; return Number.isFinite(x) ? x : null; };
  const t = v('totalShots'), o = v('shotsOnTarget');
  return t != null && t > 0 ? [t, o != null ? o : null] : null;
}

// First divisions: the only leagues where a sportsbook price is shown next to a pick (display only, no model reads it).
export const FIRST_DIV = new Set(['eng.1', 'ger.1', 'esp.1', 'ita.1', 'fra.1', 'ned.1', 'usa.1', 'mex.1', 'bra.1']);
// ESPN's odds block (DraftKings): American prices for home / draw / away and the Over/Under 2.5 line when it is offered. Anything missing is left out.
const am = v => { if (v == null) return null; const t = String(v).trim().toUpperCase(); if (t === 'EVEN' || t === 'EV') return 100; const n = Number(t.replace('+', '')); return Number.isInteger(n) && Math.abs(n) >= 100 ? n : null; };
export function parseOdds(list) {
  const o = (list || []).find(x => x && (x.moneyline || x.homeTeamOdds || x.drawOdds || x.total || x.overUnder != null)); if (!o) return null;
  const out = {}, ml = o.moneyline || {}, pick = (...xs) => { for (const x of xs) { const v = am(x); if (v != null) return v; } return null; };
  const h = pick(ml.home?.close?.odds, ml.home?.open?.odds, o.homeTeamOdds?.moneyLine), d = pick(ml.draw?.close?.odds, ml.draw?.open?.odds, o.drawOdds?.moneyLine), a = pick(ml.away?.close?.odds, ml.away?.open?.odds, o.awayTeamOdds?.moneyLine);
  if (h != null) out.h = h; if (d != null) out.d = d; if (a != null) out.a = a;
  const t = o.total || {}, line = Number(String(t.over?.close?.line ?? t.over?.open?.line ?? o.overUnder ?? '').replace(/[^0-9.]/g, ''));
  if (line >= 0.5 && line <= 7.5) { // the book's one main total, whatever it is (2.5, 3.5, ...); the prices belong to that line
    out.tl = line;
    const ov = pick(t.over?.close?.odds, t.over?.open?.odds, o.overOdds), un = pick(t.under?.close?.odds, t.under?.open?.odds, o.underOdds);
    if (ov != null) out.to = ov; if (un != null) out.tu = un;
  }
  return Object.keys(out).length ? out : null;
}
function parseEvent(ev) {
  const comp = ev.competitions?.[0];
  if (!comp) return null;
  const h = comp.competitors?.find(c => c.homeAway === 'home');
  const a = comp.competitors?.find(c => c.homeAway === 'away');
  if (!h || !a) return null;
  const done = !!comp.status?.type?.completed;
  return {
    id: String(ev.id), date: ev.date, done,
    home: { id: String(h.team.id), name: h.team.displayName || h.team.name, abbr: h.team.abbreviation, score: done ? Number(h.score) : null },
    away: { id: String(a.team.id), name: a.team.displayName || a.team.name, abbr: a.team.abbreviation, score: done ? Number(a.score) : null },
    odds: done ? null : parseOdds(comp.odds),
    shots: done ? (sh => (sh.h && sh.a ? [sh.h[0], sh.h[1], sh.a[0], sh.a[1]] : null))({ h: teamShots(h), a: teamShots(a) }) : null,
  };
}

// ESPN answers 400 to date ranges (confirmed live), so ask one day at a time and merge.
export async function scoreboard(slug, from, to, debug) {
  const days = [];
  for (let t = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()); t <= to.getTime(); t += DAY) days.push(ymd(new Date(t)));
  const results = await Promise.all(days.map(d => getJson(`${BASE}/${slug}/scoreboard?dates=${d}&limit=300`, debug)));
  const seen = new Map();
  for (const j of results) for (const ev of j?.events || []) { const e = parseEvent(ev); if (e) seen.set(e.id, e); }
  return [...seen.values()];
}

// ---------------------------------------------------------------------------------------------
// 1) Compact results store per league: only the last ~50 days of finished games, advanced in
//    12-day windows so no single request ever parses much.  res:<slug> = { through, games: [[id, iso, hId, aId, hs, as, hName, aName]] }
// ---------------------------------------------------------------------------------------------
export async function syncLeague(league, env, now = new Date(), debug) {
  const key = `res:${league.slug}`;
  const old = await env.HUB.get(key, 'json');
  // Stores written by earlier builds (v missing) may be empty because ESPN rejected date ranges: start over.
  const st = old && old.v === STORE_V ? old : { v: STORE_V, through: null, games: [] };
  const dbg = debug || [];
  const start = st.through ? new Date(new Date(st.through).getTime() - DAY) : new Date(now.getTime() - LOOKBACK_DAYS * DAY);
  const end = new Date(Math.min(now.getTime(), start.getTime() + 12 * DAY));
  const evs = await scoreboard(league.slug, start, end, dbg);
  // A failed request is not "no games": don't advance, so the same window is retried.
  if (dbg.length) { await touchSynced(league.slug, env, now); return { caughtUp: false, games: st.games.length, context: false, error: dbg.join('; ') }; }
  const at = new Map(st.games.map((g, i) => [g[0], i]));
  for (const e of evs) {
    if (!e.done || e.home.score == null) continue;
    // 9th element = shots [homeShots, homeOnTarget, awayShots, awayOnTarget], or null when ESPN gave none.
    // It is only recorded here (coverage tracking); no model reads it yet.
    if (!at.has(e.id)) {
      st.games.push([e.id, e.date, e.home.id, e.away.id, e.home.score, e.away.score, e.home.name, e.away.name, e.shots]);
    } else if (e.shots && st.games[at.get(e.id)][8] == null) {
      st.games[at.get(e.id)][8] = e.shots; // backfill a game stored before its shots appeared
    }
  }
  st.through = end.toISOString();
  const cutoff = now.getTime() - (LOOKBACK_DAYS + 20) * DAY;
  st.games = st.games.filter(g => new Date(g[1]).getTime() >= cutoff);
  await env.HUB.put(key, JSON.stringify(st));

  const caughtUp = end.getTime() >= now.getTime();
  let ctx = null;
  if (caughtUp && !league.cup) ctx = await buildContext(league, env, now, debug);
  await touchSynced(league.slug, env, now);
  return { caughtUp, games: st.games.length, context: !!ctx };
}

async function touchSynced(slug, env, now) {
  const m = (await env.HUB.get('meta:synced', 'json')) || {};
  m[slug] = now.toISOString();
  await env.HUB.put('meta:synced', JSON.stringify(m));
}

// ---------------------------------------------------------------------------------------------
// 2) Season totals from ESPN standings (small response): this season + last season.
// ---------------------------------------------------------------------------------------------
function seasonYear(league, now) {
  const y = now.getUTCFullYear();
  if (league.calendar) return y;
  return now.getUTCMonth() >= 6 ? y : y - 1; // European seasons start ~Aug
}

async function standings(league, season, env, debug) {
  const key = `std3:${league.slug}:${season}`;
  const cached = await env.HUB.get(key, 'json');
  if (cached) return cached;
  const j = await getJson(`${BASE_V2}/${league.slug}/standings?season=${season}`, debug);
  // MLS (and some other tables) come as several groups (East / West): read ALL of them, not just the first.
  const entries = (j?.children?.length ? j.children.flatMap(c => c?.standings?.entries || []) : []).concat(j?.standings?.entries || []);
  const out = {};
  for (const e of entries) {
    const stat = n => e.stats?.find(s => s.name === n)?.value;
    const gp = stat('gamesPlayed'), gf = stat('pointsFor'), ga = stat('pointsAgainst'), rank = stat('rank');
    if (e.team?.id != null && gp != null && gf != null && ga != null) {
      out[String(e.team.id)] = { name: e.team.displayName || e.team.name, gf, ga, gp, rank: rank ?? null };
    }
  }
  if (Object.keys(out).length) await env.HUB.put(key, JSON.stringify(out), { expirationTtl: 20 * 3600 });
  return out;
}

// ---------------------------------------------------------------------------------------------
// 3) League context = season totals + last season + last-5 form, cached in KV (ctx:<slug>).
// ---------------------------------------------------------------------------------------------
export async function buildContext(league, env, now = new Date(), debug) {
  const st = await env.HUB.get(`res:${league.slug}`, 'json');
  if (!st?.games?.length) return null;
  const season = seasonYear(league, now);
  const [cur, prev] = await Promise.all([standings(league, season, env, debug), standings(league, season - 1, env, debug)]);

  const games = st.games.slice().sort((a, b) => new Date(a[1]) - new Date(b[1]));
  const recent = new Map(), names = {};
  let curIso = '';
  const push = (id, gf, ga) => { if (!recent.has(id)) recent.set(id, []); recent.get(id).push({ gf, ga, t: curIso }); };
  for (const [, iso, h, a, hs, as, hn, an] of games) { curIso = iso; push(h, hs, as); push(a, as, hs); names[h] = hn; names[a] = an; }

  const haveStd = Object.keys(cur).length > 0;
  if (!haveStd) debug?.push(`no standings for ${league.slug} ${season}: season totals approximated from last ~50 days`);
  const seasonOf = id => {
    if (haveStd) return cur[id] || null;
    const g = recent.get(id); if (!g) return null;
    return { gf: g.reduce((s, x) => s + x.gf, 0), ga: g.reduce((s, x) => s + x.ga, 0), gp: g.length };
  };

  const ids = haveStd ? Object.keys(cur) : [...recent.keys()];
  let gfSum = 0, gpSum = 0;
  for (const id of ids) { const s = seasonOf(id); if (s) { gfSum += s.gf; gpSum += s.gp; } }
  const leagueAvg = gpSum ? gfSum / gpSum : 1.4;

  const teams = {};
  for (const id of ids) {
    const s = seasonOf(id); if (!s) continue;
    const last5 = (recent.get(id) || []).slice(-5);
    const p = prev[id];
    teams[id] = {
      name: cur[id]?.name || names[id] || id,
      season: { gf: s.gf, ga: s.ga, gp: s.gp },
      // Promoted clubs have no record in this league last season: stand-in = league average with a
      // promotion penalty (attack x0.85, defence x1.15). Rough, not fitted.
      last: p ? { gf: p.gf, ga: p.ga, gp: p.gp } : { gf: leagueAvg * 0.85 * 20, ga: leagueAvg * 1.15 * 20, gp: 20 },
      form: { gf: last5.reduce((x, g) => x + g.gf, 0), ga: last5.reduce((x, g) => x + g.ga, 0), n: last5.length },
      // dated history so a card can use only games played BEFORE its kickoff
      recent: (recent.get(id) || []).slice(-8).map(g => [g.t, g.gf, g.ga]),
      rank: cur[id]?.rank ?? null,
    };
  }
  const ctx = { v: CTX_V, slug: league.slug, leagueAvg, teams, builtAt: now.getTime() };
  await env.HUB.put(`ctx:${league.slug}`, JSON.stringify(ctx));
  return ctx;
}

// Read a cached context. Never builds (building is the sync step's job). `memo` avoids repeat KV reads.
export async function getContext(league, env, memo) {
  if (memo?.has(league.slug)) return memo.get(league.slug);
  let ctx = await env.HUB.get(`ctx:${league.slug}`, 'json');
  if (ctx && ctx.v !== CTX_V) ctx = null;
  memo?.set(league.slug, ctx);
  return ctx;
}

// Find a club in any domestic league's cached context (hint league tried first).
export async function findTeam(teamId, env, memo, hintSlug) {
  const order = [...DOMESTIC].sort((a, b) => (a.slug === hintSlug ? -1 : b.slug === hintSlug ? 1 : 0));
  for (const lg of order) {
    const ctx = await getContext(lg, env, memo);
    if (ctx?.teams?.[teamId]) return { league: lg, ctx, team: ctx.teams[teamId] };
  }
  return null;
}

export async function missingContexts(env, memo) {
  const out = [];
  for (const lg of DOMESTIC) if (!(await getContext(lg, env, memo))) out.push(lg.slug);
  return out;
}

// Fixtures for ONE league on a local calendar date ('YYYY-MM-DD').
export async function fixturesForLeague(league, date, debug) {
  const d = new Date(`${date}T12:00:00Z`);
  // A Chicago calendar day spans UTC day D and D+1, so two single-day requests cover it.
  const evs = await scoreboard(league.slug, d, new Date(d.getTime() + DAY), debug);
  return evs.filter(e => localDate(e.date) === date).sort((a, b) => new Date(a.date) - new Date(b.date));
}

// What ESPN sends for a game's odds, untouched, for the "check raw prices" button. It also tries ESPN's other odds endpoints for the first
// game (where props such as Both teams to score would live) and reports what each one returns, so we can see where the data is, if anywhere.
export async function rawOdds(slug, date) {
  const j = await getJson(`${BASE}/${slug}/scoreboard?dates=${String(date).replace(/-/g, '')}&limit=300`, []);
  const strip = o => JSON.parse(JSON.stringify(o ?? null, (k, v) => (k === 'link' || k === 'logos' || k === 'tracking' ? undefined : v))); // links and logos only bury the prices
  const evs = (j?.events || []).slice(0, 1), out = { probes: [], games: evs.map(ev => ({ id: ev.id, name: ev.name, odds: strip(ev.competitions?.[0]?.odds) })) }; // probes first so they are never cut off
  const ev = evs[0]; if (!ev) return out;
  const core = `https://sports.core.api.espn.com/v2/sports/soccer/leagues/${slug}/events/${ev.id}/competitions/${ev.id}`;
  const probe = async (label, url) => {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'gameday-hub/1.0' } }), text = await res.text();
      let body = text.slice(0, 1500); try { const o = JSON.parse(text); body = { keys: Object.keys(o).slice(0, 20), count: o.count ?? null, items: (o.items || []).slice(0, 4).map(i => i.$ref || i.provider?.name || Object.keys(i).slice(0, 8)) }; } catch (e) { /* not JSON: keep the text */ }
      out.probes.push({ label, url: url.replace('https://sports.core.api.espn.com/v2/sports/soccer/', ''), status: res.status, body });
    } catch (e) { out.probes.push({ label, status: 'failed', body: String(e.message || e).slice(0, 80) }); }
  };
  await probe('core odds', `${core}/odds`);
  await probe('props (provider 100)', `${core}/odds/100/propBets?limit=50`);
  await probe('props (provider 58)', `${core}/odds/58/propBets?limit=50`);
  return out;
}
