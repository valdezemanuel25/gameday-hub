# Changelog

The dated history that used to sit in code comments, moved here so the comments say what the code does now. Each entry is the
original comment block, word for word, as it stood on 2026-11-24, under the file it was in and the code it described (the first code line
after it). The code keeps a shorter comment that says what it does now.

Left in the code on purpose: the dated notes that are the evidence for a rule (the Analyst's rules and their backtests in src/analyst.js,
the hockey and soccer Trends situations in src/trends.js and src/trendssoccer.js, the shots weights in src/shots.js and src/nhlshots.js,
the headline pick rules in src/pick.js), the cut-off dates the code reads (SINCE, COUNT_FROM, LEGACY_THROUGH, OLD_COOKIE_UNTIL), and the
notes in the pages under public/.

## src/data.js

- At `export const SECOND_PRICED = new Set(['esp.2', 'ger.2']);`:

  ```
  // Leagues whose prices are recorded: the first divisions plus the two cups with a v4 model, i.e. every game that counts in the records,
  // so the model can be scored against the market (src/market.js). Second divisions stay out of the model records (UNTRACKED), but from
  // Nov 2, 2026 La Liga 2 and 2. Bundesliga are priced too (SECOND_PRICED): ESPN's DraftKings price only (no Odds API league in
  // src/btts.js SPORT, so no credits), for the board, Movement and the Analyst, whose record splits them out as second divisions.
  ```

- At `const isDk = x => /draft\s*kings/i.test(x?.provider?.name || '');`:

  ```
  // ESPN spells the book both ways ("DraftKings", "Draft Kings"): a plain /draftkings/ missed the second, so with a stand-in listed first the
  // stand-in was taken although DraftKings was there (Nov 18, 2026 audit).
  ```

- At `const ymdIso = d => d.toISOString().slice(0, 10);`:

  ```
  // One-time fill of shots for stored games saved before shots were recorded (Nov 3, 2026): a stored game with only 8 elements has never
  // been checked. Each call looks at the 12 days starting from the oldest unchecked game, writes the shots found (or null, meaning ESPN
  // had none, so the game is not asked again), and rebuilds the league's context so the shots reach the cards. Call it until remaining is
  // 0 (POST /api/sync?league=<slug>&backfill=1). 13 requests to ESPN a call, one store write and one context write.
  ```

## src/fixes.js

- At `import { setOf } from './analyst.js';`:

  ```
  // Saves from the buttons kept apart from the background job's saves (Nov 18, 2026, round 2 of the data audit).
  //
  // The problem: a day's cards live in ONE KV record (day:<date>, nhl:day:<date>), and so do the Analyst's paper bets (analyst). The
  // background job (cron) and the buttons each read the whole record, change it and write it all back. KV can serve a read up to about
  // 60 seconds old in another location, so a button pressed near a cron save could write back a copy from before that save and erase it
  // (a lineup-window close, a grade and its locked pick, Forebet or SportsMole numbers, a paper bet), and a cron save could erase a button's.
  //
  // The fix: only the cron writes those records. A button (any request to the Worker) never writes them; what it changed is saved as a
  // small patch in a side record next to them, 'fix:' + the record's key (fix:day:<date>, fix:nhl:day:<date>, fix:analyst):
  //   * per card, only the top-level fields the button changed (set / del), or the whole card when the button made it;
  //   * day-level fields (analyzed, analyzedAt, smTried) as the keys that changed;
  //   * for the Analyst, only the bets the button placed or settled.
  // Every read of a day (or of the Analyst's record) lays the patches on top: applyFix / applyAnalystFix. The patch never takes away what
  // the stored record has and the button's copy lacked (a close, a result, Forebet, SportsMole, shots: keepSaved's rules), so a button that
  // read a stale copy cannot erase the cron's work either. The cron reads through the same merge, so its next save of that record carries
  // the patches in (folds them back) and notes the newest patch it carried (fxAt). Patches at or before fxAt are skipped on read and pruned
  // by the next button save. foldStep saves a record whose patches no cron job has carried in yet, one record per idle grading turn.
  // Patches expire after FIX_TTL (10 days), long after they are folded.
  //
  // All of this sits in the storage layer: withFixes(env) wraps env.HUB so every existing read (Results, Trends, exports, the Analyst, the
  // bet builder, alerts, health) gets the merged record without changing its code, and a button's write becomes a patch. The Worker's
  // fetch handler wraps with { button: true }, the scheduled handler without. getDay / listDays do the same merge for code (or a test)
  // holding a plain env. Old records need no change: a record with no side record reads exactly as before.
  ```

