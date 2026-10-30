// NHL section: separate from soccer (own storage keys, own page, own model code).
//   v2  = Poisson goals model (official).      v4 = shadow: Elo + xG-rate blend (tracked only); the frozen xG rates fade as the season goes on.
//   Both count the overtime goal in totals and boost tied regulation scores (TIE, OT_GOAL below; docs/hockey-review-2026-10-26.md).
//   Forebet = recorded and graded only. No model reads market odds. The one market number kept is the sportsbook's Over/Under
//   total (ESPN's odds block, DraftKings): it is only the line that Over/Under is rated and graded against, and it never changes
//   what the model expects. Until a line is known a game uses 5.5.
// Storage: nhl:state (ratings, one write per batch of finished games), nhl:day:<date> (cards), nhl:fbmeta.
import SEED from './nhlseed.js';
import GK from './nhlgk.js';
import { hockeyPick, hockeyHit } from './pick.js';
import { fbHeaders, FB_HV } from './forebetpage.js';
import { hockeyMove } from './moves.js';
import { analystNhl } from './analyst.js';
import { goalSeq, maxLead, earlyPaid } from './early.js';

const TZ = 'America/Chicago';
export const LINE = 5.5;
export const GOALIE_W = 0; // season goalie ratings did not help in the 3-season backtest, so they are stored but not used
const HOME = 1.05, N0 = 25, HOUR = 3600000;
// Prices (c.px): DraftKings moneyline and total with its Over / Under prices from ESPN, opening and current, for the Movement tab.
// A price counts every 6 hours, every hour in the last 3 hours before puck drop, and every 10 minutes from 45 to 20 minutes
// before it (after the morning skate and the starting goalies: the closing price, noted in px.cl). From 20 minutes before, locked.
// A card is only written when its price changed (or the lineup read is noted), so this costs few writes. Display and tracking only.
// The window was 30-20 minutes until Oct 27, 2026: two 5-minute cron runs, and a run cut short (free-plan CPU limit) could miss both.
// Now 45-20, re-read every LINEUP_EVERY minutes inside it, so the close is the last read before the lock (about 25 minutes out).
export const LINEUP_READ = 45, PRICE_LOCK = 20, LINEUP_EVERY = 10;
// A regulation tie is likelier than two independent Poisson scores say: with 1.55x on the tied scores about 23% of games go past
// regulation, the NHL's rate in the 3-on-3 overtime era (plain Poisson gave 16%; the Hub's first 75 games had 27%).
export const TIE = 1.55;
// Share of games past regulation that overtime settles (the rest go to a shootout). The overtime goal counts in the graded total;
// the shootout goal does not (see refresh: totals leave it out), so a tied game ends one goal higher with this chance.
export const OT_GOAL = 0.65;
// v5 shadow: v4's expected goals adjusted for rest and for a backup goalie in net. Comparison only: it never feeds v2, v4, a pick or a bet.
// Sizes measured on 14,347 regular-season games (2012 to 2026, MoneyPuck game logs), net of team strength (docs/hockey-rest-goalie-2026-10-28.md):
// a team on the second night of a back-to-back scores B2B_OWN fewer goals and allows B2B_OPP more; a backup in net lets in BACKUP_OPP more.
export const B2B_OWN = 0.15, B2B_OPP = 0.05, BACKUP_OPP = 0.16;
// The winner chance moves by the measured effect on who wins (a logit shift, about 6 points for a back-to-back and 2 to 3 for a backup near 50%),
// not by what the goal adjustments alone would give: v4's Elo part cannot see rest or goalies and would dilute it.
export const B2B_LOGIT = 0.24, BACKUP_LOGIT = 0.11;
// Goalie names are matched without accents, spaces or punctuation (ESPN "Ukko-Pekka Luukkonen" = MoneyPuck "Ukko-Pekka Luukkonen").
export const gkKey = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '');
// The two feeds can spell a name a little differently (ESPN "Merilainen", MoneyPuck "Merilinen"): inside one team's goalies, a name
// within two letters of a known one is that goalie. Returns the key to use in the team's counts (the known one, or the name as given).
const lev = (a, b) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; };
export const gkResolve = (C, k) => { if (!C || C[k] != null || k.length < 8) return k; const hit = Object.keys(C).find(x => x.length >= 8 && lev(x, k) <= 2); return hit || k; };
// Is this goalie a backup for his team? true = he has started fewer games than the team's most-used goalie, false = he is that goalie (or tied
// with him), null = not known (no start counts yet, fewer than 6 games, or no name).
export function isBackup(S, team, name) {
  const C = S && S.gk && S.gk[team], k = gkKey(name); if (!C || !k) return null;
  const v = Object.values(C), n = v.reduce((a, b) => a + b, 0); if (n < 6) return null;
  return (C[gkResolve(C, k)] || 0) < Math.max(...v);
}
// Goalie rest: days since tonight's goalie last started (1 = he started yesterday: a back-to-back; 4 = three or more days). Read from
// the starters saved on the cards of the three days before (c.gk, ESPN's expected / confirmed starter). prior[k] is the day k+1
// before: Map(team -> goalie key, or null when that card named nobody), or null when that day is not known. Unknown is null, never a guess.
const sameGk = (a, b) => a === b || (a.length >= 8 && b.length >= 8 && lev(a, b) <= 2);
export async function priorStarts(env, date, known = new Set(), cache = {}) {
  const out = [];
  for (let k = 1; k <= 3; k++) {
    const d = addDays(date, -k), sd = d in cache ? cache[d] : (cache[d] = await env.HUB.get(`nhl:day:${d}`, 'json'));
    if (!sd) { out.push(known.has(d) ? new Map() : null); continue; }
    const m = new Map(); for (const c of sd.cards || []) for (const [side, t] of [['h', c.hAbbr], ['a', c.aAbbr]]) m.set(t, c.gk && c.gk[side] ? gkKey(c.gk[side].n) : null);
    out.push(m);
  }
  return out;
}
export function gkRestOf(prior, team, name) {
  const key = gkKey(name); if (!key) return null;
  for (let k = 0; k < 3; k++) { const m = prior[k]; if (!m) return null; if (m.has(team)) { const s = m.get(team); if (s == null) return null; if (sameGk(s, key)) return k + 1; } }
  return 4;
}
export const gkRest = (prior, c, gk) => { const r = { h: gk && gk.h ? gkRestOf(prior, c.hAbbr, gk.h.n) : null, a: gk && gk.a ? gkRestOf(prior, c.aAbbr, gk.a.n) : null }; return r.h == null && r.a == null ? null : r; };
// When the saved cards cannot tell (a day before the Hub saved starters, Oct 28, 2026, or a card with no goalie named), the goalie's
// own ESPN game log is read: days from his last game before tonight (same scale, 4 = three or more). null when it cannot be read.
const GAMELOG = id => `https://site.web.api.espn.com/apis/common/v3/sports/hockey/nhl/athletes/${encodeURIComponent(id)}/gamelog`;
export async function gamelogRest(fetchFn, id, date) {
  try {
    const r = await fetchFn(GAMELOG(id), { headers: { 'user-agent': 'gameday-hub/1.0' } }); if (!r.ok) return null;
    const ds = [], walk = v => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (k === 'gameDate' && typeof x === 'string') ds.push(localDate(x)); else walk(x); } };
    walk(await r.json()); if (!ds.length) return null;
    const before = ds.filter(d => d < date).sort(); if (!before.length) return 4;
    const days = Math.round((new Date(`${date}T12:00:00Z`) - new Date(`${before[before.length - 1]}T12:00:00Z`)) / 86400000);
    return Math.max(1, Math.min(4, days));
  } catch (e) { return null; }
}
// Rest for both starters: the saved cards first; a side they cannot tell keeps what this card already worked out for the same goalie,
// else reads his game log (budget.n reads at most per run, so a full slate cannot use up the run's requests).
export async function restFor(c, gk, prior, date, fetchFn, budget = { n: 8 }) {
  const r = gkRest(prior, c, gk) || { h: null, a: null };
  for (const s of ['h', 'a']) {
    const g = gk && gk[s]; if (r[s] != null || !g) continue;
    if (c.gr && c.gr[s] != null && c.gk && c.gk[s] && gkKey(c.gk[s].n) === gkKey(g.n)) { r[s] = c.gr[s]; continue; }
    if (g.id && budget.n > 0) { budget.n--; r[s] = await gamelogRest(fetchFn, g.id, date); }
  }
  return r.h == null && r.a == null ? null : r;
}
// The state keeps start counts from the seed (tools/make-nhl-gk.py); a state saved before v5 gets them the first time it is loaded.
export const withGk = S => { if (S && !S.gk) { S.gk = JSON.parse(JSON.stringify(GK.counts)); S.gkThrough = GK.through; return true; } return false; };
// What a card knows about tonight: b2b = [home, away] on the second night of a back-to-back, bk = [home, away] backup in net. true / false / null (unknown).
export function ctxFor(S, hc, ac, gk, rs) {
  const b = x => (x == null ? null : x === 1), k = (side, t) => (gk && gk[side] ? isBackup(S, t, gk[side].n) : null);
  return { b2b: [rs ? b(rs.h) : null, rs ? b(rs.a) : null], bk: [k('h', hc), k('a', ac)] };
}
// Goals added to the home and away expected goals (h, a), and the logit shift on the home win chance (L).
export const adj5 = c => ({
  h: (c.b2b[0] ? -B2B_OWN : 0) + (c.b2b[1] ? B2B_OPP : 0) + (c.bk[1] ? BACKUP_OPP : 0),
  a: (c.b2b[1] ? -B2B_OWN : 0) + (c.b2b[0] ? B2B_OPP : 0) + (c.bk[0] ? BACKUP_OPP : 0),
  L: (c.b2b[1] ? B2B_LOGIT : 0) - (c.b2b[0] ? B2B_LOGIT : 0) + (c.bk[1] ? BACKUP_LOGIT : 0) - (c.bk[0] ? BACKUP_LOGIT : 0),
});
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
// (only a whole-number line can push) and P(under). At 5.5 over means 6 or more goals. Tied regulation scores get the TIE boost, and
// the final total counts the overtime goal (OT_GOAL of tied games), as the Hub grades it.
export function probs(lh, la, line = LINE) {
  const ph = pois(lh), pa = pois(la); let win = 0, tie = 0, over = 0, push = 0, tot = 0;
  const add = (t, x) => { if (t > line) over += x; else if (t === line) push += x; };
  for (let i = 0; i < ph.length; i++) for (let j = 0; j < pa.length; j++) {
    const x = ph[i] * pa[j] * (i === j ? TIE : 1); tot += x;
    if (i > j) win += x; else if (i === j) tie += x;
    if (i === j) { add(i + j + 1, x * OT_GOAL); add(i + j, x * (1 - OT_GOAL)); } else add(i + j, x);
  }
  over /= tot; push /= tot;
  return { home: (win + tie * 0.5) / tot, over, push, under: 1 - over - push };
}
// The single likeliest final score. A hockey game cannot end level, so a tied regulation score goes to overtime or a shootout and its
// chance is split 50/50 between the one-goal wins (the same 50/50 the winner chance uses). Returns { h, a, p } with p in percent.
export function topScore(lh, la, n = 16) {
  const ph = pois(lh, n), pa = pois(la, n), m = {}, add = (i, j, x) => { const k = i + ',' + j; m[k] = (m[k] || 0) + x; };
  let tot = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const x = ph[i] * pa[j] * (i === j ? TIE : 1); tot += x; if (i === j) { add(i + 1, j, x / 2); add(i, j + 1, x / 2); } else add(i, j, x); }
  let best = null; for (const [k, x] of Object.entries(m)) if (!best || x > best.x) best = { k, x };
  const [h, a] = best.k.split(',').map(Number); return { h, a, p: round(best.x / tot) };
}
// Over chance with a push taken out: the chance of Over among games that do not land exactly on the line.
const ovr = pr => pr.over / Math.max(1e-9, pr.over + pr.under);
export const freshState = () => JSON.parse(JSON.stringify({
  v: 1, through: SEED.through, ver: 0, applied: [],
  lg: { n: SEED.lg.n, g: SEED.lg.g, x: SEED.lg.x, nx: SEED.lg.n },
  plg: SEED.plg, plgx: SEED.plgx,
  teams: Object.fromEntries(Object.entries(SEED.teams).map(([t, s]) => [t, { ...s, nx: s.n }])),
}));
export function predict(S, hc, ac, line = LINE, ctx = null) {
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
  // The xG rates are frozen at the seed (ESPN has no xG), so they fade as a team plays past it: c = the share of its games they cover.
  // Their weight moves to the goals rates, which keep updating. At the seed date c = 1 and v4 is unchanged.
  const cov = t => Math.min(1, (t.nx ?? t.n) / Math.max(1, t.n)), c = (cov(H) + cov(A)) / 2, ax = 0.5 * c;
  const w4 = 0.4 * pe + 0.3 * c * px.home + (0.6 - 0.3 * c) * p2.home;
  const lh4 = (1 - ax) * lh + ax * xlh, la4 = (1 - ax) * la + ax * xla, p4 = probs(lh4, la4, line);
  // v5 shadow: v4's winner chance shifted by the measured rest / backup effect, and v4's expected goals (goals and xG rates) with the goal adjustments added, for Over/Under and the likeliest score.
  let v5 = null;
  if (ctx) {
    const d = adj5(ctx), mx = x => Math.max(0.5, x), lh5 = mx(lh + d.h), la5 = mx(la + d.a), xlh5 = mx(xlh + d.h), xla5 = mx(xla + d.a);
    const w5 = 1 / (1 + Math.exp(-(Math.log(w4 / (1 - w4)) + d.L)));
    const lh45 = (1 - ax) * lh5 + ax * xlh5, la45 = (1 - ax) * la5 + ax * xla5, p45 = probs(lh45, la45, line);
    const f = x => (x == null ? null : x ? 1 : 0);
    v5 = { w: round(w5), o: round(ovr(p45)), sc: topScore(lh45, la45), ...(p45.push > 0.0005 ? { push: round(p45.push) } : {}), in: { b2b: ctx.b2b.map(f), bk: ctx.bk.map(f) } };
  }
  return { v2: { w: round(p2.home), o: round(ovr(p2)), sc: topScore(lh, la), ...(p2.push > 0.0005 ? { push: round(p2.push) } : {}) }, v4: { w: round(w4), o: round(ovr(p4)), sc: topScore(lh4, la4), ...(p4.push > 0.0005 ? { push: round(p4.push) } : {}) }, ...(v5 ? { v5 } : {}), lam: [+lh.toFixed(2), +la.toFixed(2)] };
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
const am = v => { if (v == null) return null; const t = String(v).trim().toUpperCase(); if (t === 'EVEN' || t === 'EV') return 100; const n = Number(t.replace('+', '')); return Number.isInteger(n) && Math.abs(n) >= 100 ? n : null; };
const lineNum = v => { const n = Number(String(v ?? '').replace(/[^0-9.]/g, '')); return n >= 3.5 && n <= 9.5 ? n : null; };
// ESPN's NHL odds block -> { h, a, tl, to, tu, op: { h, a }, opt: { tl, to, tu } } (American prices; anything missing is left out), or null.
export function parseHockeyOdds(list) {
  const o = (list || []).find(x => x && (x.moneyline || x.homeTeamOdds || x.total || x.overUnder != null)); if (!o) return null;
  const pick = (...xs) => { for (const x of xs) { const v = am(x); if (v != null) return v; } return null; }, ml = o.moneyline || {}, t = o.total || {}, out = {};
  const h = pick(ml.home?.close?.odds, ml.home?.open?.odds, o.homeTeamOdds?.moneyLine), a = pick(ml.away?.close?.odds, ml.away?.open?.odds, o.awayTeamOdds?.moneyLine);
  if (h != null && a != null) { out.h = h; out.a = a; }
  const oh = am(ml.home?.open?.odds), oa = am(ml.away?.open?.odds); if (oh != null && oa != null) out.op = { h: oh, a: oa };
  const tl = lineNum(t.over?.close?.line ?? t.over?.open?.line ?? o.overUnder), to = pick(t.over?.close?.odds, t.over?.open?.odds, o.overOdds), tu = pick(t.under?.close?.odds, t.under?.open?.odds, o.underOdds);
  if (tl != null && to != null && tu != null) { out.tl = tl; out.to = to; out.tu = tu; }
  const otl = lineNum(t.over?.open?.line), oto = am(t.over?.open?.odds), otu = am(t.under?.open?.odds); if (otl != null && oto != null && otu != null) out.opt = { tl: otl, to: oto, tu: otu };
  return out.h != null || out.tl != null ? out : null;
}
const canon = v => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v);
// Fold a fresh ESPN price into a card on schedule. f = the first price seen; ts = when it last changed; rd = when it was last taken;
// cl = when the lineup read was taken. Returns true when the card changed (and so must be saved).
// Inside the window a game is read again once its last lineup read is LINEUP_EVERY minutes old.
const lineupDue = (px, now) => !(px && px.cl) || now.getTime() - new Date(px.cl).getTime() >= LINEUP_EVERY * 60000;
// manual: the "Update NHL now" button. It takes the price whatever the schedule, up to puck drop (past the PRICE_LOCK), and inside
// the last LINEUP_READ minutes it is the closing read (noted cby = 'you').
export function setPrice(c, fresh, now = new Date(), manual = false) {
  const mins = (new Date(c.kickoff).getTime() - now.getTime()) / 60000, old = c.px;
  if (!fresh || mins <= (manual ? 0 : PRICE_LOCK)) return false;
  const lineup = mins <= LINEUP_READ && (manual || lineupDue(old, now)), due = manual || !old || !old.rd || now.getTime() - new Date(old.rd).getTime() >= (mins <= 180 ? 1 : 6) * HOUR;
  if (!due && !lineup) return false;
  const snap = x => ({ ...(x.h != null ? { h: x.h, a: x.a } : {}), ...(x.tl != null ? { tl: x.tl, to: x.to, tu: x.tu } : {}) });
  const n = { ...fresh, f: old && old.f ? old.f : snap(fresh), ...(old && old.ts ? { ts: old.ts } : {}), ...(old && old.rd ? { rd: old.rd } : {}), ...(old && old.cl ? { cl: old.cl } : {}) };
  const changed = JSON.stringify(canon(n)) !== JSON.stringify(canon(old || null));
  if (changed) { n.ts = now.toISOString(); n.rd = now.toISOString(); }
  if (lineup) { n.cl = now.toISOString(); if (manual) n.cby = 'you'; else delete n.cby; }
  if (!changed && !lineup) return false;
  c.px = n; return true;
}
// A finished game that missed its lineup read: take the book's closing line from ESPN's odds block for the finished game (its "close"
// prices) as the close, noted cl = puck drop and cls = 'espn'. Only once (a card that has cl is left alone). True when the card changed.
export function espnClose(c, done) {
  const old = c.px; if (!old || old.cl || !done) return false;
  const n = { ...old, ...(done.h != null ? { h: done.h, a: done.a } : {}), ...(done.tl != null ? { tl: done.tl, to: done.to, tu: done.tu } : {}) };
  if (n.h == null && n.tl == null) return false;
  n.cl = c.kickoff; n.cls = 'espn';
  c.px = n; return true;
}
// bet365 early payout (src/early.js): the biggest lead each side had, from ESPN's game summary (its scoring plays, shootout left out).
// [home, away] or null when the summary cannot be read or its goals do not add up to the final score.
const SUMMARY = id => `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/summary?event=${encodeURIComponent(id)}`;
export function leadFromSummary(j, final) {
  const comp = j && j.header && j.header.competitions && j.header.competitions[0], cs = (comp && comp.competitors) || [];
  const h = cs.find(c => c.homeAway === 'home'), a = cs.find(c => c.homeAway === 'away'); if (!h || !a) return null;
  const raw = Array.isArray(j.scoringPlays) && j.scoringPlays.length ? j.scoringPlays : (j.plays || []).filter(p => p && p.scoringPlay);
  const plays = raw.map(p => ({ team: String(p.team?.id ?? ''), own: false, so: !!p.shootoutPlay || /shootout/i.test(p.type?.text || '') || (final.last === 'SO' && Number(p.period?.number) >= 5) }));
  const so = final.last === 'SO' ? (final.h > final.a ? [1, 0] : [0, 1]) : [0, 0]; // the shootout winner's goal is in the final score
  return maxLead(goalSeq(plays, String(h.team?.id ?? h.id), String(a.team?.id ?? a.id), final.h - so[0], final.a - so[1]));
}
export async function fetchLead(fetchFn, id, final) {
  try { const r = await fetchFn(SUMMARY(id), { headers: { 'user-agent': 'gameday-hub/1.0' } }); return r.ok ? leadFromSummary(await r.json(), final) : null; } catch (e) { return null; }
}
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
      // Probable starting goalie per side ("expected", or "confirmed" once the team names him). Display and the v5 shadow only.
      const gkOf = t => { const p = (t.probables || []).find(x => /starting goalie/i.test(x.displayName || x.name || '') || x.abbreviation === 'SG'), a = p && p.athlete; return a && a.displayName ? { n: String(a.displayName).slice(0, 40), ...(a.id ? { id: String(a.id) } : {}), st: /confirm/i.test(p.status?.type || p.status?.name || '') ? 'c' : 'e' } : null; };
      const gkh = done ? null : gkOf(h), gka = done ? null : gkOf(a);
      out.push({ id: String(ev.id), date: ev.date, done, last, line, gk: gkh || gka ? { h: gkh, a: gka } : null, px: done ? null : parseHockeyOdds(comp.odds), pxDone: done ? parseHockeyOdds(comp.odds) : null, lineSrc: od ? String(od.provider?.name || 'ESPN odds').slice(0, 30) : null, hName: h.team.displayName, aName: a.team.displayName, hc: code(h.team.abbreviation), ac: code(a.team.abbreviation), hs: done ? Number(h.score) : null, as: done ? Number(a.score) : null });
    }
    return out;
  } catch (e) { debug.push(`scoreboard ${date}: ${e.message}`); return null; }
}

