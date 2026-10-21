// NHL section: separate from soccer (own storage keys, own page, own model code).
//   v2  = Poisson goals model (official).      v4 = shadow: Elo + xG-rate blend (tracked only).
//   Forebet = recorded and graded only. No model reads market odds. The one market number kept is the sportsbook's Over/Under
//   total (ESPN's odds block, DraftKings): it is only the line that Over/Under is rated and graded against, and it never changes
//   what the model expects. Until a line is known a game uses 5.5.
// Storage: nhl:state (ratings, one write per batch of finished games), nhl:day:<date> (cards), nhl:fbmeta.
import SEED from './nhlseed.js';
import { fbHeaders, FB_HV } from './forebetpage.js';

const TZ = 'America/Chicago';
export const LINE = 5.5;
export const GOALIE_W = 0; // season goalie ratings did not help in the 3-season backtest, so they are stored but not used
const HOME = 1.05, N0 = 25, HOUR = 3600000;
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard';
const FB_URL = 'https://www.forebet.com/en/hockey/usa/nhl';

const ALIAS = { TB: 'TBL', NJ: 'NJD', SJ: 'SJS', LA: 'LAK', UTAH: 'UTA', UHC: 'UTA', WAS: 'WSH', MON: 'MTL' };
export const code = a => ALIAS[a] || a;
export const localDate = iso => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(iso));
const localTime = iso => new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
const addDays = (d, n) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
const round = x => Math.round(x * 100);

