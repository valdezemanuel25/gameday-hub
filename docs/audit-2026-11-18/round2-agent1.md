# Data integrity, round 2 (Agent 1), Nov 18, 2026

Four approved items: lost saves (a real fix), Model bets at DraftKings only, ESPN's close at grading, and grading reach. Agent 3's
branch (kept summaries, price tags against v4) is merged in and integrated. Nothing pushed or deployed; no live KV or secrets touched.
Model math is unchanged. Line numbers are in the merged tree.

## 1. Lost saves

### The problem

A day's cards live in one KV record (`day:<date>`, `nhl:day:<date>`), and so do the Analyst's paper bets (`analyst`). The cron and the
buttons each read the whole record, change it and write it all back. KV can serve a read up to about 60 seconds old in another location,
so a button pressed near a cron save could write back an older copy and erase the cron's work (a lineup-window close, a grade and its
locked pick, Forebet / SportsMole numbers, a paper bet), and a cron save could erase a button's. Yesterday's `putDay` / `keepSaved`
re-read narrows the window but reads through the same stale cache.

### Design chosen: the cron is the only writer; a button writes a side patch

* **Only the cron writes `day:*`, `nhl:day:*` and `analyst`.** A button (any request to the Worker) writes what it changed to a side record
  next to it: `fix:day:<date>`, `fix:nhl:day:<date>`, `fix:analyst` (`src/fixes.js`).
  * Day patches hold, per card, only the top-level fields the button changed (`set` / `del`), or the whole card when the button made it, plus
    the day-level keys it changed (`analyzed`, `analyzedAt`, `smTried`).
  * Analyst patches hold the bets the button placed or settled.
  * Each patch has a time `at`. Side records expire after `FIX_TTL` (10 days).
* **Every read lays the patches on top** (`applyFix`, `applyAnalystFix`), with yesterday's `keepSaved` rules (`keepCard`): a patch never takes
  away a result and its pick, a void, Forebet / SportsMole / shots numbers, or a close and its prices that the stored record has and the
  button's copy lacked. So a button that read a stale copy cannot erase the cron's work either.
  * The Analyst merge keeps one position per game, market and rule set, so a stale button look cannot add a second bet on a game the cron
    bet meanwhile.
* **Folding back.** The cron reads through the same merge, so its next save of a record carries the patches in and notes the newest one
  (`fxAt` on the record). Patches at or before `fxAt` are skipped on read and pruned by the next button save. A patch time is always past
  the stored `fxAt`, whatever the server's clock says (a test caught this).
  * `foldStep` saves any record whose patches no cron job carried in within 30 minutes (`FOLD_AFTER_MS`). It runs in an idle grading turn,
    looks at most every 30 minutes (edge cache) and saves one record a run.
* **Where it sits: the storage layer.** `withFixes(env)` wraps `env.HUB`. The fetch handler installs it with `{ button: true }`
  (worker.js:1283); the scheduled handler installs it without (worker.js:1497).
  * Every existing read gets the merged record with no change to its code: router reads, Results, Trends, exports, Analyst, bet builder,
    alerts, health, and the summaries.
  * A button's `put` becomes a patch. It is the diff between what that request read and what it saves.
  * Exported helpers for explicit use and for a plain (unwrapped) env: `getDay(env, date, sport)`, `listDays(env, sport)`,
    `readMerged(env, key)` (re-exported from worker.js). Every module that reads days now reads through them: worker.js, nhl.js,
    forebetpage.js, analyst.js, bets.js, health.js, push.js.
  * `putDay` skips its re-read for a button (worker.js:234), because the wrapper compares against the button's own read.
* **Old data stays readable.** A record with no side record reads exactly as stored, with no copy. Nothing needs migrating.
  * A day a button creates from nothing (Analyze this day) is written as the day itself: there is nothing to erase.

### Alternatives considered

