// v4 glue: bundled game history (v4seed.js) + live games from KV -> cached ratings. See v4core.js for the model.
import seed from './v4seed.js';
import { V4, norm, fit, predict, grid } from './v4core.js';
import cupSeed from './v4cupseed.js';
import { CUP, compIndex, fitCup, predictCup, resolveClub } from './v4cup.js';
export { V4, norm, fit, predict, grid, CUP, compIndex, fitCup, predictCup, resolveClub };

const DAY = 86400000;
export const supports = slug => !!(V4.PARAMS[slug] && seed[slug]);

const lookups = new Map();
// ESPN spellings the word match cannot reach.
const ALT = { 'bra.1': { 'atletico mineiro': 'Atletico-MG', 'atletico mg': 'Atletico-MG', 'athletico paranaense': 'Athletico-PR', 'athletico pr': 'Athletico-PR' } };
export function resolve(slug, name) {
  const s = seed[slug]; if (!s) return null;
  if (!lookups.has(slug)) lookups.set(slug, new Map(s.teams.map(t => [norm(t), t])));
  const L = lookups.get(slug), n = norm(name);
  const al = ALT[slug] && ALT[slug][n]; if (al && L.has(norm(al))) return L.get(norm(al));
  if (L.has(n)) return L.get(n);
  const words = n.split(' ').filter(Boolean);
  const hits = [...L.entries()].filter(([k]) => { const kw = k.split(' '); return words.every(w => kw.includes(w)) || kw.every(w => words.includes(w)); });
  return hits.length === 1 ? hits[0][1] : null; // ambiguous or unknown: say nothing rather than guess
}

// ---- history ------------------------------------------------------------------------------------
// live: games from the Hub's res:<league> store: [id, iso, homeId, awayId, homeScore, awayScore, homeName, awayName]
export function gamesFor(slug, live = []) {
  const s = seed[slug]; if (!s) return [];
  const out = s.g.map(([d, h, a, hg, ag]) => ({ d, h: s.teams[h], a: s.teams[a], hg, ag }));
  const seen = new Set(out.map(g => `${g.d}|${g.h}|${g.a}`));
  const through = Math.floor(Date.parse(s.through) / DAY);
  for (const [, iso, , , hs, as, hn, an] of live) {
    const d = Math.floor(Date.parse(iso) / DAY);
    if (d < through || hs == null || as == null) continue;
    const h = resolve(slug, hn) || hn, a = resolve(slug, an) || an;
    const k = `${d}|${h}|${a}`; if (seen.has(k)) continue;
    seen.add(k); out.push({ d, h, a, hg: +hs, ag: +as });
  }
  return out.sort((x, y) => x.d - y.d);
}

// ---- ratings in KV ---------------------------------------------------------------------------------
// Requests (analyze) only READ ratings: rat:<league> if the cron has built one, else the ratings bundled with the
// seed. They never fit, so they stay far inside the free plan's 10 ms CPU limit. The cron rebuilds one league at a
// time (about once a day each), starting from the previous ratings so 3 passes are enough.
const usable = (R, slug) => R && R.v === 1 && R.seedThrough === seed[slug].through && R.t;
export async function getRatings(league, env, memo) {
  const slug = league.slug;
  if (!supports(slug)) return null;
  if (memo?.has('rat:' + slug)) return memo.get('rat:' + slug);
  let R = await env.HUB.get(`rat:${slug}`, 'json');
  if (!usable(R, slug)) R = { ...seed[slug].r, v: 1, seedThrough: seed[slug].through, builtAt: 0 };
  memo?.set('rat:' + slug, R);
  return R;
}

// ---- cups (Champions League, Europa League) ------------------------------------------------------------
export const cupSupports = slug => compIndex(slug) >= 0;
const cupUsable = R => R && R.v === 1 && R.seedThrough === cupSeed.through && R.t && R.w;

