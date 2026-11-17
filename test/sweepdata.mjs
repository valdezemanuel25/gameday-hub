// Nightly stats files for the sweep (src/sweepdata.js): three small files saved to a separate GitHub data repo just after midnight
// Central, so the nightly sweep can read the Hub's results without the health link. Reads only on the Hub side: no KV writes.
import { partDue, dayGaps, trimTotals, buildPart, putFile, sweepStep, FRESH_MIN } from '../src/sweepdata.js';
let fail = 0; const ok = (n, c, x = '') => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (c ? '' : ' ' + x)); if (!c) fail++; };
const H = 3600000;

// --- when each part is due (Central time; the cron fires every 5 minutes) ---
// Nov 17, 2026 is standard time (UTC-6): 00:10 Central = 06:10 UTC.
const cst = hm => new Date(`2026-11-17T${hm}:00-06:00`);
ok('due: 00:10 Central is the soccer file', partDue(cst('00:10')) === 'soccer', String(partDue(cst('00:10'))));
ok('due: 00:15 is hockey and 00:20 is health', partDue(cst('00:17')) === 'nhl' && partDue(cst('00:20')) === 'health');
ok('due: 00:25 to 00:39 is a second try at each file, in the same order', partDue(cst('00:25')) === 'soccer' && partDue(cst('00:30')) === 'nhl' && partDue(cst('00:36')) === 'health');
ok('due: nothing is due before 00:10, from 00:40 on, or at midday', partDue(cst('00:09')) === null && partDue(cst('00:40')) === null && partDue(cst('12:15')) === null);
// Jul 1, 2026 is daylight time (UTC-5): the window follows Central time, not UTC.
ok('due: the window follows Central time through daylight saving', partDue(new Date('2026-07-01T00:12:00-05:00')) === 'soccer' && partDue(new Date('2026-07-01T06:12:00Z')) === null);

// --- gaps: what is missing on each day, and games stuck without a result ---
const NOW = Date.parse('2026-11-17T06:10:00Z'), at = h => new Date(NOW + h * H).toISOString();
const sg = dayGaps({
  '2026-11-14': [
    { id: '1', league: 'eng.1', home: 'A', away: 'B', kickoff: at(-60), v4: {}, final: { h: 1, a: 0 }, grade: {}, odds: { h: -120, d: 250, a: 300 } },   // no Forebet
    { id: '2', league: 'eng.1', home: 'C', away: 'D', kickoff: at(-60), v4: {}, final: { h: 1, a: 0 }, grade: {}, fb: {} },                                 // no price
    { id: '3', league: 'esp.2', home: 'E', away: 'F', kickoff: at(-60), v4: {}, fb: {} },                                                                    // stuck 60h; league not priced
    { id: '4', league: 'uefa.nations', home: 'G', away: 'H', kickoff: at(-60), skipped: 'Club not found' } ],                                               // skipped: not counted
  '2026-11-17': [
    { id: '5', league: 'eng.1', home: 'I', away: 'J', kickoff: at(12), v4: {}, fb: {}, odds: { h: -120, d: 250, a: 300 } } ],                               // not started
}, NOW, { priced: new Set(['eng.1']) });
const d14 = sg.days.find(d => d.date === '2026-11-14');
ok('gaps: a day counts its cards without the skipped ones', d14 && d14.cards === 3, JSON.stringify(d14));
ok('gaps: cards with no Forebet read are counted', d14.noForebet === 1);
ok('gaps: prices are counted over the priced leagues only', d14.pricedCards === 2 && d14.noPrice === 1, JSON.stringify(d14));
ok('gaps: a game past the grace time with no grade is counted as ungraded; one not started is not', d14.ungraded === 1 && sg.days.find(d => d.date === '2026-11-17').ungraded === 0);
ok('gaps: a game 48+ hours past kickoff with no result is named as stuck with its hours', sg.stuck.length === 1 && /E v F/.test(sg.stuck[0].game) && sg.stuck[0].hoursPast === 60 && sg.stuck[0].date === '2026-11-14', JSON.stringify(sg.stuck));
ok('gaps: soccer days carry no hockey-only counts', !('noGoalie' in d14) && !('noLine' in d14));
const hg = dayGaps({ '2026-11-15': [
  { id: 'a', home: 'PHI', away: 'EDM', kickoff: at(-30), v2: {}, v4: {}, final: { h: 2, a: 5 }, grade: {}, px: { h: 124, a: -148 }, gk: {}, ln: { v: 5.5 } },  // no Forebet
  { id: 'b', home: 'DAL', away: 'NSH', kickoff: at(-30), v2: {}, v4: {}, final: { h: 2, a: 1 }, grade: {}, fb: {} } ] }, NOW, { sport: 'nhl' });               // no price, goalie, line
