// "Verify and assign": when a Forebet table or a SportsMole preview list could not be matched to a card by team names,
// the leftover games are kept (meta:unm) as suggestions. You check the pair and assign it to the card, so nothing has to be
// fetched again. Suggestions are only saved when they change (KV writes are limited on the free plan).
import { norm, sameTeam, words } from './sportsmole.js';

export const getUnm = async env => (await env.HUB.get('meta:unm', 'json')) || { items: [] };
export async function saveUnm(env, unm, before, today) {
  unm.items = unm.items.filter(i => i.date >= today).slice(-300);
  const s = JSON.stringify(unm);
  if (s !== before) await env.HUB.put('meta:unm', s);
}
const loose = (a, b) => sameTeam(a, b) || (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a)));
// 2 = both clubs look alike, 1 = one club does, 0 = neither
export const likeness = (card, home, away) => {
  const h = norm(card.home), a = norm(card.away), x = norm(home), y = norm(away);
  const w = words(card.home), v = words(card.away), hs = loose(h, x) || loose(h, y) || w === words(home) || w === words(away), as = loose(a, x) || loose(a, y) || v === words(home) || v === words(away);
  return (hs ? 1 : 0) + (as ? 1 : 0);
};
export const slugTitle = url => {
  const m = /\/preview\/([a-z0-9-]+?)-vs-([a-z0-9-]+?)-prediction/i.exec(url);
  const t = s => s.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
  return m ? { home: t(m[1]), away: t(m[2]) } : null;
};
