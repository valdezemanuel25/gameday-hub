# Data integrity audit (Agent 1), Nov 18, 2026

Goal: every game gets through every step of the workflow, and what is saved is accurate when exported.

Scope: `src/worker.js` (pipeline, cron, export routes), `src/data.js`, `src/nhl.js`, `src/early.js`, `src/pinn.js`, `src/btts.js`, `src/bets.js`,
`src/analyst.js`, `src/health.js`, `src/sweepdata.js`, the export code in `public/index.html` and `public/nhl.html`, and
`tools/export-nhl-history.mjs` / `tools/score-backup.py`.

**ESPN was not reachable from the audit environment** (the network proxy refused `site.api.espn.com`), so the parsers were checked against
the code and the test fixtures only, not against a live answer. The new status handling (`et`, `off`) and goal-minute reading
(`inRegulation`) follow ESPN's documented shape (`status.type.name` such as `STATUS_FINAL_AET`, `STATUS_FINAL_PEN`, `STATUS_POSTPONED`;
goal `clock.displayValue` such as `45'+2'`, `105'`). **Check them on the first extra-time or postponed game after deploy** (the card should
carry `final.et` / `final.ft`, or `void`).

Line numbers below are in the code after this branch's commits.

## 1. Lifecycle map

### Soccer

| Step | KV key (field) | Code | Trigger |
|---|---|---|---|
| Results store | `res:<slug>` | `syncLeague` (data.js:183) | cron slot 0 (least-recently synced league, every 8 h at most); `POST /api/sync` |
| Club context (form, ranks, shots) | `ctx:<slug>`, `std3:<slug>:<season>` (20 h TTL) | `buildContext` (data.js) | after a sync catches up |
| v4 ratings | `rat:<slug>`, `rat:cup` | `refreshRatings` (v4.js) | idle slot 1 / slot 3 turns; `POST /api/ratings` |
| Schedule fetch + card created | `day:<date>` `.cards[]` (id, kickoff, league, clubs), `.analyzed[slug]` | `analyzeLeague` (worker.js:223), `fixturesForLeague` (data.js:358: two UTC-day requests for one Chicago day) | cron slot 2 (today, tomorrow); Analyze button (`POST /api/analyze`) |
| v2 / v4 / v5 / cup v4 | card `.v2 .v4 .v5 .v4why` | `analyzeLeague` | same; v4 / v5 frozen once kicked off |
| Shots numbers | card `.sx` | `analyzeLeague`, `refreshOdds` | same; frozen once kicked off (fix) |
| Score card | card `.v6 .v6o` | `setV6` | analyze and every price read; frozen at kickoff |
| Forebet | card `.fb`; `meta:fb` | `forebetStep` / `forebetFetch` (forebetpage.js), `forebetPaste`, `assignCandidate`; `mergeSeed` | idle slot 1, slot 3 (every other turn first, fix); buttons |
| SportsMole | card `.sm`; `day.smTried`; `sm:list`, `sm:seen`, `meta:unm` | `smLeague` (worker.js:793) | slot 3; button. Unstarted games only (fix) |
| Opening / current price (ESPN, DraftKings or stand-in) | card `.odds` `h d a tl to tu`, `op opt` (ESPN open), `f` (first seen), `fa`, `ts`, `src` | `keepOdds` (worker.js:376), `withOdds`, `refreshOdds` (worker.js:620) | every cron run via `oddsStep` (worker.js:695): each league every 6 h, hourly in the last 3 h; Refresh prices button |
| Lineup read / close | `.odds.cl` (+ `cby`, `cls`) | `refreshOdds` inside 30-20 min; `refreshCardClose` (worker.js:569) | `oddsStep` urgent list (up to `LINEUP_BURST` leagues a run); Get final price button |
| Pinnacle | `.odds.pf pn pcl pat pbt`, card `.pnat`; stand-in `src:'pinnacle'` | `addPinn` (worker.js:526), `pinnStandIn` | inside `refreshOdds` |
| Both score | `.odds.by bn bk bf bfk bcl` | `addBtts` (worker.js:455), `refreshBtts` | inside `refreshOdds`; button |
| Analyst bets | `analyst` (`items`, packed `old`) | `analystLook` (analyst.js) | after each price read and each grading; Analyst tab opens settle |
| Result sync + grading | card `.final {h,a,lead,et,ft}`, `.grade`, `.smGrade`, or `.void` | `gradeLeague` (worker.js:725) | slot 1: leagues of today, -1, -2 whose last open kickoff + 5 h passed, one per 20-min turn; Grade button |
| Pick locked | card `.lean {k,key,p,hit,price,vd,ep,pbk,...}` | `gradeLeague` (`leanPick`) | at grading |
| Early-payout lead | `.final.lead`, `.lean.ep` | `goalSeq` / `maxLead` / `regScore` (early.js) | at grading, from the scoreboard's goal list (one try) |
| Stored history / records | all `day:*` | `tally` (worker.js:840) | Results tab (`/api/tally`), sweep file `soccer.json` |
| Export | days verbatim + totals + `analyst` + `bets` | `exportAll` (public/index.html), `/api/days`, `/api/day`, `/api/tally`, `/api/backup-extra` (fix) | Export data button |

