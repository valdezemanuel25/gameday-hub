# Game Day Hub (soccer), standalone

Runs on Cloudflare's free tier and opens on your phone like the Hub in Claude. No Claude credits are used after deploy.

## What it does

- **Same look as the Hub.** It uses the Hub's own stylesheet and card layout: league tabs, match cards, Best Bets, By Kickoff, Track Results, and the v3 shadow row on every card.
- **Analyze button:** goes through the leagues **one at a time** (progress shows "Analyzing Bundesliga (3/13)…"). Each request handles a single league.
- **Automatic grading:** a cron job runs every 10 minutes and does ONE small job for ONE league, rotating between *sync results*, *grade*, and *analyze*. A league is graded only after its last kickoff of the day + 2 hours (game length) + 3 hours (delay). Leagues are graded one by one, and a league whose games aren't final yet can't block the others.
- **Your history is built in:** 280 graded matches and the 58-match v2 vs v3 shadow test.

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

- `npm test` runs all three:
  - `test/verify.mjs`: the v2 math against your Arsenal–Lille card from Oct 13.
  - `test/parity.mjs`: the v2 model against **120 real cards from the old Hub** (expected goals, win/draw/loss, over/under, BTTS, top two scores). All 120 match.
  - `test/worker.mjs`: end-to-end with fake data (one league per request, sync, cup fixtures, delayed grading, cron rotation, imported totals).

## Known limits (read before trusting it)

- **ESPN feed untested live.** It follows ESPN's public format but could not be run from the build environment. On first deploy, run Analyze for a day with games. If cards come back empty or skipped, open the browser console: the response lists any URL that failed. The standings feed is the most likely place for a mismatch; if it's missing, season totals fall back to the last ~50 days of results.
- **v2 is verified, v3 is not.** v2 reproduces 120 of 120 old Hub cards exactly. The Hub's cards print each club's last-5 results but not the season-long numbers v3 needs, so v3 can only be built from your written method (below) and can't be matched to old cards.
- **v3 is built from your written method** (65% season / 35% form, last season as 8 games, 20% shrink to 44/27/29, draw-risk flag, league-strength tiers). Your Hub cards don't show the season inputs, so v3 numbers can't be matched to old cards. v2 can, and does.
- **No xG yet.** ESPN has no expected-goals data, so the live script runs plain v3. The 70% xG / 30% goals blend is in the model (`v3(..., {xg: true})`), but it needs an xG source added.
- **Promoted clubs** use a rough stand-in for last season (league average, attack x0.85, defence x1.15). Not fitted.
- **Cup games** (Champions League, Nations League) use each club's domestic form. A club outside the supported leagues is skipped with a note on the card.
- **Not carried over from the Hub:** NHL, the Model vs SportsMole tab, scorer picks, and the old per-match result links. Old history rows have no kickoff times or leagues, so they show as a plain list.
- **Mobile looks like the Hub but isn't pixel-tested.** Open it on your phone after deploy and tell me what looks off.
