// Reads Forebet's own league pages (the 1X2, Under/Over 2.5 and Both-teams-to-score tabs) and fills each
// card's `fb` record. Forebet is only RECORDED and graded: no model reads it. One page per cron run, at most
// once per 3 hours per page, and only games that have not kicked off and still lack that table's numbers.
import { norm, sameTeam } from './sportsmole.js';
import { localDate } from './data.js';

const BASE = 'https://www.forebet.com/en/';
// Hub league slug -> Forebet page. Add the Champions League once its page address is known.
export const FB_PAGES = {
  'uefa.europa': 'predictions-europe/uefa-europa-league',
  'eng.1': 'football-tips-and-predictions-for-england/premier-league',
  'esp.1': 'football-tips-and-predictions-for-spain/primera-division',
  'ger.1': 'football-tips-and-predictions-for-germany/bundesliga',
  'ger.2': 'football-tips-and-predictions-for-germany/2-bundesliga',
  'ita.1': 'football-tips-and-predictions-for-italy/serie-a',
  'fra.1': 'football-tips-and-predictions-for-france/ligue1',
  'ned.1': 'football-tips-and-predictions-for-netherlands/eredivisie',
  'mex.1': 'football-tips-and-predictions-for-mexico/liga-mx',
  'usa.1': 'football-tips-and-predictions-for-usa/mls',
};
const SUFFIX = { '1x2': '', ou: '/under-over', btts: '/bothtoscore' };
export const KINDS = ['1x2', 'ou', 'btts'];
export const fbUrl = (slug, kind) => BASE + FB_PAGES[slug] + SUFFIX[kind];

