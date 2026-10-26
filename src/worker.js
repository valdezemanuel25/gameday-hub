import { v2, grade, pickOutcome, bestBet } from './model.js';
import { predict5 } from './v5core.js';
import { scoreCard } from './v6core.js';
import { usualOverSide, supports as v4Supports, resolve as v4Resolve, predict as v4Predict, getRatings, refreshRatings, cupForecast } from './v4.js';
import {
  TZ, LEAGUES, UNTRACKED, isCounted, FIRST_DIV, VISIBLE, DOMESTIC, CUP_MODEL, leagueBySlug, localDate, localTime, syncLeague,
  findTeam, getContext, missingContexts, fixturesForLeague, rawOdds, shotsCoverage, PRICED,
} from './data.js';
import { parseForebet, mergeSeed, fbGrade } from './forebet.js';
import { forebetStep, forebetFetch, FB_PAGES, matchRows, is as isName } from './forebetpage.js';
import legacy from './legacy.js';
import legacySm from './legacy_sm.js';
import { getUnm, saveUnm, likeness, slugTitle } from './verify.js';
import { analyze as analyzeBet, loadCards as betCards, addBet, listBets, changeBet } from './bets.js';
import { addStrats } from './strats.js';
import { blankMarket, addMarket, finishMarket, scoreOne } from './market.js';
import { fetchBtts } from './btts.js';
import { leanPick, leanHit, priceFor, unitsWon, verdictOf, bandOf } from './pick.js';
import { getVapid, getPush, addSub, removeSub, sendAll, pushStep } from './push.js';
import { nhlStep, nhlTally, nhlStatus, nhlSetLine } from './nhl.js';
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
    // Counting must not eat the budget it counts: keep a running tally in the (free) edge cache and
    // save it to KV only once about 15 writes have piled up.
    let pending = n;
    const cache = typeof caches !== 'undefined' ? caches.default : null, ck = new Request(`https://hub.local/writes/${d}`);
    if (cache) { try { const r = await cache.match(ck); pending += r ? Number(await r.text()) || 0 : 0; } catch (e) { /* count from this run only */ } }
    if (cache && pending < 15) { try { await cache.put(ck, new Response(String(pending), { headers: { 'cache-control': 'max-age=86400' } })); return; } catch (e) { /* fall through and save */ } }
    const c = (await base.get('meta:writes', 'json').catch(() => null)) || {};
    await base.put('meta:writes', JSON.stringify({ d, n: (c.d === d ? c.n : 0) + pending + 1 })).catch(() => {});
    if (cache) { try { await cache.delete(ck); } catch (e) { /* ignore */ } }
  } };
}

async function pendingWrites(d) {
  try { if (typeof caches === 'undefined') return 0; const r = await caches.default.match(new Request(`https://hub.local/writes/${d}`)); return r ? Number(await r.text()) || 0 : 0; } catch (e) { return 0; }
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
  ...(p.promo ? { promo: true } : {}), // v4 used a starting rating for a newly promoted club: tracked on its own line
});
const toPred = s => ({ home: s.p[0] / 100, draw: s.p[1] / 100, away: s.p[2] / 100, over25: s.over / 100, bttsYes: s.btts / 100 });