- At `const add = PIN_NOTES.filter(k => s[k] == null && e.b[k] != null);`:

  ```
  // The Pinnacle notes settle() adds once the game starts (before any close): carried over when the record lacks them, so the next
  // page load finds nothing new and saves nothing (Nov 19, 2026: each load during a game used to save the same patch again).
  ```

## src/forebetpage.js

- At `const playsToday = (work, now) => work.some(w => w.date === localDate(now.toISOString()));`:

  ```
  // The cron reads Forebet only for a league with a game still to come TODAY (Central) (Nov 20, 2026: reading leagues whose games were
  // tomorrow or later brought Forebet's "too many requests" blocks on the leagues playing today). A read for a playing league still
  // fills its later games from the same page, at no extra request.
  ```

- At `const playsSoon = (work, now) => { const t = localDate(now.toISOString()), tm = new Date(new Date('$`:

  ```
  // A button tap (you asked for it) may also read a league playing TOMORROW (Nov 21, 2026); games two days out are still left alone.
  ```

## src/health.js

- At `export const noSoccerPrice = c => !c.odds || ![c.odds.h, c.odds.d, c.odds.a].every(Number.isFinite);`:

  ```
  // A soccer card is priced only with a home / draw / away price from ESPN: a price record holding just Pinnacle's or the both-score
  // price does not count (Nov 1, 2026: Frankfurt v Hamburg had no ESPN price, which a bare !c.odds check missed).
  ```

- At `if (b.sport !== 'nhl' && tierOf(b) === 'top' && now - ko > 30 * 60000 && now - ko <= 3 * 86400000 &&`:

  ```
  // Nov 6, 2026: the bench check reads Pinnacle's fair close first and falls back to DraftKings' close quietly. A top-division soccer bet
  // from the last 3 days with a DraftKings close but no Pinnacle one is listed, so a run of fallbacks (Pinnacle out, rate limited,
  // no lineup read) shows up here instead of hiding in the bench numbers. Bets that can never have one are left out (src/analyst.js settle
  // pinNo): an Over/Under 2.5 bet in a game Pinnacle lines at another total, a both-score bet in a game Pinnacle never priced for it.
  ```

## src/jobs.js

- At `export async function putDay(env, date, day) {`:

  ```
  // Saving a soccer day without losing what another save put there (Nov 18, 2026 audit). The cron and the buttons each read the whole day,
  // change it and write it back, so a save made from an older read could erase what a save in between added: a lineup-window close, a
  // graded result and its locked pick, Forebet or SportsMole. Just before writing, the stored day is read again and anything of that kind
  // it has and this copy lacks is carried over (keepSaved, src/fixes.js). It costs one read per save, no write.
  // Round 2 (Nov 18, 2026): a button no longer writes the day at all. Its changes go to a side record (fix:day:<date>) that every read lays
  // on top and the cron's next save carries in (src/fixes.js), so a button can neither erase a cron save nor be erased by one. A button's
  // save is compared with the day as that request read it, so it is written as it is here (no second read).
  ```

