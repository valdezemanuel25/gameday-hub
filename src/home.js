// Home screen summary: one small read of today's saved cards and Brew issues for the carousel cards.
// Display only. It reuses the same Best pick rules as the phone alerts (push.js) so the two always agree,
// and it never writes anything or feeds a model.
import { soccerAlert, hockeyAlert } from './push.js';

const upcoming = (c, now) => !c.final && !c.skipped && c.kickoff && new Date(c.kickoff).getTime() > now;

function sport(cards, alertFn, now) {
  const list = (cards || []).filter(c => c && !c.skipped);
  const left = list.filter(c => upcoming(c, now)).sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
  const best = left.filter(c => alertFn(c));
  const next = left[0] || null;
  return {
    games: list.length,
    left: left.length,
    best: best.length, // Best picks that haven't started yet
    next: next ? { ko: next.ko || null, kickoff: next.kickoff } : null,
    nextBest: best[0] ? { ko: best[0].ko || null, kickoff: best[0].kickoff, title: alertFn(best[0]).title } : null,
  };
}

export function homeSummary({ soccer, hockey, brew, today, now = Date.now() }) {
  const issues = (brew || []).filter(i => i && i.date === today);
  const lead = issues.find(i => i.source === 'Brew Markets') || issues[0] || null;
  const mk = l => { const m = lead && (lead.markets || []).find(x => x.label === l); return m && Number.isFinite(m.change) ? m.change : null; };
  const s = sport(soccer, soccerAlert, now), n = sport(hockey, hockeyAlert, now);
  return {
    today,
    soccer: { ...s, attention: s.best > 0 },
    nhl: { ...n, attention: n.best > 0 },
    brew: { count: issues.length, title: lead ? lead.title : null, sp: mk('S&P 500'), nasdaq: mk('Nasdaq'), attention: false }, // a brief lands every day, so it never glows
  };
}
