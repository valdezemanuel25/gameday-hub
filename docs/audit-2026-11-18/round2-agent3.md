# Round 2, Agent 3 (code logic and performance), Nov 18, 2026

Two approved items from my first-round audit (`agent3-code-security.md`): **#13 / P8** the price verdict, and **P6** cached full-history
summaries (with the export's double read and the unpaged `list()` from Agent 1's P5). Branch `worktree-agent-a45ac82882c3a7f2c`, built on
`7dcfd2b` (Agent 1 and Agent 2 merged). Nothing pushed or deployed. No secret was read or printed.

| Commit | What |
|---|---|
| `20b9246` | Price tags compare v4 with the DraftKings price, not the score card with its own price (item 5) |
| `f31867a` | Keep the Results and Trends summaries instead of rebuilding them on every load (item 6) |

`npm test`: exit 0, no FAIL lines (verify.mjs runs twice; two new files, `test/verdict.mjs` and `test/summaries.mjs`, sit before the final
`node test/verify.mjs`). No model math and no pick rule changed. `gradeLeague` is not edited at all.

## Item 5: the price verdict (finding #13)

### What was wrong

At grading the lock saves `lean.vd = verdictOf(lean.p, price)` (`src/worker.js:810`, unchanged). Since Oct 27, `lean.p` is v6's chance,
and v6 is fitted to that same price with the margin removed. So `p - needP(price)` is always about minus the margin share (a few points
under break-even): Fair on nearly every pick, Not worth it only where the power method takes more margin (long prices). The `byVerdict` /
`byCombo` profit split said nothing about value.

### The choice: v4's chance, not Pinnacle's fair price

| | v4's chance | Pinnacle's fair (margin-removed) price |
|---|---|---|
| Independent of DraftKings | Yes: v4 uses no prices at all | Yes |
| Does the +/-5-point tag spread out? | Yes: v4 regularly disagrees with the price by 5+ points (that is why the tags were first made, and why they were retired on Oct 26: 8,026 games) | **No.** On the 6,531 football-data games with Pinnacle and Bet365 closing prices, Pinnacle's fair chance of the market's top result sat within 5 points of Bet365's break-even **97.4%** of the time (2 Value, 6,358 Fair, 171 Not worth it; mean gap 2.7 points). It would read Fair almost always: the same failure as now |
| Coverage | Every card on the 11 league tabs (not cup games, not a promoted club's starting rating) | Only with `PINNODDS_KEY` (trial: 100 requests a day), only matched games, no both-score on many |
| Already measured elsewhere? | No | Yes: the Analyst's Stale price rule bets exactly "DraftKings pays 2%+ more than Pinnacle's fair chance", with real P/L |
| Continuity | Picks locked before Oct 27 carried v4's (or consensus) chance, so the old record meant this | New |

So the tag is **v4's chance for the pick's market against the break-even chance of the DraftKings price the pick was graded at**, with the
same `verdictOf` thresholds (5+ points over = Value, 5+ under = Not worth it). It asks: when v4 disagrees with DraftKings, does that pay?
(Script for the Pinnacle check: `pinnspread.mjs` in my scratchpad; it reads `data/football-data/*.csv`, closing PSCH/D/A and B365CH/D/A.)

**No tag** when: there is no saved price; the price is not DraftKings' (`odds.src` set for home / draw / away and Over/Under, `odds.bk`
not `draftkings` for both-score, or `lean.pbk` set: the same rule the lock uses for `pbk`); v4 has no number for that market; or v4 is a
promoted club's starting rating (`v4.promo`, already kept out of every v4 record). A both-score pick priced by DraftKings on a card whose
result price is a stand-in is tagged, because its own price is DraftKings'.

### Where the verdict is computed and shown

| Place | Before | Now |
|---|---|---|
| `src/pick.js:111` `v4Chance`, `:124` `priceVerdict(c, L)` | (none) | New. Tag from the saved card |
| `src/worker.js:810` gradeLeague lock, `l.vd = verdictOf(l.p, m)` | The meaningless tag, saved on the card | **Unchanged** (not my file to edit). `lean.vd` is no longer read by anything |
| `src/worker.js:995` tally, Profit at saved prices | `byVerdict` / `byCombo` from `L.vd` | From `priceVerdict(c, L)`, worked out on every build, so every pick (older ones too) uses one rule |
| `public/index.html:1696-1701` `profitView` | "Retired price tags (Value / Fair / Not worth it)" | "**Price tags: v4 against DraftKings (Value / Fair / Not worth it)**", with a note on what it compares, that stand-ins get no tag, that older picks were re-tagged, and that the tags stay off the cards (retired Oct 26) |
| Cards, Model bets list (`index.html:1213`, `:1665`) | No tag (retired Oct 26) | No change |
| Hockey (`src/nhl.js` nhlTally, `public/nhl.html`) | No verdict anywhere (hockey picks have no `price` / `vd`) | No change |
| Sweep `soccer.json` (`leans.pl.byVerdict`) | Old meaning | New meaning, same shape |

