// Sign-in: a password sets a session cookie so the installed app and the browser stay signed in; the old header and Basic still work.
// Nov 18, 2026: sessions can be ended (an age limit, renewal while in use, SESSION_EPOCH) and the old fixed cookie is swapped for a while.
import worker, { sessionToken, cookieSession, OLD_COOKIE_UNTIL } from '../src/worker.js';
let fail = 0; const ok = (n, c, x = '') => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (c ? '' : ' ' + x)); if (!c) fail++; };
const kv = new Map(), env = { ADMIN_TOKEN: 'secret', ASSETS: { fetch: r => new Response('asset:' + new URL(r.url).pathname) }, HUB: { get: async (k, t) => { const v = kv.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => { kv.set(k, v); }, list: async () => ({ keys: [] }) } };
const go = (path, init = {}) => worker.fetch(new Request('https://hub.test' + path, { redirect: 'manual', ...init }), env, { waitUntil() {} });
const form = (o) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o).toString() });
let r = await go('/');
ok('signed out, the page goes to the sign-in page (no browser password box)', r.status === 302 && r.headers.get('location') === '/login' && !r.headers.get('www-authenticate'), r.status + ' ' + r.headers.get('location'));
r = await go('/nhl');
ok('the hockey page remembers where you were going', r.status === 302 && r.headers.get('location') === '/login?next=%2Fnhl', r.headers.get('location'));
r = await go('/api/config');
ok('signed out, the data still says 401 (json, not a redirect)', r.status === 401 && (await r.json()).error);
r = await go('/login'); ok('the sign-in page loads without signing in', r.status === 200 && (await r.text()).includes('/login'));
for (const f of ['/apple-touch-icon-precomposed.png', '/apple-touch-icon-180x180.png', '/manifest.webmanifest', '/sw.js', '/icon-192.png', '/apple-touch-icon.png']) { r = await go(f); ok(`${f} loads without signing in (needed to install the app)`, r.status === 200); }
r = await go('/login', form({ password: 'nope' }));
ok('a wrong password sets no cookie and returns to sign-in with an error', r.status === 303 && !r.headers.get('set-cookie') && r.headers.get('location').startsWith('/login?e=1'), r.headers.get('location'));
r = await go('/login', form({ password: 'secret', next: '/nhl' }));
const scs = r.headers.getSetCookie(), sc = scs.find(c => c.startsWith('__Host-hub_s=')) || '';
ok('the right password sets a 180-day __Host- session cookie (HttpOnly, Secure, Lax, Path=/, no Domain) and goes to where you were headed', r.status === 303 && r.headers.get('location') === '/nhl'
  && /^__Host-hub_s=v2\.\d+\.[0-9a-f]{64};/.test(sc) && /Max-Age=15552000/.test(sc) && /HttpOnly/.test(sc) && /Secure/.test(sc) && /SameSite=Lax/.test(sc) && /Path=\/;/.test(sc) && !/Domain/i.test(sc), scs.join(' | ') + ' ' + r.headers.get('location'));
