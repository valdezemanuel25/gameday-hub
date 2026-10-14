// SportsMole "We say" predictions. No official feed: read the public preview list, match each of our
// fixtures to its preview article by team names, then read the "We say: Team 2-1 Team" heading.
// Everything here is best-effort: if SportsMole changes its pages or blocks the request, the card
// just has no SportsMole line (nothing else breaks).

const LIST_URL = 'https://www.sportsmole.co.uk/football/preview/';
const UA = { 'user-agent': 'Mozilla/5.0 (compatible; gameday-hub/1.0)' };

const ALIAS = [
  [/paris saint germain|paris sg/g, 'psg'],
  [/manchester/g, 'man'],
  [/internazionale/g, 'inter'],
  [/united/g, 'utd'],
  [/wolverhampton wanderers|wolverhampton/g, 'wolves'],
  [/sheffield/g, 'sheff'],
  [/\b(fc|cf|ac|as|ssc|sc|afc|cd|ud|sv|vfb|vfl|fk|ca|club|real|sporting|rc|rb|1 fc)\b/g, ' '],
];
export function norm(s) {
  let x = String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ');
  for (const [re, to] of ALIAS) x = x.replace(re, to);
  return x.replace(/\s+/g, '');
}
function sameTeam(a, b) {
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

export async function getListing(env, now = Date.now()) {
  const c = await env.HUB.get('sm:list', 'json');
  if (c && now - c.at < 20 * 60000) return c.links;
  const links = parseListing(await fetchText(LIST_URL));
  if (links.length) await env.HUB.put('sm:list', JSON.stringify({ at: now, links }));
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
