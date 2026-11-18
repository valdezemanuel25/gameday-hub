// Full-history summaries, kept instead of rebuilt (Nov 18, 2026, audit P6). The Results tab (tally, nhlTally), both Trends tabs
// (buildSoccerTrends, buildTrends), the hockey backup and the nightly sweep each read and parse EVERY saved day: about 30 ms of CPU at 35
// days and 70 to 110 ms at 120, against the free plan's 10 ms. Those functions are unchanged; their answer is now kept in this isolate's
// memory and in the free edge cache (caches.default, no KV writes) under a stamp of what it was built from, and given back while that
// stamp holds.
//
// The stamp. Every save of a day (`day:<date>`, `nhl:day:<date>`) goes through the write counter in src/worker.js (counted()), which
// now gives the key a write id as KV metadata ({ w }, no extra write: it rides on the save). KV's list() returns each key's metadata
// for free, so one list call says which days were saved since the last look. A changed day is read; if it still has an open game it
// is reduced to its "settled view": every finished, graded or void card in full, which is all tally() and nhlTally() read, and for the
// Trends reads also the identity of the open games (id, league, clubs, kickoff: streaks and rest days count them). That is all the
// summaries read from days other than the one a Trends read is for (dayPart). The stamp is a hash of those, plus the write id of the
// Trends date's day (its open games' prices feed the read), the summary's kind and date, SUM_VERSION and the deployed version's id
// (env.CF_VERSION_METADATA, so a deploy that changes the code starts afresh). So a price read or a re-analysis of an unfinished game
// does not throw the summary away; a grade, a void, a close or an early-payout lead on a finished card does.
// The write id -> settled-view hash table (the "memo") is kept in memory and in the edge cache, so an unchanged day is never read again.
//
// Why not a version number bumped at grading in the edge cache: the edge cache is per data centre, and the cron grades wherever
// Cloudflare runs it, so the visitor's data centre would never see the bump. The KV metadata is global, and needs no edit in gradeLeague.
// A day saved before this change has no write id: it is taken as unchanged until its next save, which adds one (every save in the
// Worker goes through counted()). As a backstop each kept answer expires after MAX_AGE anyway.
// Nothing is cached when caches is undefined (Node tests): the summary is built as before. A failed build is never kept.
// If the day data ever moves to other keys merged on read, add their prefix to STAMPED and their keys to the stamp.

export const SUM_VERSION = 1;                 // bump to drop every kept summary without a deploy
export const STAMPED = ['day:', 'nhl:day:'];  // saves under these prefixes carry a write id
export const MAX_AGE = 12 * 3600;             // seconds a kept summary may be served at most (backstop)
const MEMO_AGE = 7 * 86400, MEM_OUT = 12;     // the memo's life in the edge cache; summaries kept in this isolate's memory

// ---- saving: the write id ----
export const isStamped = k => STAMPED.some(p => String(k).startsWith(p));
export const writeId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
// The options for a KV put of `key`: a stamped key gets { metadata: { w } } unless the caller set metadata itself.
export function stampPut(key, opts) {
  if (!isStamped(key) || (opts && opts.metadata != null)) return opts;
  return { ...(opts || {}), metadata: { w: writeId() } };
}

