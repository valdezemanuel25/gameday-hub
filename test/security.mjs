// Security audit fixes (Nov 18, 2026): the health token is rate limited, secrets are compared without leaking their length, other sites
// cannot reach the data or change anything, ?date= is checked before it reaches a storage key, and push subscriptions are checked before they
// are kept.
import worker, { same, crossSite } from '../src/worker.js';
import { validSub, b64u } from '../src/push.js';
let fail = 0; const ok = (n, c, x = '') => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (c ? '' : ' ' + x)); if (!c) fail++; };
const kv = new Map(), env = { ADMIN_TOKEN: 'secret', HEALTH_TOKEN: 'healthtok', ASSETS: { fetch: r => new Response('asset:' + new URL(r.url).pathname) },
  HUB: { get: async (k, t) => { const v = kv.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => { kv.set(k, v); }, list: async () => ({ keys: [], list_complete: true }) } };
const go = (path, init = {}, e = env) => worker.fetch(new Request('https://hub.test' + path, { redirect: 'manual', ...init }), e, { waitUntil() {} });
const tok = { 'x-admin-token': 'secret' };

// ---- comparing secrets ----
ok('same: equal strings match', await same('secret', 'secret'));
ok('same: a wrong guess of the same length does not', !(await same('secreT', 'secret')));
ok('same: a shorter or longer guess does not (and is compared the same way)', !(await same('sec', 'secret')) && !(await same('secret1', 'secret')) && !(await same('', 'secret')));

// ---- the health token ----
{
  let n = 0; const lim = { limit: async ({ key }) => ({ success: key.startsWith('health:') ? ++n <= 3 : true }) }, envL = { ...env, API_LIMIT: lim };
  let r = await go('/api/health?k=wrong1', {}, envL); ok('a wrong health token is not let in', r.status === 401, r.status);
  await go('/api/health?k=wrong2', {}, envL); await go('/api/health', { headers: { 'x-health-token': 'wrong3' } }, envL);
  r = await go('/api/health?k=healthtok', {}, envL);
  ok('health token tries are counted: after 3 a minute even the right one waits (it used to be guessable without end)', r.status === 429 && r.headers.get('retry-after') === '60', r.status);
  n = 0; r = await go('/api/health?k=healthtok', {}, envL);
  ok('the right health token opens the read-only report', r.status === 200 && typeof (await r.json()) === 'object', r.status);
  n = 99; r = await go('/api/health', { headers: tok }, envL);
  ok('a signed-in read of /api/health with no health token is not counted against it', r.status === 200, r.status);
}

// ---- other sites ----
const req = (path, method = 'GET', headers = {}) => new Request('https://hub.test' + path, { method, headers });
ok('crossSite: the Hub\'s own fetch is fine', !crossSite(req('/api/day', 'GET', { 'sec-fetch-site': 'same-origin' }), new URL('https://hub.test/api/day')));
ok('crossSite: a script with no browser headers is fine', !crossSite(req('/api/odds', 'POST'), new URL('https://hub.test/api/odds')));
ok('crossSite: a link from another site to a page still opens (it then asks for the password as usual)', !crossSite(req('/home', 'GET', { 'sec-fetch-site': 'cross-site' }), new URL('https://hub.test/home')));
let r = await go('/api/pinn-check?league=eng.1', { headers: { ...tok, 'sec-fetch-site': 'cross-site' } });
ok('another site cannot open a data route (here one that spends a Pinnacle request)', r.status === 403, r.status);
r = await go('/api/odds', { method: 'POST', headers: { ...tok, origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' });
ok('a change sent from another origin is refused', r.status === 403, r.status);
r = await go('/api/odds', { method: 'POST', headers: { ...tok, origin: 'null', 'content-type': 'application/json' }, body: '{}' });
ok('a change from a sandboxed frame (Origin: null) is refused', r.status === 403, r.status);
r = await go('/api/btts', { method: 'POST', headers: { ...tok, 'sec-fetch-site': 'same-site', 'content-type': 'application/json' }, body: '{}' });
ok('a change from a sibling subdomain (same-site) is refused', r.status === 403, r.status);
r = await go('/api/odds', { method: 'POST', headers: { ...tok, origin: 'https://hub.test', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, body: JSON.stringify({ date: '2026-11-18', league: 'nope' }) });
ok('the Hub\'s own POST still goes through', r.status !== 403, r.status);
r = await go('/logout', { headers: { 'sec-fetch-site': 'cross-site' } });
ok('another site cannot sign the device out', r.status === 403 && !r.headers.get('set-cookie'), r.status);
r = await go('/logout'); ok('signing out from the Hub itself still works', r.status === 303 && /Max-Age=0/.test(r.headers.get('set-cookie') || ''));
r = await go('/login', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=secret' });
ok('a sign-in form posted from another site is refused (no cookie)', r.status === 403 && !r.headers.get('set-cookie'), r.status);
r = await go('/login', { method: 'POST', headers: { origin: 'https://hub.test', 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=secret' });
ok('the sign-in page itself still signs in', r.status === 303 && /hub_s=/.test(r.headers.get('set-cookie') || ''), r.status);

// ---- ?date= ----
r = await go('/api/day?date=x%3Ay', { headers: tok }); ok('a ?date= that is not YYYY-MM-DD is refused before it becomes a storage key', r.status === 400, r.status);
r = await go('/api/analyze?league=eng.1&date=2026-11-18%26limit%3D1', { method: 'POST', headers: tok });
ok('nor can it add to ESPN\'s address (analyze would also save a day under it)', r.status === 400 && ![...kv.keys()].some(k => k.includes('limit')), r.status);
r = await go('/api/day?date=2026-11-18', { headers: tok }); ok('a proper date still reads the day', r.status === 200 && (await r.json()).date === '2026-11-18');
r = await go('/api/day?date=', { headers: tok }); ok('an empty date still means today', r.status === 200);

// ---- headers ----
r = await go('/login');
ok('every answer also carries the newer safety headers', /camera=\(\)/.test(r.headers.get('permissions-policy') || '') && r.headers.get('cross-origin-opener-policy') === 'same-origin' && /noindex/.test(r.headers.get('x-robots-tag') || ''));

// ---- push subscriptions ----
const key = b64u(new Uint8Array(65).fill(4)), auth = b64u(new Uint8Array(16).fill(7));
const sub = (endpoint, k = key, a = auth) => ({ endpoint, keys: { p256dh: k, auth: a } });
ok('push: a real-looking subscription is kept', validSub(sub('https://fcm.googleapis.com/fcm/send/abc')) && validSub(sub('https://web.push.apple.com/QF8')));
ok('push: plain http, a bare IP, or user:password in the address is refused', !validSub(sub('http://fcm.googleapis.com/x')) && !validSub(sub('https://10.0.0.1/x')) && !validSub(sub('https://[::1]/x')) && !validSub(sub('https://u:p@fcm.googleapis.com/x')) && !validSub(sub('https://localhost/x')));
ok('push: keys of the wrong size or alphabet are refused', !validSub(sub('https://fcm.googleapis.com/x', 'abc')) && !validSub(sub('https://fcm.googleapis.com/x', key, 'x'.repeat(200))) && !validSub(sub('https://fcm.googleapis.com/x', key.slice(0, 80) + '<>"\'abc')));
ok('push: a huge address is refused', !validSub(sub('https://fcm.googleapis.com/' + 'a'.repeat(2000))));

console.log(fail ? `\n${fail} security checks FAILED` : '\nAll security checks passed'); process.exit(fail ? 1 : 0);
