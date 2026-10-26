# v6 score card (Oct 26, 2026)

Every league and cup card now has a **Score card** panel under the model boxes. It shows:

- winner (home / draw / away)
- Over/Under 2.5
- both teams score
- the three likeliest scores and the expected goals
- a "fair" price next to each chance (the American odds that chance is worth with no margin)

## Where the numbers come from

All of them are read off **one score grid**, so they always agree with each other.

- **With a sportsbook price (v6):** the card's DraftKings home / draw / away price and its main total (when it is a half-goal line) have the book's margin removed. v6 then finds the two expected-goals numbers whose grid best reproduces them. This uses Poisson with v4's low-score correction.
  - Two numbers fit four prices to within about half a point.
  - The grid's both-score chance lands within about 2 points of the book's own both-score price, which v6 never sees.
- **Without a price:** the panel shows v4's numbers, labelled "v4 · no sportsbook price yet".

v6 follows the price until kickoff. After kickoff, the score card made before it stands, and that is what gets graded. The code is in `src/v6core.js`.

## Why

The market beat every model by about 0.03 log loss a game (see `docs/model-review-2026-10-25.md`). On the 72 priced games from Oct 13–25, v6's numbers scored better than v4's on every market (log loss, lower is better):

| Market | v6 | v4 | Base rate |
|---|---|---|---|
| Over 2.5 | 0.692 | 0.697 | 0.708 |
| Both score | 0.682 | 0.696 | 0.696 |

The sample is small, so the Results tab tracks v6 against v4 on the same games ("Score card (v6)").

## Removing the margin (Oct 26, 2026)

The book's margin is removed with the **power method**: each implied chance is raised to the same power so they add up to 1. Books put more margin on long shots, so this takes more out of them than removing it in proportion.

Tested on 8,389 closing prices (2023–2026, `data/football-data`):

| Method | Favourites rated 60%+: said / won | Log loss |
|---|---|---|
| Proportional (before) | 69.9% / 71.8% | 0.9748 |
| Power (now) | 70.9% / 70.8% | 0.9743 |

The "Models against the market" panel uses the same method, so it scores the market the score card is built from.

**v5 checked at the same time, and left unchanged.** On 9,908 history games v5's own 60%+ favourites are already calibrated (68.8% said, 69.6% won):
- Sharpening its probabilities did not help.
- Shrinking team ratings half as much changed nothing (z −0.4).
- Shrinking them twice as much was worse (z −2.6).

v5 does look low on the *market's* favourites, but that is the market knowing more, not a bias that can be tuned away.

## The model's share

`V6.W_MODEL` is how much of v4's home / draw / away is mixed into the price before fitting. It is 0 because the "Models against the market" panel's best v4 + market mix is currently 0% v4. Raise it only when that panel shows v4 adding something over a few hundred priced games.

## Next steps (not done yet)

- Pull the free football-data.co.uk history: shots, plus opening and closing odds for the European leagues. Use it to test the blend weight properly and to build a shots-based rating.