ok('sign-in sets only the new cookie (the old one is cleared, never set)', scs.length === 2 && scs.some(c => /^hub_s=;.*Max-Age=0/.test(c)) && !scs.some(c => /^hub_s=[0-9a-f]/.test(c)), scs.join(' | '));
ok('the password itself is never in the cookie', !scs.join().includes('secret'));
r = await go('/login', form({ password: 'secret', next: '//evil.example' }));
ok('next can only be a path on this site (falls back to Home)', r.headers.get('location') === '/home', r.headers.get('location'));
r = await go('/login', form({ password: 'secret', next: '/\\evil.example' }));
ok('a backslash cannot smuggle another site into next', r.headers.get('location') === '/home', r.headers.get('location'));
ok('answers carry the safety headers', /max-age=\d+/.test(r.headers.get('strict-transport-security') || '') && r.headers.get('x-content-type-options') === 'nosniff' && /frame-ancestors/.test(r.headers.get('content-security-policy') || ''));
r = await worker.fetch(new Request('http://hub.test/login?next=%2Fnhl', { redirect: 'manual' }), env, { waitUntil() {} });
ok('plain http is sent to https before anything else', r.status === 301 && r.headers.get('location') === 'https://hub.test/login?next=%2Fnhl', r.status + ' ' + r.headers.get('location'));
r = await worker.fetch(new Request('http://localhost:8787/login', { redirect: 'manual' }), env, { waitUntil() {} });
ok('a local run on http still works', r.status === 200, r.status);
{
  let n = 0; const lim = { limit: async ({ key }) => ({ success: ++n <= 2, key }) }, envL = { ...env, LOGIN_LIMIT: lim, API_LIMIT: lim };
  const goL = (path, init = {}) => worker.fetch(new Request('https://hub.test' + path, { redirect: 'manual', ...init }), envL, { waitUntil() {} });
  await goL('/login', form({ password: 'nope' })); await goL('/login', form({ password: 'nope' }));
  r = await goL('/login', form({ password: 'secret' }));
  ok('too many sign-in tries are stopped, even with the right password', r.status === 303 && r.headers.get('location').startsWith('/login?e=2') && !r.headers.get('set-cookie'), r.headers.get('location'));
  r = await goL('/api/config', { headers: { 'x-admin-token': 'secret' } }); ok('too many header tries get 429', r.status === 429, r.status);
  r = await goL('/api/config', { headers: { cookie: sc.split(';')[0] } }); ok('a signed-in device (cookie) is never rate limited', r.status === 200, r.status);
}
const cookie = sc.split(';')[0];
r = await go('/api/config', { headers: { cookie } }); ok('the cookie opens the data', r.status === 200);
r = await go('/', { headers: { cookie } }); ok('opening the Hub lands on Home', r.status === 302 && r.headers.get('location') === '/home', r.status + ' ' + r.headers.get('location'));
r = await go('/soccer', { headers: { cookie } }); ok('Soccer opens at /soccer', r.status === 200 && (await r.text()) === 'asset:/', r.status);
r = await go('/home', { headers: { cookie } }); ok('the cookie opens Home', r.status === 200);
r = await go('/api/config', { headers: { cookie: 'hub_s=' + '0'.repeat(64) } }); ok('a made-up cookie does not', r.status === 401);
r = await go('/api/config', { headers: { 'x-admin-token': 'secret' } }); ok('the x-admin-token header still works', r.status === 200);
r = await go('/api/config', { headers: { authorization: 'Basic ' + btoa('me:secret') } }); ok('Basic still works for scripts', r.status === 200);
r = await go('/api/config', { headers: { authorization: 'Basic ' + btoa('me:wrong') } }); ok('a wrong Basic password does not', r.status === 401);
r = await go('/logout');
{ const s = r.headers.getSetCookie();
  ok('sign out clears both the new cookie and the old one', r.status === 303 && s.some(c => /^__Host-hub_s=;.*Max-Age=0.*Secure/.test(c) && /Path=\/;/.test(c)) && s.some(c => /^hub_s=;.*Max-Age=0/.test(c)), s.join(' | ')); }
const env2 = { ...env, ADMIN_TOKEN: 'changed' };
r = await worker.fetch(new Request('https://hub.test/api/config', { headers: { cookie } }), env2, { waitUntil() {} }); ok('changing the password signs every device out', r.status === 401);