// ---- model -------------------------------------------------------------------------------------
function pois(l, n = 16) { const p = [Math.exp(-l)]; for (let k = 1; k < n; k++) p.push(p[k - 1] * l / k); return p; }
// P(home wins incl. overtime / shootout; a regulation tie is split 50/50), and for a total-goals line: P(over), P(exactly on the line)
// (only a whole-number line can push) and P(under). At 5.5 over means 6 or more goals.
export function probs(lh, la, line = LINE) {
  const ph = pois(lh), pa = pois(la); let win = 0, tie = 0, over = 0, push = 0;
  for (let i = 0; i < ph.length; i++) for (let j = 0; j < pa.length; j++) {
    const x = ph[i] * pa[j];
    if (i > j) win += x; else if (i === j) tie += x;
    if (i + j > line) over += x; else if (i + j === line) push += x;
  }
  return { home: win + tie * 0.5, over, push, under: 1 - over - push };
}
// The single likeliest final score. A hockey game cannot end level, so a tied regulation score goes to overtime or a shootout and its
// chance is split 50/50 between the one-goal wins (the same 50/50 the winner chance uses). Returns { h, a, p } with p in percent.
export function topScore(lh, la, n = 16) {
  const ph = pois(lh, n), pa = pois(la, n), m = {}, add = (i, j, x) => { const k = i + ',' + j; m[k] = (m[k] || 0) + x; };
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const x = ph[i] * pa[j]; if (i === j) { add(i + 1, j, x / 2); add(i, j + 1, x / 2); } else add(i, j, x); }
  let best = null; for (const [k, x] of Object.entries(m)) if (!best || x > best.x) best = { k, x };
  const [h, a] = best.k.split(',').map(Number); return { h, a, p: round(best.x) };
}
// Over chance with a push taken out: the chance of Over among games that do not land exactly on the line.
const ovr = pr => pr.over / Math.max(1e-9, pr.over + pr.under);
export const freshState = () => JSON.parse(JSON.stringify({
  v: 1, through: SEED.through, ver: 0, applied: [],
  lg: { n: SEED.lg.n, g: SEED.lg.g, x: SEED.lg.x, nx: SEED.lg.n },
  plg: SEED.plg, plgx: SEED.plgx,
  teams: Object.fromEntries(Object.entries(SEED.teams).map(([t, s]) => [t, { ...s, nx: s.n }])),
}));
export function predict(S, hc, ac, line = LINE) {
  const H = S.teams[hc], A = S.teams[ac];
  if (!H || !A) return null;
  const L = S.lg.n > 20 ? S.lg.g / S.lg.n / 2 : S.plg;
  const LX = S.lg.nx > 20 ? S.lg.x / S.lg.nx / 2 : S.plgx;
  const rate = (s, key, pk, lgv, n) => { const p = lgv + (s[pk] - lgv) * 0.5; return (s[key] + N0 * p) / (n + N0); };
  const gAdj = t => GOALIE_W * (t.g || 0) * 29;
  const lh = Math.max(0.5, L * (rate(H, 'gf', 'pgf', L, H.n) / L) * (rate(A, 'ga', 'pga', L, A.n) / L) * HOME - gAdj(A));
  const la = Math.max(0.5, L * (rate(A, 'gf', 'pgf', L, A.n) / L) * (rate(H, 'ga', 'pga', L, H.n) / L) / HOME - gAdj(H));
  const p2 = probs(lh, la, line);
  const sc = L / LX;
  const xlh = Math.max(0.5, LX * (rate(H, 'xf', 'pxf', LX, H.nx) / LX) * (rate(A, 'xa', 'pxa', LX, A.nx) / LX) * HOME * sc - gAdj(A));
  const xla = Math.max(0.5, LX * (rate(A, 'xf', 'pxf', LX, A.nx) / LX) * (rate(H, 'xa', 'pxa', LX, H.nx) / LX) / HOME * sc - gAdj(H));
  const px = probs(xlh, xla, line);
  const pe = 1 / (1 + Math.pow(10, -(H.elo + 35 - A.elo) / 400));
  const w4 = 0.4 * pe + 0.3 * px.home + 0.3 * p2.home;
  const p4 = probs(0.5 * lh + 0.5 * xlh, 0.5 * la + 0.5 * xla, line);
  return { v2: { w: round(p2.home), o: round(ovr(p2)), sc: topScore(lh, la), ...(p2.push > 0.0005 ? { push: round(p2.push) } : {}) }, v4: { w: round(w4), o: round(ovr(p4)), sc: topScore(0.5 * lh + 0.5 * xlh, 0.5 * la + 0.5 * xla), ...(p4.push > 0.0005 ? { push: round(p4.push) } : {}) }, lam: [+lh.toFixed(2), +la.toFixed(2)] };
}
// A finished game moves the ratings (goals and Elo). xG is not in ESPN's feed, so xG rates stay as seeded.
export function applyGame(S, hc, ac, h, a, last) {
  const H = S.teams[hc], A = S.teams[ac];
  if (!H || !A) return false;
  const so = last === 'SO', th = so && h > a ? h - 1 : h, ta = so && a > h ? a - 1 : a; // totals leave out the shootout goal
  const pe = 1 / (1 + Math.pow(10, -(H.elo + 35 - A.elo) / 400)), hw = h > a ? 1 : 0;
  const k = 6 * (Math.log(Math.abs(h - a) + 1) + 1) * (last === 'REG' ? 1 : 0.6);
  H.elo += k * (hw - pe); A.elo -= k * (hw - pe);
  H.n++; H.gf += th; H.ga += ta; A.n++; A.gf += ta; A.ga += th;
  S.lg.n++; S.lg.g += th + ta;
  S.ver++;
  return { th, ta };
}