- At `export const SHARP_GAP_H = 3, SHARP_PER_DAY = 3;`:

  ```
  // The Analyst's stale-price rule: DraftKings against a sharp book for the open games of ONE league (2 credits a look). Looks at a
  // league at most every SHARP_GAP_H hours and at most SHARP_PER_DAY times a day in all (Worker variables, defaults below; both kept
  // in the free edge cache), and never once the month's credits are at BTTS_RESERVE or below. The last look is noted for the Analyst tab.
  // SHARP_PER_DAY was 15 until Nov 20, 2026: up to 30 credits a day (about 900 a month, near both keys' 1,000) for a rule with 0 bets
  // so far; 3 looks (6 credits a day) leaves the month's credits for the both-score reads.
  ```

- At `export const PN_RETRY_OPEN_H = 3, PN_RETRY_CLOSE_MIN = 10;`:

  ```
  // Pinnacle (src/pinn.js), only with the Worker secret PINNODDS_KEY: the first price seen (odds.pf) and the close at the lineup read
  // (odds.pcl), on the same schedule as the ESPN price. One request prices every league (the trimmed list is shared for 10 minutes), a game
  // it cannot match is tried again after PN_RETRY_OPEN_H hours (PN_RETRY_CLOSE_MIN minutes in the closing window). Returns cards changed.
  // Both score (Nov 5, 2026): Pinnacle often posts its both-score price hours after the match price, so a game with no both-score price
  // yet from any book (no odds.bf) is read again every PN_RETRY_OPEN_H hours (odds.pbt = the last such try) until Pinnacle has one. Free:
  // the reads share the one fixture list, and no Odds API credit is used.
  ```

- At `const due = cards.filter(c => { if (!c.odds) return ago(c.pnat) >= PN_RETRY_OPEN_H * 3600000; if (!(`:

  ```
  // A game with no price at all (ESPN has none) is looked up too (Nov 6, 2026): Pinnacle may have it, and then it is the card's stand-in
  // price (pinnStandIn). A miss on such a card is stamped on the card (c.pnat), not in a price object, so it still counts as unpriced.
  ```

- At `if (o.bf || (o.pn && o.pn.bty != null)) delete o.pbt; else if (e || o.pf) o.pbt = now.toISOString();`:

  ```
  // no both-score price yet: try again in PN_RETRY_OPEN_H hours. Stamped on a miss too (Nov 6, 2026: a game Pinnacle priced and then stopped
  // listing was due again on every run, re-saving the day and asking PinnOdds every 10 minutes); a game never matched (no pf) waits on pat.
  ```

- At `export function pinnStandIn(c, now = new Date()) {`:

  ```
  // Pinnacle as the stand-in price (Nov 6, 2026): a game ESPN has no home / draw / away price for (no book, or a book without the three)
  // takes Pinnacle's home / draw / away and 2.5 total, marked src 'pinnacle' like the Bet365 stand-in. The board, the score card (v6) and
  // Movement show it; the Analyst, Scout's home / draw / away / total bets and the Shots read sit it out (they close against DraftKings).
  // DraftKings arriving from ESPN replaces it (withOdds); a Bet365 stand-in already on the card is left alone. -> true when the card changed
  ```

- At `if (!SPORT[slug]) {`:

  ```
  // A league with no Odds API league (La Liga 2, 2. Bundesliga): Pinnacle's both-score price instead, no credit (Nov 2, 2026). It needs
  // the game's ESPN price first (the Pinnacle read rides on it); games without one are listed as skipped.
  ```

- At `const moved = open.filter(c => !finals.has(c.id) && !off.has(c.id) && now.getTime() > new Date(c.kic`:

  ```
  // Moved games (Nov 12, 2026): ESPN files a game moved to a later day (Las Palmas v Eldense, Nov 8 -> Nov 9) under its new date, so this
  // day's scoreboard no longer lists it and its card (and any Analyst bet on it) was never graded. A card past kickoff that this day does not
  // list as finished is looked up by its ESPN id on the next 3 days' scoreboards. Only read while such a card is waiting, so no extra
  // requests on a normal day, and nothing is saved unless a game is graded.
  ```

