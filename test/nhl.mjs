// NHL section: model sanity, finished games teaching the ratings, cards, Forebet hockey reader, grading, Results board.
import { readFileSync } from 'node:fs';
import { fbOu, freshState, predict, applyGame, nhlStep, nhlTally, parseForebetHockey, fbFor, probs, TIE, OT_GOAL } from '../src/nhl.js';

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
ok('calibration bands count each graded winner pick once per model', t.cal && t.cal.v2.reduce((x, b) => x + b.n, 0) === 1 && t.cal.v4.reduce((x, b) => x + b.n, 0) === 1 && t.cal.v2.every(b => b.n === 0 || typeof b.avg === 'number'), JSON.stringify(t.cal && t.cal.v2));
ok('a game with no sportsbook line is left out of every Over/Under count', t.all.ou.fb.n === 0 && t.all.ou.v2.n === 0 && t.same.ou.v4.n === 0 && t.lined === 0, JSON.stringify(t.all.ou));
ok('the always-pick-home baseline counts every graded game', t.all.home.n === 1 && t.same.home.n === 1 && (t.all.home.hit === 0 || t.all.home.hit === 1));
{ // a game graded before Forebet O/U existed is filled in when the board is built, with nothing rewritten
  const k = [...kv.keys()].find(x => x.startsWith('nhl:day:')), d = JSON.parse(kv.get(k));
  for (const c of d.cards) if (c.grade && c.grade.fb) { delete c.grade.fb.ou; c.ln = { v: 5.5, src: 'DraftKings' }; c.grade.line = 5.5; } // now a game with a real line
  kv.set(k, JSON.stringify(d));
  const t2 = await nhlTally(env);
  ok('older graded games are counted for Forebet Over/Under too', t2.all.ou.fb.n === 1 && t2.recent[0].grade.fb.ou != null, JSON.stringify(t2.all.ou.fb));
}

