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
- **Pinnacle prices from PinnOdds (`src/pinn.js`).** With the Worker secret `PINNODDS_KEY` (sent as the `x-portal-apikey` header; the trial plan is 100 requests a day), each priced soccer game also keeps Pinnacle's home / draw / away and the 2.5 total: the first price the Hub saw (`odds.pf`), the latest (`odds.pn`) and the lineup-window read (`odds.pcl`, the close). One request (`/kit/v1/prematch/fixtures?sport_id=1`, every soccer fixture) prices every league; the trimmed list is shared for 10 minutes in the free edge cache, and a game with no match is tried again after 3 hours (10 minutes in the closing window). Women's, youth and reserve sides are left out and games are matched by both team names and kickoff. The Movement tab adds a Pinnacle line (first seen to now, margin removed) and says where DraftKings sits from it. `/api/pinn-check?league=bra.1` makes one request and shows the size of the answer, the league names Pinnacle uses and how each game of the league matched. Both teams to score comes in the same answer as its own "special" row (joined to the match by `parent_id`, or by team names and kickoff); it is read only when its Yes / No can be told apart, and kept as `bty` / `btn` next to the other Pinnacle prices. The check page lists how often each special name occurs and shows a few raw both-score rows with what the Hub parsed from them. **Both-score order (from Oct 30, 2026):** Pinnacle first (no credits: it rides the same one request), then The Odds API, then API-Football, then the score card's estimate. A game whose opening came from another book is not given a Pinnacle close, so a game's opening and close stay with one book; Pinnacle's own first-seen to now move is always on the Pinnacle line. A rate limit pauses reads until it lifts. Pinnacle's own first price is not available, so "first seen" is when the Hub first read it.
- **bet365 early payout (from Oct 30, 2026, `src/early.js`).** A home or away win bet counts as won once that team leads by 2 goals at any moment (NHL: 3 goals, shootout not counted), whatever the final score. At grading the Hub saves the biggest lead each side had (`final.lead`): soccer from ESPN's match details on the scoreboard, hockey from ESPN's game summary (one read per finished game, up to 6 a run). Goals that do not add up to the final score are not trusted, and the game is left out. Model bets (soccer and NHL) show the normal record next to a "bet365 early payout" line, and recent picks paid this way say "Paid early ✓". Tracked bets mark such legs "✓ early" and the bet "Paid early"; the normal hit / miss record never changes.
- **The market leads the headline pick (since Oct 27, 2026).** Once a soccer game has a sportsbook price, the card leads with the v6 score card's strongest call (home / draw / away, Over/Under 2.5 or both-score, from the price with the margin removed). v4, Forebet and SportsMole are shown only as "agrees" / "disagrees" tags and never change the pick: the price beat every model by about 0.02 log loss a game and the best v4 + market mix was 0% v4. The kind is about agreement: Best pick = every model agrees and the market gives it 60%+; Lean = most agree; Split = most disagree (the market pick stands). Before a game is priced, v4's strongest call leads as before. Picks locked before Oct 27 keep their old rule, so the Model bets record mixes the two. Hockey is unchanged.
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

## Opening and closing prices

