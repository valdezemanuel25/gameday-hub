# Game Day Hub (soccer), standalone

Runs on Cloudflare's free tier and opens on your phone like the Hub in Claude. No Claude credits are used after deploy.

## What it does

- **Same look as the Hub.** It uses the Hub's own stylesheet and card layout: league tabs, match cards, Best Bets, By Kickoff, Track Results, and the v4 shadow row on every card.
- **Analyze button:** goes through the leagues **one at a time** (progress shows "Analyzing Bundesliga (3/13)…"). Each request handles a single league.
- **Automatic grading:** a cron job runs every 10 minutes and does ONE small job for ONE league, rotating between *sync results*, *grade*, and *analyze*. A league is graded only after its last kickoff of the day + 2 hours (game length) + 3 hours (delay). Leagues are graded one by one, and a league whose games aren't final yet can't block the others.
- **Your history is built in:** 280 graded matches and the retired 58-match v2 vs v3 shadow test.

Change the timing in `wrangler.toml` under `[vars]`: `GAME_HOURS` and `GRADE_DELAY_HOURS`. If you meant "3 hours after the *kickoff*", set `GAME_HOURS = "0"`.

## Deploy (about 10 minutes, one time)

1. Install Node 20+ and make a free account at cloudflare.com.
2. In this folder: `npm install`
3. `npx wrangler login`
4. Storage: the KV namespace `HUB` is already created and its id is in `wrangler.toml`. (On a different Cloudflare account, run `npx wrangler kv namespace create HUB` and paste the new id there.)
5. `npx wrangler secret put ADMIN_TOKEN` and enter any password. The Analyze and Update buttons ask for it once per device, so strangers can't use up your free quota.
6. `npx wrangler deploy`. It prints your permanent link, like `https://gameday-hub.<you>.workers.dev`. On your phone, open it and use Share > Add to Home Screen.

### Through GitHub instead (optional)

Not required. It gives you version history and browser editing. Put the folder in a GitHub repo, then in the Cloudflare dashboard go to Workers & Pages and create a Worker from that repo; every push redeploys. You still add `ADMIN_TOKEN` as a secret (the KV id is already in `wrangler.toml`). (Menu names change now and then.)

## First day

Open the link and tap **Analyze this day** once. The first run loads each league's recent results in small steps (a few extra seconds per league). After that the cron keeps everything fresh and analyzes today and tomorrow by itself.

## Why it's built this way (free plan limits)

The free Workers plan allows 10 ms of CPU per request, 1,000 KV writes a day, and 50 outside calls per request. So nothing here fetches a whole season: results are kept as a small rolling window per league, season totals come from the standings feed, and every request touches one league. Normal use is a few hundred writes a day.

## Tests

- `npm test` runs all of these (plus `test/market.mjs`, model vs market scoring, `test/strats.mjs`, the v4 tracked-bet rules, `test/v5.mjs`, the v5 challenger, and `test/v6.mjs`, the score card):
  - `test/verify.mjs`: the v2 math against your Arsenal–Lille card from Oct 13.
  - `test/parity.mjs`: the v2 model against **120 real cards from the old Hub** (expected goals, win/draw/loss, over/under, BTTS, top two scores). All 120 match.
  - `test/v4.mjs`: v4 club names line up with ESPN's, numbers match the research run, ratings cache and refresh.
  - `test/worker.mjs`: end-to-end with fake data (one league per request, sync, cup fixtures, delayed grading, cron rotation, imported totals).

## Known limits (read before trusting it)