// ---- reading ----
// Every key under a prefix with its metadata, page by page (list() returns at most 1,000 keys a call), in name (= date) order.
export async function listKeys(hub, prefix) {
  const out = []; let cursor = null;
  do {
    const r = await hub.list(cursor ? { prefix, cursor } : { prefix });
    for (const k of (r && r.keys) || []) out.push(k);
    cursor = r && r.list_complete === false && r.cursor ? r.cursor : null;
  } while (cursor);
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
const wOf = m => (m && typeof m === 'object' && m.w ? String(m.w) : '-');
// Read days with their write id: [{ name, day, w }] in the order given. getWithMetadata where the binding has it (Workers KV does).
export function readKeys(hub, names) {
  return Promise.all(names.map(async name => {
    if (typeof hub.getWithMetadata === 'function') { const r = await hub.getWithMetadata(name, 'json'); return { name, day: r ? r.value : null, w: wOf(r && r.metadata) }; }
    return { name, day: await hub.get(name, 'json'), w: '-' };
  }));
}
// Every saved day under a prefix, oldest first (for tally / nhlTally when no days are handed in).
export async function loadDays(hub, prefix) {
  const ks = await listKeys(hub, prefix);
  return (await Promise.all(ks.map(k => hub.get(k.name, 'json')))).filter(Boolean);
}

// ---- the stamp ----
const settled = c => c && typeof c === 'object' && (c.final || c.grade || c.void);
// What the summaries read from a day other than a Trends date: finished, graded and void cards in full; with ids, the open games by
// identity too (the Trends reads count them), else not at all (tally and nhlTally skip them).
export function settledView(day, ids = true) {
  if (!day || typeof day !== 'object') return null;
  const cards = Array.isArray(day.cards) ? day.cards : [];
  return { date: day.date, cards: ids ? cards.map(c => (settled(c) || !c || typeof c !== 'object' ? c : { id: c.id, league: c.league, home: c.home, away: c.away, hAbbr: c.hAbbr, aAbbr: c.aAbbr, kickoff: c.kickoff })) : cards.filter(settled) };
}
// One day's part of the stamp, "<results part> <trends part>". A day with an open game is described by its settled views' hashes,
// because the cron saves it often (prices, re-analysis) without changing anything finished. A day whose games are all finished or
// void can only change by a save, so its write id is enough and nothing is hashed (hashing every day costs more CPU than building the
// tally); a day saved before the write ids existed ('-') has not been saved since.
export async function dayPart(day, w) {
  if (!day || typeof day !== 'object') return 'none none';
  const cards = Array.isArray(day.cards) ? day.cards : [];
  if (cards.every(settled)) { const t = w === '-' ? '-' : `w${w}`; return `${t} ${t}`; }
  return `${await digest(JSON.stringify(settledView(day, false)))} ${await digest(JSON.stringify(settledView(day, true)))}`;
}
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
export async function digest(s) {
  try { if (globalThis.crypto && globalThis.crypto.subtle) return hex(await globalThis.crypto.subtle.digest('SHA-1', new TextEncoder().encode(s))).slice(0, 24); } catch (e) { /* below */ }
  let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return 'f' + (h >>> 0).toString(36);
}

// ---- where summaries are kept ----
const MEM = { memo: new Map(), out: new Map() }; // this isolate's memory: prefix -> Map(id -> view hash); stamp -> text
export function clearSummaries() { MEM.memo.clear(); MEM.out.clear(); }
const edge = () => { try { return typeof caches !== 'undefined' && caches && caches.default ? caches.default : null; } catch (e) { return null; } };
const memoUrl = prefix => new Request(`https://hub.local/sum-memo/${encodeURIComponent(prefix)}`);
const outUrl = (kind, stamp) => new Request(`https://hub.local/sum/${kind}/${stamp}`);
async function cacheText(cache, req) { try { const r = await cache.match(req); return r ? await r.text() : null; } catch (e) { return null; } }
async function cachePut(cache, req, text, secs) { try { await cache.put(req, new Response(text, { headers: { 'content-type': 'application/json', 'cache-control': `max-age=${secs}` } })); } catch (e) { /* kept nowhere: built again next time */ } }

// The summary `kind` built by build(days) from every day under `prefix` (oldest first), kept while its stamp holds.
//   date:   a Trends date (its day's open games count too); a Trends summary also counts the open games' identity on every day
//   values: the days already read ([{ name, day, w }], readKeys), so nothing is read twice (the hockey backup)
// Returns { text (the JSON answer), value (the object, when it was built here), cache: 'off' | 'miss' | 'mem' | 'edge' }.
export async function summary(env, { kind, prefix, date = null, build, values = null }, cache = edge()) {
  const hub = env.HUB;
  const keys = values ? values.map(v => ({ name: v.name, metadata: v.w === '-' ? null : { w: v.w } })) : await listKeys(hub, prefix);
  const have = new Map((values || []).map(v => [v.name, v]));
  const readRest = async () => { const need = keys.filter(k => !have.has(k.name)).map(k => k.name); for (const v of await readKeys(hub, need)) have.set(v.name, v); };
  const make = async () => { await readRest(); const value = await build(keys.map(k => have.get(k.name)).filter(v => v && v.day).map(v => v.day)); return { value, text: JSON.stringify(value) }; };
  if (!cache) { const b = await make(); return { ...b, cache: 'off' }; }

  const id = (name, w) => `${name}@${w}`;
  let memo = MEM.memo.get(prefix); if (!memo) MEM.memo.set(prefix, memo = new Map());
  let grew = false;
  const known = k => memo.has(id(k.name, wOf(k.metadata)));
  if (keys.some(k => !have.has(k.name) && !known(k))) { // another isolate may have seen these saves: take the edge cache's memo too
    const t = await cacheText(cache, memoUrl(prefix)); if (t) { try { for (const [k, g] of Object.entries(JSON.parse(t))) if (!memo.has(k)) memo.set(k, g); } catch (e) { /* unreadable: rebuilt */ } }
  }
  for (const v of await readKeys(hub, keys.filter(k => !have.has(k.name) && !known(k)).map(k => k.name))) have.set(v.name, v);
  // The stamp of the days as read (a day read now is described by its own write id; the others by the listing's).
  const stampNow = async () => {
    const parts = [kind, SUM_VERSION, (env.CF_VERSION_METADATA && env.CF_VERSION_METADATA.id) || '', date || ''];
    for (const k of keys) {
      const v = have.get(k.name), w = v ? v.w : wOf(k.metadata); let g = memo.get(id(k.name, w));
      if (g == null) { g = v ? await dayPart(v.day, w) : 'none none'; memo.set(id(k.name, w), g); grew = true; }
      parts.push(`${k.name}=${String(g).split(' ')[date ? 1 : 0]}`); // a Trends summary (it has a date) takes the part with the open games' identity
      if (date && k.name === prefix + date) parts.push(`open@${w}`);
    }
    return digest(parts.join('\n'));
  };
  const saveMemo = async () => {
    if (!grew) return; grew = false;
    const live = new Set(keys.map(k => { const v = have.get(k.name); return id(k.name, v ? v.w : wOf(k.metadata)); }));
    for (const k of [...memo.keys()]) if (!live.has(k)) memo.delete(k); // only the days as they are now
    await cachePut(cache, memoUrl(prefix), JSON.stringify(Object.fromEntries(memo)), MEMO_AGE);
  };
  const stamp = await stampNow();
  const mem = MEM.out.get(`${kind}/${stamp}`);
  if (mem && Date.now() - mem.at < MAX_AGE * 1000) { await saveMemo(); return { text: mem.text, cache: 'mem' }; }
  const kept = await cacheText(cache, outUrl(kind, stamp));
  if (kept != null) { remember(kind, stamp, kept); await saveMemo(); return { text: kept, cache: 'edge' }; }

  const b = await make(); // a build that throws is not kept (the route answers its error)
  const stamp2 = await stampNow(); // the days actually used: a read can be newer than the listing
  if (b.value && typeof b.value === 'object' && !b.value.error) { remember(kind, stamp2, b.text); await cachePut(cache, outUrl(kind, stamp2), b.text, MAX_AGE); }
  await saveMemo();
  return { ...b, cache: 'miss' };
}
function remember(kind, stamp, text) {
  MEM.out.set(`${kind}/${stamp}`, { text, at: Date.now() });
  while (MEM.out.size > MEM_OUT) MEM.out.delete(MEM.out.keys().next().value);
}
// The object of a summary() answer (parsed from the kept text on a hit).
export const valueOf = s => (s.value !== undefined ? s.value : JSON.parse(s.text));