// ---- sportsbook Over/Under line: the total is only the line Over/Under is rated and graded against ----
import { nhlSetLine, gradeCard } from '../src/nhl.js';
{
  const hi = probs(3.4, 3.2, 6.5), lo = probs(3.4, 3.2, 5.5), w = probs(3.4, 3.2, 6);
  ok('a higher line lowers the Over chance', hi.over < lo.over && Math.abs(lo.over - probs(3.4, 3.2).over) < 1e-12, `${hi.over} ${lo.over}`);
  ok('a half-goal line cannot push, a whole-goal line can', hi.push === 0 && w.push > 0.1 && Math.abs(w.over + w.push + w.under - 1) < 1e-9);
  ok('the line never changes the winner chance or the goals the model expects', probs(3.4, 3.2, 6.5).home === probs(3.4, 3.2, 5.5).home);
  const S2 = freshState(), a = predict(S2, 'EDM', 'UTA'), b = predict(S2, 'EDM', 'UTA', 6.5);
  ok('v2 and v4 rate Over lower at 6.5 than at 5.5, expected goals and winner unchanged', b.v2.o < a.v2.o && b.v4.o < a.v4.o && b.v2.w === a.v2.w && b.v4.w === a.v4.w && b.lam.join() === a.lam.join(), JSON.stringify([a, b]));
  const c = { final: { h: 4, a: 2, total: 6, last: 'REG' }, v2: { w: 60, o: 60 }, v4: { w: 55, o: 40 }, fb: { pick: 'H', score: { h: 4, a: 3 } }, ln: { v: 6.5 } };
  gradeCard(c);
  ok('a total of 6 is Under at 6.5: Over picks miss, Under picks hit', c.grade.v2.ou === 0 && c.grade.v4.ou === 1 && c.grade.fb.ou === 0 && c.grade.line === 6.5, JSON.stringify(c.grade));
  const d = { final: { h: 4, a: 2, total: 6, last: 'REG' }, v2: { w: 60, o: 60 }, v4: { w: 55, o: 40 }, ln: { v: 6 } };
  gradeCard(d);
  ok('a total exactly on a whole-number line is a push and is not graded', d.grade.v2.ou === null && d.grade.v4.ou === null && d.grade.v2.win === 1);
  const e = { final: { h: 4, a: 2, total: 6, last: 'REG' }, v2: { w: 60, o: 60 } };
  gradeCard(e);
  ok('a game with no line is still graded at 5.5', e.grade.line === 5.5 && e.grade.v2.ou === 1);
}
{ // ESPN odds block: only the total is read; a line move refreshes the card; a typed line wins
  const odds = (ou, name = 'DraftKings') => [{ provider: { name }, details: 'EDM -150', overUnder: ou, spread: -1.5 }];
  const day2 = dayStr(24), key = day2.replace(/-/g, '');
  const e1 = ev('9100', 28, 'Edmonton Oilers', 'EDM', 'Utah Mammoth', 'UTA', false); e1.competitions[0].odds = odds(6.5);
  feed[key] = [e1];
  const fetchOdds = async (url, o) => url.includes('forebet') ? { ok: false, status: 403, text: async () => '' } : fetchFn(url, o);
  await nhlStep(env, new Date(), fetchOdds);
  let dd = JSON.parse(kv.get(`nhl:day:${day2}`)), c = dd.cards.find(x => x.id === '9100');
  ok('the card keeps the sportsbook total and its source', c && c.ln && c.ln.v === 6.5 && c.ln.src === 'DraftKings', JSON.stringify(c && c.ln));
  ok('the Over chance is rated at that line', c.v2.o < predict(freshState(), 'EDM', 'UTA').v2.o && !JSON.stringify(c).includes('-150') && !JSON.stringify(c).includes('spread'));
  e1.competitions[0].odds = odds(6);
  await nhlStep(env, new Date(), fetchOdds);
  dd = JSON.parse(kv.get(`nhl:day:${day2}`)); c = dd.cards.find(x => x.id === '9100');
  ok('when the book moves the total the card is re-rated', c.ln.v === 6 && c.v2.push > 0, JSON.stringify([c.ln, c.v2]));
  const r = await nhlSetLine(env, day2, '9100', 7);
  ok('a typed line is saved and re-rates the card', r.saved && r.ln.v === 7 && r.ln.how === 'manual' && r.v2.o < c.v2.o, JSON.stringify(r));
  e1.competitions[0].odds = odds(6.5);
  await nhlStep(env, new Date(), fetchOdds);
  dd = JSON.parse(kv.get(`nhl:day:${day2}`)); c = dd.cards.find(x => x.id === '9100');
  ok('a typed line is not overwritten by ESPN', c.ln.v === 7 && c.ln.how === 'manual');
  ok('a bad line is refused', (await nhlSetLine(env, day2, '9100', 6.3)).error && (await nhlSetLine(env, day2, '9100', 12)).error);
  const back = await nhlSetLine(env, day2, '9100', null);
  ok('clearing a typed line hands it back', back.saved && back.ln === null);
  const t3 = await nhlTally(env);
  ok('the board counts how many graded games had a real line', typeof t3.lined === 'number');
}