- At `const ld = maxLead(seq); if (ld) c.final.lead = ld; else c.final.ldt = 1;`:

  ```
  // The biggest lead each side had at any moment (bet365 early payout); left off when ESPN's goal list does not add up.
  // Not known now (ESPN's goal list missing or not adding up): this was try 1 of LEAD_TRIES; leadStep tries again later (Nov 18, 2026).
  ```

- At `if (c.v2 && !c.lean) { const l = leanPick(c); if (l) { l.hit = leanHit(l.key, c.final); const m = FI`:

  ```
  // The card's headline pick is locked here, from what the card held when it finished, and scored on the final score.
  // pbk: the book of the saved price when it is not DraftKings (a Bet365 / Pinnacle stand-in, Pinnacle's both-score price), so a backup can tell them apart.
  // DraftKings only in Model bets (Nov 18, 2026, round 2): such a price is kept as spx (shown, never counted) and price / vd, which the
  // profit record counts, are set only for a DraftKings price. Picks locked before then keep the price they were saved with.
  // vd: the same price tag the Results tab works out from the card (priceVerdict, src/pick.js: v4 against DraftKings' break-even), so a backup matches the page.
  ```

- At `if (espnCloseSoccer(c, f.oddsDone, now)) closed++;`:

  ```
  // ESPN's close for a card that missed its lineup read (Nov 18, 2026, round 2): after the pick locked above, so its price stays the one
  // shown when it locked. For the Movement tab and closing-line value only.
  ```

- At `export const LEAD_TRIES = 3;`:

  ```
  // The early-payout lead again (Nov 18, 2026, round 2): a graded card whose lead could not be read at grading (ESPN's goal list missing or
  // not adding up) is tried again, like hockey: up to LEAD_TRIES tries in all (final.ldt counts them; grading was the first), one league
  // and day per idle grading turn, each at least an hour after the last (edge cache, no write), from today back to today -3. Two ESPN
  // requests and at most one write a try. days: the days the grading turn just read ({ date: day }).
  ```

- At `const todo = (day?.cards || []).filter(c => c.league === slug && c.v2 && !c.sm && !c.final && new Da`:

  ```
  // Only games that have not started (Nov 18, 2026): a "We say" read after kickoff changed the agree / disagree count, and so the Best /
  // Lean / Split kind, of a pick that locks at grading. Forebet already waits for nothing after kickoff.
  ```

- At `const SHB = [['Under 40%', 0, 40], ['40 to 45%', 40, 45], ['45 to 50%', 45, 50], ['50 to 55%', 50, 5`:

  ```
  // Shots read against the results (Nov 3, 2026): every finished card with shots numbers and a DraftKings Over/Under 2.5 price, scored at
  // the card's last (closing) price. Groups: top leagues and second divisions with their own weights, MLS / Liga MX tracking only (read
  // with the top-league weights). Second divisions count here although they are left out of the model records.
  ```

- At `const due = [], days = {};`:

  ```
  // Grading reach (Nov 18, 2026, round 2): back to today -3, so a league ESPN kept from grading for two days is still graded before the
  // Analyst voids its open bets at 4 days.
  ```

- At `const fbFirst = Math.floor(now.getTime() / 1200000) % 2 === 0;`:

  ```
  // Forebet's turn (Nov 18, 2026): SportsMole retries every league whose games have no preview yet every 3 hours, which on a busy
  // weekend fills every run of this slot, and Forebet's pages (a vote on the headline pick) were only read when it had nothing to do.
  // Every other run now offers Forebet the turn first; with no page due, SportsMole runs as before.
  ```

- At `const ordered = [...DOMESTIC.filter(l => !l.support), ...LEAGUES.filter(l => l.cup)];`:

  ```
  // slot 2: analyze. Domestic leagues first, cups last (cups need domestic data).
  // Turns (Nov 18, 2026): re-analyzing 15 leagues x 2 days every 6 hours needs about 120 runs a day and this slot has 72, so it never had
  // a spare run and the hockey job (nhlStep: new games, grading, the 6-hourly / hourly prices) only got slot 0's few, about 6 a day.
  // Now: a league not yet analyzed for the day always goes first; a re-analysis gives every other turn to hockey; and a league with no
  // games that day is looked at again after NO_GAMES_RECHECK_H hours instead of 6 (it used to cost a run and a write every 6 hours).
  ```

