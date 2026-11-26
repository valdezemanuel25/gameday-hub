// What "missing" means for one card, in one place. The health report (src/health.js gameChecks), the nightly stats files
// (src/sweepdata.js dayGaps) and the Data Keeper (src/keeper.js missing) all ask these same questions, so the three agree on which game
// lacks what. Each test takes one card and answers true when the thing is missing. No reads, no writes.

export const HOUR = 3600000;

// Kickoff in ms (NaN when the card has no usable kickoff).
export const koOf = c => new Date(c && c.kickoff).getTime();
// A card the Hub tracks: not skipped (club not found and the like) and carrying a model pick (v2 or v4). Only these get prices,
// Forebet and Analyst bets.
export const tracked = c => !!(c && !c.skipped && (c.v2 || c.v4));
// Closed: a result is in, or the game was closed as void on purpose (postponed, canceled, abandoned, no 90-minute score).
export const closed = c => !!(c.final || c.void);
// No result this many hours after kickoff (void games never count as missing a result).
export const noResult = (c, now, graceH) => { const ko = koOf(c); return !closed(c) && Number.isFinite(ko) && now - ko > graceH * HOUR; };

// A soccer card is priced only with a home / draw / away price from ESPN: a price record holding just Pinnacle's or the both-score
// price does not count (a bare !c.odds check would miss such a game).
export const noSoccerPrice = c => !c.odds || ![c.odds.h, c.odds.d, c.odds.a].every(Number.isFinite);
// The closing price: the read inside the lineup window notes its time in odds.cl (src/jobs.js refreshOdds / refreshCardClose).
export const noSoccerClose = c => !(c.odds && c.odds.cl);
// The both-score price (odds.by), from Pinnacle or The Odds API (src/jobs.js addBtts / refreshBtts).
export const noBtts = c => !(c.odds && c.odds.by != null);
// Forebet's numbers (c.fb), soccer and hockey alike.
export const noForebet = c => !c.fb;
// Hockey: DraftKings' moneyline and total (c.px), the starting goalies (c.gk) and the DraftKings line (c.ln).
export const noHockeyPrice = c => !c.px;
export const noGoalie = c => !c.gk;
export const noLine = c => !c.ln;
// Hockey's closing price (c.px.cl, src/nhl.js setPrice / espnClose).
export const noHockeyClose = c => !(c.px && c.px.cl);

// Analyst paper bets (src/analyst.js items): still open although the game is closed, or settled (not void) with no closing price.
export const betOpen = (b, c) => !b.res && !!c && closed(c);
export const betNoClose = b => !!b.res && b.res !== 'void' && b.close == null;
