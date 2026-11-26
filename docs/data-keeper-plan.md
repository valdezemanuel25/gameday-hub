# Data Keeper: build plan

Written Nov 25, 2026 (from the nightly sweep session). Status: **approved design, not built.** A new code session builds it from this file.

## For the session that builds this

- Repo `valdezemanuel25/gameday-hub`. Start from the latest `main` (at least `f711b3f`). Workers Builds deploys every push to `main`, so
  **work on a branch** named `claude/data-keeper` and merge or push to `main` **only when Manny says "push"**, one step (below) at a time.
- Manny approves every code change. Show him what each step changes and the test count before asking to push.
- `npm test` is the full chain (it includes a real-browser page check, `test/pages.mjs`). It must stay at 0 FAIL. On Nov 25 it was
  1,555 PASS.
- Plain-language comments, in the style of the existing code. Add a line to `docs/changelog.md` for each step.
- Never alter the v2 model. Prices never feed any model. Nothing here stakes real money.

## Goal

Every game in the leagues we price has what we track: prices, closing prices, Forebet, hockey goalies and line, a result, and settled
Analyst bets. When something is missing, the Hub **fixes it on its own** (re-runs the read that fills it) and **logs what it did**. Free:
no AI, no new service, no paid plan.

## Manny's decisions (Nov 25, 2026)

1. It fixes and updates on its own, and logs every action.
2. "Too late" for a result = **no result 4 hours after the game**: kickoff + `GAME_HOURS` (2) + 4 h = **kickoff + 6 h**. (Normal grading
   already runs at kickoff + 5 h: `gradeDelayMs`, src/jobs.js, from wrangler.toml `GAME_HOURS` + `GRADE_DELAY_HOURS`.)
3. Scope: **priced leagues only** (`FIRST_DIV` + `CUP_MODEL`, src/data.js) **plus NHL**. Second divisions (`SECOND_PRICED`: esp.2,
   ger.2) are not a priority: checked last, only with calls to spare, never alerted on.
4. Free for now. The nightly sweep (a Claude scheduled task) stays the only AI part; it reads the Keeper's log.

## Where it lives

A new module `src/keeper.js`, run as one more step of the cron in `scheduled()` (src/worker.js), **after** the price reads and the
rotating job, using only what is left of the run's outside-call budget (`env.BUDGET`, src/store.js `budget()` / `ask()`), and before the
alerts' share is spent. It must never throw into the cron (wrap it like the other steps and log errors with `note('keeper', e)`).

## What it checks and how it fixes it

| Check | Missing when | Fix (existing code to call) | Cost |
|---|---|---|---|
| DraftKings price (soccer) | `noSoccerPrice(c)` (src/health.js) and kickoff within 24 h | `refreshOdds(env, date, slug, now)` (src/jobs.js) | ESPN, free |
| Closing price (soccer) | in the lineup window (`LINEUP_READ`..`PRICE_LOCK` min before kickoff) and no `c.odds.cl` | `refreshCardClose(env, date, slug, id, now)` | ESPN + Pinnacle |
| Both-score price | no `c.odds.by` within 24 h | `refreshBtts(env, date, slug, now)`; Pinnacle first; Odds API only through `viaOddsKey`, which already respects `BTTS_RESERVE` | 1 credit/game |
| Forebet (soccer) | no `c.fb` on a game today (Central) | `forebetFetch(env, slug, kind, now)` (src/forebetpage.js), today-only as `forebetStep` does | free, rate-limited |
| Forebet (NHL) | no `c.fb` on today's hockey games | `nhlForebet(env, now)` (src/nhl.js) | free, rate-limited |
| Hockey price / goalie / line | no `c.px`, `c.gk` or `c.ln` at the lineup read | `nhlLineupStep` / `nhlCardClose(env, date, id, now)` (src/nhl.js) | ESPN, free |
| Result | no `c.final` and not `c.void` at kickoff + 6 h (look back 3 days, like runSlot slot 1) | `gradeLeague(date, slug, env, { force: true }, now)` (src/jobs.js); hockey: `nhlStep(env, now, fetch, { mode: 'results' })` | ESPN, free |
| Analyst bet | game graded but bet open, or settled with no close | the Analyst's own settle pass (`analystLook` / `analystNhl`, src/analyst.js) | free |

