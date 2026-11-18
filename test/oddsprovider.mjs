// ESPN names DraftKings two ways ("DraftKings", "Draft Kings"). Both must be found, or a stand-in listed before it is taken instead
// (Nov 18, 2026 audit).
import { parseOdds } from '../src/data.js';
let fail = 0; const ok = (n, c, x = '') => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (c ? '' : ' ' + x)); if (!c) fail++; };
const b365 = { provider: { name: 'Bet 365' }, homeTeamOdds: { moneyLine: 1.55 }, awayTeamOdds: { moneyLine: 5.25 }, drawOdds: { moneyLine: 4.75 } };
const dk = name => ({ provider: { id: '100', name }, moneyline: { home: { close: { odds: '+160' } }, draw: { close: { odds: '+245' } }, away: { close: { odds: '+150' } } } });
let o = parseOdds([b365, dk('Draft Kings')]);
ok('"Draft Kings" (with a space) listed after a Bet365 stand-in is still the price taken, unmarked', o && o.h === 160 && !o.src, JSON.stringify(o));
o = parseOdds([b365, dk('DraftKings')]); ok('"DraftKings" works as before', o && o.h === 160 && !o.src);
o = parseOdds([b365]); ok('with no DraftKings at all the Bet365 stand-in is still used and marked', o && o.src === 'bet365');

console.log(fail ? `\n${fail} odds provider checks FAILED` : '\nAll odds provider checks passed'); process.exit(fail ? 1 : 0);
