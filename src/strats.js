// Tracked bets: simple rules a card either meets or doesn't, each with one fixed bet. Unlike the headline pick (one per card),
// several can apply to the same card, so each collects results faster. They are worked out from the saved model numbers, so
// nothing extra is stored. The rules were chosen after looking at games up to SINCE, so results from SINCE on are the fair test.
export const SINCE = '2026-10-26';
const side = p => { const i = p.indexOf(Math.max(...p)); return i === 0 ? 'H' : i === 2 ? 'A' : 'D'; };
const has = (c, m) => c[m] && Array.isArray(c[m].p);
// The rules run on v4, the official model since 2026-10-26 (v2 scored worse than always guessing the base rates on the tracked games).
// Thresholds were chosen on the walk-forward test of v4 over 3,801 league games (tools/backtest-v4.mjs), not on the Hub's own games:
//   Over 60%+ hit 64% (base 56%), both-score 60%+ hit 63% (base 59%), home 55%+ hit 63%, away 50%+ hit 61%.
//   No Under or "both score: No" rule: v4 gives Under 55%+ too rarely and those games hit under 50% in the test.
export const STRATS = [
  { id: 'v4over', name: 'Over 2.5', rule: 'v4 says 60%+', key: 'O', pick: c => has(c, 'v4') && c.v4.over >= 60 ? 'O' : null },
  { id: 'v4btts', name: 'Both score: Yes', rule: 'v4 says 60%+', key: 'B', pick: c => has(c, 'v4') && c.v4.btts >= 60 ? 'B' : null },
  { id: 'v4home', name: 'Home win', rule: 'v4 backs home at 55%+', key: 'H', pick: c => has(c, 'v4') && c.v4.p[0] >= 55 ? 'H' : null },
  { id: 'v4away', name: 'Away win', rule: 'v4 backs away at 50%+', key: 'A', pick: c => has(c, 'v4') && c.v4.p[2] >= 50 ? 'A' : null },
  { id: 'v4fb', name: 'Winner, v4 and Forebet agree', rule: 'v4 and Forebet back the same side', key: 'W', pick: c => {
    const s = ['v4', 'fb'].map(m => has(c, m) ? side(c[m].p) : null);
    return (s[0] === 'H' || s[0] === 'A') && s[0] === s[1] ? s[0] : null; } },
];
// The old v2 rules, kept so their record stays on the Results tab. Their record is frozen: games from SINCE on are not added.
// RETIRED_SINCE is the date those rules were set (their own "live" start).
export const RETIRED_SINCE = '2026-10-24';
export const RETIRED = [
  { id: 'bttsY', name: 'Both score: Yes', rule: 'v2 says 65%+', key: 'B', pick: c => has(c, 'v2') && c.v2.btts >= 65 ? 'B' : null },
  { id: 'under', name: 'Under 2.5', rule: 'v2 gives Over 45% or less', key: 'U', pick: c => has(c, 'v2') && c.v2.over <= 45 ? 'U' : null },
  { id: 'over', name: 'Over 2.5', rule: 'v2 says 65%+', key: 'O', pick: c => has(c, 'v2') && c.v2.over >= 65 ? 'O' : null },
  { id: 'agree', name: 'Winner, all models agree', rule: 'v2, v4 and Forebet back the same side', key: 'W', pick: c => {
    const s = ['v2', 'v4', 'fb'].map(m => has(c, m) ? side(c[m].p) : null);
    return s.every(x => x === 'H' || x === 'A') && s[0] === s[1] && s[1] === s[2] ? s[0] : null; } },
  { id: 'home55', name: 'Home win', rule: 'v2 backs home at 55%+', key: 'H', pick: c => has(c, 'v2') && side(c.v2.p) === 'H' && c.v2.p[0] >= 55 ? 'H' : null },
  { id: 'bttsN', name: 'Both score: No', rule: 'v2 gives Yes 40% or less', key: 'N', pick: c => has(c, 'v2') && c.v2.btts <= 40 ? 'N' : null },
];
// Fold one finished card into the tracked-bet totals. S = { strats, base }.
export function addStrats(S, c, date, hitFn) {
  if (!c.final || !(has(c, 'v2') || has(c, 'v4'))) return;
  const f = c.final;
  S.base.n++; S.base.home += f.h > f.a ? 1 : 0; S.base.draw += f.h === f.a ? 1 : 0; S.base.away += f.h < f.a ? 1 : 0;
  S.base.over += f.h + f.a >= 3 ? 1 : 0; S.base.btts += f.h > 0 && f.a > 0 ? 1 : 0;
  for (const s of [...STRATS, ...RETIRED.map(r => ({ ...r, retired: true }))]) {
    if (s.retired && date >= SINCE) continue;
    const key = s.pick(c); if (!key) continue;
    const t = S.strats[s.id] || (S.strats[s.id] = { id: s.id, name: s.name, rule: s.rule, ...(s.retired ? { retired: true } : {}), live: { n: 0, hits: 0, ks: {} }, hist: { n: 0, hits: 0, ks: {} } });
    const b = date >= (s.retired ? RETIRED_SINCE : SINCE) ? t.live : t.hist, hit = hitFn(key, f);
    b.n++; b.hits += hit ? 1 : 0; b.ks[key] = (b.ks[key] || 0) + 1;
  }
}
