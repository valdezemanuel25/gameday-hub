import { v2, v3, grade, pickOutcome, bestBet } from './model.js';
import {
  TZ, LEAGUES, VISIBLE, DOMESTIC, leagueBySlug, localDate, localTime, syncLeague,
  findTeam, getContext, missingContexts, fixturesForLeague,
} from './data.js';
import legacy from './legacy.js';
import legacySm from './legacy_sm.js';
import { getListing, matchLink, fetchText, parseWeSay, smGrade } from './sportsmole.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

const HOUR = 3600000;
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

function authed(req, env) {
  const t = req.headers.get('x-admin-token') || '';
  return !!env.ADMIN_TOKEN && t === env.ADMIN_TOKEN;
}

// ---------------------------------------------------------------------------------------------
// Analyze ONE league for ONE date: fixtures -> v2 (official) + v3 (shadow) cards.
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
    if (leftover && old?.v2) { cards.push(old); continue; } // 'Analyze leftover': keep finished predictions as they are

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
    if (!h || !a) {
      if (needsSync.length) notReady++;
      card.skipped = 'Club not found in any synced league yet';
      cards.push(card); continue;
    }
    if (h.team.form.n < 3 || a.team.form.n < 3) {
      card.skipped = 'Not enough recent league results for one or both teams';
      cards.push(card); continue;
    }
    const r2 = v2(h.team.form, a.team.form);
    const mk = (t, lg, ctx) => ({ ...t, league: lg.ls, leagueAvg: ctx.leagueAvg });
    const r3 = v3(mk(h.team, h.league, h.ctx), mk(a.team, a.league, a.ctx));
    card.v2 = slim(r2);
    card.v3 = slim(r3);
    if (old?.sm) card.sm = old.sm;
    if (f.done && date <= LEGACY_THROUGH) { // old day: show the real result against the pre-kickoff prediction
      card.final = { h: f.home.score, a: f.away.score };
      card.grade = { v2: grade(toPred(card.v2), card.final), v3: grade(toPred(card.v3), card.final) };
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
  const open = (day?.cards || []).filter(c => c.league === slug && !c.final && c.v2);
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
    c.grade = { v2: grade(toPred(c.v2), c.final), v3: grade(toPred(c.v3), c.final) };
    if (c.sm) c.smGrade = smGrade(c.sm, c.final);
    graded++;
  }
  // Remember the attempt so a league whose games aren't final yet (postponed, feed lagging) can't
  // block the others: the cron rotates by least-recently-tried.
  day.gradeTried = { ...(day.gradeTried || {}), [slug]: now.getTime() };
  await env.HUB.put(`day:${date}`, JSON.stringify(day));
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
  const errors = [];
  for (const c of todo) {
    const link = matchLink(c.home, c.away, links);
    day.smTried[c.id] = now.getTime();
    if (!link) { missed++; continue; }
    if (fetched >= 6) { delete day.smTried[c.id]; continue; } // keep each request small; the next run continues
    fetched++;
    try {
      const w = parseWeSay(await fetchText(link.url));
      if (!w) { missed++; continue; }
      c.sm = { h: w.h, a: w.a, text: w.text, url: link.url };
      if (c.final) c.smGrade = smGrade(c.sm, c.final);
      found++;
    } catch (e) { errors.push(e.message); delete day.smTried[c.id]; }
  }
  await env.HUB.put(`day:${date}`, JSON.stringify(day));
  return { found, missed, listed: links.length, ...(errors.length ? { errors } : {}) };
}

// ---------------------------------------------------------------------------------------------
// Totals = history imported from the old Hub + everything graded here since.
//  v2: official model, all graded matches.  h2h: v2 vs v3 on the SAME matches only.
// ---------------------------------------------------------------------------------------------
function blank() { return { n: 0, outcome: 0, ou: 0, btts: 0, brier: 0 }; }
function add(t, g) { t.n++; t.outcome += g.outcomeHit; t.ou += g.ouHit; t.btts += g.bttsHit; t.brier += g.brier; }
function fin(t) { return { ...t, brier: t.n ? +(t.brier / t.n).toFixed(3) : null }; }