### NHL

| Step | KV key (field) | Code | Trigger |
|---|---|---|---|
| Schedule fetch, card created, v2 / v4 / v5, line | `nhl:day:<date>` cards (`v2 v4 v5 lam ver ln`) | `nhlStep` (nhl.js:470), boards for yesterday, today, tomorrow | spare cron turns (slot 0 spare, slot 2 every other turn: fix); Update NHL buttons |
| Ratings | `nhl:state` | `applyGame` in `nhlStep` | when games finish |
| Goalies, rest | card `.gk .gr .rs` | `nhlStep`, `nhlLineupStep`, `updateStarters` | same, plus every cron run in the 45-20 min window |
| Prices | card `.px` (`h a tl to tu op opt f fa ts rd cl cby cls`) | `setPrice`, `espnClose` (nhl.js:315) | 6-hourly / hourly in `nhlStep`; every 10 min in 45-20 window (`nhlLineupStep`, every run); ESPN close after the final; button |
| Shots + goalie read | card `.sg`; `nhl:shots` | `setSg`, `shotsFrom` | same |
| Forebet | card `.fb`; `nhl:fbmeta` | `forebetRead` | `nhlStep` every 3 h; Update Forebet button |
| Grading + pick | card `.final {h,a,last,total}`, `.grade`, `.lean`, or `.void` (fix) | `gradeCard` (nhl.js:383) | `nhlStep` when ESPN says final |
| Early-payout lead | `.final.lead / ldt`, `.lean.ep` | `fetchSummary` + `leadFromSummary` | `nhlStep`, up to 6 summary reads a run, 3 tries a game |
| Analyst | `analyst` (sport `nhl`) | `analystNhl` | after each hockey day save |
| History / records | all `nhl:day:*` | `nhlTally` (nhl.js:631) | Results tab, sweep `nhl.json` |
| Export | days verbatim + totals + `analyst` (fix) | `/api/nhl/export` (worker.js:1320); `tools/export-nhl-history.mjs` | Export hockey data button |

## 2. Gaps found

Severity: **High** = games lose data or are mis-recorded in normal running; **Medium** = happens on a regular event (a feed error,
extra time, a busy weekend); **Low** = rare or cosmetic.

