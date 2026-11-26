// Nightly stats files for the sweep (a scheduled task that only reads). Just after midnight Central the background job saves three
// small files to a SEPARATE private GitHub repo (the var SWEEP_REPO, "owner/name"), using the Worker secret SWEEP_GH_TOKEN (a
// fine-grained token limited to that repo, Contents: read and write). The sweep reads them from GitHub, so it no longer depends on the
// health link being approved in the middle of the night.
//   soccer.json  { exportedAt, part, totals (the Results summary, long game lists dropped), gaps }
//   nhl.json     { exportedAt, part, totals, gaps }
//   health.json  { exportedAt, part, health (the same object as GET /api/health) }
// One file per cron run (00:10, 00:15, 00:20 Central), then one more try at each (00:25, 00:30, 00:35) that does nothing when the
// first try worked. The Hub only reads here: no KV writes, no Odds API credits. Without the secret or the var this does nothing.
// The token can only reach the data repo, never the Hub's own code.
import { HOUR, koOf, tracked, closed, noResult, noSoccerPrice, noForebet, noHockeyPrice, noGoalie, noLine } from './gaps.js';

const TZ = 'America/Chicago';
export const PARTS = ['soccer', 'nhl', 'health'];
export const START_MIN = 10, END_MIN = 40; // the window, minutes after midnight Central
export const FRESH_MIN = 30;               // a file saved this recently is left alone
export const STUCK_H = 48;                 // a game this long past kickoff with no result is named as stuck

// Which file this run should save, or null. The cron fires every 5 minutes, so each 5-minute step of the window is one file.
export function partDue(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(now)).map(x => [x.type, x.value]));
  const min = Number(p.hour) * 60 + Number(p.minute);
  if (!(min >= START_MIN && min < END_MIN)) return null;
  return PARTS[Math.floor((min - START_MIN) / 5) % PARTS.length];
}

// days: { date: [cards] }. Per day: how many cards (with a model pick, not skipped) are missing each source, and how many are past the
// grace time with no result. stuck: games STUCK_H+ hours past kickoff with no result, named. Soccer prices are counted over the priced
// leagues only; hockey adds the goalie read and the DraftKings line.
export function dayGaps(days, now, { sport = 'soccer', priced = null, graceH = sport === 'nhl' ? 5 : 6 } = {}) {
  const out = [], stuck = [];
  for (const date of Object.keys(days || {}).sort()) {
    const cards = (days[date] || []).filter(tracked);
    const row = { date, cards: cards.length, noForebet: 0, pricedCards: 0, noPrice: 0, ungraded: 0 };
    if (sport === 'nhl') { row.noGoalie = 0; row.noLine = 0; }
    for (const c of cards) {
      if (noForebet(c)) row.noForebet++;
      if (sport === 'nhl') { row.pricedCards++; if (noHockeyPrice(c)) row.noPrice++; if (noGoalie(c)) row.noGoalie++; if (noLine(c)) row.noLine++; }
      else if (!priced || priced.has(c.league)) { row.pricedCards++; if (noSoccerPrice(c)) row.noPrice++; }
      const ko = koOf(c); if (!Number.isFinite(ko) || closed(c)) continue; // void: closed on purpose (postponed...), not stuck
      if (noResult(c, now, graceH)) row.ungraded++;
      if (now - ko >= STUCK_H * HOUR) stuck.push({ date, game: `${c.home} v ${c.away}`, league: c.league || 'nhl', hoursPast: Math.round((now - ko) / HOUR) });
    }
    out.push(row);
  }
  return { days: out, stuck };
}

// The Results summary without its long game lists (the sweep reads records, not games). The headline picks' recent list stays: the
// 7-day hit rate is read from it.
export function trimTotals(t) {
  const { recent, earlier, ...rest } = t || {};
  if (rest.smCompare) { const { recent: r, earlier: e, ...sm } = rest.smCompare; rest.smCompare = sm; }
  return rest;
}

// deps: { soccerTotals, nhlTotals, soccerDays, nhlDays, health, priced } - the Hub's own reads, handed in by src/worker.js.
export async function buildPart(part, deps, now = Date.now()) {
  const exportedAt = new Date(now).toISOString();
  if (part === 'health') return { exportedAt, part, health: await deps.health() };
  if (part === 'nhl') { const [totals, days] = await Promise.all([deps.nhlTotals(), deps.nhlDays()]); return { exportedAt, part, totals: trimTotals(totals), gaps: dayGaps(days, now, { sport: 'nhl' }) }; }
  const [totals, days] = await Promise.all([deps.soccerTotals(), deps.soccerDays()]);
  return { exportedAt, part, totals: trimTotals(totals), gaps: dayGaps(days, now, { priced: deps.priced }) };
}