// What ESPN sends for each game's odds on one day (finished games too): the raw odds block, what the Hub reads from it, and what
// the card holds. For checking a price by hand; reads nothing into a card.
export async function nhlOddsRaw(env, date, fetchFn = fetch) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'Pass ?date=YYYY-MM-DD' };
  const res = await fetchFn(`${ESPN}?dates=${date.replace(/-/g, '')}&limit=100`, { headers: { 'user-agent': 'gameday-hub/1.0' } });
  if (!res.ok) return { error: `ESPN ${res.status}` };
  const j = await res.json(), day = await env.HUB.get(`nhl:day:${date}`, 'json');
  return { date, games: (j.events || []).map(ev => {
    const comp = ev.competitions?.[0] || {}, card = (day?.cards || []).find(c => c.id === String(ev.id));
    return { id: String(ev.id), name: ev.shortName || ev.name, status: comp.status?.type?.shortDetail || null, read: parseHockeyOdds(comp.odds), card: card ? card.px || null : null, raw: comp.odds || null };
  }) };
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
  for (const k of ['v2', 'v4', 'v5']) if (c[k]) g[k] = { win: (c[k].w >= 50 ? 'H' : 'A') === win ? 1 : 0, ou: push ? null : (c[k].o >= 50) === over ? 1 : 0, brier: +((c[k].w / 100 - (win === 'H' ? 1 : 0)) ** 2).toFixed(4) };
  for (const k of ['v2', 'v4', 'v5']) if (g[k] && c[k].sc) g[k].sc = c[k].sc.h === f.h && c[k].sc.a === f.a ? 1 : 0;
  if (c.fb) g.fb = { win: c.fb.pick ? (c.fb.pick === win ? 1 : 0) : null, ou: fbOu(c.fb, f, line) };
  c.grade = g;
  // The card's headline pick is locked here (from what the card held when it finished) and scored on the final. Model bets reads it.
  if (!c.lean) { const l = hockeyPick(c); if (l) { const h = hockeyHit(l.key, f, l.line); l.hit = h; c.lean = l; } }
}

