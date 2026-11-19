// Fixes from the nightly sweep of Nov 19, 2026:
//   1. the stats-file step says what happened (health.sweepData: whether the token is set, and the last answer per file);
//   2. hockey never grades a game ESPN calls final but sends no score (it used to score the pick a loss and blank the ratings);
//   3. a page load that only adds the Pinnacle fields to an in-play bet saves once, not on every load (applyAnalystFix);
//   4. a void card clears when ESPN lists the game again (keepCard no longer copies an old void over an explicit clear).
import { withFixes, keepSaved, keepCard, applyAnalystFix } from '../src/fixes.js';
import { listAnalyst } from '../src/analyst.js';
import { nhlStep } from '../src/nhl.js';
import { sweepStep, sweepStatus, SWEEP_LAST } from '../src/sweepdata.js';

let fails = 0;
const ok = (name, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${cond ? '' : extra}`); };
const store = () => {
  const kv = new Map(), puts = [];
  const HUB = { get: async (k, t) => { const x = kv.get(k); return x == null ? null : (t === 'json' || (t && t.type === 'json')) ? JSON.parse(x) : x; },
    getWithMetadata: async (k, t) => { const x = kv.get(k); return { value: x == null ? null : t === 'json' ? JSON.parse(x) : x, metadata: null }; },
    put: async (k, v) => { puts.push(k); kv.set(k, v); }, delete: async k => { kv.delete(k); },
    list: async ({ prefix = '' } = {}) => ({ keys: [...kv.keys()].filter(k => k.startsWith(prefix)).sort().map(name => ({ name })), list_complete: true }) };
  return { kv, puts, HUB };
};

// ---- 2. hockey: a final with no score is not graded ---------------------------------------------------------------------------------
{
  const { kv, HUB } = store(), env = { HUB };
  const nd = '2026-11-20', nkey = `nhl:day:${nd}`;
  kv.set(nkey, JSON.stringify({ date: nd, cards: [{ id: '9101', kickoff: '2026-11-21T00:00:00Z', home: 'Edmonton Oilers', away: 'Detroit Red Wings', hAbbr: 'EDM', aAbbr: 'DET', final: null, v2: { w: 55, o: 50 }, v4: { w: 55, o: 50 } }] }));
  const ev = scores => ({ id: '9101', date: '2026-11-21T00:00:00Z', competitions: [{ status: { type: { completed: true, name: 'STATUS_FINAL', shortDetail: 'Final' } },
    competitors: [{ homeAway: 'home', team: { abbreviation: 'EDM', displayName: 'Edmonton Oilers' }, ...(scores ? { score: scores[0] } : {}) }, { homeAway: 'away', team: { abbreviation: 'DET', displayName: 'Detroit Red Wings' }, ...(scores ? { score: scores[1] } : {}) }] }] });
  let scores = null;
  const fetchH = async u => String(u).includes('dates=') ? new Response(JSON.stringify({ events: String(u).includes('dates=20261120') ? [ev(scores)] : [] })) : new Response('{}', { status: 404 });
  const at = new Date('2026-11-21T12:00:00Z');
  for (const s of [null, ['', '']]) {
    scores = s;
    const r = await nhlStep(env, at, fetchH, { mode: 'results' });
    const c = JSON.parse(kv.get(nkey)).cards[0], S = JSON.parse(kv.get('nhl:state') || '{}');
    const label = s ? 'empty scores' : 'no scores';
    ok(`hockey, ${label}: the card is not graded`, !c.final && !c.lean?.hit && r.graded === 0, JSON.stringify({ final: c.final, r }));
    ok(`hockey, ${label}: the ratings are not touched`, !(S.applied || []).includes('9101') && !(S.teams && S.teams.EDM && S.teams.EDM.elo === null), JSON.stringify(S.teams && S.teams.EDM));
  }
  scores = ['3', '2'];
  const r = await nhlStep(env, at, fetchH, { mode: 'results' });
  const c = JSON.parse(kv.get(nkey)).cards[0], S = JSON.parse(kv.get('nhl:state') || '{}');
  ok('hockey: the same game is graded once the score arrives', c.final && c.final.h === 3 && c.final.a === 2 && r.graded === 1, JSON.stringify({ final: c.final, r }));
  ok('hockey: and its ratings are taught with real numbers', (S.applied || []).includes('9101') && Number.isFinite(S.teams?.EDM?.elo), JSON.stringify(S.teams && S.teams.EDM));
}

// ---- 3. Analyst: page loads during a game save the Pinnacle fields once -------------------------------------------------------------
{
  const { kv, puts, HUB } = store();
  const ko = '2026-11-19T15:00:00Z', now = new Date('2026-11-19T16:00:00Z');
  kv.set('analyst', JSON.stringify({ v: 1, items: [{ id: 'b1', rule: 'x', key: 'O', price: -110, dk: -110, kickoff: ko, date: '2026-11-19', league: 'eng.1', gid: 'g1', mins: 300, at: '2026-11-19T10:00:00Z' }] }));
  kv.set('day:2026-11-19', JSON.stringify({ date: '2026-11-19', cards: [{ id: 'g1', league: 'eng.1', kickoff: ko, v2: {}, odds: { h: 100, d: 200, a: 300, tl: 3, to: -105, tu: -115 } }] }));
  const writes = [];
  for (let i = 0; i < 3; i++) { puts.length = 0; await listAnalyst(withFixes({ HUB }, { button: true }), now); writes.push(puts.length); }
  ok('Analyst: the first page load during the game saves the Pinnacle note', writes[0] === 1, JSON.stringify(writes));
  ok('Analyst: later page loads save nothing', writes[1] === 0 && writes[2] === 0, JSON.stringify(writes));
  const merged = applyAnalystFix({ v: 1, items: [{ id: 'b1', key: 'O' }] }, { items: [{ at: 5, b: { id: 'b1', key: 'O', pinNo: 'line', res: undefined } }] });
  ok('applyAnalystFix: a missing Pinnacle field is carried over', merged.items[0].pinNo === 'line', JSON.stringify(merged.items[0]));
  const kept = applyAnalystFix({ v: 1, items: [{ id: 'b1', key: 'O', pinNo: 'read', res: 'W' }] }, { items: [{ at: 5, b: { id: 'b1', key: 'O', pinNo: 'line', close: -120 } }] });
  ok('applyAnalystFix: a field the record has is never replaced, and no close is added to a settled bet', kept.items[0].pinNo === 'read' && kept.items[0].close === undefined, JSON.stringify(kept.items[0]));
}

// ---- 4. a void card clears when ESPN lists the game again ---------------------------------------------------------------------------
{
  const saved = { cards: [{ league: 'eng.1', id: 'x', void: 'postponed', v2: {} }] };
  ok('void: a rebuilt card with no word on void keeps the stored void', keepSaved(saved, { cards: [{ league: 'eng.1', id: 'x', v2: {} }] }).cards[0].void === 'postponed');
  ok('void: an explicit clear (void: null) is kept', !keepSaved(saved, { cards: [{ league: 'eng.1', id: 'x', v2: {}, void: null }] }).cards[0].void);
  ok('void: keepCard (a button patch) respects the clear too', !keepCard({ id: 'x', void: 'postponed' }, { id: 'x', void: null }).void);
  ok('void: a graded card never takes a void back', !keepCard({ id: 'x', void: 'postponed' }, { id: 'x', final: { h: 1, a: 0 } }).void);
}

// ---- 1. the stats-file step keeps its last answer and health shows it ---------------------------------------------------------------
{
  const due = new Date('2026-11-19T06:10:00Z'); // 12:15 AM Central: soccer.json is due
  const { kv, puts, HUB } = store();
  const s0 = await sweepStatus({ HUB });
  ok('stats files: health says when the token is missing', s0.token === false && s0.repo === null, JSON.stringify(s0));
  const env = { HUB, SWEEP_GH_TOKEN: 't', SWEEP_REPO: 'o/r' };
  const f403 = async () => new Response('{}', { status: 403 });
  const deps = { soccerTotals: async () => ({}), nhlTotals: async () => ({}), soccerDays: async () => ({}), nhlDays: async () => ({}), health: async () => ({}) };
  const r = await sweepStep(env, deps, due, f403);
  ok('stats files: a refused read is answered with its status', r && r.status === 403 && r.saved === false, JSON.stringify(r));
  const s1 = await sweepStatus(env);
  ok('stats files: health shows the token is set and the last answer for that file', s1.token === true && s1.repo === 'o/r' && s1.last?.soccer?.status === 403, JSON.stringify(s1));
  puts.length = 0; await sweepStep(env, deps, due, f403);
  ok('stats files: the same answer again costs no write', !puts.includes(SWEEP_LAST), JSON.stringify(puts));
  const fOk = async (u, o) => (o && o.method === 'PUT') ? new Response('{}', { status: 201 }) : new Response('{}', { status: 404 });
  const r2 = await sweepStep(env, deps, new Date('2026-11-19T06:12:00Z'), fOk);
  const s2 = await sweepStatus(env);
  ok('stats files: a save is recorded', r2 && r2.saved === true && s2.last?.soccer?.saved === true, JSON.stringify({ r2, s2 }));
  ok('stats files: nothing due, nothing recorded', (await sweepStep(env, deps, new Date('2026-11-19T18:00:00Z'), fOk)) === null);
}

console.log(fails ? `\n${fails} sweep-fix checks FAILED` : '\nAll sweep-fix checks passed');
if (fails) process.exit(1);