Follow-up for whoever owns `gradeLeague` (optional): replace `l.vd = verdictOf(l.p, m)` with `l.vd = priceVerdict(c, l)` so the saved
field and exports agree with the page. Nothing depends on it.

Test: `test/verdict.mjs` (17 checks): v4's number per market, the tag thresholds, the old bug reproduced (v6's own de-margined chance only
ever says Fair) next to the new tag, no tag on Bet365 / Pinnacle stand-ins, `pbk`, a Pinnacle both-score price, no v4 / promo / no
market; `/api/tally`'s split is v4's even when the saved `lean.vd` says fair; the page label. Fails on the old tree.

## Item 6: cached full-history summaries (P6)

### What changed

| Where | Change |
|---|---|
| `src/summaries.js` (new) | The cache: `summary()`, the write id (`stampPut`), paged `listKeys`, `readKeys` (with metadata), `loadDays`, the stamp (`settledView`, `dayPart`, `digest`) |
| `src/worker.js:56-59` `counted()` | Every put of `day:*` / `nhl:day:*` gets `{ metadata: { w: <write id> } }` (no extra write); `getWithMetadata` passed through |
| `src/worker.js:37` `jsonText` | Sends the kept text with `x-hub-cache: mem / edge / miss / off` |
| `src/worker.js:168-169` `soccerTotals`, `nhlTotals` | `tally` / `nhlTally` wrapped at the call sites |
| `src/worker.js:165` health (deep), `:175` `sweepData` | The sweep's soccer / nhl files and the hockey rest check use the kept totals (`src/sweepdata.js` unchanged) |
| `src/worker.js:874-875`, `:938` `tally(env, days = null)` | Takes the days already read; on its own it lists page by page (`loadDays`) and reads in parallel |
| `src/nhl.js:634-635` `nhlTally(env, days = null)` | Same |
| `src/worker.js:1312-1316` `/api/trends`, `/api/tally`; `:1367-1371` `/api/nhl/tally`, `/api/nhl/trends` | Through `summary()` |
| `src/worker.js:1360-1364` `/api/nhl/export` | Reads each hockey day once and hands the same days to the totals (or takes the kept totals) |
| `wrangler.toml` | `[version_metadata] binding = "CF_VERSION_METADATA"` (free) so a deploy starts every summary afresh |

Signatures: `tally(env)`, `nhlTally(env)`, `buildSoccerTrends(days, date)`, `buildTrends(days, date)` all still work as before; the two
tallies take an optional `days`.

### Cache key and invalidation

* **Where**: the isolate's memory (12 answers) first, then `caches.default` at `https://hub.local/sum/<kind>/<stamp>` (`max-age` 12 h).
  No KV writes. Kinds: `tally`, `nhltally`, `trends` (+ date), `nhltrends` (+ date).
* **Stamp** = SHA-1 of: kind, `SUM_VERSION`, `env.CF_VERSION_METADATA.id`, the date (Trends), and for every key under the prefix
  `name=part`, where the part is:
  * a day with an open game: the hash of its **settled view**: the finished, graded or void cards in full (all `tally` / `nhlTally`
    read); for Trends also the open games' identity (id, league, clubs, kickoff: streaks, rest days and day counts use them);
  * a day with every game finished or void: `w<write id>` (only a save can change it, so nothing is hashed: hashing every day cost more
    CPU than building the tally, see below);
  * a day saved before this deploy (no write id): `-` (it has not been saved since; its next save adds a write id);
  * plus, for Trends, the write id of the Trends date's own day (its open games' prices feed the read).
* **How a change is seen**: `list()` already returns each key's metadata, so one list call says which days were saved. Only those are read
  (`getWithMetadata`), and their part is looked up in a memo `name@writeid -> part` (memory, plus `https://hub.local/sum-memo/<prefix>`
  in the edge cache for 7 days, pruned to the current keys). An unchanged day is never read.
* **What rebuilds**: a grade, a void, a close or early-payout lead added to a finished card, a game moved between days, a new day (Trends:
  also a new or removed game), a deploy, `SUM_VERSION` + 1. **What does not**: price reads, re-analysis, Forebet / SportsMole on open
  games, the lineup read of an open game. Trends of a date rebuild on every save of that date's day.
