// Notifications to the installed app (Web Push). Nothing here uses odds.
//   Alert: a game where every model agrees on its best pick, sent about 45 minutes before kickoff (once per game).
//   Soccer: the card's headline pick is a "Best pick" (all models agree, 60% or more) and at least three models gave a view.
//   Hockey: v2, v4 and Forebet take the same side (the Top tab's "All agree"), and/or all three land on the same side of the game's line.
//   Second divisions and untracked leagues are left out, like every other record.
// Storage: KV key 'push' holds { subs, sent } (one write when a device is added or removed, or when alerts go out) and 'push:vapid' holds the signing key.
import { consensusPick } from './pick.js';

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
export async function addSub(env, sub, label) {
  if (!sub || typeof sub.endpoint !== 'string' || !sub.endpoint.startsWith('https://') || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return { error: 'That device sent an incomplete subscription.' };
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
  const v = await getVapid(env), text = JSON.stringify(msg), dead = []; let sent = 0;
  for (const s of d.subs) {
    try {
      const r = await fetcher(s.endpoint, { method: 'POST', headers: { 'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream', ttl: '3600', urgency: 'high', authorization: await vapidHeader(v, s.endpoint, now) }, body: await encryptPayload(s, text) });
      if (r.status === 404 || r.status === 410) dead.push(s.endpoint); else if (r.ok) sent++;
    } catch (e) { /* try again at the next alert */ }
  }
  if (dead.length) { d.subs = d.subs.filter(s => !dead.includes(s.endpoint)); await savePush(env, d); }
  return { sent, gone: dead.length };
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
  if (!c || !c.v2 || c.final || c.skipped) return null;
  const sides = [c.v2 && (c.v2.w >= 50 ? 'H' : 'A'), c.v4 && (c.v4.w >= 50 ? 'H' : 'A'), c.fb && c.fb.pick].filter(Boolean), parts = [];
  let title = null;
  if (sides.length >= 3 && sides.every(x => x === sides[0])) {
    const H = sides[0] === 'H', pv = [c.v2.w, c.v4.w, c.fb.p ? (H ? c.fb.p[0] : c.fb.p[1]) : null].map((x, i) => (x == null ? null : i < 2 ? (H ? x : 100 - x) : x)).filter(x => x != null);
    title = `All models: ${H ? c.home : c.away} to win`; parts.push(`winner, ${Math.round(pv.reduce((a, b) => a + b, 0) / pv.length)}% on average`);
  }
  if (c.ln && c.v4 && c.fb && c.fb.score && c.fb.score.a + c.fb.score.h !== c.ln.v) {
    const vals = [c.v2.o >= 50, c.v4.o >= 50, c.fb.score.a + c.fb.score.h > c.ln.v];
    if (vals.every(x => x === vals[0])) { const t = `${vals[0] ? 'Over' : 'Under'} ${c.ln.v}`; title = title || `All models: ${t}`; parts.push(`${t} goals`); }
  }
  return title ? { title, body: `${c.away} at ${c.home} · ${c.ko || ''} · ${parts.join(' · ')}` } : null;
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
// Runs after each background job. It reads nothing but the small device list unless a device is registered.
export async function pushStep(env, now, dates, fetcher = fetch) {
  const d = await getPush(env); if (!d.subs.length) return { push: 'no devices' };
  const cards = { soccer: [], hockey: [] };
  for (const date of dates) {
    for (const c of (await env.HUB.get(`day:${date}`, 'json'))?.cards || []) cards.soccer.push(c);
    for (const c of (await env.HUB.get(`nhl:day:${date}`, 'json'))?.cards || []) cards.hockey.push(c);
  }
  const due = dueAlerts(cards, d.sent || {}, now); if (!due.length) return { push: 'nothing due' };
  let sent = 0;
  for (const a of due) { const r = await sendAll(env, { title: a.title, body: a.body, tag: a.tag, url: a.url }, now, fetcher); sent += r.sent; }
  const d2 = await getPush(env); d2.sent = d2.sent || {};
  for (const a of due) d2.sent[a.key] = now;
  for (const k of Object.keys(d2.sent)) if (now - d2.sent[k] > 3 * 86400000) delete d2.sent[k];
  await savePush(env, d2);
  return { push: 'sent', alerts: due.length, delivered: sent };
}
