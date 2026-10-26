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

## Closing prices (added the same day)

**Data:** the football-data.co.uk season files in `data/football-data` (E0 E1 SP1 I1 D1 F1 N1, 2023/24 to 2026/27), joined to the history above.
- The market average's pre-match and closing prices cover 8,026 test games, Aug 11, 2023 to Oct 18, 2026.
- Pinnacle's prices stop partway through 2025/26 in these files, so the Pinnacle numbers use the 6,268 games that have them (to Jan 11, 2026).

**Method:** every pick is bet at the average pre-match price and judged three ways:
- **Return:** what the bet actually paid.
- **Closing-line value:** did the pick's chance, margin removed, rise by kickoff?
- **Value at the close:** the bet price times the closing chance, minus 1. This says what the bet was worth, with far less noise than the result.

**Reproduce:** `node tools/backtest-odds.mjs data/football-data`

### Winner (log loss, lower is better)

| | All 8,026 games | 6,268 games with Pinnacle |
|---|---|---|
| Market average, pre-match | 0.9770 | – |
| Market average, closing | **0.9743** | 0.9681 |
| Pinnacle, pre-match | – | 0.9705 |
| Pinnacle, closing | – | **0.9676** |
| v5 | 0.9945 | 0.9892 |
| v4 | 0.9965 | 0.9912 |

- **The closing price is sharper than the pre-match price,** by 0.0027–0.0029 a game (z 3.3–3.7). The price moves toward the truth before kickoff.
- **The closing price is about 0.022–0.024 a game better than v4** (z 11–12): eight times the gap between pre-match and close.
- **Best share of v4 or v5 to mix into the closing price: 0%,** even when chosen on the same games.

### Picks against the closing price (average-price bets)

| Picks | Bets | Return | Beat the close | Closing-line value | Value at the close |
|---|---|---|---|---|---|
| Market favourite (baseline) | 8,026 | −3.5% | 50.8% | +0.05% (z 0.8) | −5.2% |
| v4's winner | 8,026 | −5.6% | 50.1% | −0.11% (z −1.6) | −5.3% |
| v5's winner | 8,026 | −5.7% | 49.9% | −0.10% (z −1.5) | −5.3% |
| v4, 5+ points over the price | 3,151 | −20.4% | 45.3% | **−0.83%** (z −5.0) | −6.0% |
| v5, 5+ points over the price | 3,020 | −15.1% | 46.0% | **−0.65%** (z −4.3) | −5.9% |
| Edges tab, winner (v4 55%+, 5+ points) | 357 | −5.7% | 48.2% | +0.10% (z 0.3) | −5.1% |
| Edges tab, Over/Under 2.5 | 873 | −11.9% | 47.1% | **−0.46%** (z −2.4) | −5.6% |

The Pinnacle numbers (on the games that have them) tell the same story. For example, v4's 5+ point picks have closing-line value of −1.25% (z −6.2), and only 44.5% beat Pinnacle's close.

- **No model beats the closing price.** Ordinary v4 and v5 picks are about level with the close: they carry no information the market lacks.
- **"Value" picks are worse.** Their price drifts against them by kickoff (z −4 to −6). The market moves away from exactly the games where the models disagree most, which confirms the disagreement is the model's error, not the market's.
- **Value at the close is about −5% for every rule.** That is the bookmaker's margin at average prices. The closing price says none of these bets were worth more than the margin costs, and the actual returns match it, just with more noise.

## What it means for the app

1. **Keep the score card market-led.** Its price is refreshed up to kickoff, which is the sharper price.
2. **Change the Edges tab and "Value" tags.** Relabel them as disagreements, or remove them. The closing price confirms they point the wrong way.
3. **v5 is the better model of the two for games with no price.**
4. **The app's own closing-line value panel** (Results tab, from Oct 26) should be read against these numbers. A pick rule needs clearly positive closing-line value over a few hundred bets before it is worth money.