* **Why this stamp and not the alternatives**: a version number bumped in the edge cache at grading does not work, because the edge cache is
  per data centre and the cron grades wherever Cloudflare runs it: the visitor's data centre would never see the bump. A "latest grading
  time" is not stored anywhere today, and storing one means editing `gradeLeague` and reading the day anyway. KV metadata is global, rides
  on the existing save, is returned by the list call the routes already make, and needs no edit in `gradeLeague` or any writer (the one
  hook is the write counter that every save already goes through).
* **Consistency**: a stamp is always computed from the metadata of the values actually read, and a miss is stored under the stamp of the
  days it was built from (a second stamp after the build). A stale list (KV, up to ~60 s) can serve the previous answer for that long, as
  the old code could read a stale day; it can never store new-stamp-with-old-data.
* **Fallbacks**: `caches` undefined (Node tests; `npm test` runs every route uncached, `x-hub-cache: off`), a cache call that throws, or a
  miss: built exactly as before. A build that throws is passed on (the route answers its error) and nothing is kept. Only an object answer
  without an `error` field is kept.

### Benchmark

Real Worker (`worker.fetch`, signed in), in-memory KV, synthetic days: 60 fully filled graded soccer cards (151 KB) and 12 graded hockey
games (12 KB) a day, plus an open tomorrow, saved through `counted()`. Node 22 / V8 wall time with no I/O wait, so close to CPU time;
median of 7, ms. Scripts: `synth.mjs`, `bench.mjs` (old code), `bench2.mjs` (cache scenarios) in my scratchpad `r2/`.

Old code (`7dcfd2b`), cold / warm:

| Route | 35 days | 120 days |
|---|---|---|
| `/api/tally` | 31 / 37 | 86 / 66 |
| `/api/trends` | 46 / 31 | 108 / 107 |
| `/api/nhl/tally` | 17 / 17 | 53 / 50 |
| `/api/nhl/trends` | 26 / 23 | 122 / 108 |
| `/api/nhl/export` | 19 (73 KV reads) | 65 (243 reads) |

New code, 35 days (`off` = no caches, the old work; `cold` = first build with empty caches; `newIso` = a fresh isolate, edge cache warm;
`mem` = same isolate; `price` = after a price-only save of today's day; `graded` = after a result on yesterday's day):

| Route | off | cold | newIso | mem | price | graded |
|---|---|---|---|---|---|---|
| `/api/tally` | 28.6 | 38.9 miss | 3.8 edge, 0 reads | 2.0 mem | 3.3 mem, 1 read | 37.1 miss |
| `/api/trends` (today) | 29.6 | 30.6 miss | 0.4 edge | 0.3 mem | 28.8 miss | 28.7 miss |
| `/api/nhl/tally` | 15.6 | 17.4 miss | 0.4 edge | 0.3 mem | 0.8 mem, 1 read | 16.6 miss |
| `/api/nhl/trends` (today) | 22.2 | 21.2 miss | 0.3 edge | 0.3 mem | 21.0 miss | 21.4 miss |
| `/api/nhl/export` | 16.5 (37 reads) | 17.5 | 5.9 | 5.5 | 5.8 | 17.2 |

120 days:

| Route | off | cold | newIso | mem | price | graded |
|---|---|---|---|---|---|---|
| `/api/tally` | 85.4 | 90.4 | 1.4 | 0.9 | 1.7 | 84.0 |
| `/api/trends` (today) | 94.0 | 101.7 | 0.6 | 0.4 | 93.9 | 93.2 |
| `/api/nhl/tally` | 54.8 | 50.7 | 0.6 | 0.4 | 0.9 | 54.8 |
| `/api/nhl/trends` (today) | 106.4 | 99.1 | 0.5 | 0.4 | 102.3 | 102.1 |
| `/api/nhl/export` | 56.7 (122 reads) | 57.7 | 16.6 | 18.4 | 15.9 | 56.2 |

Readings: a kept answer costs 0.3 to 4 ms at any history length, and holds through the cron's price saves. A miss costs what the old route
cost (within the ~10% noise of these runs). The backup now reads each hockey day once (122 reads, was 243) and, with the totals kept,
costs about a third. The write hook adds a random id per day save (no measurable CPU).

Design check that shaped the stamp: fingerprinting one 151 KB day costs 0.55 ms to parse, 1.5 ms to parse + stringify its finished cards
+ hash, 0.33 ms to SHA-1 the raw text. Hashing every day's settled view on a cold build made `/api/tally` 86 ms instead of 32 (35 days),
so finished days use their write id and only days with an open game (normally today and tomorrow) are hashed.