const toB64 = s => { const b = new TextEncoder().encode(s); let bin = ''; for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(bin); };
const fromB64 = s => new TextDecoder().decode(Uint8Array.from(atob(String(s).replace(/\s/g, '')), ch => ch.charCodeAt(0)));

const ghHeaders = token => ({ authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'gameday-hub', 'content-type': 'application/json' });
const ghUrl = (repo, path) => `https://api.github.com/repos/${repo}/contents/${path}`;

// What the data repo holds for one file now: { sha, fresh } (fresh = saved in the last FRESH_MIN minutes), { sha: null } when there is
// no file yet, or { status } when GitHub refused the read.
export async function fileState({ repo, path, token, now = Date.now() }, f = fetch) {
  const cur = await f(ghUrl(repo, path), { headers: ghHeaders(token) });
  if (cur.status === 404) return { sha: null, fresh: false };
  if (!cur.ok) return { status: cur.status };
  const j = await cur.json(); let fresh = false;
  try { const at = Date.parse(JSON.parse(fromB64(j.content)).exportedAt); fresh = Number.isFinite(at) && now - at < FRESH_MIN * 60000; } catch (e) { /* unreadable: replace it */ }
  return { sha: j.sha || null, fresh };
}

// Save one JSON file to the data repo (GitHub contents API): read the current file for its sha, leave it alone when it was saved in the
// last FRESH_MIN minutes, else create or replace it. Never throws on a refusal: { saved: false, status }. state: a fileState() answer
// already in hand (the cron step reads it first, so a fresh file costs no build).
export async function putFile({ repo, path, token, obj, now = Date.now(), state = null }, f = fetch) {
  const st = state || await fileState({ repo, path, token, now }, f);
  if (st.status) return { saved: false, status: st.status };
  if (st.fresh) return { saved: false, fresh: true };
  const body = { message: `Sweep data ${new Date(now).toISOString().slice(0, 10)} ${path}`, content: toB64(JSON.stringify(obj)), ...(st.sha ? { sha: st.sha } : {}) };
  const r = await f(ghUrl(repo, path), { method: 'PUT', headers: ghHeaders(token), body: JSON.stringify(body) });
  return r.ok ? { saved: true } : { saved: false, status: r.status };
}

// One cron run: null when nothing is due, the secret / repo name is missing, or the file is already fresh (the second try after a good
// first one: nothing is built and the rotating job keeps its turn); else what happened. Never throws.
export async function sweepStep(env, deps, now = new Date(), f = fetch) {
  if (!env.SWEEP_GH_TOKEN || !env.SWEEP_REPO) return null;
  const part = partDue(now); if (!part) return null;
  const at = new Date(now).getTime(), file = { repo: env.SWEEP_REPO, path: `${part}.json`, token: env.SWEEP_GH_TOKEN, now: at };
  let out;
  try {
    const state = await fileState(file, f);
    if (state.fresh) return null;
    if (state.status) out = { job: 'sweepdata', part, saved: false, status: state.status };
    else out = { job: 'sweepdata', part, built: true, ...(await putFile({ ...file, obj: await buildPart(part, deps, at), state }, f)) };
  } catch (e) { out = { job: 'sweepdata', part, saved: false, error: String(e && e.message || e).slice(0, 160) }; }
  await noteLast(env, part, out, at);
  return out;
}

// The last answer per file, so a missing file can be explained: kept in one small KV record (SWEEP_LAST) and shown by the health report (sweepStatus). Written only when the answer for that file
// changed or the kept one is over LAST_REFRESH_H hours old, so at most about 3 writes a night. Never throws.
export const SWEEP_LAST = 'sweep:last';
const LAST_REFRESH_H = 6;
const outcome = r => ({ saved: !!r.saved, ...(r.status ? { status: r.status } : {}), ...(r.error ? { error: r.error } : {}) });
async function noteLast(env, part, r, at) {
  try {
    const cur = (await env.HUB.get(SWEEP_LAST, 'json')) || {}, prev = cur[part], o = outcome(r);
    if (prev && JSON.stringify(outcome(prev)) === JSON.stringify(o) && at - Date.parse(prev.at) < LAST_REFRESH_H * HOUR) return;
    await env.HUB.put(SWEEP_LAST, JSON.stringify({ ...cur, [part]: { at: new Date(at).toISOString(), ...o } }));
  } catch (e) { /* a note only: never allowed to break the step */ }
}
// For the health report: is the step set up, and what happened last time per file. Reads only.
export async function sweepStatus(env) {
  let last = null; try { last = await env.HUB.get(SWEEP_LAST, 'json'); } catch (e) { /* unknown */ }
  return { token: !!env.SWEEP_GH_TOKEN, repo: env.SWEEP_REPO || null, last };
}
