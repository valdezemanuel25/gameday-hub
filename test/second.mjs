// La Liga 2 and 2. Bundesliga priced from Nov 2, 2026 (src/data.js SECOND_PRICED): ESPN's DraftKings price only, no Odds API credit.
import { PRICED, SECOND_PRICED, FIRST_DIV, isCounted } from '../src/data.js';
import { refreshOdds } from '../src/worker.js';
import fs from 'fs';
let bad = 0; const ok = (n, c, x = '') => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (c ? '' : ' ' + x)); if (!c) bad++; };
ok('La Liga 2 and 2. Bundesliga are priced, still not first divisions, still out of the model records', ['esp.2', 'ger.2'].every(s => PRICED.has(s) && SECOND_PRICED.has(s) && !FIRST_DIV.has(s) && !isCounted(s, '2026-11-07')));
// a 2. Bundesliga price read: ESPN gives DraftKings; nothing else is asked even with Odds API keys set
const KO = '2026-11-07T12:00:00Z', NOW = new Date('2026-11-07T06:00:00Z'), urls = [];
const ev = { id: '777', date: KO, competitions: [{ status: { type: { completed: false } }, odds: [{ provider: { name: 'DraftKings' }, moneyline: { home: { close: { odds: '+160' } }, draw: { close: { odds: '+260' } }, away: { close: { odds: '+140' } } }, total: { over: { close: { line: 'o2.5', odds: '-120' } }, under: { close: { line: 'u2.5', odds: '+100' } } } }],
  competitors: [{ homeAway: 'home', team: { id: '1', displayName: 'VfL Osnabrück', abbreviation: 'OSN' } }, { homeAway: 'away', team: { id: '2', displayName: 'Kaiserslautern', abbreviation: 'FCK' } }] }] };
globalThis.fetch = async u => { urls.push(String(u)); return new Response(JSON.stringify(/espn/.test(String(u)) ? { events: [ev] } : { events: [] })); };
const kv = new Map([['day:2026-11-07', JSON.stringify({ date: '2026-11-07', cards: [{ id: '777', league: 'ger.2', home: 'VfL Osnabrück', away: 'Kaiserslautern', kickoff: KO, v2: { p: [40, 28, 32] }, v4: { p: [41, 27, 32], over: 55, btts: 55 } }] })]]);
const env = { ODDS_API_KEY: 'x', HUB: { get: async (k, t) => { const x = kv.get(k); return x == null ? null : t === 'json' ? JSON.parse(x) : x; }, put: async (k, x) => { kv.set(k, x); }, list: async () => ({ keys: [] }) } };
const r = await refreshOdds(env, '2026-11-07', 'ger.2', NOW, globalThis.fetch);
const c = JSON.parse(kv.get('day:2026-11-07')).cards[0];
ok('2. Bundesliga: the price read saves the DraftKings price from ESPN', r.priced === 1 && c.odds && c.odds.h === 160 && c.odds.a === 140 && c.odds.tl === 2.5, JSON.stringify([r, c.odds]));
ok('2. Bundesliga: no Odds API call (no credits spent)', !urls.some(u => /the-odds-api/.test(u)), JSON.stringify(urls));
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
ok('page: La Liga 2 and 2. Bundesliga show their price on picks and in Refresh prices', /const PRICED_LG = new Set\(\[\.\.\.FIRST, 'esp\.2', 'ger\.2'\]\)/.test(html) && /PRICED_LG\.has\(c\.league\) \? priceLine\(/.test(html));
import { same } from '../src/names.js';
const names = [['Kaiserslautern', '1. FC Kaiserslautern'], ['VfL Osnabruck', 'Osnabrueck'], ['1. FC Nürnberg', '1. FC Nuernberg'], ['SV Darmstadt 98', 'Darmstadt 98'], ['Hertha Berlin', 'Hertha BSC'], ['SpVgg Greuther Fürth', 'Greuther Furth'],
  ['Cádiz', 'Cadiz'], ['Córdoba', 'Cordoba'], ['Leganés', 'Leganes'], ['Albacete', 'Albacete Balompie'], ['Sporting Gijón', 'Sporting Gijon'], ['Deportivo La Coruña', 'Deportivo La Coruna'], ['Racing Santander', 'Racing de Santander'], ['Real Sociedad II', 'Real Sociedad B']];
ok('Pinnacle names: second-division clubs match their usual spellings (accents, umlauts written out, II = B)', names.every(([a, b]) => same(a, b)), JSON.stringify(names.filter(([a, b]) => !same(a, b))));
ok('Pinnacle names: different clubs still do not match', !same('Union Berlin', 'Hertha Berlin') && !same('Hamburg SV', 'Hannover 96') && !same('Real Sociedad', 'Real Betis'));
console.log(bad ? `\n${bad} FAILED` : '\nAll second-division price checks passed'); process.exit(bad ? 1 : 0);