- **ESPN feed untested live.** It follows ESPN's public format but could not be run from the build environment. On first deploy, run Analyze for a day with games. If cards come back empty or skipped, open the browser console: the response lists any URL that failed. The standings feed is the most likely place for a mismatch; if it's missing, season totals fall back to the last ~50 days of results.
- **v4 is the official model (since Oct 26, 2026).** On the tracked games v2 scored worse than always guessing the base rates, and v4 was the best of the three models (see `docs/model-review-2026-10-25.md`). v2 is retired: cards, the headline pick, Top picks, Tracked bets, Results and the bet builder show v4 (with Forebet and SportsMole). v2 is still worked out in the background and only appears, labelled "v2 (no v4)", on a game v4 has no numbers for. Its record is kept under "Retired v2 record" on the Results tab. (Hockey's v2 is a separate model; see docs/hockey-review-2026-10-26.md for the hockey changes.)
- **v2 is verified.** v2 reproduces 120 of 120 old Hub cards exactly and is never changed. Its old Tracked bets rules are kept with a frozen record under "Retired v2 rules".
- **v4 (it replaced v3 on Oct 14, 2026)** rates every club's attack and defence from about 2.5 years of league games (recent games count more, each result is judged against the opposition), turns that into a Poisson score grid with the Dixon-Coles low-score correction (`V4.RHO` in `src/v4core.js`; a small gain, see the comment there), and pulls Over 2.5 / both-score toward the league's recent scoring rate. In earlier-season tests it picked 2 to 4 points more winners than v2 and had lower log loss in Europe, MLS and Liga MX. It uses no betting odds. It covers the 11 league tabs (not cup games, and not a club with fewer than 8 games of history); everything else shows "no v4 prediction".
- **Where v4's history lives.** `src/v4seed.js` holds the game history from your CSV files (through Oct 12-14, 2026) and ratings fitted on it. The Hub adds the games it syncs afterwards, and a spare cron slot rebuilds one league's ratings about once a day (`rat:<league>` in KV, shown on the Status tab). Analyze only reads ratings, so it stays inside the free plan's 10 ms CPU limit. To rebuild the seed from newer CSVs: `node tools/make-v4-seed.mjs "<folder>"` (optional).
- **The old v3 is retired.** Its 58-match record and any games it had already predicted stay under "Retired v3 shadow test" in Results. The v2 vs v4 record starts fresh on Oct 14, 2026.
- **No xG.** ESPN has no expected-goals data, so v4 works from goals only. (Your 2026-27 CSVs for Europe do carry xG columns, but only for this season, which is too little to train on yet.)
- **Promoted clubs** use a rough stand-in for last season (league average, attack x0.85, defence x1.15). Not fitted.
- **Cup games** (Champions League, Nations League) use each club's domestic form. A club outside the supported leagues is skipped with a note on the card.
- **Not carried over from the Hub:** NHL, the Model vs SportsMole tab, scorer picks, and the old per-match result links. Old history rows have no kickoff times or leagues, so they show as a plain list.
- **Mobile looks like the Hub but isn't pixel-tested.** Open it on your phone after deploy and tell me what looks off.

## Score card (v6)

* Every card has a Score card panel: winner, Over/Under 2.5, both-score, the likeliest scores and fair odds, all read off one score grid. With a sportsbook price the grid is fitted to that price, margin removed (`src/v6core.js`, tracked as v6 on the Results tab); without one it shows v4's numbers. See `docs/v6-score-card.md`.

## v5 test (challenger)

* v5 (`src/v5core.js`) is v4's ratings blended with a goal-difference Elo rating, with a small draw adjustment. It shows on league cards as "v5 test", is graded like the other models, and has its own section on the Results tab (against v4, and against Forebet on the games Forebet has). It never changes the headline pick. No cup games.
* Walk-forward on the bundled history it beat v4 by 0.0019 log loss a game (z = 1.9): small. See `docs/v5-model.md`, `node tools/backtest-v5.mjs` and `node tools/fit-v5.mjs`.

## Models against the market

* Prices (DraftKings, from ESPN) are recorded for every game that counts: the first divisions plus the Champions League and Europa League. Still display and scoring only: no model reads a price.
* Each card keeps the first home / draw / away price the Hub saw (`odds.f`) and ESPN's opening line when it sends one (`odds.op`). The price at kickoff is the closing one (refreshed at most every 6 hours, so it can be a few hours old).
* Results tab, "Models against the market" (`src/market.js`): each model against the market's own chances (margin removed) on the same games, by RPS and log loss; the best v4 share in a v4 + market mix (0% means v4 adds nothing the price does not already know); the headline picks' closing-line value; and v4's value bets (v4 5+ points over the price).
* `python3 tools/score-backup.py <backup.json>` scores a backup the same way, plus calibration and the goals markets against the base rate.

## v4 cup shadow test (Champions League + Europa League)

* Europa League is now a tab (slug `uefa.europa`). Analyze it like any other league.
* `src/v4cup.js` is the cup model: each club's domestic v4 rating x a strength factor per league x a small correction from its own cup games (last 3 seasons of both cups). Clubs from leagues the Hub does not keep (Portugal, Turkey, Scotland ...) rest on the league factor and their cup games and need at least 2 of them, otherwise "no prediction".
* A cup game v2 cannot cover (a club not in a synced league) still gets a v4 prediction. It is listed under "games not covered by v2" with the v4 line, graded after the game, and counted in Results under "v4 (shadow), every game it predicted". v2's totals and the v2-vs-v4 head-to-head only use games v2 also predicted.
* History: `src/v4cupseed.js` (810 games through Oct 14, 2026), made by `node tools/make-v4-cupseed.mjs "<folder with the cup CSVs>"`. Results played after the files were exported go in `tools/v4-cup-extra.json`. Newer games come from the stored cup results (`res:uefa.champions`, `res:uefa.europa`), which the background sync now keeps too. Club spellings: `src/v4cupnames.js`.
* Ratings are rebuilt about daily by the spare cron slots (3 warm passes, a few ms) and saved as `rat:cup`. `POST /api/ratings?league=cup` forces a rebuild.
* Over 2.5 / both-score are the raw model numbers (no pull toward the base rate: it tested slightly better raw on cups).
* Test (settings chosen on Nov 2024-Aug 2025 cup games, scored on Sep 2025-Oct 13 2026): on the 127 games v2 can also predict, log-loss 0.918 vs 0.999-1.014 for v2 (about 2.3 standard errors better); on all 380 covered games 0.941 vs 1.016 for always guessing the base rates. Over/both-score gain is small. Unknown club names show in the analyze response's debug list as `v4 cup: unknown club "..."`.
