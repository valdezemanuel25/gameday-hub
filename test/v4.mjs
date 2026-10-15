// v4 checks: club names line up with ESPN's, numbers match the research run, ratings cache + refresh work.
import seed from '../src/v4seed.js';
import { supports, resolve, predict, fit, gamesFor, getRatings, refreshRatings, V4 } from '../src/v4.js';
import names from '../tools/v4-names.json' with { type: 'json' };

let fails = 0;
const ok = (name, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${extra}`); };
const pc = x => Math.round(100 * x);

// 1. every ESPN club name resolves to exactly the club in the seed (this is what the Hub looks up at run time)
let total = 0, bad = [];
for (const [slug, list] of Object.entries(names.espn)) for (const n of list) { total++; if (resolve(slug, n) !== n) bad.push(`${slug}:${n}->${resolve(slug, n)}`); }
ok(`all ${total} ESPN club names resolve to themselves in the seed`, bad.length === 0, bad.join(', '));
ok('looser spellings still resolve (Man United, Paris SG, Wolves)', resolve('eng.1', 'Manchester United') === 'Manchester United' && resolve('fra.1', 'Paris Saint Germain') === 'Paris Saint-Germain' && resolve('eng.2', 'Wolverhampton Wanderers') === 'Wolverhampton Wanderers');
ok('an unknown club resolves to nothing, never to a guess', resolve('eng.1', 'Totally Unknown FC') === null);
ok('11 leagues supported, cups are not', Object.keys(V4.PARAMS).every(supports) && !supports('uefa.champions') && !supports('por.1'));

// 2. same numbers as the research run for the Oct 14 MLS card (rounded %: home/draw/away and expected goals exactly;
//    Over 2.5 / both-score within 1 point, because here the league average is taken from today's ratings)
const R = { ...seed['usa.1'].r, v: 1 };
const frozen = [
  ['CF Montréal', 'Atlanta United FC', '41/26/33', '1.41-1.25', 59, 60],
  ['Columbus Crew', 'Charlotte FC', '38/24/38', '1.54-1.52', 64, 64],
  ['Nashville SC', 'Sporting Kansas City', '79/13/8', '2.93-0.87', 71, 60],
  ['LAFC', 'Austin FC', '58/23/19', '1.80-0.93', 60, 58],
  ['Inter Miami CF', 'New York City FC', '56/20/23', '2.18-1.36', 69, 66],
  ['Chicago Fire FC', 'Philadelphia Union', '42/22/36', '1.86-1.72', 69, 68],
];
for (const [h, a, hda, xg, o, b] of frozen) {
  const p = predict(R, resolve('usa.1', h), resolve('usa.1', a));
  const got = `${pc(p.home)}/${pc(p.draw)}/${pc(p.away)}`, gx = `${p.lambda.home.toFixed(2)}-${p.lambda.away.toFixed(2)}`;
  ok(`MLS ${h} v ${a}: ${hda}, xG ${xg}, Over ${o}, both ${b}`, got === hda && gx === xg && Math.abs(pc(p.over25) - o) <= 1 && Math.abs(pc(p.bttsYes) - b) <= 1, `got ${got} ${gx} ${pc(p.over25)} ${pc(p.bttsYes)}`);
}
const p0 = predict(R, 'LAFC', 'Austin FC');
ok('probabilities add up to 1 and Over/Under, Yes/No are complements', Math.abs(p0.home + p0.draw + p0.away - 1) < 1e-9 && Math.abs(p0.over25 + p0.under25 - 1) < 1e-9 && Math.abs(p0.bttsYes + p0.bttsNo - 1) < 1e-9);
ok('top scores come back sorted', p0.topScores.length === 3 && p0.topScores[0].p >= p0.topScores[1].p && p0.topScores[1].p >= p0.topScores[2].p);
ok('v4 is silent for a club it has no history on', predict(R, 'LAFC', 'Nobody FC') === null);

// 3. live games extend the seed; duplicates do not double count
const through = Date.parse(seed['usa.1'].through) / 86400000;
const live = [['x1', new Date((through + 2) * 86400000 + 3600000).toISOString(), 1, 2, 3, 1, 'Nashville SC', 'Austin FC'],
              ['x2', new Date(through * 86400000 + 3600000).toISOString(), 1, 2, 9, 9, seed['usa.1'].teams[seed['usa.1'].g.at(-1)[1]], seed['usa.1'].teams[seed['usa.1'].g.at(-1)[2]]]];
const base = gamesFor('usa.1', []).length, merged = gamesFor('usa.1', live);
ok('a live game after the seed is added, a repeat of a seed game is not', merged.length === base + 1 && merged.at(-1).hg === 3, `${base} -> ${merged.length}`);

// 4. warm refresh agrees with a full fit, and is quick
{
  const slug = 'eng.2', all = gamesFor(slug, []), now = Date.UTC(2026, 9, 15, 12), t0 = Math.floor(now / 86400000);
  const full = fit(slug, all, now), start = fit(slug, all.filter(g => g.d < t0 - 6), now - 6 * 86400000);
  const t = performance.now(); const fast = fit(slug, all, now, start.t); const ms = performance.now() - t;
  let worst = 0; const nm = Object.keys(full.t).filter(x => full.t[x][2] >= V4.MIN_GAMES);
  for (const h of nm) for (const a of nm) if (h !== a) { const p = predict(full, h, a), q = predict(fast, h, a); worst = Math.max(worst, Math.abs(p.home - q.home), Math.abs(p.draw - q.draw), Math.abs(p.away - q.away)); }
  ok('3-pass warm refresh is within 0.5 points of a full 20-pass fit', worst < 0.005, `${(100 * worst).toFixed(2)} pts`);
  ok('a refresh fits in well under 50 ms here', ms < 50, `${ms.toFixed(1)} ms`);
}

// 5. KV: reads fall back to the bundled ratings, refresh writes, a second refresh waits
{
  const kv = new Map();
  const env = { HUB: { get: async (k, ty) => { const v = kv.get(k); return v == null ? null : ty === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => { kv.set(k, v); } } };
  const lgMLS = { slug: 'usa.1' };
  const first = await getRatings(lgMLS, env, new Map());
  ok('before any refresh, ratings come from the bundled seed', first.builtAt === 0 && Object.keys(first.t).length === seed['usa.1'].teams.length);
  ok('no ratings for a cup', (await getRatings({ slug: 'uefa.champions' }, env, new Map())) === null);
  const now = new Date('2026-10-15T12:00:00Z');
  const r1 = await refreshRatings(env, now);
  ok('a refresh rebuilds one league and saves it', !!r1.league && kv.has(`rat:${r1.league}`), JSON.stringify(r1));
  const got = await getRatings({ slug: r1.league }, env, new Map());
  ok('a saved rebuild is what gets read next', got.builtAt === now.getTime());
  for (let i = 0; i < 10; i++) await refreshRatings(env, now);
  const again = await refreshRatings(env, new Date(now.getTime() + 3600000));
  ok('once every league is fresh, refresh does nothing', again.idle === true, JSON.stringify(again));
  const later = await refreshRatings(env, new Date(now.getTime() + 20 * 3600000));
  ok('a day later it rebuilds one again', !!later.league, JSON.stringify(later));
}
console.log(fails ? `\n${fails} FAILED` : '\nAll v4 checks passed');
process.exit(fails ? 1 : 0);
