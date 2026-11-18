// Saves from the buttons kept apart from the background job's saves (Nov 18, 2026, round 2 of the data audit).
//
// The problem: a day's cards live in ONE KV record (day:<date>, nhl:day:<date>), and so do the Analyst's paper bets (analyst). The
// background job (cron) and the buttons each read the whole record, change it and write it all back. KV can serve a read up to about
// 60 seconds old in another location, so a button pressed near a cron save could write back a copy from before that save and erase it
// (a lineup-window close, a grade and its locked pick, Forebet or SportsMole numbers, a paper bet), and a cron save could erase a button's.
//
// The fix: only the cron writes those records. A button (any request to the Worker) never writes them; what it changed is saved as a
// small patch in a side record next to them, 'fix:' + the record's key (fix:day:<date>, fix:nhl:day:<date>, fix:analyst):
//   * per card, only the top-level fields the button changed (set / del), or the whole card when the button made it;
//   * day-level fields (analyzed, analyzedAt, smTried) as the keys that changed;
//   * for the Analyst, only the bets the button placed or settled.
// Every read of a day (or of the Analyst's record) lays the patches on top: applyFix / applyAnalystFix. The patch never takes away what
// the stored record has and the button's copy lacked (a close, a result, Forebet, SportsMole, shots: keepSaved's rules), so a button that
// read a stale copy cannot erase the cron's work either. The cron reads through the same merge, so its next save of that record carries
// the patches in (folds them back) and notes the newest patch it carried (fxAt). Patches at or before fxAt are skipped on read and pruned
// by the next button save. foldStep saves a record whose patches no cron job has carried in yet, one record per idle grading turn.
// Patches expire after FIX_TTL (10 days), long after they are folded.
//
// All of this sits in the storage layer: withFixes(env) wraps env.HUB so every existing read (Results, Trends, exports, the Analyst, the
// bet builder, alerts, health) gets the merged record without changing its code, and a button's write becomes a patch. The Worker's
// fetch handler wraps with { button: true }, the scheduled handler without. getDay / listDays do the same merge for code (or a test)
// holding a plain env. Old records need no change: a record with no side record reads exactly as before.
import { setOf } from './analyst.js';