## src/market.js

- At `export const BOARD_MIN = 50;`:

  ```
  // ---- the model scoreboard (Nov 5, 2026): every model against the closing price, per market ----
  // Each model is scored only on games where it and the closing price both exist, by log loss (lower is better), paired game by game,
  // so the difference has a standard error: verdict 'beats' / 'worse' when the whole 95% range (2 standard errors) is on one side,
  // 'level' otherwise, 'early' under BOARD_MIN games. A model that never beats the price adds nothing a bettor does not already have.
  ```

- At `export const BOARD_MODELS = { '1x2': ['v2', 'v4', 'v5', 'fb'], ou: ['v2', 'v4', 'v5', 'fb', 'shots']`:

  ```
  // The score card (v6) is fitted to the same home / draw / away and Over/Under 2.5 price it would be scored against, so on those two it
  // can only ever come out level: it is left out there (Nov 6, 2026). Its both-score chance never sees the both-score price, so it stays in.
  ```

## src/names.js

- At `const flat = n => String(n || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ue/gi, '`:

  ```
  // German umlauts written out ("Nuernberg", "Osnabrueck") and reserve sides as "II" or "B" ("Real Sociedad II" / "Real Sociedad B"):
  // both names are rewritten the same way and tried again (Nov 2, 2026: 2. Bundesliga and La Liga 2 names on Pinnacle).
  ```

## src/nhl.js

- At `export const REST_MIN = 40;`:

  ```
  // Rest against the price (Nov 5, 2026): v5 already carries the measured back-to-back effect; the open question is whether DraftKings'
  // moneyline already has it. On every graded game where exactly one side was on the second night of a back-to-back (v5's flags), the
  // closing moneyline (margin removed) is scored by log loss as it is, and again with the back-to-back shift (B2B_LOGIT) added. If the
  // shifted price scores better over enough games, the price is missing rest and a rule could use it; if not, the price already has it.
  ```

- At `export async function nhlStep(env, now = new Date(), fetchFn = fetch, { force = false, mode = 'all' `:

  ```
  // ---- cron / on-demand step ---------------------------------------------------------------------
  // mode (Nov 9, 2026): 'all' (the cron, as before), 'analyze' (new games, prices and price moves, goalies / lineups, Forebet; no grading) or 'results'
  // (grade finished games, closing prices, leads, shots, and with them the model bets; no price, lineup or Forebet reads). The two buttons on the NHL page.
  ```

- At `if (e.off) { const c0 = day.cards.find(x => x.id === e.id); if (c0 && !c0.final && c0.void !== e.off`:

  ```
  // Postponed or canceled (Nov 18, 2026): its card is closed as void (no grade; the Analyst's and tracked bets on it are void) instead
  // of waiting for a result for good. Not marked as seen: if ESPN also lists the game on its new day, that day gets its own card.
  ```

- At `if (e.done && !(Number.isFinite(e.hs) && Number.isFinite(e.as))) { out.noScore = (out.noScore || 0) `:

  ```
  // Final but no score (Nov 19, 2026): left pending for the next run. Grading it scored the pick a loss and wrote blank goals and
  // Elo into both teams' ratings for good.
  ```

- At `export async function nhlForebet(env, now = new Date(), fetchFn = fetch) {`:

  ```
  // Forebet only (Nov 12, 2026): the Status tab's "Update Forebet" button. One read of Forebet's NHL page for the games of today and tomorrow
  // that have not started and have no Forebet numbers yet, whenever the last read was (the 3 / 6 hour wait is for the cron, not for a tap).
  // Nothing else runs: no new games, prices, goalies or grading. With nothing missing it does not fetch.
  // { missing (before), saved, rows, left: [games still without numbers], error | note }.
  ```

## src/pick.js

