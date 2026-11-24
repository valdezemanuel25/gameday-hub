import { localDate } from './data.js';
import { pushStep } from './push.js';
import { partDue } from './sweepdata.js';
import { nhlLineupStep } from './nhl.js';
import { withFixes } from './fixes.js';
import { errEntry, answerErrors, saveErrors } from './errlog.js';
import { WRITE_LIMIT, counted, writesToday, budget, ask } from './store.js';
import { SAVER_AT, SLOT_COST, SWEEP_COST, oddsStep, runSlot, sweepData } from './jobs.js';
import { LOCAL_HOST, handle, json, pendingCookies, withCookies, withSecurity } from './routes.js';
// The Worker: requests go to the routes (src/routes.js), the cron to the background job (src/jobs.js). Everything the tests import from
// this file is re-exported here.
export { keepSaved, getDay, listDays, withFixes } from './fixes.js';
export { counted, writeKind, writesToday } from './store.js';
export * from './jobs.js';
export * from './routes.js';

const hub = {
  async fetch(req, env0, ctx) {
    // The password must never travel unencrypted: plain http is sent to https before anything else happens (local runs excepted).
    const u = new URL(req.url);
    if (u.protocol === 'http:' && !LOCAL_HOST.test(u.hostname) && !u.hostname.endsWith('.localhost')) {
      u.protocol = 'https:';
      return withSecurity(new Response(null, { status: 301, headers: { location: u.toString(), 'cache-control': 'no-store' } }));
    }
    // Every request is a button's (or a page's): its saves to a day or to the Analyst's record become side patches (src/fixes.js).
    const c = counted(env0), env = withFixes(c.env, { button: true });
    try { const r = await handle(req, env); return withSecurity(withCookies(r, pendingCookies.get(req))); }
    catch (e) {
      // A route with no catch of its own (a storage hiccup, say) answers in the Hub's own words instead of Cloudflare's error page.
      console.error('unhandled', u.pathname, e && e.stack || e);
      return withSecurity(json({ error: 'Something went wrong. Try again.' }, 500));
    }
    finally {
      // The write counter is bookkeeping: when the platform can finish it after the answer is sent, the visitor does not wait for it.
      const f = c.flush();
      if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(f); else await f;
    }
  },
  handle, // src/routes.js

  async scheduled(event, env0, ctx) {
    const c = counted(env0), env = withFixes(c.env); // the cron reads days with the buttons' patches laid on, and its saves carry them in
    env.BUDGET = budget(); // the run's outside calls (src/store.js): each step asks before it fetches
    // errs: the errors this run caught and carried on past, saved in one write at the end (src/errlog.js)
    const errs = [], note = (job, e) => errs.push(errEntry(job, e)), noteAnswer = (job, r) => errs.push(...answerErrors(job, r));
    ctx.waitUntil((async () => {
      try { env.SAVER = (await writesToday(env0.HUB)).used >= SAVER_AT * WRITE_LIMIT; } catch (e) { /* unknown: run as normal */ }
      // The closing reads go first: they are cheap and only have a few minutes, and a run cut short by the free plan's CPU limit
      // (a heavy soccer job) used to drop them. The rotating job runs after.
      try { noteAnswer('nhl lineup', await nhlLineupStep(env)); } catch (e) { note('nhl lineup', e); /* retried in 5 minutes */ }
      try { noteAnswer('odds', await oddsStep(env)); } catch (e) { note('odds', e); /* prices are a bonus; never allowed to break the background job */ }
      // The sweep's stats file, when one is due (three runs a night, src/sweepdata.js), takes this run's turn in place of the rotating
      // job, so the run stays inside the free plan's CPU limit. Nothing due, not set up, or the file is already saved (nothing was built): the
      // rotating job runs as always.
      // Which job and which stats file are this run's turn comes from the time the run was scheduled, so steps that ran long before
      // (slow feeds) cannot move the run into the next 5-minute turn. The jobs themselves compare kickoffs with the time now.
      const at = Number.isFinite(event && event.scheduledTime) ? event.scheduledTime : Date.now();
      // A stats file due costs two calls to GitHub (src/sweepdata.js): with too few left it waits for the next run of its window.
      const sweepDue = env.SWEEP_GH_TOKEN && env.SWEEP_REPO && partDue(new Date(at));
      let sw = null; try { if (!sweepDue || ask(env, SWEEP_COST)) sw = await sweepData(env, new Date(at)); } catch (e) { note('stats files', e); /* never allowed to break the background job */ }
      // The rotating job runs on SLOT_COST calls set aside for it; the steps in it that fetch per item (the early-payout lead) ask that share.
      const run = env.BUDGET;
      try { if (!(sw && sw.built)) { env.BUDGET = run.child(SLOT_COST); noteAnswer('slot', await runSlot(env, new Date(), Math.floor(at / 300000) % 4)); } }
      catch (e) { note('slot', e); throw e; }
      finally {
        env.BUDGET = run; // the alerts use what is left
        // Alerts for games about to start. Never allowed to break the background job.
        try { const now = new Date(), a = localDate(now.toISOString()), b = localDate(new Date(now.getTime() + 45 * 60000).toISOString()); await pushStep(env, now.getTime(), a === b ? [a] : [a, b]); } catch (e) { note('alerts', e); /* retried in 5 minutes */ }
        try { await saveErrors(env.HUB, errs); } catch (e) { /* the log is bookkeeping */ }
        await c.flush();
      }
    })());
  },
};
export default hub;
