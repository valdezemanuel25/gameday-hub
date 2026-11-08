// Hockey history for offline rule checks (Nov 8, 2026). Reads every saved hockey day (nhl:day:*) from the Hub's KV with wrangler and
// writes data/nhl-history.json: one row per graded game with the opening and closing moneyline and total, the final score, v2 / v5
// chances and the rest and backup-goalie flags. Read-only on KV (list + get; it never writes there). Run it yourself, signed in to
// wrangler:  node tools/export-nhl-history.mjs   (or  node tools/export-nhl-history.mjs out.json)
// Then test a hockey rule on real prices, e.g. tools/backtest code that reads the rows and counts bets, units and value against the close.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const n = x => (Number.isFinite(x) ? x : null);
// One saved hockey card -> one row, or null when the game has no result or no closing moneyline (nothing to test a rule on).
export function rowOf(date, c) {
  if (!c || c.skipped || !c.final || !c.px || !Number.isFinite(c.px.h) || !Number.isFinite(c.px.a)) return null;
  const px = c.px, op = px.op || px.f || null, ot = px.opt || (px.f && px.f.tl != null ? px.f : null), I = (c.v5 && c.v5.in) || {};
  return {
    date, id: c.id, kickoff: c.kickoff, home: c.hAbbr || c.home, away: c.aAbbr || c.away,
    open: op ? { h: n(op.h), a: n(op.a) } : null, close: { h: px.h, a: px.a }, lineupRead: px.cl || null,
    totalOpen: ot ? { line: n(ot.tl), o: n(ot.to), u: n(ot.tu) } : null, totalClose: px.tl != null ? { line: n(px.tl), o: n(px.to), u: n(px.tu) } : null,
    final: { h: c.final.h, a: c.final.a, last: c.final.last || 'REG' },
    v2: c.v2 ? { w: n(c.v2.w), o: n(c.v2.o) } : null, v5: c.v5 ? { w: n(c.v5.w), o: n(c.v5.o) } : null, line: c.ln ? n(c.ln.v) : null,
    b2b: I.b2b || null, backup: I.bk || null,
    goalies: c.gk ? { h: c.gk.h ? c.gk.h.n : null, a: c.gk.a ? c.gk.a.n : null } : null,
  };
}
export const rowsOf = (date, cards) => (cards || []).map(c => rowOf(date, c)).filter(Boolean);

function wrangler(args) { return execFileSync('npx', ['wrangler', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }
function main() {
  const out = process.argv[2] || new URL('../data/nhl-history.json', import.meta.url).pathname;
  const keys = JSON.parse(wrangler(['kv', 'key', 'list', '--binding', 'HUB', '--remote', '--prefix', 'nhl:day:'])).map(k => k.name).sort();
  const rows = [];
  for (const k of keys) {
    let day; try { day = JSON.parse(wrangler(['kv', 'key', 'get', k, '--binding', 'HUB', '--remote'])); } catch (e) { console.error(`skipped ${k}: ${e.message.split('\n')[0]}`); continue; }
    rows.push(...rowsOf(k.slice('nhl:day:'.length), day && day.cards));
  }
  fs.writeFileSync(out, JSON.stringify({ made: new Date().toISOString(), days: keys.length, games: rows.length, rows }, null, 1));
  console.log(`${rows.length} graded hockey games with a closing price from ${keys.length} saved days -> ${out}`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) main();
