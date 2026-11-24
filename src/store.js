// KV access for one request or one cron run: every write is counted (the free plan allows WRITE_LIMIT a day), a second write of the
// same key waits out the rest of the second KV allows per key, and coalesce() holds back saves of the same record so a run writes it once.
import { stampPut } from './summaries.js';

export const WRITE_LIMIT = 1000; // Cloudflare free plan: KV writes per UTC day

// Counts this request's KV writes so the Status tab can show how close the day is to the limit.
// The count is saved with ONE extra write at the end, and only when something was written.
// What a key's write is for, for the per-job breakdown (meta:writes.by): soccer day cards, hockey day cards, the Analyst, and so on.
// Bookkeeping is split by record, so the sweep can see which one costs saves.
const META = { 'meta:writes': 'write counter', 'meta:synced': 'sync times', 'meta:errors': 'sync problems', 'meta:fb': 'forebet', 'meta:unm': 'unmatched games', 'meta:joberrors': 'job errors' };
const META_KIND = s => `bookkeeping: ${META[s] || 'other'}`;
export const writeKind = k => { const s = String(k); return s.startsWith('fix:') ? 'button saves' : s.startsWith('nhl:') ? 'hockey' : s.startsWith('day:') ? 'soccer days' : s === 'analyst' ? 'analyst'
  : s.startsWith('res:') ? 'results sync' : s.startsWith('rat:') ? 'v4 ratings' : s.startsWith('sm:') ? 'sportsmole' : s.startsWith('sweep:') ? 'stats files' : s.startsWith('push') ? 'alerts' : s.startsWith('meta:') ? META_KIND(s) : 'other'; };
const SAME_KEY_MS = 1100;
const addBy = (a, b) => { const o = { ...(a || {}) }; for (const [k, v] of Object.entries(b || {})) o[k] = (o[k] || 0) + v; return o; };
export function counted(env) {
  const base = env.HUB; let n = 0, by = {};
  const hub = Object.create(base);
  hub.get = (...a) => base.get(...a);
  hub.list = (...a) => base.list(...a);
  if (typeof base.getWithMetadata === 'function') hub.getWithMetadata = (...a) => base.getWithMetadata(...a);
  // A saved day also gets a write id as KV metadata (src/summaries.js stampPut): the cached Results and Trends summaries see from the
  // key listing which days changed. No extra write.
  // KV takes one write a second to the same key (a faster one fails with 429): a run's second save of a key waits out the rest of that second.
  // Only on Cloudflare (caches is there); Node tests do not wait.
  const lastPut = new Map();
  hub.put = async (...a) => {
    const t = lastPut.get(a[0]), wait = t == null || typeof caches === 'undefined' ? 0 : SAME_KEY_MS - (Date.now() - t);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    n++; const k = writeKind(a[0]); by[k] = (by[k] || 0) + 1; const o = stampPut(a[0], a[2]);
    try { return await (o === undefined ? base.put(a[0], a[1]) : base.put(a[0], a[1], o)); } finally { lastPut.set(a[0], Date.now()); }
  };
  return { env: { ...env, HUB: hub }, flush: async () => {
    if (!n) return;
    const d = new Date().toISOString().slice(0, 10);
    // Counting must not eat the budget it counts: keep a running tally in the (free) edge cache and
    // save it to KV only once about 15 writes have piled up.
    let pending = n, pby = by;
    const cache = typeof caches !== 'undefined' ? caches.default : null, ck = new Request(`https://hub.local/writes/${d}`);
    if (cache) { try { const r = await cache.match(ck); if (r) { const x = readPending(await r.text()); pending += x.n; pby = addBy(by, x.by); } } catch (e) { /* count from this run only */ } }
    if (cache && pending < 15) { try { await cache.put(ck, new Response(JSON.stringify({ n: pending, by: pby }), { headers: { 'cache-control': 'max-age=86400' } })); return; } catch (e) { /* fall through and save */ } }
    const c = (await base.get('meta:writes', 'json').catch(() => null)) || {}, same = c.d === d;
    // y: the day before's saved total and breakdown, kept at the rollover inside the same save (no extra write) for the health report
    const y = same ? c.y : c.d ? { d: c.d, n: c.n || 0, by: c.by || {} } : undefined;
    await base.put('meta:writes', JSON.stringify({ d, n: (same ? c.n : 0) + pending + 1, by: addBy(addBy(same ? c.by : {}, pby), { 'bookkeeping: write counter': 1 }), ...(y ? { y } : {}) })).catch(() => {});
    if (cache) { try { await cache.delete(ck); } catch (e) { /* ignore */ } }
  } };
}
// the cached tally: {n, by} (older runs saved a bare number)
const readPending = t => { try { const j = JSON.parse(t); return typeof j === 'number' ? { n: j, by: {} } : { n: Number(j.n) || 0, by: j.by || {} }; } catch (e) { return { n: Number(t) || 0, by: {} }; } };

export async function pendingWrites(d) {
  try { if (typeof caches === 'undefined') return 0; const r = await caches.default.match(new Request(`https://hub.local/writes/${d}`)); return r ? readPending(await r.text()).n : 0; } catch (e) { return 0; }
}
// Writes used today (UTC day, the free plan's day): the saved count plus this server's not-yet-saved tally. A close estimate: other
// servers can each hold up to 14 not-yet-saved writes, which is why saver mode starts early (SAVER_AT).
export async function writesToday(hub, now = new Date()) {
  const d = now.toISOString().slice(0, 10), w = await hub.get('meta:writes', 'json').catch(() => null);
  // yesterday: the saved total for the UTC day before (the saved count only: each location's last unsaved tally is not in it), or null
  const yd = new Date(Date.parse(d + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
  const y = !w ? null : w.d === d ? (w.y && w.y.d === yd ? w.y : null) : w.d === yd ? { d: w.d, n: w.n || 0, by: w.by || {} } : null;
  return { used: (w && w.d === d ? w.n : 0) + await pendingWrites(d), by: w && w.d === d ? w.by || {} : {}, yesterday: y };
}

// Saves of one record held back and made once (the lineup burst saves each day once, however many leagues it read on it).
// read(key) is asked once per key, and every get() of that key hands back the same object, so each job changes the copy the next one
// sees. mark(key) notes it changed; flush() writes each marked record once, in the order first marked, and answers
// [{ key, error? }] (one failed save does not stop the others).
export function coalesce(read, write) {
  const got = new Map(), dirty = new Set();
  return {
    get: async key => { if (!got.has(key)) got.set(key, await read(key)); return got.get(key); },
    mark: key => { dirty.add(key); },
    flush: async () => {
      const out = [];
      for (const key of dirty) { try { await write(key, got.get(key)); out.push({ key }); } catch (e) { out.push({ key, error: String((e && e.message) || e).slice(0, 120) }); } }
      dirty.clear();
      return out;
    },
  };
}
