# Front end audit: animations, readability and charts (Nov 18, 2026)

Agent 2 (front end). Scope: `public/` (the backup/export code was left to Agent 1). Model math and pick rules were not touched.

## How it was checked

- The real Worker code (`src/worker.js`) ran in Node on an in-memory store with stand-in soccer and hockey days (priced and unpriced games, a
  big move, in-play, finished and graded games, long club names), served to Chromium through Playwright. Outside calls (fonts, ESPN logos)
  were blocked, except in one check where logos were served locally.
- Views: iPhone 13 (390 × 664) and desktop (1280 × 900), with and without reduced motion. The site is dark only; there is no light theme to
  check (`prefers-color-scheme` is not used anywhere).
- Pages: Soccer Board (tiles, open card, flipped card), Movement, Model bets, Results, Analyst, NHL Board and card, Home, Brew, Login.
- Console: no script errors on any page before or after. The only messages were the blocked outside requests and headless GL readback
  warnings caused by taking screenshots.
- Before / after: the original `public/` was served side by side from a copy of `HEAD`, and every fix below was measured on both.

## Bugs found

Line numbers are in the original files (commit 962203b).

| # | File:line | Symptom | Fixed |
|---|-----------|---------|-------|
| 1 | `public/index.html:2098`, `:1200` | Changing day (or opening the page) cleared the cards and showed "No games analyzed for this day yet. Tap Analyze this day" until the data arrived, and the page collapsed and re-grew (layout shift). | Yes: placeholder tiles and "Loading…" while a day loads. |
| 2 | `public/index.html:832`, `public/nhl.html:337` | Club logos are added by `onload` after every redraw, so each tap (every redraw rebuilds the Board) flashed the coloured letter circle for a frame before the cached logo came back. Measured: 0 of 7 logos drawn right after a redraw. | Yes: logos that loaded once are drawn as logos at once (7 of 7). |
| 3 | `public/nhl.html:199` vs `:562` | The hockey tile's lit (neon) style for a 3+ point move is outranked by `.bt .r b small.mvtag`, so the move never lit: it rendered in the faint grey. | Yes, and both sides of the move now light (as on the hockey Movement card). |
| 4 | `public/nhl.html:349`, `:355` | The model box bar drew `(p − 50) × 2`, so "EDM 61%" sat over a bar a fifth full: it reads as a probability bar but was not one. | Yes: the bar is the chance, with a tick at 50%. |
| 5 | `public/waves.js:109` | With reduced motion, the backdrop loop stops after one frame; a resize or phone rotation clears the canvas and nothing redraws it, so the dots vanish. Measured: 6,168 lit samples before a resize, 0 after. | Yes: 4,821 after (smaller window). |
| 6 | `public/spotlight.js:218-229` | The pop-up ran a `requestAnimationFrame` loop every frame for as long as it was open, rewriting the same style values with no pointer on it (~60 extra frames a second). | Yes: it sleeps once the light settles and wakes on the next move (0 frames when idle). |
| 7 | `public/flipcard.js:79` | Tilt, glare and the 1.03 hover scale followed the mouse even with reduced motion on. | Yes: off with reduced motion (the flip itself was already instant). |
| 8 | `public/sweep.js:50-62` | Sweep's infinite SVG loops (with blur filters) kept running while he was tucked away at opacity 0. | Yes: paused while tucked or leaving. |
| 9 | `public/sweep.js:153` | Each time he came back (next shift, same page) another copy of his stylesheet was added. | Yes: added once per page. |
| 10 | `public/sweep.js:161` | `requestAnimationFrame(() => el.className = 'in')` threw if he was hidden before the frame. | Yes: guarded. |
| 11 | `public/home.html:198` | The carousel rewrote all nine cards' transforms, opacity and z-index every frame even while standing still between drifts. | Yes: redraws only when the ring has turned. |
| 12 | `public/index.html:215` | Long club names on the open card broke mid-word anywhere ("Wolverhamp / ton…"). | Partly: hyphenation (iOS / Android show "Wolver-hampton"), and words over 11 / 13 letters are set at 12 / 11.5px. With no hyphenation dictionary a very long word can still split. |
| 13 | `public/index.html:458` | Soccer tile price moves: a rise was coloured red with a glow (the colour used for a miss), a fall faint grey; the Movement card colours the same moves lime by size. | Yes: lime by size, arrow for direction. |
| 14 | `public/flipcard.js:20-23` | The Movement side of a flipped card cannot blur the dots behind it (a 3D-turned face loses `backdrop-filter`), so its notes were hard to read over bright dots. | Yes: a dark tint behind it; still see-through. |
| 15 | `test/pick.mjs:7-8`, `test/headline.mjs:5-6` | Both crashed with "MIN_CARD is not defined" and were not in `npm test`, so the check that the page's headline pick matches the server's was unguarded. | Yes: fixed and added to `npm test`. |
| 16 | `test/odds.mjs:44` | A stale assertion: La Liga 2 is priced since Nov 2, so the second price run legitimately reads it. | Yes: the check keeps its intent (eng.1 is not read again, nothing written), plus a third run that reads nothing. Added to `npm test`. |

Checked and not a bug:

- `waves.js` cursor glow after a touch: `document` does get `pointerleave` after a touch tap in Chromium, so the glow drops.
- `flipcard.js` listeners: one window `resize` listener for all cards (already tested); ResizeObservers disconnect when a card leaves the page.
- Redraws do not restart any animation: there are no entrance animations on tiles; a flipped card is re-flipped instantly after a redraw.
- `hidebar.js` animates `transform` and `opacity` only and respects reduced motion.
- No horizontal page scroll at 390px.

