// Answering requests: who is signed in (the password, the session cookie), the security headers, and every route.
import { v2, grade } from './model.js';
import { supports as v4Supports, refreshRatings } from './v4.js';
import { TZ, LEAGUES, VISIBLE, DOMESTIC, CUP_MODEL, leagueBySlug, syncLeague, backfillShots, rawOdds, shotsCoverage } from './data.js';
import { forebetFetch, FB_PAGES } from './forebetpage.js';
import { analyze as analyzeBet, loadCards as betCards, addBet, listBets, changeBet, getBets } from './bets.js';
import { listAnalyst } from './analyst.js';
import { fetchSharp, SHARP } from './btts.js';
import { pinnState } from './pinn.js';
import { getVapid, getPush, addSub, removeSub, sendAll } from './push.js';
import { homeSummary } from './home.js';
import { buildTrends } from './trends.js';
import { buildSoccerTrends } from './trendssoccer.js';
import { summary, valueOf, listKeys, readKeys } from './summaries.js';
import { nhlStep, nhlForebet, nhlStatus, nhlSetLine, nhlOddsRaw, gkCheck, nhlCardClose } from './nhl.js';
import { readErrors } from './errlog.js';
import { WRITE_LIMIT, pendingWrites } from './store.js';
import { BTTS_RESERVE, SAVER_AT, SHARP_NOTE, addDays, analyzeLeague, assignCandidate, backupAnalyst, cachePut, candidates, forebetPaste, gradeLeague, health, nhlTotals, noteLeague, num, oddsKeys, pinnCheck, priceWhy, readCredits, readSharpNote, refreshBtts, refreshCardClose, refreshOdds, smLeague, soccerTotals, syncNote, tally, today, viaOddsKey } from './jobs.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
// A summary() answer (src/summaries.js) as sent: its kept text, and x-hub-cache saying where it came from (mem / edge / miss / off).
const jsonText = s => new Response(s.text, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-hub-cache': s.cache } });

// The password is ADMIN_TOKEN. It is accepted from the sign-in page (which sets a session cookie), from the x-admin-token header,
// and from HTTP Basic (any username) so scripts keep working. With no ADMIN_TOKEN set, nothing is let in.
// Sessions you can end. The cookie (__Host-hub_s) is "v2.<issued at, seconds>.<HMAC>", signed with a
// key made from the password over the issue time and SESSION_EPOCH, so nothing is stored and no KV write is ever made for it:
//   * it is refused once it is older than SESSION_MAX_DAYS (default 180), or dated more than 5 minutes ahead;
//   * a device in use stays in: a page opened with a session older than 30 days (or half SESSION_MAX_DAYS, if that is shorter) gets a
//     fresh cookie on that answer;
//   * changing SESSION_EPOCH (a var or secret, default "0") signs every device out without changing the password; changing the
//     password does too.
// Changeover: the old cookie (hub_s, one HMAC of a fixed phrase, the same on every device) is still taken until OLD_COOKIE_UNTIL and
// only while SESSION_EPOCH is unset or "0". A device that shows it gets the new cookie and the old one cleared.
const COOKIE = '__Host-hub_s', OLD_COOKIE = 'hub_s';
export const OLD_COOKIE_UNTIL = '2026-12-20'; // the old cookie is refused from 00:00 UTC on this day (about 30 days after the change)
const SESSION_DAYS = 180, RENEW_DAYS = 30, SKEW_S = 300, COOKIE_CAP_DAYS = 400; // browsers cap a cookie's Max-Age at 400 days
const enc = s => new TextEncoder().encode(s);
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
async function hmac(key, msg) {
  const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? enc(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc(msg));
}
const epochOf = env => String(env.SESSION_EPOCH == null ? '' : env.SESSION_EPOCH).trim() || '0';
export const sessionDays = env => { const d = Number(env.SESSION_MAX_DAYS); return Number.isFinite(d) && d > 0 ? d : SESSION_DAYS; };
const renewAfterS = env => Math.min(RENEW_DAYS, sessionDays(env) / 2) * 86400;
const oldSessionValue = async env => hex(await hmac(env.ADMIN_TOKEN, 'game-day-hub session v1'));
// The cookie's value for a session issued at iat (seconds). Exported for test/auth.mjs.
export async function sessionToken(env, iat) {
  const key = await hmac(env.ADMIN_TOKEN, 'game-day-hub session key v2');
  return `v2.${iat}.${hex(await hmac(key, `v2|${iat}|${epochOf(env)}`))}`;
}
const cookieLine = (name, value, maxAge) => `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
const newSession = async (env, now = Date.now()) => cookieLine(COOKIE, await sessionToken(env, Math.floor(now / 1000)), Math.round(Math.min(sessionDays(env), COOKIE_CAP_DAYS) * 86400));
const clearCookie = name => cookieLine(name, '', 0);
const cookieOf = (header, name) => { for (const part of String(header || '').split(';')) { const s = part.trim(); if (s.startsWith(name + '=')) return s.slice(name.length + 1); } return null; };
// The session a Cookie header carries: { v: 2, age } (seconds since issue), { v: 1 } (the old cookie), or null. Exported for test/auth.mjs.
export async function cookieSession(env, header, now = Date.now()) {
  if (!env.ADMIN_TOKEN) return null;
  const t = Math.floor(now / 1000), v = cookieOf(header, COOKIE), m = v && /^v2\.(\d{1,12})\.[0-9a-f]{64}$/.exec(v);
  if (m) {
    const age = t - Number(m[1]);
    if (age <= sessionDays(env) * 86400 && age >= -SKEW_S && await same(v, await sessionToken(env, Number(m[1])))) return { v: 2, age };
  }
  const o = cookieOf(header, OLD_COOKIE);
  if (o && /^[0-9a-f]{64}$/.test(o) && epochOf(env) === '0' && now < Date.parse(OLD_COOKIE_UNTIL + 'T00:00:00Z') && await same(o, await oldSessionValue(env))) return { v: 1 };
  return null;
}
// Secrets are compared as SHA-256 digests (always 32 bytes), so the time a check takes gives away neither where a guess first goes
// wrong nor how long the password is (the old character loop stopped at once on a length mismatch). Exported for test/security.mjs.
export async function same(a, b) {
  const t = new TextEncoder(), [x, y] = await Promise.all([a, b].map(s => crypto.subtle.digest('SHA-256', t.encode(String(s)))));
  const u = new Uint8Array(x), v = new Uint8Array(y); let d = 0; for (let i = 0; i < u.length; i++) d |= u[i] ^ v[i]; return d === 0;
}
// -> null (not signed in), { via: 'header' }, or the cookie's session (cookieSession)
async function authed(req, env) {
  if (!env.ADMIN_TOKEN) return null;
  if (req.headers.has('x-admin-token') && await same(req.headers.get('x-admin-token'), env.ADMIN_TOKEN)) return { via: 'header' };
  const h = req.headers.get('authorization') || '';
  if (h.startsWith('Basic ')) {
    let d = null; try { d = atob(h.slice(6)); } catch (e) { /* fall through to the cookie */ }
    if (d != null && await same(d.slice(d.indexOf(':') + 1), env.ADMIN_TOKEN)) return { via: 'header' };
  }
  return cookieSession(env, req.headers.get('cookie'), Date.now());
}
// The cookies a signed-in answer sets: the old cookie swapped for a new one (on a page or a data call), or a fresh cookie when a page
// is opened with a session older than the renewal age. "A page" is a browser opening a document, so never the data calls (/api/) or a
// page's scripts and pictures. A header sign-in (scripts) never gets a cookie.
const isPage = (req, p) => req.method === 'GET' && !p.startsWith('/api/') && (req.headers.get('sec-fetch-dest') === 'document' || /\btext\/html\b/.test(req.headers.get('accept') || ''));
async function sessionCookies(req, env, p, s) {
  if (s.v === 1 && (isPage(req, p) || p.startsWith('/api/'))) return [await newSession(env), clearCookie(OLD_COOKIE)];
  if (s.v === 2 && s.age > renewAfterS(env) && isPage(req, p)) return [await newSession(env)];
  return null;
}
// Added by fetch() once the route has answered (handle() has many exits). An answer that sets a cookie is marked private, no-store, so
// no cache keeps it; the service worker keeps nothing either (public/sw.js).
const pendingCookies = new WeakMap();
function withCookies(r, list) {
  if (!r || !list || !list.length || r.status === 101) return r;
  const out = new Response(r.body, r);
  for (const c of list) out.headers.append('set-cookie', c);
  out.headers.set('cache-control', 'private, no-store');
  return out;
}
// The health report notes a short password (under 16 characters). It cannot be required without locking the owner out, so it is only a
// warning, and it never shows the password or its length.
const signInHealth = env => ({ weakPassword: String(env.ADMIN_TOKEN || '').length < 16, sessionDays: sessionDays(env) });
// What loads without signing in: the sign-in page itself and the files a phone or desktop needs to install the app.
const PUBLIC_FILES = new Set(['/login.html', '/manifest.webmanifest', '/sw.js', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/apple-touch-icon.png', '/favicon.ico']);
// Where to go after signing in: only a path on this site. A backslash is refused because browsers read "/\evil.example" as "//evil.example".
const safeNext = n => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') && !n.includes('\\') && !/[\u0000-\u001f]/.test(n) && !n.startsWith('/login') ? n : '/home');

// Sent on every answer: stay on https, no guessing file types, no other site may frame the Hub or receive its forms, no camera /
// microphone / location / payment for any page, no window shared with another site's tab, and no search engine listing (a private site).
const SEC_HEADERS = {
  'strict-transport-security': 'max-age=31536000',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'SAMEORIGIN',
  'referrer-policy': 'same-origin',
  'content-security-policy': "frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'",
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'cross-origin-opener-policy': 'same-origin',
  'x-robots-tag': 'noindex, nofollow',
};
// Cross-site guard. The sign-in cookie is SameSite=Lax, which keeps it off another site's form posts but not off
// (a) a sibling subdomain (same-site, e.g. another *.workers.dev Worker if that suffix were ever treated as one site) or (b) another
// site's plain links, which would let any page open data routes, some of which spend a paid daily quota (/api/pinn-check: 1 of 100
// Pinnacle requests) or sign the device out (/logout). The Hub's own pages are same-origin; scripts send neither header. -> true to refuse.
export function crossSite(req, url) {
  const site = req.headers.get('sec-fetch-site'), origin = req.headers.get('origin'), write = req.method !== 'GET' && req.method !== 'HEAD';
  if ((site === 'cross-site' || site === 'same-site') && (write || url.pathname.startsWith('/api/') || url.pathname === '/logout')) return true;
  return write && origin != null && origin !== url.origin; // 'null' (a sandboxed frame) is refused too
}
// A ?date= that is not a calendar date never reaches a KV key (day:<date>) or ESPN's address (?dates=).
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function withSecurity(r) {
  if (!r || r.status === 101) return r;
  try { for (const [k, v] of Object.entries(SEC_HEADERS)) r.headers.set(k, v); return r; } catch (e) { /* a file from ASSETS has locked headers: copy it */ }
  try { const out = new Response(r.body, r); for (const [k, v] of Object.entries(SEC_HEADERS)) out.headers.set(k, v); return out; } catch (e) { return r; }
}
// Password guessing: LOGIN_LIMIT and API_LIMIT are rate-limit bindings in wrangler.toml, counted per visitor address. Without the
// binding (tests, local runs) nothing is limited, and a limiter that fails never locks the owner out.
const visitor = req => req.headers.get('cf-connecting-ip') || 'unknown';
async function limited(binding, key) {
  if (!binding || typeof binding.limit !== 'function') return false;
  try { return !(await binding.limit({ key })).success; } catch (e) { return false; }
}
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$/;

// ---- routes ----
// PUBLIC_ROUTES: everything that answers without signing in, in the order handle() tries them. match(req, path, env) picks the request;
// handle(req, env, url) answers it, or answers nothing to fall through. EVERY OTHER ROUTE (all of handle() after the sign-in check: the
// pages, /api/*, the files of public/ not in PUBLIC_FILES) needs a signed-in session, the password in a header, or HTTP Basic.
export const PUBLIC_ROUTES = [
  // Sign in once: a correct password sets a session cookie (SESSION_MAX_DAYS, renewed while in use), so the installed app and the
  // browser open straight in. Only the new cookie is set; an old one on this device is cleared.
  { name: 'sign in', method: 'POST', path: '/login', match: (req, p) => p === '/login' && req.method === 'POST', handle: async (req, env) => {
    let f; try { f = await req.formData(); } catch (e) { f = null; }
    const pw = f ? String(f.get('password') || '') : '', next = safeNext(f && String(f.get('next') || ''));
    // Counted before the password is looked at, so a guesser is stopped whether or not a guess is right.
    if (await limited(env.LOGIN_LIMIT, 'login:' + visitor(req))) return new Response(null, { status: 303, headers: { location: '/login?e=2' + (next !== '/' ? '&next=' + encodeURIComponent(next) : ''), 'cache-control': 'no-store', 'retry-after': '60' } });
    if (!env.ADMIN_TOKEN || !(await same(pw, env.ADMIN_TOKEN))) return new Response(null, { status: 303, headers: { location: '/login?e=1' + (next !== '/' ? '&next=' + encodeURIComponent(next) : ''), 'cache-control': 'no-store' } });
    const h = new Headers({ location: next, 'cache-control': 'no-store' });
    h.append('set-cookie', await newSession(env)); h.append('set-cookie', clearCookie(OLD_COOKIE));
    return new Response(null, { status: 303, headers: h });
  } },
  { name: 'sign out', method: 'any', path: '/logout', match: (req, p) => p === '/logout', handle: async () => { // clears both the new cookie and the old one
    const h = new Headers({ location: '/login', 'cache-control': 'no-store' });
    h.append('set-cookie', clearCookie(COOKIE)); h.append('set-cookie', clearCookie(OLD_COOKIE));
    return new Response(null, { status: 303, headers: h });
  } },
  // iPhones also look for the home-screen icon at these fixed names; give them the same picture
  { name: 'home-screen icon names', method: 'GET', path: '/apple-touch-icon(-precomposed|-180x180|-180x180-precomposed).png', match: (req, p) => req.method === 'GET' && /^\/apple-touch-icon(-precomposed|-180x180|-180x180-precomposed)\.png$/.test(p),
    handle: async (req, env, url) => env.ASSETS.fetch(new Request(new URL('/apple-touch-icon.png', url.origin))) },
  { name: 'sign-in page and install files', method: 'GET', path: ['/login', ...PUBLIC_FILES].join(' '), match: (req, p) => req.method === 'GET' && (p === '/login' || PUBLIC_FILES.has(p)),
    handle: async (req, env) => env.ASSETS.fetch(req) }, // /login is public/login.html (the assets handler serves it without the .html)
  // Hub health for the nightly sweep: read-only, with its own secret (HEALTH_TOKEN) so the scheduled task never holds the password.
  // Every try at this token is counted. Without the key (or with a wrong one) it answers nothing: the request goes on to the sign-in check.
  { name: 'health report with HEALTH_TOKEN', method: 'GET', path: '/api/health?k=<HEALTH_TOKEN> (or x-health-token)', match: (req, p, env) => req.method === 'GET' && p === '/api/health' && !!env.HEALTH_TOKEN,
    handle: async (req, env, url) => {
      const ht = String(url.searchParams.get('k') || req.headers.get('x-health-token') || '');
      if (!ht) return null;
      if (await limited(env.API_LIMIT, 'health:' + visitor(req))) return new Response(JSON.stringify({ error: 'Too many requests. Wait a minute and try again.' }), { status: 429, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'retry-after': '60' } });
      if (await same(ht, env.HEALTH_TOKEN)) return json(await health(env, true));
      return null;
    } },
];

export async function handle(req, env) {
  const url = new URL(req.url);
  const p = url.pathname;
  const q = k => url.searchParams.get(k);
  if (crossSite(req, url)) return p.startsWith('/api/') ? json({ error: 'Cross-site request refused' }, 403) : new Response('Cross-site request refused.', { status: 403, headers: { 'cache-control': 'no-store' } });

  // The routes that answer without signing in (PUBLIC_ROUTES), tried in order. A route that answers nothing (a wrong health key) falls
  // through to the sign-in check like any other request.
  for (const r of PUBLIC_ROUTES) {
    if (!r.match(req, p, env)) continue;
    const out = await r.handle(req, env, url);
    if (out) return out;
  }
  // The password can also arrive in a header (scripts). Those tries are counted too, or the header would be a way around the sign-in limit.
  if ((req.headers.has('x-admin-token') || (req.headers.get('authorization') || '').startsWith('Basic ')) && await limited(env.API_LIMIT, 'api:' + visitor(req))) {
    return new Response(JSON.stringify({ error: 'Too many requests. Wait a minute and try again.' }), { status: 429, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'retry-after': '60' } });
  }
  // Whole site is private: page and data both need the password.
  const signed = await authed(req, env);
  if (!signed) {
    if (p.startsWith('/api/')) return json({ error: 'Bad or missing admin token' }, 401);
    if (req.method === 'GET') return new Response(null, { status: 302, headers: { location: '/login' + (p !== '/' ? '?next=' + encodeURIComponent(p + url.search) : ''), 'cache-control': 'no-store' } });
    return new Response('Sign in to open Game Day Hub.', { status: 401, headers: { 'cache-control': 'no-store' } });
  }
  { const sc = await sessionCookies(req, env, p, signed); if (sc) pendingCookies.set(req, sc); } // old cookie swapped, or renewed (fetch() adds them)
  if (p.startsWith('/api/') && q('date') && !DATE_RE.test(q('date'))) return json({ error: 'Pass ?date=YYYY-MM-DD' }, 400);

  // Opening the Hub lands on the Home carousel; Soccer lives at /soccer (old installs and bookmarks that open / land on Home too)
  if (req.method === 'GET' && p === '/') return new Response(null, { status: 302, headers: { location: '/home' + url.search, 'cache-control': 'no-store' } });
  if (req.method === 'GET' && p === '/soccer') return env.ASSETS.fetch(new Request(new URL('/' + url.search, url.origin), req));

  if (p.startsWith('/api/push/')) { // alerts to the installed app: which devices, and a test message
    try {
      if (req.method === 'GET' && p === '/api/push/key') return json({ key: (await getVapid(env, url.origin)).pub, devices: (await getPush(env)).subs.length });
      if (req.method !== 'POST') return json({ error: 'Not found' }, 404);
      const b = await req.json().catch(() => ({}));
      if (p === '/api/push/subscribe') return json(await addSub(env, b.sub, b.label));
      if (p === '/api/push/unsubscribe') return json(await removeSub(env, String(b.endpoint || '')));
      if (p === '/api/push/test') return json({ ok: true, ...(await sendAll(env, { title: 'Game Day Hub', body: 'Notifications are on for this device.', tag: 'test', url: '/home' })) });
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
  if (p === '/api/trends') { // soccer Trends tab: the two situations, and a read on each game of the date that is in one (kept: src/summaries.js)
    const date = q('date') || today();
    return jsonText(await summary(env, { kind: 'trends', prefix: 'day:', date, build: days => buildSoccerTrends(days, date) }));
  }
  if (p === '/api/tally') return jsonText(await soccerTotals(env));
  if (p === '/api/brew') { // newsletter summaries: public/brew.json is rewritten daily by a scheduled task
    try { const r = await env.ASSETS.fetch(new Request(new URL('/brew.json', url.origin))); const j = r.ok ? await r.json() : null; return json({ updated: j && j.updated || null, issues: Array.isArray(j && j.issues) ? j.issues : [] }); } catch (e) { return json({ updated: null, issues: [] }); }
  }
  if (p === '/api/health') return json(await health(env)); // signed in: the same read
  if (p === '/api/home') { // home screen carousel: today's counts and Best picks (display only)
    const d = today(), [sd, nd] = await Promise.all([env.HUB.get(`day:${d}`, 'json'), env.HUB.get(`nhl:day:${d}`, 'json')]);
    let issues = []; try { const r = await env.ASSETS.fetch(new Request(new URL('/brew.json', url.origin))); const j = r.ok ? await r.json() : null; issues = Array.isArray(j && j.issues) ? j.issues : []; } catch (e) {}
    return json(homeSummary({ soccer: sd && sd.cards, hockey: nd && nd.cards, brew: issues, today: d }));
  }
  if (p === '/api/candidates') return json(await candidates(q('date') || today(), env));
  if (p === '/api/pinn-check') { try { return json(await pinnCheck(env, String(url.searchParams.get('league') || ''))); } catch (e) { return json({ error: String(e && e.message || e) }, 500); } }
  if (p === '/api/odds-raw') { try { const lg = leagueBySlug(String(url.searchParams.get('league') || '')); if (!lg) return json({ error: 'Unknown league' }, 400); return json({ league: lg.slug, games: await rawOdds(lg.slug, String(url.searchParams.get('date') || '')) }); } catch (e) { return json({ error: String(e && e.message || e) }, 500); } }
  if (req.method === 'POST' && p === '/api/price-why') { try { const b = await req.json(); return json(await priceWhy(env, String(b.date || ''), String(b.league || ''), String(b.id || ''), new Date())); } catch (e) { return json({ kind: 'error', title: 'Check failed', detail: String(e && e.message || e).slice(0, 120) }); } }
  if (req.method === 'POST' && p === '/api/btts') { try { const b = await req.json(); return json(await refreshBtts(env, String(b.date || ''), String(b.league || ''), new Date())); } catch (e) { return json({ error: `Both score prices: ${e && e.message || e}` }, 500); } }
  if (req.method === 'POST' && p === '/api/odds-close') { try { const b = await req.json(); return json(await refreshCardClose(env, String(b.date || ''), String(b.league || ''), String(b.id || ''), new Date())); } catch (e) { return json({ error: `Final price: ${e && e.message || e}` }, 500); } }
  if (req.method === 'POST' && p === '/api/odds') { try { const b = await req.json(); return json(await refreshOdds(env, String(b.date || ''), String(b.league || ''), new Date())); } catch (e) { return json({ error: `Prices: ${e && e.message || e}` }, 500); } }
  if (req.method === 'POST' && p === '/api/assign') { try { const b = await req.json(); const lg = leagueBySlug(String(b.league || '')); if (!lg) return json({ error: 'Unknown league' }, 400); return json({ ok: true, ...(await assignCandidate(String(b.date || ''), lg.slug, String(b.id || ''), String(b.key || ''), env, new Date(), { dismiss: !!b.dismiss })) }); } catch (e) { return json({ error: `Assign: ${e && e.message ? e.message : e}` }, 500); } }
  if (p.startsWith('/api/bets')) { // bet analyzer and tracker
    try {
      if (req.method === 'GET' && p === '/api/bets') return json(await listBets(env));
      if (req.method !== 'POST') return json({ error: 'Not found' }, 404);
      const b = await req.json();
      // the 12-pick limit (src/bets.js analyze) is checked before the days are read: each leg's date used to cost a KV read first
      if (Array.isArray(b.legs) && b.legs.length > 12) return json({ error: 'A bet can have up to 12 picks.' }, 400);
      if (p === '/api/bets/analyze') return json(analyzeBet(await betCards(env, Array.isArray(b.legs) ? b.legs : []), b.legs));
      if (p === '/api/bets') return json(await addBet(env, b.legs, new Date(), b.source === 'model' ? 'model' : null));
      if (p === '/api/bets/delete' || p === '/api/bets/void') return json(await changeBet(env, String(b.id || ''), p.endsWith('delete') ? 'delete' : 'void'));
    } catch (e) { return json({ error: `Bets: ${e && e.message ? e.message : e}` }, 500); }
    return json({ error: 'Not found' }, 404);
  }
  if (req.method === 'POST' && p === '/api/analyst/sharp-check') { // which sharp books the Odds API plan returns: one call, 2 credits, no bets
    try { const lg = leagueBySlug(q('league') || 'eng.1'); if (!lg) return json({ error: 'Unknown league' }, 400); if (!oddsKeys(env).length) return json({ error: 'ODDS_API_KEY is not set' });
      const r = await viaOddsKey(env, key => fetchSharp(key, lg.slug, []));
      const out = { at: new Date().toISOString(), league: lg.slug, error: r.error || null, books: r.books || [], sharp: (r.books || []).filter(b => SHARP.includes(b)), games: 0, matched: 0, used: [], left: r.left ?? null, check: true };
      await cachePut(SHARP_NOTE, out, 2592000); return json(out);
    } catch (e) { return json({ error: `Sharp check: ${e && e.message ? e.message : e}` }, 500); } }
  if (p === '/api/analyst') { try { return json({ ...(await listAnalyst(env)), sharpNote: await readSharpNote(), sharpKey: oddsKeys(env).length > 0 }); } catch (e) { return json({ error: `Analyst: ${e && e.message ? e.message : e}` }, 500); } }
  if (p === '/api/nhl/day') { const date = q('date') || today(); return json((await env.HUB.get(`nhl:day:${date}`, 'json')) || { date, cards: [] }); }
  if (p === '/api/nhl/days') { // every saved hockey day, for the Export button
    const out = []; let cursor;
    do { const r = await env.HUB.list({ prefix: 'nhl:day:', cursor }); out.push(...r.keys.map(k => k.name.slice(8))); cursor = r.list_complete === false ? r.cursor : null; } while (cursor);
    return json({ days: out.sort() });
  }
  if (p === '/api/nhl/export') { // one request returns the whole hockey backup as a file download
    // each day is read and parsed once: the totals are built from (or found kept for) the same days
    const values = await readKeys(env.HUB, (await listKeys(env.HUB, 'nhl:day:')).map(k => k.name));
    const data = { exportedAt: new Date().toISOString(), note: 'Game Day Hub hockey backup. days = every saved NHL day (cards with model picks and results); totals = hockey results summary; analyst = the Analyst\'s hockey paper bets as saved.', days: values.map(v => v.day).filter(Boolean), totals: valueOf(await nhlTotals(env, values)), analyst: await backupAnalyst(env, 'nhl') };
    return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json', 'content-disposition': `attachment; filename="gameday-hub-hockey-${new Date().toISOString().slice(0, 10)}.json"`, 'cache-control': 'no-store' } });
  }
  if (p === '/api/backup-extra') return json({ analyst: await backupAnalyst(env, 'soccer'), bets: await getBets(env) }); // the soccer Export button: records kept outside the day cards
  if (p === '/api/nhl/tally') return jsonText(await nhlTotals(env));
  if (p === '/api/nhl/trends') { // Trends tab: how each situation has done over every saved hockey day, and a read on each game of the date (kept: src/summaries.js)
    const date = q('date') || today();
    return jsonText(await summary(env, { kind: 'nhltrends', prefix: 'nhl:day:', date, build: days => buildTrends(days, date) }));
  }
  if (req.method === 'POST' && p === '/api/nhl/line') { try { const b = await req.json(); return json(await nhlSetLine(env, String(b.date || ''), String(b.id || ''), b.line, new Date())); } catch (e) { return json({ error: `Line: ${e && e.message ? e.message : e}` }, 500); } }
  if (p === '/api/nhl/status') return json(await nhlStatus(env));
  if (p === '/api/nhl/gk-check') { try { return json(await gkCheck(env, String(url.searchParams.get('date') || today()))); } catch (e) { return json({ error: String(e && e.message || e) }, 500); } }
  if (p === '/api/nhl/odds-raw') { try { return json(await nhlOddsRaw(env, String(url.searchParams.get('date') || ''))); } catch (e) { return json({ error: String(e && e.message || e) }, 500); } }
  if (req.method === 'POST' && p === '/api/nhl/close') { try { const b = await req.json(); return json(await nhlCardClose(env, String(b.date || ''), String(b.id || ''), new Date())); } catch (e) { return json({ error: `Final price: ${e && e.message || e}` }, 500); } }
  if (req.method === 'POST' && p === '/api/nhl/forebet') { try { return json({ ok: true, ...(await nhlForebet(env, new Date(), fetch)) }); } catch (e) { return json({ error: `NHL Forebet: ${e && e.message ? e.message : e}` }, 500); } } // Status tab: Forebet only
  if (req.method === 'POST' && p === '/api/nhl/run') { try { let mode = 'all'; try { const b = await req.json(); if (b && (b.mode === 'analyze' || b.mode === 'results')) mode = b.mode; } catch (e) { /* no body: the old single button */ } return json({ ok: true, ...(await nhlStep(env, new Date(), fetch, { force: true, mode })) }); } catch (e) { return json({ error: `NHL: ${e && e.message ? e.message : e}` }, 500); } }
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
        const o = per[c.league] || (per[c.league] = { n: 0, sm: 0, tried: 0, fb: { '1x2': 0, ou: 0, btts: 0 }, nT: 0, fbT: { '1x2': 0, ou: 0, btts: 0 } });
        o.n++; if (c.sm) o.sm++;
        if (di === 0) { o.nT++; if (c.fb && c.fb.p) o.fbT['1x2']++; if (c.fb && c.fb.over != null) o.fbT.ou++; if (c.fb && c.fb.btts != null) o.fbT.btts++; } // today's games only: what the Update Forebet button asks for
        const tr = dd.smTried && dd.smTried[c.id]; if (tr > o.tried) o.tried = tr;
        if (c.fb && c.fb.p) o.fb['1x2']++; if (c.fb && c.fb.over != null) o.fb.ou++; if (c.fb && c.fb.btts != null) o.fb.btts++;
      }
    }
    const srcOf = l => {
      const o = per[l.slug] || { n: 0, sm: 0, tried: 0, fb: {} }, fb = {};
      if (FB_PAGES[l.slug]) for (const k of ['1x2', 'ou', 'btts']) { const m = (fbMeta || {})[`${l.slug}|${k}`]; if (m) fb[k] = { at: m.at, ok: !!m.ok, msg: m.msg || null, cov: [o.fb[k] || 0, o.n], covT: [(o.fbT || {})[k] || 0, o.nT || 0] }; }
      return { games: { today: (games[l.slug] || [0, 0])[0], tomorrow: (games[l.slug] || [0, 0])[1] }, sm: { tried: o.tried ? new Date(o.tried).toISOString() : null, found: o.sm, total: o.n }, fb: FB_PAGES[l.slug] ? fb : null };
    };
    return json({
      jobErrors: await readErrors(env.HUB), // the background job's last caught errors (src/errlog.js)
      now: Date.now(), btts: { key: oddsKeys(env).length > 0, credits: await readCredits(0), keys: oddsKeys(env).length, credits2: env.ODDS_API_KEY_2 ? await readCredits(1) : null, reserve: num(env.BTTS_RESERVE, BTTS_RESERVE) }, pinn: { key: !!env.PINNODDS_KEY, ...(await pinnState()) }, forebet: { pages: Object.keys(FB_PAGES), reads: fbMeta || {} }, writes: { used: (w && w.d === d ? w.n : 0) + await pendingWrites(d), limit: WRITE_LIMIT, resetsAtUtc: d + 'T24:00Z', by: w && w.d === d ? w.by || {} : {}, saverAt: Math.round(SAVER_AT * WRITE_LIMIT) },
      leagues: [...DOMESTIC, ...CUP_MODEL].map(l => ({ slug: l.slug, name: l.name, support: !!l.support, lastSync: (meta || {})[l.slug] || null, shots: shots[l.slug], problem: (errs || {})[l.slug] || null, ...srcOf(l), v4: l.slug in rated ? { ratingsAt: rated[l.slug] ? new Date(rated[l.slug]).toISOString() : null } : null })),
    });
  }

  if (req.method === 'POST' && p === '/api/ratings') { // rebuild one league's v4 ratings now (the cron does this about daily)
    const league = leagueBySlug(q('league'));
    const target = q('league') === 'cup' || (league && league.cupModel) ? 'cup' : league && v4Supports(league.slug) ? league.slug : null;
    if (!target) return json({ error: 'Pass ?league=<slug> for a league that has v4 ratings (or cup for the Champions / Europa League ratings)' }, 400);
    try { return json({ ok: true, ...(await refreshRatings(env, new Date(), [target], { force: true })) }); } catch (e) { return json({ error: `${league ? league.name : "Cup"} (ratings): ${e && e.message ? e.message : e}` }, 500); }
  }
  if (req.method === 'POST' && ['/api/sync', '/api/analyze', '/api/grade', '/api/sm', '/api/forebet'].includes(p)) {
    const league = leagueBySlug(q('league'));
    if (!league) return json({ error: 'Pass ?league=<slug>, one league per request' }, 400);
    try {
      if (p === '/api/sync' && q('backfill') === '1') return json({ ok: true, ...(await backfillShots(league, env)) }); // one-time shots fill (src/data.js)
      if (p === '/api/sync') { const r = await syncLeague(league, env); await syncNote(env, league, r); return json({ ok: true, ...r }); }
      if (p === '/api/analyze') {
        const r = await analyzeLeague(q('date') || addDays(today(), 1), league.slug, env, new Date(), { partial: q('partial') === '1', leftover: q('leftover') === '1' });
        if (r.feedError) await noteLeague(env, league.slug, 'games', "ESPN's game list wouldn't load").catch(() => {});
        else if (r.cards !== undefined) await noteLeague(env, league.slug, 'games', null).catch(() => {});
        return json({ ok: true, ...r });
      }
      if (p === '/api/forebet') { let b = {}; try { b = await req.json(); } catch (e) { /* empty */ }
        if (b.fetch) { const kind = q('kind') || '1x2'; if (!FB_PAGES[league.slug]) return json({ error: `No Forebet page is set up for ${league.name}` }, 400); return json({ ok: true, ...(await forebetFetch(env, league.slug, kind, new Date())) }); } return json({ ok: true, ...(await forebetPaste(q('date'), league.slug, String(b.text || ''), env, new Date(), q('kind') || '1x2')) }); }
      if (p === '/api/sm') return json({ ok: true, ...(await smLeague(q('date') || today(), league.slug, env, new Date(), { force: true })) });
      return json({ ok: true, ...(await gradeLeague(q('date') || today(), league.slug, env, { force: true })) });
    } catch (e) {
      return json({ error: `${league.name} (${p.slice(5)}): ${e && e.message ? e.message : e}` }, 500);
    }
  }
  return env.ASSETS.fetch(req);
}
// used by src/worker.js and src/jobs.js
export { LOCAL_HOST, json, pendingCookies, signInHealth, withCookies, withSecurity };
