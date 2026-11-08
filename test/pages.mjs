// Page checks in a real browser (Nov 8, 2026): the soccer and hockey Boards with a stand-in day, the API answered locally.
//   * every tappable pick % (data-gomove) has a Movement card behind it, and only games that have one show a tappable %
//   * redrawing the Board many times adds no window resize listeners (public/flipcard.js kept one per card before Nov 7)
//   * Enter on a focused % flips that card to its Movement side
// Needs Playwright with its Chromium. Where it is not installed (a build machine), the checks are skipped, not failed.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
let bad = 0; const ok = (n, c, x = '') => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (c ? '' : ' ' + x)); if (!c) bad++; };
let chromium;
try { chromium = createRequire(import.meta.url)('playwright').chromium; } catch (e) {
  try { chromium = createRequire('/usr/lib/node_modules/')('playwright').chromium; } catch (e2) { chromium = null; } }
if (!chromium) { console.log('SKIP  page checks: Playwright is not installed here'); process.exit(0); }

const root = new URL('../public/', import.meta.url).pathname, D = '2026-11-08';
const T = h => new Date(Date.now() + h * 3600000).toISOString();
// soccer: a priced game (Movement card), a priced-league game with no price (No price card), a game in a league the Hub does not price
const soccer = [
  { id: 's1', league: 'ger.1', leagueName: 'Bundesliga', home: 'Bayern Munich', away: 'Mainz', kickoff: T(3), ko: '1:30 PM', v2: { p: [70, 18, 12] }, v4: { p: [68, 19, 13], over: 60, btts: 52 },
    odds: { op: { h: -300, d: 450, a: 800 }, h: -350, d: 480, a: 900 } },
  { id: 's2', league: 'ger.2', leagueName: '2. Bundesliga', home: 'Hertha Berlin', away: 'VfL Wolfsburg', kickoff: T(4), ko: '2:30 PM', v2: { p: [40, 28, 32] }, v4: { p: [41, 27, 32], over: 55, btts: 55 } },
  { id: 's3', league: 'por.1', leagueName: 'Primeira Liga', home: 'Benfica', away: 'Porto', kickoff: T(5), ko: '3:30 PM', v2: { p: [45, 27, 28] }, v4: { p: [44, 28, 28], over: 50, btts: 50 } },
];
const hockey = [
  { id: 'h1', home: 'Edmonton Oilers', away: 'Detroit Red Wings', hAbbr: 'EDM', aAbbr: 'DET', kickoff: T(3), ko: '7:00 PM', v2: { w: 60, o: 50 }, v4: { w: 61, o: 50 }, ln: { v: 6.5 },
    px: { op: { h: -150, a: 125 }, h: -170, a: 140, tl: 6.5, to: -110, tu: -110, opt: { tl: 6.5, to: -105, tu: -115 } } },
  { id: 'h2', home: 'Boston Bruins', away: 'Toronto Maple Leafs', hAbbr: 'BOS', aAbbr: 'TOR', kickoff: T(4), ko: '8:00 PM', v2: { w: 52, o: 50 }, v4: { w: 52, o: 50 }, ln: { v: 6.5 } },
];
const answer = u => {
  const p = new URL(u).pathname;
  if (p === '/api/config') return { today: D, leagues: [] };
  if (p === '/api/day') return { date: D, cards: soccer };
  if (p === '/api/nhl/day') return { date: D, cards: hockey };
  if (p === '/api/days') return { days: [D] };
  if (p === '/api/status') return { leagues: [], writes: { used: 10, limit: 1000, by: {} } };
  return {};
};
const server = http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
try {
  // show(id): put one game's full card on the page (both Boards show a game's full card under its tile once the tile is picked)
  const pages = [['index.html', 'soccer', '.m', soccer.map(c => c.id), id => { S.sel = id; render(); }], ['nhl.html', 'hockey', '.card', hockey.map(c => c.id), id => { S.sel = id; render(); }]];
  for (const [file, label, cardSel, all, show] of pages) {
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.addInitScript(() => { window.__rz = 0; const add = window.addEventListener; window.addEventListener = function (t, ...a) { if (t === 'resize') window.__rz++; return add.call(this, t, ...a); }; try { localStorage.clear(); } catch (e) {} });
    await page.route('**/api/**', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(answer(r.request().url())) }));
    await page.route(u => !u.href.startsWith(base), r => r.abort()); // fonts and anything else off this machine
    await page.goto(`${base}/${file}`);
    await page.waitForFunction(() => window.FlipCard && typeof render === 'function' && typeof day !== 'undefined' && day && day.cards && day.cards.length > 0, null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(300);
    const seen = [];
    for (const id of all) {
      const r = await page.evaluate(([id, src]) => { (0, eval)(`(${src})`)(id);
        const pct = [...document.querySelectorAll('[data-gomove]')].some(e => !e.closest('.fc-back,.spl-in') && e.getAttribute('data-gomove') === id);
        return { id, pct, back: !!movesView(id) }; }, [id, show.toString()]);
      seen.push(r);
    }
    ok(`${label} page: loads with no script errors`, !errs.length, errs.join(' | '));
    ok(`${label} page: every tappable % has a Movement card behind it, and every game with a Movement card shows the %`, seen.every(r => r.pct === r.back) && seen.some(r => r.pct) && seen.some(r => !r.pct), JSON.stringify(seen));
    const first = seen.find(r => r.pct).id;
    await page.evaluate(([id, src]) => (0, eval)(`(${src})`)(id), [first, show.toString()]);
    const w0 = await page.$$eval('.fc-wrap', ws => ws.length), r0 = await page.evaluate(() => window.__rz);
    await page.evaluate(() => { for (let i = 0; i < 25; i++) render(); });
    const r1 = await page.evaluate(() => window.__rz), w1 = await page.$$eval('.fc-wrap', ws => ws.length);
    ok(`${label} page: 25 redraws add no resize listeners and keep the same flip cards`, w0 > 0 && r1 === r0 && w1 === w0, `listeners ${r0} -> ${r1}, wraps ${w0} -> ${w1}`);
    const open0 = await page.$$eval(`${cardSel}.open`, x => x.length);
    await page.focus(`[data-gomove="${first}"]`); await page.keyboard.press('Enter'); await page.waitForTimeout(800);
    const flipped = await page.evaluate(id => window.FlipCard.isFlipped(id), first), open1 = await page.$$eval(`${cardSel}.open`, x => x.length);
    ok(`${label} page: Enter on the focused % flips that card to its Movement side, and does not open or close the card`, flipped && open1 === open0, `flipped ${flipped}, open ${open0} -> ${open1}`);
    await page.close();
  }
} finally { await browser.close(); server.close(); }
console.log(bad ? `\n${bad} page check(s) FAILED` : '\nAll page checks passed'); process.exit(bad ? 1 : 0);
