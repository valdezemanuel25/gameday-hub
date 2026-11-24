// The background job's error log (src/errlog.js): the last ERR_MAX caught errors in one record, saved at most once a run and only
// when the run had an error, the same error at most once an hour; shown by /api/status and /api/health.
import worker from '../src/worker.js';
import { saveErrors, readErrors, answerErrors, errEntry, ERR_KEY, ERR_MAX } from '../src/errlog.js';
let fail = 0; const ok = (n, c, x = '') => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (c ? '' : ' ' + x)); if (!c) fail++; };

const kv = new Map(), puts = [];
let broken = null; // a key whose read fails
const HUB = {
  get: async (k, t) => { if (k === broken) throw new Error('KV read failed'); const v = kv.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; },
  put: async (k, v) => { puts.push(k); kv.set(k, v); }, delete: async k => { kv.delete(k); },
  list: async ({ prefix } = {}) => ({ keys: [...kv.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true }),
};
const env = { ADMIN_TOKEN: 'secret', GAME_HOURS: '2', GRADE_DELAY_HOURS: '3', ASSETS: { fetch: () => new Response('asset') }, HUB };
globalThis.fetch = async () => new Response(JSON.stringify({ events: [] }));

// ---- the record ----
const T = Date.parse('2026-11-24T12:00:00Z'), at = ms => new Date(T + ms);
ok('no errors: nothing is written', (await saveErrors(HUB, [], T)) === false && puts.length === 0);
await saveErrors(HUB, [errEntry('odds', new Error('ESPN 503'), at(0))], T);
ok('an error is kept with its job, time and message', (await readErrors(HUB)).length === 1 && (await readErrors(HUB))[0].job === 'odds' && (await readErrors(HUB))[0].msg === 'ESPN 503');
const n0 = puts.length;
ok('the same error within the hour is not written again', (await saveErrors(HUB, [errEntry('odds', 'ESPN 503', at(30 * 60000))], T + 30 * 60000)) === false && puts.length === n0);
ok('...but it is after the hour', (await saveErrors(HUB, [errEntry('odds', 'ESPN 503', at(61 * 60000))], T + 61 * 60000)) === true && (await readErrors(HUB)).length === 2);
await saveErrors(HUB, Array.from({ length: 30 }, (_, i) => errEntry('job' + i, 'x', at(2 * 3600000))), T + 2 * 3600000);
const all = await readErrors(HUB);
ok(`only the last ${ERR_MAX} are kept, newest last`, all.length === ERR_MAX && all[ERR_MAX - 1].job === 'job29', JSON.stringify(all.map(x => x.job)));
ok('a job answer\'s own error (and the burst\'s) is read as an error', answerErrors('odds', { job: 'odds', league: 'eng.1', error: 'a', also: [{ league: 'esp.1', error: 'b' }, { league: 'ita.1' }] }).map(x => x.msg).join() === 'eng.1: a,esp.1: b');
ok('a long message is cut short', errEntry('x', 'y'.repeat(500)).msg.length === 160);

// ---- a cron run ----
kv.clear(); puts.length = 0;
const run = async scheduledTime => { let p; await worker.scheduled({ scheduledTime }, env, { waitUntil: x => { p = x; } }); try { await p; } catch (e) { /* the rotating job's error still ends the run */ } };
// slot 0 (sync) reads meta:synced first: make that read fail
const slot0 = Math.floor(Date.now() / 1200000) * 1200000; // a multiple of 20 minutes is slot 0
broken = 'meta:synced';
await run(slot0);
const log = await readErrors(HUB), errPuts = puts.filter(k => k === ERR_KEY).length;
ok('a run whose job failed saves its error once', log.length >= 1 && log.some(x => x.job === 'slot' && /KV read failed/.test(x.msg)) && errPuts === 1, JSON.stringify([log, puts]));
broken = null; puts.length = 0;
await run(slot0 + 300000); // slot 1, nothing to grade: no error
ok('a run with no error does not touch the log', !puts.includes(ERR_KEY), JSON.stringify(puts));

// ---- shown on Status and in the health report ----
const go = path => worker.fetch(new Request('https://hub.test' + path, { headers: { 'x-admin-token': 'secret' } }), env, { waitUntil() {} });
const st = await (await go('/api/status')).json();
ok('the Status tab gets the log', Array.isArray(st.jobErrors) && st.jobErrors.some(x => x.job === 'slot'), JSON.stringify(st.jobErrors));
const h = await (await go('/api/health')).json();
ok('the health report (Sweep) gets the log', Array.isArray(h.jobErrors) && h.jobErrors.some(x => x.job === 'slot'), JSON.stringify(h.jobErrors));

console.log(fail ? `\n${fail} error log checks FAILED` : '\nAll error log checks passed'); process.exit(fail ? 1 : 0);
