// bet365 early payout: a moneyline (home or away win) bet is paid as a win once that team leads by EARLY points at any moment of the
// game, whatever the final score. Soccer: 2 goals ahead. NHL: 3 goals ahead (the shootout does not count). Tracked next to the normal
// record, never instead of it. Pure functions, no I/O.
export const EARLY = { soccer: 2, nhl: 3 };

// The goals in the order they were scored, as 'h' / 'a', from ESPN's list of scoring plays; null when it cannot be trusted.
// plays: [{ team: id, own: bool, so: bool }] in game order. Own goals are credited to the team that benefits: ESPN's feeds differ on
// which team they name, so both readings are tried and only one that adds up to the final score (fh, fa without the shootout) is kept.
export function goalSeq(plays, hId, aId, fh, fa) {
  if (!Array.isArray(plays) || fh == null || fa == null) return null;
  const real = plays.filter(p => p && !p.so);
  for (const flip of [false, true]) {
    const seq = [];
    for (const p of real) {
      const side = String(p.team) === String(hId) ? 'h' : String(p.team) === String(aId) ? 'a' : null; if (!side) { seq.length = 0; seq.push(null); break; }
      seq.push(p.own && flip ? (side === 'h' ? 'a' : 'h') : side);
    }
    if (seq.includes(null)) return null;
    if (seq.filter(s => s === 'h').length === fh && seq.filter(s => s === 'a').length === fa) return seq;
  }
  return null;
}
// [the biggest home lead, the biggest away lead] at any moment, from a goal sequence.
export function maxLead(seq) {
  if (!seq) return null;
  let d = 0, h = 0, a = 0;
  for (const s of seq) { d += s === 'h' ? 1 : -1; h = Math.max(h, d); a = Math.max(a, -d); }
  return [h, a];
}
// Did a home ('H') or away ('A') win pick pay under early payout? true / false, or null when the pick is not a moneyline or the leads
// are not known (also for a pick that won outright, so the early-payout record only counts games whose goal order is known).
export function earlyPaid(key, hit, lead, sport = 'soccer') {
  if (key !== 'H' && key !== 'A') return null;
  if (!lead) return null;
  if (hit) return true;
  return lead[key === 'H' ? 0 : 1] >= EARLY[sport];
}