| # | Sev | Where | How a game got missed or mis-recorded | Status |
|---|---|---|---|---|
| 1 | High | worker.js:1149-1177 (`runSlot` slot 2) | Re-analyzing 15 leagues x 2 days every 6 h needs ~120 runs a day; slot 2 has 72, so it was never idle. The hockey job (`nhlStep`: card creation, grading, 6-hourly / hourly prices) only runs in spare turns and got ~6 a day, in clusters ~8 h apart (simulated). Tomorrow's first analyses also queued behind today's re-analyses. | **Fixed**: first analyses first; re-analysis yields every other turn to hockey; leagues with no games rechecked every 12 h (`NO_GAMES_RECHECK_H`). Hockey now ~35 runs a day. |
| 2 | High | worker.js:350 (`analyzeLeague`) | A Chicago day is two ESPN requests. When one failed, the re-analysis rebuilt the league from the half that answered and dropped every other card (evening games in the Americas) with its opening price, close, Forebet, Pinnacle and Analyst link. A graded card ESPN no longer listed was deleted too. | **Fixed**: unlisted cards are kept on a partial feed or once kicked off; graded cards are never dropped. |
| 3 | High | worker.js:376 (`keepOdds`) | A re-analysis after the 20-min lock took ESPN's current price on a card with no earlier price: an in-play price, saved as the opening `f`, the close, and the Model bets price at grading. | **Fixed**: no ESPN price after the lock. |
| 4 | High | worker.js:754-767 (`gradeLeague`), data.js:134-140 | ESPN's final includes extra-time goals (MLS playoffs now, UCL / UEL knockouts from February): 1X2, O/U, BTTS, the pick and Analyst bets were graded on the wrong score (Agent 3 finding). | **Fixed**: `final.et`, graded on the 90-minute score from the goal list (`regScore`, early.js:42), `final.ft` keeps ESPN's score; void if the 90-minute score cannot be worked out. |
| 5 | Medium | worker.js:754, nhl.js:494 | Postponed / canceled / abandoned games stayed "pending" for good, kept their league due in slot 1 for 2 days, and their bets open until the Analyst's 4-day void (tracked bets never). | **Fixed**: card closed as `void` (status), no prices / bets, Analyst and tracked bets void, excluded from stuck checks. |
| 6 | Medium | worker.js:903 (`tally`) | A game ESPN moved to a later day after its card was made ends with a graded card on both days (the old one via the Nov 12 moved-game lookup), counted twice in every record and Model bets. | **Fixed**: counted once, earlier day (as `score-backup.py` already did). |
| 7 | Medium | worker.js:268 (`analyzeLeague`) | A re-analysis that could not find a club (context rebuilt, version bump) or saw < 3 recent results rebuilt a full card as "skipped", wiping v2 / v4 / odds / Forebet / SportsMole, even after kickoff. | **Fixed**: the existing full card is kept. |
| 8 | Medium | worker.js:793 (`smLeague`), slot 3 | SportsMole was attached after kickoff, changing the agree / disagree count and so Best / Lean / Split before the pick locks (Agent 3 finding). | **Fixed**: unstarted games only (cron and button). |
| 9 | Medium | worker.js:1129-1146 (slot 3) | On busy days SportsMole retries (every league with no preview, every 3 h) filled every slot-3 run and slot 1 was busy grading: Forebet's soccer pages got 0 reads in a simulated weekend day. | **Fixed**: every other slot-3 run offers Forebet the turn first (36 / 36 after). |
| 10 | Medium | worker.js:193-218 (`putDay`) | Lost saves: cron and buttons read-modify-write the whole `day:<date>`; a save from an older read erased a lineup-window close, a grade / pick, Forebet or SportsMole (Agent 3 finding). | **Partly fixed**: every soccer day save re-reads and carries over closes (`cl`, `pcl`, `bcl` with their prices), `final/grade/lean`, `fb/sm/sx`, `void`. KV reads can be ~60 s stale, so cross-location races remain: see proposal P2. |
| 11 | Low | worker.js:319 | Shots numbers (`sx`) were lost when a finished, not yet graded game was re-analyzed: the Shots record skipped it. | **Fixed** (frozen at kickoff like v4). |
| 12 | Low | worker.js:752 | A game ESPN marks completed without a score would be graded on NaN. | **Fixed**: waits. |
| 13 | Low | worker.js:777 | A locked pick priced from a Bet365 / Pinnacle stand-in (or Pinnacle's both-score price) had no book label in the export. | **Fixed**: `lean.pbk`. Counts unchanged. |
| 14 | Low | tools/export-nhl-history.mjs | An ESPN close (`cl` = puck drop, `cls: 'espn'`) was exported as `lineupRead`. | **Fixed**: `closeFrom` = lineup / you / espn / last. |
| 15 | Medium | worker.js:1107-1126 (slot 1) | Grading only looks at today, -1, -2. A league whose grading fails for 2+ days (ESPN outage) is never graded by the cron; the Analyst voids at 4 days. | Proposal P3. |
| 16 | Medium | worker.js:767 | Soccer early-payout lead is read once, at grading, from the scoreboard's goal list; if ESPN's details are missing then, `lead` / `lean.ep` stay empty for good (NHL retries 3 times). | Proposal P3. |
| 17 | Medium | worker.js:620-648 (`refreshOdds`), 725 (`gradeLeague`) | Soccer has no automatic ESPN close for a game that missed its lineup read (NHL has `espnClose`); the last pre-lock price (up to 6 h old) stands as the close unless the button is pressed. | Proposal P1. |
| 18 | Low | worker.js:1172 | After a context version bump, `needsSync` counts up to 3 and slot 2 answers "waiting" until slot 0 happens to sync those leagues (oldest first, not the ones needed): analysis can stall for hours after such a deploy. v4 ratings also only rebuild in idle slot 1 / 3 turns. | Proposal P4. |
| 19 | Low | nhl.js | A rescheduled NHL game ESPN stops listing on its old date (no postponed status left) leaves a never-graded card there. | Proposal P6. |
| 20 | Low | worker.js:778 | Lean is locked only on cards with v2 (v4-only cup cards never get a pick); `lean.price` only for `FIRST_DIV`, so UCL / UEL picks never enter the Model bets P/L although priced. | Design note, P7. |

Checked and fine: one-league-per-request rotation in slot 1 (clock-based index walks the due list; no league starves); `oddsStep`
lineup burst; NHL lineup window every run; UTC / Chicago day boundaries in `fixturesForLeague` (two UTC days cover a Chicago day under
either ESPN date convention); NHL boards by ESPN date with `seen` de-duplication; v4 / v5 / v6 frozen at kickoff; Forebet kept across
re-analysis; write-budget saver mode only skips re-analysis / regular price reads / Forebet / SportsMole / ratings, never closes or grading.

## 3. Export field audit

**Soccer** (Status tab, Export data: client-side, `/api/days` then `/api/day?date=` per day, `/api/tally`, now `/api/backup-extra`).
Day documents are exported verbatim, so every stored card field round-trips: ids and clubs, `v2 v4 v5 v6 v6o v4why`, `odds`
(`h d a tl to tu op opt f fa ts cl cby cls src`, both-score `by bn bk bf bfk bcl`, Pinnacle `pn pf pcl pat pbt`), `sx`, `fb`, `sm`,
`final {h a lead et ft}`, `grade`, `smGrade`, `lean {k key p y a by no src hit price vd ep pbk}`, `void`, plus `analyzed`, `smTried`.
`totals` is the derived Results summary (not needed to restore).

| Check | Result |
|---|---|
| Graded results, picks, prices, closes round-trip | Yes (verbatim). |
| Early-payout flags | `final.lead` and `lean.ep` verbatim; only set when the goal list adds up (gap 16). |
| Analyst paper bets, tracked bets | **Were missing** (separate records `analyst`, `bets`). Now `analyst {items, old, oldFields}` (soccer) and `bets`. |
| Double counting | `totals` counted a moved game twice (gap 6), fixed. Raw `days` can still hold the same game id on two days: dedupe by `league|id` (as `score-backup.py` does). |
| Mislabelling | Stand-in priced picks now carry `lean.pbk`; extra-time games carry `final.et / ft`; void games `void`. |
| `tools/score-backup.py` | Counts stand-in prices as "the market" (`src/market.js` skips `odds.src`), and does not apply `isCounted` / `LEGACY_THROUGH` or skip `void`: its numbers differ from the Results tab. Not changed (Python, no test harness): P5. |

**Hockey** (`/api/nhl/export`, one server request). Days verbatim (`px` with `f op opt cl cby cls rd ts`, `gk gr rs ln sg`, `v2 v4 v5`, `fb`,
`final {h a last total lead ldt sgd sgt}`, `grade`, `lean {.. r ep}`, `void`), `totals` from `nhlTally`, and now `analyst` (hockey bets).
`tools/export-nhl-history.mjs` rows now say where the close came from (`closeFrom`), and `lineupRead` is only a real read.

## 4. Proposals not implemented (ranked)

1. **P1 Soccer ESPN close at grading.** `gradeLeague` already has the finished game's `oddsDone`: for a card with no `odds.cl`, apply it as
   NHL's `espnClose` does (`cl` = kickoff, `cls: 'espn'`) before the pick locks. Zero extra requests. Decide first whether `lean.price`
   should use it (it changes the Model bets price for those games).
2. **P2 Lost saves, properly.** `putDay` narrows the race; it cannot beat KV's ~60 s read staleness across locations. Options: one KV
   record per game for the fields buttons write (closes), or a Durable Object per day (not on the free plan's KV-only setup), or route the
   button writes through the cron (queue in the edge cache). Also: NHL day saves (`nhlCardClose`, `nhlSetLine` vs `nhlStep` /
   `nhlLineupStep`), `forebetpage.js` and the single `analyst` document have the same read-modify-write pattern and no guard.
3. **P3 Grading reach.** Let slot 1 look back to today -3 (matching the Analyst's 4-day void) and retry the soccer early-payout lead
   (store `final.ldt` tries and re-read the scoreboard for graded cards without `lead`, like NHL).
4. **P4 Turns after a deploy and ratings.** When analysis answers `needsSync`, have slot 0 sync those leagues first; rebuild v4 ratings in
   slot 0's spare turns too, or force one when a league's `rat:` is older than 36 h.
5. **P5 Backup tooling and export scale.** Make `score-backup.py` match the Results tab (skip `odds.src`, apply `isCounted` /
   `LEGACY_THROUGH`, skip `void`, use `final.et`). `/api/nhl/export` parses every hockey day twice in one request (days, then `nhlTally`):
   pass the days in. `tally()` / `nhlTally()` list keys without a cursor (1,000-key cap, about 2.7 years of days).
6. **P6 NHL moved games.** Like soccer's moved-game lookup: a hockey card past puck drop + 12 h that its day no longer lists is looked up
   by id on the next 3 boards (or closed as void).
7. **P7 Decide the pick gates.** v4-only cup cards never lock a pick (gate `c.v2`); UCL / UEL picks get no `lean.price` (gate `FIRST_DIV`).
   Both keep cup picks out of Model bets; confirm that is intended.
8. **P8 Cup model data.** `res:<slug>` (v4 ratings, form) stores ESPN's after-extra-time score. Model math was out of scope; worth a look
   before the knockouts.

## 5. For the other agents and the README

* **UI (Agent 2):** a void card has `final: null` and `void: 'postponed' | 'canceled' | 'abandoned' | 'forfeit' | 'aet: no 90-minute score'`;
  it currently shows like a game still waiting. An extra-time card has `final` = the 90-minute score, `final.et` ('aet' / 'pen') and
  `final.ft` (ESPN's score). `lean.pbk` names a non-DraftKings price.
* **README change-log text (ready to paste):** "Data audit (Nov 18, 2026): extra-time games are graded on the 90-minute score
  (`final.et`, `final.ft`); postponed, canceled and abandoned games are closed as void with their bets; a re-analysis no longer drops or
  blanks cards (partial ESPN answer, game past kickoff, club not found) or takes an in-play price; a game saved on two days counts once;
  SportsMole is read only before kickoff; soccer day saves keep closes and results another save added; the analyze slot gives hockey every
  other turn and the SportsMole slot gives Forebet every other turn; the soccer backup adds the Analyst's bets and tracked bets, the hockey
  backup the Analyst's hockey bets."

Tests: `test/integrity.mjs` (in `npm test`), plus a check in `test/nhl.mjs` for the history export. Simulations of the cron turns were
run on the real `runSlot` with an in-memory KV (not committed).
