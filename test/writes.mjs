// Write budget: which job wrote what (writeKind), today's count, and saver mode in the background job's slots.
import { writeKind, writesToday, runSlot, oddsStep } from '../src/worker.js';
let fail = 0; const ok = (n, c, x = '') => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (c ? '' : ' ' + x)); if (!c) fail++; };
ok('writeKind: each key goes to its job', writeKind('day:2026-10-31') === 'soccer days' && writeKind('nhl:day:2026-10-31') === 'hockey' && writeKind('analyst') === 'analyst' && writeKind('res:eng.1') === 'results sync' && writeKind('meta:writes') === 'bookkeeping' && writeKind('rat:eng.1') === 'v4 ratings');
const kv = new Map(), env = (o = {}) => ({ HUB: { get: async (k, t) => { const v = kv.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => { kv.set(k, v); }, list: async () => ({ keys: [] }) }, ...o });
const now = new Date('2026-10-31T22:00:00Z');
kv.set('meta:writes', JSON.stringify({ d: '2026-10-31', n: 812, by: { 'soccer days': 600, hockey: 150 } }));
const w = await writesToday(env().HUB, now);
ok('writesToday: today\'s saved count and breakdown', w.used === 812 && w.by['soccer days'] === 600, JSON.stringify(w));
kv.set('meta:writes', JSON.stringify({ d: '2026-10-30', n: 990 }));
ok('writesToday: yesterday\'s count does not carry over', (await writesToday(env().HUB, now)).used === 0);
// saver mode in the slots: SportsMole slot hands over to hockey (no SportsMole / Forebet saves)
let hit = []; const real = globalThis.fetch; globalThis.fetch = async u => { hit.push(String(u)); return { ok: false, status: 503, json: async () => ({}), text: async () => '' }; };
const day = { date: '2026-10-31', analyzed: { 'eng.1': now.getTime() - 7 * 3600000 }, cards: [{ id: '1', league: 'eng.1', home: 'A', away: 'B', kickoff: '2026-11-01T15:00:00Z', v2: { p: [50, 25, 25] } }] };
kv.set('day:2026-10-31', JSON.stringify(day));
const r3 = await runSlot(env({ SAVER: true }), now, 3);
ok('saver mode: the SportsMole / Forebet slot does no SportsMole or Forebet work', !/sportsmole|forebet/.test(JSON.stringify(r3)) && !hit.some(u => /sportsmole|forebet/.test(u)), JSON.stringify(r3));
hit = []; const r2 = await runSlot(env({ SAVER: true }), now, 2);
ok('saver mode: a league already analyzed today is not analyzed again', !(r2 && r2.job === 'analyze' && r2.league === 'eng.1'), JSON.stringify(r2));
globalThis.fetch = real;
console.log(fail ? `\n${fail} write-budget check(s) FAILED` : '\nAll write-budget checks passed'); process.exit(fail ? 1 : 0);
