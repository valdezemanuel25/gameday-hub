// SportsMole: matching, "We say" parsing, grading, and the one-league fetch (mocked pages).
import { parseListing, matchLink, parseWeSay, smGrade, norm } from '../src/sportsmole.js';
import worker, { smLeague } from '../src/worker.js';

let fails = 0;
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`); };

const listing = `<html><a href="https://www.sportsmole.co.uk/football/arsenal/champions-league/preview/arsenal-vs-lille-prediction-team-news-lineups_606658.html">Arsenal vs. Lille</a>
<a href='/football/man-united/champions-league/preview/atletico-madrid-vs-man-united-prediction-team-news-lineups_606700.html'>x</a>
<a href="/football/inter/champions-league/preview/inter-vs-club-brugge-prediction-team-news-lineups_606701.html">x</a>
<a href="/football/rb-leipzig/champions-league/preview/rb-leipzig-vs-psv-prediction-team-news-lineups_606702.html">x</a>
<a href="/football/bayern/preview/viking-vs-bayern-munich-prediction-team-news-lineups_606703.html">x</a>`;
const links = parseListing(listing);
ok('listing parsed (5 previews)', links.length === 5, String(links.length));
const find = (h, a) => matchLink(h, a, links)?.id;
ok('Arsenal vs Lille', find('Arsenal', 'Lille') === '606658');
ok('Atlético Madrid vs Manchester United', find('Atlético Madrid', 'Manchester United') === '606700');
ok('Internazionale vs Club Brugge', find('Internazionale', 'Club Brugge') === '606701');
ok('RB Leipzig vs PSV Eindhoven', find('RB Leipzig', 'PSV Eindhoven') === '606702');
ok('Viking FK vs Bayern Munich', find('Viking FK', 'Bayern Munich') === '606703');
ok('no wrong match', find('Arsenal', 'Chelsea') === undefined);

const w = parseWeSay('<div><h2>We say: Arsenal 2-0 Lille</h2><p>Arsenal should win…</p></div>');
ok('parse "We say: Arsenal 2-0 Lille"', w && w.h === 2 && w.a === 0 && w.text === 'Arsenal 2–0 Lille', JSON.stringify(w));
ok('no We say -> null', parseWeSay('<p>nothing</p>') === null);
const w2 = parseWeSay('<h2>We say:   Man City 1-1   PSG</h2>');
ok('score with spaces / en dash', w2 && w2.h === 1 && w2.a === 1, JSON.stringify(w2));

const g = smGrade({ h: 2, a: 0 }, { h: 3, a: 0 });
ok('grading: outcome hit, score miss, O/U miss (U vs O), BTTS hit (No/No)', g.outcomeHit && !g.scoreHit && !g.ouHit && g.bttsHit, JSON.stringify(g));
const g2 = smGrade({ h: 1, a: 1 }, { h: 0, a: 1 });
ok('grading: outcome miss, O/U hit(U/U), BTTS miss', !g2.outcomeHit && g2.ouHit && !g2.bttsHit, JSON.stringify(g2));

// ---- one-league fetch + tally ----
const kv = new Map();
const env = { ADMIN_TOKEN: 's', HUB: { get: async (k, t) => { const v = kv.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => { kv.set(k, v); }, list: async ({ prefix }) => ({ keys: [...kv.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }) }, ASSETS: { fetch: () => new Response('') } };
let hits = 0;
globalThis.fetch = async url => {
  hits++;
  const u = String(url);
  if (u.endsWith('/football/preview/')) return new Response(listing);
  if (u.includes('_606658')) return new Response('<h2>We say: Arsenal 2-0 Lille</h2>');
  return new Response('', { status: 404 });
};
const card = (id, h, a, final) => ({ id, league: 'uefa.champions', home: h, away: a, v2: { p: [50, 25, 25], pick: 'H', over: 40, btts: 45 }, v3: {}, final: final || null, kickoff: '2026-10-20T19:00:00Z' });
kv.set('day:2026-10-20', JSON.stringify({ date: '2026-10-20', cards: [card('1', 'Arsenal', 'Lille'), card('2', 'Arsenal', 'Chelsea')] }));
const r = await smLeague('2026-10-20', 'uefa.champions', env, new Date('2026-10-20T12:00:00Z'));
const day = JSON.parse(kv.get('day:2026-10-20'));
ok('fetch: found 1, missed 1', r.found === 1 && r.missed === 1, JSON.stringify(r));
ok('card carries the SportsMole line', day.cards[0].sm?.text === 'Arsenal 2–0 Lille');
const before = hits;
const r2 = await smLeague('2026-10-20', 'uefa.champions', env, new Date('2026-10-20T12:30:00Z'));
ok('tried-recently cards are not refetched (no extra requests)', r2.idle === true && hits === before, JSON.stringify(r2));
// previews vanish from SportsMole's list after kickoff: the saved copy still matches
const { getListing } = await import('../src/sportsmole.js');
const realFetch = globalThis.fetch;
globalThis.fetch = async url => String(url).endsWith('/football/preview/') ? new Response('<html>no previews today</html>') : realFetch(url);
kv.delete('sm:list');
const kept = await getListing(env, Date.now() + 25 * 60000);
ok('a preview that disappeared from the list is still matched (kept 14 days)', matchLink('Arsenal', 'Lille', kept)?.id === '606658', String(kept.length));
globalThis.fetch = realFetch;
const t = await (await worker.fetch(new Request('https://x/api/tally', { headers: { authorization: 'Basic ' + btoa('me:s') } }), env)).json();
ok('tally carries over the Hub\'s 141 SportsMole matches', t.smCompare.n === 141 && t.smCompare.model.outcome === 73 && t.smCompare.sm.outcome === 76 && t.smCompare.sm.score === 13, JSON.stringify([t.smCompare.n, t.smCompare.model, t.smCompare.sm]));
console.log(fails ? `\n${fails} FAILED` : '\nAll SportsMole checks passed');
process.exit(fails ? 1 : 0);
