import { v2, grade, pickOutcome, bestBet } from './model.js';
import { supports as v4Supports, resolve as v4Resolve, predict as v4Predict, getRatings, refreshRatings, cupForecast } from './v4.js';
import {
  TZ, LEAGUES, VISIBLE, DOMESTIC, CUP_MODEL, leagueBySlug, localDate, localTime, syncLeague,
  findTeam, getContext, missingContexts, fixturesForLeague, shotsCoverage,
} from './data.js';
import { parseForebet, mergeSeed, fbGrade } from './forebet.js';
import { forebetStep, forebetFetch, FB_PAGES, matchRows, is as isName } from './forebetpage.js';
import legacy from './legacy.js';
import legacySm from './legacy_sm.js';
import { getUnm, saveUnm, likeness, slugTitle } from './verify.js';
import { nhlStep, nhlTally, nhlStatus } from './nhl.js';
import { getListing, matchLink, fetchText, parseWeSay, smGrade } from './sportsmole.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

const HOUR = 3600000;
const WRITE_LIMIT = 1000; // Cloudflare free plan: KV writes per UTC day

// Counts this request's KV writes so the Status tab can show how close the day is to the limit.
// The count is saved with ONE extra write at the end, and only when something was written.
function counted(env) {
  const base = env.HUB; let n = 0;
  const hub = Object.create(base);
  hub.get = (...a) => base.get(...a);
  hub.list = (...a) => base.list(...a);
  hub.put = (...a) => { n++; return base.put(...a); };
  return { env: { ...env, HUB: hub }, flush: async () => {
    if (!n) return;
    const d = new Date().toISOString().slice(0, 10);
    const c = (await base.get('meta:writes', 'json').catch(() => null)) || {};
    await base.put('meta:writes', JSON.stringify({ d, n: (c.d === d ? c.n : 0) + n + 1 })).catch(() => {});
  } };
}