const h15 = hg.days[0];
ok('gaps (hockey): missing Forebet, price, goalie read and DraftKings line are each counted', h15.cards === 2 && h15.noForebet === 1 && h15.noPrice === 1 && h15.noGoalie === 1 && h15.noLine === 1 && h15.pricedCards === 2, JSON.stringify(h15));
ok('gaps: days come out oldest first', sg.days.map(d => d.date).join() === '2026-11-14,2026-11-17');

// --- totals are trimmed to what the sweep reads (the long game lists stay in the Hub) ---
const tt = trimTotals({ v2: { n: 5 }, recent: [1, 2, 3], earlier: [4], smCompare: { n: 2, recent: [1], earlier: [2] }, leans: { n: 3, recent: [{ date: 'x' }] } });
ok('trim: the long game lists are dropped', !('recent' in tt) && !('earlier' in tt) && !('recent' in tt.smCompare) && !('earlier' in tt.smCompare) && tt.smCompare.n === 2);
ok("trim: the headline picks' recent list is kept (the 7-day hit rate reads it), and records are untouched", tt.leans.recent.length === 1 && tt.v2.n === 5);
ok('trim: the totals handed in are not changed', (() => { const src = { recent: [1], smCompare: { recent: [1] } }; trimTotals(src); return src.recent.length === 1 && src.smCompare.recent.length === 1; })());

// --- each part is built from the Hub's own reads ---
const deps = {
  soccerTotals: async () => ({ v2: { n: 805 }, recent: [1] }), nhlTotals: async () => ({ graded: 224, recent: [1] }),
  soccerDays: async () => ({ '2026-11-14': [{ id: '1', league: 'eng.1', home: 'A', away: 'B', kickoff: at(-60), v4: {} }] }),
  nhlDays: async () => ({ '2026-11-15': [{ id: 'a', home: 'PHI', away: 'EDM', kickoff: at(-30), v4: {} }] }),
  health: async () => ({ at: 'x', writes: { used: 4 } }), priced: new Set(['eng.1']),
};
const ps = await buildPart('soccer', deps, NOW), pn = await buildPart('nhl', deps, NOW), ph = await buildPart('health', deps, NOW);
ok('build: the soccer file has the time, trimmed totals and gaps', ps.exportedAt === new Date(NOW).toISOString() && ps.part === 'soccer' && ps.totals.v2.n === 805 && !('recent' in ps.totals) && ps.gaps.stuck.length === 1, JSON.stringify(ps).slice(0, 200));
ok('build: the hockey file has hockey totals and hockey gaps', pn.part === 'nhl' && pn.totals.graded === 224 && pn.gaps.days[0].noGoalie === 1);
ok('build: the health file carries the health report as is', ph.part === 'health' && ph.health.writes.used === 4 && ph.exportedAt === new Date(NOW).toISOString());

