// v4 glue: bundled game history (v4seed.js) + live games from KV -> cached ratings. See v4core.js for the model.
import seed from './v4seed.js';
import { V4, norm, fit, predict, grid } from './v4core.js';
export { V4, norm, fit, predict, grid };

const DAY = 86400000;
export const supports = slug => !!(V4.PARAMS[slug] && seed[slug]);

const lookups = new Map();
export function resolve(slug, name) {
  const s = seed[slug]; if (!s) return null;
  if (!lookups.has(slug)) lookups.set(slug, new Map(s.teams.map(t => [norm(t), t])));
  const L = lookups.get(slug), n = norm(name);
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

// Rebuild the least recently rebuilt league's ratings if it is older than RATING_TTL_MS.
export async function refreshRatings(env, now = new Date(), slugs = Object.keys(V4.PARAMS).filter(supports), { force = false } = {}) {
  const all = [];
  for (const slug of slugs) { const R = await env.HUB.get(`rat:${slug}`, 'json'); all.push({ slug, R: usable(R, slug) ? R : null }); }
  all.sort((a, b) => (a.R?.builtAt || 0) - (b.R?.builtAt || 0));
  const next = all[0];
  if (!next || (!force && next.R && now.getTime() - next.R.builtAt < V4.RATING_TTL_MS)) return { idle: true };
  const res = await env.HUB.get(`res:${next.slug}`, 'json');
  const warm = (next.R || seed[next.slug].r).t;
  const R = fit(next.slug, gamesFor(next.slug, res?.games || []), now.getTime(), warm);
  R.v = 1; R.seedThrough = seed[next.slug].through; R.builtAt = now.getTime();
  await env.HUB.put(`rat:${next.slug}`, JSON.stringify(R));
  return { league: next.slug, clubs: Object.keys(R.t).length, liveGames: (res?.games || []).length };
}