// Last problem per league (shown on the Status tab). Written only when it changes, to save writes.
async function noteLeague(env, slug, kind, msg) {
  const e = (await env.HUB.get('meta:errors', 'json')) || {};
  const had = e[slug];
  if (!msg) { if (!had || had.kind !== kind) return; delete e[slug]; }
  else { if (had && had.msg === msg && had.kind === kind) return; e[slug] = { kind, msg: String(msg).slice(0, 160), at: new Date().toISOString() }; }
  await env.HUB.put('meta:errors', JSON.stringify(e));
}
const syncNote = async (env, league, r) => { try { await noteLeague(env, league.slug, 'sync', r && r.error); } catch (e) { /* best effort */ } };
// Everything up to and including this date is already in the imported Hub history (legacy.js).
const LEGACY_THROUGH = '2026-10-13';
// Form as of kickoff: the last 5 league games played BEFORE this match (never the match itself).
export function formAt(team, iso) {
  const t = new Date(iso).getTime();
  const g = (team.recent || []).filter(x => new Date(x[0]).getTime() < t).slice(-5);
  if (!g.length) return team.form;
  return { gf: g.reduce((s, x) => s + x[1], 0), ga: g.reduce((s, x) => s + x[2], 0), n: g.length };
}
const today = () => localDate(new Date().toISOString());
const addDays = (date, n) => new Date(new Date(`${date}T12:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
const round = x => Math.round(x * 100);
const num = (v, d) => (v == null || v === '' || Number.isNaN(+v) ? d : +v);

// Grading waits this long after a league's LAST kickoff of the day: assumed game length + delay.
// Defaults: 2h game + 3h delay. Change GAME_HOURS / GRADE_DELAY_HOURS in wrangler.toml [vars].
const gradeDelayMs = env => (num(env.GAME_HOURS, 2) + num(env.GRADE_DELAY_HOURS, 3)) * HOUR;

const slim = p => ({
  p: [round(p.home), round(p.draw), round(p.away)],
  pick: pickOutcome(p),
  over: round(p.over25), btts: round(p.bttsYes),
  scores: p.topScores.map(s => [s.score, round(s.p)]),
  lam: [+p.lambda.home.toFixed(2), +p.lambda.away.toFixed(2)],
  best: (b => ({ pick: b.pick, p: round(b.p) }))(bestBet(p)),
  drawRisk: !!p.drawRisk,
});
const toPred = s => ({ home: s.p[0] / 100, draw: s.p[1] / 100, away: s.p[2] / 100, over25: s.over / 100, bttsYes: s.btts / 100 });

// The password is ADMIN_TOKEN. It is accepted from the browser's login box (HTTP Basic, any username)
// or from the x-admin-token header. With no ADMIN_TOKEN set, nothing is let in.
function authed(req, env) {
  if (!env.ADMIN_TOKEN) return false;
  if ((req.headers.get('x-admin-token') || '') === env.ADMIN_TOKEN) return true;
  const h = req.headers.get('authorization') || '';
  if (h.startsWith('Basic ')) {
    try { const d = atob(h.slice(6)); return d.slice(d.indexOf(':') + 1) === env.ADMIN_TOKEN; } catch (e) { return false; }
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Analyze ONE league for ONE date: fixtures -> v2 (official) + v4 (shadow) cards.
// ---------------------------------------------------------------------------------------------
export async function analyzeLeague(date, slug, env, now = new Date(), { partial = false, leftover = false } = {}) {
  const league = leagueBySlug(slug);
  if (!league) return { error: `Unknown league ${slug}` };
  const debug = [], memo = new Map();
  const day = (await env.HUB.get(`day:${date}`, 'json')) || { date, cards: [], analyzed: {} };
  day.analyzed = day.analyzed || {};

  const fx = await fixturesForLeague(league, date, debug);
  if (!fx.length) {
    // A failed feed is not "no games": report it and don't mark the league analyzed.
    if (debug.length) return { fixtures: 0, cards: 0, skipped: 0, feedError: true, debug };
    day.cards = day.cards.filter(c => c.league !== slug || c.final);
    day.analyzed[slug] = now.getTime();
    await env.HUB.put(`day:${date}`, JSON.stringify(day));
    return { fixtures: 0, cards: 0, skipped: 0, debug };
  }

  // Contexts are built by the sync step; analyze only reads them.
  let needsSync = [];
  if (!league.cup) {
    if (!(await getContext(league, env, memo))) return { fixtures: fx.length, needsSync: [slug], debug };
  } else {
    needsSync = await missingContexts(env, memo);
  }

  const prior = new Map(day.cards.filter(c => c.league === slug).map(c => [c.id, c]));
  const cards = [];
  let notReady = 0;
  for (const f of fx) {
    const old = prior.get(f.id);
    if (old?.final && date > LEGACY_THROUGH) { cards.push(old); continue; } // never overwrite a graded card
    // 'Analyze leftover': keep finished predictions as they are. A card saved before v4 existed (no v4 key yet) still gets analyzed.
    if (leftover && old?.v2 && 'v4' in old && !(league.cupModel && old.v4 === null)) { cards.push(old); continue; }

    const hint = league.cup ? undefined : slug;
    const h0 = await findTeam(f.home.id, env, memo, hint);
    const a0 = await findTeam(f.away.id, env, memo, hint);
    const h = h0 && { ...h0, team: { ...h0.team, form: formAt(h0.team, f.date) } };
    const a = a0 && { ...a0, team: { ...a0.team, form: formAt(a0.team, f.date) } };
    const card = {
      id: f.id, kickoff: f.date, ko: localTime(f.date),
      league: slug, leagueKey: league.key, leagueName: league.name,
      home: f.home.name, away: f.away.name, final: null,
      hAbbr: f.home.abbr || null, aAbbr: f.away.abbr || null, hRank: h?.team.rank ?? null, aRank: a?.team.rank ?? null,
    };
    // v4 cup shadow (Champions League / Europa League): works from the cup model's own ratings, so it can
    // still predict a game v2 cannot (a club from a league the Hub does not keep).
    const r4cup = !f.done && league.cupModel ? await cupForecast(league, f, h0, a0, env, memo, debug) : null;
    if (!h || !a) {
      if (needsSync.length) notReady++;
      card.skipped = 'Club not found in any synced league yet (v2 needs its league results)';
      if (r4cup) card.v4 = slim(r4cup);
      cards.push(card); continue;
    }
    if (h.team.form.n < 3 || a.team.form.n < 3) {
      card.skipped = 'Not enough recent league results for one or both teams (v2 needs them)';
      if (r4cup) card.v4 = slim(r4cup);
      cards.push(card); continue;
    }
    const r2 = v2(h.team.form, a.team.form);
    card.v2 = slim(r2);
    // v4 shadow: only for league games that haven't been played yet, and only when both clubs have enough history.
    // (null = v4 has nothing to say: cup game, club not found, or too little history.)
    let r4 = null;
    if (!f.done && !league.cup && v4Supports(slug) && h.league.slug === slug && a.league.slug === slug) {
      const R = await getRatings(league, env, memo);
      const hn = v4Resolve(slug, f.home.name) || v4Resolve(slug, h.team.name), an = v4Resolve(slug, f.away.name) || v4Resolve(slug, a.team.name);
      r4 = hn && an ? v4Predict(R, hn, an) : null;
    }
    if (league.cupModel) r4 = r4cup;
    card.v4 = r4 ? slim(r4) : null;
    if (old?.sm) card.sm = old.sm;
    if (old?.note) card.note = old.note;
    if (old?.mine) card.mine = old.mine;
    if (f.done && date <= LEGACY_THROUGH) { // old day: show the real result against the pre-kickoff prediction
      card.final = { h: f.home.score, a: f.away.score };
      card.grade = { v2: grade(toPred(card.v2), card.final) };
      if (card.sm) card.smGrade = smGrade(card.sm, card.final);
    }
    card.crossLeague = h.league.slug !== a.league.slug;
    card.homeLeague = h.league.name; card.awayLeague = a.league.name;
    card.form = {
      home: `${h.team.form.gf} scored, ${h.team.form.ga} conceded in last ${h.team.form.n} league games`,
      away: `${a.team.form.gf} scored, ${a.team.form.ga} conceded in last ${a.team.form.n} league games`,
    };
    cards.push(card);
  }

  // Cup fixture with clubs we haven't synced yet: don't save a half-answer, ask the caller to sync first.
  // partial: some clubs' leagues won't load; save what we can (those clubs stay 'not found').
  if (notReady && !partial) return { fixtures: fx.length, needsSync, debug };

  // Forebet picks are recorded by hand (never read by a model). Keep them across re-analysis; add the saved ones.
  for (const c of cards) { if (!c.fb && prior.get(c.id)?.fb) c.fb = prior.get(c.id).fb; mergeSeed(c, date); }
  day.cards = day.cards.filter(c => c.league !== slug).concat(cards);
  day.analyzed[slug] = now.getTime();
  day.analyzedAt = now.getTime();
  await env.HUB.put(`day:${date}`, JSON.stringify(day));
  return { fixtures: fx.length, cards: cards.length, skipped: cards.filter(c => c.skipped).length, debug };
}

// ---------------------------------------------------------------------------------------------
// Grade ONE league for ONE date. Waits until (last kickoff + game length + delay) unless forced.
// ---------------------------------------------------------------------------------------------
export async function gradeLeague(date, slug, env, { force = false } = {}, now = new Date()) {
  const league = leagueBySlug(slug);
  const day = await env.HUB.get(`day:${date}`, 'json');
  const open = (day?.cards || []).filter(c => c.league === slug && !c.final && (c.v2 || c.v4));
  if (!league || !open.length) return { graded: 0, pending: 0 };

  if (!force) {
    const last = Math.max(...open.map(c => new Date(c.kickoff).getTime()));
    const dueAt = last + gradeDelayMs(env);
    if (now.getTime() < dueAt) return { graded: 0, pending: open.length, waiting: true, dueAt };
  }
  const fx = await fixturesForLeague(league, date, []);
  const finals = new Map(fx.filter(f => f.done).map(f => [f.id, f]));
  let graded = 0, pending = 0;
  for (const c of open) {
    const f = finals.get(c.id);
    if (!f) { pending++; continue; }
    c.final = { h: f.home.score, a: f.away.score };
    mergeSeed(c, date);
    c.grade = {};
    if (c.v2) c.grade.v2 = grade(toPred(c.v2), c.final);
    if (c.v3) c.grade.v3 = grade(toPred(c.v3), c.final); // cards predicted before v4 took over keep their v3 grade
    if (c.v4) c.grade.v4 = grade(toPred(c.v4), c.final);
    if (c.sm && c.v2) c.smGrade = smGrade(c.sm, c.final);
    graded++;
  }
  // Remember the attempt so a league whose games aren't final yet (postponed, feed lagging) can't
  // block the others: the cron rotates by least-recently-tried.
  // Saved only when something was graded: a league still waiting on ESPN used to cost a KV write on every
  // try. The cron now rotates through due leagues by the clock instead (see slot 1), so nothing is stored.
  if (graded) await env.HUB.put(`day:${date}`, JSON.stringify(day));
  return { graded, pending };
}


// ---------------------------------------------------------------------------------------------
// SportsMole "We say" for ONE league / ONE date. Best effort: a miss just leaves the card without it.
// ---------------------------------------------------------------------------------------------
export async function smLeague(date, slug, env, now = new Date(), { force = false } = {}) {
  const day = await env.HUB.get(`day:${date}`, 'json');
  day && (day.smTried = day.smTried || {});
  const todo = (day?.cards || []).filter(c => c.league === slug && c.v2 && !c.sm && (force || now.getTime() - (day.smTried[c.id] || 0) > 3 * HOUR));
  if (!todo.length) return { idle: true, found: 0 };
  let links;
  try { links = await getListing(env, now.getTime()); } catch (e) { return { error: `SportsMole list: ${e.message}`, found: 0 }; }
  let found = 0, missed = 0, fetched = 0;
  const errors = [], missedCards = [];
  for (const c of todo) {
    const link = matchLink(c.home, c.away, links);
    day.smTried[c.id] = now.getTime();
    if (!link) { missed++; missedCards.push(c); continue; }
    if (fetched >= 6) { delete day.smTried[c.id]; continue; } // keep each request small; the next run continues
    fetched++;
    try {
      const w = parseWeSay(await fetchText(link.url));
      if (!w) { missed++; missedCards.push(c); continue; }
      c.sm = { h: w.h, a: w.a, text: w.text, url: link.url };
      if (c.final) c.smGrade = smGrade(c.sm, c.final);
      found++;
    } catch (e) { errors.push(e.message); delete day.smTried[c.id]; }
  }
  // Cards with no SportsMole match: keep the closest previews on its list so you can verify one and assign it.
  const unm = await getUnm(env), before = JSON.stringify(unm), gone = new Set(missedCards.map(c => c.id));
  unm.items = unm.items.filter(i => !(i.src === 'sm' && (gone.has(i.cardId) || todo.some(c => c.id === i.cardId && c.sm))));
  for (const c of missedCards) {
    links.map(l => { const t = slugTitle(l.url); return t && { l, t, sc: likeness(c, t.home, t.away) }; }).filter(x => x && x.sc > 0).sort((a, b) => b.sc - a.sc).slice(0, 3)
      .forEach(({ l, t }) => unm.items.push({ src: 'sm', key: `sm|${c.id}|${l.id}`, cardId: c.id, date, slug, title: `${t.home} vs ${t.away}`, url: l.url }));
  }
  await saveUnm(env, unm, before, today());
  await env.HUB.put(`day:${date}`, JSON.stringify(day));
  return { found, missed, listed: links.length, ...(errors.length ? { errors } : {}) };
}

// ---------------------------------------------------------------------------------------------
// Totals = history imported from the old Hub + everything graded here since.
//  v2: official model, all graded matches.  h2h: v2 vs v4 on the SAME matches only (v4 started 2026-10-14).
//  h2hOld: the retired v3 shadow test (58 imported matches + any live games predicted before v4 took over).
// ---------------------------------------------------------------------------------------------
function blank() { return { n: 0, outcome: 0, ou: 0, btts: 0, brier: 0 }; }
function add(t, g) { t.n++; t.outcome += g.outcomeHit; t.ou += g.ouHit; t.btts += g.bttsHit; t.brier += g.brier; }
function fin(t) { return { ...t, brier: t.n ? +(t.brier / t.n).toFixed(3) : null }; }

async function tally(env) {
  const list = await env.HUB.list({ prefix: 'day:' });
  const v2All = blank(), v4All = blank(), h2hV2 = blank(), h2hV4 = blank(), oldV2 = blank(), oldV3 = blank();
  const live = [], mineT = { n: 0, mine: 0, model: 0 };
  const fbT = { n: 0, outcome: 0, score: 0, brier: 0, nOu: 0, ou: 0, nBtts: 0, btts: 0 }, mk = () => ({ n: 0, fbOutcome: 0, fbBrier: 0, outcome: 0, brier: 0, nOu: 0, fbOu: 0, ou: 0, nBtts: 0, fbBtts: 0, btts: 0 }), fbVs = { v2: mk(), v4: mk() };
  // Same-games table for the Results tab: a metric counts a game only when v2, v4 and Forebet all have it.
  const SB = { outcome: { n: 0, v2: 0, v4: 0, fb: 0 }, ou: { n: 0, v2: 0, v4: 0, fb: 0 }, btts: { n: 0, v2: 0, v4: 0, fb: 0 }, brier: { n: 0, v2: 0, v4: 0, fb: 0 } };
  const CAL = [['Under 40%', 0, 40], ['40 to 49%', 40, 50], ['50 to 59%', 50, 60], ['60% and up', 60, 101]].map(([label, lo, hi]) => ({ label, lo, hi, n: 0, hits: 0, sum: 0 }));
  const cal = (p, hit) => { const t = Math.max(...p), b = CAL.find(x => t >= x.lo && t < x.hi); if (!b) return; b.n++; b.hits += hit ? 1 : 0; b.sum += t; };
  for (const r of legacy.v2Rows) {
    if (r.p) cal(r.p, r.outcomeHit);
    v2All.n++; v2All.outcome += r.outcomeHit; v2All.ou += r.ouHit; v2All.btts += r.bttsHit; v2All.brier += r.brier ?? 0;
  }
  for (const r of legacy.shadow) {
    const [h, a] = r.final.split('–').map(Number);
    add(oldV2, grade(toPred(r.v2), { h, a }));
    add(oldV3, grade(toPred(r.v3), { h, a }));
  }
  for (const k of list.keys) {
    const day = await env.HUB.get(k.name, 'json');
    for (const c of day?.cards || []) {
      if (!c.grade || day.date <= LEGACY_THROUGH) continue;
      if (c.fb && c.final) { // Forebet (entered by hand) on the same games, next to v2 and v4
        const f = fbGrade(c.fb, c.final);
        if (f.outcomeHit != null) { fbT.n++; fbT.outcome += f.outcomeHit; fbT.score += f.scoreHit; fbT.brier += f.brier; }
        if (f.ouHit != null) { fbT.nOu++; fbT.ou += f.ouHit; }
        if (f.bttsHit != null) { fbT.nBtts++; fbT.btts += f.bttsHit; }
        if (c.grade.v2 && c.grade.v4) {
          const g2 = c.grade.v2, g4 = c.grade.v4;
          if (f.outcomeHit != null) { const o = SB.outcome, b = SB.brier; o.n++; o.v2 += g2.outcomeHit; o.v4 += g4.outcomeHit; o.fb += f.outcomeHit; b.n++; b.v2 += g2.brier; b.v4 += g4.brier; b.fb += f.brier; }
          if (f.ouHit != null) { const o = SB.ou; o.n++; o.v2 += g2.ouHit; o.v4 += g4.ouHit; o.fb += f.ouHit; }
          if (f.bttsHit != null) { const o = SB.btts; o.n++; o.v2 += g2.bttsHit; o.v4 += g4.bttsHit; o.fb += f.bttsHit; }
        }
        for (const [k, g] of [['v2', c.grade.v2], ['v4', c.grade.v4]]) if (g) {
          const x = fbVs[k];
          if (f.outcomeHit != null) { x.n++; x.fbOutcome += f.outcomeHit; x.fbBrier += f.brier; x.outcome += g.outcomeHit; x.brier += g.brier; }
          if (f.ouHit != null) { x.nOu++; x.fbOu += f.ouHit; x.ou += g.ouHit; }
          if (f.bttsHit != null) { x.nBtts++; x.fbBtts += f.bttsHit; x.btts += g.bttsHit; }
        }
      }
      if (c.grade.v4) add(v4All, c.grade.v4); // every game v4 predicted, including cup games v2 cannot cover
      if (!c.grade.v2) continue;
      add(v2All, c.grade.v2);
      if (c.grade.v4) { add(h2hV2, c.grade.v2); add(h2hV4, c.grade.v4); }
      if (c.grade.v3) { add(oldV2, c.grade.v2); add(oldV3, c.grade.v3); }
      cal(c.v2.p, c.grade.v2.outcomeHit);
      if (c.mine && c.final) { mineT.n++; mineT.model += c.grade.v2.outcomeHit ? 1 : 0; mineT.mine += c.mine === (c.final.h > c.final.a ? 'H' : c.final.h === c.final.a ? 'D' : 'A') ? 1 : 0; }
      live.push({ date: day.date, ...c });
    }
  }
  live.sort((a, b) => (b.kickoff || '').localeCompare(a.kickoff || ''));
  // Model vs SportsMole: the Hub's 141 tracked matches + everything graded here since.
  const smT = { n: 0, model: { outcome: 0, ou: 0, btts: 0 }, sm: { outcome: 0, ou: 0, btts: 0, score: 0 } };
  for (const r of legacySm) {
    smT.n++;
    smT.model.outcome += r.modelHit === true; smT.model.ou += r.modelOuHit === true; smT.model.btts += r.modelBttsHit === true;
    smT.sm.outcome += r.sportsmoleOutcomeHit === true; smT.sm.ou += r.smOuHit === true; smT.sm.btts += r.smBttsHit === true; smT.sm.score += r.sportsmoleScoreHit === true;
  }
  const smLive = live.filter(c => c.sm && c.smGrade);
  for (const c of smLive) {
    smT.n++;
    smT.model.outcome += c.grade.v2.outcomeHit; smT.model.ou += c.grade.v2.ouHit; smT.model.btts += c.grade.v2.bttsHit;
    smT.sm.outcome += c.smGrade.outcomeHit; smT.sm.ou += c.smGrade.ouHit; smT.sm.btts += c.smGrade.bttsHit; smT.sm.score += c.smGrade.scoreHit;
  }
  const avg = (x, n) => (n ? +(x / n).toFixed(3) : null);
  const mAll = x => ({ outcome: [x.outcome, x.n], ou: [x.ou, x.n], btts: [x.btts, x.n], brier: x.brier });
  const board = {
    same: { n: SB.outcome.n, models: Object.fromEntries(['v2', 'v4', 'fb'].map(m => [m, {
      outcome: [SB.outcome[m], SB.outcome.n], ou: [SB.ou[m], SB.ou.n], btts: [SB.btts[m], SB.btts.n], brier: avg(SB.brier[m], SB.brier.n) }])) },
    all: { models: { v2: mAll(fin(v2All)), v4: mAll(fin(v4All)), fb: { outcome: [fbT.outcome, fbT.n], ou: [fbT.ou, fbT.nOu], btts: [fbT.btts, fbT.nBtts], brier: avg(fbT.brier, fbT.n) } } },
  };
  return {
    board,
    smCompare: {
      ...smT, importedMatches: legacySm.length, newMatches: smLive.length,
      recent: smLive.slice(0, 100).map(c => ({ date: c.date, home: c.home, away: c.away, final: c.final, modelPick: c.v2.pick, modelP: c.v2.p, sm: c.sm.text, hit: c.grade.v2, smHit: c.smGrade })),
      earlier: legacySm.slice().reverse(),
    },
    v2: fin(v2All),
    forebet: { ...fbT, brier: fbT.n ? +(fbT.brier / fbT.n).toFixed(3) : null, any: fbT.n + fbT.nOu + fbT.nBtts, vs: Object.fromEntries(Object.entries(fbVs).map(([k, x]) => [k, { ...x, fbBrier: x.n ? +(x.fbBrier / x.n).toFixed(3) : null, brier: x.n ? +(x.brier / x.n).toFixed(3) : null }])) },
    calibration: CAL.map(b => ({ label: b.label, n: b.n, hits: b.hits, avg: b.n ? +(b.sum / b.n).toFixed(1) : null })),
    mine: mineT,
    h2h: { v2: fin(h2hV2), v4: fin(h2hV4) },
    v4: fin(v4All),
    h2hOld: { v2: fin(oldV2), v3: fin(oldV3) },
    importedMatches: legacy.v2Rows.length,
    newlyGraded: live.length,
    recent: live.slice(0, 200),
    earlier: legacy.v2Rows.slice().reverse().map(r => ({ match: r.match, actual: r.actual, outcomeHit: r.outcomeHit, ouHit: r.ouHit, bttsHit: r.bttsHit })),
  };
}

// Forebet picks pasted from its league table. Only games that have not kicked off, and only once per game.
export async function forebetPaste(date, slug, text, env, now = new Date(), kind = '1x2') {
  if (!['1x2', 'ou', 'btts'].includes(kind)) return { saved: 0, error: 'Unknown table type' };
  const day = await env.HUB.get(`day:${date}`, 'json');
  const cards = (day?.cards || []).filter(c => c.league === slug);
  if (!cards.length) return { saved: 0, error: 'No games on that day for this league. Analyze the day first.' };
  const has = c => kind === '1x2' ? !!c.fb?.p : kind === 'ou' ? c.fb?.over != null : c.fb?.btts != null;
  const started = c => !!c.final || new Date(c.kickoff).getTime() <= now.getTime();
  const open = cards.filter(c => !has(c) && !started(c));
  const { found, missing } = parseForebet(text, open, kind);
  for (const [id, fb] of found) { const c = cards.find(x => x.id === id); c.fb = { ...(c.fb || {}), ...fb, at: c.fb?.at || now.toISOString(), how: c.fb?.how || fb.how }; }
  if (found.size) await env.HUB.put(`day:${date}`, JSON.stringify(day));
  return {
    saved: found.size,
    alreadyHad: cards.filter(c => has(c) && !found.has(c.id)).length,
    started: cards.filter(c => !has(c) && started(c)).length,
    notFound: missing.map(id => { const c = cards.find(x => x.id === id); return `${c.home} vs ${c.away}`; }),
  };
}

// Verify and assign: the suggestions kept for one day, and a tap to attach one to its card.
export async function candidates(date, env) {
  const unm = await getUnm(env);
  return { items: unm.items.filter(i => i.date === date).map(({ row, ...i }) => i) };
}
export async function assignCandidate(date, slug, id, key, env, now = new Date(), { dismiss = false } = {}) {
  const unm = await getUnm(env), before = JSON.stringify(unm);
  const it = unm.items.find(i => i.key === key && i.cardId === id && i.date === date);
  if (!it) return { error: 'That suggestion is no longer available. Reload the day.' };
  if (dismiss) { unm.items = unm.items.filter(i => i.key !== key); await saveUnm(env, unm, before, today()); return { dismissed: true }; }
  const day = await env.HUB.get(`day:${date}`, 'json');
  const c = day?.cards?.find(x => x.league === slug && x.id === id);
  if (!c) return { error: 'Game not found on that day' };
  if (c.final || new Date(c.kickoff).getTime() <= now.getTime()) return { error: 'That game has already started, so a new prediction is not recorded.' };
  if (it.src === 'fb') {
    const row = it.row, rev = isName(row.home, c.away) && !isName(row.home, c.home);
    const synth = { id: 'x', home: rev ? row.away : row.home, away: rev ? row.home : row.away };
    const f = matchRows([row], [synth], it.kind).get('x');
    if (!f) return { error: 'That Forebet row has nothing usable.' };
    c.fb = { ...(c.fb || {}), ...f, at: c.fb?.at || now.toISOString(), how: 'assigned by you' };
  } else {
    const w = parseWeSay(await fetchText(it.url));
    if (!w) return { error: 'No "We say" line on that SportsMole page yet.' };
    c.sm = { h: w.h, a: w.a, text: w.text, url: it.url, how: 'assigned by you' };
  }
  unm.items = unm.items.filter(i => !(i.cardId === id && i.src === it.src && (it.src === 'sm' || i.kind === it.kind)));
  await env.HUB.put(`day:${date}`, JSON.stringify(day));
  await saveUnm(env, unm, before, today());
  return { assigned: true, src: it.src, title: it.title };
}

// A note (and optional own pick) saved on one card. One small write.
export async function noteCard(date, slug, id, note, mine, env) {
  const day = await env.HUB.get(`day:${date}`, 'json');
  const c = day?.cards?.find(x => x.league === slug && x.id === id);
  if (!c) return { error: 'Game not found on that day' };
  const t = String(note || '').trim().slice(0, 500);
  if (t) c.note = t; else delete c.note;
  if (['H', 'D', 'A'].includes(mine)) c.mine = mine; else delete c.mine;
  await env.HUB.put(`day:${date}`, JSON.stringify(day));
  return { saved: true, note: c.note || '', mine: c.mine || '' };
}

// ---------------------------------------------------------------------------------------------
// Cron: runs every 5 minutes and does ONE small job per run, rotating:
//   slot 0 = sync the least-recently-synced league   slot 1 = grade the next league that's due
//   slot 2 = analyze the next league that has no cards yet for today / tomorrow
//   slots 1 and 3 refresh one league's v4 ratings (about once a day each) when they have nothing else to do
// ---------------------------------------------------------------------------------------------
export async function runSlot(env, now = new Date(), slot = Math.floor(now.getTime() / 300000) % 4) {
  const t = localDate(now.toISOString());

  if (slot === 0) {
    const meta = (await env.HUB.get('meta:synced', 'json')) || {};
    const next = [...DOMESTIC, ...CUP_MODEL].sort((a, b) => (meta[a.slug] || '').localeCompare(meta[b.slug] || ''))[0];
    // Free plan allows 1,000 KV writes a day: don't re-sync a league that was synced in the last 8 hours.
    if (meta[next.slug] && now.getTime() - new Date(meta[next.slug]).getTime() < 8 * 3600000) return await safeNhl(env, now);
    const r = await syncLeague(next, env, now); await syncNote(env, next, r);
    return { job: 'sync', league: next.slug, ...r };
  }

  if (slot === 1) {
    const due = [];
    for (const date of [t, addDays(t, -1), addDays(t, -2)]) {
      const day = await env.HUB.get(`day:${date}`, 'json');
      for (const lg of LEAGUES) {
        const open = (day?.cards || []).filter(c => c.league === lg.slug && !c.final && (c.v2 || c.v4));
        if (!open.length) continue;
        const last = Math.max(...open.map(c => new Date(c.kickoff).getTime()));
        if (now.getTime() >= last + gradeDelayMs(env)) due.push({ date, slug: lg.slug, last });
      }
    }
    due.sort((a, b) => a.last - b.last || (a.slug < b.slug ? -1 : 1)); // oldest games first, then rotate by the clock
    if (!due.length) {
      const fbr = await forebetStep(env, now);
      if (fbr) return { job: 'forebet', ...fbr };
      return { job: 'grade', idle: true, ratings: await refreshRatings(env, now) }; // spare slot: keep v4 ratings fresh
    }
    const d = due[Math.floor(now.getTime() / 1200000) % due.length]; // one league per 20-minute turn, no stored state
    return { job: 'grade', league: d.slug, date: d.date, ...(await gradeLeague(d.date, d.slug, env, {}, now)) };
  }

  if (slot === 3) { // SportsMole "We say" for today / tomorrow, one league per run
    try { await getListing(env, now.getTime()); } catch (e) { /* keep going; retried next run */ }
    for (const date of [t, addDays(t, 1)]) {
      const day = await env.HUB.get(`day:${date}`, 'json');
      for (const lg of VISIBLE) {
        const need = (day?.cards || []).some(c => c.league === lg.slug && c.v2 && !c.sm && now.getTime() - (day.smTried?.[c.id] || 0) > 3 * HOUR);
        if (need) return { job: 'sportsmole', league: lg.slug, date, ...(await smLeague(date, lg.slug, env, now)) };
      }
    }
    const fbr = await forebetStep(env, now); // Forebet's own pages: one page per run, never read by a model
    if (fbr) return { job: 'forebet', ...fbr };
    return { job: 'sportsmole', idle: true, ratings: await refreshRatings(env, now) }; // spare slot: keep v4 ratings fresh
  }

  // slot 2: analyze. Domestic leagues first, cups last (cups need domestic data).
  const ordered = [...DOMESTIC.filter(l => !l.support), ...LEAGUES.filter(l => l.cup)];
  let tries = 0;
  for (const date of [t, addDays(t, 1)]) {
    const day = await env.HUB.get(`day:${date}`, 'json');
    for (const lg of ordered) {
      const at = day?.analyzed?.[lg.slug];
      if (at && now.getTime() - at < 6 * HOUR) continue;
      const r = await analyzeLeague(date, lg.slug, env, now);
      if (r.needsSync) { if (++tries >= 3) return { job: 'analyze', waiting: 'data sync' }; continue; }
      return { job: 'analyze', league: lg.slug, date, ...r };
    }
  }
  return await safeNhl(env, now);
}

// NHL work only runs in spare slots, and a failure there can never break the soccer jobs.
const safeNhl = async (env, now) => { try { return await nhlStep(env, now); } catch (e) { return { job: 'nhl', error: String(e && e.message || e).slice(0, 120) }; } };

const hub = {
  async fetch(req, env0) {
    const c = counted(env0), env = c.env;
    try { return await hub.handle(req, env); } finally { await c.flush(); }
  },

  async handle(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;
    const q = k => url.searchParams.get(k);

    // Whole site is private: page and data both need the password.
    if (!authed(req, env)) {
      if (p.startsWith('/api/')) return json({ error: 'Bad or missing admin token' }, 401);
      return new Response('Sign in to open Game Day Hub.', { status: 401, headers: { 'www-authenticate': 'Basic realm="Game Day Hub", charset="UTF-8"', 'cache-control': 'no-store' } });
    }

    if (p === '/api/config') {
      return json({
        today: today(), tomorrow: addDays(today(), 1), tz: TZ,
        // domestic first, cups last (cups need domestic data)
        leagues: [...DOMESTIC.filter(l => !l.support), ...LEAGUES.filter(l => l.cup)].map(l => ({ slug: l.slug, key: l.key, name: l.name, cup: !!l.cup })),
        tabs: VISIBLE.map(l => ({ slug: l.slug, key: l.key, name: l.name })),
      });
    }
    if (p === '/api/day') {
      const date = q('date') || today();
      return json((await env.HUB.get(`day:${date}`, 'json')) || { date, cards: [] });
    }
    if (p === '/api/tally') return json(await tally(env));
    if (p === '/api/candidates') return json(await candidates(q('date') || today(), env));
    if (req.method === 'POST' && p === '/api/assign') { try { const b = await req.json(); const lg = leagueBySlug(String(b.league || '')); if (!lg) return json({ error: 'Unknown league' }, 400); return json({ ok: true, ...(await assignCandidate(String(b.date || ''), lg.slug, String(b.id || ''), String(b.key || ''), env, new Date(), { dismiss: !!b.dismiss })) }); } catch (e) { return json({ error: `Assign: ${e && e.message ? e.message : e}` }, 500); } }
    if (p === '/api/nhl/day') { const date = q('date') || today(); return json((await env.HUB.get(`nhl:day:${date}`, 'json')) || { date, cards: [] }); }
    if (p === '/api/nhl/tally') return json(await nhlTally(env));
    if (p === '/api/nhl/status') return json(await nhlStatus(env));
    if (req.method === 'POST' && p === '/api/nhl/run') { try { return json({ ok: true, ...(await nhlStep(env, new Date(), fetch, { force: true })) }); } catch (e) { return json({ error: `NHL: ${e && e.message ? e.message : e}` }, 500); } }
    if (p === '/api/days') { // every saved day, for the Export button
      const out = []; let cursor;
      do { const r = await env.HUB.list({ prefix: 'day:', cursor }); out.push(...r.keys.map(k => k.name.slice(4))); cursor = r.list_complete === false ? r.cursor : null; } while (cursor);
      return json({ days: out.sort() });
    }
    if (p === '/api/status') {
      const [meta, errs, w, fbMeta] = await Promise.all([env.HUB.get('meta:synced', 'json'), env.HUB.get('meta:errors', 'json'), env.HUB.get('meta:writes', 'json'), env.HUB.get('meta:fb', 'json')]);
      const rated = {}; for (const l of DOMESTIC) if (v4Supports(l.slug)) rated[l.slug] = (await env.HUB.get(`rat:${l.slug}`, 'json'))?.builtAt || null;
      const cupAt = (await env.HUB.get('rat:cup', 'json'))?.builtAt || null; for (const l of CUP_MODEL) rated[l.slug] = cupAt;
      const d = new Date().toISOString().slice(0, 10);
      // Shot tracking: stored finished games checked for ESPN shots, and how many had them (cups are the open question).
      const shots = {}; await Promise.all([...DOMESTIC, ...CUP_MODEL].map(async l => { shots[l.slug] = shotsCoverage((await env.HUB.get(`res:${l.slug}`, 'json'))?.games); }));
      // What each league has from SportsMole and Forebet for the games still to come (today and tomorrow).
      const nowMs = Date.now(), per = {};
      for (const d of [today(), addDays(today(), 1)]) {
        const dd = await env.HUB.get(`day:${d}`, 'json');
        for (const c of dd?.cards || []) {
          if (c.final || !c.v2 || new Date(c.kickoff).getTime() <= nowMs) continue;
          const o = per[c.league] || (per[c.league] = { n: 0, sm: 0, tried: 0, fb: { '1x2': 0, ou: 0, btts: 0 } });
          o.n++; if (c.sm) o.sm++;
          const tr = dd.smTried && dd.smTried[c.id]; if (tr > o.tried) o.tried = tr;
          if (c.fb && c.fb.p) o.fb['1x2']++; if (c.fb && c.fb.over != null) o.fb.ou++; if (c.fb && c.fb.btts != null) o.fb.btts++;
        }
      }
      const srcOf = l => {
        const o = per[l.slug] || { n: 0, sm: 0, tried: 0, fb: {} }, fb = {};
        if (FB_PAGES[l.slug]) for (const k of ['1x2', 'ou', 'btts']) { const m = (fbMeta || {})[`${l.slug}|${k}`]; if (m) fb[k] = { at: m.at, ok: !!m.ok, msg: m.msg || null, cov: [o.fb[k] || 0, o.n] }; }
        return { sm: { tried: o.tried ? new Date(o.tried).toISOString() : null, found: o.sm, total: o.n }, fb: FB_PAGES[l.slug] ? fb : null };
      };
      return json({
        now: Date.now(), forebet: { pages: Object.keys(FB_PAGES), reads: fbMeta || {} }, writes: { used: w && w.d === d ? w.n : 0, limit: WRITE_LIMIT, resetsAtUtc: d + 'T24:00Z' },
        leagues: [...DOMESTIC, ...CUP_MODEL].map(l => ({ slug: l.slug, name: l.name, support: !!l.support, lastSync: (meta || {})[l.slug] || null, shots: shots[l.slug], problem: (errs || {})[l.slug] || null, ...srcOf(l), v4: l.slug in rated ? { ratingsAt: rated[l.slug] ? new Date(rated[l.slug]).toISOString() : null } : null })),
      });
    }

    if (req.method === 'POST' && p === '/api/ratings') { // rebuild one league's v4 ratings now (the cron does this about daily)
      const league = leagueBySlug(q('league'));
      const target = q('league') === 'cup' || (league && league.cupModel) ? 'cup' : league && v4Supports(league.slug) ? league.slug : null;
      if (!target) return json({ error: 'Pass ?league=<slug> for a league that has v4 ratings (or cup for the Champions / Europa League ratings)' }, 400);
      try { return json({ ok: true, ...(await refreshRatings(env, new Date(), [target], { force: true })) }); } catch (e) { return json({ error: `${league ? league.name : "Cup"} (ratings): ${e && e.message ? e.message : e}` }, 500); }
    }
    if (req.method === 'POST' && ['/api/sync', '/api/analyze', '/api/grade', '/api/sm', '/api/note', '/api/forebet'].includes(p)) {
      const league = leagueBySlug(q('league'));
      if (!league) return json({ error: 'Pass ?league=<slug>, one league per request' }, 400);
      try {
        if (p === '/api/sync') { const r = await syncLeague(league, env); await syncNote(env, league, r); return json({ ok: true, ...r }); }
        if (p === '/api/analyze') {
          const r = await analyzeLeague(q('date') || addDays(today(), 1), league.slug, env, new Date(), { partial: q('partial') === '1', leftover: q('leftover') === '1' });
          if (r.feedError) await noteLeague(env, league.slug, 'games', "ESPN's game list wouldn't load").catch(() => {});
          else if (r.cards !== undefined) await noteLeague(env, league.slug, 'games', null).catch(() => {});
          return json({ ok: true, ...r });
        }
        if (p === '/api/forebet') { let b = {}; try { b = await req.json(); } catch (e) { /* empty */ }
          if (b.fetch) { const kind = q('kind') || '1x2'; if (!FB_PAGES[league.slug]) return json({ error: `No Forebet page is set up for ${league.name}` }, 400); return json({ ok: true, ...(await forebetFetch(env, league.slug, kind, new Date())) }); } return json({ ok: true, ...(await forebetPaste(q('date'), league.slug, String(b.text || ''), env, new Date(), q('kind') || '1x2')) }); }
        if (p === '/api/note') { let b = {}; try { b = await req.json(); } catch (e) { /* empty */ } return json({ ok: true, ...(await noteCard(q('date'), league.slug, String(b.id || ''), b.note, b.mine, env)) }); }
        if (p === '/api/sm') return json({ ok: true, ...(await smLeague(q('date') || today(), league.slug, env, new Date(), { force: true })) });
        return json({ ok: true, ...(await gradeLeague(q('date') || today(), league.slug, env, { force: true })) });
      } catch (e) {
        return json({ error: `${league.name} (${p.slice(5)}): ${e && e.message ? e.message : e}` }, 500);
      }
    }
    return env.ASSETS.fetch(req);
  },

  async scheduled(event, env0, ctx) {
    const c = counted(env0);
    ctx.waitUntil(runSlot(c.env).finally(() => c.flush()));
  },
};
export default hub;