const ent = s => s.replace(/&#0?39;|&#x27;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim();
const between = (s, a, b, from = 0) => { const i = s.indexOf(a, from); if (i < 0) return null; const j = i + a.length, k = s.indexOf(b, j); return k < 0 ? null : s.slice(j, k); };

// One row per match on the page: { home, away, date, p?, score?, pred? | over? | btts? }.
// Each match sits in <div class="rcnt ...">. Cheap string scanning (the Worker has ~10 ms of CPU); rows before
// `fromDate` (finished games further down the page) are skipped without being read.
export function parseForebetHtml(html, kind, fromDate) {
  const rows = [];
  let pos = 0;
  for (;;) {
    const i = html.indexOf('<div class="rcnt', pos); if (i < 0) break;
    const nx = html.indexOf('<div class="rcnt', i + 10);
    const chunk = html.slice(i, nx < 0 ? html.length : nx); pos = i + 10;
    const date = between(chunk, 'startDate" datetime="', '"');
    if (!date || (fromDate && date < fromDate)) continue;
    const hAt = chunk.indexOf('itemprop="homeTeam"'), aAt = chunk.indexOf('itemprop="awayTeam"');
    if (hAt < 0 || aAt < 0) continue;
    const home = between(chunk, '<span itemprop="name">', '</span>', hAt), away = between(chunk, '<span itemprop="name">', '</span>', aAt);
    const inner = between(chunk, 'class="fprc">', '</div>');
    if (!home || !away || !inner) continue;
    const nums = [...inner.matchAll(/>(\d{1,3})</g)].map(m => +m[1]);
    const row = { home: ent(home), away: ent(away), date };
    if (kind === '1x2') {
      if (nums.length !== 3 || nums[0] + nums[1] + nums[2] < 97 || nums[0] + nums[1] + nums[2] > 103) continue;
      row.p = nums;
      const pr = between(chunk, 'class="forepr"><span>', '</span>'); if (pr && /^[1X2]$/.test(pr)) row.pred = pr;
      const sc = /^(\d{1,2})\s*-\s*(\d{1,2})$/.exec((between(chunk, 'class="ex_sc tabonly">', '<') || '').trim());
      if (sc) row.score = { h: +sc[1], a: +sc[2] };
    } else {
      if (nums.length !== 2 || nums[0] + nums[1] < 97 || nums[0] + nums[1] > 103) continue;
      if (kind === 'ou') row.over = nums[1]; else row.btts = nums[1]; // second number is Over / Yes
    }
    rows.push(row);
  }
  return rows;
}

// Forebet writes short names (Dresden, Düsseldorf, Bielefeld) where ESPN writes the full club name
// (Dynamo Dresden, Fortuna Düsseldorf, Arminia Bielefeld). Both clubs of a game must match, so a name
// that merely sits inside the other (5+ letters) is safe here.
export const is = (a, b) => {
  const x = norm(a), y = norm(b);
  if (sameTeam(x, y)) return true;
  const [sh, lg] = x.length <= y.length ? [x, y] : [y, x];
  return sh.length >= 5 && lg.includes(sh);
};
// Match page rows to cards by team names. A home/away swap flips the 1X2 numbers.
export function matchRows(rows, cards, kind) {
  const out = new Map();
  for (const c of cards) {
    for (const r of rows) {
      const fwd = is(r.home, c.home) && is(r.away, c.away), rev = !fwd && is(r.home, c.away) && is(r.away, c.home);
      if (!fwd && !rev) continue;
      if (kind === '1x2') out.set(c.id, rev ? { p: [r.p[2], r.p[1], r.p[0]], score: r.score && { h: r.score.a, a: r.score.h }, pred: r.pred === '1' ? '2' : r.pred === '2' ? '1' : r.pred } : { p: r.p, score: r.score || null, pred: r.pred || null });
      else out.set(c.id, kind === 'ou' ? { over: r.over } : { btts: r.btts });
      break;
    }
  }
  return out;
}

const has = (c, kind) => kind === '1x2' ? !!c.fb?.p : kind === 'ou' ? c.fb?.over != null : c.fb?.btts != null;
const HOUR = 3600000;

// Today / tomorrow / the day after: loaded once per run (a handful of reads, never per page).
async function loadDays(env, now) {
  const t = localDate(now.toISOString()), days = [];
  for (let n = 0; n < 3; n++) {
    const d = new Date(new Date(`${t}T12:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
    const day = await env.HUB.get(`day:${d}`, 'json');
    if (day) days.push({ date: d, day });
  }
  return days;
}
// Games of one league that have not started and still lack this table's numbers.
const openCards = (days, now, slug, kind) => days.map(x => ({ ...x, open: x.day.cards.filter(c => c.league === slug && !c.final && !has(c, kind) && new Date(c.kickoff).getTime() > now.getTime()) })).filter(x => x.open.length);

// Read one Forebet page and fill the matching cards. Returns what happened.
export async function forebetFetch(env, slug, kind, now = new Date(), fetchFn = fetch, days = null) {
  const url = fbUrl(slug, kind), work = openCards(days || await loadDays(env, now), now, slug, kind);
  const meta = (await env.HUB.get('meta:fb', 'json')) || {};
  const key = `${slug}|${kind}`;
  if (!work.length) return { slug, kind, skipped: 'nothing to fill' };
  let res, html;
  try {
    res = await fetchFn(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; gameday-hub/1.0)', 'accept-language': 'en-US,en;q=0.9' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } catch (e) {
    meta[key] = { at: now.toISOString(), ok: false, msg: String(e.message || e).slice(0, 80) };
    await env.HUB.put('meta:fb', JSON.stringify(meta));
    return { slug, kind, error: meta[key].msg };
  }
  const rows = parseForebetHtml(html, kind, work[0].date);
  let saved = 0;
  for (const { date, day, open } of work) {
    const found = matchRows(rows, open, kind);
    for (const [id, f] of found) { const c = day.cards.find(x => x.id === id); c.fb = { ...(c.fb || {}), ...f, at: c.fb?.at || now.toISOString(), how: c.fb?.how || 'read from Forebet' }; saved++; }
    if (found.size) await env.HUB.put(`day:${date}`, JSON.stringify(day));
  }
  // Games on the page that no open card matched, shown on the Status tab so a naming gap is visible.
  const used = new Set(); for (const { day } of work) for (const c of day.cards.filter(x => x.league === slug)) for (const r of rows) if (is(r.home, c.home) && is(r.away, c.away) || is(r.home, c.away) && is(r.away, c.home)) used.add(r);
  const unmatched = [];
  for (const r of rows) if (!used.has(r) && work.some(w => w.date === r.date)) unmatched.push(`${r.home}–${r.away}`);
  meta[key] = { at: now.toISOString(), ok: rows.length > 0, rows: rows.length, saved, ...(unmatched.length ? { unmatched: unmatched.slice(0, 6) } : {}), msg: rows.length ? null : 'page loaded but no games could be read' };
  await env.HUB.put('meta:fb', JSON.stringify(meta));
  return { slug, kind, rows: rows.length, saved };
}

// Cron step: the page whose open games kick off soonest, not read in the last 3 hours (6 after a failure).
export async function forebetStep(env, now = new Date(), fetchFn = fetch) {
  const meta = (await env.HUB.get('meta:fb', 'json')) || {};
  const cand = [], days = await loadDays(env, now);
  for (const slug of Object.keys(FB_PAGES)) for (const kind of KINDS) {
    const m = meta[`${slug}|${kind}`];
    if (m && now.getTime() - new Date(m.at).getTime() < (m.ok ? 3 : 6) * HOUR) continue;
    const work = openCards(days, now, slug, kind);
    if (work.length) cand.push({ slug, kind, ko: Math.min(...work.flatMap(w => w.open.map(c => new Date(c.kickoff).getTime()))) });
  }
  if (!cand.length) return null;
  cand.sort((a, b) => a.ko - b.ko);
  return forebetFetch(env, cand[0].slug, cand[0].kind, now, fetchFn, days);
}