* **When prices are read:** every 6 hours as a rule, every hour in the last 3 hours before a league's next kickoff, and once 30–20 minutes before kickoff, after the official lineups are out (`LINEUP_READ`, `PRICE_LOCK` in `src/worker.js`). From 20 minutes before kickoff a card's price is locked, so the lineup read is the closing price.
* **What each card keeps:** the opening price (ESPN's opening line for home / draw / away and the total, `odds.op` / `odds.opt`, else the first price the Hub saw, `odds.f`) next to the current or closing one.
* **On the card:** the score card shows the move (e.g. `Arsenal 46→58 (+12)`). A move of 5+ points on one result gets a "Big price move" flag, saying whether v4 already leaned that way. The Board lists the day's big moves. It is a prompt to check the team news, not a bet (`src/moves.js`).
* **Movement tab** (it replaced the Compare tab on Oct 26, 2026): every priced game of the selected day with its opening odds, current or closing odds, the chance (margin removed) and the move for home / draw / away and the total. Each game shows its closing-price status:
  * **Closing ✓ (time):** the lineup read was taken (`odds.cl`).
  * **Lineup read due now:** inside the last 30 minutes, not yet read.
  * **Pending (time):** shows when the closing read is due.
  * **No lineup read:** the price locked without a read in the window, so the last price stands as the close.
  * Filters: big moves, pending, closed. Finished games say whether the result went the way of the move.
  * **Both score row:** DraftKings' both-score Yes price, first seen → now or the close, with the chance (margin removed) and the move. Without a book price it falls back to the score card's chance at the opening price (`v6o`) against now or the close.
* **Both-score prices (Oct 26, 2026):** ESPN has none, so they come from The Odds API (`src/btts.js`), only once the Worker secret `ODDS_API_KEY` is set (`npx wrangler secret put ODDS_API_KEY`).
  * Read with the ESPN price: once when a game is first priced (the opening, `odds.bf`) and once at the lineup read 30–20 minutes before kickoff (the close, noted in `odds.bcl`). DraftKings first, else the first US book with the market.
  * Cost: the events list is free; each game's read is one credit, so about two credits a game. The free plan (500 a month) covers roughly 250 games; the first divisions and the two cups play more than that in a month, so a paid plan is needed for full coverage.
  * When fewer than 100 credits are left (`BTTS_RESERVE`, can be set as a Worker variable), opening reads pause so the closing reads keep going. The Status tab shows whether the key is set and the credits left.
  * The "Get Both-score prices" button still reads on demand.
  * **Second source: API-Football (`src/apifootball.js`).** With the Worker secret `APIFOOTBALL_KEY` (free plan: 100 requests a day), games The Odds API did not price (no credits left, no key, no team match) get their both-score price from API-Football instead, on the same schedule (opening once, the close at the lineup read). It uses the book already on the card, else bet365, else the first; prices are decimal and converted. One league on one day costs about 2-3 requests; a game with no price is tried again after 3 hours (15 minutes in the closing window). Opening reads stop below 15 requests left. If the opening and the close came from different books the Movement tab says so. `/api/apifootball-check?league=bra.1&date=YYYY-MM-DD` shows the bet types, the requests left and what the Hub reads, for checking the market is on the free plan.
* **On the Results tab** ("Models against the market"):
  * how often results went the way of the move (56–57% on past seasons)
  * the same split by whether v4 agreed
  * how often both-score went the way of its move (moves of 1+ points)
  * your own picks ("Your pick" on a card) against the closing price

### Hockey prices (Oct 26, 2026)

* **What is captured:** each NHL card keeps DraftKings' moneyline and total with its Over / Under prices from ESPN (`c.px`). That includes the opening line (`px.op` / `px.opt`, else the first price seen, `px.f`) and the current or closing one.
* **Read schedule:** a price counts every 6 hours and every hour in the last 3 hours. From 45 to 20 minutes before puck drop (after the morning skate and starting goalies) it is read every 10 minutes, and the last of those reads is the close (`px.cl`). From 20 minutes before it is locked. (Until Oct 27, 2026 it was one read 30–20 minutes before, which could be missed.)
  * Each background run does the closing reads first (hockey, then soccer prices), before the rotating job, so a run cut short by the free plan's CPU limit no longer drops them.
  * A finished game that still has no lineup read takes the closing line from ESPN's odds for the finished game instead (`espnClose`, marked `px.cls = 'espn'`; the Movement tab says "ESPN close"). Checked for yesterday's, today's and tomorrow's games.
  * The lineup read is checked on every 5-minute cron run (`nhlLineupStep` in `src/nhl.js`), not only in the NHL job's spare slots, which could miss the 10-minute window. It only reads ESPN when a game is in the window without its read.
* **Storage writes:** a card is only written when its price changed (`setPrice` in `src/nhl.js`).
* **On the hockey card:** a moneyline line and an Over/Under line (opening → now / close, with the chance and the move), plus a "Big price move" flag at 5+ points.
* **Update NHL now (hockey):** re-reads every game that has not started, off the schedule: the price (inside the last 45 minutes, up to puck drop, it becomes the closing read, marked "your update", `px.cby`) and ESPN's starting goalies (Confirmed / Expected), with their rest worked out again.
* **Goalie rest on the hockey Movement tab:** under the closing-read badge, a tag when a starting goalie is on a back-to-back (he started yesterday) or has 3+ days since his last start (`c.gr`, from `gkRest` in `src/nhl.js`). It is read from the starters saved on the cards of the three days before (ESPN's expected or confirmed starter), every starter's tag shows his rest (back-to-back, 1 day, 2 days, 3+ days). When the saved cards cannot tell (days before starters were saved on Oct 28, 2026, or a card with no goalie named), the goalie's own ESPN game log is read instead (`gamelogRest`, at most 8 reads a run); "rest unknown" when neither can tell.
* **Hockey Movement tab:** every priced game with its closing-price status, the same as soccer.
* **Hockey Results:** how often the winner and the total went the way of the move.

## Analyst (paper bettor, Oct 27, 2026)

* **What it is:** an automated tester that places its own bets with no real money (`src/analyst.js`, **Analyst** tab). Every time a soccer price is read (the same reads as the Movement tab: every 6 hours, hourly in the last 3, and the lineup read), it looks at the move since the opening price and at v4. When one of its rules fires, it bets 1 unit at that read's price and saves a one-line reason.
* **Rules:**
  * **Follow the move:** a result gained 3+ points and v4 already rated it above the opening price.
  * **v4 value:** v4 rates a home or away win 5+ points above the price now, and the price hasn't drifted against it.
  * **Fade the drift:** a result lost 4+ points but v4 still rates it at or above the price now.
  * **Goals move:** Over 2.5 moved 3+ points and v4 is on the same side.
  * It takes one position per game per market and never bets both sides. Promoted-club stand-in ratings are skipped.
* **Stale price rule (Oct 27, 2026), the main test:** DraftKings against a sharp book at the same moment (Pinnacle, else the Betfair or Matchbook exchange; `fetchSharp` in `src/btts.js`).
  * **When it bets:** DraftKings pays 2%+ more than the sharp book's fair chance (margin removed) on a result or Over/Under 2.5, at +400 or shorter. It bets DraftKings. No model is read, so it can bet games v4 doesn't cover. It is first in the rule order.
  * **Cost:** one Odds API call per look at a league (2 credits). It looks at a league at most every 3 hours and 15 times a day in all (about 30 credits a day on busy days), and stops at the credit reserve. Change these with the Worker variables `SHARP_GAP_H` and `SHARP_PER_DAY`.
  * **Which sharp book you get:** depends on the Odds API plan. The Analyst tab shows which book came back on the last look, and its "Check which sharp books my plan has" button makes one call (2 credits) to find out now. With no sharp book in the plan, this rule never bets.
  * **Backtest stand-in** (Bet365 against Pinnacle at the same moment, 8,389 games): +9% on 447 opening-price bets at 0%+, −5% at 2%+, negative at the close. DraftKings may lag more than Bet365; the live closing-line value decides.
* **Price shopping (Oct 27, 2026):** when a rule fires, the bet takes the best home / draw / away or Over / Under 2.5 price among the US-regulated books (DraftKings, FanDuel, BetMGM, Caesars, BetRivers, ESPN BET, Fanatics, Bally Bet, Hard Rock) if one beats DraftKings (`fetchBest` in `src/btts.js`).
  * **Which price the rules read:** always DraftKings. A better price only changes what the bet pays.
  * **Cost:** one Odds API call for the whole league (2 credits), and only when a rule has fired. It uses the `ODDS_API_KEY` secret and stops when credits reach the reserve (`BTTS_RESERVE`), so the both-score closing reads keep theirs. Without the key it bets at DraftKings.
  * **Currently off:** `BOOKS = "draftkings"` in `wrangler.toml` `[vars]` (Oct 27, 2026), so every bet is at DraftKings and no credit is spent. To shop, list the books you have accounts with, e.g. `BOOKS = "draftkings,fanduel"`, or remove the line for all of them.
  * **On the tab:** how often a better price was found and the average extra payout, the units had every bet gone on at DraftKings, and the rules' closing-line value at DraftKings alone (their skill without the shopping gain).
* **Hockey (Oct 28, 2026):** the Analyst also bets the NHL cards, with its own record (Soccer / Hockey switch on the Analyst tab).
  * **When it looks:** whenever a hockey price is read (the NHL job and the 45–20 minute closing reads). It bets DraftKings' moneyline or total at that read, with at most one moneyline and one total bet per game.
  * **Rules** (on v2, hockey's official model):
    * **Follow the move:** a team's chance rose 3+ points and v2 rated it above the opening price.
    * **Fade the drift:** a team's chance fell 4+ points but v2 still rates it at or above the price now.
    * **Goals move:** the Over moved 3+ points and v2, rated at the same line, is on the same side.
  * **Settling:** overtime and shootout count for the winner, the shootout goal doesn't count toward the total, and a total exactly on a whole-number line is a push.
  * **No backtest:** there is no hockey price history. Betting splits and sharp prices from oddsterminal.org (NHL only) are the planned next test.
* **Scoring:** units won and ROI at the price taken, plus closing-line value against the lineup-read price. The closing-line number is known at kickoff and settles in tens of bets; profit needs hundreds. Bets are split by when they were placed (3+ hours before kickoff vs the last 3 hours). A rule that is behind on both after 40 settled bets is benched (`BENCH`).
* **Backtest** (`node tools/backtest-analyst.mjs`: walk-forward v4 against Bet365 opening and closing prices, 1,929 league games): at the closing price every rule lost money (−5% to −10%; backing every closing favourite lost −3.9%). So the live question is whether betting at earlier reads, before a move finishes, beats the close. Until the tab shows a positive closing-line value over a few hundred bets, treat the rules as unproven.
* **Storage and cost:** one KV document (`analyst`), written only when a bet is placed or settles. Settling happens when a league is graded and when the tab is opened.

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
