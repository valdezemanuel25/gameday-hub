# Code logic, security and performance audit (Agent 3, Nov 18, 2026)

Scope: `src/worker.js` (router, auth, cron), `src/push.js`, `src/sweepdata.js`, `src/health.js`, the pick path (`src/pick.js`, `src/v6core.js`,
`src/market.js`, `src/analyst.js`), the scrapers, `public/` (read-only, for HTML injection), `wrangler.toml`.

Branch: `worktree-agent-adee365dbc3dc2837`. Nothing pushed or deployed. No secret values were read or printed.

## What changed in this branch

| Commit | What |
|---|---|
| `ff5fb82` | Health token tries are rate limited; secrets compared as SHA-256 digests; cross-site guard; `?date=` checked; push subscriptions checked; three new safety headers; `test/security.mjs`; 5 passing tests that were never run are now in `npm test` |
| `ef2dc51` | `parseOdds` / `oddsWhy` find DraftKings under the spelling "Draft Kings" too (`src/data.js`, Agent 1's file: a 3-line change in its own commit, so it can be dropped or redone there) |
| `01a0edc` | The bet analyzer's 12-pick limit is checked before any KV read |

`npm test`: exit 0, no FAIL lines (39 test files, verify.mjs runs twice; including the new `test/security.mjs` and `test/oddsprovider.mjs`).

## Findings

Severity is for this site as deployed: one owner, one password, free plan. "Fixed" = in this branch with a test.

| # | Sev | Where | Issue | Exploit or failure | Status |
|---|---|---|---|---|---|
| 1 | Medium | `src/worker.js:1161` (was 1137) | The `HEALTH_TOKEN` check on `GET /api/health?k=` ran before any rate limit. | Anyone could guess the health token with no limit. It reads only the health report (team names, record, budgets), but it is still a bypass of the limits the password has. | **Fixed**: counted under `API_LIMIT` with its own `health:` key; test `security.mjs` |
| 2 | Medium | `src/data.js:104`, `:365` | DraftKings is found with `/draftkings/i`, which misses "Draft Kings". The Hub's own fixtures use both spellings (`test/moves.mjs:380`, `:398`). | When ESPN lists another book first, that book is taken. A Bet365 decimal price gets marked as a stand-in, so the Analyst sits out a game that had a DraftKings price. An American price from another book is worse: it is saved with no `src`, so v6, the headline pick and the Analyst treat it as DraftKings. Not checked against live ESPN (the session cannot reach ESPN). | **Fixed** (`isDk`, `/draft\s*kings/i`); test `oddsprovider.mjs` |
| 3 | Medium | `src/worker.js:1143`, `crossSite()` at `:194` | No CSRF or cross-site check beyond `SameSite=Lax`. Lax still sends the cookie on top-level GET links from other sites. It also sends it from same-site subdomains. | Another site's link can open `/api/pinn-check`, which spends 1 of the 100 Pinnacle requests a day, and other quota-spending GETs. It can also sign the device out through `/logout` (a GET), or post the sign-in form. | **Fixed**: requests the browser marks `cross-site` or `same-site` are refused when they go to `/api/*` or `/logout` or change data. Any change whose `Origin` is not the Hub's (`null` included) is refused. Pages, the Hub's own fetches and scripts work as before. Tests in `security.mjs` |
| 4 | Low | `src/worker.js:138` (old `same`) | The token comparison returned at once on a length mismatch, which leaks the password's length. | It works only in theory over the network, but the audit asked for constant time. | **Fixed**: SHA-256 digests compared byte by byte (`same()` at `:140`) |
| 5 | Low | `src/worker.js:1176` | `?date=` went straight into KV keys (`day:${date}`) and ESPN's address (`?dates=`). | A signed-in request could create junk `day:` keys. `/api/trends` and `tally` then list and parse them all, and every Results load gets slower. It could also add query parameters to the ESPN call. | **Fixed**: `/api/*` refuses a non-empty `date` that is not `YYYY-MM-DD` (400) |
| 6 | Low | `src/push.js:58` | Push subscriptions only had to start with `https://`. The keys could be any size. | The cron POSTs to every stored endpoint each alert run. A bad entry meant a request to any host (bare IPs included) and unbounded strings in the `push` key. Signed in only. | **Fixed**: `validSub()` needs https, no credentials, no IP literal, a length cap and Web Push key sizes. A host allow-list is a proposal (P10) |
| 7 | Low | `src/worker.js:1236` | `/api/bets` and `/api/bets/analyze` read one KV day per distinct leg date before `analyze()` refused more than 12 legs. | One request with 500 legs meant hundreds of KV reads and a lot of CPU. Signed in only. | **Fixed**: 12-leg check moved before the reads |
| 8 | Low | `SEC_HEADERS` `src/worker.js:179` | No `Permissions-Policy`, no COOP, and the sign-in page could be indexed. | Defense in depth only. | **Fixed**: added `permissions-policy`, `cross-origin-opener-policy: same-origin`, `x-robots-tag: noindex` |
| 9 | Medium | `src/worker.js:726` (gradeLeague) | A finished game is graded on ESPN's final score. In a game that went to extra time or penalties, that score includes extra-time goals. | 1X2, Over/Under and both-score bets settle on 90 minutes. MLS Cup playoff games (`usa.1`, November) and Liga MX Liguilla finals can go to extra time, and from February the UCL/UEL knockouts do too. A 1-1 game won 2-1 in extra time is graded as a Home win and Over 2.5, which inflates or deflates the headline record, the model grades and Analyst bets. | Proposed (P2). Agent 1's area |
| 10 | Medium | `src/worker.js:231-1037` (every `day:${date}` put) | Every writer does a read-modify-write of the whole `day:<date>` doc: the cron (odds, grade, analyze, SportsMole) and the buttons (Refresh prices, Final price, Forebet paste, Assign). KV reads can be up to 60 s stale in another location. | A button pressed within about a minute of a cron save can write back a stale day. That erases the cron's change, for example the lineup-window close (`cl`). After `PRICE_LOCK` (20 min before kickoff) nothing retries it, so the card keeps an earlier price as its close, v6 (and so the headline pick) stays on that older price, and CLV is measured against the wrong close. The `analyst` key has the same race (lost or duplicated paper bets). | Proposed (P1) |
| 11 | Medium | `src/worker.js:756`, `:1089` (smLeague and its cron check) | SportsMole "We say" is attached to cards with no kickoff check. Forebet checks kickoff (`forebetpage.js:122`). | The headline pick is locked at grading from what the card holds then. A SportsMole read added after kickoff changes the agree count, and so the kind (`best`/`lean`/`split`) recorded in "Model bets". The recorded kind can then differ from what the page showed before kickoff, so the Best-pick record is not the record of picks you actually saw. | Proposed (P3). Agent 1's area |
| 12 | Low-Med | `src/worker.js:738` | When the headline pick is locked, `priceFor(c.odds, key)` takes whatever price the card holds, including a stand-in (`c.odds.src` = `pinnacle` or `bet365`). A both-score price can be Pinnacle's (`odds.bk`). | The headline profit (`LB.pl`, Model bets P/L) mixes books. Pinnacle prices are higher, so P/L on those games is overstated against what DraftKings would have paid. The Analyst already sits stand-ins out. | Proposed (P4) |
| 13 | Low | `src/pick.js:105` `verdictOf` used at `worker.js:738` | Since Oct 27 the headline's `p` is v6's de-margined chance from the same price it is compared with. `p - needP(m)` is therefore always about minus the margin share. | The `byVerdict` and `byCombo` P/L breakdown is nearly all "fair" (plus "no" on long prices, where the power method takes more margin). It does not measure value. | Proposed (P8): compare v4 or Pinnacle's fair price against the DraftKings price instead |
| 14 | Low | `src/data.js:112` `parseAm` | Each outcome falls back from `close` to `open` on its own. | If ESPN drops one outcome's close, the saved price mixes the close for two outcomes with the open for the third. De-margining then gives a slightly wrong market (v6 and the headline). | Proposed (P9) |
| 15 | Low | `src/nhl.js:283` `parseHockeyOdds` | Takes the first odds entry whatever the book. There is no DraftKings preference. | The hockey price vote and the Best gate (55%) can come from another book. The UI says DraftKings. | Proposed (P9) |
| 16 | Low | `src/sportsmole.js:42` | `parseListing` accepts an absolute link on any host if the path looks like a preview. | A link on SportsMole's page to another host is fetched by `fetchText`. Low, since SportsMole controls the page. | Proposed: require `www.sportsmole.co.uk` |
| 17 | Low | `src/worker.js:133`, `:1152` | The session cookie is one fixed HMAC of a constant phrase. It is the same for every device, lasts a year and has no server-side expiry. | A copied cookie works until the password changes. One device cannot be signed out on its own. There is no `__Host-` prefix. | **Fixed** (follow-up below): revocable `__Host-` sessions; tests `auth.mjs` |
| 18 | Low | `src/worker.js:1161` | The health token also comes in the query string (`?k=`). | Query strings end up in logs, analytics and history. | Proposed: header only (the sweep can send `x-health-token`) |
| 19 | Low | `public/*.html` `esc()` | `esc` does not escape `'`. | No single-quoted attribute or inline-handler use of scraped text was found (checked all `${...}` interpolations of team names, SportsMole text, Forebet titles, book names, health strings and brew text: all go through `esc` or `textContent`). It is a trap for future code only. | Proposed (Agent 2): add `'` to `&#39;` |
| 20 | Low | `test/headline.mjs`, `test/pick.mjs`, `test/odds.mjs` | These tests are not in `npm test` and are broken: `MIN_CARD is not defined` (they eval `public/index.html`), and odds.mjs fails "the same league is not looked at again for hours". | The page's `headline()` and `src/pick.js` are meant to agree (`pick.js` line 2 says test/pick.mjs checks it). That check has not run, so the page and the locked record could drift apart without notice. | Reported (Agent 2 owns index.html). `bets`, `agree`, `btts` and `push` tests passed but were also not run; they are in `npm test` now |
| 21 | Low | `package.json` | `wrangler: ^4` with no lockfile; `npm audit` cannot run. | Each deploy installs whatever 4.x is newest. | Proposed: commit `package-lock.json` |
| 22 | Info | `src/worker.js:169` | `dropScout` stops on `DROP_SCOUT_UNTIL` (2026-11-12), which has passed. | Dead code on every cron run (one date compare). | Proposed: remove |
| 23 | Info | `src/analyst.js:414` | `doc.old` (packed settled bets) only grows. | KV values allow 25 MB, so years of headroom. It is parsed on every Analyst look, though (CPU, see below). | Proposed: roll up bets older than about 60 days into per-rule totals |

Checked and fine: the HTTP to HTTPS redirect before anything else, and cookie flags (`HttpOnly; Secure; SameSite=Lax`, `Path=/`). `safeNext` refuses `//`, `/\` and control characters. The login limit is counted before the password is checked, and header logins are counted too. A guessed cookie needs 256 bits. With no `ADMIN_TOKEN`, nothing is let in. Unhandled errors log only the path, never the query (so not `?k=`). Error bodies hold status codes, never key values; the Odds API key sits in the query string because that API requires it. The service worker caches nothing. The `sweepdata.js` token only ever reaches `api.github.com/repos/${SWEEP_REPO}/contents/{soccer,nhl,health}.json`; set its scope to Contents read/write on the data repo only, as its comment says. A failed GitHub call never blocks the rotating job. All front-end scraped text goes through `esc`. Odds conversions are correct: American to decimal, implied chance, power de-margin (bisection on k in [0.5, 2]), break-even (`needP`), units won, and the 2.5-only rule for O/U prices in `priceFor`. Pushes are handled: hockey whole-number lines return null in `hockeyHit`. A moved game is looked up on the next 3 days.

## Performance notes (10 ms CPU, 50 subrequests, 1,000 KV writes a day)

* **Full-history reads on hot paths.** `/api/tally` (Results tab), `/api/trends`, `/api/nhl/trends`, `/api/nhl/export` and the sweep's `soccer` / `nhl` / `health` parts each list and parse every saved day. A synthetic day with 60 fully filled cards is about 150 KB. Parsing 35 such days takes about 25 ms on Node/V8 (`JSON.parse` only, before any tally work). 120 days take about 73 ms. That is well past 10 ms already, and it grows by one day each day. Cloudflare is lenient about short bursts, but a 1102 "exceeded resource limits" error on Results or Trends is the likely first failure as the season goes on. See P6.
* `tally()` reads the days one at a time (`for … await env.HUB.get`, `worker.js:859`). That costs wall time, not CPU, but `Promise.all` in batches would make the Results tab load several times faster. Its `list({ prefix: 'day:' })` also does not page (more than 1,000 days, so this is not urgent).
* `/api/status` reads `rat:<slug>` and today's and tomorrow's days one at a time. It is small.
* Cards repeat the same strings on every card (`leagueName`, `homeLeague`, the `form` sentences, `v2/v4/v5/v6.scores` and `best` text). Dropping `scores` and `best` from the v2 and v5 slims, which nothing shows after v2's retirement, would cut the day docs and every full-history parse by roughly a quarter (estimate). This is Agent 1's area.
* KV writes: `counted()` holds the write counter in the edge cache, which is good. The race in #10 is the bigger cost: a lost save is a wasted write and then a re-save.
* **D1 instead of KV for the day docs (strategic).** The free plan gives D1 100,000 row writes a day against KV's 1,000, and D1 writes are read-your-writes. One row per card (or per league and day) would remove saver mode, the write budget bookkeeping and the race in #10, and a SQL `SUM` / `GROUP BY` would replace the full-history parses. It is a large change. See P1 and P6.

## Hit-rate notes (no model math or pick rules changed)

The headline pick (`leanPick`) is the highest of v6's seven chances (H/D/A, O/U 2.5, both score Yes/No). v6 is fitted to the card's price with the margin removed. Picking the most likely event maximizes hit rate by construction, and the models only add an agree count. So the pick is only as good as the price under it, and the bugs that can make picks wrong are price bugs:

1. **Wrong book taken as DraftKings** (#2, fixed). This moved v6, and so the headline, onto another book's price, and let the Analyst bet a price that was never DraftKings'.
2. **A stale price kept as the close** (#10). A lost lineup read leaves v6, which the pick is locked on, at an earlier price. The lineup read is the information-richest price (team news), so this hurts exactly the picks most likely to have moved.
3. **Mixed open/close outcomes** (#14) and **hockey's first-listed book** (#15). These are small distortions of the market the pick is read from.
4. **Records that mismeasure the picks.** Extra-time grading (#9), SportsMole added after kickoff changing the kind (#11), and stand-in prices in P/L (#12) do not change a pick before kickoff. They do change the numbers used to judge the rules (the Best-pick hit rate, `byKind`, P/L, and the Analyst bench check), and decisions such as "drop the watch flag after 20 fresh games" are made on those numbers.
5. **Page and server agreement is untested** (#20). `src/pick.js` says it mirrors `public/index.html headline()` and that `test/pick.mjs` checks this. That test is broken and not run, so a drift between the pick shown and the pick recorded would go unnoticed.

Offline backtests: `tools/` is empty in this checkout (no `tools/backtest-*.mjs`), so nothing could be re-run. `data/football-data` has the CSVs but no driver.

## Roadmap: proposals not implemented (ranked)

| Rank | Proposal | Why first | Owner, size |
|---|---|---|---|
| P1 | Stop the lost updates on `day:<date>`. The cheapest version: the buttons that touch one card or league (`refreshCardClose`, `priceWhy`, `forebetPaste`, `assignCandidate`, `nhlSetLine`, `nhlCardClose`) write only the fields they own. Store them in a small per-card side key (`fix:<date>:<id>`, merged on read) or send the change to the cron through the edge cache. The real fix is per-league keys (`day:<date>:<slug>`) or D1. | It protects the closing price the headline pick and every CLV number rest on (#10). | Agent 1; small (side key) to large (D1) |
| P2 | Grade on 90 minutes. Read `status.type.name` in `parseEvent`. For `STATUS_FINAL_AET` or `STATUS_FINAL_PEN` (and any non-final state such as abandoned or canceled), work out the 90-minute score from `goalPlays` using goals in the first two periods only (check that the details carry the period or a clock under 90 minutes plus stoppage), or mark `final.et = true` and void the 1X2/O/U/BTTS grades and the lean. Treat `STATUS_POSTPONED`, `CANCELED` and `ABANDONED` as void, not final. Check against a live MLS playoff feed first. | MLS playoffs are running now (#9). | Agent 1; small |
| P3 | Freeze the agree count at kickoff. Either skip SportsMole for started games in `smLeague` (`new Date(c.kickoff) > now` unless forced) and the slot-3 `need` check, or lock `c.lean` at kickoff (the same moment v4, v6 and the price lock) instead of at grading. | The Best-pick record should be the record of the picks shown (#11). | Agent 1; tiny |
| P4 | Headline P/L only at DraftKings: in the lock at `worker.js:738`, skip `l.price` when `c.odds.src` is set and for B/N when `c.odds.bk` is not `draftkings`, or store the book on the lean (`l.bk`) and split P/L by it. | Honest P/L (#12). | Agent 1; tiny |
| P5 | Sessions you can revoke. Make the cookie `__Host-hub_s` = `v2.<issuedAt>.<HMAC(issuedAt)>` with a server-side maximum age, plus an optional `SESSION_EPOCH` var mixed into the HMAC to sign every device out without changing the password. Accept the v1 cookie for a 30-day changeover. Also require a strong `ADMIN_TOKEN` (16+ random characters): the limiter is 5 tries a minute per IP and fails open. | Single static bearer cookie (#17). | Agent 3 / router; small |
| P6 | Cache the full-history summaries. Keep `tally`, `buildSoccerTrends`, `buildTrends` and `nhlTally` output in `caches.default` (free) under a version stamp that grading bumps (an edge-cache entry, so no KV write), or roll each graded day into a compact `sum:<date>` record and add those up. | CPU on Results and Trends (25+ ms parse alone, growing daily). | Agent 1; medium |
| P7 | Fix and re-wire `test/pick.mjs`, `test/headline.mjs` and `test/odds.mjs` (`MIN_CARD` now lives in `public/index.html`; the eval harness needs it), and add them to `npm test`. | They guard the page-to-record agreement (#20). | Agent 2; small |
| P8 | Make the price verdict meaningful: compare v4's chance (or Pinnacle's fair close) with the DraftKings price, not v6's own de-margined price (#13). | The verdict P/L split says nothing today. | Agent 1; tiny |
| P9 | Price parsing tidy-up. Take an outcome set from one snapshot only (all close, else all open) (#14). Prefer DraftKings in `parseHockeyOdds` (#15). Mark a non-DraftKings American price from ESPN as a stand-in (`src: bookOf(o)`) once a live feed shows which providers ESPN lists for these leagues. | Market accuracy. | Agent 1; small |
| P10 | Defense in depth: a CSP with `script-src 'self' 'unsafe-inline'`, `connect-src 'self'` and Google Fonts allowed (test on every page first). Add `'` to the pages' `esc` (#19). Restrict push endpoints to the known services (`fcm.googleapis.com`, `*.push.apple.com`, `updates.push.services.mozilla.com`, `*.notify.windows.com`). Restrict SportsMole links to its host (#16). Send the health token by header only (#18). Commit a lockfile (#21). | Hardening; nothing known to exploit today. | Agents 2 and 3; small each |

## Tests added

* `test/security.mjs`: the health token limit, digest comparison, the cross-site guard (pages still open, own fetches and scripts still work, cross-site, same-site and foreign-Origin changes refused, sign-out and sign-in posts from other sites refused), `?date=` validation, the new headers, push subscription validation, and the 12-leg limit before reads. It fails against the old code (checked by running it on the pre-change tree).
* `test/oddsprovider.mjs`: "Draft Kings" listed after a Bet365 stand-in is taken unmarked; with no DraftKings the stand-in is still used and marked.
* Now in `npm test` as well: `push.mjs`, `bets.mjs`, `agree.mjs`, `btts.mjs` (all passed already).

## Follow-up Nov 18: revocable sessions

Finding #17 / proposal P5, approved by the owner. Commit `077b7e9`. Nothing pushed or deployed. No secret values were read or printed.

**What changed (`src/worker.js`, auth section only).**

* The cookie is now `__Host-hub_s` = `v2.<issuedAt seconds>.<hex HMAC-SHA256 over "v2|<issuedAt>|<SESSION_EPOCH>">`. The HMAC key is
  itself an HMAC of a fixed label under `ADMIN_TOKEN`, so the key is tied to the password and kept apart from the old cookie's phrase.
  Flags: `HttpOnly; Secure; SameSite=Lax; Path=/`, no `Domain` (required for `__Host-`). `Max-Age` follows `SESSION_MAX_DAYS`, capped
  at 400 days (the browsers' own cap). The signature is checked with `same()` (digest compare), as before.
* Server-side age: refused once older than `SESSION_MAX_DAYS` (default 180), or dated more than 5 minutes ahead.
* Renewal: a page load (GET, not `/api/`, and `Sec-Fetch-Dest: document` or `Accept: text/html`) with a session older than 30 days gets a
  fresh cookie on that answer. No KV writes. Data calls, a page's scripts and pictures, POSTs and header sign-ins never get one.
* `SESSION_EPOCH` (var or secret, default `"0"`; empty counts as `"0"`) is in the signed text, so changing it ends every session.
* Changeover: the old `hub_s` cookie is still taken before `OLD_COOKIE_UNTIL = '2026-12-20'` (00:00 UTC), and only while the epoch is
  `"0"`. A page or a data call made with it gets the new cookie and `hub_s` cleared. After the cutoff, or after any epoch change, it is
  refused.
* `/login` sets the new cookie and clears `hub_s` (it never sets it). `/logout` clears both. `x-admin-token`, Basic and `HEALTH_TOKEN` are
  unchanged.
* Weak password: `/api/health` (signed in or with the health token) now has `signIn: { weakPassword, sessionDays }`, where
  `weakPassword` is true when `ADMIN_TOKEN` is under 16 characters. Sweep's report (`public/sweep.js readHealth`, the health output shown
  in the app) lists "the sign-in password is weak". The password and its length are never shown. Nothing is blocked.
* `public/login.html`: "stays signed in for a year" now says "while you use it".

**Changes from the brief, and why.**

1. Renewal starts at 30 days *or half of `SESSION_MAX_DAYS`, whichever is shorter*. With `SESSION_MAX_DAYS` under 30 a fixed 30-day
   threshold would never renew, and a device in daily use would be signed out anyway.
2. The cookies are added in `fetch()` after the route answers, through a `WeakMap` keyed by the request. `handle()` has dozens of exits,
   and this keeps the diff to the auth code and away from routes other agents edit.
3. A page is recognized by the request (`Sec-Fetch-Dest` / `Accept`), not by the answer's `content-type`. The answer to a
   revalidated page is often a 304 with no `content-type`, so a check on the answer would rarely renew.
4. An answer that sets a cookie is sent with `cache-control: private, no-store`, so no cache keeps a `Set-Cookie`.
5. Sign-in also clears a leftover `hub_s`, so an old cookie left in the jar is not usable until the cutoff.
6. The old cookie is swapped on data calls too, not only on pages. It is a one-time swap, and the answers are already `no-store` JSON.

**Caching check.** `public/sw.js` has an empty `fetch` handler (no `respondWith`) and no Cache Storage use, so it caches nothing.
`PUBLIC_FILES` and the sign-in page are served before the auth check and never get a cookie. Every `caches.default.put` in `src/`
stores an answer it built itself (write tally, credits, summaries, idle markers), never a request's answer. Cloudflare does not cache a
Worker's answers on its own.

**Limits that remain.** One device still cannot be signed out by itself from the server (that needs a stored list, which means KV
writes). Use Sign out on the device, or change `SESSION_EPOCH`. A copied cookie works until it expires, the epoch changes or the password
changes. The limiter still lets everything through if it fails, so the 16+ character password is advice, shown as a warning.

**Tests** (`test/auth.mjs`, 33 new checks and 3 rewritten; `test/security.mjs` sign-in check tightened): v2 accepted; a changed signature, a re-dated
signature and the old value under the new name refused; 179 days accepted, 181 refused, an hour ahead refused, a minute ahead accepted;
`SESSION_MAX_DAYS` changes both the server limit and `Max-Age`; an epoch change refuses older sessions and an empty epoch counts as none;
v1 accepted and swapped on a page and on a data call before the cutoff, refused after the cutoff and after an epoch change; renewal only
for a session older than the threshold, only on page GETs (not `/api/`, scripts, POSTs or header sign-ins); logout clears both; the
health warning appears for a short password, not for a long one, and never holds the password. The time-dependent checks set
`Date.now`, so they keep passing after Dec 20. Three mutations (no future-skew check, renew on every page, v1 kept after an epoch change)
each made the new tests fail. `npm test`: exit 0, 1,458 PASS, no FAIL.

**At or after deploy.** Nothing has to be set: the defaults are 180 days and epoch `"0"`. Devices move to the new cookie the next time
they open the Hub before Dec 20; a device not opened by then signs in once more. If `ADMIN_TOKEN` is short, change it with
`npx wrangler secret put ADMIN_TOKEN`; that also signs every device out. To sign everything out later without changing the password:
`npx wrangler secret put SESSION_EPOCH` with a new value (or a `[vars]` line and a deploy). After Dec 20, 2026 the v1 branch
(`OLD_COOKIE_UNTIL`, `oldSessionValue`, the `hub_s` clear on sign-in and sign-out) is dead code that can be removed.
