// NHL section: model sanity, finished games teaching the ratings, cards, Forebet hockey reader, grading, Results board.
import { readFileSync } from 'node:fs';
import { fbOu, freshState, predict, applyGame, nhlStep, nhlTally, parseForebetHockey, fbFor, probs } from '../src/nhl.js';

const kv = new Map(), writes = [];
const env = { HUB: {
  get: async (k, t) => { const v = kv.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; },
  put: async (k, v) => { kv.set(k, v); writes.push(k); },
  list: async ({ prefix }) => ({ keys: [...kv.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }) } };
let fail = 0;
const ok = (n, c, x = '') => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (c ? '' : ' ' + x)); if (!c) fail++; };

// model
const S = freshState();
ok('32 teams are seeded', Object.keys(S.teams).length === 32);
const p = predict(S, 'COL', 'CHI');
ok('strong home team is favoured', p.v2.w > 55 && p.v4.w > 55, JSON.stringify(p));
const q = predict(S, 'CHI', 'COL');
ok('home and away swap moves the pick', q.v2.w < 50);
ok('unknown team gives no prediction', predict(S, 'XXX', 'COL') === null);
ok('Over chance is a sane number', p.v2.o > 35 && p.v2.o < 75);
ok('equal teams: winner chance close to 50', Math.abs(probs(3, 3).home - 0.5) < 0.001);
const T = JSON.parse(JSON.stringify(S));
const before = T.teams.CHI.elo;
applyGame(T, 'CHI', 'COL', 4, 1, 'REG');
ok('a win lifts Elo and counts the game', T.teams.CHI.elo > before && T.teams.CHI.n === S.teams.CHI.n + 1);
const U = JSON.parse(JSON.stringify(S)); applyGame(U, 'CHI', 'COL', 3, 2, 'SO');
ok('shootout goal is left out of totals', U.teams.CHI.gf === S.teams.CHI.gf + 2 && U.teams.COL.gf === S.teams.COL.gf + 2);

// ESPN feed (mock): one finished game last night, one upcoming tonight, one tomorrow
const iso = h => new Date(Date.now() + h * 3600000).toISOString();
const dayStr = h => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(Date.now() + h * 3600000));
const ev = (id, h, hn, ha, an, aa, done, hs, as, det) => ({ id, date: iso(h), competitions: [{ status: { type: { completed: done, shortDetail: det || (done ? 'Final' : '7:00 PM') } }, competitors: [{ homeAway: 'home', score: String(hs ?? 0), team: { displayName: hn, abbreviation: ha } }, { homeAway: 'away', score: String(as ?? 0), team: { displayName: an, abbreviation: aa } }] }] });
const feed = {};
const today = dayStr(0);
feed[today.replace(/-/g, '')] = [ev('9001', 5, 'Vegas Golden Knights', 'VGK', 'Calgary Flames', 'CGY', false), ev('9000', -30, 'Boston Bruins', 'BOS', 'Ottawa Senators', 'OTT', true, 3, 4, 'Final/OT')];
let calls = 0;
const fetchFn = async url => {
  calls++;
    const d = /dates=(\d{8})/.exec(url)[1];
  return { ok: true, json: async () => ({ events: (feed[d] || []).filter(e => dayStr(0).replace(/-/g, '') === d || true) }) };
};
const FB2 = readFileSync(new URL('./fixtures/forebet-nhl.html', import.meta.url), 'utf8');
const rows = parseForebetHockey(FB2);
ok('Forebet hockey row read: both names, two-way pick and average goals', rows.length === 4 && rows[0].home === 'Anaheim Ducks' && rows[0].p.join('/') === '48/52' && rows[0].pred === '2' && rows[0].score.h === 3 && rows[0].score.a === 8 && rows[0].date === '2026-10-16', JSON.stringify(rows));
const card = { home: 'Vegas Golden Knights', away: 'Calgary Flames' };
const f = fbFor(card, rows);
ok('Forebet record: home pick, its win chance and predicted score', f.pick === 'H' && f.p[0] === 70 && f.score && f.score.h > 0);
ok('swapped home and away flips the pick', fbFor({ home: 'Calgary Flames', away: 'Vegas Golden Knights' }, rows).pick === 'A' && fbFor({ home: 'Calgary Flames', away: 'Vegas Golden Knights' }, rows).score.a === f.score.h);
ok('no Over/Under is kept from Forebet', !('over' in f) && !('avg' in f));

