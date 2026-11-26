# Data Keeper: handoff

Written Nov 26, 2026 (Central) at the end of the build session. Read `docs/data-keeper-plan.md` first: it is the approved design this
work follows. This file says where the build stands and what is left, so a new session can finish it.

## Rules (unchanged from the plan)

- Manny approves every code change. Work on a branch, show him what changed and the test count, and push to `main` **only when he says
  "push"**. Workers Builds deploys every push to `main`.
- `npm test` is the full chain (it includes the real-browser page check `test/pages.mjs`) and must stay at 0 FAIL.
- Plain-language comments in the style of the code; a line in `docs/changelog.md` for each change.
- Never alter the v2 model. Prices never feed a model. Nothing stakes real money.

## Where it stands

| Commit | What | On `main`? |
|---|---|---|
| `437f9c7` | Step 1, the checker: `missing()` in `src/keeper.js`; shared per-card tests moved to `src/gaps.js` (used by `src/health.js` `gameChecks` and `src/sweepdata.js` `dayGaps`) | yes |
| `318cacb` | Step 2, the fixer: `keeperStep()` in `src/keeper.js`, run in `scheduled()` (`src/worker.js`) after the rotating job and before the alerts; `'meta:keeper': 'keeper'` in `META` (`src/store.js`) | yes |
| `5601844` | Step 3: `src/keeperlog.js` (record reading, Status and health summaries); "Data Keeper" sections on the Status tabs (`public/index.html` `keeperBox`, `public/nhl.html`); `keeper` in `/api/status`, `/api/nhl/status` and the health report (`hubHealth`); give-ups line in `public/sweep.js`; phone alerts (`keeperAlerts`, `alertMessage`) | yes |
| `4b88273` | Fixes from a read-only audit of steps 1-3 (below) | yes (pushed Nov 26 with this file, `733a3cd`) |

Branch with all of it: `claude/sleepy-sagan-2mw8ny` (the build session could not use the plan's `claude/data-keeper` name). At
`4b88273`, `npm test` was **1,706 PASS, 0 FAIL**.

Step 4 (the live trial) is scheduled, see "Scheduled tasks".

## What `4b88273` changed (audit findings 1-11)

1. Back-off and tries are kept **per repair**, not per game: the wait key is `"<fix>|<date>|<league>[|w]"` (Forebet adds the table;
   hockey uses `nhl`). One read fills a whole league, so 6 games missing Forebet cost 3 reads, not 18. A read that fills part of its
   games waits 30 min without counting a try. `BACKOFF_MIN = [30, 60]`, `GIVE_UP = 3`.
2. `|w` = the lineup-window read has its own key, so a price given up on hours out is still tried at the closing read. Back-off entries
   (give-ups included) whose repair is no longer needed are dropped at the start of every run; dropping a give-up triggers one save.
3. Call estimates (`costOf`): price read `oddsCost` (costed without the Odds API when the keys are left out), results 6, hockey results 9,
   hockey lineup 3, Forebet 1, Analyst settle 0. Only `nhlLineupStep` is held to its grant; the others are estimated high.
4. Closes and both-score prices are repaired by the league's price read (`refreshOdds`, wrapped so games missing the both-score price
   have Pinnacle's retry wait `odds.pbt` cleared first). `refreshCardClose`, `refreshBtts` and `nhlCardClose` are no longer used (they
   marked the close `cby: 'you'`, and `refreshBtts` skipped Pinnacle in Odds API leagues).
