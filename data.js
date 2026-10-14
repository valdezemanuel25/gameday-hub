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

// Same order as the Hub's tabs. ls = league-strength key. calendar = season runs Jan-Dec.
export const LEAGUES = [
  { slug: 'uefa.champions', key: 'ucl', name: 'Champions League', cup: true },
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
  { slug: 'uefa.nations', key: 'nationsleague', name: 'Nations League', cup: true },
];
export const DOMESTIC = LEAGUES.filter(l => !l.cup);
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

function parseEvent(ev) {
  const comp = ev.competitions?.[0];
  if (!comp) return null;
  const h = comp.competitors?.find(c => c.homeAway === 'home');
  const a = comp.competitors?.find(c => c.homeAway === 'away');
  if (!h || !a) return null;
  const done = !!comp.status?.type?.completed;
  return {
    id: String(ev.id), date: ev.date, done,
    home: { id: String(h.team.id), name: h.team.displayName || h.team.name, score: done ? Number(h.score) : null },
    away: { id: String(a.team.id), name: a.team.displayName || a.team.name, score: done ? Number(a.score) : null },
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
  const st = (await env.HUB.get(key, 'json')) || { through: null, games: [] };
  const start = st.through ? new Date(new Date(st.through).getTime() - DAY) : new Date(now.getTime() - 36 * DAY);
  const end = new Date(Math.min(now.getTime(), start.getTime() + 12 * DAY));
  const evs = await scoreboard(league.slug, start, end, debug);
  const seen = new Set(st.games.map(g => g[0]));
  for (const e of evs) {
    if (e.done && e.home.score != null && !seen.has(e.id)) {
      st.games.push([e.id, e.date, e.home.id, e.away.id, e.home.score, e.away.score, e.home.name, e.away.name]);
    }
  }
  st.through = end.toISOString();
  const cutoff = now.getTime() - 50 * DAY;
  st.games = st.games.filter(g => new Date(g[1]).getTime() >= cutoff);
  await env.HUB.put(key, JSON.stringify(st));

  const caughtUp = end.getTime() >= now.getTime();
  let ctx = null;
  if (caughtUp) ctx = await buildContext(league, env, now, debug);
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
  const key = `std:${league.slug}:${season}`;
  const cached = await env.HUB.get(key, 'json');
  if (cached) return cached;
  const j = await getJson(`${BASE_V2}/${league.slug}/standings?season=${season}`, debug);
  const entries = j?.children?.[0]?.standings?.entries || j?.standings?.entries || [];
  const out = {};
  for (const e of entries) {
    const stat = n => e.stats?.find(s => s.name === n)?.value;
    const gp = stat('gamesPlayed'), gf = stat('pointsFor'), ga = stat('pointsAgainst');
    if (e.team?.id != null && gp != null && gf != null && ga != null) {
      out[String(e.team.id)] = { name: e.team.displayName || e.team.name, gf, ga, gp };
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
  const push = (id, gf, ga) => { if (!recent.has(id)) recent.set(id, []); recent.get(id).push({ gf, ga }); };
  for (const [, , h, a, hs, as, hn, an] of games) { push(h, hs, as); push(a, as, hs); names[h] = hn; names[a] = an; }

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
    };
  }
  const ctx = { slug: league.slug, leagueAvg, teams, builtAt: now.getTime() };
  await env.HUB.put(`ctx:${league.slug}`, JSON.stringify(ctx));
  return ctx;
}

// Read a cached context. Never builds (building is the sync step's job). `memo` avoids repeat KV reads.
export async function getContext(league, env, memo) {
  if (memo?.has(league.slug)) return memo.get(league.slug);
  const ctx = await env.HUB.get(`ctx:${league.slug}`, 'json');
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
