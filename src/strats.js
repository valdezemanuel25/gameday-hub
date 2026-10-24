// Tracked bets: simple rules a card either meets or doesn't, each with one fixed bet. Unlike the headline pick (one per card),
// several can apply to the same card, so each collects results faster. They are worked out from the saved model numbers, so
// nothing extra is stored. The rules were chosen after looking at games up to SINCE, so results from SINCE on are the fair test.
export const SINCE = '2026-10-24';
const side = p => { const i = p.indexOf(Math.max(...p)); return i === 0 ? 'H' : i === 2 ? 'A' : 'D'; };
export const STRATS = [
  { id: 'bttsY', name: 'Both score: Yes', rule: 'v2 says 65%+', key: 'B', pick: c => c.v2.btts >= 65 ? 'B' : null },
  { id: 'under', name: 'Under 2.5', rule: 'v2 gives Over 45% or less', key: 'U', pick: c => c.v2.over <= 45 ? 'U' : null },
  { id: 'over', name: 'Over 2.5', rule: 'v2 says 65%+', key: 'O', pick: c => c.v2.over >= 65 ? 'O' : null },
  { id: 'agree', name: 'Winner, all models agree', rule: 'v2, v4 and Forebet back the same side', key: 'W', pick: c => {
    const s = ['v2', 'v4', 'fb'].map(m => c[m] && Array.isArray(c[m].p) ? side(c[m].p) : null);
    return s.every(x => x === 'H' || x === 'A') && s[0] === s[1] && s[1] === s[2] ? s[0] : null; } },
  { id: 'home55', name: 'Home win', rule: 'v2 backs home at 55%+', key: 'H', pick: c => side(c.v2.p) === 'H' && c.v2.p[0] >= 55 ? 'H' : null },
  { id: 'bttsN', name: 'Both score: No', rule: 'v2 gives Yes 40% or less', key: 'N', pick: c => c.v2.btts <= 40 ? 'N' : null },
];
// Fold one finished card into the tracked-bet totals. S = { strats, base }.
export function addStrats(S, c, date, hitFn) {
  if (!c.final || !c.v2 || !Array.isArray(c.v2.p)) return;
  const f = c.final;
  S.base.n++; S.base.home += f.h > f.a ? 1 : 0; S.base.draw += f.h === f.a ? 1 : 0; S.base.away += f.h < f.a ? 1 : 0;
  S.base.over += f.h + f.a >= 3 ? 1 : 0; S.base.btts += f.h > 0 && f.a > 0 ? 1 : 0;
  for (const s of STRATS) {
    const key = s.pick(c); if (!key) continue;
    const t = S.strats[s.id] || (S.strats[s.id] = { id: s.id, name: s.name, rule: s.rule, live: { n: 0, hits: 0, ks: {} }, hist: { n: 0, hits: 0, ks: {} } });
    const b = date >= SINCE ? t.live : t.hist, hit = hitFn(key, f);
    b.n++; b.hits += hit ? 1 : 0; b.ks[key] = (b.ks[key] || 0) + 1;
  }
}
