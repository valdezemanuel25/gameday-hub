// Alerts to the installed app: encryption the phone can read, the signed header, which games earn an alert, and that each is sent once.
import worker from '../src/worker.js';
import { b64u, unb64u, encryptPayload, getVapid, soccerAlert, hockeyAlert, dueAlerts, pushStep, addSub, getPush } from '../src/push.js';
let fail = 0; const ok = (n, c, x = '') => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (c ? '' : ' ' + x)); if (!c) fail++; };
const kv = new Map(), env = { ADMIN_TOKEN: 's', ASSETS: { fetch: () => new Response('a') }, HUB: { get: async (k, t) => { const v = kv.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => { kv.set(k, v); }, list: async () => ({ keys: [] }) } };
// a pretend phone
const phone = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const auth = crypto.getRandomValues(new Uint8Array(16));
const sub = { endpoint: 'https://push.example.com/abc', keys: { p256dh: b64u(await crypto.subtle.exportKey('raw', phone.publicKey)), auth: b64u(auth) } };
// the phone's side of RFC 8291, written independently of the sender
async function decrypt(body) {
  const salt = body.slice(0, 16), idlen = body[20], asPub = body.slice(21, 21 + idlen), ct = body.slice(21 + idlen);
  const uaPub = new Uint8Array(await crypto.subtle.exportKey('raw', phone.publicKey));
  const peer = await crypto.subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, phone.privateKey, 256));
  const hk = async (s, ikm, info, n) => new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: s, info }, await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), n * 8));
  const T = new TextEncoder(), c = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
  const ikm = await hk(auth, secret, c(T.encode('WebPush: info\0'), uaPub, asPub), 32);
  const cek = await hk(salt, ikm, T.encode('Content-Encoding: aes128gcm\0'), 16), nonce = await hk(salt, ikm, T.encode('Content-Encoding: nonce\0'), 12);
  const pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), ct));
  return new TextDecoder().decode(pt.slice(0, pt.lastIndexOf(2)));
}
const msg = JSON.stringify({ title: 'Best pick: Club Brugge to win', body: 'Club Brugge vs Lens · 11:45 AM · all 4 models agree, 64%', url: '/' });
const body = await encryptPayload(sub, msg);
ok('the phone can read the message', (await decrypt(body)) === msg);
ok('the message header says 4096-byte records and a 65-byte key', body[16] === 0 && body[17] === 0 && body[18] === 16 && body[19] === 0 && body[20] === 65);
// the signed header
const v = await getVapid(env, 'https://hub.test');
ok('the signing key is made once and kept', (await getVapid(env, 'https://other')).pub === v.pub && v.pub.length === 87);
const sent = [];
const fetcher = async (u, init) => { sent.push({ u, init }); return new Response(null, { status: sent.length > 100 ? 410 : 201 }); };
await addSub(env, sub, 'phone');
// games
const T0 = Date.parse('2026-10-22T18:00:00Z');
const soc = (o = {}) => ({ id: '1', league: 'uefa.champions', leagueKey: 'ucl', home: 'Club Brugge', away: 'Lens', ko: '11:45 AM', kickoff: new Date(T0 + 30 * 60000).toISOString(), final: null,
  v2: { pick: 'H', p: [70, 18, 12], over: 70, btts: 60 }, v4: { pick: 'H', p: [68, 20, 12], over: 68, btts: 62 }, fb: { p: [66, 20, 14], over: 66, btts: 61 }, sm: { h: 2, a: 1, text: '2–1' }, ...o });
