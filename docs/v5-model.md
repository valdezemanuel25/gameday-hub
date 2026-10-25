# v5: a challenger to v4 and Forebet (Oct 26, 2026)

v5 runs next to v4 as a shadow model. It shows on each league card as "v5 test", is graded like the others, and has its own section on the Results tab. It never changes the headline pick.

## What it is

v5 combines two ratings of the same clubs, built from the bundled league history:

- **v4's ratings:** attack and defence strength, from goals scored and conceded.
- **Elo:** a rating built on results and goal difference, with home advantage learned for each league. Between seasons, ratings move a quarter of the way back to the league average.

v5 blends the two (a weighted geometric mean) and adds a small draw adjustment. Draws get a little likelier when the teams are evenly matched, and when more goals are expected than usual, because v4's goal model under-counts those draws.

- **Over 2.5:** v4's number, re-scaled on the history.
- **Both teams score:** v4's number unchanged, because nothing tried beat it.

The code is in `src/v5core.js`. The Elo is rebuilt with v4's ratings by the background job.

## How it was chosen

The test was walk-forward on the 10,600 bundled league games. Ratings were refit every week using only earlier games. Settings were tuned on the early part of each league and checked on the last ~11 months (3,803 games).

| Candidate | Result against v4 (log loss per game) |
|---|---|
| Elo alone | about level (1.0232 vs 1.0235) |
| v4 with shorter or longer memory | worse |
| v4 fitted on capped scores | worse |
| Pi-ratings (separate home/away strength) | clearly worse |
| One draw rate per league | worse: overfits |
| Team Over/both-score tendencies | no gain |
| **v4 + Elo blend, with the draw adjustment** | **0.0019 better (z = 1.9)**, scored on halves it was not fitted on |

In the full test, v5 also picked more winners (49.7% vs 49.4%) and had a lower RPS (0.2111 vs 0.2116).

On the Hub's own games (Oct 13–25), the comparison is mixed and within noise:

| Games | Model | Log loss | Winners picked |
|---|---|---|---|
| 193 league games | v4 | 1.044 | 46.6% |
| | v5 | 1.047 | 47.7% |
| 175 games with Forebet | v4 | 1.051 | |
| | v5 | 1.051 | |
| | Forebet | 1.068 | |

## Honest limits

- **The gain is small.** Goals history alone is close to what v4 already gets out of it. On the 67 priced games, the bookmaker's odds beat every model by about 0.03 log loss a game. That gap comes from information none of these models has (team news, lineups, the betting market).
- **Cup games have no v5.** Elo needs both clubs in the same league.
- **New clubs:** promoted clubs on v4's starting rating get no v5.
- **When to promote it:** v5 should replace v4 only if the Results tab shows it ahead after a few hundred graded games.

## Tools

- `node tools/backtest-v5.mjs`: walk-forward score of v5 against v4 (under a second).
- `node tools/fit-v5.mjs`: the honest check, then the constants refitted on the history (a few minutes).