// --- saving a file to GitHub ---
const b64json = s => JSON.parse(Buffer.from(s, 'base64').toString('utf8'));
const gh = (existing) => { const calls = []; const f = async (url, init = {}) => { calls.push({ url, init });
  if ((init.method || 'GET') === 'GET') return existing ? new Response(JSON.stringify({ sha: 'abc', content: Buffer.from(JSON.stringify(existing)).toString('base64') }), { status: 200 }) : new Response('{"message":"Not Found"}', { status: 404 });
  return new Response('{"content":{}}', { status: existing ? 200 : 201 }); }; return { f, calls }; };
{
  const { f, calls } = gh(null);
  const r = await putFile({ repo: 'me/data', path: 'soccer.json', token: 'T0KEN', obj: { exportedAt: new Date(NOW).toISOString(), club: 'Atlético' }, now: NOW }, f);
  const put = calls.find(c => c.init.method === 'PUT'), body = put && JSON.parse(put.init.body);
  ok('save: a new file is created with one read and one save', r.saved === true && calls.length === 2 && /repos\/me\/data\/contents\/soccer\.json$/.test(put.url), JSON.stringify(r));
  ok('save: the token goes in the header, never in the address', put.init.headers.authorization === 'Bearer T0KEN' && !calls.some(c => c.url.includes('T0KEN')));
  ok('save: the content survives accents (UTF-8) and a new file sends no sha', b64json(body.content).club === 'Atlético' && !('sha' in body));
  ok('save: GitHub is given a user-agent (it refuses requests without one)', !!put.init.headers['user-agent']);
}
{
  const { f, calls } = gh({ exportedAt: new Date(NOW - 26 * H).toISOString() });
  const r = await putFile({ repo: 'me/data', path: 'nhl.json', token: 'T', obj: { exportedAt: new Date(NOW).toISOString() }, now: NOW }, f);
  ok("save: yesterday's file is replaced, passing its sha", r.saved === true && JSON.parse(calls.find(c => c.init.method === 'PUT').init.body).sha === 'abc');
}
{
  const { f, calls } = gh({ exportedAt: new Date(NOW - (FRESH_MIN - 5) * 60000).toISOString() });
  const r = await putFile({ repo: 'me/data', path: 'nhl.json', token: 'T', obj: { exportedAt: new Date(NOW).toISOString() }, now: NOW }, f);
  ok('save: a file saved in the last few minutes is left alone (the second try does nothing)', r.saved === false && r.fresh === true && calls.length === 1, JSON.stringify(r));
}
{
  const f = async (url, init = {}) => (init.method === 'PUT' ? new Response('{"message":"Bad credentials"}', { status: 401 }) : new Response('{}', { status: 404 }));
  const r = await putFile({ repo: 'me/data', path: 'nhl.json', token: 'T', obj: { exportedAt: 'x' }, now: NOW }, f);
  ok('save: a refused save reports the status and does not throw', r.saved === false && r.status === 401, JSON.stringify(r));
}

// --- the cron step ---
{
  const { f, calls } = gh(null);
  const env = { SWEEP_GH_TOKEN: 'T', SWEEP_REPO: 'me/data' };
  const r = await sweepStep(env, deps, cst('00:15'), f);
  ok('step: at 00:15 Central the hockey file is built and saved', r && r.part === 'nhl' && r.saved === true && /contents\/nhl\.json$/.test(calls[0].url), JSON.stringify(r));
  const built = b64json(JSON.parse(calls.find(c => c.init.method === 'PUT').init.body).content);
  ok('step: the saved file is the built part', built.part === 'nhl' && built.totals.graded === 224);
  ok('step: outside the window nothing is read or saved', (await sweepStep(env, deps, cst('09:00'), f)) === null && calls.length === 2);
}
{
  const { f, calls } = gh(null); let built = 0; const d2 = { ...deps, soccerTotals: async () => { built++; return {}; } };
  ok('step: without the token or the repo name it does nothing at all', (await sweepStep({ SWEEP_REPO: 'me/data' }, d2, cst('00:10'), f)) === null && (await sweepStep({ SWEEP_GH_TOKEN: 'T' }, d2, cst('00:10'), f)) === null && calls.length === 0 && built === 0);
}
{
  const { f } = gh(null); const d3 = { ...deps, soccerTotals: async () => { throw new Error('KV down'); } };
  const r = await sweepStep({ SWEEP_GH_TOKEN: 'T', SWEEP_REPO: 'me/data' }, d3, cst('00:10'), f);
  ok('step: a read that fails is reported, not thrown (the background job carries on)', r && r.part === 'soccer' && r.saved === false && /KV down/.test(r.error), JSON.stringify(r));
}
{
  // Nov 16, 2026 (found by the sweep's first run): the second try used to build the whole file before seeing it was already saved, and
  // still took the rotating job's turn. A fresh file now means: nothing is built, and the step answers null so the rotating job runs.
  const { f, calls } = gh({ exportedAt: new Date(cst('00:35').getTime() - 15 * 60000).toISOString() }); let built = 0; const d4 = { ...deps, health: async () => { built++; return {}; } };
  const r = await sweepStep({ SWEEP_GH_TOKEN: 'T', SWEEP_REPO: 'me/data' }, d4, cst('00:35'), f);
  ok('step: when the file was saved minutes ago the second try builds nothing, saves nothing and hands the turn back', r === null && built === 0 && calls.length === 1 && !calls.some(c => c.init.method === 'PUT'), JSON.stringify({ r, built, n: calls.length }));
}
{
  const { f, calls } = gh({ exportedAt: new Date(cst('00:20').getTime() - 26 * H).toISOString() }); let built = 0; const d5 = { ...deps, health: async () => { built++; return {}; } };
  const r = await sweepStep({ SWEEP_GH_TOKEN: 'T', SWEEP_REPO: 'me/data' }, d5, cst('00:20'), f);
  ok("step: yesterday's file is rebuilt once and replaced with one read and one save", r && r.saved === true && built === 1 && calls.length === 2 && JSON.parse(calls[1].init.body).sha === 'abc', JSON.stringify({ r, built, n: calls.length }));
}
{
  // The rotating job gives up its turn only to a run that really built a file (scheduled() in src/worker.js reads `built`).
  const refuse = async () => new Response('{"message":"Bad credentials"}', { status: 401 }); let built = 0; const d6 = { ...deps, health: async () => { built++; return {}; } };
  const r = await sweepStep({ SWEEP_GH_TOKEN: 'T', SWEEP_REPO: 'me/data' }, d6, cst('00:20'), refuse);
  ok('step: a refused read builds nothing and is not marked as built', r && r.saved === false && r.status === 401 && !r.built && built === 0, JSON.stringify(r));
  const { f } = gh(null); const r2 = await sweepStep({ SWEEP_GH_TOKEN: 'T', SWEEP_REPO: 'me/data' }, deps, cst('00:20'), f);
  ok('step: a run that built and saved a file is marked as built', r2 && r2.built === true && r2.saved === true, JSON.stringify(r2));
}