// ---- likeliest final score per model ----
import { topScore } from '../src/nhl.js';
{
  const e = topScore(3, 3), f = topScore(3.8, 2.3);
  ok('the likeliest score is never a tie (overtime decides it)', e.h !== e.a && f.h !== f.a, JSON.stringify([e, f]));
  ok('a strong favourite gets a winning score', f.h > f.a && f.p > 4 && f.p < 25, JSON.stringify(f));
  const S3 = freshState(), q = predict(S3, 'EDM', 'UTA');
  ok('v2 and v4 each carry a likeliest score', q.v2.sc && q.v4.sc && Number.isInteger(q.v2.sc.h) && q.v4.sc.p > 0, JSON.stringify(q));
  const c = { final: { h: 4, a: 3, total: 7, last: 'OT' }, v2: { w: 60, o: 60, sc: { h: 4, a: 3, p: 8 } }, v4: { w: 55, o: 55, sc: { h: 3, a: 2, p: 9 } } };
  gradeCard(c);
  ok('exact score is graded per model', c.grade.v2.sc === 1 && c.grade.v4.sc === 0);
}
// ---- Model bets: the locked headline pick of each graded card is counted ----
{
  const dk = 'nhl:day:2026-10-30';
  kv.set(dk, JSON.stringify({ date: '2026-10-30', cards: [
    { id: 'm1', kickoff: '2026-10-30T23:00:00Z', home: 'A', away: 'B', hAbbr: 'AAA', aAbbr: 'BBB', ln: { v: 5.5 }, v2: { w: 40, o: 40 }, v4: { w: 42, o: 44 }, fb: { pick: 'A', p: [43, 57], score: { h: 2, a: 3 } }, final: { h: 2, a: 4, last: 'REG', total: 6 } },
    { id: 'm2', kickoff: '2026-10-30T22:00:00Z', home: 'C', away: 'D', hAbbr: 'CCC', aAbbr: 'DDD', v2: { w: 60, o: 50 }, v4: { w: 58, o: 50 }, fb: { pick: 'H', p: [57, 43] }, final: { h: 1, a: 2, last: 'REG', total: 3 } }] }));
  const day = JSON.parse(kv.get(dk)); for (const c of day.cards) gradeCard(c); kv.set(dk, JSON.stringify(day));
  const tl = (await nhlTally(env)).leans;
  const mine = tl.recent.filter(r => r.date === '2026-10-30');
  ok('hockey Model bets: each graded card is counted once with its locked pick (one hit, one missed)', mine.length === 2 && mine.find(r => r.home === 'A').hit === true && mine.find(r => r.home === 'C').hit === false && tl.n === tl.recent.length && tl.hits === tl.recent.filter(r => r.hit).length, JSON.stringify(tl));
  ok('hockey Model bets: base rates come from the same games', tl.base.home <= tl.n && tl.base.overN <= tl.n && tl.base.over <= tl.base.overN, JSON.stringify(tl.base));
}
// Oct 26, 2026 adjustments: tied regulation scores boosted, the overtime goal counted in the total, frozen xG rates fading
{
  const pois = l => { const p = [Math.exp(-l)]; for (let k = 1; k < 16; k++) p.push(p[k - 1] * l / k); return p; };
  const plain = (lh, la, line) => { const ph = pois(lh), pa = pois(la); let o = 0, u = 0, t = 0; for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) { const x = ph[i] * pa[j]; if (i === j) t += x; if (i + j > line) o += x; else if (i + j < line) u += x; } return { o, u, t }; };
  const q = probs(3.1, 2.9, 6.5), p0 = plain(3.1, 2.9, 6.5);
  ok('a 3-3 regulation tie can end 4-3 in overtime, so Over 6.5 is likelier than plain Poisson says', q.over > p0.o + 0.02, `${q.over} vs ${p0.o}`);
  ok('over, push and under still add up to 1', Math.abs(q.over + q.push + q.under - 1) < 1e-9);
  const ph = pois(3.1), pa = pois(2.9); let tie = 0, all = 0; for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) { const x = ph[i] * pa[j] * (i === j ? TIE : 1); all += x; if (i === j) tie += x; }
  ok(`tied regulation scores are boosted to about the NHL's rate of games past regulation (${(100 * tie / all).toFixed(1)}%)`, tie / all > 0.2 && tie / all < 0.26 && p0.t < 0.2);
  ok('equal teams are still 50/50 and a whole-number line can still push', Math.abs(probs(3, 3).home - 0.5) < 1e-9 && probs(3, 3, 6).push > 0 && OT_GOAL > 0 && OT_GOAL < 1);
  // give EDM a huge xG attack: v4 (which reads xG) then expects many more goals than v2 (which does not)
  const S4 = freshState(); S4.teams.EDM.xf *= 3;
  const S6 = JSON.parse(JSON.stringify(S4)); for (const t of ['EDM', 'UTA']) { const T = S6.teams[t], g = 3 * 40; T.n += 40; T.gf += g * T.gf / Math.max(1, T.n - 40) / 3; T.ga += g * T.ga / Math.max(1, T.n - 40) / 3; } // 40 more games at the same goal rates, no new xG
  const early = predict(S4, 'EDM', 'UTA'), late = predict(S6, 'EDM', 'UTA');
  ok('frozen xG rates fade once a team has played past them: the xG pull on v4 shrinks', early.v4.o - early.v2.o > 4 && late.v4.o - late.v2.o < (early.v4.o - early.v2.o) / 2, `early ${early.v4.o}-${early.v2.o}, late ${late.v4.o}-${late.v2.o}`);
  ok('at the seed date xG covers every game, so v4 starts unfaded', freshState().teams.EDM.nx === freshState().teams.EDM.n);
}