// ---- sessions you can end (Nov 18, 2026) ----
{
  const DAY = 86400, realNow = Date.now, at = iso => { const t = Date.parse(iso); Date.now = () => t; return Math.floor(t / 1000); };
  const goE = (path, init = {}, e = env) => worker.fetch(new Request('https://hub.test' + path, { redirect: 'manual', ...init }), e, { waitUntil() {} });
  const v2 = async (iat, e = env) => '__Host-hub_s=' + await sessionToken(e, iat);
  const page = c => ({ headers: { cookie: c, accept: 'text/html,application/xhtml+xml,*/*;q=0.8', 'sec-fetch-dest': 'document' } });
  const v1val = async pw => { const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode('game-day-hub session v1')))].map(b => b.toString(16).padStart(2, '0')).join(''); };
  try {
    const now = at('2026-11-25T12:00:00Z');
    // accepted, tampered, expired
    r = await goE('/api/config', { headers: { cookie: await v2(now - DAY) } }); ok('v2: a day-old session opens the data', r.status === 200, r.status);
    const good = (await v2(now - DAY)).split('=')[1], [, iat, sig] = good.split('.');
    const flip = sig.slice(0, -1) + (sig.endsWith('0') ? '1' : '0');
    r = await goE('/api/config', { headers: { cookie: `__Host-hub_s=v2.${iat}.${flip}` } }); ok('v2: a changed signature is refused', r.status === 401, r.status);
    r = await goE('/api/config', { headers: { cookie: `__Host-hub_s=v2.${now}.${sig}` } }); ok('v2: a newer date on an old signature is refused (the date is signed)', r.status === 401, r.status);
    r = await goE('/api/config', { headers: { cookie: `__Host-hub_s=${await v1val('secret')}` } }); ok('v2: the old cookie value under the new name is refused', r.status === 401, r.status);
    r = await goE('/api/config', { headers: { cookie: await v2(now - 179 * DAY) } }); ok('v2: 179 days old still opens', r.status === 200, r.status);
    r = await goE('/api/config', { headers: { cookie: await v2(now - 181 * DAY) } }); ok('v2: past SESSION_MAX_DAYS (180 by default) it is refused', r.status === 401, r.status);
    r = await goE('/api/config', { headers: { cookie: await v2(now + 3600) } }); ok('v2: dated an hour ahead it is refused', r.status === 401, r.status);
    r = await goE('/api/config', { headers: { cookie: await v2(now + 60) } }); ok('v2: a minute ahead (clock skew) still opens', r.status === 200, r.status);
    const env7 = { ...env, SESSION_MAX_DAYS: '7' };
    r = await goE('/api/config', { headers: { cookie: await v2(now - 8 * DAY, env7) } }, env7); ok('v2: SESSION_MAX_DAYS=7 refuses an 8-day-old session', r.status === 401, r.status);
    r = await goE('/login', form({ password: 'secret' }), env7); ok('v2: the cookie\'s own Max-Age follows SESSION_MAX_DAYS', /Max-Age=604800/.test(r.headers.getSetCookie()[0]), r.headers.getSetCookie()[0]);
    // the epoch
    const envE = { ...env, SESSION_EPOCH: '2' };
    r = await goE('/api/config', { headers: { cookie: await v2(now - DAY) } }, envE); ok('epoch: changing SESSION_EPOCH refuses every older session, same password', r.status === 401, r.status);
    r = await goE('/api/config', { headers: { cookie: await v2(now - DAY, envE) } }, envE); ok('epoch: a session signed in after the change opens', r.status === 200, r.status);
    r = await goE('/api/config', { headers: { cookie: await v2(now - DAY) } }, { ...env, SESSION_EPOCH: '' }); ok('epoch: an empty SESSION_EPOCH is the same as none ("0")', r.status === 200, r.status);
    // the old cookie, before and after the cutoff
    const old = 'hub_s=' + await v1val('secret');
    r = await goE('/home', page(old));
    let s = r.headers.getSetCookie(), nv = (s.find(c => c.startsWith('__Host-hub_s=v2.')) || '').split(';')[0];
    ok('v1: before the cutoff the old cookie still opens a page', r.status === 200, r.status);
    ok('v1: and is swapped: the new cookie is set and the old one cleared', !!nv && s.some(c => /^hub_s=;.*Max-Age=0/.test(c)) && /private, no-store/.test(r.headers.get('cache-control') || ''), s.join(' | '));
    r = await goE('/api/config', { headers: { cookie: nv } }); ok('v1: the swapped-in cookie opens the data', r.status === 200, r.status);
    r = await goE('/api/config', { headers: { cookie: old } }); ok('v1: a data call with the old cookie is swapped too', r.status === 200 && r.headers.getSetCookie().some(c => c.startsWith('__Host-hub_s=v2.')), r.status);
    r = await goE('/api/config', { headers: { cookie: old } }, envE); ok('v1: a SESSION_EPOCH change ends the old cookie at once', r.status === 401, r.status);
    ok('cookieSession: the old cookie is taken the moment before the cutoff', (await cookieSession(env, old, Date.parse(OLD_COOKIE_UNTIL + 'T00:00:00Z') - 1))?.v === 1);
    at(OLD_COOKIE_UNTIL + 'T00:00:01Z');
    r = await goE('/home', page(old)); ok('v1: after the cutoff the old cookie is refused (back to sign-in)', r.status === 302 && r.headers.get('location').startsWith('/login') && !r.headers.getSetCookie().length, r.status);
    // renewal
    const t2 = at('2027-01-10T12:00:00Z'), aged = await v2(t2 - 31 * DAY), young = await v2(t2 - 29 * DAY);
    r = await goE('/home', page(aged)); s = r.headers.getSetCookie();
    ok('renew: a page opened with a 31-day-old session gets a fresh cookie, never cached', r.status === 200 && s.length === 1 && s[0].startsWith(`__Host-hub_s=v2.${t2}.`) && /private, no-store/.test(r.headers.get('cache-control') || ''), s.join(' | '));
    r = await goE('/nhl', { headers: { cookie: aged, accept: 'text/html' } }); ok('renew: an Accept: text/html page load is a page too', r.headers.getSetCookie().length === 1);
    r = await goE('/home', page(young)); ok('renew: a 29-day-old session is left alone', r.status === 200 && !r.headers.getSetCookie().length);
    r = await goE('/api/config', { headers: { cookie: aged, accept: 'text/html' } }); ok('renew: never on a data call (/api/)', r.status === 200 && !r.headers.getSetCookie().length);
    r = await goE('/sweep.js', { headers: { cookie: aged, accept: '*/*', 'sec-fetch-dest': 'script' } }); ok('renew: never on a page\'s script or picture', r.status === 200 && !r.headers.getSetCookie().length);
    r = await goE('/api/odds', { method: 'POST', headers: { cookie: aged, 'content-type': 'application/json' }, body: '{}' }); ok('renew: never on a POST', !r.headers.getSetCookie().length);
    r = await goE('/home', { headers: { 'x-admin-token': 'secret', accept: 'text/html' } }); ok('header sign-ins (scripts) never get a cookie', r.status === 200 && !r.headers.getSetCookie().length);
    const env10 = { ...env, SESSION_MAX_DAYS: '10' };
    r = await goE('/home', page(await v2(t2 - 6 * DAY, env10)), env10); ok('renew: with SESSION_MAX_DAYS=10 a session renews after half that (5 days), before it runs out', r.headers.getSetCookie().length === 1);
  } finally { Date.now = realNow; }
  // the weak-password warning on the health report
  const hEnv = { ...env, HUB: { ...env.HUB, list: async () => ({ keys: [], list_complete: true }) } };
  r = await goE('/api/health', { headers: { 'x-admin-token': 'secret' } }, hEnv); let t = await r.text();
  ok('health: a short password shows a warning', r.status === 200 && JSON.parse(t).signIn?.weakPassword === true, t.slice(0, 200));
  ok('health: never the password, nor its length', !t.includes('secret') && !/"(length|len|chars)"/.test(t));
  const strong = 'k3J9-xQ2v-Lm8P-wR4t';
  r = await goE('/api/health', { headers: { 'x-admin-token': strong } }, { ...hEnv, ADMIN_TOKEN: strong }); t = await r.text();
  ok('health: 16+ characters, no warning', r.status === 200 && JSON.parse(t).signIn?.weakPassword === false && !t.includes(strong), t.slice(0, 200));
  const src = (await import('fs')).readFileSync(new URL('../public/sweep.js', import.meta.url), 'utf8'), m = src.match(/function readHealth\(h\) \{[\s\S]*?return out;\n  \}/);
  const rh = new Function(`${m[0]}; return readHealth;`)(), base = { soccer: { ungraded: [], unpriced: [] }, nhl: { ungraded: [], unpriced: [] }, analyst: { noClose: [], stale: [] }, syncProblems: {} };
  ok("Sweep's report: says so when the password is weak, and nothing when it is not", rh({ ...base, signIn: { weakPassword: true } }).some(x => /password is weak/.test(x)) && rh({ ...base, signIn: { weakPassword: false } }).length === 0 && rh(base).length === 0);
  const kg = rh({ ...base, keeper: { last24h: {}, gaveUp: [{ game: 'Hr v Ar', check: 'result' }, { game: 'B v C', check: 'price' }, { game: 'D v E', check: 'forebet' }] } });
  ok("Sweep's report: names the Data Keeper's give-ups, and nothing when there are none", kg.some(x => /Data Keeper gave up on 3 gaps \(Hr v Ar, result; B v C, price; \.\.\.\)/.test(x)) && rh({ ...base, keeper: { last24h: {}, gaveUp: [] } }).length === 0, JSON.stringify(kg));
}
console.log(fail ? `\n${fail} auth checks FAILED` : '\nAll auth checks passed'); process.exit(fail ? 1 : 0);
