# Hockey: rest and backup goalies, Oct 28, 2026

Why: the Hub's 94 graded NHL games (Oct 15–28) showed v4 (57 of 94) no better than always picking the home team (58 of 94), and neither v2 nor v4 knows about rest or who is in net. This is the backtest behind the v5 shadow.

## What was tested
14,347 regular-season games, 2012–2026, from MoneyPuck's game-by-game goalie logs (`tools/backtest-nhl-rest-goalie.py`). Team strength is taken out first (season-to-date goal difference with last season as a 20-game prior), so these are effects on top of who the better team is. Goals are the goalies' goals against: empty-net and shootout goals are not in them.

| Situation | Effect on the game | Stable by era? |
|---|---|---|
| Visitor on a back-to-back | home margin +0.19 goals (se 0.05), home win chance about +6 points | yes (2012–16 +0.15, 2017–21 +0.28, 2022–26 +0.30) |
| Home team on a back-to-back | home margin −0.20 goals (se 0.06), about −6 points | yes |
| Backup goalie in net | that team lets in 0.16 more goals (se 0.04), about 2 to 3 points | n/a |
| Goalie quality (season-to-date rating) | small: 0.2 goals per goal of rating gap (se 0.10) | year-to-year correlation of goals saved above expected is only 0.15 |

- A team on a back-to-back scores about 0.15 fewer goals and allows about 0.05 more. Each team on a back-to-back trims the total by about 0.10.
- A backup in net changes the goals against his team (+0.16) and not its own scoring. Each backup adds about 0.15 to the total.
- Teams are on a back-to-back about 23% of the time on the road (11% at home), and the backup starts about 60% of those games. About 38–45% of all starts are by the team's non-leading goalie.
- Raw home win rate: 59.7% when the home team is rested and the visitor is not, 53.7% when both are rested, 46.9% when the home team is on a back-to-back and the visitor is rested.
- The starter of a team is a better goalie than its backup by about 0.15 goals a game (252 team-seasons, 2018–2025).

## What v5 does (`src/nhl.js`)
- Comparison only. It never feeds v2, v4, Forebet, the headline pick, Model bets or the Edges / price work.
- Winner: v4's chance shifted in logit space by `B2B_LOGIT` (0.24) for a back-to-back and `BACKUP_LOGIT` (0.11) for a backup, per side. v4's Elo part cannot see rest or goalies and would dilute it, so the measured effect is applied directly.
- Goals: `B2B_OWN` 0.15, `B2B_OPP` 0.05, `BACKUP_OPP` 0.16 added to v4's expected goals (goal rates and xG rates), for Over/Under and the likeliest score.
- Inputs: ESPN's probable starting goalie ("expected", then "confirmed") on each unstarted card, and rest from the saved days (`played` map in `nhlStep`). A team is a backup when it has fewer starts than its most-used goalie (`isBackup`; unknown with fewer than 6 team games). Start counts are seeded from `src/nhlgk.js` (`tools/make-nhl-gk.py`, through Oct 27) and grow as finished cards come in.
- v5 only exists on cards made or refreshed before puck drop after this ships, so it cannot be tuned to the 94 games already played. A goalie change before puck drop re-makes v5 only.

## Cautions
- The books price back-to-backs and confirmed goalies too, mostly by game time. A better model is not the same as an edge against DraftKings. The Results tab compares v4 and v5 on the same games; prices are not used.
- "Backup" and "back-to-back" overlap (backups mostly start the second night). Both are estimated together, and both stay significant.
- Rest counts the days in the saved cards; if a day was never saved the rest is left unknown, never guessed. The probable goalie on ESPN is not always the starter until it says confirmed.
- Early-season ratings are noisy, and the goalie rating itself is nearly noise (0.15 year to year). That is why v5 uses who is in net, not how good he was.

## What to watch
Judge v5 on the bottom table of the Results tab: v4 vs v5 on games where rest or a backup moved v5. v5 can only beat v4 there. Revisit the sizes after about 200 games.