export const FIX_TTL = 10 * 86400; // seconds: patches outlive their fold by days
export const fixKey = key => `fix:${key}`;
const DAY_RE = /^(nhl:)?day:\d{4}-\d{2}-\d{2}$/;
export const isDayKey = k => DAY_RE.test(String(k));
const sportOf = key => (String(key).startsWith('nhl:') ? 'nhl' : 'soccer');
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const canon = v => (Array.isArray(v) ? v.map(canon) : isObj(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v);
const sameJson = (a, b) => { const x = JSON.stringify(a), y = JSON.stringify(b); return x === y || (x !== undefined && y !== undefined && JSON.stringify(canon(a)) === JSON.stringify(canon(b))); }; // key order alone is no change
const clone = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const cardKey = c => `${c.league || ''}|${c.id}`;

// What a later save must not take away from a card. Soccer: the result and its locked pick, a void, Forebet / SportsMole / shots numbers,
// and each closing read with the prices it fixed (the lineup read cl, Pinnacle's pcl, the both-score bcl). Hockey: the same for its result,
// Forebet, goalies and shots read, and the close (px.cl).
const CLOSE_GROUPS = { cl: ['h', 'd', 'a', 'tl', 'to', 'tu', 'op', 'opt', 'src', 'ts', 'cl', 'cby', 'cls'], pcl: ['pn', 'pcl'], bcl: ['by', 'bn', 'bk', 'bcl'] };
const KEEP = {
  soccer: { done: ['final', 'grade', 'lean', 'smGrade'], has: ['fb', 'sm', 'sx'], px: 'odds', groups: CLOSE_GROUPS },
  nhl: { done: ['final', 'grade', 'lean'], has: ['fb', 'gk', 'sg'], px: 'px', groups: { cl: ['h', 'a', 'tl', 'to', 'tu', 'op', 'opt', 'cl', 'cby', 'cls', 'ts', 'rd'] } },
};
// s = the stored card, c = the card about to be saved (changed in place): carry over what s has and c lacks.
export function keepCard(s, c, sport = 'soccer') {
  const K = KEEP[sport] || KEEP.soccer;
  if (s.final && !c.final) for (const k of K.done) { if (s[k] !== undefined) c[k] = s[k]; }
  if (s.void && !c.void && !c.final) c.void = s.void;
  for (const k of K.has) if (s[k] && !c[k]) c[k] = s[k];
  const so = s[K.px];
  if (so) {
    if (!c[K.px]) c[K.px] = so;
    else { c[K.px] = { ...c[K.px] }; for (const [mark, keys] of Object.entries(K.groups)) if (so[mark] && !c[K.px][mark]) for (const k of keys) { if (so[k] === undefined) delete c[K.px][k]; else c[K.px][k] = so[k]; } }
  }
  return c;
}
// Saving a whole day over the stored one (the cron's putDay): every card keeps what keepCard keeps, and a graded card is never lost.
export function keepSaved(saved, mine, sport = 'soccer') {
  if (!saved || !Array.isArray(saved.cards) || !mine || !Array.isArray(mine.cards)) return mine;
  const at = new Map(mine.cards.map(c => [cardKey(c), c]));
  for (const s of saved.cards) {
    const c = at.get(cardKey(s));
    if (!c) { if (s.final) mine.cards.push(s); continue; } // other cards may be dropped on purpose (moved games)
    keepCard(s, c, sport);
  }
  return mine;
}

// ---- days -------------------------------------------------------------------------------------------------------------------------
// The patches still to lay on a day: those newer than the last one the cron carried in.
const liveCards = (raw, fix) => { const F = (raw && raw.fxAt) || 0; return Object.entries((fix && fix.cards) || {}).filter(([, e]) => e && e.at > F); };
const liveDay = (raw, fix) => !!(fix && fix.day && fix.day.at > ((raw && raw.fxAt) || 0));
export const hasLive = (raw, fix) => liveCards(raw, fix).length > 0 || liveDay(raw, fix);
// The day as the buttons left it: the stored day with the patches laid on. A day with no patch to lay is returned as it is (no copy).
export function applyFix(raw, fix, sport = 'soccer') {
  const live = liveCards(raw, fix), dl = liveDay(raw, fix);
  if (!live.length && !dl) return raw;
  const d = raw ? { ...raw, cards: (raw.cards || []).slice() } : { date: fix.date, cards: [] };
  let top = (raw && raw.fxAt) || 0;
  const idx = new Map(d.cards.map((c, i) => [cardKey(c), i]));
  for (const [k, e0] of live.sort((a, b) => a[1].at - b[1].at)) {
    const e = clone(e0); top = Math.max(top, e.at);
    const i = idx.get(k), c = i == null ? null : d.cards[i];
    if (!c) { if (e.card) { idx.set(k, d.cards.length); d.cards.push(e.card); } continue; } // a patch on a card the day no longer has (moved): skipped
    const n = { ...c, ...(e.card || {}), ...(e.set || {}) };
    for (const f of e.del || []) delete n[f];
    d.cards[i] = keepCard(c, n, sport);
  }
  if (dl) {
    top = Math.max(top, fix.day.at);
    for (const [k, v] of Object.entries(clone(fix.day.set) || {})) {
      if (isObj(v) && isObj(d[k])) { const o = { ...d[k] }; for (const [x, y] of Object.entries(v)) o[x] = typeof y === 'number' && typeof o[x] === 'number' ? Math.max(o[x], y) : y; d[k] = o; }
      else d[k] = typeof v === 'number' && typeof d[k] === 'number' ? Math.max(d[k], v) : v; // times (analyzedAt) only move forward
    }
  }
  d.fxAt = top; // the cron's next save of this day carries these patches in
  return d;
}
// What a button changed on a day: per card the top-level fields it set or removed (the whole card when it made the card), and the
// day-level keys. Cards it dropped are not recorded: dropping a card (a moved game) is left to the cron's own analysis. null: nothing.
export function diffDay(before, after) {
  if (!after) return null;
  const bm = new Map(((before && before.cards) || []).map(c => [cardKey(c), c])), cards = {};
  for (const c of after.cards || []) {
    const k = cardKey(c), b = bm.get(k);
    if (!b) { cards[k] = { card: c }; continue; }
    if (JSON.stringify(b) === JSON.stringify(c)) continue; // most cards are untouched: one plain comparison each (CPU)
    const set = {}, del = [];
    for (const f of new Set([...Object.keys(b), ...Object.keys(c)])) {
      if (c[f] === undefined) { if (b[f] !== undefined) del.push(f); } else if (!sameJson(b[f], c[f])) set[f] = c[f];
    }
    if (Object.keys(set).length || del.length) cards[k] = { ...(Object.keys(set).length ? { set } : {}), ...(del.length ? { del } : {}) };
  }
  const day = {};
  for (const f of Object.keys(after)) {
    if (f === 'cards' || f === 'fxAt' || f === 'date') continue;
    const a = after[f], b = before ? before[f] : undefined;
    if (sameJson(a, b)) continue;
    if (isObj(a) && isObj(b)) { const o = {}; for (const x of Object.keys(a)) if (!sameJson(a[x], b[x])) o[x] = a[x]; if (Object.keys(o).length) day[f] = o; }
    else if (a !== undefined) day[f] = a;
  }
  if (!Object.keys(cards).length && !Object.keys(day).length) return null;
  return { cards, ...(Object.keys(day).length ? { day } : {}) };
}
// Add a button's changes to the side record. Patches the cron already carried in (at <= the stored day's fxAt) are dropped first, so an
// old patch is never laid again over the cron's later work. at only moves forward.
export function addPatch(fix, patch, rawFxAt = 0, now = Date.now(), date = null) {
  const f = fix && fix.v === 1 ? { ...fix, cards: { ...(fix.cards || {}) } } : { v: 1, date, cards: {} };
  for (const [k, e] of Object.entries(f.cards)) if (!e || e.at <= rawFxAt) delete f.cards[k];
  if (f.day && f.day.at <= rawFxAt) delete f.day;
  // at is always past every patch the stored day already carries (rawFxAt) and every one still waiting, whatever this server's clock says
  const at = Math.max(now, 1 + Math.max(rawFxAt, ...Object.values(f.cards).map(e => e.at), f.day ? f.day.at : 0));
  for (const [k, p] of Object.entries(patch.cards || {})) {
    const e = f.cards[k];
    if (p.card || !e) { f.cards[k] = { at, ...p }; continue; }
    if (e.card) { const c = { ...e.card, ...(p.set || {}) }; for (const x of p.del || []) delete c[x]; f.cards[k] = { at, card: c }; continue; }
    const set = { ...(e.set || {}), ...(p.set || {}) }, del = (e.del || []).filter(x => !(p.set && x in p.set));
    for (const x of p.del || []) { delete set[x]; if (!del.includes(x)) del.push(x); }
    f.cards[k] = { at, ...(Object.keys(set).length ? { set } : {}), ...(del.length ? { del } : {}) };
  }
  if (patch.day) {
    const set = { ...((f.day && f.day.set) || {}) };
    for (const [x, v] of Object.entries(patch.day)) set[x] = isObj(v) && isObj(set[x]) ? { ...set[x], ...v } : v;
    f.day = { at, set };
  }
  return f;
}

// ---- the Analyst's record -----------------------------------------------------------------------------------------------------------
const MKT = k => (k === 'O' || k === 'U' ? 'ou' : k === 'B' || k === 'N' ? 'btts' : '1x2');
const posOf = b => `${b.sport === 'nhl' ? 'nhl' : setOf(b)}|${b.date}|${b.league}|${b.gid}|${MKT(b.key)}`; // one position per game, market and rule set
export function applyAnalystFix(raw, fix) {
  const F = (raw && raw.fxAt) || 0, live = ((fix && fix.items) || []).filter(e => e && e.at > F && e.b);
  if (!live.length) return raw;
  const d = raw ? { ...raw, items: (raw.items || []).slice() } : { v: 1, items: [] };
  const at = new Map(d.items.map((b, i) => [b.id, i])), held = new Set(d.items.map(posOf));
  for (const e of live.sort((a, b) => a.at - b.at)) {
    const i = at.get(e.b.id);
    if (i != null) { // a bet the record has: the button's copy is taken only where it settled more (the close, then the result)
      const s = d.items[i]; if ((!s.res && e.b.res) || (s.close == null && e.b.close != null && !s.res)) d.items[i] = clone(e.b);
      continue;
    }
    if (held.has(posOf(e.b))) continue; // the cron bet the same game and market meanwhile: one position only
    d.items.unshift(clone(e.b)); held.add(posOf(e.b));
    for (const [k, v] of at) at.set(k, v + 1); at.set(e.b.id, 0);
  }
  d.fxAt = Math.max(F, ...live.map(e => e.at));
  return d;
}
// The bets a button's look placed or settled. Settling is the same sum from the same cards whoever does it, so it is kept only to save the
// cron the work; placing is the button's own news.
export function diffAnalyst(before, after) {
  const had = new Map(((before && before.items) || []).map(b => [b.id, b]));
  const out = ((after && after.items) || []).filter(b => b && b.id && (!had.has(b.id) || !sameJson(had.get(b.id), b)));
  return out.length ? out : null;
}
export function addBets(fix, bets, rawFxAt = 0, now = Date.now()) {
  const ids = new Set(bets.map(b => b.id)), items = ((fix && fix.items) || []).filter(e => e && e.at > rawFxAt && !ids.has(e.b && e.b.id));
  let at = Math.max(now, 1 + Math.max(rawFxAt, ...items.map(e => e.at)));
  for (const b of bets) items.push({ at: at++, b });
  return { v: 1, items };
}

// ---- the storage layer ----------------------------------------------------------------------------------------------------------------
const applyFor = (key, raw, fix) => (key === 'analyst' ? applyAnalystFix(raw, fix) : applyFix(raw, fix, sportOf(key)));
const SNAPS = 8; // a button's write is compared with its own last read of the record (the last few reads are kept per request)
// Write ids (src/summaries.js): every save of a day, and of its side record, carries one as KV metadata ({ w }, through counted()). The
// kept Results / Trends summaries see a changed day from the listing. A day with a side record is described by both ids joined
// ("<day's id>+<side record's id>"), so a button's patch on a finished game rebuilds the summaries as a cron save does.
const wOf = m => (m && typeof m === 'object' && m.w ? String(m.w) : '-');
export const joinMeta = (dayMeta, fixW) => (fixW == null ? dayMeta || null : { ...(dayMeta || {}), w: `${wOf(dayMeta)}+${fixW}` });
const getMeta = async (hub, key, type) => {
  if (typeof hub.getWithMetadata === 'function') { const r = await hub.getWithMetadata(key, type); return { value: r ? r.value : null, metadata: r ? r.metadata : null }; }
  return { value: await hub.get(key, type), metadata: null };
};
// Every side record under 'fix:' + prefix with its write id: Map(side record key -> id), every page of the listing.
export async function listFixMeta(hub, prefix) {
  const out = new Map(); let cursor = null;
  do { const x = await hub.list(cursor ? { prefix: fixKey(prefix), cursor } : { prefix: fixKey(prefix) }); for (const k of (x && x.keys) || []) out.set(k.name, wOf(k.metadata)); cursor = x && x.list_complete === false && x.cursor ? x.cursor : null; } while (cursor);
  return out;
}
// Listed day keys with their side record's write id joined into the metadata.
export const withFixMeta = (keys, fm) => keys.map(k => { const f = fm.get(fixKey(k.name)); return f == null ? k : { ...k, metadata: joinMeta(k.metadata, f) }; });
export function withFixes(env, { button = false } = {}) {
  const base = env.HUB;
  if (!base || base.fixes) return env;
  const hub = Object.create(base), fixCache = new Map(), snaps = new Map(), known = new Map(), wrote = new Set(); // known: list prefix -> Map(side record -> write id)
  const watched = k => isDayKey(k) || k === 'analyst';
  const prefixOf = k => (String(k).startsWith('nhl:') ? 'nhl:day:' : 'day:');
  // the side record of a key and its write id ({ doc, w }; w null when there is none)
  async function readFixFull(key, fresh = false) {
    if ((!fresh || wrote.has(key)) && fixCache.has(key)) return fixCache.get(key); // this request's own save is the newest there is
    const kn = known.get(prefixOf(key));
    if (!fresh && isDayKey(key) && kn && !kn.has(fixKey(key))) { const x = { doc: null, w: null }; fixCache.set(key, x); return x; }
    let x = { doc: null, w: null }; try { const r = await getMeta(base, fixKey(key), 'json'); if (r.value) x = { doc: r.value, w: wOf(r.metadata) }; } catch (e) { /* read as none */ }
    fixCache.set(key, x); return x;
  }
  const readFix = async (key, fresh = false) => (await readFixFull(key, fresh)).doc;
  // one record, merged: { out, meta }; a button's read is kept to compare its save with
  async function readOne(key, withMeta) {
    const [r, fx] = await Promise.all([withMeta ? getMeta(base, key) : base.get(key).then(value => ({ value, metadata: null })), readFixFull(key)]);
    const text = r.value == null ? null : typeof r.value === 'string' ? r.value : JSON.stringify(r.value);
    if (button) { snaps.delete(key); snaps.set(key, { text, fix: fx.doc }); if (snaps.size > SNAPS) snaps.delete(snaps.keys().next().value); }
    return { out: applyFor(key, text == null ? null : JSON.parse(text), fx.doc), meta: joinMeta(r.metadata, fx.w) };
  }
  const typed = (out, opt) => (out == null ? null : (typeof opt === 'string' ? opt : opt && opt.type) === 'json' ? out : JSON.stringify(out));
  hub.fixes = true; hub.button = button; hub.raw = base;
  hub.get = async (key, opt) => { if (!watched(key)) return base.get(key, opt); return typed((await readOne(key, false)).out, opt); };
  hub.getWithMetadata = async (key, opt) => {
    if (!watched(key)) return typeof base.getWithMetadata === 'function' ? base.getWithMetadata(key, opt) : { value: await base.get(key, opt), metadata: null };
    const r = await readOne(key, true); return { value: typed(r.out, opt), metadata: r.meta };
  };
  // A listing of the days also lists their side records (one more list call): days without one are then read without looking for it, and
  // each listed day's metadata carries its side record's write id (src/summaries.js reads the listing to see what changed).
  hub.list = async (o = {}) => {
    const r = await base.list(o);
    const p = o && o.prefix;
    if (p !== 'day:' && p !== 'nhl:day:') return r;
    if (!known.has(p)) { try { known.set(p, await listFixMeta(base, p)); } catch (e) { /* read each side record */ } }
    const fm = known.get(p);
    return fm && fm.size && r && Array.isArray(r.keys) ? { ...r, keys: withFixMeta(r.keys, fm) } : r;
  };
  hub.put = async (key, value, opts) => {
    if (!button || !watched(key)) return base.put(key, value, opts);
    let snap = snaps.get(key);
    if (!snap) { const text = await base.get(key); snap = { text: text == null ? null : typeof text === 'string' ? text : JSON.stringify(text), fix: await readFix(key) }; }
    if (snap.text == null) { await base.put(key, value, opts); snaps.set(key, { text: value, fix: null }); return; } // a record that does not exist yet: nothing to erase
    const raw = JSON.parse(snap.text), before = applyFor(key, raw, snap.fix), next = JSON.parse(value), rawFx = raw.fxAt || 0; // applyFor leaves raw as it is
    const cur = await readFix(key, true); // the side record as it is now (another button may have added to it)
    let fix;
    if (key === 'analyst') { const add = diffAnalyst(before, next); if (!add) return; fix = addBets(cur, add, rawFx); }
    else { const patch = diffDay(before, next); if (!patch) return; fix = addPatch(cur, patch, rawFx, Date.now(), key.replace(/^(nhl:)?day:/, '')); }
    await base.put(fixKey(key), JSON.stringify(fix), { expirationTtl: FIX_TTL }); // through counted(): counted, and given its write id
    const w = `own${Date.now().toString(36)}`; // within this request only
    fixCache.set(key, { doc: fix, w }); wrote.add(key); snaps.set(key, { text: snap.text, fix });
    const kn = known.get(prefixOf(key)); if (kn) kn.set(fixKey(key), w);
  };
  return { ...env, HUB: hub };
}
// One record with its patches laid on and its write id ({ value, metadata }), for a hub that may or may not be wrapped (src/summaries.js).
export async function readWithMeta(hub, key) {
  if (hub.fixes) return hub.getWithMetadata(key, 'json');
  const fx = async () => { try { return await getMeta(hub, fixKey(key), 'json'); } catch (e) { return { value: null, metadata: null }; } };
  const [d, f] = await Promise.all([getMeta(hub, key, 'json'), fx()]);
  return { value: applyFor(key, d.value, f.value), metadata: joinMeta(d.metadata, f.value ? wOf(f.metadata) : null) };
}

// The merged read as plain functions, for code holding an env that is not wrapped (tests, tools) and for anyone who wants it spelled out.
// sport: 'soccer' (day:<date>) or 'nhl' (nhl:day:<date>).
export const dayKey = (date, sport = 'soccer') => `${sport === 'nhl' ? 'nhl:' : ''}day:${date}`;
// One record (a day key or 'analyst') with its patches laid on. With a wrapped env this is the wrapper's own read (which a button's later
// save is compared with); with a plain env the side record is read here (a plain env is the cron's way: its save carries the patches in).
export async function readMerged(env, key) {
  if (env.HUB.fixes) return env.HUB.get(key, 'json');
  const fx = async () => { try { return await env.HUB.get(fixKey(key), 'json'); } catch (e) { return null; } };
  const [raw, fix] = await Promise.all([env.HUB.get(key, 'json'), fx()]);
  return applyFor(key, raw, fix);
}
export const getDay = (env, date, sport = 'soccer') => readMerged(env, dayKey(date, sport));
// Every saved day of a sport, merged, oldest first.
export async function listDays(env, sport = 'soccer') {
  const prefix = sport === 'nhl' ? 'nhl:day:' : 'day:', names = []; let cursor;
  const hub = env.HUB.fixes ? env.HUB : withFixes(env).HUB;
  do { const r = await hub.list(cursor ? { prefix, cursor } : { prefix }); names.push(...r.keys.map(k => k.name)); cursor = r.list_complete === false ? r.cursor : null; } while (cursor);
  return (await Promise.all(names.sort().map(n => hub.get(n, 'json')))).filter(Boolean);
}

// The cron's fold: one record whose patches no cron save has carried in yet is saved with them (one write). Patches younger than
// FOLD_AFTER_MS are left a little longer: the cron's own jobs (prices, analysis, grading) usually carry them in for free.
export const FOLD_AFTER_MS = 30 * 60000;
export async function foldStep(env, now = new Date()) {
  const base = env.HUB.raw || env.HUB; let r;
  try { r = await base.list({ prefix: 'fix:' }); } catch (e) { return null; }
  for (const { name } of (r.keys || []).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const key = name.slice(4); if (!isDayKey(key) && key !== 'analyst') continue;
    const [raw, fix] = await Promise.all([base.get(key, 'json'), base.get(name, 'json')]);
    if (!raw || !fix) continue;
    const ats = key === 'analyst' ? (fix.items || []).filter(e => e.at > (raw.fxAt || 0)).map(e => e.at)
      : [...liveCards(raw, fix).map(([, e]) => e.at), ...(liveDay(raw, fix) ? [fix.day.at] : [])];
    if (!ats.length || now.getTime() - Math.max(...ats) < FOLD_AFTER_MS) continue;
    const out = applyFor(key, raw, fix);
    if (sameJson({ ...out, fxAt: 0 }, { ...raw, fxAt: 0 })) continue; // the cron already did the same: nothing to save
    await base.put(key, JSON.stringify(out));
    return { folded: key, patches: ats.length };
  }
  return null;
}