// --- wired into the Worker: the real Results summary and saved days, in-memory KV ---
{
  const { sweepData } = await import('../src/worker.js');
  const kv = new Map(), put = (k, v) => kv.set(k, JSON.stringify(v));
  const HUB = { get: async (k, type) => { const v = kv.get(k); return v == null ? null : type === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => { kv.set(k, v); }, delete: async k => { kv.delete(k); },
    list: async ({ prefix }) => ({ keys: [...kv.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }) };
  put('day:2026-11-14', { date: '2026-11-14', cards: [{ id: '1', league: 'eng.1', home: 'A', away: 'B', kickoff: '2026-11-14T15:00Z', v2: { p: [50, 25, 25], pick: 'H', over: 55, btts: 55 } }] });
  put('day:2026-10-01', { date: '2026-10-01', cards: [{ id: '0', league: 'eng.1', home: 'Old', away: 'Game', kickoff: '2026-10-01T15:00Z', v2: { p: [50, 25, 25], pick: 'H', over: 55, btts: 55 } }] });
  put('nhl:day:2026-11-15', { date: '2026-11-15', cards: [{ id: 'a', home: 'PHI', away: 'EDM', hAbbr: 'PHI', aAbbr: 'EDM', kickoff: '2026-11-16T00:30Z', v2: { w: 40, o: 56 }, v4: { w: 42, o: 56 } }] });
  const env = { HUB, SWEEP_GH_TOKEN: 'T', SWEEP_REPO: 'me/data', GAME_HOURS: '2', GRADE_DELAY_HOURS: '3' };
  const before = kv.size, sent = {};
  for (const hm of ['00:10', '00:15', '00:20']) {
    const { f, calls } = gh(null); const r = await sweepData(env, cst(hm), f);
    const putCall = calls.find(c => c.init.method === 'PUT'); if (putCall) sent[r.part] = b64json(JSON.parse(putCall.init.body).content);
  }
  ok('worker: the soccer file carries the real Results summary and the last two weeks of gaps', sent.soccer && sent.soccer.totals && 'v2' in sent.soccer.totals && sent.soccer.gaps.days.some(d => d.date === '2026-11-14') && !sent.soccer.gaps.days.some(d => d.date === '2026-10-01'), JSON.stringify(sent.soccer || null).slice(0, 300));
  ok('worker: the stuck soccer game is named', sent.soccer && sent.soccer.gaps.stuck.length === 1 && /A v B/.test(sent.soccer.gaps.stuck[0].game));
  ok('worker: the hockey file carries the hockey summary and gaps', sent.nhl && 'graded' in sent.nhl.totals && sent.nhl.gaps.days[0].date === '2026-11-15' && sent.nhl.gaps.days[0].noGoalie === 1, JSON.stringify(sent.nhl || null).slice(0, 300));
  ok('worker: the health file carries the health report (writes, analyst)', sent.health && sent.health.health && 'writes' in sent.health.health && 'analyst' in sent.health.health, JSON.stringify(sent.health || null).slice(0, 300));
  ok('worker: building and saving the files writes nothing to KV', kv.size === before);
  ok('worker: no file holds the token', !JSON.stringify(sent).includes('"T"') && !/SWEEP_GH_TOKEN/.test(JSON.stringify(sent)));
}

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED'); process.exit(fail ? 1 : 0);