// ---- v5 shadow: rest and backup-goalie adjustments (comparison only) ----
import { ctxFor, isBackup, gkKey, gkResolve, withGk, adj5, B2B_OWN, B2B_OPP, BACKUP_OPP, B2B_LOGIT, BACKUP_LOGIT } from '../src/nhl.js';
{
  const S5 = freshState();
  const base = predict(S5, 'EDM', 'UTA'), none = predict(S5, 'EDM', 'UTA', 5.5, { b2b: [null, null], bk: [null, null] });
  ok('v5: with no ctx there is no v5 and v2 / v4 are untouched by asking for it', !base.v5 && JSON.stringify(base.v2) === JSON.stringify(none.v2) && JSON.stringify(base.v4) === JSON.stringify(none.v4) && JSON.stringify(base.lam) === JSON.stringify(none.lam));
  ok('v5: nothing known means v5 equals v4', none.v5.w === none.v4.w && none.v5.o === none.v4.o && none.v5.sc.h === none.v4.sc.h && none.v5.in.b2b.join() === ',' && none.v5.in.bk.join() === ',');
  const aB = predict(S5, 'EDM', 'UTA', 5.5, { b2b: [false, true], bk: [null, null] }).v5, hB = predict(S5, 'EDM', 'UTA', 5.5, { b2b: [true, false], bk: [null, null] }).v5;
  ok('v5: the visitor on a back-to-back lifts the home win chance by a few points, the home team on one lowers it', aB.w - none.v4.w >= 4 && aB.w - none.v4.w <= 8 && none.v4.w - hB.w >= 4 && none.v4.w - hB.w <= 8, `${none.v4.w} ${aB.w} ${hB.w}`);
  const bA = predict(S5, 'EDM', 'UTA', 5.5, { b2b: [null, null], bk: [false, true] }).v5, bH = predict(S5, 'EDM', 'UTA', 5.5, { b2b: [null, null], bk: [true, false] }).v5;
  ok('v5: a backup in the visitor net helps the home side, one in the home net hurts it, and either lifts the Over', bA.w - none.v4.w >= 2 && bA.w - none.v4.w <= 4 && none.v4.w - bH.w >= 2 && none.v4.w - bH.w <= 4 && bA.o > none.v4.o && bH.o > none.v4.o, `${none.v4.w} ${bA.w} ${bH.w} ${none.v4.o} ${bA.o} ${bH.o}`);
  ok('v5: the goal adjustments are the measured ones', adj5({ b2b: [true, false], bk: [false, false] }).h === -B2B_OWN && adj5({ b2b: [true, false], bk: [false, false] }).a === B2B_OPP && adj5({ b2b: [false, false], bk: [false, true] }).h === BACKUP_OPP && adj5({ b2b: [false, false], bk: [true, false] }).a === BACKUP_OPP && adj5({ b2b: [false, true], bk: [false, false] }).L === B2B_LOGIT && adj5({ b2b: [false, false], bk: [true, false] }).L === -BACKUP_LOGIT && adj5({ b2b: [true, true], bk: [false, false] }).L === 0);
  // backup detection
  const G = { gk: { AAA: { starter: 10, backup: 3 }, TIE: { one: 6, two: 6 }, NEW: { x: 2, y: 1 } } };
  ok('backup: the usual starter is not one, a goalie with fewer starts is, a goalie never seen is', isBackup(G, 'AAA', 'Starter') === false && isBackup(G, 'AAA', 'Backup') === true && isBackup(G, 'AAA', 'Callup Guy') === true);
  ok('backup: tied top goalies are not backups; too few team games, no name, or no counts means unknown', isBackup(G, 'TIE', 'One') === false && isBackup(G, 'TIE', 'Two') === false && isBackup(G, 'NEW', 'X') === null && isBackup(G, 'AAA', '') === null && isBackup(freshState(), 'AAA', 'Starter') === null);
  ok('goalie names match across accents and punctuation', gkKey('Ukko-Pekka Luukkonen') === gkKey('UkkoPekka Luukkonen') && gkKey('Jesper Wallstedt') === 'jesperwallstedt' && gkKey('Joonás Korpisalo') === gkKey('Joonas Korpisalo'));
  const V = { gk: { VAN: { leevimerilinen: 7, kevinlankinen: 6 }, OTT: { linusullmark: 8, samuelersson: 3, jonasjohansson: 1 } } };
  ok('backup: a name spelled a little differently by ESPN is still that goalie (Merilainen vs Merilinen: the starter, not a backup)', isBackup(V, 'VAN', 'Leevi Merilainen') === false && gkResolve(V.gk.VAN, gkKey('Leevi Merilainen')) === 'leevimerilinen');
  ok('backup: different goalies are not merged, and a short or new name stays itself', isBackup(V, 'OTT', 'Samuel Ersson') === true && gkResolve(V.gk.OTT, gkKey('Jonas Johansen')) === 'jonasjohansson' && gkResolve(V.gk.OTT, gkKey('Linus Ullmark')) === 'linusullmark' && gkResolve(V.gk.OTT, 'abc') === 'abc' && gkResolve(V.gk.OTT, gkKey('Anton Forsberg')) === 'antonforsberg');
  const W = freshState(); ok('a state saved before v5 gets the goalie start counts once', withGk(W) === true && withGk(W) === false && Object.keys(W.gk).length === 32 && /^\d{4}-\d{2}-\d{2}$/.test(W.gkThrough));
  const cx = ctxFor(G, 'AAA', 'BBB', { h: { n: 'Backup', st: 'e' }, a: null }, { h: 1, a: 3 });
  ok('ctx: rest 1 is a back-to-back, 2 or more is not, a missing goalie is unknown', cx.b2b[0] === true && cx.b2b[1] === false && cx.bk[0] === true && cx.bk[1] === null && ctxFor(G, 'AAA', 'BBB', null, null).b2b.join() === ',');
}
{
  // end to end on an isolated store: rest from yesterday's board, goalies from ESPN's probables, v5 on the card, goalie starts counted at the final
  const kv2 = new Map(), env2 = { HUB: { get: async (k, t) => { const v = kv2.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => { kv2.set(k, v); }, list: async ({ prefix }) => ({ keys: [...kv2.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }) } };
  const st0 = freshState(); withGk(st0); st0.gkThrough = '2000-01-01'; kv2.set('nhl:state', JSON.stringify(st0));
  const gkp = (name, st) => [{ name: 'probableStartingGoalie', displayName: 'Probable Starting Goalie', abbreviation: 'SG', athlete: { displayName: name }, status: { type: st } }];
  const evG = (id, h, hn, ha, an, aa, done, hs, as, hg, ag) => ({ id, date: iso(h), competitions: [{ status: { type: { completed: done, shortDetail: done ? 'Final' : '7:00 PM' } }, competitors: [{ homeAway: 'home', score: String(hs ?? 0), team: { displayName: hn, abbreviation: ha }, probables: hg || [] }, { homeAway: 'away', score: String(as ?? 0), team: { displayName: an, abbreviation: aa }, probables: ag || [] }] }] });
  const f2 = {}, T0 = dayStr(0), Y0 = dayStr(-24);
  const fx = async url => { const d = /dates=(\d{8})/.exec(url)[1]; return { ok: true, json: async () => ({ events: f2[d] || [] }) }; };
  f2[Y0.replace(/-/g, '')] = [evG('8000', -24, 'Seattle Kraken', 'SEA', 'Vegas Golden Knights', 'VGK', true, 2, 3)];
  f2[T0.replace(/-/g, '')] = [evG('8001', 5, 'Vegas Golden Knights', 'VGK', 'Calgary Flames', 'CGY', false, 0, 0, gkp('Adin Hill', 'confirmed'), gkp('Dustin Wolf', 'expected'))];
  const GKS = (await import('../src/nhlgk.js')).default.counts.CGY;
  const wolfBackup = (GKS.dustinwolf || 0) < Math.max(...Object.values(GKS)) && Object.values(GKS).reduce((a, b) => a + b, 0) >= 6;
  await nhlStep(env2, new Date(), fx);
  const d1 = JSON.parse(kv2.get('nhl:day:' + T0)), c1 = d1.cards.find(c => c.id === '8001');
  ok('v5 card: goalies, rest and v5 are saved on the card', c1 && c1.gk.h.n === 'Adin Hill' && c1.gk.h.st === 'c' && c1.gk.a.st === 'e' && c1.rs.h === 1 && c1.v5 && c1.v5.in.b2b[0] === 1, JSON.stringify(c1));
  ok('v5 card: a visitor goalie with fewer starts than his team leader is flagged as the backup', !wolfBackup || c1.v5.in.bk[1] === 1, JSON.stringify(c1.v5.in));
  ok('v5 card: v2 and v4 are what they were without goalies or rest', JSON.stringify({ v2: c1.v2, v4: c1.v4 }) === JSON.stringify({ v2: predict(JSON.parse(kv2.get('nhl:state')), 'VGK', 'CGY').v2, v4: predict(JSON.parse(kv2.get('nhl:state')), 'VGK', 'CGY').v4 }));
  // the visitor's goalie changes before puck drop: v5 is re-made, v4 is not
  f2[T0.replace(/-/g, '')] = [evG('8001', 5, 'Vegas Golden Knights', 'VGK', 'Calgary Flames', 'CGY', false, 0, 0, gkp('Adin Hill', 'confirmed'), gkp('Devin Cooley', 'confirmed'))];
  await nhlStep(env2, new Date(), fx);
  const c2 = JSON.parse(kv2.get('nhl:day:' + T0)).cards.find(c => c.id === '8001');
  ok('v5 card: a goalie change before puck drop updates the goalie and re-makes v5 only', c2.gk.a.n === 'Devin Cooley' && c2.gk.a.st === 'c' && JSON.stringify(c2.v4) === JSON.stringify(c1.v4) && (!wolfBackup || c2.v5.w !== c1.v5.w), JSON.stringify([c1.v5, c2.v5]));
  // finished: graded for v5, and the two starters are counted
  const before = JSON.parse(kv2.get('nhl:state')).gk;
  f2[T0.replace(/-/g, '')] = [evG('8001', 5, 'Vegas Golden Knights', 'VGK', 'Calgary Flames', 'CGY', true, 4, 2)];
  await nhlStep(env2, new Date(), fx);
  const c3 = JSON.parse(kv2.get('nhl:day:' + T0)).cards.find(c => c.id === '8001'), after = JSON.parse(kv2.get('nhl:state')).gk;
  ok('v5 card: graded like v2 and v4, and keeps its goalies', c3.final && c3.grade.v5 && c3.grade.v5.win === 1 && c3.grade.v5.brier >= 0 && c3.gk.h.n === 'Adin Hill');
  ok('goalie starts: both starters are counted once when the game finishes', (after.VGK.adinhill || 0) === (before.VGK.adinhill || 0) + 1 && (after.CGY.devincooley || 0) === (before.CGY.devincooley || 0) + 1);
  await nhlStep(env2, new Date(), fx);
  ok('goalie starts: a second pass over the finished game counts nothing again', (JSON.parse(kv2.get('nhl:state')).gk.VGK.adinhill || 0) === (after.VGK.adinhill || 0));
  const tv = (await nhlTally(env2)).v5;
  ok('Results: the v5 block counts the graded game with each model on the same game and splits by situation', tv && tv.n === 1 && tv.win.v5.n === 1 && tv.win.v4.n === 1 && tv.win.home.hit === 1 && tv.sit.adj.n === 1 && tv.sit.plain.n === 0, JSON.stringify(tv));
  ok('Results: with no v5 cards graded there is no v5 block', (await nhlTally({ HUB: { list: async () => ({ keys: [] }), get: async () => null } })).v5 === null);
}

console.log(fail ? `\n${fail} NHL checks FAILED` : '\nAll NHL checks passed');
process.exit(fail ? 1 : 0);
