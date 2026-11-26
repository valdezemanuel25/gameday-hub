// Notifications to the installed app (Web Push). Nothing here uses odds.
//   Alert: a game where every model agrees on its best pick, sent about 45 minutes before kickoff (once per game).
//   Soccer: the card's headline pick is a "Best pick" (all models agree, 60% or more) and at least three models gave a view.
//   Hockey: v2, v4 and Forebet take the same side (the Top tab's "All agree"), and/or all three land on the same side of the game's line.
//   Second divisions and untracked leagues are left out, like every other record.
// Storage: KV key 'push' holds { subs, sent } (one write when a device is added or removed, or when alerts go out) and 'push:vapid' holds the signing key.
import { consensusPick, hockeyPick } from './pick.js';
import { getDay } from './fixes.js';

const enc = new TextEncoder();
export const b64u = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64u = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); s += '='.repeat((4 - (s.length % 4)) % 4); return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };

// ---- the signing key (made once, kept in KV) ----
export async function getVapid(env, origin) {
  let v = await env.HUB.get('push:vapid', 'json');
  if (!v) {
    const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    v = { pub: b64u(await crypto.subtle.exportKey('raw', k.publicKey)), jwk: await crypto.subtle.exportKey('jwk', k.privateKey), sub: origin || 'https://example.com' };
    await env.HUB.put('push:vapid', JSON.stringify(v));
    // Two first requests at once each make a key and the last save wins: give back the key that is stored, so no device subscribes with the other
    v = (await env.HUB.get('push:vapid', 'json')) || v;
  }
  return v;
}
async function vapidHeader(v, endpoint, now) {
  const aud = new URL(endpoint).origin, h = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const c = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: v.sub })));
  const key = await crypto.subtle.importKey('jwk', v.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${h}.${c}`));
  return `vapid t=${h}.${c}.${b64u(sig)}, k=${v.pub}`;
}

// ---- message encryption (RFC 8291, aes128gcm) ----
const hkdf = async (salt, ikm, info, len) => {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
};
export async function encryptPayload(sub, text) {
  const uaPub = unb64u(sub.keys.p256dh), auth = unb64u(sub.keys.auth);
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, eph.privateKey, 256));
  const ikm = await hkdf(auth, secret, cat(enc.encode('WebPush: info\0'), uaPub, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16), nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, cat(enc.encode(text), new Uint8Array([2]))));
  return cat(salt, new Uint8Array([0, 0, 16, 0, 65]), asPub, body); // record size 4096, key id = our public key
}

// ---- devices ----
export const getPush = async env => (await env.HUB.get('push', 'json')) || { subs: [], sent: {} };
const savePush = (env, d) => env.HUB.put('push', JSON.stringify(d));
// A browser's subscription, checked before it is kept: the Worker later POSTs to the endpoint from every alert run, so it
// must be a plain https address (no user:password, no bare IP) of a sensible length, and the two keys must be base64url of the sizes Web
// Push uses (a 65-byte P-256 key, a 16-byte secret).
const B64U = /^[A-Za-z0-9_-]+={0,2}$/;
export function validSub(sub) {
  if (!sub || typeof sub.endpoint !== 'string' || sub.endpoint.length > 1024 || !sub.keys) return false;
  let u; try { u = new URL(sub.endpoint); } catch (e) { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || /^[\d.]+$|^\[/.test(u.hostname) || !u.hostname.includes('.')) return false;
  const k = String(sub.keys.p256dh || ''), a = String(sub.keys.auth || '');
  return B64U.test(k) && k.length >= 86 && k.length <= 90 && B64U.test(a) && a.length >= 16 && a.length <= 24;
}
export async function addSub(env, sub, label) {
  if (!validSub(sub)) return { error: 'That device sent an incomplete subscription.' };
  const d = await getPush(env);
  d.subs = d.subs.filter(s => s.endpoint !== sub.endpoint);
  d.subs.push({ endpoint: sub.endpoint, keys: { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) }, label: String(label || '').slice(0, 60), at: new Date().toISOString() });
  d.subs = d.subs.slice(-10);
  await savePush(env, d);
  return { ok: true, devices: d.subs.length };
}
export async function removeSub(env, endpoint) {
  const d = await getPush(env), n = d.subs.length;
  d.subs = d.subs.filter(s => s.endpoint !== endpoint);
  if (d.subs.length !== n) await savePush(env, d);
  return { ok: true, devices: d.subs.length };
}
// Send one message to every device. A device the phone company says is gone (404 or 410) is dropped.
export async function sendAll(env, msg, now = Date.now(), fetcher = fetch) {
  const d = await getPush(env); if (!d.subs.length) return { sent: 0, gone: 0 };
  const r = await sendTo(d.subs, await getVapid(env), msg, now, fetcher);
  if (r.gone.length) await dropSubs(env, r.gone);
  return { sent: r.sent, gone: r.gone.length };
}
// One message to the given devices (one request each): how many took it, and the endpoints the phone company says are gone (404 / 410).
async function sendTo(subs, v, msg, now, fetcher) {
  const text = JSON.stringify(msg), gone = []; let sent = 0;
  for (const s of subs) {
    try {
      const r = await fetcher(s.endpoint, { method: 'POST', headers: { 'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream', ttl: '3600', urgency: 'high', authorization: await vapidHeader(v, s.endpoint, now) }, body: await encryptPayload(s, text) });
      if (r.status === 404 || r.status === 410) gone.push(s.endpoint); else if (r.ok) sent++;
    } catch (e) { /* try again at the next alert */ }
  }
  return { sent, gone };
}
// Gone devices are taken off the list as it is stored now (read again just before the save), so a device added meanwhile is kept.
async function dropSubs(env, gone) {
  const d = await getPush(env), n = d.subs.length;
  d.subs = d.subs.filter(s => !gone.includes(s.endpoint));
  if (d.subs.length !== n) await savePush(env, d);
}

// ---- which games earn an alert ----
const SKIP = new Set(['laliga2', 'bundesliga2', 'championship']);
const KIND = { H: c => `${c.home} to win`, D: () => 'Draw', A: c => `${c.away} to win`, O: () => 'Over 2.5 goals', U: () => 'Under 2.5 goals', B: () => 'Both teams score', N: () => 'Not both teams score' };
export function soccerAlert(c) {
  if (!c || !c.v2 || c.final || c.skipped || SKIP.has(c.leagueKey) || c.sport === 'nhl') return null;
  const L = consensusPick(c); if (!L || L.k !== 'best' || L.a < 3) return null;
  return { title: `Best pick: ${KIND[L.key](c)}`, body: `${c.home} vs ${c.away} · ${c.ko || ''} · all ${L.a} models agree, ${L.p}%` };
}
export function hockeyAlert(c) {
  if (!c || c.final || c.skipped) return null;
  const L = hockeyPick(c); if (!L || L.k !== 'best') return null; // v4, Forebet and the price agree, and the price gives the side 55%+ (src/pick.js)
  return { title: `Best pick: ${L.key === 'H' ? c.home : c.away} to win`, body: `${c.away} at ${c.home} · ${c.ko || ''} · v4, Forebet and the price agree · price ${L.p}%` };
}
const LEAD_MIN = 45;
// cards: { soccer: [...], hockey: [...] } for the day(s) near now. Returns the alerts not sent yet.
export function dueAlerts(cards, sent, now) {
  const out = [];
  for (const [sport, list, fn, url] of [['s', cards.soccer || [], soccerAlert, '/soccer'], ['n', cards.hockey || [], hockeyAlert, '/nhl']]) {
    for (const c of list) {
      const mins = (new Date(c.kickoff).getTime() - now) / 60000;
      if (!(mins > 0 && mins <= LEAD_MIN)) continue;
      const key = `${sport}|${c.league || 'nhl'}|${c.id}`; if (sent[key]) continue;
      const a = fn(c); if (a) out.push({ key, url, tag: key, ...a });
    }
  }
  return out;
}
// Runs after each background job. It reads nothing but the small device list unless a device is registered. loaded: days the run has
// read already ({ soccer: { date: cards }, nhl: { ... } }, the Data Keeper's, as saved after its repair), used instead of reading them again.
export async function pushStep(env, now, dates, fetcher = fetch, loaded = null) {
  const d = await getPush(env); if (!d.subs.length) return { push: 'no devices' };
  const cards = { soccer: [], hockey: [] };
  for (const date of dates) {
    const have = sp => loaded && loaded[sp] && Array.isArray(loaded[sp][date]) ? loaded[sp][date] : null;
    for (const c of have('soccer') || (await getDay(env, date))?.cards || []) cards.soccer.push(c);
    for (const c of have('nhl') || (await getDay(env, date, 'nhl'))?.cards || []) cards.hockey.push(c);
  }
  const due = dueAlerts(cards, d.sent || {}, now); if (!due.length) return { push: 'nothing due' };
  // The device list and the signing key are read once. At most PUSH_CAP requests a run (the free plan allows 50 outside calls per run):
  // alerts past the cap wait for the next run, still inside their window. An alert is marked sent once a device took it, or once no device is left.
  const v = await getVapid(env), gone = new Set(), done = [];
  let sent = 0, calls = 0;
  for (const a of due) {
    const live = d.subs.filter(s => !gone.has(s.endpoint));
    if (!live.length) { done.push(a); continue; }
    if (calls > 0 && calls + live.length > PUSH_CAP) break; // the first alert always goes, so more devices than the cap cannot stall every alert
    if (env.BUDGET && !env.BUDGET.take(live.length)) break; // the run's outside calls (src/store.js budget): the rest wait for the next run
    calls += live.length;
    const r = await sendTo(live, v, { title: a.title, body: a.body, tag: a.tag, url: a.url }, now, fetcher);
    for (const e of r.gone) gone.add(e);
    sent += r.sent;
    if (r.sent > 0 || live.every(s => gone.has(s.endpoint))) done.push(a);
  }
  const d2 = await getPush(env); d2.sent = d2.sent || {};
  if (gone.size) d2.subs = d2.subs.filter(s => !gone.has(s.endpoint));
  for (const a of done) d2.sent[a.key] = now;
  for (const k of Object.keys(d2.sent)) if (now - d2.sent[k] > 3 * 86400000) delete d2.sent[k];
  await savePush(env, d2);
  return { push: 'sent', alerts: done.length, delivered: sent, ...(done.length < due.length ? { waiting: due.length - done.length } : {}) };
}
export const PUSH_CAP = 20;
