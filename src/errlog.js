// The background job's own errors: the last ERR_MAX errors the cron caught and carried on past ({ at, job, msg }), newest last, in one
// KV record. A cron run collects its errors and saves them in ONE write at its end, and only when it had any, so a quiet day costs no
// write. Shown on the Status tab (/api/status jobErrors) and in the health report Sweep reads (/api/health jobErrors).
export const ERR_KEY = 'meta:joberrors';
export const ERR_MAX = 20;

// One caught error as kept: the job's name and the message, cut short (never a stack, never a request).
export const errEntry = (job, e, now = new Date()) => ({ at: now.toISOString(), job: String(job || 'cron').slice(0, 40), msg: String((e && e.message) || e || 'unknown error').slice(0, 160) });

// The errors a job's answer reports in its own words ({ error }, and the burst's `also` list): the jobs catch their own errors and
// answer with them, so they are only seen here.
export function answerErrors(job, r, now = new Date()) {
  const out = [];
  for (const x of r ? [r, ...(Array.isArray(r.also) ? r.also : [])] : []) if (x && x.error) out.push(errEntry(x.job || job, x.league ? `${x.league}: ${x.error}` : x.error, now));
  return out;
}

export async function readErrors(hub) {
  try { const v = await hub.get(ERR_KEY, 'json'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}
// Adds a run's errors to the record (one write); nothing to add, nothing written. An error the record already holds from the last
// ERR_QUIET_MS (same job, same message) is not added again, so a feed that is down all day costs about one write an hour, not one a run.
export const ERR_QUIET_MS = 3600000;
export async function saveErrors(hub, list, now = Date.now()) {
  if (!list || !list.length) return false;
  const old = await readErrors(hub), recent = new Set(old.filter(x => now - Date.parse(x.at) < ERR_QUIET_MS).map(x => `${x.job}|${x.msg}`));
  const add = [];
  for (const x of list) { const k = `${x.job}|${x.msg}`; if (!recent.has(k)) { recent.add(k); add.push(x); } }
  if (!add.length) return false;
  await hub.put(ERR_KEY, JSON.stringify(old.concat(add).slice(-ERR_MAX)));
  return true;
}