| Option | Why not |
|---|---|
| Per-league day keys (`day:<date>:<slug>`) | A button and the cron's lineup burst hit the same league, so the race stays. Results reads 15 keys per day: 120 days = 1,800 reads, past the 1,000 KV operations per request. Needs a migration. |
| One side key per card (`fix:<date>:<league>:<id>`) | A day read must then list keys. KV lists are 1,000 a day on the free plan, and the cron reads days about 1,500 times a day. One side record per day needs a `get`, not a `list`. |
| Route button writes through the cron (edge-cache queue) | The edge cache is per data centre, and the cron runs elsewhere. |
| Durable Object per day, or D1 | Read-your-writes, but a new storage binding and a data move: out of scope for "no deploy-time migration". D1 (100,000 row writes a day) is the long-term answer to both the race and the write budget (Agent 3's note). |
| Explicit `getDay` at every call site only | Done for the modules above. The router lines Agent 3 was changing, and any new code, are covered by the storage wrapper instead, so nothing reads around the merge. |

### KV budget (free plan), before and after

Writes per day:

| What | Before | After |
|---|---|---|
| Cron jobs (sync, analysis, prices, grading, hockey, Analyst) | a few hundred (README; no stored history to give an exact figure) | unchanged |
| Button press that saves a day or the Analyst | 1 write (the record) | 1 write (its side record). A press that changed nothing writes nothing (saved before). |
| Folding a patch back | — | 0 when a cron job saves that record anyway (today's and tomorrow's days are saved every hour or so near games). Otherwise 1 per record, ≤ 1 per idle grading turn. Typically 0–3 a day; bounded by the number of records buttons touched. |
| Item 3: ESPN close at grading | — | 0 (rides on the grading save) |
| Item 4: grading reach to today −3 | — | 0 in normal running. +1 only for a league that used to stay ungraded. |
| Item 4: lead retries | — | ≤ 2 per league-day whose goal list was missing at grading. Typically 0. If ESPN never sends a goal list for some league, ≤ ~30 a day on a full weekend. |

Net: about +0–5 writes a day in normal use, against the 1,000 limit and the 800 saver line. Writes to side records are counted as
"button saves" in the write breakdown.

Other operations:

* **Reads** (100,000 a day): +1 per distinct day (or Analyst record) read in a request or cron run. Side records are cached per
  run/request. A listing of days also lists their side records once, so Results / Trends / exports add no per-day reads. About +1,500 reads
  a day from the cron.
* **Lists** (1,000 a day): +1 per day listing (Results, Trends, exports, a few dozen a day), plus the fold look (≤ 48–72 a day).

### CPU (Node, 60-card day ≈ 122 KB; scratch benchmark)

| Operation | Time |
|---|---|
| Read with no side record | same as before (parse ≈ 0.5 ms; merge returns the record as it is) |
| Read with a patch on 1 card | ≈ 0.5 ms |
| Read with a patch on all 60 cards | ≈ 0.6 ms |
| Button save, one card changed (read + diff + save) | ≈ 3.1 ms, against ≈ 1.5 ms before. The diff compares whole cards first, then fields only on changed cards. |
| Button Analyze diff, all 60 cards rebuilt | ≈ 3.4 ms. A real league is ≤ 12 cards. |
| Slot 1 reading 4 days instead of 3 | +1 day parse (≈ 0.5 ms on a full day) |

### Changes (file:line)

* `src/fixes.js` (new): `keepCard` / `keepSaved` (:46, :59, moved from worker.js), `applyFix` :76, `diffDay` :102, `addPatch` :128,
  `applyAnalystFix` / `diffAnalyst` / `addBets` :153–178, write ids `joinMeta` / `listFixMeta` / `withFixMeta` :192–204, `withFixes` :205,
  `readWithMeta` :262, `readMerged` / `getDay` / `listDays` :274–282, `foldStep` :292.
* `src/worker.js`:
  * imports and re-exports :33
  * `writeKind` 'button saves' :50
  * `putDay` :234
  * reads through `getDay` (analyzeLeague, refreshCardClose, priceWhy, refreshOdds, refreshBtts, oddsStep, gradeLeague, smLeague,
    forebetPaste, assignCandidate, runSlot, sweep `lastDays`)
  * fold in slot 1 :1197, `foldDue` :1256
  * entry points :1283, :1497
* `src/nhl.js` (all `nhl:day` reads via `getDay`), `src/analyst.js` :406, :478, `src/forebetpage.js` :117, `src/bets.js` :192,
  `src/health.js` :78, `src/push.js` :127.
* Tests: `test/fixes.mjs` (new, in `npm test`).
  * The old way loses a close to a stale button save; the new way keeps both.
  * A cron save from a stale read keeps the button's change, and the next cron save folds it.
  * A folded patch is never laid again.
  * A grade survives a stale button save.
  * A new day is written directly; an old day reads byte-identical; `listDays`.
  * Hockey: a typed line next to the cron's lineup read.
  * Analyst: bets placed and settled, one position.
  * Fold step.
  * Router `/api/assign` and `/api/day`; one write per press; no write for no change.
  * Summary rebuild (below).
* Test updates for the new storage: `test/verify.mjs` and `test/worker.mjs` read the merged day after button calls; the read-count bounds
  in `test/forebetpage.mjs` and `test/summaries.mjs` now include the side-record reads.

## 2. Model bets at DraftKings only

* At the lock (worker.js:801–806), a price is saved as `lean.price` (the price the profit record counts) only for a DraftKings price:
  * `odds.src` unset for home / draw / away / Over / Under;
  * `odds.bk === 'draftkings'` for both-score.
* A stand-in (Bet365, Pinnacle) or another book's both-score price is kept as `lean.spx` with its book in `lean.pbk`. It is not counted.
  `lean.vd` is set only with a counted price.
* Picks locked before keep their price and still count. Records are not rewritten.
* The Results profit (`tally`, `LB.pl`, and the early-payout units) is built from `lean.price`, so it stops counting non-DraftKings prices
  from now on with no date gate.
* The page's price line falls back to the card's price when a pick has no `price`. For a stand-in that is still the price at the lock, since
  item 3 never closes a stand-in.
* Test: `test/grading2.mjs`.

## 3. Soccer ESPN close at grading

* `espnCloseSoccer` (worker.js:821) runs after the pick locks (worker.js:807). For a DraftKings-priced card with no `odds.cl` it takes ESPN's
  closing line for the finished game, like hockey's `espnClose`:
  * `cl` = kickoff, `cls: 'espn'`, `ts` updated;
  * the opening (`f`, `op`) is kept;
  * parts ESPN lacks keep the last price.
* Stand-in cards and closes in another book's odds are skipped, so a game's open and close stay with one book. The Analyst never takes a
  stand-in close.
* `lean.price` stays the price shown at the lock. v6 (frozen at kickoff) is untouched.
* The Analyst settles after the save, so its closing-line value uses the close when it had not settled earlier.
* `gradeLeague` reports `closed`. Test: `test/grading2.mjs`.

## 4. Grading reach and early-payout lead retries

* Slot 1 looks back to today −3 (worker.js:1184), inside the Analyst's 4-day void.
* At grading a missing lead counts as try 1 (`final.ldt = 1`, worker.js:788).
* `leadStep` (worker.js:835, `LEAD_TRIES = 3`) runs first in an idle grading turn, in saver mode too (worker.js:1195):
  * It uses the days the turn already read, and handles one league-day per run.
  * It waits at least an hour after grading and between tries (edge cache).
  * Each run makes two ESPN requests and at most one write.
  * It reads the goal list (`regScore` for extra-time games) and saves `final.lead`, clears `ldt` and works out `lean.ep`. A failed try
    counts on the card. After 3 tries the card is left alone.
  * An ESPN failure is not counted as a try.
* Test: `test/grading2.mjs` covers:
  * the −3 reach and the −4 limit;
  * try 1 at grading;
  * a retry that reads the lead and sets `ep`;
  * 3 tries, then stop;
  * two requests a try.

## Integration with Agent 3's branch (merged)

* Conflicts resolved:
  * `package.json`: both test lists.
  * `nhl.js`: both imports. Agent 3's `nhlTally(env, days)` is kept.
  * `worker.js`: the merged `lastDays` with Agent 3's cached totals. Agent 3's `tally(env, days)` loop is kept.
* **The summaries read merged days:**
  * `readKeys` uses `readWithMeta` for day keys (merged value plus a joined write id).
  * `loadDays` goes through `readKeys`.
  * The wrapped store has a `getWithMetadata` that merges.
* **The stamp sees side records:**
  * `fix:day:` and `fix:nhl:day:` are in `STAMPED`, so their saves through `counted()` carry a write id.
  * A day's id in the listing, and on each read, is `<day id>+<side record id>`. The wrapper's `list` adds it; `listKeys` adds it for a
    plain store.
  * So a button's patch on a finished game rebuilds the kept Results and Trends summaries, as a cron save does.
  * Test: `test/fixes.mjs` section 10 (kept summary, Grade button patch, rebuilt, kept again). It fails if the prefixes are taken out of
    `STAMPED`.
* `lean.vd` at the lock is now `priceVerdict(c, lean)`, the tag the Results tab works out, so exports match the page. It is not set when
  there is no verdict. The unused `verdictOf` import is dropped. Test in `test/grading2.mjs`.
* Fold, lead retries and ESPN closes are all ordinary day saves through `counted()`, so they carry write ids and refresh the summaries.

`npm test`: exit 0, no FAIL lines.

## What is left, and why

* **Button against button on one side record.** Two button saves from different locations within about 60 seconds can still lose the
  earlier patch. One person on one device stays in one data centre, so this is very unlikely; per-card side keys would cost list operations.
* **Overlapping cron runs.** A run longer than 5 minutes overlapping the next could still clash on a day. `putDay`'s re-read and
  `keepSaved` cover the common fields. The fold also assumes a cron read is never more than 5 minutes stale.
* **Other shared records with read-modify-write are unchanged:** `nhl:state` (ratings; both writers apply the same finished games, deduped by
  id), `nhl:shots`, `meta:unm`, `meta:fb`, `nhl:fbmeta`, `meta:errors`, `bets`, `push`, `sm:*`. They are bookkeeping, or rebuilt by the next
  run.
* **A button's Analyze does not drop cards.** Moved games' cards are not removed by the button; the cron's next analysis does it.
* **Raw KV dumps.** `wrangler kv` dumps and any tool reading KV directly miss patches not yet folded (≤ 30 minutes plus the next idle
  turn). The Export buttons read merged.
* **Page display of non-DraftKings picks.** The page shows the card's price for a pick with no `price`. It could show `lean.spx` and say
  "not counted" (Agent 2's file, not changed).
* **Retired v2/v4 fields** unchanged. P5 (score-backup.py), P6 (moved NHL games) and P9 from the first audit are untouched.

## README change log (ready to paste)

**Saves, prices and grading (Nov 18, 2026, round 2).**

* **Button saves.** A button no longer saves a day or the Analyst's record. What it changed is kept next to it, in `fix:day:<date>`,
  `fix:nhl:day:<date>` or `fix:analyst` (`src/fixes.js`). Every read lays it on top, and the background job's next save carries it in.
  * So a button pressed near a background save can no longer erase a lineup-window close, a result, Forebet or SportsMole numbers, or a
    paper bet, and the other way round.
  * A change that no background save carries in within 30 minutes is saved by an idle grading turn.
  * It costs no extra write per press, at most one write per day touched to fold it in, and one more KV read per day read.
* **Model bets at DraftKings only.** Model bets and their profit count DraftKings prices only. A pick locked on a Bet365 or Pinnacle
  stand-in, or on another book's both-score price, keeps that price as `spx` with its book (`pbk`), shown but not counted. Earlier picks
  keep their price.
* **ESPN close at grading.** A finished DraftKings-priced game with no lineup read takes ESPN's closing line at grading (`cls: 'espn'`), for
  the Movement tab and closing-line value only. The pick's price stays the one shown when it locked.
* **Grading reach.** Grading now looks back to today −3.
* **Early-payout lead.** A game whose goal list was missing at grading is tried again, up to 3 tries in all (`final.ldt`).
* **Price tag.** The pick's saved price tag (`vd`) is the Results tab's (v4 against the DraftKings price).
