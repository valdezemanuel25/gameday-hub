# Model review, Oct 25, 2026

Based on the backup from Oct 25, 2026: 317 finished games (Oct 13 to 25) with v2, v4, Forebet, SportsMole and, for 72 games, the sportsbook price.
To re-run on a newer backup: `python3 tools/score-backup.py <backup.json>`.

## Main points

- **v2 is worse than guessing.** On the 205 games all three models covered, v2's RPS was 0.244. Always saying the base rates (home 43 / draw 24 / away 33) scores 0.232. v2 is overconfident: favourites it gave 70%+ won 42% of the time (19 games).
- **v4 is the best of the three models.** RPS 0.216, log loss 1.041, close to well calibrated. Forebet was 0.218. A 50/50 mix of v4 and Forebet scored 0.214.
- **The market beats every model.** On the 67 priced games v4 also covered, v4's RPS was 0.222 and the market's was 0.211. Every step of mixing v4 into the market made the market worse, so v4 does not yet know anything the price doesn't.
- **The goals markets show no real skill.** For Over 2.5 and both-score, no model clearly beats always saying the base rate (57% for each).
- **Betting so far has lost money.**

  | Bets | Number | Result |
  |---|---|---|
  | Headline picks with a price | 56 | −7.3 units (−13%) |
  | v2 value bets | 54 | −30% |
  | v4 value bets | 30 | −6% |
  | Forebet value bets | 55 | +10% |

  At these sample sizes all of these are within noise.

## What changed (Oct 26, 2026)

1. **v4 is the official model.** The Tracked bets rules, Top picks, and the "model at the book's total" line now use v4. v2 is still shown, and covers games v4 has no numbers for. The old v2 rules keep a frozen record under "Retired v2 rules".

   The new rule thresholds come from the walk-forward test on 3,801 league games, not from these 317:

   | Rule | Hit rate in the test | Base rate |
   |---|---|---|
   | Over 60%+ | 64% | 56% |
   | Both score 60%+ | 63% | 59% |
   | Home 55%+ | 63% | |
   | Away 50%+ | 61% | |

   There is no Under rule, because v4's Under 55%+ games hit under 50% in the test. There is also no rule for both teams not scoring, because v4 gives a 55%+ chance of that too rarely to use.
2. **Dixon-Coles low-score correction in v4** (`V4.RHO = -0.04`). It changes how often 0–0, 1–0, 0–1 and 1–1 come up, without changing expected goals.
   - In the walk-forward test it cut log loss by 0.0005 a game. That is better in both halves of the test window, but small and not statistically significant (z = 1.5).
   - Cup games keep plain Poisson, because the cup model was tested without the correction.
   - The bet analyzer uses the same correction for v4's score grid.
3. **Scoring against the market.**
   - Prices are now recorded for the Champions League and Europa League too.
   - Each card keeps the first price the Hub saw and ESPN's opening line.
   - The Results tab has a "Models against the market" panel: RPS and log loss against the market, the best v4 + market mix, the headline picks' closing-line value, and v4's value bets.
4. **`tools/score-backup.py`** scores a backup the same way as this review.

## What to watch next

- **The best-mix line.** Until the v4 share is clearly above 0% over a few hundred priced games, treat "Value" tags as unproven.
- **Closing-line value of the headline picks.** It starts collecting from Oct 26. Positive closing-line value over 200+ picks is the first real sign of an edge. Until then, don't stake money on the picks.
- **The goals markets.** Over and both-score picks should come off the headline unless they show skill over the base rate on a few hundred games.
- **Ideas not done here:**
  - lineups and injuries
  - rest days and midweek European games
  - a dedicated total-goals model, because Poisson spreads totals too narrowly
  - expected goals (xG) data, which ESPN doesn't provide