// ---- Forebet (hockey) --------------------------------------------------------------------------
// Forebet hockey: only its pick, the win chance of that pick and its predicted score are kept (no Over/Under).
export function parseForebetHockey(html) {
  // Hockey rows differ from the football pages: the home/away names sit in <span class="homeTeam"><span>Name</span></span>, the
  // date is plain text (mm/dd/yyyy), the two win chances are in .fprc, the pick in .forepr, the predicted score in .ex_sc.
  // Forebet serves the page with or without quotes around simple attribute values, and rows are found by their match link,
  // not by the wrapping <div>, so a change in the wrapper markup does not matter.
  const rows = [], starts = [], seen = new Set(), reA = /href=["']?\/en\/hockey\/matches\//g; let m;
  while ((m = reA.exec(html))) starts.push(m.index);
  const ent = x => x.replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").trim();
  for (let n = 0; n < starts.length; n++) {
    const chunk = html.slice(starts[n], Math.min(starts[n + 1] ?? Infinity, starts[n] + 5000));
    const hm = /class=["']?homeTeam["']?[^>]*><span[^>]*>([^<]*)<\/span>/.exec(chunk), am = /class=["']?awayTeam["']?[^>]*><span[^>]*>([^<]*)<\/span>/.exec(chunk);
    const dm = /date_bah["']?>\s*(\d\d)\/(\d\d)\/(\d{4})/.exec(chunk);
    if (!hm || !am || !dm) continue;
    const row = { home: ent(hm[1]), away: ent(am[1]), date: `${dm[3]}-${dm[1]}-${dm[2]}` };
    const key = `${row.home}|${row.away}|${row.date}`; if (seen.has(key)) continue; seen.add(key);
    const im = /class=["']?fprc[^>]*>([\s\S]*?)<\/div>/.exec(chunk), nums = im ? [...im[1].matchAll(/>\s*(\d{1,3})\s*</g)].map(x => +x[1]) : [];
    if (nums.length === 2 && nums[0] + nums[1] >= 97 && nums[0] + nums[1] <= 103) row.p = nums;
    const pr = /class=["']?forepr["']?>\s*<span>([^<]*)<\/span>/.exec(chunk); if (pr && /^[12X]$/.test(pr[1])) row.pred = pr[1];
    const sc = /class=["']?ex_sc tabonly["']?>([\s\S]*?)<\/div>/.exec(chunk), sn = sc ? [...sc[1].matchAll(/\d+/g)].map(x => +x[0]) : [];
    if (sn.length === 2) row.score = { h: sn[0], a: sn[1] };
    if (row.p || row.score) rows.push(row);
  }
  return rows;
}
const same = (a, b) => { const n = s => String(s).toLowerCase().replace(/[^a-z]/g, ''); const x = n(a), y = n(b); return x === y || (Math.min(x.length, y.length) >= 5 && (x.includes(y) || y.includes(x))); };
// One Forebet record per card: p = [home %, away %], pick = 'H' | 'A', score = predicted { h, a }.
export function fbFor(card, rows) {
  for (const r of rows) {
    const fwd = same(r.home, card.home) && same(r.away, card.away), rev = !fwd && same(r.home, card.away) && same(r.away, card.home);
    if (!fwd && !rev) continue;
    const p = r.p ? (rev ? [r.p[1], r.p[0]] : r.p) : null;
    const pick = p ? (p[0] > p[1] ? 'H' : p[1] > p[0] ? 'A' : null) : r.pred === '1' ? (rev ? 'A' : 'H') : r.pred === '2' ? (rev ? 'H' : 'A') : null;
    return { p, pick, score: r.score ? (rev ? { h: r.score.a, a: r.score.h } : r.score) : null };
  }
  return null;
}

// ---- ESPN --------------------------------------------------------------------------------------
async function scoreboard(date, fetchFn, debug) {
  try {
    const res = await fetchFn(`${ESPN}?dates=${date.replace(/-/g, '')}&limit=100`, { headers: { 'user-agent': 'gameday-hub/1.0' } });
    if (!res.ok) { debug.push(`${res.status} scoreboard ${date}`); return null; }
    const j = await res.json(), out = [];
    for (const ev of j.events || []) {
      const comp = ev.competitions?.[0], h = comp?.competitors?.find(c => c.homeAway === 'home'), a = comp?.competitors?.find(c => c.homeAway === 'away');
      if (!h || !a) continue;
      const t = comp.status?.type || {}, done = !!t.completed;
      const det = String(t.shortDetail || t.detail || ''), last = /SO/.test(det) ? 'SO' : /OT/.test(det) ? 'OT' : 'REG';
      // Only the Over/Under total is taken from the odds block (the sportsbook line); spreads and moneylines are ignored.
      const od = (comp.odds || []).find(o => Number.isFinite(Number(o.overUnder)) && Number(o.overUnder) >= 3.5 && Number(o.overUnder) <= 9.5), line = od ? Number(od.overUnder) : null;
      out.push({ id: String(ev.id), date: ev.date, done, last, line, lineSrc: od ? String(od.provider?.name || 'ESPN odds').slice(0, 30) : null, hName: h.team.displayName, aName: a.team.displayName, hc: code(h.team.abbreviation), ac: code(a.team.abbreviation), hs: done ? Number(h.score) : null, as: done ? Number(a.score) : null });
    }
    return out;
  } catch (e) { debug.push(`scoreboard ${date}: ${e.message}`); return null; }
}

// ---- grading -----------------------------------------------------------------------------------
// Forebet's Over/Under 5.5 is read from its predicted score: a predicted total above the line is Over.
export function fbOu(fb, f, line = LINE) {
  if (!fb || !fb.score || !f || f.total == null) return null;
  const pt = fb.score.a + fb.score.h;
  if (pt === line || f.total === line) return null; // a push (or no call at a whole-number line) is not graded
  return (pt > line) === (f.total > line) ? 1 : 0;
}
export function gradeCard(c) {
  const f = c.final; if (!f) return;
  const line = c.ln ? c.ln.v : LINE, win = f.h > f.a ? 'H' : 'A', over = f.total > line, push = f.total === line;
  const g = { line };
  for (const k of ['v2', 'v4']) if (c[k]) g[k] = { win: (c[k].w >= 50 ? 'H' : 'A') === win ? 1 : 0, ou: push ? null : (c[k].o >= 50) === over ? 1 : 0, brier: +((c[k].w / 100 - (win === 'H' ? 1 : 0)) ** 2).toFixed(4) };
  for (const k of ['v2', 'v4']) if (g[k] && c[k].sc) g[k].sc = c[k].sc.h === f.h && c[k].sc.a === f.a ? 1 : 0;
  if (c.fb) g.fb = { win: c.fb.pick ? (c.fb.pick === win ? 1 : 0) : null, ou: fbOu(c.fb, f, line) };
  c.grade = g;
}

// ---- cron / on-demand step ---------------------------------------------------------------------
export async function nhlStep(env, now = new Date(), fetchFn = fetch, { force = false } = {}) {
  const debug = [], t = localDate(now.toISOString());
  let S = (await env.HUB.get('nhl:state', 'json')) || freshState(), stateDirty = false;
  const dates = [addDays(t, -1), t, addDays(t, 1)];
  const boards = await Promise.all(dates.map(d => scoreboard(d, fetchFn, debug)));
  const out = { graded: 0, created: 0, refreshed: 0 }, seen = new Set();
  for (let i = 0; i < dates.length; i++) {
    const evs = boards[i]; if (!evs) continue;
    const date = dates[i];
    let day = await env.HUB.get(`nhl:day:${date}`, 'json'), dirty = false;
    if (!day) day = { date, cards: [] };
    for (const e of evs) {
      const ld = localDate(e.date);
      if (seen.has(e.id)) continue; seen.add(e.id); // a game is filed under the day ESPN lists it
      let c = day.cards.find(x => x.id === e.id);
      if (e.done) {
        if (c && !c.final) {
          c.final = { h: e.hs, a: e.as, last: e.last, total: 0 };
          const r = !S.applied.includes(e.id) && ld > S.through ? applyGame(S, e.hc, e.ac, e.hs, e.as, e.last) : null;
          if (r) { c.final.total = r.th + r.ta; S.applied.push(e.id); stateDirty = true; }
          else c.final.total = e.hs + e.as - (e.last === 'SO' ? 1 : 0);
          gradeCard(c); dirty = true; out.graded++;
        } else if (!c && ld > S.through && !S.applied.includes(e.id)) { // finished game we never predicted: still teaches the ratings
          if (applyGame(S, e.hc, e.ac, e.hs, e.as, e.last)) { S.applied.push(e.id); stateDirty = true; }
        }
        continue;
      }
      const manual = c && c.ln && c.ln.how === 'manual', lineNow = manual ? c.ln.v : e.line ?? (c && c.ln ? c.ln.v : null);
      const pr = predict(S, e.hc, e.ac, lineNow ?? LINE);
      if (!c) {
        c = { id: e.id, kickoff: e.date, ko: localTime(e.date), home: e.hName, away: e.aName, hAbbr: e.hc, aAbbr: e.ac, final: null, ver: S.ver };
        if (e.line) c.ln = { v: e.line, src: e.lineSrc };
        if (pr) { c.v2 = pr.v2; c.v4 = pr.v4; c.lam = pr.lam; } else c.skipped = 'Team not in the NHL ratings yet';
        day.cards.push(c); dirty = true; out.created++;
      } else if (!c.final && new Date(c.kickoff).getTime() > now.getTime() && pr) {
        const moved = !manual && e.line && (!c.ln || c.ln.v !== e.line); // the sportsbook moved the total
        if (moved) c.ln = { v: e.line, src: e.lineSrc };
        if (c.ver !== S.ver || moved) { // ratings moved since this card was made, or the line did
          c.v2 = pr.v2; c.v4 = pr.v4; c.lam = pr.lam; c.ver = S.ver; dirty = true; out.refreshed++;
        }
      }
    }
    if (dirty) await env.HUB.put(`nhl:day:${date}`, JSON.stringify(day));
  }
  if (S.applied.length > 400) S.applied = S.applied.slice(-400);
  if (stateDirty) await env.HUB.put('nhl:state', JSON.stringify(S));

  // Forebet: one page read, at most once per 3 hours (6 after a failure), only when a game still lacks its numbers.
  let fb = null;
  const meta = (await env.HUB.get('nhl:fbmeta', 'json')) || {};
  if (force || !meta.at || (!meta.ok && meta.hv !== FB_HV) || now.getTime() - new Date(meta.at).getTime() >= (meta.ok ? 3 : 6) * HOUR) {
    const work = [];
    for (const d of [t, addDays(t, 1)]) {
      const day = await env.HUB.get(`nhl:day:${d}`, 'json');
      const open = (day?.cards || []).filter(c => !c.final && !c.fb && new Date(c.kickoff).getTime() > now.getTime());
      if (open.length) work.push({ date: d, day, open });
    }
    if (work.length) fb = await forebetRead(env, work, now, fetchFn);
  }
  return { job: 'nhl', ...out, ...(fb ? { forebet: fb } : {}), ...(debug.length ? { debug } : {}) };
}

async function forebetRead(env, work, now, fetchFn) {
  let html;
  try {
    const res = await fetchFn(FB_URL, { headers: fbHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } catch (e) {
    const m = { at: now.toISOString(), ok: false, hv: FB_HV, msg: String(e.message || e).slice(0, 80) };
    await env.HUB.put('nhl:fbmeta', JSON.stringify(m)); return { error: m.msg };
  }
  const rows = parseForebetHockey(html);
  let saved = 0;
  for (const { date, day, open } of work) {
    let dirty = false;
    for (const c of open) { const f = fbFor(c, rows); if (f) { c.fb = { ...f, at: now.toISOString(), how: 'read from Forebet' }; dirty = true; saved++; } }
    if (dirty) await env.HUB.put(`nhl:day:${date}`, JSON.stringify(day));
  }
  const i0 = html.search(/\/en\/hockey\/matches\//), snip = i0 < 0 ? '' : html.slice(Math.max(0, i0 - 60), i0 + 420).replace(/\s+/g, ' ');
  const m = { at: now.toISOString(), ok: rows.length > 0, hv: FB_HV, rows: rows.length, saved, msg: rows.length ? null : `page loaded but no games could be read (${html.length} bytes, ${(html.match(/\/en\/hockey\/matches\//g) || []).length} hockey match links, ${(html.match(/homeTeam/g) || []).length} homeTeam marks, ${/captcha|cf-browser|Just a moment|Access denied|Attention Required/i.test(html) ? 'looks like a check page' : 'not a check page'}). First row: ${snip.slice(0, 380)}` };
  await env.HUB.put('nhl:fbmeta', JSON.stringify(m));
  return { rows: rows.length, saved, ...(m.msg ? { note: m.msg } : {}) };
}

// Type the line yourself (when ESPN has none, or to match a book you use). Games that have not started only. line = null hands it back to ESPN.
export async function nhlSetLine(env, date, id, line, now = new Date()) {
  const day = await env.HUB.get(`nhl:day:${date}`, 'json'), c = day?.cards?.find(x => x.id === id);
  if (!c) return { error: 'Game not found on that day' };
  if (c.final || new Date(c.kickoff).getTime() <= now.getTime()) return { error: 'That game has already started, so its line is locked.' };
  const v = line == null || line === '' ? null : Number(line);
  if (v != null && !(Number.isFinite(v) && v >= 3.5 && v <= 9.5 && Math.round(v * 2) === v * 2)) return { error: 'Enter a line between 3.5 and 9.5 in half-goal steps, for example 6.5.' };
  const S = (await env.HUB.get('nhl:state', 'json')) || freshState(), pr = predict(S, c.hAbbr, c.aAbbr, v ?? LINE);
  if (v == null) delete c.ln; else c.ln = { v, src: 'entered by you', how: 'manual' };
  if (pr) { c.v2 = pr.v2; c.v4 = pr.v4; c.lam = pr.lam; c.ver = S.ver; }
  await env.HUB.put(`nhl:day:${date}`, JSON.stringify(day));
  return { saved: true, ln: c.ln || null, v2: c.v2, v4: c.v4 };
}

// ---- results board -----------------------------------------------------------------------------
const mk = () => ({ n: 0, hit: 0 });
export async function nhlTally(env) {
  const list = await env.HUB.list({ prefix: 'nhl:day:' });
  const days = await Promise.all(list.keys.map(k => env.HUB.get(k.name, 'json')));
  const M = ['v2', 'v4', 'fb'], mkB = () => ({ win: Object.fromEntries(M.map(m => [m, mk()])), ou: Object.fromEntries(M.map(m => [m, mk()])), brier: { n: 0, v2: 0, v4: 0 }, home: mk() });
  const all = mkB(), same = mkB(), recent = [];
  let graded = 0, lined = 0;
  for (const d of days.filter(Boolean).sort((a, b) => b.date.localeCompare(a.date))) {
    for (const c of d.cards.filter(x => x.final && x.grade).sort((a, b) => b.kickoff.localeCompare(a.kickoff))) {
      graded++; const real = !!(c.ln && c.grade.line === c.ln.v); if (real) lined++; // Over/Under only counts at a real sportsbook line
      let g = c.grade;
      if (g.fb && g.fb.ou == null) { const o = fbOu(c.fb, c.final, c.ln ? c.ln.v : LINE); if (o != null) g = { ...g, fb: { ...g.fb, ou: o } }; } // games graded before Forebet O/U existed
      for (const m of M) {
        if (g[m]?.win != null) { all.win[m].n++; all.win[m].hit += g[m].win; }
        if (real && g[m]?.ou != null) { all.ou[m].n++; all.ou[m].hit += g[m].ou; }
      }
      all.home.n++; all.home.hit += c.final.h > c.final.a ? 1 : 0;
      for (const m of ['v2', 'v4']) if (g[m]) { all.brier.n += m === 'v2' ? 1 : 0; all.brier[m] += g[m].brier; }
      if (g.v2 && g.v4 && g.fb && g.fb.win != null) {
        same.brier.n++; same.brier.v2 += g.v2.brier; same.brier.v4 += g.v4.brier; same.home.n++; same.home.hit += c.final.h > c.final.a ? 1 : 0;
        for (const m of M) { same.win[m].n++; same.win[m].hit += g[m].win; if (real && (m !== 'fb' || g.fb.ou != null)) { same.ou[m].n++; same.ou[m].hit += g[m].ou; } }
      }
      if (recent.length < 60) recent.push({ date: d.date, home: c.home, away: c.away, hAbbr: c.hAbbr, aAbbr: c.aAbbr, final: c.final, ln: c.ln || null, v2: c.v2, v4: c.v4, fb: c.fb || null, grade: g });
    }
  }
  const fix = b => ({ ...b, brier: { n: b.brier.n, v2: b.brier.n ? +(b.brier.v2 / b.brier.n).toFixed(3) : null, v4: b.brier.n ? +(b.brier.v4 / b.brier.n).toFixed(3) : null } });
  return { graded, lined, all: fix(all), same: fix(same), recent };
}
export async function nhlStatus(env) {
  const [S, fb] = await Promise.all([env.HUB.get('nhl:state', 'json'), env.HUB.get('nhl:fbmeta', 'json')]);
  const s = S || freshState();
  return { through: s.through, gamesThisSeason: s.lg.n, teams: Object.keys(s.teams).length, forebet: fb || null, line: LINE, saved: !!S };
}