// ---- lineup read (every cron run) ---------------------------------------------------------------
// The full NHL step only gets spare cron slots (at most every 20 minutes), which can miss the window from LINEUP_READ to
// PRICE_LOCK minutes before puck drop. This runs on every 5-minute run instead: KV reads only, unless a game sits in that window
// without its lineup read, and then one ESPN scoreboard read and one write for that day.
export async function nhlLineupStep(env, now = new Date(), fetchFn = fetch) {
  const t = localDate(now.toISOString()), out = [];
  for (const date of [addDays(t, -1), t, addDays(t, 1)]) {
    const day = await env.HUB.get(`nhl:day:${date}`, 'json'); if (!day) continue;
    const due = (day.cards || []).filter(c => { const m = (new Date(c.kickoff).getTime() - now.getTime()) / 60000; return !c.final && m > PRICE_LOCK && m <= LINEUP_READ && lineupDue(c.px, now); });
    if (!due.length) continue;
    const evs = await scoreboard(date, fetchFn, []); if (!evs) continue;
    let dirty = false, S5 = null; const cache = {}, budget = { n: 8 };
    for (const c of due) {
      const e = evs.find(x => x.id === c.id); if (!e || e.done) continue;
      if (setPrice(c, e.px, now)) { dirty = true; out.push(c.id); }
      // The starting goalie, as the team names him: v5 is re-made from it (v2 and v4 do not read it).
      if (e.gk && (e.gk.h || e.gk.a) && JSON.stringify(e.gk) !== JSON.stringify(c.gk || null)) {
        S5 = S5 || (await env.HUB.get('nhl:state', 'json')) || freshState(); withGk(S5);
        const pr = predict(S5, c.hAbbr, c.aAbbr, c.ln ? c.ln.v : LINE, ctxFor(S5, c.hAbbr, c.aAbbr, e.gk, c.rs));
        c.gk = e.gk; if (pr && pr.v5) c.v5 = pr.v5; dirty = true; if (!out.includes(c.id)) out.push(c.id);
        const gr = await restFor(c, e.gk, await priorStarts(env, date, new Set(), cache), date, fetchFn, budget); if (gr) c.gr = gr; else delete c.gr;
      }
    }
    if (dirty) { await env.HUB.put(`nhl:day:${date}`, JSON.stringify(day)); await analystNhl(env, date, day.cards, now); }
  }
  return out.length ? { job: 'nhl-lineup', read: out } : null;
}