// Bundled cup history plus cup games stored by the sync step (res:uefa.champions / res:uefa.europa) after the bundle ends.
export function cupGamesFor(live = {}) {
  const out = cupSeed.g.map(([d, c, h, a, hg, ag]) => ({ d, c, h: cupSeed.teams[h], a: cupSeed.teams[a], hg, ag }));
  const seen = new Set(out.map(g => `${g.d}|${g.c}|${g.h}|${g.a}`));
  const through = Math.floor(Date.parse(cupSeed.through) / DAY);
  let unknown = 0;
  for (const [c, rows] of Object.entries(live)) for (const [, iso, , , hs, as, hn, an] of rows || []) {
    const d = Math.floor(Date.parse(iso) / DAY);
    if (d < through || hs == null || as == null) continue;
    const h = resolveClub(hn), a = resolveClub(an);
    if (!h || !a) { unknown++; continue; }
    const k = `${d}|${c}|${h}|${a}`; if (seen.has(k)) continue;
    seen.add(k); out.push({ d, c: +c, h, a, hg: +hs, ag: +as });
  }
  out.unknown = unknown;
  return out.sort((x, y) => x.d - y.d);
}

// Analyze only READS cup ratings: rat:cup if the cron has built one, else the ratings bundled with the history.
export async function getCupRatings(env, memo) {
  if (memo?.has('rat:cup')) return memo.get('rat:cup');
  let R = await env.HUB.get('rat:cup', 'json');
  if (!cupUsable(R)) R = { ...cupSeed.r, v: 1, seedThrough: cupSeed.through, builtAt: 0 };
  memo?.set('rat:cup', R);
  return R;
}

// v4 prediction for one cup fixture, or null. h0 / a0 = where the Hub found each club domestically (may be null).
export async function cupForecast(league, f, h0, a0, env, memo, debug) {
  const ci = compIndex(league.slug); if (ci < 0) return null;
  const hn = resolveClub(f.home.name, h0 && { slug: h0.league.slug, name: h0.team.name });
  const an = resolveClub(f.away.name, a0 && { slug: a0.league.slug, name: a0.team.name });
  if (!hn) debug?.push(`v4 cup: unknown club "${f.home.name}"`);
  if (!an) debug?.push(`v4 cup: unknown club "${f.away.name}"`);
  if (!hn || !an) { memo?.set('v4why:' + f.id, `club not recognized: ${!hn ? f.home.name : f.away.name}`); return null; }
  const r = predictCup(await getCupRatings(env, memo), ci, hn, an);
  if (!r) memo?.set('v4why:' + f.id, 'the cup model has too few games for one of the clubs');
  return r;
}

async function refreshCup(env, now) {
  const dom = {};
  for (const slug of CUP.DOMESTIC) dom[slug] = await getRatings({ slug }, env);
  const old = await env.HUB.get('rat:cup', 'json');
  const warm = (cupUsable(old) ? old : cupSeed.r).w;
  const live = { 0: (await env.HUB.get('res:uefa.champions', 'json'))?.games, 1: (await env.HUB.get('res:uefa.europa', 'json'))?.games };
  const games = cupGamesFor(live);
  const R = fitCup(games, (slug, name) => dom[slug]?.t[name] || null, now.getTime(), warm);
  R.v = 1; R.seedThrough = cupSeed.through; R.builtAt = now.getTime();
  await env.HUB.put('rat:cup', JSON.stringify(R));
  return { league: 'cup', clubs: Object.keys(R.t).length, games: games.length, unknownClubs: games.unknown };
}

// Rebuild the least recently rebuilt league's ratings (the cup ratings count as one more "league") if older than RATING_TTL_MS.
export async function refreshRatings(env, now = new Date(), slugs = [...Object.keys(V4.PARAMS).filter(supports), 'cup'], { force = false } = {}) {
  const all = [];
  for (const slug of slugs) { const R = await env.HUB.get(`rat:${slug}`, 'json'); all.push({ slug, R: (slug === 'cup' ? cupUsable(R) : usable(R, slug)) ? R : null }); }
  all.sort((a, b) => (a.R?.builtAt || 0) - (b.R?.builtAt || 0));
  const next = all[0];
  if (!next || (!force && next.R && now.getTime() - next.R.builtAt < V4.RATING_TTL_MS)) return { idle: true };
  if (next.slug === 'cup') return refreshCup(env, now);
  const res = await env.HUB.get(`res:${next.slug}`, 'json');
  const warm = (next.R || seed[next.slug].r).t;
  const R = fit(next.slug, gamesFor(next.slug, res?.games || []), now.getTime(), warm);
  R.v = 1; R.seedThrough = seed[next.slug].through; R.builtAt = now.getTime();
  await env.HUB.put(`rat:${next.slug}`, JSON.stringify(R));
  return { league: next.slug, clubs: Object.keys(R.t).length, liveGames: (res?.games || []).length };
}
