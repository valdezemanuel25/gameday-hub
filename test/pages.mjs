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
    if (label === 'soccer') { // Update Forebet asks only for leagues playing today (Nov 20, 2026), and judges coverage on today's games
      const need = await page.evaluate(() => { const fb = (ok, cov, covT) => ({ '1x2': { at: new Date().toISOString(), ok, cov, covT }, ou: { at: new Date().toISOString(), ok, cov, covT }, btts: { at: new Date().toISOString(), ok, cov, covT } });
        const was = stat; stat = { writes: { used: 10, limit: 1000, by: {} }, leagues: [
          { slug: 'ger.1', name: 'Bundesliga', games: { today: 1, tomorrow: 6 }, fb: fb(false, [0, 7], [0, 1]) },        // playing today, blocked: asked for
          { slug: 'eng.1', name: 'Premier League', games: { today: 0, tomorrow: 7 }, fb: fb(false, [0, 7], [0, 0]) },    // tomorrow only: left alone
          { slug: 'mex.1', name: 'Liga MX', games: { today: 3, tomorrow: 4 }, fb: fb(true, [3, 7], [3, 3]) },            // today's games all covered: done
        ] };
        const r = fbNeeds().map(j => j.slug); stat = was; return r; });
      ok('soccer: Update Forebet asks only for a league playing today that still needs it', JSON.stringify(need) === '["ger.1"]', JSON.stringify(need));
      const tmr = await page.evaluate(() => { const fb = (ok, cov) => ({ '1x2': { at: new Date().toISOString(), ok, cov }, ou: { at: new Date().toISOString(), ok, cov }, btts: { at: new Date().toISOString(), ok, cov } });
        const was = stat; stat = { writes: { used: 10, limit: 1000, by: {} }, leagues: [
          { slug: 'eng.1', name: 'Premier League', games: { today: 0, tomorrow: 7 }, fb: fb(false, [0, 7]) },   // tomorrow, blocked: offered
          { slug: 'mex.1', name: 'Liga MX', games: { today: 3, tomorrow: 4 }, fb: fb(true, [7, 7]) },          // tomorrow all covered: done
          { slug: 'esp.1', name: 'LaLiga', games: { today: 2, tomorrow: 0 }, fb: fb(false, [0, 2]) },          // today only: not this button
        ] };
        const r = fbTomorrow().map(j => j.slug); stat = was; return r; });
      ok('soccer: Fetch tomorrow offers only a league playing tomorrow that still needs it', JSON.stringify(tmr) === '["eng.1"]', JSON.stringify(tmr));
      const smn = await page.evaluate(() => { const was = stat; stat = { writes: { used: 10, limit: 1000, by: {} }, leagues: [
          { slug: 'eng.1', name: 'Premier League', games: { today: 0, tomorrow: 7 }, sm: { tried: null, found: 2, total: 7 } },   // 5 still missing: offered
          { slug: 'mex.1', name: 'Liga MX', games: { today: 3, tomorrow: 4 }, sm: { tried: null, found: 7, total: 7 } },          // all found: done
          { slug: 'esp.1', name: 'LaLiga', games: { today: 0, tomorrow: 0 }, sm: { tried: null, found: 0, total: 0 } },           // no games: not offered
        ] }; const r = smNeeds().map(j => `${j.slug}:${j.left}`); stat = was; return r; });
      ok('soccer: Update SportsMole offers only leagues with games still missing a preview', JSON.stringify(smn) === '["eng.1:5"]', JSON.stringify(smn));
    }
    if (label === 'hockey') { // a situation row says which side it backs (Nov 21, 2026)
      const tg = await page.evaluate(() => { const d = document.createElement('div'); d.innerHTML = trendEv({ toward: -1, label: 'Home favorite the line moved 3+ points toward', dir: 'against', w: 5, l: 7, n: 12 }, true, 'OTT', 'LAK') + trendEv({ toward: 2, label: 'x', dir: 'with', w: 6, l: 4, n: 10 }, false, 'Over', 'Under'); return [...d.querySelectorAll('.tg')].map(e => e.textContent + '|' + e.className); });
      ok('hockey: situation tags read "Backs LAK" / "Backs Over" and mark against the pick', JSON.stringify(tg) === '["Backs LAK|tg n","Backs Over|tg n"]', JSON.stringify(tg));
    }
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
  { // Top picks saved as on (Nov 10, 2026): its button was replaced by Flip on Nov 9, so the soccer page must open in the normal Board, not stuck in Top picks
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    await page.addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); localStorage.setItem('hubFilter', JSON.stringify({ league: 'all', top: true, tm: 'all' })); sessionStorage.setItem('seeded', '1'); } } catch (e) {} });
    await page.route('**/api/**', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(answer(r.request().url())) }));
    await page.route(u => !u.href.startsWith(base), r => r.abort());
    await page.goto(`${base}/index.html`);
    await page.waitForFunction(() => typeof render === 'function' && typeof day !== 'undefined' && day && day.cards && day.cards.length > 0, null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(300);
    const st = await page.evaluate(() => ({ top: !!S.top, all: !!document.querySelector('.chip.on[data-league="all"]') }));
    ok('soccer page: a saved Top picks "on" is not restored, and the All chip shows as on', !st.top && st.all, JSON.stringify(st));
    await page.close();
  }
  { // Loading and animation fixes (Nov 18, 2026)
    const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, reducedMotion: 'reduce' });
    await ctx.route(u => !u.href.startsWith(base), r => r.abort());
    await ctx.route('**/api/**', async r => { if (new URL(r.request().url()).pathname === '/api/day') await new Promise(x => setTimeout(x, 900)); r.fulfill({ contentType: 'application/json', body: JSON.stringify(answer(r.request().url())) }); });
    const page = await ctx.newPage(), errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.goto(`${base}/index.html`); await page.waitForTimeout(400);
    const ld = await page.evaluate(() => ({ skel: !!document.querySelector('.skel'), empty: /No games analyzed/.test(document.getElementById('view').textContent) }));
    ok('soccer page: while the day loads the Board shows placeholder tiles, not "No games analyzed"', ld.skel && !ld.empty, JSON.stringify(ld));
    await page.waitForFunction(() => day && day.cards && day.cards.length > 0, null, { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(300);
    ok('soccer page: the placeholders go once the day is in', await page.evaluate(() => !document.querySelector('.skel') && document.querySelectorAll('.sgt').length > 0));
    // the Movement card: the move has an arrow (not colour alone) and each chance has its open -> now bar
    const mv = await page.evaluate(() => { const h = movesView('s1'), d = document.createElement('div'); d.innerHTML = h; const tds = [...d.querySelectorAll('.mvx tr')].slice(1, 4);
      return { arrows: tds.filter(r => /[▲▼]/.test(r.lastElementChild.textContent) || r.lastElementChild.textContent.trim() === '0').length, bars: d.querySelectorAll('.mvx .cb i').length }; });
    ok('soccer Movement card: every result row says the move with an arrow and draws a chance bar', mv.arrows === 3 && mv.bars >= 3, JSON.stringify(mv));
    // reduced motion: a mouse over a flip card does not tilt or scale it
    await page.evaluate(() => { S.sel = 's1'; render(); }); await page.waitForTimeout(300);
    const box = await (await page.$('#sdt .fc-wrap')).boundingBox(); await page.mouse.move(box.x + 15, box.y + 15); await page.waitForTimeout(300);
    const tf = await page.evaluate(() => document.querySelector('#sdt .fc-in').style.transform);
    ok('reduced motion: hovering a flip card leaves it flat', /scale\(1(\.0+)?\) rotateX\(0(\.0+)?deg\)/.test(tf), tf);
    // the spotlight pop-up sleeps once the light has settled (it ran a frame loop for as long as it was open)
    await page.evaluate(() => { window.__raf = 0; const o = window.requestAnimationFrame; window.requestAnimationFrame = f => { window.__raf++; return o(f); }; Spotlight.open('<div class="mvg">x</div>'); });
    await page.waitForTimeout(700); const a = await page.evaluate(() => window.__raf); await page.waitForTimeout(500); const b = await page.evaluate(() => window.__raf);
    ok('spotlight: no frame loop while the pop-up sits idle', b - a === 0, `${b - a} frames in 0.5s`);
    await page.evaluate(() => Spotlight.close());
    ok('soccer page: no script errors in these checks', !errs.length, errs.join(' | '));
    // hockey: a 3+ point price move on a tile is lit (the plain style used to outrank the lit one) and carries an arrow
    const hp = await ctx.newPage(); await hp.goto(`${base}/nhl.html`);
    await hp.waitForFunction(() => typeof day !== 'undefined' && day && day.cards && day.cards.length > 0, null, { timeout: 15000 }).catch(() => {});
    const tag = await hp.evaluate(() => { day.cards[0].px = { op: { h: -150, a: 125 }, h: -200, a: 165, tl: 6.5, to: -110, tu: -110 }; render();
      const t = document.querySelector('.bt .mvtag'); return t ? { text: t.textContent, color: getComputedStyle(t).color, faint: getComputedStyle(document.querySelector('.bt .mvpc')).color } : null; });
    ok('hockey tile: a 3+ point move is lit and has an arrow', tag && /[▲▼]/.test(tag.text) && tag.color !== tag.faint, JSON.stringify(tag));
    await ctx.close();
  }
  { // One number per tile (Nov 18, 2026): the big chances come from the headline's source, so the headline pick's % is the one shown big
    // (a priced game showed v4's 70% over the market's "Bayern Munich to win 77%"), with a small "market" / "v4" label saying which.
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } }), errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.route('**/api/**', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(answer(r.request().url())) }));
    await page.route(u => !u.href.startsWith(base), r => r.abort());
    await page.goto(`${base}/index.html`);
    await page.waitForFunction(() => typeof render === 'function' && typeof day !== 'undefined' && day && day.cards && day.cards.length > 0, null, { timeout: 15000 }).catch(() => {});
    const cards = [ // priced, a result pick; priced, a goals pick (Under, where v4 leans Over); not priced (v4 leads)
      { id: 'p1', league: 'ger.1', leagueKey: 'bundesliga', leagueName: 'Bundesliga', home: 'Bayern Munich', away: 'Mainz', kickoff: T(3), ko: '1:30 PM', v2: { p: [70, 17, 13] },
        v4: { p: [70, 17, 13], over: 58, btts: 50 }, v6: { p: [77, 15, 8], over: 63, btts: 44 }, odds: { h: -350, d: 480, a: 900 } },
      { id: 'p2', league: 'ger.1', leagueKey: 'bundesliga', leagueName: 'Bundesliga', home: 'Borussia Dortmund', away: 'SC Freiburg', kickoff: T(4), ko: '2:30 PM', v2: { p: [45, 27, 28] },
        v4: { p: [45, 27, 28], over: 55, btts: 52 }, v6: { p: [40, 30, 30], over: 38, btts: 41 }, odds: { h: 150, d: 230, a: 180 } },
      { id: 'p3', league: 'por.1', leagueKey: 'primeira', leagueName: 'Primeira Liga', home: 'Benfica', away: 'Porto', kickoff: T(5), ko: '3:30 PM', v2: { p: [61, 22, 17] }, v4: { p: [61, 22, 17], over: 50, btts: 50 } },
    ];
    const got = await page.evaluate(cs => {
      day.cards = cs; S.league = 'all'; const out = [];
      for (const c of cs) {
        S.sel = c.id; render();
        const t = document.querySelector(`.sgt[data-ssel="${c.id}"]`), num = s => +(/(\d+)%/.exec(s) || [])[1];
        const head = t.querySelector('.lt b').textContent, hp = num(t.querySelector('.lt em').textContent);
        const rows = [...t.querySelectorAll('.r2')].map(r => ({ n: r.querySelector('b').firstChild.textContent, p: num(r.querySelector('span').textContent) }));
        const foot = t.querySelector('.f2').textContent, goals = /(O2\.5|U2\.5|BTTS no|BTTS) (\d+)%/.exec(foot);
        const team = rows.find(r => head === r.n + ' to win'), big = team ? team.p : head === 'Draw' ? num(/Draw (\d+)%/.exec(foot)[0]) : goals ? +goals[2] : null;
        const lab = t.querySelector('.srcl'), cn = document.querySelector('#sdt .xp .n'), cl = cn && cn.querySelector('.srcl');
        const card = cn ? [...cn.children].map(x => num(x.textContent)) : [];
        out.push({ id: c.id, head, hp, big, goals: goals && goals[0], label: lab && lab.textContent, fs: lab ? parseFloat(getComputedStyle(lab).fontSize) : 0, cardLabel: cl && cl.textContent,
          card, tile: [rows[0].p, num(/Draw (\d+)%/.exec(foot)[0]), rows[1].p] });
      }
      return out;
    }, cards);
    const [p1, p2, p3] = got;
    ok('one number per tile: priced result pick, the big % is the headline\'s (market 77%, not v4 70%), labelled "market"', p1.big === 77 && p1.hp === 77 && p1.label === 'market', JSON.stringify(p1));
    ok('one number per tile: priced goals pick, the big chances are the market\'s and the goals number beside the draw is the headline\'s side (U2.5 62%)', p2.goals === 'U2.5 62%' && p2.big === p2.hp && p2.tile.join() === '40,30,30' && p2.label === 'market', JSON.stringify(p2));
    ok('one number per tile: not priced, v4 leads and the big % is v4\'s, labelled "v4"', p3.big === 61 && p3.hp === 61 && p3.label === 'v4', JSON.stringify(p3));
    ok('open card: the big chances and label match the tile', got.every(x => x.cardLabel && x.card.join() === x.tile.join() && x.cardLabel === x.label), JSON.stringify(got.map(x => [x.id, x.card, x.tile, x.cardLabel])));
    ok('source label is at least 11px', got.every(x => x.fs >= 11), JSON.stringify(got.map(x => x.fs)));
    ok('one number per tile: no script errors', !errs.length, errs.join(' | '));
    await page.close();
  }
} finally { await browser.close(); server.close(); }
console.log(bad ? `\n${bad} page check(s) FAILED` : '\nAll page checks passed'); process.exit(bad ? 1 : 0);
