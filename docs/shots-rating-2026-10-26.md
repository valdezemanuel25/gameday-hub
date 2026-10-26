# Shots rating test (Oct 26, 2026)

**Question:** do team ratings built on shots on target predict better than v4's goals-only ratings?

**Answer:** only a little. It is not worth wiring into the app yet.

## Data and method

- **Data:** football-data.co.uk season files from the GitHub mirror `datasets/football-datasets`. That covers 14,284 matches in the Premier League, La Liga, Serie A, Bundesliga and Ligue 1, 2018-19 to 2025-26, with goals, shots and shots on target. The mirror has no odds.
- **Method:** walk-forward. Ratings are refit every week on earlier games only.
- **Shots rating:** each team's shots on target × 0.321 (the average goals per shot on target) is treated as a goals-like number. It is fitted with v4's attack / defence method using its own memory and shrink settings.
- **Tuning:** settings tuned on 2019-20 to 2022-23 and scored on 2023-24 to 2025-26 (5,112 games). Over 2.5 and both-score get the same calibration for both versions.

## Results (log loss, lower is better)

| Rating | Winner | Over 2.5 | Both score |
|---|---|---|---|
| Goals only (v4's way) | 0.9877 | 0.6766 | 0.6836 |
| 70% goals + 30% shots on target | 0.9870 | 0.6758 | 0.6834 |
| Gain | 0.0006 (z 1.0) | 0.0008 (z 2.2) | 0.0002 (z 0.7) |
| Base rates | – | 0.6904 | 0.6883 |

## What we learned

- **Shots on their own are worse than goals for the winner,** at every setting tried (27 combinations). Total shots add nothing beyond shots on target.
- **The useful mix is small:** 70/30 goals to shots on target, with the shots ratings shrunk only lightly (K = 3) and a 240-day memory.
- **A fair comparison changes the picture.** Before both versions got the same calibration, the shots blend looked clearly better on the goals markets (z 3.6–4.3). Most of that was calibration, not shots.
- **Calibrated goals ratings do beat the base rates on the goals markets in these five leagues.** That differs from the Hub's first two weeks (mostly smaller leagues and a small sample).

## Why not wire it in

The gain is about a third of v5's, while the cost is real:

- The bundled history has no shots, so club names would have to be matched between football-data and ESPN to build a shots seed.
- The Hub keeps only a short rolling window of live shots, which would leave a gap since August.

The bigger lever is the market (the v6 score card). The next useful step is the historical odds from the same football-data files (not in the mirror). With them we can test the score card's v4 share and check closing-line value on thousands of games.

## Reproduce

`node tools/backtest-shots.mjs` (needs raw.githubusercontent.com).