async function tally(env) {
  const list = await env.HUB.list({ prefix: 'day:' });
  const v2All = blank(), h2hV2 = blank(), h2hV3 = blank();
  const live = [];
  for (const r of legacy.v2Rows) {
    v2All.n++; v2All.outcome += r.outcomeHit; v2All.ou += r.ouHit; v2All.btts += r.bttsHit; v2All.brier += r.brier ?? 0;
  }
  for (const r of legacy.shadow) {
    const [h, a] = r.final.split('–').map(Number);
    add(h2hV2, grade(toPred(r.v2), { h, a }));
    add(h2hV3, grade(toPred(r.v3), { h, a }));
  }
  for (const k of list.keys) {
    const day = await env.HUB.get(k.name, 'json');
    for (const c of day?.cards || []) {
      if (!c.grade || day.date <= LEGACY_THROUGH) continue;
      add(v2All, c.grade.v2); add(h2hV2, c.grade.v2); add(h2hV3, c.grade.v3);
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
  return {
    smCompare: {
      ...smT, importedMatches: legacySm.length, newMatches: smLive.length,
      recent: smLive.slice(0, 100).map(c => ({ date: c.date, home: c.home, away: c.away, final: c.final, modelPick: c.v2.pick, modelP: c.v2.p, sm: c.sm.text, hit: c.grade.v2, smHit: c.smGrade })),
      earlier: legacySm.slice().reverse(),
    },
    v2: fin(v2All),
    h2h: { v2: fin(h2hV2), v3: fin(h2hV3) },
    importedMatches: legacy.v2Rows.length,
    newlyGraded: live.length,
    recent: live.slice(0, 200),
    earlier: legacy.v2Rows.slice().reverse().map(r => ({ match: r.match, actual: r.actual, outcomeHit: r.outcomeHit, ouHit: r.ouHit, bttsHit: r.bttsHit })),
  };
}

// ---------------------------------------------------------------------------------------------
// Cron: runs every 5 minutes and does ONE small job per run, rotating:
//   slot 0 = sync the least-recently-synced league   slot 1 = grade the next league that's due
//   slot 2 = analyze the next league that has no cards yet for today / tomorrow
// ---------------------------------------------------------------------------------------------
export async function runSlot(env, now = new Date(), slot = Math.floor(now.getTime() / 300000) % 4) {
  const t = localDate(now.toISOString());

  if (slot === 0) {
    const meta = (await env.HUB.get('meta:synced', 'json')) || {};
    const next = [...DOMESTIC].sort((a, b) => (meta[a.slug] || '').localeCompare(meta[b.slug] || ''))[0];
    return { job: 'sync', league: next.slug, ...(await syncLeague(next, env, now)) };
  }

  if (slot === 1) {
    const due = [];
    for (const date of [t, addDays(t, -1), addDays(t, -2)]) {
      const day = await env.HUB.get(`day:${date}`, 'json');
      for (const lg of LEAGUES) {
        const open = (day?.cards || []).filter(c => c.league === lg.slug && !c.final && c.v2);
        if (!open.length) continue;
        const last = Math.max(...open.map(c => new Date(c.kickoff).getTime()));
        if (now.getTime() >= last + gradeDelayMs(env)) due.push({ date, slug: lg.slug, last, tried: day.gradeTried?.[lg.slug] || 0 });
      }
    }
    due.sort((a, b) => a.tried - b.tried || a.last - b.last); // least recently tried first, then oldest games
    if (!due.length) return { job: 'grade', idle: true };
    const d = due[0];
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
    return { job: 'sportsmole', idle: true };
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
  return { job: 'analyze', idle: true };
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;
    const q = k => url.searchParams.get(k);

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

    if (req.method === 'POST' && ['/api/sync', '/api/analyze', '/api/grade', '/api/sm'].includes(p)) {
      if (!authed(req, env)) return json({ error: 'Bad or missing admin token' }, 401);
      const league = leagueBySlug(q('league'));
      if (!league) return json({ error: 'Pass ?league=<slug>, one league per request' }, 400);
      try {
        if (p === '/api/sync') return json({ ok: true, ...(await syncLeague(league, env)) });
        if (p === '/api/analyze') return json({ ok: true, ...(await analyzeLeague(q('date') || addDays(today(), 1), league.slug, env, new Date(), { partial: q('partial') === '1', leftover: q('leftover') === '1' })) });
        if (p === '/api/sm') return json({ ok: true, ...(await smLeague(q('date') || today(), league.slug, env, new Date(), { force: true })) });
        return json({ ok: true, ...(await gradeLeague(q('date') || today(), league.slug, env, { force: true })) });
      } catch (e) {
        return json({ error: `${league.name} (${p.slice(5)}): ${e && e.message ? e.message : e}` }, 500);
      }
    }
    return env.ASSETS.fetch(req);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runSlot(env));
  },
};