Test: `test/summaries.mjs` (39 checks): write ids through `counted()` (day keys only, caller metadata kept); `listKeys` follows the
cursor (4-key pages in the mock), and `tally` / `nhlTally` count games on every page (they saw only the first page before); every route
uncached gives `off` and the old answer; miss, then `mem`, then `edge` for a fresh isolate, with 0 day reads, byte-identical to the
uncached answer; a price save keeps the Results summaries (1 read) and rebuilds that date's Trends; a new open game keeps the Results
summary and rebuilds Trends; grading rebuilds all four and the new result is in; an early-payout lead added days later rebuilds; a new
deploy id rebuilds; Trends kept per date; a failed KV read answers 500 and keeps nothing; a build that throws keeps nothing; a cache whose
every call throws still answers correctly; the backup reads each day once and its totals equal `nhlTally`; the stamp parts.

## Risks

1. **The edge cache on `workers.dev`.** The Hub runs on `gameday-hub.<you>.workers.dev`. If `caches.default` does nothing on that host
   (Cloudflare documents the Cache API as tied to a zone; I could not check it from here), only the isolate memory layer works: repeat
   loads served by the same isolate are fast, a fresh isolate rebuilds. **Check after deploy**: open the Results tab twice and look at the
   `x-hub-cache` response header (`mem` on the second load); a few minutes later in another tab, `edge` means the edge cache works. The
   write counter (`counted()`), the PinnOdds list and the credit notes rely on the same cache, so this is worth knowing anyway. A custom
   domain or route would make it certain.
2. **Every day save must go through `counted()`.** Both entry points (`fetch`, `scheduled`) wrap `env.HUB`, and every writer uses that
   `env`. A future writer that saves a day through the raw binding (`env0.HUB`) would not change the stamp: its change would show only after
   the 12 h `MAX_AGE`, the next stamped save of that day, or a deploy. Days saved before this deploy are trusted as unchanged until their
   next save (which stamps them).
3. **Misses still cost the full build.** The first Results load after each grading, and every Trends load for today after a save of today,
   still take 30 ms (35 days) to 100 ms (120 days). The cache cuts how often; it does not cut the worst case. The structural fix is the
   other half of P6: a compact per-day summary record, or D1.
4. **Agent 1's side keys.** If button-written fields move to side keys merged on read (`getDay` / `listDays`), the summaries must read
   through that helper (`loadDays` / `readKeys` in `src/summaries.js` read `day:` keys directly) and the side keys' prefix must be added to
   `STAMPED` and to the stamp, or a close written to a side key will not rebuild a kept summary. Agent 1's changes to `gradeLeague` and
   `tally` (DraftKings-only P/L and so on) are covered by the deploy version id.
5. **`version_metadata` binding** is new in `wrangler.toml` (wrangler 4 supports it). Without it the stamp has no deploy id, and
   `SUM_VERSION` must be bumped by hand whenever the code of a summary changes.
6. **Re-tagged history.** Every priced pick, back to Oct 14, is tagged by v4 now, so the Value / Fair / Not worth it rows change at once.
   `lean.vd` in saved cards and backups still holds the old tag (not read).
7. Memory: up to 12 kept answers per isolate (the soccer tally is the biggest, a few hundred KB). Fine within 128 MB.

## README change-log text (ready to paste)

### Faster Results and Trends; price tags against v4 (Nov 18, 2026)

* **Results and Trends are kept, not rebuilt (`src/summaries.js`).** The Results tab, both Trends tabs, the hockey backup and the nightly
  sweep read every saved day, which already took about 30 ms of CPU at 35 days (85 to 105 ms at 120) against the free plan's 10 ms. Their
  answer is now kept in the free edge cache and the Worker's memory and given back until something it counts changes. Each saved day
  carries a write id (KV metadata, no extra write); the key list shows which days changed, and only a grade, a void, a close or an
  early-payout lead on a finished game, a new day or a new deploy builds it again. Price reads on games not yet played do not, except for
  the Trends read of that day. A kept answer takes 1 to 4 ms; the first load after a result still takes the full time. The response
  header `x-hub-cache` says `mem` or `edge` (kept), `miss` (built) or `off` (no cache). The key list is now read page by page (it
  stopped at 1,000 days), and the hockey backup reads each day once.
* **Price tags (Value / Fair / Not worth it).** The split under "Profit at saved prices" now compares v4's chance with the DraftKings
  price the pick was graded at (Value = v4 5+ points over the break-even, Not worth it = 5+ under). Before, it compared the score card's
  chance with the same price it was read from, so nearly every pick said Fair. Stand-in prices (Bet365, Pinnacle) and picks v4 has no
  number for get no tag. Every pick is tagged this way, older ones included. Pinnacle's fair price was not used: on 6,531 past games it sat
  within 5 points of the book's break-even 97% of the time, so it would also say Fair almost always. The tags stay off the cards.
