// public/flipcard.js must not add a window resize listener per card (Nov 7, 2026): every Board redraw wrapped every card again and the
// listeners were never removed, so redrawn cards stayed in memory. One shared listener at the top level of the file is enough.
import fs from 'fs';
let bad = 0; const ok = (n, c, x = '') => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (c ? '' : ' ' + x)); if (!c) bad++; };
const src = fs.readFileSync(new URL('../public/flipcard.js', import.meta.url), 'utf8');
const hits = [...src.matchAll(/addEventListener\('resize'/g)];
ok('flipcard: exactly one window resize listener in the file', hits.length === 1, String(hits.length));
const line = src.slice(src.lastIndexOf('\n', hits[0].index) + 1, src.indexOf('\n', hits[0].index));
ok('flipcard: it sits at the top level (two-space indent), not inside the per-card hook', /^ {2}window\.addEventListener/.test(line), line);
ok('flipcard: the file still parses', (() => { try { new Function(src); return true; } catch (e) { return false; } })());
if (bad) { console.log(bad + ' failed'); process.exit(1); }
