// Forebet pages: parsed from real saved page source (test/fixtures), matched to cards, filled before kickoff only.
import fs from 'fs';
import { parseForebetHtml, matchRows, forebetFetch, forebetStep, fbUrl, FB_PAGES } from '../src/forebetpage.js';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : ' ' + x}`); };
const page = k => fs.readFileSync(new URL(`./fixtures/fb-${k}.html`, import.meta.url), 'utf8');

const r1 = parseForebetHtml(page('1x2'), '1x2', '2026-10-15');
ok('1X2 page: 4 upcoming games read, the September one skipped', r1.length === 4 && !r1.some(r => r.date < '2026-10-15'), JSON.stringify(r1.map(r => r.home)));
const un = r1.find(r => r.home === 'Union Saint-Gilloise');
ok('1X2 row: 39/28/33, pick 1, predicted 2-1', JSON.stringify(un.p) === '[39,28,33]' && un.pred === '1' && un.score.h === 2 && un.score.a === 1, JSON.stringify(un));
const ou = parseForebetHtml(page('ou'), 'ou', '2026-10-15'), bt = parseForebetHtml(page('btts'), 'btts', '2026-10-15');
ok('Under/Over page: Over % is the second number (58 / 50 / 54 / 50)', JSON.stringify(ou.map(r => r.over)) === '[58,50,54,50]', JSON.stringify(ou.map(r => r.over)));
ok('Both-score page: Yes % is the second number (55 / 46 / 46 / 44)', JSON.stringify(bt.map(r => r.btts)) === '[55,46,46,44]', JSON.stringify(bt.map(r => r.btts)));
ok('finished games are parsed when no start date is given', parseForebetHtml(page('1x2'), '1x2', '').length === 5);
ok('a page without matches gives no rows', parseForebetHtml('<html>blocked</html>', '1x2', '').length === 0);
ok('a two-way page is not read as 1X2', parseForebetHtml(page('ou'), '1x2', '').length === 0);

const mk = (id, h, a, ko) => ({ id, league: 'uefa.europa', home: h, away: a, kickoff: ko, final: null });
const cards = [mk('1', 'Union St.-Gilloise', 'Real Sociedad', '2026-10-15T16:45:00Z'), mk('2', 'TSG Hoffenheim', 'Besiktas', '2026-10-15T19:00:00Z'), mk('3', 'Benfica', 'Celtic', '2026-10-15T19:00:00Z'), mk('4', 'Sparta Prague', 'Lillestrom', '2026-10-15T19:00:00Z')];
const m = matchRows(r1, cards, '1x2');
ok('rows match ESPN-style names (TSG, SL, Praha/Prague, Lillestrøm)', m.size === 4 && JSON.stringify(m.get('3').p) === '[55,25,20]' && JSON.stringify(m.get('4').p) === '[40,35,25]', JSON.stringify([...m.keys()]));
const sw = matchRows(r1, [mk('9', 'Real Sociedad', 'Union St.-Gilloise', '2026-10-15T16:45:00Z')], '1x2').get('9');
ok('home/away swapped on the page flips the numbers', JSON.stringify(sw.p) === '[33,28,39]' && sw.score.h === 1 && sw.pred === '2');

// fake KV, count reads
const kv = new Map(); let reads = 0, fetches = [];
const env = { HUB: { get: async (k, t) => { reads++; const v = kv.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => { kv.set(k, v); } } };
const save = (d, cs) => kv.set(`day:${d}`, JSON.stringify({ date: d, analyzed: {}, cards: cs }));
save('2026-10-15', [...cards, { ...mk('5', 'Lyon', 'Crystal Palace', '2026-10-15T16:45:00Z'), final: { h: 1, a: 1 } }, mk('6', 'AC Milan', 'RB Salzburg', '2026-10-15T09:00:00Z')]); // 6 already started
const ffetch = async url => { fetches.push(url); return new Response(url.endsWith('/under-over') ? page('ou') : url.endsWith('/bothtoscore') ? page('btts') : page('1x2')); };
const now = new Date('2026-10-15T14:00:00Z'); // 8:00 AM Central: Union (16:45Z) and others not started

ok('page addresses are built from the league and table', fbUrl('uefa.europa', 'ou') === 'https://www.forebet.com/en/predictions-europe/uefa-europa-league/under-over' && fbUrl('eng.1', 'btts').endsWith('premier-league/bothtoscore'));
const a = await forebetFetch(env, 'uefa.europa', '1x2', now, ffetch);
const day = () => JSON.parse(kv.get('day:2026-10-15')).cards;
ok('fetch reads 4 rows and fills 4 open cards', a.rows === 4 && a.saved === 4, JSON.stringify(a));
ok('card.fb has the numbers, a time stamp and how it got there', JSON.stringify(day()[0].fb.p) === '[39,28,33]' && day()[0].fb.at === now.toISOString() && day()[0].fb.how === 'read from Forebet');
ok('a finished game and an already started game are untouched', !day()[4].fb && !day()[5].fb);
await forebetFetch(env, 'uefa.europa', 'ou', now, ffetch); await forebetFetch(env, 'uefa.europa', 'btts', now, ffetch);
ok('the three tables build one record per card', day()[0].fb.over === 58 && day()[0].fb.btts === 55 && day()[2].fb.over === 54 && day()[2].fb.p[0] === 55);
const again = await forebetFetch(env, 'uefa.europa', '1x2', now, ffetch);
ok('once every game has it, nothing is fetched again', again.skipped && fetches.length === 3, JSON.stringify(fetches.length));

// failures are recorded, not hidden
save('2026-10-16', [mk('7', 'Union St.-Gilloise', 'Real Sociedad', '2026-10-16T16:45:00Z')]);
const bad = await forebetFetch(env, 'uefa.europa', '1x2', now, async () => new Response('no', { status: 403 }));
const meta = JSON.parse(kv.get('meta:fb'));
ok('a 403 is recorded for the Status tab and fills nothing', bad.error === 'HTTP 403' && meta['uefa.europa|1x2'].ok === false && meta['uefa.europa|1x2'].msg === 'HTTP 403');
const empty = await forebetFetch(env, 'uefa.europa', '1x2', now, async () => new Response('<html>captcha</html>'));
ok('a page with no readable games is flagged, not trusted', empty.rows === 0 && JSON.parse(kv.get('meta:fb'))['uefa.europa|1x2'].ok === false);

// cron step: soonest games first, backs off after a read, few reads
fetches = []; reads = 0;
save('2026-10-15', []); save('2026-10-16', [mk('7', 'Union St.-Gilloise', 'Real Sociedad', '2026-10-16T16:45:00Z')]);
kv.delete('meta:fb');
const s1 = await forebetStep(env, now, ffetch);
ok('cron step reads one page', s1 && s1.slug === 'uefa.europa' && s1.kind === '1x2' && fetches.length === 1, JSON.stringify(s1));
ok('cron step stays within a few KV reads', reads <= 8, String(reads));
const s2 = await forebetStep(env, new Date(now.getTime() + 3600000), ffetch);
ok('the next run reads a different table (the first was read within 3 hours)', s2 && s2.kind !== '1x2');
kv.delete('meta:fb'); save('2026-10-16', []);
ok('nothing to fill: the step does nothing', (await forebetStep(env, now, ffetch)) === null);
ok('all nine league pages are set up', Object.keys(FB_PAGES).length === 10);

// Short Forebet names against full ESPN names (2. Bundesliga and similar)
{
  const { is } = await import('../src/forebetpage.js');
  const pairs = [['Düsseldorf', 'Fortuna Düsseldorf'], ['Dresden', 'Dynamo Dresden'], ['Bielefeld', 'Arminia Bielefeld'], ['Nürnberg', '1. FC Nürnberg'], ['Münster', 'Preußen Münster'], ['Braunschweig', 'Eintracht Braunschweig'], ['Energie Cottbus', 'Energie Cottbus'], ['Darmstadt', 'SV Darmstadt 98']];
  for (const [a, b] of pairs) if (!is(a, b)) { ok('short name '+a, false); }
  if (is('Dresden', 'Hannover 96') || is('Bochum', 'Bochum II') === false) { ok('name guard', false); }
  ok('short Forebet names match full club names', true);
}

console.log(fail ? `\n${fail} Forebet page checks FAILED` : '\nAll Forebet page checks passed');
process.exit(fail ? 1 : 0);