- At `export function priceVerdict(c, L) {`:

  ```
  // The price tag of a locked pick (Value / Fair / Not worth it), worked out from the saved card (Nov 18, 2026): v4's chance for the pick
  // against the break-even chance of the DraftKings price the pick was graded at (verdictOf: 5+ points over = 'val', 5+ under = 'no').
  // v4 uses no prices, so the tag asks whether v4 disagreeing with DraftKings pays. Until now the tag used the pick's own chance, which
  // since Oct 27 is v6's, read off that same price with the margin removed: always about the margin below break-even, so nearly every pick
  // was 'fair'. Pinnacle's fair price was not used: on 6,531 past top picks (football-data closing prices) it sat within 5 points of
  // Bet365's break-even 97% of the time, the same 'fair' for everything. null (no tag): no saved price; a price that is not DraftKings'
  // (a Bet365 / Pinnacle stand-in, odds.src, or a both-score price from another book, odds.bk; lean.pbk says so); no v4 number for that
  // market, or a promoted club's starting rating (kept out of v4's records too).
  ```

## src/push.js

- At `const B64U = /^[A-Za-z0-9_-]+={0,2}$/;`:

  ```
  // A browser's subscription, checked before it is kept (Nov 18, 2026): the Worker later POSTs to the endpoint from every alert run, so it
  // must be a plain https address (no user:password, no bare IP) of a sensible length, and the two keys must be base64url of the sizes Web
  // Push uses (a 65-byte P-256 key, a 16-byte secret). Anything else used to be stored as sent.
  ```

## src/routes.js

- At `const COOKIE = '__Host-hub_s', OLD_COOKIE = 'hub_s';`:

  ```
  // The password is ADMIN_TOKEN. It is accepted from the sign-in page (which sets a session cookie), from the x-admin-token header,
  // and from HTTP Basic (any username) so scripts keep working. With no ADMIN_TOKEN set, nothing is let in.
  // Sessions you can end (Nov 18, 2026, audit #17 / P5). The cookie (__Host-hub_s) is "v2.<issued at, seconds>.<HMAC>", signed with a
  // key made from the password over the issue time and SESSION_EPOCH, so nothing is stored and no KV write is ever made for it:
  //   * it is refused once it is older than SESSION_MAX_DAYS (default 180), or dated more than 5 minutes ahead;
  //   * a device in use stays in: a page opened with a session older than 30 days (or half SESSION_MAX_DAYS, if that is shorter) gets a
  //     fresh cookie on that answer;
  //   * changing SESSION_EPOCH (a var or secret, default "0") signs every device out without changing the password; changing the
  //     password does too.
  // Changeover: the old cookie (hub_s, one HMAC of a fixed phrase, the same on every device) is still taken until OLD_COOKIE_UNTIL and
  // only while SESSION_EPOCH is unset or "0". A device that shows it gets the new cookie and the old one cleared.
  ```

- At `const SEC_HEADERS = {`:

  ```
  // Sent on every answer: stay on https, no guessing file types, no other site may frame the Hub or receive its forms.
  // Nov 18, 2026: also no camera / microphone / location / payment for any page, no window shared with another site's tab, and no search
  // engine listing of the sign-in page (a private site).
  ```

- At `export function crossSite(req, url) {`:

  ```
  // Cross-site guard (Nov 18, 2026). The sign-in cookie is SameSite=Lax, which keeps it off another site's form posts but not off
  // (a) a sibling subdomain (same-site, e.g. another *.workers.dev Worker if that suffix were ever treated as one site) or (b) another
  // site's plain links, which would let any page open data routes, some of which spend a paid daily quota (/api/pinn-check: 1 of 100
  // Pinnacle requests) or sign the device out (/logout). The Hub's own pages are same-origin; scripts send neither header. -> true to refuse.
  ```

## src/summaries.js