// The password is ADMIN_TOKEN. It is accepted from the sign-in page (which sets a one-year cookie), from the x-admin-token header,
// and from HTTP Basic (any username) so scripts keep working. With no ADMIN_TOKEN set, nothing is let in.
// The cookie is an HMAC of a fixed phrase under the password, so nothing is stored; changing the password signs every device out.
const COOKIE = 'hub_s';
async function sessionValue(env) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.ADMIN_TOKEN), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode('game-day-hub session v1'));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const same = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
async function authed(req, env) {
  if (!env.ADMIN_TOKEN) return false;
  if (same(req.headers.get('x-admin-token') || '', env.ADMIN_TOKEN)) return true;
  const h = req.headers.get('authorization') || '';
  if (h.startsWith('Basic ')) {
    try { const d = atob(h.slice(6)); if (same(d.slice(d.indexOf(':') + 1), env.ADMIN_TOKEN)) return true; } catch (e) { /* fall through to the cookie */ }
  }
  const m = /(?:^|;\s*)hub_s=([0-9a-f]+)/.exec(req.headers.get('cookie') || '');
  return !!m && same(m[1], await sessionValue(env));
}
// What loads without signing in: the sign-in page itself and the files a phone or desktop needs to install the app.
const PUBLIC_FILES = new Set(['/login.html', '/manifest.webmanifest', '/sw.js', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/apple-touch-icon.png', '/favicon.ico']);
const safeNext = n => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/login') ? n : '/');

// ---------------------------------------------------------------------------------------------
// Analyze ONE league for ONE date: fixtures -> v2 + v4 (official since 2026-10-26) cards.
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
    if (leftover && old?.v2 && 'v4' in old && ('v5' in old || league.cupModel || f.done) && !(league.cupModel && old.v4 === null)) { cards.push(old); continue; } // a card from before v5 gets it now

    const hint = league.cup ? undefined : slug;
    const h0 = await findTeam(f.home.id, env, memo, hint);
    const a0 = await findTeam(f.away.id, env, memo, hint);
    const h = h0 && { ...h0, team: { ...h0.team, form: formAt(h0.team, f.date) } };
    const a = a0 && { ...a0, team: { ...a0.team, form: formAt(a0.team, f.date) } };
    const card = {
      id: f.id, kickoff: f.date, ko: localTime(f.date),
      league: slug, leagueKey: league.key, leagueName: league.name,
      home: f.home.name, away: f.away.name, final: null,
      hAbbr: f.home.abbr || null, aAbbr: f.away.abbr || null, hId: f.home.id || null, aId: f.away.id || null, hRank: h?.team.rank ?? null, aRank: a?.team.rank ?? null,
    };
    // v4 cup shadow (Champions League / Europa League): works from the cup model's own ratings, so it can
    // still predict a game v2 cannot (a club from a league the Hub does not keep).
    const r4cup = !f.done && league.cupModel ? await cupForecast(league, f, h0, a0, env, memo, debug) : null;
    if (!h || !a) {
      if (needsSync.length) notReady++;
      card.skipped = 'Club not found in any synced league yet (a full card needs its league results)';
      if (r4cup) { card.v4 = slim(r4cup); keepOdds(card, old, f, slug, now); }
      setV6(card, old, now);
      cards.push(card); continue;
    }
    if (h.team.form.n < 3 || a.team.form.n < 3) {
      card.skipped = 'Not enough recent league results for one or both teams (a full card needs them)';
      if (r4cup) { card.v4 = slim(r4cup); keepOdds(card, old, f, slug, now); }
      setV6(card, old, now);
      cards.push(card); continue;
    }
    const r2 = v2(h.team.form, a.team.form);
    card.v2 = slim(r2);
    // v4 shadow: only for league games that haven't been played yet, and only when both clubs have enough history.
    // (null = v4 has nothing to say: cup game, club not found, or too little history.)
    let r4 = null, r5 = null, why = null; // why = the plain-words reason a game has no v4 (shown on the card)
    if (league.cup && !league.cupModel) why = null;
    else if (f.done) why = 'the game was already played when the Hub first saw it';
    else if (league.cupModel) why = memo.get('v4why:' + f.id) || null;
    else if (!v4Supports(slug)) why = 'v4 is not built for this league';
    else if (h.league.slug !== slug || a.league.slug !== slug) why = "a club is not in this league's history";
    else {
      const R = await getRatings(league, env, memo);
      const hn = v4Resolve(slug, f.home.name) || v4Resolve(slug, h.team.name), an = v4Resolve(slug, f.away.name) || v4Resolve(slug, a.team.name);
      if (!hn || !an) why = `club not recognized: ${!hn ? f.home.name : f.away.name}`;
      else { r4 = v4Predict(R, hn, an); if (!r4) why = 'one club has no games on record'; else if (!r4.promo) r5 = predict5(r4, R.elo, hn, an); }
    }
    if (league.cupModel) r4 = r4cup;
    card.v4 = r4 ? slim(r4) : null;
    card.v5 = r5 ? slim(r5) : null; // v5 shadow (league games only; not for a newly promoted club's starting rating)
    // Once the game has kicked off the v4 made before it stands: a later re-analysis must not wipe it.
    if (old?.v4 && new Date(f.date).getTime() <= now.getTime()) { card.v4 = old.v4; why = null; if (old.v4why) delete card.v4why; }
    if (new Date(f.date).getTime() <= now.getTime() && old && 'v5' in old) card.v5 = old.v5; // likewise v5
    if (!card.v4 && why) card.v4why = why;
    keepOdds(card, old, f, slug, now);
    setV6(card, old, now);
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

// v6 score card from the card's price (src/v6core.js). Before kickoff it follows the latest price; after kickoff the one made before stands.
// No price, no v6. Returns true when the card's v6 changed.
// v6o: the same score card from the opening price (op / opt, else the first price seen), so the Movement tab can show how the
// both-score chance (which has no price of its own in the feed) moved from opening to close.
function setV6(card, old, now = new Date()) {
  const was = JSON.stringify([card.v6 ?? old?.v6 ?? null, card.v6o ?? old?.v6o ?? null]);
  if (old && 'v6' in old && new Date(card.kickoff).getTime() <= now.getTime()) { card.v6 = old.v6; if (old.v6o) card.v6o = old.v6o; }
  else {
    const r = card.odds ? scoreCard(card.odds, card.v4 ? toPred(card.v4) : null) : null; card.v6 = r ? slim(r) : null;
    const o = card.odds, op = o && (o.op || o.f), ot = o && (o.opt || (o.f && o.f.tl != null ? o.f : null));
    const r0 = op ? scoreCard({ h: op.h, d: op.d, a: op.a, ...(ot ? { tl: ot.tl, to: ot.to, tu: ot.tu } : {}) }) : null;
    if (r0) card.v6o = { btts: Math.round(100 * r0.bttsYes), over: Math.round(100 * r0.over25) }; else delete card.v6o;
  }
  return JSON.stringify([card.v6 ?? null, card.v6o ?? null]) !== was;
}
// Attach the price to a card being (re)built; from PRICE_LOCK minutes before kickoff the price read before then stands.
function keepOdds(card, old, f, slug, now) {
  if (PRICED.has(slug) && f.odds) card.odds = withOdds(old?.odds, f.odds);
  if (old?.odds && (!card.odds || new Date(f.date).getTime() - now.getTime() <= PRICE_LOCK * 60000)) card.odds = old.odds; // locked from PRICE_LOCK minutes before kickoff
}
// A fresh price for a card: keeps the both-score prices (they come from another source) and `f`, the first home / draw / away price the
// Hub saw for this game. `f` is what a bet placed when the pick first showed would have got; the price at kickoff is the closing one.
// The first price also keeps the total (line and Over / Under prices) when the book had one, so totals can be tracked from it too.
// ts (when the price last changed) and cl (when the lineup read was taken: the closing price) carry over from the old price.
export function withOdds(old, fresh) {
  const n = { ...fresh, ...(old && old.by != null ? { by: old.by, bn: old.bn } : {}), ...(old && old.ts ? { ts: old.ts } : {}), ...(old && old.cl ? { cl: old.cl } : {}) };
  const snap = o => ({ h: o.h, d: o.d, a: o.a, ...(o.tl != null && o.to != null && o.tu != null ? { tl: o.tl, to: o.to, tu: o.tu } : {}) });
  const f = old && old.f ? old.f : old && old.h != null && old.d != null && old.a != null ? snap(old) : fresh.h != null && fresh.d != null && fresh.a != null ? snap(fresh) : null;
  if (f) n.f = f;
  return n;
}
// ---------------------------------------------------------------------------------------------
// Prices for games already analyzed: look at ONE first-division league per run (each at most every 6 hours, remembered in the free
// edge cache so it costs no KV writes) and attach ESPN's current price to cards that have not started. Display only; no model reads it.
// Fetch ESPN's current price for ONE first-division league on ONE day and attach it to games that have a model pick and have not started.
// The closing price is read about 30 minutes before kickoff, once the official lineups are out (LINEUP_READ). From PRICE_LOCK minutes
// before kickoff a card's price is no longer touched, so the lineup read stands as the close (a later read would not replace it).
export const LINEUP_READ = 30, PRICE_LOCK = 20;
// Same value whatever the order of the keys (a price object gains ts / cl over time, so key order alone must not count as a change).
const canon = v => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v);
const sameJson = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const priceOpen = (c, now) => new Date(c.kickoff).getTime() - now.getTime() > PRICE_LOCK * 60000;
export async function refreshOdds(env, date, slug, now = new Date()) {
  const lg = leagueBySlug(slug); if (!lg || !PRICED.has(slug)) return { error: 'Prices are only read for first divisions and the two European cups' };
  const day = await env.HUB.get(`day:${date}`, 'json'); if (!day) return { games: 0, priced: 0, changed: 0 };
  const open = (day.cards || []).filter(c => c.league === slug && (c.v2 || c.v4) && !c.final && priceOpen(c, now));
  if (!open.length) return { games: 0, priced: 0, changed: 0 };
  const byId = new Map((await fixturesForLeague(lg, date, [])).map(f => [f.id, f]));
  let changed = 0, priced = 0;
  for (const c of open) {
    const o = byId.get(c.id)?.odds; if (o) priced++;
    let ch = false;
    if (o) { const n = withOdds(c.odds, o); if (sameJson(n, c.odds) === false) { n.ts = now.toISOString(); c.odds = n; ch = true; } }
    // The read inside the lineup window (LINEUP_READ to PRICE_LOCK minutes before kickoff) is the closing price: note when it was taken.
    if (o && c.odds && !c.odds.cl && new Date(c.kickoff).getTime() - now.getTime() <= LINEUP_READ * 60000) { c.odds.cl = now.toISOString(); ch = true; }
    if (c.odds && setV6(c, c, now)) ch = true; // the score card follows the price (and a card priced before v6 existed gets one)
    if (ch) changed++;
  }
  if (changed) await env.HUB.put(`day:${date}`, JSON.stringify(day));
  return { games: open.length, priced, changed };
}
// Background: look at ONE first-division league per run (each at most every 6 hours, remembered in the free edge cache so it costs no
// KV writes). Display only; no model reads a price.
export async function refreshBtts(env, date, slug, now = new Date(), f = fetch) {
  if (!FIRST_DIV.has(slug)) return { error: 'Prices are only read for first divisions' };
  const day = await env.HUB.get(`day:${date}`, 'json'); if (!day) return { games: 0, priced: 0 };
  const open = (day.cards || []).filter(c => c.league === slug && c.v2 && !c.final && new Date(c.kickoff).getTime() > now.getTime());
  if (!open.length) return { games: 0, priced: 0 };
  const need = open.filter(c => !(c.odds && c.odds.by != null)), have = open.length - need.length; // already-priced games cost no credit
  if (!need.length) return { games: open.length, priced: have, skipped: [], left: null };
  const r = await fetchBtts(env.ODDS_API_KEY, slug, need, f); if (r.error) return { error: r.error };
  let changed = 0;
  for (const c of need) { const p = r.prices.get(c.id); if (p && (!c.odds || c.odds.by !== p.by || c.odds.bn !== p.bn)) { c.odds = { ...(c.odds || {}), by: p.by, bn: p.bn }; changed++; } }
  if (changed) await env.HUB.put(`day:${date}`, JSON.stringify(day));
  return { games: open.length, priced: have + r.prices.size, skipped: r.skipped, left: r.left };
}
export async function oddsStep(env, now = new Date(), cache = typeof caches !== 'undefined' ? caches.default : null) {
  const t = localDate(now.toISOString());
  for (const date of [t, addDays(t, 1)]) {
    const day = await env.HUB.get(`day:${date}`, 'json'); if (!day) continue;
    for (const lg of LEAGUES.filter(l => PRICED.has(l.slug))) {
      const live = (day.cards || []).filter(c => c.league === lg.slug && (c.v2 || c.v4) && !c.final && priceOpen(c, now));
      if (!live.length) continue;
      // When this league is looked at again: every 6 hours as a rule, every hour in the last 3 hours before its next kickoff, and always
      // once in the window from LINEUP_READ to PRICE_LOCK minutes before it (the wait never runs past LINEUP_READ minutes before).
      const mins = (Math.min(...live.map(c => new Date(c.kickoff).getTime())) - now.getTime()) / 60000;
      const ttl = Math.max(300, Math.min(mins <= 180 ? 3600 : 21600, Math.round((mins - LINEUP_READ) * 60)));
      const ck = new Request(`https://hub.local/odds/${date}/${lg.slug}`);
      try { if (cache && await cache.match(ck)) continue; } catch (e) { /* no cache: just look */ }
      try { if (cache) await cache.put(ck, new Response('1', { headers: { 'cache-control': `max-age=${ttl}` } })); } catch (e) { /* ignore */ }
      return { job: 'odds', league: lg.slug, date, ...(await refreshOdds(env, date, lg.slug, now)) };
    }
  }
  return null;
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
    if (c.v5) c.grade.v5 = grade(toPred(c.v5), c.final);
    if (c.v6) c.grade.v6 = grade(toPred(c.v6), c.final);
    if (c.sm && c.v2) c.smGrade = smGrade(c.sm, c.final);
    // The card's headline pick is locked here, from what the card held when it finished, and scored on the final score.
    if (c.v2 && !c.lean) { const l = leanPick(c); if (l) { l.hit = leanHit(l.key, c.final); const m = FIRST_DIV.has(c.league) ? priceFor(c.odds, l.key) : null; if (m != null) { l.price = m; l.vd = verdictOf(l.p, m); } c.lean = l; } }
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
//  v2: all graded matches (official model until 2026-10-25; v4 since).  h2h: v2 vs v4 on the SAME matches only (v4 started 2026-10-14).
//  market: each model against the sportsbook price (src/market.js).
//  h2hOld: the retired v3 shadow test (58 imported matches + any live games predicted before v4 took over).
// ---------------------------------------------------------------------------------------------
function blank() { return { n: 0, outcome: 0, ou: 0, btts: 0, brier: 0 }; }
function add(t, g) { t.n++; t.outcome += g.outcomeHit; t.ou += g.ouHit; t.btts += g.bttsHit; t.brier += g.brier; }
function fin(t) { return { ...t, brier: t.n ? +(t.brier / t.n).toFixed(3) : null }; }

async function tally(env) {
  const list = await env.HUB.list({ prefix: 'day:' });
  const promoV2 = blank(), promoV4 = blank(), v2All = blank(), v4All = blank(), h2hV2 = blank(), h2hV4 = blank(), oldV2 = blank(), oldV3 = blank();
  const live = [], mineT = { n: 0, mine: 0, model: 0 };
  // Model bets: every card's headline pick, locked when the game was graded. Counted by strength, by kind of pick and by how many models backed it.
  const TB = { strats: {}, base: { n: 0, home: 0, draw: 0, away: 0, over: 0, btts: 0 } };
  const LB = { n: 0, hits: 0, byKind: {}, byKey: {}, byBack: {}, base: { home: 0, draw: 0, away: 0, over: 0, btts: 0 }, recent: [] }, lbAdd = (o, k, hit, pk) => { const x = o[k] || (o[k] = { n: 0, hits: 0 }); x.n++; x.hits += hit ? 1 : 0; if (pk) (x.ks || (x.ks = {}))[pk] = (x.ks[pk] || 0) + 1; }; // ks: which kinds of pick are inside, so the page can work out what chance alone would score
  // Per-league scorecard and goals-market calibration (v2 / v4 / Forebet), built from every graded game.
  const perLg = new Map(), GB = [['Under 40%', 0, 40], ['40 to 49%', 40, 50], ['50 to 59%', 50, 60], ['60 to 69%', 60, 70], ['70% and up', 70, 101]];
  const calG = { over: { v2: [], v4: [], fb: [] }, btts: { v2: [], v4: [], fb: [] } };
  for (const m of ['over', 'btts']) for (const k of ['v2', 'v4', 'fb']) calG[m][k] = GB.map(([label, lo, hi]) => ({ label, lo, hi, n: 0, hits: 0, sum: 0 }));
  const calAdd = (m, k, pct, hit) => { if (pct == null) return; const b = calG[m][k].find(x => pct >= x.lo && pct < x.hi); if (b) { b.n++; b.hits += hit ? 1 : 0; b.sum += pct; } };
  const lgRow = c => { let r = perLg.get(c.league); if (!r) perLg.set(c.league, r = { slug: c.league, name: c.leagueName || c.league, n: 0, v2: blank(), v4: blank(), v5: blank(), fb: blank() }); return r; };
  // Last 30 days (winner hit rate per model) and how the Board's "top picks" have done: winner at 55%+, goals markets at 62%+.
  const mh = () => ({ n: 0, w: 0, ou: 0, bt: 0 }), last30 = { n: 0, v2: mh(), v4: mh(), v5: mh(), fb: mh() }, topT = { win: { n: 0, hits: 0 }, goals: { n: 0, hits: 0 }, rest: { n: 0, hits: 0 } };
  const fbT = { n: 0, outcome: 0, score: 0, brier: 0, nOu: 0, ou: 0, nBtts: 0, btts: 0 }, mk = () => ({ n: 0, fbOutcome: 0, fbBrier: 0, outcome: 0, brier: 0, nOu: 0, fbOu: 0, ou: 0, nBtts: 0, fbBtts: 0, btts: 0 }), fbVs = { v2: mk(), v4: mk() };
  // Same-games table for the Results tab: a metric counts a game only when v2, v4 and Forebet all have it.
  const SB = { outcome: { n: 0, v2: 0, v4: 0, fb: 0 }, ou: { n: 0, v2: 0, v4: 0, fb: 0 }, btts: { n: 0, v2: 0, v4: 0, fb: 0 }, brier: { n: 0, v2: 0, v4: 0, fb: 0 } };
  const CAL = [['Under 40%', 0, 40], ['40 to 49%', 40, 50], ['50 to 59%', 50, 60], ['60% and up', 60, 101]].map(([label, lo, hi]) => ({ label, lo, hi, n: 0, hits: 0, sum: 0 }));
  const cal = (p, hit) => { const t = Math.max(...p), b = CAL.find(x => t >= x.lo && t < x.hi); if (!b) return; b.n++; b.hits += hit ? 1 : 0; b.sum += t; };
  // Do-nothing baselines: always pick the home team, always pick Over 2.5. 'all' covers the games v2 was graded on, 'same' the games all three models have.
  const BASE = { all: { n: 0, home: 0, over: 0, un: 0, uh: 0 }, same: { home: 0, over: 0, un: 0, uh: 0 } }; // un/uh = games with a league 'usual side' and how many that side got right
  for (const r of legacy.v2Rows) {
    { const m = /(\d+)\s*[–-]\s*(\d+)\s*$/.exec(r.actual || ''); if (m) { BASE.all.n++; BASE.all.home += +m[1] > +m[2] ? 1 : 0; BASE.all.over += +m[1] + +m[2] >= 3 ? 1 : 0; } }
    v2All.n++; v2All.outcome += r.outcomeHit; v2All.ou += r.ouHit; v2All.btts += r.bttsHit; v2All.brier += r.brier ?? 0;
  }
  for (const r of legacy.shadow) {
    const [h, a] = r.final.split('–').map(Number);
    add(oldV2, grade(toPred(r.v2), { h, a }));
    add(oldV3, grade(toPred(r.v3), { h, a }));
  }
  const MKT = blankMarket();
  // v5 shadow test: v5 against v4 on the same games (and Forebet where it has the game too), by hit rate, RPS and log loss.
  const sc5 = () => ({ n: 0, outcome: 0, ou: 0, btts: 0, rps: 0, ll: 0 }), V5T = { all: { v4: sc5(), v5: sc5() }, fb: { v4: sc5(), v5: sc5(), fb: sc5() } };
  // v6 score card: against v4 on the same games, on the winner (RPS, log loss) and on Over 2.5 and both-score (log loss), with the
  // base rates of those games as the do-nothing line.
  const sc6 = () => ({ n: 0, outcome: 0, ou: 0, btts: 0, rps: 0, ll: 0, llO: 0, llB: 0 }), V6T = { v4: sc6(), v6: sc6(), nOver: 0, nBtts: 0 };
  const lb = (p, y) => -Math.log(Math.max(1e-6, y ? p : 1 - p));
  const add6 = (t, m, g, f) => { const r = f.h > f.a ? 0 : f.h === f.a ? 1 : 2, s = scoreOne(m.p, r); t.n++; t.outcome += g.outcomeHit; t.ou += g.ouHit; t.btts += g.bttsHit; t.rps += s.rps; t.ll += s.ll; t.llO += lb(m.over / 100, f.h + f.a >= 3); t.llB += lb(m.btts / 100, f.h > 0 && f.a > 0); };
  const add5 = (t, p, g, r) => { const s = scoreOne(p, r); t.n++; t.outcome += g.outcomeHit; t.ou += g.ouHit; t.btts += g.bttsHit; t.rps += s.rps; t.ll += s.ll; };
  for (const k of list.keys) {
    const day = await env.HUB.get(k.name, 'json');
    for (const c of day?.cards || []) {
      if (!c.grade || day.date <= LEGACY_THROUGH || !isCounted(c.league, day.date)) continue;
      addMarket(MKT, c); // model vs market: every counted game with a price, v4-only cup games included
      // v4 on a newly promoted club (starting rating) is its own line: it stays out of every v4 total below.
      const promo = !!(c.v4 && c.v4.promo), g4 = promo ? null : c.grade.v4;
      if (promo && c.grade.v4 && c.grade.v2) { add(promoV2, c.grade.v2); add(promoV4, c.grade.v4); }
      if (c.fb && c.final) { // Forebet (entered by hand) on the same games, next to v2 and v4
        const f = fbGrade(c.fb, c.final);
        if (f.outcomeHit != null) { fbT.n++; fbT.outcome += f.outcomeHit; fbT.score += f.scoreHit; fbT.brier += f.brier; }
        if (f.ouHit != null) { fbT.nOu++; fbT.ou += f.ouHit; }
        if (f.bttsHit != null) { fbT.nBtts++; fbT.btts += f.bttsHit; }
        if (c.grade.v2 && g4) {
          const g2 = c.grade.v2;
          if (f.outcomeHit != null) { BASE.same.home += c.final.h > c.final.a ? 1 : 0; const o = SB.outcome, b = SB.brier; o.n++; o.v2 += g2.outcomeHit; o.v4 += g4.outcomeHit; o.fb += f.outcomeHit; b.n++; b.v2 += g2.brier; b.v4 += g4.brier; b.fb += f.brier; }
          if (f.ouHit != null) { BASE.same.over += c.final.h + c.final.a >= 3 ? 1 : 0; { const us = usualOverSide(c.league); if (us) { BASE.same.un++; BASE.same.uh += (c.final.h + c.final.a >= 3) === (us === 'over') ? 1 : 0; } } const o = SB.ou; o.n++; o.v2 += g2.ouHit; o.v4 += g4.ouHit; o.fb += f.ouHit; }
          if (f.bttsHit != null) { const o = SB.btts; o.n++; o.v2 += g2.bttsHit; o.v4 += g4.bttsHit; o.fb += f.bttsHit; }
        }
        for (const [k, g] of [['v2', c.grade.v2], ['v4', g4]]) if (g) {
          const x = fbVs[k];
          if (f.outcomeHit != null) { x.n++; x.fbOutcome += f.outcomeHit; x.fbBrier += f.brier; x.outcome += g.outcomeHit; x.brier += g.brier; }
          if (f.ouHit != null) { x.nOu++; x.fbOu += f.ouHit; x.ou += g.ouHit; }
          if (f.bttsHit != null) { x.nBtts++; x.fbBtts += f.bttsHit; x.btts += g.bttsHit; }
        }
      }
      if (g4 && c.grade.v5 && c.v5 && c.final) {
        const r = c.final.h > c.final.a ? 0 : c.final.h === c.final.a ? 1 : 2;
        add5(V5T.all.v4, c.v4.p, g4, r); add5(V5T.all.v5, c.v5.p, c.grade.v5, r);
        const f = c.fb && c.fb.p ? fbGrade(c.fb, c.final) : null;
        if (f && f.outcomeHit != null && f.ouHit != null && f.bttsHit != null) { add5(V5T.fb.v4, c.v4.p, g4, r); add5(V5T.fb.v5, c.v5.p, c.grade.v5, r); add5(V5T.fb.fb, c.fb.p, f, r); }
      }
      if (g4 && c.grade.v6 && c.v6 && c.final) { add6(V6T.v4, c.v4, g4, c.final); add6(V6T.v6, c.v6, c.grade.v6, c.final); V6T.nOver += c.final.h + c.final.a >= 3 ? 1 : 0; V6T.nBtts += c.final.h > 0 && c.final.a > 0 ? 1 : 0; }
      if (g4) add(v4All, g4); // every game v4 predicted, including cup games v2 cannot cover
      if (g4 && c.v4 && c.v4.p) cal(c.v4.p, g4.outcomeHit); // winner calibration is v4's (the official model)
      if (!c.grade.v2) continue;
      add(v2All, c.grade.v2);
      const us = c.final ? usualOverSide(c.league) : null; if (us) { BASE.all.un++; BASE.all.uh += (c.final.h + c.final.a >= 3) === (us === 'over') ? 1 : 0; }
      if (c.final) { BASE.all.n++; BASE.all.home += c.final.h > c.final.a ? 1 : 0; BASE.all.over += c.final.h + c.final.a >= 3 ? 1 : 0; }
      if (g4) { add(h2hV2, c.grade.v2); add(h2hV4, g4); }
      if (c.grade.v3) { add(oldV2, c.grade.v2); add(oldV3, c.grade.v3); }
      if (c.final) {
        const gs = c.final.h + c.final.a, bs = c.final.h > 0 && c.final.a > 0, r = lgRow(c);
        r.n++; add(r.v2, c.grade.v2); if (g4) add(r.v4, g4); if (c.grade.v5) add(r.v5, c.grade.v5);
        if (c.fb) { const f = fbGrade(c.fb, c.final); if (f.outcomeHit != null) { r.fb.n++; r.fb.outcome += f.outcomeHit; r.fb.brier += f.brier; } if (f.ouHit != null) r.fb.ou += f.ouHit; if (f.bttsHit != null) r.fb.btts += f.bttsHit; }
        addStrats(TB, c, day.date, leanHit);
        calAdd('over', 'v2', c.v2.over, gs >= 3); calAdd('btts', 'v2', c.v2.btts, bs);
        if (c.v4 && !promo) { calAdd('over', 'v4', c.v4.over, gs >= 3); calAdd('btts', 'v4', c.v4.btts, bs); }
        if (c.fb) { calAdd('over', 'fb', c.fb.over, gs >= 3); calAdd('btts', 'fb', c.fb.btts, bs); }
      }
      if (c.mine && c.final) { mineT.n++; mineT.model += c.grade.v2.outcomeHit ? 1 : 0; mineT.mine += c.mine === (c.final.h > c.final.a ? 'H' : c.final.h === c.final.a ? 'D' : 'A') ? 1 : 0; }
      if (c.lean && c.final) {
        const L = c.lean; LB.n++; LB.hits += L.hit ? 1 : 0; lbAdd(LB.byKind, L.k, L.hit, L.key); lbAdd(LB.byKey, L.key, L.hit);
        if (L.k === 'best' || L.k === 'lean') lbAdd(LB.byBack, `${L.y} of ${L.a}`, L.hit, L.key);
        LB.base.home += c.final.h > c.final.a ? 1 : 0; LB.base.draw += c.final.h === c.final.a ? 1 : 0; LB.base.away += c.final.h < c.final.a ? 1 : 0; LB.base.over += c.final.h + c.final.a >= 3 ? 1 : 0; LB.base.btts += c.final.h > 0 && c.final.a > 0 ? 1 : 0;
        if (L.price != null) { const P = LB.pl || (LB.pl = { n: 0, won: 0, byKind: {}, byVerdict: {}, byCombo: {}, byBand: {} }), u = unitsWon(L.price, L.hit), add = (o, k) => { const x = o[k] || (o[k] = { n: 0, hits: 0, won: 0 }); x.n++; x.hits += L.hit ? 1 : 0; x.won += u; }; P.n++; P.won += u; add(P.byKind, L.k); add(P.byBand, bandOf(L.price)); if (L.vd) { add(P.byVerdict, L.vd); add(P.byCombo, `${L.k}|${L.vd}`); } }
        LB.recent.push({ date: day.date, kickoff: c.kickoff, home: c.home, away: c.away, leagueName: c.leagueName, final: c.final, k: L.k, key: L.key, p: L.p, y: L.y, a: L.a, hit: !!L.hit });
      }
      live.push({ date: day.date, ...c });
    }
  }
  live.sort((a, b) => (b.kickoff || '').localeCompare(a.kickoff || ''));
  // How top picks did over the 30 most recently graded games: winner at 55%+, goals markets at 60%+, and every other winner pick.
  for (const c of live.slice(0, 30)) {
    last30.n++;
    const hit = (x, o) => { x.n++; x.w += o.outcomeHit ? 1 : 0; x.ou += o.ouHit ? 1 : 0; x.bt += o.bttsHit ? 1 : 0; };
    if (c.grade.v2) hit(last30.v2, c.grade.v2);
    if (c.grade.v4 && !(c.v4 && c.v4.promo)) hit(last30.v4, c.grade.v4);
    if (c.grade.v5) hit(last30.v5, c.grade.v5);
    if (c.fb && c.final) { const f = fbGrade(c.fb, c.final); if (f.outcomeHit != null) { last30.fb.n++; last30.fb.w += f.outcomeHit ? 1 : 0; last30.fb.ou += f.ouHit ? 1 : 0; last30.fb.bt += f.bttsHit ? 1 : 0; } }
    // Top picks rank on v4 (the official model), or v2 for a game v4 had no numbers for: winner at 55%+, goals at 60%+ (public/index.html lead()).
    const ln = c.v4 && c.v4.p && c.grade.v4 ? 'v4' : c.v2 && c.v2.p && c.grade.v2 ? 'v2' : null;
    if (!c.final || !ln) continue;
    const q = c[ln], t = topT[Math.max(...q.p) >= 55 ? 'win' : 'rest']; t.n++; t.hits += c.grade[ln].outcomeHit ? 1 : 0;
    const gs = c.final.h + c.final.a, bs = c.final.h > 0 && c.final.a > 0, ov = q.over, bt = q.btts;
    if (ov != null && bt != null) for (const [pp, hit] of [[ov, gs >= 3], [100 - ov, gs < 3], [bt, bs], [100 - bt, !bs]]) if (pp >= 60) { topT.goals.n++; topT.goals.hits += hit ? 1 : 0; }
  }
  // Model vs SportsMole: the Hub's 141 tracked matches + everything graded here since.
  const smT = { n: 0, model: { outcome: 0, ou: 0, btts: 0 }, sm: { outcome: 0, ou: 0, btts: 0, score: 0 } };
  for (const r of legacySm) {
    smT.n++;
    smT.model.outcome += r.modelHit === true; smT.model.ou += r.modelOuHit === true; smT.model.btts += r.modelBttsHit === true;
    smT.sm.outcome += r.sportsmoleOutcomeHit === true; smT.sm.ou += r.smOuHit === true; smT.sm.btts += r.smBttsHit === true; smT.sm.score += r.sportsmoleScoreHit === true;
  }
  // The Hub's side is the card's own model: v4, or v2 on a game v4 had no numbers for (and on the old Hub's games above).
  const smModel = c => (c.v4 && c.v4.p && c.grade.v4 ? ['v4', c.grade.v4] : ['v2', c.grade.v2]);
  const smLive = live.filter(c => c.sm && c.smGrade);
  for (const c of smLive) {
    smT.n++;
    const [, g] = smModel(c);
    smT.model.outcome += g.outcomeHit; smT.model.ou += g.ouHit; smT.model.btts += g.bttsHit;
    smT.sm.outcome += c.smGrade.outcomeHit; smT.sm.ou += c.smGrade.ouHit; smT.sm.btts += c.smGrade.bttsHit; smT.sm.score += c.smGrade.scoreHit;
  }
  const avg = (x, n) => (n ? +(x / n).toFixed(3) : null);
  const mAll = x => ({ outcome: [x.outcome, x.n], ou: [x.ou, x.n], btts: [x.btts, x.n], brier: x.brier });
  const board = {
    same: { n: SB.outcome.n, base: { home: [BASE.same.home, SB.outcome.n], over: [BASE.same.over, SB.ou.n], usual: [BASE.same.uh, BASE.same.un] }, models: Object.fromEntries(['v2', 'v4', 'fb'].map(m => [m, {
      outcome: [SB.outcome[m], SB.outcome.n], ou: [SB.ou[m], SB.ou.n], btts: [SB.btts[m], SB.btts.n], brier: avg(SB.brier[m], SB.brier.n) }])) },
    all: { base: { home: [BASE.all.home, BASE.all.n], over: [BASE.all.over, BASE.all.n], usual: [BASE.all.uh, BASE.all.un] }, models: { v2: mAll(fin(v2All)), v4: mAll(fin(v4All)), fb: { outcome: [fbT.outcome, fbT.n], ou: [fbT.ou, fbT.nOu], btts: [fbT.btts, fbT.nBtts], brier: avg(fbT.brier, fbT.n) } } },
  };
  const sc = x => ({ n: x.n, outcome: x.outcome, ou: x.ou, btts: x.btts, brier: x.n ? +(x.brier / x.n).toFixed(3) : null });
  const leagues = [...perLg.values()].sort((a, b) => b.n - a.n).map(r => ({ slug: r.slug, name: r.name, n: r.n, v2: sc(r.v2), v4: sc(r.v4), v5: sc(r.v5), fb: sc(r.fb) }));
  const fin5 = t => ({ n: t.n, outcome: t.outcome, ou: t.ou, btts: t.btts, rps: t.n ? +(t.rps / t.n).toFixed(4) : null, ll: t.n ? +(t.ll / t.n).toFixed(4) : null });
  const fin6 = t => ({ n: t.n, outcome: t.outcome, ou: t.ou, btts: t.btts, ...Object.fromEntries(['rps', 'll', 'llO', 'llB'].map(k => [k, t.n ? +(t[k] / t.n).toFixed(4) : null])) });
  const n6 = V6T.v6.n, ent = (k, n) => { if (!n || k === 0 || k === n) return null; const q = k / n; return +(-(q * Math.log(q) + (1 - q) * Math.log(1 - q))).toFixed(4); };
  const v6test = { v4: fin6(V6T.v4), v6: fin6(V6T.v6), base: { over: n6 ? +(V6T.nOver / n6).toFixed(3) : null, btts: n6 ? +(V6T.nBtts / n6).toFixed(3) : null, llO: ent(V6T.nOver, n6), llB: ent(V6T.nBtts, n6) } };
  const v5test = { all: { v4: fin5(V5T.all.v4), v5: fin5(V5T.all.v5) }, fb: { v4: fin5(V5T.fb.v4), v5: fin5(V5T.fb.v5), fb: fin5(V5T.fb.fb) } };
  const calGoals = Object.fromEntries(Object.entries(calG).map(([m, o]) => [m, Object.fromEntries(Object.entries(o).map(([k, bs]) => [k, bs.map(b => ({ label: b.label, n: b.n, hits: b.hits, avg: b.n ? +(b.sum / b.n).toFixed(1) : null }))]))]));
  return {
    board, last30, top: topT, tracked: TB, market: finishMarket(MKT), v5test, v6test, leans: { ...LB, recent: LB.recent.sort((a, b) => (b.kickoff || '').localeCompare(a.kickoff || '')).slice(0, 40) }, leagues, calGoals,
    smCompare: {
      ...smT, importedMatches: legacySm.length, newMatches: smLive.length,
      recent: smLive.slice(0, 100).map(c => { const [m, g] = smModel(c); return { date: c.date, home: c.home, away: c.away, final: c.final, model: m, modelPick: c[m].pick, modelP: c[m].p, sm: c.sm.text, hit: g, smHit: c.smGrade }; }),
      earlier: legacySm.slice().reverse(),
    },
    v2: fin(v2All),
    forebet: { ...fbT, brier: fbT.n ? +(fbT.brier / fbT.n).toFixed(3) : null, any: fbT.n + fbT.nOu + fbT.nBtts, vs: Object.fromEntries(Object.entries(fbVs).map(([k, x]) => [k, { ...x, fbBrier: x.n ? +(x.fbBrier / x.n).toFixed(3) : null, brier: x.n ? +(x.brier / x.n).toFixed(3) : null }])) },
    calibration: CAL.map(b => ({ label: b.label, lo: b.lo, hi: b.hi, n: b.n, hits: b.hits, avg: b.n ? +(b.sum / b.n).toFixed(1) : null })), // v4's winner picks
    mine: mineT,
    h2h: { v2: fin(h2hV2), v4: fin(h2hV4) },
    v4: fin(v4All),
    promo: { v2: fin(promoV2), v4: fin(promoV4) }, // v4 starting-rating games (newly promoted clubs), with v2 on the same games
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

    // Sign in once: a correct password sets a cookie that lasts a year, so the installed app and the browser open straight in.
    if (p === '/login' && req.method === 'POST') {
      let f; try { f = await req.formData(); } catch (e) { f = null; }
      const pw = f ? String(f.get('password') || '') : '', next = safeNext(f && String(f.get('next') || ''));
      if (!env.ADMIN_TOKEN || !same(pw, env.ADMIN_TOKEN)) return new Response(null, { status: 303, headers: { location: '/login?e=1' + (next !== '/' ? '&next=' + encodeURIComponent(next) : ''), 'cache-control': 'no-store' } });
      return new Response(null, { status: 303, headers: { location: next, 'set-cookie': `${COOKIE}=${await sessionValue(env)}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`, 'cache-control': 'no-store' } });
    }
    if (p === '/logout') return new Response(null, { status: 303, headers: { location: '/login', 'set-cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`, 'cache-control': 'no-store' } });
    if (req.method === 'GET' && (p === '/login' || PUBLIC_FILES.has(p))) return env.ASSETS.fetch(req); // /login is public/login.html (the assets handler serves it without the .html)

    // Whole site is private: page and data both need the password.
    if (!(await authed(req, env))) {
      if (p.startsWith('/api/')) return json({ error: 'Bad or missing admin token' }, 401);
      if (req.method === 'GET') return new Response(null, { status: 302, headers: { location: '/login' + (p !== '/' ? '?next=' + encodeURIComponent(p + url.search) : ''), 'cache-control': 'no-store' } });
      return new Response('Sign in to open Game Day Hub.', { status: 401, headers: { 'cache-control': 'no-store' } });
    }

    if (p.startsWith('/api/push/')) { // alerts to the installed app: which devices, and a test message
      try {
        if (req.method === 'GET' && p === '/api/push/key') return json({ key: (await getVapid(env, url.origin)).pub, devices: (await getPush(env)).subs.length });
        if (req.method !== 'POST') return json({ error: 'Not found' }, 404);
        const b = await req.json().catch(() => ({}));
        if (p === '/api/push/subscribe') return json(await addSub(env, b.sub, b.label));
        if (p === '/api/push/unsubscribe') return json(await removeSub(env, String(b.endpoint || '')));
        if (p === '/api/push/test') return json({ ok: true, ...(await sendAll(env, { title: 'Game Day Hub', body: 'Notifications are on for this device.', tag: 'test', url: '/' })) });
      } catch (e) { return json({ error: e && e.message ? e.message : String(e) }, 500); }
      return json({ error: 'Not found' }, 404);
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
    if (p === '/api/brew') { // newsletter summaries: public/brew.json is rewritten daily by a scheduled task
      try { const r = await env.ASSETS.fetch(new Request(new URL('/brew.json', url.origin))); const j = r.ok ? await r.json() : null; return json({ updated: j && j.updated || null, issues: Array.isArray(j && j.issues) ? j.issues : [] }); } catch (e) { return json({ updated: null, issues: [] }); }
    }
    if (p === '/api/candidates') return json(await candidates(q('date') || today(), env));
    if (p === '/api/odds-raw') { try { const lg = leagueBySlug(String(url.searchParams.get('league') || '')); if (!lg) return json({ error: 'Unknown league' }, 400); return json({ league: lg.slug, games: await rawOdds(lg.slug, String(url.searchParams.get('date') || '')) }); } catch (e) { return json({ error: String(e && e.message || e) }, 500); } }
    if (req.method === 'POST' && p === '/api/btts') { try { const b = await req.json(); return json(await refreshBtts(env, String(b.date || ''), String(b.league || ''), new Date())); } catch (e) { return json({ error: `Both score prices: ${e && e.message || e}` }, 500); } }
    if (req.method === 'POST' && p === '/api/odds') { try { const b = await req.json(); return json(await refreshOdds(env, String(b.date || ''), String(b.league || ''), new Date())); } catch (e) { return json({ error: `Prices: ${e && e.message || e}` }, 500); } }
    if (req.method === 'POST' && p === '/api/assign') { try { const b = await req.json(); const lg = leagueBySlug(String(b.league || '')); if (!lg) return json({ error: 'Unknown league' }, 400); return json({ ok: true, ...(await assignCandidate(String(b.date || ''), lg.slug, String(b.id || ''), String(b.key || ''), env, new Date(), { dismiss: !!b.dismiss })) }); } catch (e) { return json({ error: `Assign: ${e && e.message ? e.message : e}` }, 500); } }
    if (p.startsWith('/api/bets')) { // bet analyzer and tracker
      try {
        if (req.method === 'GET' && p === '/api/bets') return json(await listBets(env));
        if (req.method !== 'POST') return json({ error: 'Not found' }, 404);
        const b = await req.json();
        if (p === '/api/bets/analyze') return json(analyzeBet(await betCards(env, Array.isArray(b.legs) ? b.legs : []), b.legs));
        if (p === '/api/bets') return json(await addBet(env, b.legs, new Date(), b.source === 'model' ? 'model' : null));
        if (p === '/api/bets/delete' || p === '/api/bets/void') return json(await changeBet(env, String(b.id || ''), p.endsWith('delete') ? 'delete' : 'void'));
      } catch (e) { return json({ error: `Bets: ${e && e.message ? e.message : e}` }, 500); }
      return json({ error: 'Not found' }, 404);
    }
    if (p === '/api/nhl/day') { const date = q('date') || today(); return json((await env.HUB.get(`nhl:day:${date}`, 'json')) || { date, cards: [] }); }
    if (p === '/api/nhl/days') { // every saved hockey day, for the Export button
      const out = []; let cursor;
      do { const r = await env.HUB.list({ prefix: 'nhl:day:', cursor }); out.push(...r.keys.map(k => k.name.slice(8))); cursor = r.list_complete === false ? r.cursor : null; } while (cursor);
      return json({ days: out.sort() });
    }
    if (p === '/api/nhl/export') { // one request returns the whole hockey backup as a file download
      const names = []; let cursor;
      do { const r = await env.HUB.list({ prefix: 'nhl:day:', cursor }); names.push(...r.keys.map(k => k.name)); cursor = r.list_complete === false ? r.cursor : null; } while (cursor);
      names.sort(); const days = await Promise.all(names.map(n => env.HUB.get(n, 'json')));
      const data = { exportedAt: new Date().toISOString(), note: 'Game Day Hub hockey backup. days = every saved NHL day (cards with model picks and results); totals = hockey results summary.', days: days.filter(Boolean), totals: await nhlTally(env) };
      return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json', 'content-disposition': `attachment; filename="gameday-hub-hockey-${new Date().toISOString().slice(0, 10)}.json"`, 'cache-control': 'no-store' } });
    }
    if (p === '/api/nhl/tally') return json(await nhlTally(env));
    if (req.method === 'POST' && p === '/api/nhl/line') { try { const b = await req.json(); return json(await nhlSetLine(env, String(b.date || ''), String(b.id || ''), b.line, new Date())); } catch (e) { return json({ error: `Line: ${e && e.message ? e.message : e}` }, 500); } }
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
      const nowMs = Date.now(), per = {}, games = {};
      for (const [di, d] of [today(), addDays(today(), 1)].entries()) {
        const dd = await env.HUB.get(`day:${d}`, 'json');
        for (const c of dd?.cards || []) {
          (games[c.league] || (games[c.league] = [0, 0]))[di]++; // games on the board today / tomorrow, whatever their state
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
        return { games: { today: (games[l.slug] || [0, 0])[0], tomorrow: (games[l.slug] || [0, 0])[1] }, sm: { tried: o.tried ? new Date(o.tried).toISOString() : null, found: o.sm, total: o.n }, fb: FB_PAGES[l.slug] ? fb : null };
      };
      return json({
        now: Date.now(), forebet: { pages: Object.keys(FB_PAGES), reads: fbMeta || {} }, writes: { used: (w && w.d === d ? w.n : 0) + await pendingWrites(d), limit: WRITE_LIMIT, resetsAtUtc: d + 'T24:00Z' },
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
    ctx.waitUntil((async () => {
      try { await runSlot(c.env); }
      finally {
        try { await oddsStep(c.env); } catch (e) { /* prices are a bonus; never allowed to break the background job */ }
        // Alerts for games about to start. Never allowed to break the background job.
        try { const now = new Date(), a = localDate(now.toISOString()), b = localDate(new Date(now.getTime() + 45 * 60000).toISOString()); await pushStep(c.env, now.getTime(), a === b ? [a] : [a, b]); } catch (e) { /* retried in 5 minutes */ }
        await c.flush();
      }
    })());
  },
};
export default hub;
