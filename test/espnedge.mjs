// Odd ESPN answers (test/fixtures/espn-edge.json): an empty score, a final after extra time, a game moved to another day, a day with no
// games and a game with no odds block. Real Worker code, fake ESPN, in-memory KV (the same set-up as test/grading2.mjs).
import { readFileSync } from 'node:fs';
import { analyzeLeague, gradeLeague, refreshOdds } from '../src/worker.js';
import { syncLeague, parseOdds } from '../src/data.js';

let fails = 0;
const ok = (name, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${cond ? '' : extra}`); };
const FX = JSON.parse(readFileSync(new URL('./fixtures/espn-edge.json', import.meta.url), 'utf8'));

const kv = new Map();
const env = {
  ADMIN_TOKEN: 'secret', GAME_HOURS: '2', GRADE_DELAY_HOURS: '3', ASSETS: { fetch: () => new Response('asset') },
  HUB: {
    get: async (k, type) => { const v = kv.get(k); return v == null ? null : type === 'json' ? JSON.parse(v) : v; },
    put: async (k, v) => { kv.set(k, v); }, delete: async k => { kv.delete(k); },
    list: async ({ prefix }) => ({ keys: [...kv.keys()].filter(k => k.startsWith(prefix)).sort().map(name => ({ name })), list_complete: true }),
  },
};
// ESPN's scoreboard by date (YYYYMMDD): what each test sets; any other date answers no games
let feed = {}, fail503 = false;
globalThis.fetch = async url => {
  const m = /\/eng\.1\/scoreboard\?dates=(\d{8})/.exec(String(url));
  if (m && fail503) return new Response('busy', { status: 503 });
  return new Response(JSON.stringify(m && feed[m[1]] ? feed[m[1]] : { events: [] }));
};
const H = 3600000, DATE = '2026-11-21', KO = Date.parse('2026-11-21T15:00:00Z');
const recent = ['2026-10-18', '2026-10-25', '2026-11-01', '2026-11-04', '2026-11-08'].map((d, i) => [`${d}T15:00:00Z`, 1 + (i % 2), i % 3]);
const club = (name, rank) => ({ name, season: { gf: 15, ga: 10, gp: 11 }, last: { gf: 60, ga: 40, gp: 38 }, form: { gf: 7, ga: 5, n: 5 }, recent, rank });
const ctx = () => kv.set('ctx:eng.1', JSON.stringify({ v: 4, slug: 'eng.1', leagueAvg: 1.4, builtAt: 0, teams: Object.fromEntries([[359, 'Arsenal'], [331, 'Brighton'], [363, 'Chelsea'], [364, 'Liverpool']].map(([id, n], i) => [String(id), club(n, i + 1)])) }));
const day = (d = DATE) => JSON.parse(kv.get(`day:${d}`) || 'null');
const card = (id, d = DATE) => (day(d)?.cards || []).find(c => c.id === id);
const reset = () => { kv.clear(); ctx(); feed = {}; fail503 = false; };
// a card for a fixture, made the way the Hub makes it (the day before kickoff)
const analyzeWith = async (payload, at = new Date(KO - 24 * H)) => { feed = { '20261121': payload }; return analyzeLeague(DATE, 'eng.1', env, at); };
const asDone = (ev, home, away) => ({ events: ev.events.map(e => ({ ...e, competitions: [{ ...e.competitions[0], status: { type: { name: 'STATUS_SCHEDULED', completed: false, shortDetail: '', detail: '' } }, competitors: e.competitions[0].competitors.map(c => ({ ...c, score: '0' })) }] })) });
const after = new Date(KO + 8 * H);

// ---- an empty score: never stored as 0-0, never graded ----
reset();
await analyzeWith(asDone(FX.emptyScore));
ok('empty score: the game got its card while scheduled', !!card('e1'));
feed = { '20261121': FX.emptyScore };
let g = await gradeLeague(DATE, 'eng.1', env, { force: true }, after);
ok('empty score: the card waits instead of being graded 0-0', g.graded === 0 && g.pending === 1 && !card('e1').final, JSON.stringify(g));
kv.set('res:eng.1', JSON.stringify({ v: 3, through: '2026-11-20T12:00:00.000Z', games: [] })); // the store's window starts the day before
feed = { '20261121': FX.emptyScore, '20261122': FX.movedTo };
await syncLeague({ slug: 'eng.1', name: 'Premier League' }, env, new Date('2026-11-23T12:00:00Z'));
const res = JSON.parse(kv.get('res:eng.1') || '{"games":[]}');
ok('empty score: the results store leaves the game out (a game with a score is stored)', !res.games.some(x => x[0] === 'e1') && res.games.some(x => x[0] === 'e3' && x[4] === 3 && x[5] === 0), JSON.stringify(res.games));

// ---- a final after extra time: graded on the 90-minute score ----
reset();
await analyzeWith(asDone(FX.extraTime));
feed = { '20261121': FX.extraTime };
g = await gradeLeague(DATE, 'eng.1', env, { force: true }, after);
const f = card('e2').final;
ok('extra time: graded on the 90-minute score (1-1), ESPN\'s 2-1 kept as ft', g.graded === 1 && f.h === 1 && f.a === 1 && f.et === 'aet' && f.ft[0] === 2 && f.ft[1] === 1, JSON.stringify(f));
ok('extra time: the lead is read from the 90 minutes only', f.lead && f.lead[0] === 0 && f.lead[1] === 1, JSON.stringify(f.lead));

// ---- a game moved to the next day after kickoff: graded from its new day ----
reset();
await analyzeWith(FX.scheduled);
ok('moved game: the card exists on its first day', !!card('e3'));
feed = { '20261121': FX.movedFrom, '20261122': FX.movedTo };
await analyzeLeague(DATE, 'eng.1', env, new Date(KO + H)); // ESPN no longer lists it here; it had kicked off
ok('moved game: the card is kept after kickoff although ESPN lists no game that day', !!card('e3') && card('e3').odds && card('e3').odds.h === 120, JSON.stringify(day()?.cards));
g = await gradeLeague(DATE, 'eng.1', env, { force: true }, new Date(Date.parse('2026-11-22T15:00:00Z') + 4 * H));
ok('moved game: graded from the next day\'s scoreboard', g.graded === 1 && card('e3').final && card('e3').final.h === 3 && card('e3').final.a === 0, JSON.stringify(g));

// ---- a day with no games ----
reset();
let a = await analyzeWith(FX.zeroGames);
ok('no games: an answer with no events is a quiet day, not a feed error', a.fixtures === 0 && a.cards === 0 && !a.feedError && day().analyzed['eng.1'] > 0, JSON.stringify(a));
reset(); fail503 = true;
a = await analyzeLeague(DATE, 'eng.1', env, new Date(KO - 24 * H));
ok('no games because ESPN failed: reported, the league not marked analyzed', a.feedError === true && !day(), JSON.stringify(a));

// ---- a game with no odds block ----
reset();
ok('no odds block: nothing parsed', parseOdds(undefined) === null && parseOdds([]) === null && parseOdds([{ provider: { name: 'DraftKings' } }]) === null);
a = await analyzeWith(FX.noOdds);
ok('no odds block: the card is made, with no price', a.cards === 1 && card('e4') && !card('e4').odds, JSON.stringify(card('e4')?.odds));
const r = await refreshOdds(env, DATE, 'eng.1', new Date(KO - 2 * H), async () => new Response('{}', { status: 404 }));
ok('no odds block: a price read finds nothing and changes nothing', r.games === 1 && r.priced === 0 && !card('e4').odds, JSON.stringify(r));

console.log(fails ? `\n${fails} FAILED` : '\nAll ESPN edge-case checks passed');
process.exit(fails ? 1 : 0);
