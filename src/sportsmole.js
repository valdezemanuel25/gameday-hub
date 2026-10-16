// SportsMole "We say" predictions. No official feed: read the public preview list, match each of our
// fixtures to its preview article by team names, then read the "We say: Team 2-1 Team" heading.
// Everything here is best-effort: if SportsMole changes its pages or blocks the request, the card
// just has no SportsMole line (nothing else breaks).

const LIST_URL = 'https://www.sportsmole.co.uk/football/preview/';
const UA = { 'user-agent': 'Mozilla/5.0 (compatible; gameday-hub/1.0)' };

const ALIAS = [
  [/paris saint germain|paris sg/g, 'psg'],
  [/olympique/g, ' '],
  [/\bcologne\b/g, 'koln'], // ESPN says FC Cologne; Forebet and SportsMole say Köln
  [/\bein\b/g, 'eintracht'], // Forebet's short 'Ein Frankfurt'
  [/m gladbach|monchengladbach/g, 'gladbach'],
  [/stade rennais/g, 'rennes'],
  [/praha/g, 'prague'],
  [/creta/g, 'crete'],
  [/union saint gilloise|union st gilloise|union sg/g, 'unionsg'],
  [/manchester/g, 'man'],
  [/internazionale/g, 'inter'],
  [/united/g, 'utd'],
  [/wolverhampton wanderers|wolverhampton/g, 'wolves'],
  [/sheffield/g, 'sheff'],
  [/\b(fc|cf|ac|as|ssc|sc|afc|cd|ud|sv|vfb|vfl|fk|ca|club|real|sporting|rc|rb|1 fc|tsg|tsv|fsv|bsc|sk|ks|gnk|nk|hnk|ofk|sl|nec|uniao)\b/g, ' '],
];
export function norm(s) {
  let x = String(s).toLowerCase().replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/å/g, 'a').replace(/ł/g, 'l').replace(/đ/g, 'd').replace(/ß/g, 'ss').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  for (const [re, to] of ALIAS) x = x.replace(re, to);
  return x.replace(/\s+/g, '');
}
// Same words in a different order: "UNAM Pumas" and "Pumas UNAM".
export const words = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w && !['fc', 'cf', 'club', 'de', 'cd', 'ac', 'sc'].includes(w)).sort().join('');
export function sameTeam(a, b) {
  if (!a || !b) return false;
  const [sh, lg] = a.length <= b.length ? [a, b] : [b, a];
  return sh.length >= 3 && lg.startsWith(sh); // 'psv' ~ 'psveindhoven', 'bayern' ~ 'bayernmunich'
}

// Preview links look like .../preview/arsenal-vs-lille-prediction-team-news-lineups_606658.html
export function parseListing(html) {
  const out = [], seen = new Set();
  const re = /href=["']([^"']*\/preview\/([a-z0-9-]+?)-vs-([a-z0-9-]+?)-prediction[^"']*?_(\d+)\.html)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    if (seen.has(m[4])) continue; seen.add(m[4]);
    const url = m[1].startsWith('http') ? m[1] : 'https://www.sportsmole.co.uk' + m[1];
    out.push({ id: m[4], url, a: norm(m[2].replace(/-/g, ' ')), b: norm(m[3].replace(/-/g, ' ')) });
  }
  return out;
}

export function matchLink(home, away, links) {
  const h = norm(home), a = norm(away);
  return links.find(l => sameTeam(h, l.a) && sameTeam(a, l.b)) || null;
}

// "We say: Arsenal 2-0 Lille"  ->  { h: 2, a: 0, text: 'Arsenal 2–0 Lille' }
export function parseWeSay(html) {
  const i = html.indexOf('We say:');
  if (i < 0) return null;
  const end = html.indexOf('<', i + 7);
  const txt = html.slice(i + 7, end > 0 && end < i + 120 ? end : i + 100).replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
  const m = /^(.+?)\s+(\d+)\s*[-–]\s*(\d+)\s+(.+?)$/.exec(txt);
  if (!m) return null;
  const h = +m[2], a = +m[3];
  if (h > 12 || a > 12) return null;
  return { h, a, text: `${m[1].trim()} ${h}–${a} ${m[4].trim()}` };
}

export async function fetchText(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

// SportsMole's list only shows UPCOMING games (a preview disappears once the game starts), so every
// link seen is kept for 14 days. Cached 60 min; the cron refreshes it even when no card needs it.
export async function getListing(env, now = Date.now()) {
  const c = await env.HUB.get('sm:list', 'json');
  if (c && now - c.at < 60 * 60000) return c.links;
  const fresh = parseListing(await fetchText(LIST_URL));
  const seen = new Map(((await env.HUB.get('sm:seen', 'json')) || []).filter(l => now - l.at < 14 * 86400000).map(l => [l.id, l]));
  for (const l of fresh) seen.set(l.id, { ...l, at: seen.get(l.id)?.at ?? now });
  const links = [...seen.values()].slice(-500);
  if (fresh.length) await env.HUB.put('sm:seen', JSON.stringify(links));
  await env.HUB.put('sm:list', JSON.stringify({ at: now, links }));
  return links;
}

// Same hit rules as the Hub's tracker: outcome, exact score, over/under 2.5, both teams to score.
export function smGrade(sm, final) {
  const o = (h, a) => (h > a ? 'H' : h === a ? 'D' : 'A');
  return {
    outcomeHit: o(sm.h, sm.a) === o(final.h, final.a),
    scoreHit: sm.h === final.h && sm.a === final.a,
    ouHit: (sm.h + sm.a >= 3) === (final.h + final.a >= 3),
    bttsHit: (sm.h > 0 && sm.a > 0) === (final.h > 0 && final.a > 0),
  };
}
