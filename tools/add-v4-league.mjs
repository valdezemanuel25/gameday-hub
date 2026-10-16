// Adds ONE league to src/v4seed.js from a football-data.co.uk "extra leagues" CSV (Country,League,Season,Date,Home,Away,HG,AG,...)
// without needing the other leagues' files. Usage: node tools/add-v4-league.mjs bra.1 /path/BRA.csv
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fit } from '../src/v4core.js';
const here = path.dirname(fileURLToPath(import.meta.url));
const [slug, csv] = process.argv.slice(2);
if (!slug || !csv) { console.error('usage: node tools/add-v4-league.mjs <slug> <csv>'); process.exit(1); }
const DAY = 86400000, WINDOW_DAYS = 900;
const L = fs.readFileSync(csv, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean), head = L[0].split(',');
const col = n => head.indexOf(n);
let rows = [];
for (const l of L.slice(1)) {
  const c = l.split(','); if (c[col('HG')] === '' || c[col('HG')] == null) continue;
  const [d, m, y] = c[col('Date')].split('/').map(Number);
  rows.push({ d: Math.floor(Date.UTC(y, m - 1, d) / DAY), h: c[col('Home')], a: c[col('Away')], hg: +c[col('HG')], ag: +c[col('AG')] });
}
rows.sort((x, y) => x.d - y.d);
const last = rows[rows.length - 1].d; rows = rows.filter(r => r.d >= last - WINDOW_DAYS);
const teams = [], idx = new Map(), id = n => { if (!idx.has(n)) { idx.set(n, teams.length); teams.push(n); } return idx.get(n); };
const g = rows.map(r => [r.d, id(r.h), id(r.a), r.hg, r.ag]);
const r = fit(slug, g.map(([d, h, a, hg, ag]) => ({ d, h: teams[h], a: teams[a], hg, ag })), (last + 1) * DAY);
const file = path.join(here, '..', 'src', 'v4seed.js'), src = fs.readFileSync(file, 'utf8');
const i = src.indexOf('export default '), seed = JSON.parse(src.slice(i + 15).replace(/;\s*$/, ''));
seed[slug] = { through: new Date(last * DAY).toISOString().slice(0, 10), teams, g, r };
fs.writeFileSync(file, src.slice(0, i) + 'export default ' + JSON.stringify(seed) + ';\n');
console.log(slug, g.length, 'games through', seed[slug].through, teams.length, 'clubs');