- At `import { isDayKey, readWithMeta, listFixMeta, withFixMeta } from './fixes.js';`:

  ```
  // Full-history summaries, kept instead of rebuilt (Nov 18, 2026, audit P6). The Results tab (tally, nhlTally), both Trends tabs
  // (buildSoccerTrends, buildTrends), the hockey backup and the nightly sweep each read and parse EVERY saved day: about 30 ms of CPU at 35
  // days and 70 to 110 ms at 120, against the free plan's 10 ms. Those functions are unchanged; their answer is now kept in this isolate's
  // memory and in the free edge cache (caches.default, no KV writes) under a stamp of what it was built from, and given back while that
  // stamp holds.
  //
  // The stamp. Every save of a day (`day:<date>`, `nhl:day:<date>`) goes through the write counter in src/worker.js (counted()), which
  // now gives the key a write id as KV metadata ({ w }, no extra write: it rides on the save). KV's list() returns each key's metadata
  // for free, so one list call says which days were saved since the last look. A changed day is read; if it still has an open game it
  // is reduced to its "settled view": every finished, graded or void card in full, which is all tally() and nhlTally() read, and for the
  // Trends reads also the identity of the open games (id, league, clubs, kickoff: streaks and rest days count them). That is all the
  // summaries read from days other than the one a Trends read is for (dayPart). The stamp is a hash of those, plus the write id of the
  // Trends date's day (its open games' prices feed the read), the summary's kind and date, SUM_VERSION and the deployed version's id
  // (env.CF_VERSION_METADATA, so a deploy that changes the code starts afresh). So a price read or a re-analysis of an unfinished game
  // does not throw the summary away; a grade, a void, a close or an early-payout lead on a finished card does.
  // The write id -> settled-view hash table (the "memo") is kept in memory and in the edge cache, so an unchanged day is never read again.
  //
  // Why not a version number bumped at grading in the edge cache: the edge cache is per data centre, and the cron grades wherever
  // Cloudflare runs it, so the visitor's data centre would never see the bump. The KV metadata is global, and needs no edit in gradeLeague.
  // A day saved before this change has no write id: it is taken as unchanged until its next save, which adds one (every save in the
  // Worker goes through counted()). As a backstop each kept answer expires after MAX_AGE anyway.
  // Nothing is cached when caches is undefined (Node tests): the summary is built as before. A failed build is never kept.
  // Days are read with the buttons' side patches laid on (src/fixes.js); their write ids are part of each day's id (see STAMPED).
  ```

- At `const DAY_PREFIXES = new Set(['day:', 'nhl:day:']);`:

  ```
  // fix:day: / fix:nhl:day: (Nov 18, 2026, Agent 1 round 2): a button's save is a side patch next to the day (src/fixes.js), laid on at every
  // read. Its write id is joined to the day's in the listing and on each read (joinMeta), so a patch rebuilds a summary as a day save does.
  ```

## src/sweepdata.js

- At `export const SWEEP_LAST = 'sweep:last';`:

  ```
  // The last answer per file (Nov 19, 2026): three nights of missing files could not be explained because the answer was thrown away.
  // Kept in one small KV record (SWEEP_LAST) and shown by the health report (sweepStatus). Written only when the answer for that file
  // changed or the kept one is over LAST_REFRESH_H hours old, so at most about 3 writes a night. Never throws.
  ```

## src/verify.js

- At `const t = s => s.split('-').filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');`:

  ```
  // Empty pieces are skipped (Nov 21, 2026): a slug with a double or trailing hyphen ("sheff-utd--vs-...") threw here, which stopped the
  // whole league's SportsMole read before it saved, so even the previews it had found were lost.
  ```

## src/keeper.js

- Nov 26, 2026: Data Keeper step 1 of 4 (docs/data-keeper-plan.md), the checker. `missing(days, now, { bets })` lists what each game in
  the priced leagues (first divisions, the two cups with a model) and the NHL lacks, most urgent first: lineup-window reads, then results
  with none at kickoff + 6 h (back to today - 3), then prices, both-score prices, Forebet and Analyst bets; La Liga 2 and 2. Bundesliga
  last. Reads only what it is handed; nothing calls it yet. The per-card "missing" tests moved to src/gaps.js and are now shared by
  src/health.js gameChecks, src/sweepdata.js dayGaps and the Keeper (same answers as before). Tests: test/keeper.mjs.
