# Hockey review, Oct 26, 2026

This review covers the hockey backup from Oct 26, 2026: 75 graded NHL games (Oct 15–26), 48 of them with a sportsbook Over/Under line. The sample is small, so read everything here as a direction, not a verdict.

## What the data showed

**Picking the winner**

| Model | Correct picks | Brier |
|---|---|---|
| v4 | 50 of 75 | 0.229 |
| v2 | 47 of 75 | 0.235 |
| Forebet | 37 of 67 | 0.246 |
| Always 54% home | – | 0.238 |

Home teams won 67% of games, against the NHL's long-run rate of about 54%. That is most likely an early-season run, so the home advantage was left as it is.

**Over/Under:** both models leaned Under. Their average Over chance was 46%, while games went Over 50% of the time. Both scored worse than a coin flip (Brier 0.255 and 0.262 against 0.250).

The cause was that the Over chance came from the regulation score only. A 3–3 tie decided in overtime ends 4–3 (7 goals), which is Over 6.5. The model counted it as 6, which is Under. 35 of the 48 lines were 6.5.

**Ties after regulation:** plain Poisson expects 16% of games to go past regulation. These games had 27%, and the NHL's long-run rate is about 23%.

## What changed (`src/nhl.js`)

1. **Overtime goal counted.**
   - In the Over/Under calculation, a regulation tie now ends one goal higher 65% of the time (`OT_GOAL`), the share of games past regulation that overtime settles.
   - The shootout goal still does not count, matching how the Hub grades totals. Most US sportsbooks credit the shootout winner with one goal. If yours does, the grading and `OT_GOAL` should both change to count it.
   - The bet analyzer's hockey score grid uses the same rule.
2. **Tie boost.**
   - Tied regulation scores are multiplied by 1.55 (`TIE`). That brings the share of games past regulation to about 23%, the NHL's rate.
   - This was set from the league-wide rate, not fitted on these 75 games.
3. **Frozen xG fades.**
   - ESPN has no xG, so v4's xG rates are frozen at the seed date.
   - Their weight now shrinks with the share of each team's games they cover, and the goals rates (which keep updating) take over.
   - At the seed date nothing changes.

## Effect on the same 75 games (v2)

| Measure | Before | After |
|---|---|---|
| Average Over chance (games went Over 50% of the time) | 46.1% | 48.5% |
| Over Brier | 0.255 | 0.249 |
| Winner Brier | 0.2353 | 0.2358 |

The tie boost pulls winner chances slightly toward 50%, so the winner Brier is essentially unchanged.

## Still to watch

- **Home advantage.** If home teams keep winning well above 54% past about 200 games, raise `HOME`.
- **Forebet's vote.** Forebet is the weakest of the three but still votes in the headline pick.
- **Shootout grading.** Check your book's rule on shootout goals.
