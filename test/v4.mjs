// v4 checks: club names line up with ESPN's, numbers match the research run, ratings cache + refresh work.
import seed from '../src/v4seed.js';
import { supports, resolve, predict, fit, gamesFor, getRatings, refreshRatings, V4, cupSupports, cupGamesFor, getCupRatings, cupForecast, fitCup, predictCup, resolveClub, CUP } from '../src/v4.js';
import cupSeed from '../src/v4cupseed.js';
import { CLUBS } from '../src/v4cupnames.js';
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
  for (let i = 0; i < 14; i++) await refreshRatings(env, now);
  const again = await refreshRatings(env, new Date(now.getTime() + 3600000));
  ok('once every league is fresh, refresh does nothing', again.idle === true, JSON.stringify(again));
  const later = await refreshRatings(env, new Date(now.getTime() + 20 * 3600000));
  ok('a day later it rebuilds one again', !!later.league, JSON.stringify(later));
}

// 6. cups: Champions League + Europa League
{
  const pcx = x => Math.round(100 * x);
  ok('cups are supported by the cup model, domestic-only calls stay separate', cupSupports('uefa.champions') && cupSupports('uefa.europa') && !cupSupports('eng.1') && !cupSupports('uefa.nations'));
  // names: every club in the bundled history is in the club table, and ESPN's own names for both competitions resolve
  ok('every bundled cup club is in the club table', cupSeed.teams.every(t => CLUBS.some(c => c.name === t)));
  const espnCL = ['AS Monaco', 'Ajax Amsterdam', 'Arsenal', 'Atalanta', 'Athletic Club', 'Atlético Madrid', 'Barcelona', 'Bayer Leverkusen', 'Bayern Munich', 'Benfica', 'Bodo/Glimt', 'Borussia Dortmund', 'Chelsea', 'Club Brugge', 'Eintracht Frankfurt', 'F.C. København', 'FK Qarabag', 'Galatasaray', 'Internazionale', 'Juventus', 'Kairat Almaty', 'Liverpool', 'Manchester City', 'Marseille', 'Napoli', 'Newcastle United', 'Olympiacos', 'PSV Eindhoven', 'Pafos', 'Paris Saint-Germain', 'Real Madrid', 'Slavia Prague', 'Sporting CP', 'Tottenham Hotspur', 'Union St.-Gilloise', 'Villarreal', 'Fenerbahce Istanbul', 'Slovan Bratislava', 'Shakhtar Donetsk', 'AEK Athens', 'LASK Linz', 'Real Betis Seville', 'FC Porto', 'Como 1907', 'Feyenoord Rotterdam', 'Aston Villa', 'Bodoe/Glimt', 'Manchester United', 'RB Leipzig', 'VfB Stuttgart', 'AS Roma', 'Lens', 'Viking', 'Sabah Masazir'];
  const espnEL = ['AC Milan', 'AFC Bournemouth', 'AZ Alkmaar', 'Anderlecht', 'Ararat-Armenia', 'Bayer Leverkusen', 'Benfica', 'Besiktas', 'Celta Vigo', 'Celtic', 'Crystal Palace', 'Dinamo Zagreb', 'Ferencvaros', "Hapoel Be'er", 'Jagiellonia Bialystok', 'Juventus', 'Lech Poznan', 'Levski Sofia', 'Lillestrom', 'Lyon', 'Marseille', 'NEC Nijmegen', 'NK Celje', 'OFI Crete', 'Olympiacos', 'Omonia Nicosia', 'RB Salzburg', 'Real Sociedad', 'SK Sturm Graz', 'Sparta Prague', 'Stade Rennais', 'Sunderland', 'TSG Hoffenheim', 'Torreense', 'Union St.-Gilloise', 'Viktoria Plzen'];
  const bad = [...espnCL, ...espnEL].filter(n => !resolveClub(n));
  ok(`all ${espnCL.length + espnEL.length} ESPN cup club names resolve`, bad.length === 0, bad.join(', '));
  ok('the same club always resolves to one name', resolveClub('Inter Milan') === resolveClub('Internazionale') && resolveClub('Paris Saint-Germain') === 'Paris' && resolveClub('Man City') === 'Man City');
  ok('a Paris FC from the French league is not Paris Saint-Germain', resolveClub('Paris FC', { slug: 'fra.1', name: 'Paris FC' }) === null);
  ok('domestic name beats a lookalike name', resolveClub('Whatever', { slug: 'fra.1', name: 'Paris Saint-Germain' }) === 'Paris');
  ok('an unknown club resolves to nothing', resolveClub('Totally Unknown FC') === null);

  // numbers: the Oct 14 Champions League night, predicted from games before Oct 14 (ratings from the bundled league ratings)
  const seed2 = (await import('../src/v4seed.js')).default;
  const domOf = (slug, name) => seed2[slug]?.r.t[name] || null;
  const live = cupGamesFor({});
  ok('bundled cup history: 810 games through Oct 14, 2026', live.length === 810 && cupSeed.through === '2026-10-14', `${live.length} ${cupSeed.through}`);
  const before = fitCup(live, domOf, Date.UTC(2026, 9, 14));
  const frozen = [['Man City', 'Paris', '54/22/25', 63, 62], ['Feyenoord', 'Como', '35/23/42', 66, 66], ['Aston Villa', 'Fenerbahçe', '76/14/10', 71, 56], ['Roma', 'Real Madrid', '39/23/38', 64, 65], ['Real Betis', 'Porto', '48/23/29', 64, 64]];
  for (const [h, a, hda, o, b] of frozen) {
    const p = predictCup(before, 0, h, a), got = `${pcx(p.home)}/${pcx(p.draw)}/${pcx(p.away)}`;
    ok(`CL ${h} v ${a}: ${hda}, Over ${o}, both ${b}`, got === hda && Math.abs(pcx(p.over25) - o) <= 1 && Math.abs(pcx(p.bttsYes) - b) <= 1, `got ${got} ${pcx(p.over25)} ${pcx(p.bttsYes)}`);
  }
  const p1 = predictCup(before, 0, 'Man City', 'Paris');
  ok('cup probabilities add up and top scores are sorted', Math.abs(p1.home + p1.draw + p1.away - 1) < 1e-9 && p1.topScores.length === 3 && p1.topScores[0].p >= p1.topScores[1].p);
  ok('a club with too few cup games and no domestic rating gets no prediction (LASK)', predictCup(before, 0, 'LASK', 'Liverpool') === null);
  ok('an unknown club gets no prediction', predictCup(before, 0, 'Nobody FC', 'Liverpool') === null);
  ok('Europa League games use their own goal level', Math.abs(before.mu.CL[0] - before.mu.EL[0]) > 1e-6);

  // a warm refresh (3 passes from the previous fit) agrees with a full fit and is quick
  const full = fitCup(live, domOf, Date.UTC(2026, 9, 15)), start = fitCup(live.filter(g => g.d < Date.UTC(2026, 9, 9) / 86400000), domOf, Date.UTC(2026, 9, 9));
  const t0 = performance.now(); const fast = fitCup(live, domOf, Date.UTC(2026, 9, 15), start.w); const ms = performance.now() - t0;
  let worst = 0; const nm = Object.keys(full.t).filter(x => full.t[x][3] || full.t[x][2] >= 2);
  for (const h of nm) for (const a of nm) if (h !== a) { const p = predictCup(full, 0, h, a), q = predictCup(fast, 0, h, a); if (p && q) worst = Math.max(worst, Math.abs(p.home - q.home), Math.abs(p.draw - q.draw), Math.abs(p.away - q.away)); }
  ok('3-pass warm cup refresh is within 1 point of a full fit', worst < 0.01, `${(100 * worst).toFixed(2)} pts`);
  ok('a cup refresh fits in well under 50 ms here', ms < 50, `${ms.toFixed(1)} ms`);

  // live games extend the bundled history; repeats and unknown clubs do not
  const through = Math.floor(Date.parse(cupSeed.through) / 86400000);
  const iso = d => new Date(d * 86400000 + 7200000).toISOString();
  const rows = [['x1', iso(through + 8), 1, 2, 2, 1, 'Manchester City', 'Paris Saint-Germain'], ['x2', iso(through), 1, 2, 9, 9, 'Manchester City', 'Paris Saint-Germain'], ['x3', iso(through + 8), 1, 2, 1, 1, 'Nobody FC', 'Arsenal']];
  const merged = cupGamesFor({ 0: rows });
  ok('a live cup game is added; a repeat of a bundled game and an unknown club are not', merged.length === live.length + 1 && merged.unknown === 1 && merged.at(-1).hg === 2, `${live.length} -> ${merged.length}, unknown ${merged.unknown}`);

  // KV: bundled ratings first, then the cron's rebuild
  const kv = new Map();
  const env = { HUB: { get: async (k, ty) => { const v = kv.get(k); return v == null ? null : ty === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => { kv.set(k, v); } } };
  const R0 = await getCupRatings(env, new Map());
  ok('before any refresh, cup ratings come from the bundled history', R0.builtAt === 0 && Object.keys(R0.t).length === cupSeed.teams.length);
  const f = { home: { name: 'Manchester City' }, away: { name: 'Paris Saint-Germain' } };
  const dbg = [];
  const pr = await cupForecast({ slug: 'uefa.champions' }, f, null, null, env, new Map(), dbg);
  ok('cupForecast works from names alone (no domestic lookup needed)', !!pr && Math.abs(pr.home + pr.draw + pr.away - 1) < 1e-9 && dbg.length === 0);
  const dbg2 = []; const none = await cupForecast({ slug: 'uefa.champions' }, { home: { name: 'Nobody FC' }, away: f.away }, null, null, env, new Map(), dbg2);
  ok('an unknown club gives null and is named in the debug list', none === null && dbg2.some(x => x.includes('Nobody FC')));
  ok('no cup forecast outside the cups', (await cupForecast({ slug: 'eng.1' }, f, null, null, env, new Map())) === null);
  kv.set('res:uefa.europa', JSON.stringify({ games: [['e1', iso(through + 8), 1, 2, 3, 0, 'Celtic', 'Benfica']] }));
  const r = await refreshRatings(env, new Date('2026-10-16T12:00:00Z'), ['cup'], { force: true });
  const saved = JSON.parse(kv.get('rat:cup'));
  ok('a cup refresh uses the stored cup results and saves rat:cup', r.league === 'cup' && r.games === live.length + 1 && saved.builtAt === Date.parse('2026-10-16T12:00:00Z'), JSON.stringify(r));
  ok('the saved cup ratings are what gets read next', (await getCupRatings(env, new Map())).builtAt === saved.builtAt);
}

// 9. newly promoted clubs: a club under MIN_GAMES is predicted from a starting prior and flagged; established pairs are not
{
  const G = gamesFor('eng.1', []), T = seed['eng.1'].teams, now = Date.parse('2026-10-14T12:00:00Z');
  const club = 'Coventry City', games = G.filter(g => g.h !== club && g.a !== club).concat(G.filter(g => g.h === club || g.a === club).slice(-3));
  const R = fit('eng.1', games, now);
  const hasClub = Object.keys(R.t).find(x => x.startsWith('Coventry'));
  ok('a club with 3 games is in the ratings and marked as starting-prior', !!hasClub && R.t[hasClub][2] === 3 && R.t[hasClub][3] === 1, JSON.stringify(R.t[hasClub]));
  const est = Object.keys(R.t).filter(x => R.t[x][2] >= V4.MIN_GAMES);
  const pp = predict(R, est[0], hasClub), pe = predict(R, est[0], est[1]);
  ok('a game with that club gets a v4 prediction flagged promo', pp && pp.promo === true && Math.abs(pp.home + pp.draw + pp.away - 1) < 1e-9);
  ok('a game between established clubs is not flagged', pe && pe.promo === false);
  const q = R.t[hasClub];
  ok('with 3 games the club sits between the weak prior and its own results (not an average club, not wild)', q[0] > .5 && q[0] < 1.3 && q[1] > .7 && q[1] < 1.5);
  ok('no games at all in this league: still no prediction', predict(R, est[0], 'Never Played FC') === null);
  const R2 = fit('eng.1', G, now); ok('with 8+ games the club leaves the prior (promo flag off)', Object.values(R2.t).every(v => v[2] < V4.MIN_GAMES ? v[3] === 1 : v[3] === 0));
}
console.log(fails ? `\n${fails} FAILED` : '\nAll v4 checks passed');
process.exit(fails ? 1 : 0);