- Nov 26, 2026: Data Keeper step 2 of 4, the fixer. `keeperStep(env, now)` runs in the cron (src/worker.js) after the rotating job and
  before the alerts: at most one repair a run, re-running the existing read for the most urgent item not waiting, only if the run's call
  budget grants it with the alerts' share (ALERTS_KEEP) kept back. Back-off per game and check: 30 min, then 1 h; the third failed try
  gives up with the reason. A Forebet 403 / 429 stops Forebet repairs for 2 h. With no Odds API key above BTTS_RESERVE the reads run
  without the keys (ESPN and Pinnacle only). Saver mode: lineup-window and result repairs only. A source this run already read (or
  Forebet's page read in the last 5 min) is left alone. Its state is one record, meta:keeper (counted as 'keeper'), written once a run
  and only when it did something or noted a new skip. Both-score gaps are listed only once a game has its ESPN price (the price read
  brings the both-score price, Pinnacle first, with no credit). A settled bet with no close is given up at once: the settle pass never
  goes back to a settled bet.
- Nov 26, 2026: Data Keeper step 3 of 4, what it did, shown. The record's reading side moved to src/keeperlog.js (so the health report
  and the status routes read it without loading the reads). Status tabs: a "Data Keeper" section on public/index.html (soccer) and
  public/nhl.html (hockey) with the last 10 actions and every give-up (/api/status and /api/nhl/status carry `keeper`). Health report:
  a `keeper` field with counts for the last 24 h (filled / still missing / gave up / skipped), the give-up list and any Forebet pause;
  the in-page Sweep report names the give-ups. Phone alert (src/push.js sendAll), one message per run for all that are due, at most once
  per game and problem: a result still missing from kickoff + 6 h (up to 24 h after kickoff; older is the nightly sweep's), or a game
  with no price 2 hours before kickoff (soccer top divisions and cups, and hockey). Second divisions never alert. Give-ups now keep the
  game, league and check.
- Nov 26, 2026: Data Keeper fixes from a read-only audit of steps 1-3. One read fills a whole league (or the whole hockey day), so the
  back-off clock and the tries are kept per repair ("<fix>|<date>|<league>[|w]"), not per game: 6 games of one league missing Forebet
  cost 3 page reads, not 18. The lineup-window read has its own key, so a price given up on hours out is still tried at the closing
  read. A give-up (or any back-off clock) is dropped once its gap is filled by another job. Forebet: a 403 / 429 that Forebet's own job
  got blocks the Keeper too, and a page read fine is left alone 3 h (as Forebet's own job does). Closes and both-score prices are
  repaired by the league's price read (the close is no longer marked as taken by hand; the both-score price asks Pinnacle first, then the
  Odds API only above the credit reserve). A hockey game missing only its line, a hockey result older than yesterday and a settled bet
  with no close are listed but not repaired (no read can fill them), and cost no run or save. Call estimates match what the reads fetch
  (results 6, hockey results 9). Saver-mode waits are not saved. The health report's 24-hour counts come from hourly counts and include
  repairs run and the KV writes the Keeper caused. The alerts step reuses the days the Keeper read. The hockey lineup read answers
  whenever it read ESPN, so the Keeper does not read it again in the same run.
- Nov 26, 2026: Data Keeper trial tasks (no code). Night 1 moved to Sun Nov 29 01:13 Central and night 2 to Thu Dec 3 01:13 Central, after
  the Hub saves its stats files (00:10-00:40 Central), so each reads the day it checks. All three Keeper tasks take their baseline from the
  stats repo's history (no Notion needed) and read the audit fix's fields (`last24h.repairs` and `writes`, give-ups per repair). The
  nightly sweep's Data check now lists the Keeper's 24-hour counts and give-ups and flags Keeper writes above 60.
