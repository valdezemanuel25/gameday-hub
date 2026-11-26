// The Data Keeper's record, meta:keeper, and what the Status tabs and the health report show from it. Kept apart from src/keeper.js
// (which calls the reads in src/jobs.js) so the health report and the status routes can read it without loading the reads.
//   meta:keeper = { log: [...last LOG_MAX, newest first], wait: { "<check>|<date>|<id>": { tries, next?, why, gaveUp?, skip?, ... } },
//                   blocks: { forebet: <until> }, sent: { "<problem>|<date>|<id>": <ms> } }
//   a log entry: { at, sport, date, league, game, check, action, result }, result: filled | still missing | gave up: <why> | skipped: <why>
export const KEEPER_KEY = 'meta:keeper';
export const LOG_MAX = 100;
const DAY = 86400000;

const freshState = () => ({ log: [], wait: {}, blocks: {}, sent: {} });
export async function readKeeper(env) {
  try {
    const s = await env.HUB.get(KEEPER_KEY, 'json');
    return s && typeof s === 'object' ? { log: Array.isArray(s.log) ? s.log : [], wait: s.wait || {}, blocks: s.blocks || {}, sent: s.sent || {} } : freshState();
  } catch (e) { return freshState(); }
}

const kind = r => (/^gave up/.test(r) ? 'gaveUp' : r === 'filled' ? 'filled' : r === 'still missing' ? 'stillMissing' : /^skipped/.test(r) ? 'skipped' : null);
// Every give-up still on the record (games of the last few days), newest first: [{ sport, date, league, game, check, why, at }].
export const giveUps = st => Object.entries(st.wait || {}).filter(([, w]) => w && w.gaveUp)
  .map(([k, w]) => { const [check, date] = k.split('|'); return { sport: w.sport || null, date, league: w.league || null, game: w.game || null, check: w.check || check, why: w.why || null, at: w.at || null }; })
  .sort((a, b) => String(b.at).localeCompare(String(a.at)));
// For the Status tabs: the last `n` actions and every give-up, of one sport (or both), and the forebet block if one is running.
export function keeperStatus(st, now = Date.now(), sport = null, n = 10) {
  const of = x => !sport || x.sport === sport;
  const until = st.blocks && st.blocks.forebet && Date.parse(st.blocks.forebet) > now ? st.blocks.forebet : null;
  return { last: (st.log || []).filter(of).slice(0, n), gaveUp: giveUps(st).filter(of), forebetBlockedUntil: until };
}
// For the health report (the nightly sweep reads it): counts of the last 24 hours and the give-up list.
export function keeperHealth(st, now = Date.now()) {
  const day = { filled: 0, stillMissing: 0, gaveUp: 0, skipped: 0 };
  for (const x of st.log || []) { if (now - Date.parse(x.at) > DAY) continue; const k = kind(x.result); if (k) day[k]++; }
  const until = st.blocks && st.blocks.forebet && Date.parse(st.blocks.forebet) > now ? st.blocks.forebet : null;
  return { last24h: day, gaveUp: giveUps(st), forebetBlockedUntil: until, lastAction: (st.log || [])[0] || null };
}
