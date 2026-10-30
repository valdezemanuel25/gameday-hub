// API-Football as the second both-score source: parsing, matching, the request budget and the fallback from The Odds API.
import { americanOf, parseAfBtts, matchFixture, fetchAfBtts, seasonFor, AF_LEAGUE, checkAf } from '../src/apifootball.js';
import { addBtts } from '../src/worker.js';
let fails = 0; const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n} ${c ? '' : x}`); };

ok('decimal to American', americanOf('1.72') === -139 && americanOf('2.05') === 105 && americanOf('2.00') === 100 && americanOf('abc') === null && americanOf('1') === null);
ok('seasons: Europe starts the year before in spring, calendar-year leagues do not', seasonFor('eng.1', '2026-10-30') === 2026 && seasonFor('eng.1', '2027-03-01') === 2026 && seasonFor('bra.1', '2026-10-30') === 2026 && seasonFor('usa.1', '2026-03-01') === 2026);
ok('every league the Hub prices abroad has an id', ['bra.1', 'eng.1', 'uefa.champions', 'mex.1'].every(s => AF_LEAGUE[s]));
const bets = (...bk) => ({ fixture: { id: 7 }, bookmakers: bk });
const bm = (name, odds, betName = 'Both Teams Score') => ({ name, bets: [{ id: 8, name: betName, values: [{ value: 'Yes', odd: odds[0] }, { value: 'No', odd: odds[1] }] }] });
ok('prefers the book on the card, then bet365', parseAfBtts(bets(bm('Bwin', ['1.8', '2']), bm('Bet365', ['1.72', '2.05']), bm('1xBet', ['1.7', '2.1'])), ['1xbet']).bk === '1xbet' && parseAfBtts(bets(bm('Bwin', ['1.8', '2']), bm('Bet365', ['1.72', '2.05']))).bk === 'bet365');
ok('first book when neither is there', parseAfBtts(bets(bm('Bwin', ['1.8', '2']))).bk === 'bwin');
ok('a half or combined Both Teams Score market is not the match one', parseAfBtts(bets(bm('Bet365', ['1.7', '2'], 'Both Teams Score - First Half'))) === null && parseAfBtts(bets(bm('Bet365', ['1.7', '2'], 'Both Teams Score & Result'))) === null);
ok('no market, no price', parseAfBtts(bets({ name: 'X', bets: [{ name: 'Match Winner', values: [] }] })) === null && parseAfBtts(null) === null);
const T1 = '2026-10-30T22:30:00Z';
const fixtures = [{ fixture: { id: 7, date: T1 }, teams: { home: { name: 'Gremio' }, away: { name: 'Athletico Paranaense' } } }, { fixture: { id: 8, date: T1 }, teams: { home: { name: 'Santos' }, away: { name: 'Fortaleza' } } }];
const card = { id: '1', home: 'Grêmio', away: 'Athletico-PR', kickoff: T1 };
ok('fixture matched by team names and kickoff', matchFixture({ ...card, home: 'Santos', away: 'Fortaleza' }, fixtures).fixture.id === 8 && matchFixture({ ...card, kickoff: '2026-10-31T22:30:00Z', home: 'Santos', away: 'Fortaleza' }, fixtures) === null);
// fetch: fixtures list, then odds pages; the request budget is read from the headers
const mk = (log, left = 90, pages = 1) => async (u, o) => { log.push(u); const hd = { get: k => (k === 'x-ratelimit-requests-remaining' ? String(left) : null) };
  if (!o || !o.headers || o.headers['x-apisports-key'] !== 'k') return { ok: false, status: 401, headers: hd };
  if (u.includes('/fixtures?')) return { ok: true, status: 200, headers: hd, json: async () => ({ errors: [], response: fixtures }) };
  const pg = Number((u.match(/page=(\d+)/) || [])[1]);
  return { ok: true, status: 200, headers: hd, json: async () => ({ errors: [], paging: { current: pg, total: pages }, response: pg === 1 ? [bets(bm('Bet365', ['1.72', '2.05']))] : [{ fixture: { id: 8 }, bookmakers: [bm('Bet365', ['1.9', '1.9'])] }] }) }; };
{ const log = [];
  const r = await fetchAfBtts('k', 'bra.1', '2026-10-30', [card, { id: '2', home: 'Santos', away: 'Fortaleza', kickoff: T1 }, { id: '3', home: 'X', away: 'Y', kickoff: T1 }], mk(log, 88, 2));
  ok('prices by card, the unmatched game skipped, 1 fixtures + 2 odds pages', r.prices.get('1').by === -139 && r.prices.get('2').by === -111 && r.skipped.join() === 'X v Y' && r.used === 3 && r.left === 88, JSON.stringify([r.skipped, r.used, r.left]));
  ok('asks the right league and season and the Both Teams Score bet', log[0].includes('league=71&season=2026&date=2026-10-30') && log[1].includes('bet=8')); }
{ const r = await fetchAfBtts('k', 'bra.1', '2026-10-30', [{ id: '3', home: 'X', away: 'Y', kickoff: T1 }], mk([]));
  ok('nothing matched: the odds feed is not asked (1 request)', r.used === 1 && r.prices.size === 0); }
ok('no key and wrong key are errors, not throws', (await fetchAfBtts('', 'bra.1', '2026-10-30', [card])).error && (await fetchAfBtts('bad', 'bra.1', '2026-10-30', [card], mk([]))).error.includes('401'));
// the fallback in addBtts: The Odds API has no credits (events 401), API-Football fills in
const now = new Date('2026-10-30T20:00:00Z'), dayCards = () => [{ id: '1', home: 'Grêmio', away: 'Athletico-PR', kickoff: T1, odds: { h: 125, d: 240, a: 205 } }];
const both = log => async (u, o) => (u.includes('api.the-odds-api.com') ? (log.push('odds-api'), { ok: false, status: 401, headers: { get: () => null } }) : mk(log, 80)(u, o));
{ const log = [], cs = dayCards(), n = await addBtts({ ODDS_API_KEY: 'x', APIFOOTBALL_KEY: 'k' }, cs, 'bra.1', now, both(log), '2026-10-30');
  ok('The Odds API out of credits: API-Football prices the game and notes the opening and book', cs[0].odds.by === -139 && cs[0].odds.bf.by === -139 && cs[0].odds.bk === 'bet365' && cs[0].odds.bfk === 'bet365' && n === 1, JSON.stringify(cs[0].odds)); }
{ const cs = dayCards(), n = await addBtts({ APIFOOTBALL_KEY: 'k' }, cs, 'bra.1', now, mk([]), '2026-10-30');
  ok('only an API-Football key works too', cs[0].odds.by === -139 && n === 1); }
{ const log = [], cs = dayCards(); cs[0].odds.bf = { by: -120, bn: 100 }; cs[0].odds.bk = 'draftkings'; cs[0].odds.bfk = 'draftkings'; cs[0].odds.by = -120; cs[0].odds.bn = 100;
  const close = new Date('2026-10-30T22:10:00Z'); await addBtts({ APIFOOTBALL_KEY: 'k' }, cs, 'bra.1', close, mk(log), '2026-10-30');
  ok('the close from the second source keeps the opening and notes the different book', cs[0].odds.bcl === close.toISOString() && cs[0].odds.bf.by === -120 && cs[0].odds.bk === 'bet365' && cs[0].odds.bfk === 'draftkings'); }
{ const log = [], cs = [{ id: '3', home: 'X', away: 'Y', kickoff: T1, odds: { h: 1, d: 2, a: 3 } }];
  await addBtts({ APIFOOTBALL_KEY: 'k' }, cs, 'bra.1', now, mk(log), '2026-10-30'); const first = log.length;
  ok('no match: the try is noted on the card', !!cs[0].odds.baf && first > 0);
  await addBtts({ APIFOOTBALL_KEY: 'k' }, cs, 'bra.1', new Date(now.getTime() + 3600e3), mk(log), '2026-10-30');
  ok('not tried again within 3 hours', log.length === first);
  await addBtts({ APIFOOTBALL_KEY: 'k' }, cs, 'bra.1', new Date(now.getTime() + 4 * 3600e3), mk(log), '2026-10-30');
  ok('tried again after 3 hours', log.length > first); }
{ const log = []; const n = await addBtts({}, dayCards(), 'bra.1', now, mk(log), '2026-10-30'); ok('no keys: nothing runs', n === 0 && log.length === 0); }
{ const log = [], cs = dayCards(); await addBtts({ APIFOOTBALL_KEY: 'k' }, cs, 'esp.2', now, mk(log), '2026-10-30'); ok('a league with no API-Football id is left alone', log.length === 0); }
const chk = await checkAf('k', 'bra.1', '2026-10-30', async (u, o) => (u.includes('/odds/bets') ? { ok: true, status: 200, headers: { get: () => '97' }, json: async () => ({ response: [{ id: 8, name: 'Both Teams Score' }] }) } : mk([], 96)(u, o)));
ok('check page: bet list, requests left and what the Hub parses', chk.bets[0].id === 8 && chk.requestsLeftToday === '96' && chk.parsed.by === -111, JSON.stringify(chk));
console.log(fails ? `\n${fails} FAILED` : '\nAll API-Football checks passed'); process.exit(fails ? 1 : 0);