The "what is missing" list should reuse the same tests as `dayGaps` (src/sweepdata.js) and `gameChecks` / `analystChecks`
(src/health.js), so the Keeper, the health report and the stats files agree on what "missing" means. Factor the shared tests out rather
than copying them.

## Rules (so it cannot do damage)

- **Budget:** at most **one repair per cron run**, and only if `ask(env, cost, keep)` grants it with the alerts' share kept back.
  Priority: lineup-window items first, then overdue results, then everything else; second divisions last.
- **Back-off per game and check:** after a failed try wait 30 min, then 1 h, then 2 h. After **3** failed tries mark it
  **gave up** with the reason. The nightly sweep picks up give-ups.
- **Source blocks:** after a Forebet 403 (or 429), skip **all** Forebet repairs for 2 hours. When no Odds API key is above
  `BTTS_RESERVE`, never spend credits (fill from ESPN and Pinnacle only, as `viaOddsKey` already does). Do not re-read a source the
  rotating job read in the last 5 minutes.
- **KV writes (free plan: 1,000 a day, `WRITE_LIMIT`):** a repair saves a day only if it changed something (the called functions
  already behave this way). The Keeper's own state (log plus back-off clocks) is **one record**, `meta:keeper`, written at most once per
  run and only when the Keeper did something. Add `'meta:keeper': 'keeper'` to `META` in src/store.js so writes are counted. Target:
  20-60 writes on a busy day. In saver mode (`SAVER_AT`) do lineup-window and result repairs only.
- **Back-off clocks** may live in the free edge cache (`caches.default`, no KV write) where losing them only costs an extra try.

## Log

- `meta:keeper` = `{ log: [...last 100], wait: { "<check>|<date>|<id>": { tries, next, why } }, blocks: { forebet: <until> } }`.
- Each log entry: `{ at, sport, date, league, game, check, action, result }`, where `result` is one of `filled`, `still missing`,
  `gave up: <why>` or `skipped: <why>` (budget, block, saver).
- Shown:
  - **Status tab** (public/index.html; public/nhl.html for hockey): a "Keeper" section with the last 10 actions and every give-up.
  - **Health report** (`hubHealth`, src/health.js): a `keeper` field with counts for the last 24 h (filled / still missing / gave up)
    and the give-up list. The nightly sweep reads this.
  - **Phone alert** (src/push.js `sendAll`) only when a result is still missing at kickoff + 6 h, or a priced game has no price 2 hours
    before kickoff. At most one alert per game per problem.

## Build steps (each its own commit, tests, and Manny's "push")

1. **Checker.** `missing(days, now, opts)` in src/keeper.js: one list of what is missing, in priority order, built from the shared
   tests. `test/keeper.mjs` with made-up days covering every row of the table, void and postponed games, a game crossing midnight
   Central, second divisions sorted last, and nothing listed for leagues outside scope.
2. **Fixer.** `keeperStep(env, now)`: picks the first item not waiting, asks the budget, runs the repair, records the outcome, applies
   back-off and blocks. Tests: each gap gets the right repair; budget 0 means nothing fetched; 3 failures mean gave up; a Forebet 403
   blocks Forebet for 2 h; no write when nothing was done; saver mode limits it to lineup and results.
3. **Log, Status, health, alerts.** The `meta:keeper` record, the Status sections, the health field, the two alerts. Page test in
   test/pages.mjs for the Status section. Update public/sweep.js if the in-page Sweep report should show give-ups.
4. **Live trial (no code).** For 2 nights the sweep compares what was missing with what the Keeper fixed and reports write counts.
   Tune the back-off or priority only after that.

## Known limits

- The Keeper only shortens gaps the sources allow. If Forebet keeps blocking the Hub (12 403s on Nov 25) or the Odds API stays at 0
  credits, it logs `gave up` with the reason instead of filling them.
- The cron is limited to 50 outside calls a run (budget 45) and very little CPU per run on the free plan. Keep `keeperStep` small: read
  days already loaded where possible (src/store.js `coalesce`), no full-history reads.
