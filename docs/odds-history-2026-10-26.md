# Models against the market on history (Oct 26, 2026)

**Data:** github.com/xgabora/Club-Football-Match-Data-2000-2025, built from football-data.co.uk. It has the market's average pre-match price for home / draw / away and Over/Under 2.5. Those are prices taken a day or two before kickoff, not closing prices.

**Leagues (9):** Premier League, Championship, La Liga, La Liga 2, Serie A, Bundesliga, 2. Bundesliga, Ligue 1, Eredivisie.

**Method:** v4 ratings and v5's Elo are refit every week on earlier games only. Blend weights are chosen on games before July 2023 and scored on July 2023 to September 2026 (9,908 games).

**Reproduce:** `node tools/backtest-odds.mjs`

## Winner (log loss, lower is better)

| Model | Log loss | RPS |
|---|---|---|
| Market (price, margin removed) | **0.9893** | **0.2005** |
| v5 | 1.0065 | 0.2060 |
| v4 | 1.0083 | 0.2065 |

- **The market is far ahead:** 0.019 a game better than v4 (z 12.8).
- **v5 beats v4 again,** by 0.0019 a game (z 2.7). This is the same size as in the bundled-history test.
  - Caveat: v5's handful of constants were fitted on the bundled history, which overlaps these seasons for most of the leagues.
- **Best share of v4 or v5 to mix into the price: 0%.** The score card's `W_MODEL = 0` is right.

## "Value" bets lose money

| Rule | Bets | Return |
|---|---|---|
| v4, 5+ points over the price (winner) | 3,969 | −19.1% |
| v5, same rule | 3,863 | −14.8% |
| Edges-tab rule: v4 55%+ and 5+ points over the price (winner) | 458 | −10.7% |
| Edges-tab rule (Over/Under 2.5) | 1,262 | −11.1% |

- **This is much worse than the margin alone,** which is about 5% at average prices.
- **When a ratings model disagrees with the market by that much, the market is usually right.**
- **The Edges tab's tags are not an edge.** Treat them as "the model disagrees", never as a bet.

## Goals markets (log loss)

| | Market price | Score card | v4 | Base rate |
|---|---|---|---|---|
| Over 2.5 | 0.6716 | 0.6718 | 0.6793 | 0.6926 |
| Both score | – | **0.6814** | 0.6839 | 0.6894 |

- **The score card's Over 2.5 is as good as the market's own price.**
- **Its both-score beats v4 (z 2.7) and the base rate.** That is the market's view carried into a market the price feed doesn't cover.

## What it means for the app

1. **Keep the score card market-led.**
2. **Change the Edges tab and "Value" tags.** Relabel them as disagreements, or remove them.
3. **v5 is the better model of the two for games with no price.**
4. **Still missing:** a closing-line test needs closing prices, which this copy does not carry. The original football-data files do.