5. A hockey result older than yesterday is listed with `fix: null` (`nhlStep` reads yesterday to tomorrow only).
6. A hockey game missing only its line is listed with `fix: null` (only `nhlStep`'s full read sets `c.ln`, and it also reads Forebet).
   `nhlLineupStep` (`src/nhl.js`) now answers `{ job: 'nhl-lineup', read: [] }` whenever it read ESPN, so `recentFrom` sees it.
7. `meta:keeper` keeps `hours: { "<UTC hour>": { f, m, g, s, r, w } }` (26 hours). `keeperHealth().last24h` is now `{ filled,
   stillMissing, gaveUp, skipped, repairs, writes }` from those counts; `writes` = KV writes the Keeper caused (its repairs' saves,
   counted by wrapping the repair's `HUB.put`, plus its own record).
8. Partly: hockey days loaded cut to yesterday..tomorrow; `pushStep` (`src/push.js`) takes the days the Keeper read (`keeperStep`
   returns them as a non-enumerable `days`). The price and grading jobs still read their own copies (a shared per-run cache is a bigger change).
9. Items with `fix: null` (a settled bet with no close, the two hockey cases above) are skipped silently: no run used, no save.
10. See 4.
11. Saver-mode waits are not logged or saved.

Forebet: a 403 / 429 recorded by Forebet's own job (`meta:fb` per league and table, `nhl:fbmeta`) now blocks Keeper Forebet repairs for
`BLOCK_H` (2 h) from that read; a page read fine is left alone `FB_OK_H` (3 h).

## What is left

1. ~~Push `4b88273` to `main`~~: done Nov 26. Everything above is live.
2. **Fix the trial tasks (audit #13)**, ideally before Sat Nov 28. Both are one-time scheduled tasks; change them with `update_trigger`
   (read them first with `get_trigger`):
   - Move night 1 (`trig_01QdmXfA5omwoGuhTdgAegmT`, now Sat Nov 28 23:13 Central) to **Sun Nov 29 01:13 Central** and night 2
     (`trig_01DLDy7sKn2Dx8zGrp3Z4PHp`, now Wed Dec 2 23:13 Central) to **Thu Dec 3 01:13 Central**. The Hub saves its stats files to
     `gameday-hub-data` between about 00:10 and 00:40 Central, so a run at 23:13 reads the day before.
   - Night 1 clones with `--depth 1` and takes its write baseline "from the Notion log", but the tasks have **no Notion connector**
     (the tool could not attach one). Make it clone the full history and read the baseline from `git show <sha>:health.json` for
     Nov 19-25, as night 2 already does.
   - Update both prompts for `4b88273`: name that commit; `keeper.last24h` now has `repairs` and `writes` (writes caused by the Keeper:
     compare THAT with the 20-60 target, not the "bookkeeping: keeper" bucket alone); the 100-entry undercount caveat no longer applies;
     give-ups are per repair (`game` reads "X and N more", `games` = count).
   - Same prompt updates for the one-day check `trig_01J2h69D2tFfBWifUFvwwq23` (Fri Nov 27 01:13 Central, checks Thursday Nov 26) if it
     has not fired yet.
3. **Nightly sweep (audit #12), only with Manny's OK:** the "Game Day Hub nightly sweep" task (`trig_0186JDUet3WDCYod2aH2Eyar`, Wed
   and Sat 22:30 Central) does not read `health.keeper`. The plan says the sweep picks up the give-ups. Add one line to its step 7
   (Data check): list `health.keeper.gaveUp` (game, check, why) and `last24h`, and flag `last24h.writes` above 60. Its prompt is long
   and tuned: change only that, and show Manny the exact diff first.
4. **After the trial (step 4 of the plan):** night 2 sends up to 3 tuning suggestions naming constants in `src/keeper.js`
   (`BACKOFF_MIN`, `GIVE_UP`, `BLOCK_H`, `FB_OK_H`, `ALERTS_KEEP`, `TIER`, `costOf`, `RESULT_H`, `ALERT_PRICE_MIN`, `LOG_MAX`). Build
   only the ones Manny picks, the same way: branch, tests, his "push".

## Decisions Manny has seen (do not undo without asking)

- A settled Analyst bet with no closing price has no repair (`src/analyst.js` `settle()` never revisits a settled bet); it stays listed
  for the health report (`analyst.noClose`).
- Both-score gaps are listed only once a game has its ESPN home / draw / away price, and only until the price locks.
- The Analyst settle repair hands `analystLook` / `analystNhl` only the day's closed games, so it never places a new bet.
- Phone alerts: a result still missing from kickoff + 6 h up to kickoff + 24 h (older is the nightly sweep's), or no price 2 h before
  kickoff (soccer top divisions and cups, and hockey); second divisions never; one combined message per run; once per game and problem.
- "Tomorrow" for the one-day check was Thursday Nov 26 (Manny confirmed).

## Scheduled tasks

| Task | ID | When (Central) | Notes |
|---|---|---|---|
| Data Keeper check: Thursday Nov 26 slate | `trig_01J2h69D2tFfBWifUFvwwq23` | Fri Nov 27 01:13 | one-time; push notification; ~21 games expected |
| Data Keeper trial, night 1 of 2 | `trig_01QdmXfA5omwoGuhTdgAegmT` | Sat Nov 28 23:13 (move, see above) | one-time |
| Data Keeper trial, night 2 of 2 | `trig_01DLDy7sKn2Dx8zGrp3Z4PHp` | Wed Dec 2 23:13 (move, see above) | one-time; tuning suggestions |
| Game Day Hub nightly sweep | `trig_0186JDUet3WDCYod2aH2Eyar` | Wed, Sat 22:30 | read-only; not edited |

All three Keeper tasks are read-only (no code, KV, or task changes) and report by push notification and their session summary.

## Environment notes from the build session

- The session's shell could not reach ESPN or the live site; the checks run on stand-in data and the fired tasks read the stats repo.
- A force-push was refused by the safety check; bring the branch level with `main` by merging, not rewriting.
- `main` once carried the plan commit under a different hash than the branch; check ancestry before each push.
- The trial tasks were created without connectors (no Notion), and the tool cannot add them; Manny can add Notion in the claude.ai
  scheduled tasks page if he wants the notes on the sweep log (page "Game Day Hub sweep log").

## Where to look

- `src/keeper.js`: `missing()` (checker), `keeperStep()` (fixer), `REPAIRS`, `costOf`, `recentFrom`, `keeperAlerts`.
- `src/keeperlog.js`: the `meta:keeper` record, `keeperStatus` (Status tabs), `keeperHealth` (health report).
- `src/gaps.js`: what "missing" means for one card (shared with the health report and the stats files).
- Tests: `test/keeper.mjs` (most of it), `test/budget.mjs` (a busy cron run with the Keeper), `test/pages.mjs` (Status sections),
  `test/auth.mjs` (Sweep panel line).