// ---- cron / on-demand step ---------------------------------------------------------------------
export async function nhlStep(env, now = new Date(), fetchFn = fetch, { force = false } = {}) {
  const debug = [], t = localDate(now.toISOString());
  let S = (await env.HUB.get('nhl:state', 'json')) || freshState(), stateDirty = withGk(S);
  const dates = [addDays(t, -1), t, addDays(t, 1)];
  const boards = await Promise.all(dates.map(d => scoreboard(d, fetchFn, debug)));
  // Rest: which teams played on which days. The three boards just read, plus the saved days before them. A day that is not known
  // makes the rest of a team that did not play on a known day before it unknown (null), never a guess.
  const played = {};
  dates.forEach((d, i) => { if (boards[i]) played[d] = new Set(boards[i].flatMap(e => [e.hc, e.ac])); });
  for (const d of [addDays(t, -2), addDays(t, -3), addDays(t, -4)]) { const sd = await env.HUB.get(`nhl:day:${d}`, 'json'); if (sd) played[d] = new Set((sd.cards || []).flatMap(c => [c.hAbbr, c.aAbbr])); }
  const restOf = (team, date) => { for (let k = 1; k <= 3; k++) { const set = played[addDays(date, -k)]; if (!set) return null; if (set.has(team)) return k; } return 4; }; // 1 = played yesterday, 4 = three or more days
  const knownDays = new Set(dates.filter((d, i) => boards[i])), gkCache = {}, prior = {}, glBudget = { n: 8 };
  const priorFor = async d => prior[d] || (prior[d] = await priorStarts(env, d, knownDays, gkCache));
  const out = { graded: 0, created: 0, refreshed: 0 }, seen = new Set(), leadBudget = { n: 6 };
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
          if (c.gk && ld > S.gkThrough) for (const [side, team] of [['h', e.hc], ['a', e.ac]]) { const k0 = c.gk[side] && gkKey(c.gk[side].n); if (k0) { const C = S.gk[team] || (S.gk[team] = {}), k = gkResolve(C, k0); C[k] = (C[k] || 0) + 1; stateDirty = true; } } // who started, for telling a backup from the usual starter
          gradeCard(c); dirty = true; out.graded++;
        } else if (!c && ld > S.through && !S.applied.includes(e.id)) { // finished game we never predicted: still teaches the ratings
          if (applyGame(S, e.hc, e.ac, e.hs, e.as, e.last)) { S.applied.push(e.id); stateDirty = true; }
        }
        if (c && espnClose(c, e.pxDone)) { dirty = true; out.closed = (out.closed || 0) + 1; } // missed the lineup read: ESPN's close
        // Leads for early payout: one summary read per finished game, at most 6 a run, 3 tries a game.
        if (c && c.final && !c.final.lead && (c.final.ldt || 0) < 3 && leadBudget.n > 0) {
          leadBudget.n--; const ld = await fetchLead(fetchFn, e.id, c.final);
          if (ld) { c.final.lead = ld; delete c.final.ldt; if (c.lean) { const ep = earlyPaid(c.lean.key, c.lean.hit, ld, 'nhl'); if (ep != null) c.lean.ep = ep; } } else c.final.ldt = (c.final.ldt || 0) + 1;
          dirty = true; out.leads = (out.leads || 0) + (ld ? 1 : 0);
        }
        continue;
      }
      const manual = c && c.ln && c.ln.how === 'manual', lineNow = manual ? c.ln.v : e.line ?? (c && c.ln ? c.ln.v : null);
      const rs = { h: restOf(e.hc, date), a: restOf(e.ac, date) }, rsN = rs.h == null && rs.a == null ? null : rs, gkN = e.gk && (e.gk.h || e.gk.a) ? e.gk : null;
      const pr = predict(S, e.hc, e.ac, lineNow ?? LINE, ctxFor(S, e.hc, e.ac, gkN || (c && c.gk), rsN || (c && c.rs)));
      if (!c) {
        c = { id: e.id, kickoff: e.date, ko: localTime(e.date), home: e.hName, away: e.aName, hAbbr: e.hc, aAbbr: e.ac, final: null, ver: S.ver };
        if (e.line) c.ln = { v: e.line, src: e.lineSrc };
        if (pr) { c.v2 = pr.v2; c.v4 = pr.v4; c.lam = pr.lam; if (pr.v5) c.v5 = pr.v5; } else c.skipped = 'Team not in the NHL ratings yet';
        if (gkN) c.gk = gkN; if (rsN) c.rs = rsN;
        if (gkN) { const gr = await restFor(c, gkN, await priorFor(date), date, fetchFn, glBudget); if (gr) c.gr = gr; }
        setPrice(c, e.px, now, force);
        day.cards.push(c); dirty = true; out.created++;
      } else if (!c.final && new Date(c.kickoff).getTime() > now.getTime() && setPrice(c, e.px, now, force)) { dirty = true; if (force) out.priced = (out.priced || 0) + 1; }
      if (c && !c.final && new Date(c.kickoff).getTime() > now.getTime() && pr) {
        const moved = !manual && e.line && (!c.ln || c.ln.v !== e.line); // the sportsbook moved the total
        if (moved) c.ln = { v: e.line, src: e.lineSrc };
        // The goalie (or his status) or the rest changed, or the card has no v5 yet: v5 is re-made (v2 and v4 do not read either).
        const ctxMoved = !!(gkN && JSON.stringify(gkN) !== JSON.stringify(c.gk || null)) || !!(rsN && JSON.stringify(rsN) !== JSON.stringify(c.rs || null));
        if (ctxMoved && gkN && JSON.stringify(gkN) !== JSON.stringify(c.gk || null)) out.goalies = (out.goalies || 0) + 1;
        if (ctxMoved) { if (gkN) c.gk = gkN; if (rsN) c.rs = rsN; }
        if (c.gk) { const gr = await restFor(c, c.gk, await priorFor(date), date, fetchFn, glBudget); if (JSON.stringify(gr) !== JSON.stringify(c.gr || null)) { if (gr) c.gr = gr; else delete c.gr; dirty = true; } }
        if (c.ver !== S.ver || moved || ctxMoved || (pr.v5 && !c.v5)) { // ratings moved since this card was made, or the line did
          c.v2 = pr.v2; c.v4 = pr.v4; c.lam = pr.lam; c.ver = S.ver; if (pr.v5) c.v5 = pr.v5; dirty = true; out.refreshed++;
        }
      }
    }
    if (dirty) { await env.HUB.put(`nhl:day:${date}`, JSON.stringify(day)); await analystNhl(env, date, day.cards, now); } // the Analyst reads the same prices and finals
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
  const S = (await env.HUB.get('nhl:state', 'json')) || freshState(); withGk(S);
  const pr = predict(S, c.hAbbr, c.aAbbr, v ?? LINE, c.v5 ? ctxFor(S, c.hAbbr, c.aAbbr, c.gk, c.rs) : null);
  if (v == null) delete c.ln; else c.ln = { v, src: 'entered by you', how: 'manual' };
  if (pr) { c.v2 = pr.v2; c.v4 = pr.v4; c.lam = pr.lam; c.ver = S.ver; if (pr.v5) c.v5 = pr.v5; }
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
  // v5 shadow: only games that carry a v5 (made before puck drop, from approval onward), each model on those same games. adj = games where
  // rest or a backup goalie moved v5 off v4 (any flag set), plain = games where nothing did.
  const V5 = { n: 0, win: { v2: mk(), v4: mk(), v5: mk(), fb: mk(), home: mk() }, ou: { v2: mk(), v4: mk(), v5: mk() }, brier: { v2: 0, v4: 0, v5: 0 }, sit: { adj: { n: 0, v4: 0, v5: 0 }, plain: { n: 0, v4: 0, v5: 0 } }, b2b: { n: 0, home: 0 } };
  // Calibration: winner picks grouped by how sure the model was, against how often they won.
  const BANDS = [['50 to 54%', 50, 55], ['55 to 59%', 55, 60], ['60 to 64%', 60, 65], ['65% and up', 65, 101]], cal = { v2: BANDS.map(([label, lo, hi]) => ({ label, lo, hi, n: 0, hits: 0, sum: 0 })), v4: BANDS.map(([label, lo, hi]) => ({ label, lo, hi, n: 0, hits: 0, sum: 0 })) };
  let graded = 0, lined = 0;
  const MV = { ml: { n: 0, follow: 0, big: 0, bigFollow: 0 }, ou: { n: 0, follow: 0, big: 0, bigFollow: 0 } };
  // Model bets: every card's headline pick, locked when the game was graded. A total exactly on the line is a push (no result).
  const LB = { n: 0, hits: 0, push: 0, byKind: {}, byKey: {}, byBack: {}, base: { home: 0, over: 0, overN: 0 }, recent: [] }, lbAdd = (o, k, hit, pk) => { const x = o[k] || (o[k] = { n: 0, hits: 0 }); x.n++; x.hits += hit ? 1 : 0; if (pk) (x.ks || (x.ks = {}))[pk] = (x.ks[pk] || 0) + 1; }; // ks: which kinds of pick are inside, so the page can work out what chance alone would score
  for (const d of days.filter(Boolean).sort((a, b) => b.date.localeCompare(a.date))) {
    for (const c of d.cards.filter(x => x.final && x.grade).sort((a, b) => b.kickoff.localeCompare(a.kickoff))) {
      // Price moves: did the result go the way the price moved, on the moneyline and on the total (a push is left out)?
      const hm = hockeyMove(c.px);
      if (hm && hm.ml && hm.ml.d !== 0) { const fol = (hm.ml.d > 0) === (c.final.h > c.final.a); MV.ml.n++; MV.ml.follow += fol ? 1 : 0; if (Math.abs(hm.ml.d) >= 5) { MV.ml.big++; MV.ml.bigFollow += fol ? 1 : 0; } }
      if (hm && hm.ou && hm.ou.d !== 0 && c.final.total !== hm.ou.line) { const fol = (hm.ou.d > 0) === (c.final.total > hm.ou.line); MV.ou.n++; MV.ou.follow += fol ? 1 : 0; if (Math.abs(hm.ou.d) >= 5) { MV.ou.big++; MV.ou.bigFollow += fol ? 1 : 0; } }
      graded++; const real = !!(c.ln && c.grade.line === c.ln.v); if (real) lined++; // Over/Under only counts at a real sportsbook line
      let g = c.grade;
      if (g.fb && g.fb.ou == null) { const o = fbOu(c.fb, c.final, c.ln ? c.ln.v : LINE); if (o != null) g = { ...g, fb: { ...g.fb, ou: o } }; } // games graded before Forebet O/U existed
      for (const m of M) {
        if (g[m]?.win != null) { all.win[m].n++; all.win[m].hit += g[m].win; }
        if (real && g[m]?.ou != null) { all.ou[m].n++; all.ou[m].hit += g[m].ou; }
      }
      all.home.n++; all.home.hit += c.final.h > c.final.a ? 1 : 0;
      if (c.lean) {
        const L = c.lean;
        if (L.hit == null) LB.push++;
        else {
          LB.n++; LB.hits += L.hit ? 1 : 0; lbAdd(LB.byKind, L.k, L.hit, L.key); lbAdd(LB.byKey, L.key, L.hit);
          if (L.ep != null) { const E = LB.ep || (LB.ep = { n: 0, plain: 0, hits: 0, saved: 0 }); E.n++; E.plain += L.hit ? 1 : 0; E.hits += L.ep ? 1 : 0; E.saved += L.ep && !L.hit ? 1 : 0; }
          if (L.k === 'best' || L.k === 'lean') lbAdd(LB.byBack, `${L.y} of ${L.a}`, L.hit, L.key);
          LB.base.home += c.final.h > c.final.a ? 1 : 0;
          if (c.ln && c.final.total !== c.ln.v) { LB.base.overN++; LB.base.over += c.final.total > c.ln.v ? 1 : 0; }
          if (LB.recent.length < 40) LB.recent.push({ date: d.date, kickoff: c.kickoff, home: c.home, away: c.away, hAbbr: c.hAbbr, aAbbr: c.aAbbr, final: c.final, k: L.k, key: L.key, line: L.line ?? null, p: L.p, y: L.y, a: L.a, hit: !!L.hit, ...(L.ep != null ? { ep: L.ep } : {}) });
        }
      }
      if (g.v5 && c.v5) {
        V5.n++;
        for (const m of ['v2', 'v4', 'v5']) { if (g[m]?.win != null) { V5.win[m].n++; V5.win[m].hit += g[m].win; V5.brier[m] += g[m].brier; } if (real && g[m]?.ou != null) { V5.ou[m].n++; V5.ou[m].hit += g[m].ou; } }
        if (g.fb && g.fb.win != null) { V5.win.fb.n++; V5.win.fb.hit += g.fb.win; }
        V5.win.home.n++; V5.win.home.hit += c.final.h > c.final.a ? 1 : 0;
        const I = c.v5.in || {}, on = [...(I.b2b || []), ...(I.bk || [])].some(x => x === 1), sit = V5.sit[on ? 'adj' : 'plain'];
        if (g.v4 && g.v5) { sit.n++; sit.v4 += g.v4.win; sit.v5 += g.v5.win; }
      }
      for (const m of ['v2', 'v4']) if (g[m] && c[m] && g[m].win != null) { const t = Math.max(c[m].w, 100 - c[m].w), b = cal[m].find(x => t >= x.lo && t < x.hi); if (b) { b.n++; b.hits += g[m].win; b.sum += t; } }
      for (const m of ['v2', 'v4']) if (g[m]) { all.brier.n += m === 'v2' ? 1 : 0; all.brier[m] += g[m].brier; }
      if (g.v2 && g.v4 && g.fb && g.fb.win != null) {
        same.brier.n++; same.brier.v2 += g.v2.brier; same.brier.v4 += g.v4.brier; same.home.n++; same.home.hit += c.final.h > c.final.a ? 1 : 0;
        for (const m of M) { same.win[m].n++; same.win[m].hit += g[m].win; if (real && (m !== 'fb' || g.fb.ou != null)) { same.ou[m].n++; same.ou[m].hit += g[m].ou; } }
      }
      if (recent.length < 60) recent.push({ date: d.date, home: c.home, away: c.away, hAbbr: c.hAbbr, aAbbr: c.aAbbr, final: c.final, ln: c.ln || null, v2: c.v2, v4: c.v4, fb: c.fb || null, grade: g });
    }
  }
  const fix = b => ({ ...b, brier: { n: b.brier.n, v2: b.brier.n ? +(b.brier.v2 / b.brier.n).toFixed(3) : null, v4: b.brier.n ? +(b.brier.v4 / b.brier.n).toFixed(3) : null } });
  const calOut = Object.fromEntries(Object.entries(cal).map(([m, bs]) => [m, bs.map(b => ({ label: b.label, n: b.n, hits: b.hits, avg: b.n ? +(b.sum / b.n).toFixed(1) : null }))]));
  const v5 = V5.n ? { ...V5, brier: Object.fromEntries(['v2', 'v4', 'v5'].map(m => [m, V5.win[m].n ? +(V5.brier[m] / V5.win[m].n).toFixed(3) : null])) } : null;
  return { graded, lined, all: fix(all), same: fix(same), cal: calOut, recent, leans: LB, moves: MV, v5 };
}
export async function nhlStatus(env) {
  const [S, fb] = await Promise.all([env.HUB.get('nhl:state', 'json'), env.HUB.get('nhl:fbmeta', 'json')]);
  const s = S || freshState();
  return { through: s.through, gamesThisSeason: s.lg.n, teams: Object.keys(s.teams).length, forebet: fb || null, line: LINE, saved: !!S };
}
