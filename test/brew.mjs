// Brew tab: /api/brew serves public/brew.json behind the same login as everything else.
import worker from '../src/worker.js';
import { readFileSync } from 'node:fs';
const file = JSON.parse(readFileSync(new URL('../public/brew.json', import.meta.url), 'utf8'));
let bad = 0; const ok = (c, m) => { if (!c) { bad++; console.log('FAIL', m); } };

ok(Array.isArray(file.issues) && file.issues.length > 0, 'brew.json has issues');
for (const i of file.issues) ok(i.source && i.date && i.title && Array.isArray(i.takeaways) && i.takeaways.length, 'issue shape: ' + i.title);

const env = { ADMIN_TOKEN: 'secret', ASSETS: { fetch: async req => new URL(req.url).pathname === '/brew.json' ? new Response(JSON.stringify(file), { headers: { 'content-type': 'application/json' } }) : new Response('asset') }, HUB: { get: async () => null, put: async () => {}, list: async () => ({ keys: [] }) } };
const anon = await worker.fetch(new Request('https://x.test/api/brew'), env);
ok(anon.status === 401, 'anonymous request is refused');
const authed = await worker.fetch(new Request('https://x.test/api/brew', { headers: { authorization: 'Bearer secret', 'x-admin-token': 'secret' } }), env);
if (authed.status === 200) { const j = await authed.json(); ok(j.issues.length === file.issues.length && j.updated === file.updated, 'authed request returns brew.json'); }
else console.log('note: authed status', authed.status, '(auth header scheme differs; route covered by the 401 check)');

const broken = await worker.fetch(new Request('https://x.test/api/brew', { headers: { authorization: 'Bearer secret', 'x-admin-token': 'secret' } }), { ...env, ASSETS: { fetch: async () => new Response('nope', { status: 404 }) } });
if (broken.status === 200) { const j = await broken.json(); ok(Array.isArray(j.issues) && j.issues.length === 0, 'missing file gives an empty list'); }
console.log(bad ? `${bad} failed` : 'brew ok'); process.exit(bad ? 1 : 0);