ok('all four agree at 60%+: Best pick alert', soccerAlert(soc()) && /^Best pick:/.test(soccerAlert(soc()).title), JSON.stringify(soccerAlert(soc())));
ok('a split card gets no alert', soccerAlert(soc({ v4: { pick: 'A', p: [20, 20, 60], over: 40, btts: 40 }, sm: { h: 0, a: 1, text: '0–1' } })) === null);
ok('agreement below 60% is only a Lean: no alert', soccerAlert(soc({ v2: { pick: 'H', p: [45, 30, 25], over: 52, btts: 52 }, v4: { pick: 'H', p: [46, 29, 25], over: 53, btts: 51 }, fb: { p: [44, 30, 26], over: 52, btts: 51 }, sm: { h: 1, a: 0, text: '1–0' } })) === null);
ok('two models agreeing is not enough', soccerAlert(soc({ fb: null, sm: null })) === null);
ok('second divisions get no alert', soccerAlert(soc({ leagueKey: 'laliga2' })) === null);
ok('finished games get no alert', soccerAlert(soc({ final: { h: 1, a: 0 } })) === null);
const hk = (o = {}) => ({ id: 'h1', home: 'Calgary Flames', away: 'Minnesota Wild', ko: '7:00 PM', kickoff: new Date(T0 + 30 * 60000).toISOString(), final: null, ln: { v: 5.5 }, v2: { w: 40, o: 40 }, v4: { w: 42, o: 44 }, fb: { pick: 'A', p: [43, 57], score: { h: 2, a: 3 } }, ...o });
const ha = hockeyAlert(hk());
ok('hockey: all three take the away side and the Under: both are in the alert', ha && /Minnesota Wild to win/.test(ha.title) && /Under 5\.5/.test(ha.body), JSON.stringify(ha));
ok('hockey: split winners and a split total: no alert', hockeyAlert(hk({ fb: { pick: 'H', p: [55, 45], score: { h: 4, a: 3 } } })) === null);
ok('hockey: needs all three models', hockeyAlert(hk({ fb: null })) === null);
// timing
const at = (min, c) => dueAlerts({ soccer: [{ ...c, kickoff: new Date(T0 + min * 60000).toISOString() }] }, {}, T0).length;
ok('alert window: 30 minutes before is due, 60 is too early, after kickoff is too late', at(30, soc()) === 1 && at(60, soc()) === 0 && at(-5, soc()) === 0 && at(45, soc()) === 1);
ok('already sent: not again', dueAlerts({ soccer: [soc()] }, { 's|uefa.champions|1': 1 }, T0).length === 0);
// the whole step
kv.set('day:2026-10-22', JSON.stringify({ cards: [soc()] })); kv.set('nhl:day:2026-10-22', JSON.stringify({ cards: [hk()] }));
let r = await pushStep(env, T0, ['2026-10-22'], fetcher);
ok('one step sends both alerts to the device', r.push === 'sent' && r.alerts === 2 && sent.length === 2 && sent.every(x => x.u === sub.endpoint && /^vapid t=.+, k=/.test(x.init.headers.authorization) && x.init.headers['content-encoding'] === 'aes128gcm'), JSON.stringify(r));
r = await pushStep(env, T0 + 5 * 60000, ['2026-10-22'], fetcher);
ok('five minutes later nothing is sent again', r.push === 'nothing due' && sent.length === 2, JSON.stringify(r));
const [h, c, sg] = sent[0].init.headers.authorization.slice(6).split(',')[0].slice(2).split('.');
const jwk = v.jwk, pk = await crypto.subtle.importKey('jwk', { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
ok('the signature checks out against the public key', await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pk, unb64u(sg), new TextEncoder().encode(`${h}.${c}`)));
ok('the header names the phone company and expires in about 12 hours', JSON.parse(atob(c.replace(/-/g, '+').replace(/_/g, '/'))).aud === 'https://push.example.com' && JSON.parse(atob(c.replace(/-/g, '+').replace(/_/g, '/'))).exp - T0 / 1000 <= 12 * 3600 + 1);
// a device the phone company says is gone is dropped
kv.set('day:2026-10-22', JSON.stringify({ cards: [soc({ id: '2' })] }));
const gone = async () => new Response(null, { status: 410 });
await pushStep(env, T0 + 10 * 60000, ['2026-10-22'], gone);
ok('a gone device (410) is removed', (await getPush(env)).subs.length === 0);
r = await pushStep(env, T0 + 15 * 60000, ['2026-10-22'], fetcher); ok('no devices: nothing is even read', r.push === 'no devices');
// routes
const go = (path, init = {}) => worker.fetch(new Request('https://hub.test' + path, { headers: { 'x-admin-token': 's', 'content-type': 'application/json' }, ...init }), env, { waitUntil() {} });
let j = await (await go('/api/push/key')).json(); ok('the page gets the public key', j.key === v.pub && j.devices === 0, JSON.stringify(j));
j = await (await go('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ sub, label: 'iPhone' }) })).json(); ok('a device can register', j.ok && j.devices === 1, JSON.stringify(j));
j = await (await go('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ sub: { endpoint: 'http://x', keys: {} } }) })).json(); ok('an incomplete or non-https device is refused', !!j.error);
j = await (await go('/api/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) })).json(); ok('a device can turn itself off', j.ok && j.devices === 0);
ok('signed out, the push routes say 401', (await worker.fetch(new Request('https://hub.test/api/push/key'), env, { waitUntil() {} })).status === 401);
console.log(fail ? `\n${fail} push checks FAILED` : '\nAll push checks passed'); process.exit(fail ? 1 : 0);