const UQ = readFileSync(new URL('./fixtures/forebet-nhl-unquoted.html', import.meta.url), 'utf8');
const rq = parseForebetHockey(UQ);
ok('a page served without attribute quotes reads the same games', rq.length === 4 && rq[0].p.join('/') === '48/52' && rq[0].score.a === 8 && rq[3].home === 'Edmonton Oilers', JSON.stringify(rq[0]));
const fetchFn2 = async (url, o) => url.includes('forebet') ? { ok: true, text: async () => FB2 } : fetchFn(url, o);
// the finished BOS game is not in the seed's card list and is dated after the seed, so it teaches the ratings
const r1 = await nhlStep(env, new Date(), fetchFn2);
ok('step made a card for tonight\'s game', r1.created === 1, JSON.stringify(r1));
const dayKey = `nhl:day:${today}`;
const d1 = JSON.parse(kv.get(dayKey));
ok('card has v2, v4 and a stored time', d1.cards[0].v2 && d1.cards[0].v4 && d1.cards[0].ko);
ok('Forebet filled onto the card in the same run', d1.cards[0].fb && d1.cards[0].fb.pick === 'H', JSON.stringify(r1.forebet));
ok('soccer keys are never touched', [...kv.keys()].every(k => k.startsWith('nhl:')));
// Depending on the time of day the ratings can move once more after tonight's card is made (the card is then
// refreshed on the next run), so let one run settle and check the run after it.
const r2 = await nhlStep(env, new Date(), fetchFn2);
ok('the settling run creates and grades nothing', r2.created === 0 && r2.graded === 0, JSON.stringify(r2));
const w1 = writes.length;
const rq3 = await nhlStep(env, new Date(), fetchFn2);
ok('a run with nothing new writes nothing', writes.length === w1 && rq3.created === 0 && rq3.graded === 0 && rq3.refreshed === 0, JSON.stringify(rq3));

// game finishes
feed[today.replace(/-/g, '')] = [ev('9001', 5, 'Vegas Golden Knights', 'VGK', 'Calgary Flames', 'CGY', true, 3, 2, 'Final/OT')];
const clock = new Date(Date.now() + 8 * 3600000);
const fetchLater = async (url, o) => url.includes('forebet') ? { ok: true, text: async () => FB2 } : fetchFn(url, o);
const r3 = await nhlStep(env, clock, fetchLater);
const d3 = JSON.parse(kv.get(dayKey)); const c3 = d3.cards.find(c => c.id === '9001');
ok('finished game graded with total, OT flag and all three models', r3.graded === 1 && c3.final.total === 5 && c3.final.last === 'OT' && c3.grade.v2 && c3.grade.v4 && c3.grade.fb, JSON.stringify(c3.final));
ok('Forebet graded on the winner and on Over/Under from its predicted score', c3.grade.fb.win === 1 && c3.grade.fb.ou === (((c3.fb.score.a + c3.fb.score.h) > 5.5) === (c3.final.total > 5.5) ? 1 : 0), JSON.stringify(c3.grade.fb));
ok('v2 over/under is graded at 5.5', c3.grade.v2.ou === ((c3.v2.o >= 50) === false ? 1 : 0));
const st = JSON.parse(kv.get('nhl:state'));
ok('ratings state saved with the game applied once', st.applied.includes('9001') && st.teams.VGK.n === freshState().teams.VGK.n + 1);
const r4 = await nhlStep(env, clock, fetchLater);
ok('re-running does not grade or count the game twice', r4.graded === 0 && JSON.parse(kv.get('nhl:state')).teams.VGK.n === st.teams.VGK.n);

const t = await nhlTally(env);
ok('results board counts the graded game for each model', t.graded === 1 && t.all.win.v2.n === 1 && t.all.win.fb.n === 1 && t.same.win.v4.n === 1 && t.recent.length === 1);
ok('Forebet O/U: predicted 4-3 (7) vs final 2-0 is a miss', fbOu({ score: { a: 3, h: 4 } }, { total: 2 }) === 0);
ok('Forebet O/U: predicted 4-3 (7) vs final 5-4 is a hit', fbOu({ score: { a: 3, h: 4 } }, { total: 9 }) === 1);
ok('Forebet O/U: predicted 3-2 (5) vs final 2-1 is a hit (both Under)', fbOu({ score: { a: 2, h: 3 } }, { total: 3 }) === 1);
ok('Forebet O/U: predicted 3-3 (6) is Over', fbOu({ score: { a: 3, h: 3 } }, { total: 7 }) === 1);
ok('Forebet O/U: no predicted score means no grade', fbOu({ pick: 'H' }, { total: 7 }) === null);
ok('results board counts Forebet Over/Under', t.all.ou.fb.n === 1 && t.same.ou.fb.n === 1, JSON.stringify(t.all.ou.fb));
{ // a game graded before Forebet O/U existed is filled in when the board is built, with nothing rewritten
  const k = [...kv.keys()].find(x => x.startsWith('nhl:day:')), d = JSON.parse(kv.get(k));
  for (const c of d.cards) if (c.grade && c.grade.fb) delete c.grade.fb.ou;
  kv.set(k, JSON.stringify(d));
  const t2 = await nhlTally(env);
  ok('older graded games are counted for Forebet Over/Under too', t2.all.ou.fb.n === 1 && t2.recent[0].grade.fb.ou != null, JSON.stringify(t2.all.ou.fb));
}
console.log(fail ? `\n${fail} NHL checks FAILED` : '\nAll NHL checks passed');
process.exit(fail ? 1 : 0);
