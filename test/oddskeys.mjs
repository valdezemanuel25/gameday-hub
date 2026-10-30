// The Odds API with a backup key: which key is used, when the backup takes over, and the 401 / 429 fall-through.
const store = new Map();
globalThis.caches = { default: { match: async r => { const v = store.get(typeof r === 'string' ? r : r.url); return v ? new Response(v) : undefined; }, put: async (r, res) => { store.set(typeof r === 'string' ? r : r.url, await res.text()); } } };
const { viaOddsKey, oddsKeys, addBtts, analystShop } = await import('../src/worker.js');
let fails = 0; const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n} ${c ? '' : x}`); };
const setCredits = (i, left, at = new Date().toISOString()) => store.set(`https://hub.local/btts-credits${i ? `-${i + 1}` : ''}`, JSON.stringify({ left, at }));
const reset = () => store.clear();
const E = { ODDS_API_KEY: 'k1', ODDS_API_KEY_2: 'k2' };

ok('keys: the main one first, the backup second, missing ones left out', oddsKeys(E).join() === 'k1,k2' && oddsKeys({ ODDS_API_KEY: 'a' }).join() === 'a' && oddsKeys({ ODDS_API_KEY_2: 'b' }).join() === 'b' && oddsKeys({}).length === 0);
{ reset(); const used = []; const r = await viaOddsKey(E, async k => { used.push(k); return { left: 300 }; });
  ok('both fine: the main key is used', used.join() === 'k1' && r.keyIndex === 0 && !r.error); }
{ reset(); setCredits(0, 21); const used = []; const r = await viaOddsKey(E, async k => { used.push(k); return { left: 480 }; });
  ok('main key under the reserve, backup healthy: the backup takes over', used.join() === 'k2' && r.keyIndex === 1); }
{ reset(); setCredits(0, 21); setCredits(1, 10); const used = []; await viaOddsKey(E, async k => { used.push(k); return { left: 20 }; });
  ok('both under the reserve: the first key with credits is used (closing reads still run)', used.join() === 'k1'); }
{ reset(); setCredits(0, 21); setCredits(1, 10); const used = []; const r = await viaOddsKey(E, async k => { used.push(k); return {}; }, { healthyOnly: true });
  ok('the Analyst only uses a key above the reserve', used.length === 0 && r.error.includes('reserve')); }
{ reset(); setCredits(0, 0); setCredits(1, 300); const used = []; await viaOddsKey(E, async k => { used.push(k); return { left: 299 }; });
  ok('main key out: the backup is used', used.join() === 'k2'); }
{ reset(); const used = []; const r = await viaOddsKey(E, async k => { used.push(k); return k === 'k1' ? { error: 'Odds API 401' } : { left: 400 }; });
  ok('main key answers 401: marked out, the same call goes to the backup', used.join() === 'k1,k2' && r.keyIndex === 1 && JSON.parse(store.get('https://hub.local/btts-credits')).left === 0 && JSON.parse(store.get('https://hub.local/btts-credits-2')).left === 400); }
{ reset(); const r = await viaOddsKey(E, async () => ({ error: 'Odds API 429' })); ok('both out: an error, not a throw', r.error.includes('no key has credits left')); }
{ reset(); setCredits(0, 0, new Date(Date.now() - 7 * 3600e3).toISOString()); setCredits(1, 0, new Date(Date.now() - 7 * 3600e3).toISOString()); const used = []; await viaOddsKey(E, async k => { used.push(k); return { left: 500 }; });
  ok('a key that was out more than 6 hours ago is looked at again (the monthly reset)', used.join() === 'k1'); }
{ reset(); setCredits(0, 0); setCredits(1, 0); const used = []; const r = await viaOddsKey(E, async k => { used.push(k); return {}; });
  ok('both out recently: no call at all', used.length === 0 && !!r.error); }
{ reset(); const used = []; await viaOddsKey({ ODDS_API_KEY: 'only' }, async k => { used.push(k); return { left: 50 }; }); ok('a single key works as before', used.join() === 'only'); }
{ reset(); const r = await viaOddsKey({}, async () => ({})); ok('no key: an error', r.error.includes('not set')); }
// through addBtts: with the main key at 0 credits the backup prices the game
{ reset(); setCredits(0, 0);
  const T1 = '2026-10-30T22:30:00Z', events = [{ id: 'e1', home_team: 'Gremio', away_team: 'Athletico Paranaense', commence_time: T1 }];
  const bk = { bookmakers: [{ key: 'draftkings', markets: [{ key: 'btts', outcomes: [{ name: 'Yes', price: -135 }, { name: 'No', price: 105 }] }] }] };
  const urls = []; const f = async u => { urls.push(u); const key = (u.match(/apiKey=(\w+)/) || [])[1]; return { ok: key === 'k2', status: key === 'k2' ? 200 : 401, headers: { get: () => '480' }, json: async () => (u.includes('/events?') ? events : bk) }; };
  const cs = [{ id: '1', home: 'Grêmio', away: 'Athletico-PR', kickoff: T1, odds: { h: 125, d: 240, a: 205 } }];
  const n = await addBtts(E, cs, 'bra.1', new Date('2026-10-30T15:00:00Z'), f);
  ok('addBtts: main key out, the backup prices the game and no call used the main key', cs[0].odds.by === -135 && n === 1 && urls.every(u => u.includes('apiKey=k2')), JSON.stringify([cs[0].odds, urls])); }
console.log(fails ? `\n${fails} FAILED` : '\nAll Odds API key checks passed'); process.exit(fails ? 1 : 0);