## Readability

Measured at 390px against the page's near-black (`#070908`). The moving dots behind see-through cards lower contrast further; see proposal 1.

- Contrast: no text failed WCAG AA against the page background (the theme's `--dim` / `--faint` were already raised on Nov 9).
- Small text: labels at 10–10.5px (price-move tags and their "24→20%", model box titles, score card labels, card header, Movement
  table heads and flags, hockey model box titles) are now 11px. Left as is: the 8.5px letters inside club crests (a logo covers them) and the
  10.5px score lines in the model boxes.
- Numbers: `tnum` (tabular figures) is on for the whole page from `body`, so odds and percentages already line up.
- Hierarchy: the headline pick (17px), its % (lime) and the model tags (11px) read in that order. One snag is left for later (proposal 5).
- Tap targets: chips were 30px tall, top bar links 37px, the pick % 22px. An invisible ring now makes them about 42px, 45px and 43px without
  changing how they look (chips are clipped by their scrolling row at the bottom). The tab row went from 39 to 44px.
- The tab row scrolls sideways on a phone with no hint; it now fades at the right edge (as the hockey page already did).
- Truncation: tile names ellipsize cleanly; the open card's two-line names are covered in bug 12.

## Data visualization changes

| Where | Before | After |
|-------|--------|-------|
| Price move on a soccer tile | "+6" in glowing red for a rise, "-4" faint grey for a fall; colour carried the meaning. | "▲+6" / "▼-4": arrow and sign for direction, lime brightness for size (3–4 points dim, 5+ bright), as on the Movement card. |
| Price move on a hockey tile | "+4" / "-4" both faint (lit style never applied). | "▲+4" / "▼-4" in the hockey accent, lit. |
| Movement card (both sports) | Move column "+4" / "-3", coloured by size only; Chance "38→34%" as text. | Move "▲+4" / "▼-3"; under each chance a small bar: the fill is the chance now, the tick the opening chance, so the move shows as the gap between them. |
| Hockey model box | Bar = distance from 50% (61% drew 22% full). | Bar = the chance (61% full), tick at 50%. |
| Model agreement on soccer tiles | "market · all 3 models agree" in words. | Three dots before the words, filled for each model that agrees, hollow for one that does not. |
| Records (Model bets, Tracked bets) | "62% · 31 of 50 · ±13 · chance 48%" in text. | The same text plus a bar: the fill is the hit rate, the tick is what chance alone hits; green above the tick, red at or below. |
| Win / loss colour | Four reds for a miss (`#e07a6a`, `#e0786f`, `#FF6B7A`, and red for a rising price). | One red (`--miss`) for every miss mark; red no longer used for a price rise on soccer. |

Screenshots used for checking (not committed) were taken at 1x and 2x for the tiles, open card, flipped card, Movement, Model bets and the
hockey tile and card.

## Tests

- `test/pages.mjs` (browser) gained checks for: the loading tiles; the Movement card's arrows and chance bars; flat flip cards under reduced
  motion; no frame loop in an idle pop-up; a lit hockey move with an arrow. All five fail on the original pages and pass now.
- `test/pick.mjs`, `test/headline.mjs`, `test/odds.mjs` fixed and added to `npm test`.
- `test/agree.mjs`, `test/bets.mjs`, `test/btts.mjs`, `test/push.mjs` pass but are still not in `npm test` (server side, left for the owners).
- `npm test`: all pass.

## Proposals not implemented (most useful first)

1. **Board tiles over the moving dots.** Tiles (`.sgt`, hockey `.bt`) and the hockey card are see-through with no blur, by design ("the moving
   background shows"). Where the dots are bright (the intro glow, a cursor or the dense band) grey text such as "Rayo Vallecano 10%" drops to
   roughly 1.5:1 against the lime dots; the dark text outline only partly saves it. A dark tint on tiles (about `rgba(8,10,8,.55)`), or adding
   them to the blur list in `waves.js`, would fix contrast. It changes the look, so it needs a design call.
2. **Backdrop cost on phones.** `waves.js` draws a full-screen WebGL frame 60 times a second forever, and every `.m`, `.box`, `.xq` and `.mvg`
   has `backdrop-filter: blur(14px)`, which must be redone each frame because the backdrop changes (and `.xq`/`.box` blur inside an already
   blurred card). Cap the loop at 30 fps, pause it while the page is scrolling or idle for a while, and drop the nested blurs.
3. **Flip animates height.** `.fc-wrap` animates `height` for 0.38s on each flip, so everything below the card is laid out again every frame.
   Holding the wrap at the taller of the two faces for the flip (and settling once at the end) would keep the spin on `transform` only.
4. **Whole-page redraw on every tap.** `render()` rebuilds the whole view with `innerHTML`, re-wraps every flip card and re-creates their
   ResizeObservers. Redrawing only the tile that changed would remove most redraw work and the risk of flashes.
5. **Two numbers for one outcome on a tile.** The big % is v4's chance (Real Madrid 74%) while the headline under it is the market's pick for
   the same result (Real Madrid to win 77%). Label the big number "v4" or show the market's % there when the headline is the market's.
6. The NHL page could get the agreement dots and the loading placeholders too (it keeps the old day on screen while loading, so it has no
   flash, but no sign it is loading either).
7. Sweep's SVG uses blur filters on animated groups; a pre-blurred image or no filter would make his idle loops much cheaper.
8. A light theme does not exist; if one is wanted, the colours are already tokens on `:root`, but the neon overrides would need a second set.
