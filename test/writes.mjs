// Write budget: which job wrote what (writeKind), today's count, and saver mode in the background job's slots.
import { writeKind, writesToday, runSlot, oddsStep, counted } from '../src/worker.js';
let fail = 0; const ok = (n, c, x = '') => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (c ? '' : ' ' + x)); if (!c) fail++; };
ok('writeKind: each key goes to its job', writeKind('day:2026-10-31') === 'soccer days' && writeKind('nhl:day:2026-10-31') === 'hockey' && writeKind('analyst') === 'analyst' && writeKind('res:eng.1') === 'results sync' && writeKind('meta:writes') === 'bookkeeping: write counter' && writeKind('meta:synced') === 'bookkeeping: sync times' && writeKind('meta:errors') === 'bookkeeping: sync problems' && writeKind('meta:fb') === 'bookkeeping: forebet' && writeKind('meta:unm') === 'bookkeeping: unmatched games' && writeKind('meta:new') === 'bookkeeping: other' && writeKind('rat:eng.1') === 'v4 ratings');
const kv = new Map(), env = (o = {}) => ({ HUB: { get: async (k, t) => { const v = kv.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => { kv.set(k, v); }, list: async () => ({ keys: [] }) }, ...o });
const now = new Date('2026-10-31T22:00:00Z');
kv.set('meta:writes', JSON.stringify({ d: '2026-10-31', n: 812, by: { 'soccer days': 600, hockey: 150 } }));
const w = await writesToday(env().HUB, now);
ok('writesToday: today\'s saved count and breakdown', w.used === 812 && w.by['soccer days'] === 600, JSON.stringify(w));
kv.set('meta:writes', JSON.stringify({ d: '2026-10-30', n: 990 }));
ok('writesToday: yesterday\'s count does not carry over', (await writesToday(env().HUB, now)).used === 0);
// Nov 6, 2026: yesterday's total for the health report (the nightly sweep runs just after the UTC reset)
{ const y1 = (await writesToday(env().HUB, now)).yesterday;
  ok('writesToday: before today\'s first save, the saved record is yesterday\'s total', y1 && y1.d === '2026-10-30' && y1.n === 990, JSON.stringify(y1));
  kv.set('meta:writes', JSON.stringify({ d: '2026-10-29', n: 700 }));
  ok('writesToday: an older day is not passed off as yesterday', (await writesToday(env().HUB, now)).yesterday === null);
  kv.set('meta:writes', JSON.stringify({ d: '2026-10-31', n: 5, by: {}, y: { d: '2026-10-30', n: 990, by: { hockey: 400 } } }));
  const y2 = (await writesToday(env().HUB, now)).yesterday;
  ok('writesToday: after the rollover, yesterday is read from the kept record', y2 && y2.n === 990 && y2.by.hockey === 400, JSON.stringify(y2));
  // the rollover itself: the first save of a new day keeps the day before inside the same write
  const d0 = new Date().toISOString().slice(0, 10), dy = new Date(Date.parse(d0 + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
  kv.set('meta:writes', JSON.stringify({ d: dy, n: 640, by: { 'soccer days': 300 } }));
  let puts = 0; const e2 = env(); const base = e2.HUB.put; e2.HUB.put = async (k, v) => { puts++; return base(k, v); };
  const c = counted(e2); await c.env.HUB.put('day:x', '{}'); await c.flush();
  const m = JSON.parse(kv.get('meta:writes'));
  ok('rollover: the new day starts its count and keeps yesterday\'s total and breakdown, with no extra write', m.d === d0 && m.n === 2 && m.y && m.y.d === dy && m.y.n === 640 && m.y.by['soccer days'] === 300 && puts === 2, JSON.stringify(m) + ' puts ' + puts);
  await c.env.HUB.put('day:y', '{}'); await c.flush();
  const m2 = JSON.parse(kv.get('meta:writes'));
  ok('rollover: later saves the same day keep yesterday as it was', m2.y && m2.y.n === 640 && m2.n > 2, JSON.stringify(m2));
  kv.delete('day:x'); kv.delete('day:y'); }
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
