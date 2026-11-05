// Sweep, the night janitor: the nightly sweep's mascot (the scheduled task that checks the Hub at 12:37 AM Central and reports).
// His shift starts at 10 PM Central. Until the sweep has run (12:45 AM) he works; after that he waits with the night's report (from the
// Hub's read-only health report, /api/health, the same one the sweep reads) and stays on every page, through the day, until you tap him
// and close the report with "Got it". Then he is gone until the next shift at 10 PM. That one fact (which night's report you closed) is
// kept in this browser only; with storage blocked he comes back on the next page load. Display only otherwise: reads, never saves.
// Add ?sweep=1 to the address to see him even after closing (and ?sweep=clear / ?sweep=issue to see a mood).
(function () {
  var q = (location.search.match(/[?&]sweep=(\w+)/) || [])[1], force = !!q, el = null, tip = null, panel = null, mood = null, note = '', H = null, closedHere = null;
  var parts = function () { var p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date()), g = function (t) { return (p.find(function (x) { return x.type === t; }) || {}).value; }; return { d: g('year') + '-' + g('month') + '-' + g('day'), m: +g('hour') * 60 + +g('minute') }; };
  var addDays = function (d, n) { return new Date(new Date(d + 'T12:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10); };
  // the shift a moment belongs to: from 10 PM on day D until 10 PM on D+1 it is "night D"
  var shift = function () { var x = parts(); return x.m >= 22 * 60 ? x.d : addDays(x.d, -1); };
  var swept = function () { var m = parts().m; return !(m >= 22 * 60 || m < 45); }; // the sweep runs at 12:37 AM; its report is ready from 12:45
  var KEY = 'sweepClosed';
  var closed = function () { if (force) return false; try { return localStorage.getItem(KEY) === shift(); } catch (e) { return closedHere === shift(); } };
  var close = function () { closedHere = shift(); try { localStorage.setItem(KEY, shift()); } catch (e) { /* this page load only */ } };
  var esc = function (t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  function svg(state) {
    var issue = state === 'issue', ant = issue ? '#FF4D57' : '#DBFF4F', hi = issue ? '#FFD0D3' : '#F4FFC2', halo = issue ? '#FF4D57' : '#C8FF2E';
    var eyes = state === 'clear' ? '<path d="M78 103 q6 -9 12 0 M110 103 q6 -9 12 0" stroke="#DBFF4F" stroke-width="4.5" fill="none" stroke-linecap="round"/>'
      : '<g class="eyes"><g class="look"><circle cx="84" cy="101" r="7.5" fill="#DBFF4F"/><circle cx="116" cy="101" r="7.5" fill="#DBFF4F"/></g></g>';
    var mouth = state === 'clear' ? '<path d="M84 134 Q100 148 116 134" stroke="#C8FF2E" stroke-width="4" fill="none" stroke-linecap="round"/>'
      : issue ? '<ellipse cx="100" cy="138" rx="6" ry="5" fill="none" stroke="#FF4D57" stroke-width="3.5"/>'
      : '<path d="M87 136 Q100 145 113 136" stroke="#C8FF2E" stroke-width="3.5" fill="none" stroke-linecap="round"/>';
    var arm = state === 'work' ? '<path d="M150 112 Q166 106 166 92" stroke="#4a5145" stroke-width="9" fill="none" stroke-linecap="round"/><circle cx="166" cy="88" r="7" fill="#4a5145"/>'
      : state === 'clear' ? '<g class="wave"><path d="M150 112 Q170 104 172 82" stroke="#4a5145" stroke-width="9" fill="none" stroke-linecap="round"/><circle cx="172" cy="78" r="7" fill="#4a5145"/></g>'
      : '<path d="M150 112 Q164 116 168 130" stroke="#4a5145" stroke-width="9" fill="none" stroke-linecap="round"/><circle cx="168" cy="134" r="7" fill="#4a5145"/>';
    var broom = state !== 'work' ? '' : '<g class="broom"><line x1="166" y1="86" x2="150" y2="176" stroke="#E0A662" stroke-width="6" stroke-linecap="round"/><path d="M134 168 L166 174 L162 194 L126 188 Z" fill="#E0A662"/><path d="M130 184 L163 190 M131 178 L164 184" stroke="#8a6436" stroke-width="1.6"/></g>';
    var dust = state !== 'work' ? '' : '<g class="dust" fill="#C8FF2E"><circle cx="126" cy="190" r="3"/><circle cx="134" cy="192" r="2.2"/><circle cx="118" cy="193" r="2.6"/><circle cx="140" cy="188" r="1.8"/></g>';
    var pop = state === 'clear' ? '<g class="pop"><circle cx="150" cy="40" r="15" fill="#C8FF2E"/><path d="M143 40 l5 5 l9 -10" stroke="#0b0d0b" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>'
      : issue ? '<g class="pop"><circle cx="150" cy="40" r="15" fill="#FF4D57"/><rect x="148" y="30" width="4" height="12" rx="2" fill="#fff"/><circle cx="150" cy="47" r="2.4" fill="#fff"/></g>' : '';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 210" class="sw ' + state + '"><defs>'
      + '<radialGradient id="swb" cx="42%" cy="32%" r="68%"><stop offset="0" stop-color="#3a4034"/><stop offset=".6" stop-color="#1a1d17"/><stop offset="1" stop-color="#0e100c"/></radialGradient>'
      + '<radialGradient id="swh"><stop offset="0" stop-color="' + hi + '" stop-opacity=".95"/><stop offset=".35" stop-color="' + halo + '" stop-opacity=".55"/><stop offset="1" stop-color="' + halo + '" stop-opacity="0"/></radialGradient>'
      + '<filter id="swg" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.4" result="x"/><feMerge><feMergeNode in="x"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'
      + '<linearGradient id="swv" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#18200f"/><stop offset="1" stop-color="#040503"/></linearGradient></defs>'
      + '<ellipse class="shadow" cx="100" cy="196" rx="44" ry="6" fill="#000" opacity=".55"/><g class="float">'
      + '<line x1="100" y1="36" x2="100" y2="54" stroke="#9aa093" stroke-width="4" stroke-linecap="round"/>'
      + '<circle class="halo" cx="100" cy="27" r="18" fill="url(#swh)"/><circle class="ant" cx="100" cy="27" r="8.5" fill="' + ant + '" stroke="' + hi + '" stroke-width="2" filter="url(#swg)"/><circle cx="97.4" cy="24.4" r="2.4" fill="#fff"/>'
      + '<circle cx="100" cy="108" r="58" fill="url(#swb)" stroke="#4f5649" stroke-width="3"/><path d="M62 78 Q74 58 100 54" stroke="#fff" stroke-opacity=".08" stroke-width="6" fill="none" stroke-linecap="round"/>'
      + '<rect x="44" y="92" width="10" height="20" rx="4" fill="#C8FF2E" filter="url(#swg)"/><rect x="146" y="92" width="10" height="20" rx="4" fill="#C8FF2E" filter="url(#swg)"/>'
      + '<rect x="58" y="82" width="84" height="38" rx="19" fill="url(#swv)" stroke="#D8FF55" stroke-width="3.5" filter="url(#swg)"/><path d="M68 89 h40" stroke="#fff" stroke-opacity=".18" stroke-width="3" stroke-linecap="round"/>'
      + '<g filter="url(#swg)">' + eyes + '</g>' + mouth + arm + broom + '</g>' + dust + pop + '</svg>';
  }
  var css = '#sweep{position:fixed;left:max(10px,env(safe-area-inset-left,0px));z-index:900;width:60px;height:63px;padding:0;border:0;background:none;cursor:pointer;-webkit-tap-highlight-color:transparent;filter:drop-shadow(0 4px 10px rgba(0,0,0,.6));transition:opacity .4s,transform .4s}'
    + '#sweep svg{width:100%;height:100%;display:block;overflow:visible}#sweep.in{opacity:1;transform:none}#sweep.out{opacity:0;transform:translateY(12px)}'
    + '#sweep-tip{position:fixed;left:max(10px,env(safe-area-inset-left,0px));z-index:901;max-width:min(270px,calc(100vw - 32px));background:#0d100b;color:#e8eee0;border:1px solid rgba(200,255,46,.45);border-radius:14px;padding:10px 12px;font:500 13px/1.4 "DM Sans",system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.6)}'
    + '#sweep-tip.issue{border-color:rgba(255,77,87,.6)}#sweep-tip b{color:#C8FF2E}#sweep-tip.issue b{color:#FF4D57}'
    + '.sw .float{animation:swf 3s ease-in-out infinite}.sw .shadow{animation:sws 3s ease-in-out infinite;transform-origin:100px 196px}'
    + '.sw .ant{animation:swp 1.6s ease-in-out infinite;transform-origin:100px 27px}.sw .halo{animation:swh 1.6s ease-in-out infinite;transform-origin:100px 27px}'
    + '.sw .eyes{animation:swk 4.6s infinite;transform-origin:100px 101px}.sw .look{animation:swl 7s ease-in-out infinite}'
    + '.sw .broom{animation:swr 1.3s ease-in-out infinite;transform-origin:166px 88px}.sw .dust circle{animation:swd 1.3s ease-out infinite;opacity:0}'
    + '.sw .dust circle:nth-child(2){animation-delay:.2s}.sw .dust circle:nth-child(3){animation-delay:.45s}.sw .dust circle:nth-child(4){animation-delay:.7s}'
    + '.sw .pop{animation:swo 2.4s ease-in-out infinite;transform-origin:150px 40px}.sw .wave{animation:sww .9s ease-in-out infinite;transform-origin:152px 110px}'
    + '.sw.issue .ant{animation:swa .7s steps(2) infinite}.sw.issue .halo{animation:swh .7s ease-in-out infinite}'
    + '@keyframes swf{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}@keyframes sws{0%,100%{transform:scaleX(1);opacity:.55}50%{transform:scaleX(.86);opacity:.35}}'
    + '@keyframes swp{0%,100%{transform:scale(1)}50%{transform:scale(1.18)}}@keyframes swh{0%,100%{opacity:.7;transform:scale(1)}50%{opacity:1;transform:scale(1.4)}}@keyframes swa{0%{opacity:1}100%{opacity:.35}}'
    + '@keyframes swk{0%,46%,52%,100%{transform:scaleY(1)}49%{transform:scaleY(.08)}}@keyframes swl{0%,30%,100%{transform:translateX(0)}38%,48%{transform:translateX(-6px)}58%,68%{transform:translateX(6px)}76%{transform:translateX(0)}}'
    + '@keyframes swr{0%,100%{transform:rotate(-13deg)}50%{transform:rotate(15deg)}}@keyframes swd{0%{opacity:0;transform:translate(0,0)}20%{opacity:.85}100%{opacity:0;transform:translate(-30px,-16px)}}'
    + '@keyframes swo{0%,100%{transform:scale(.9) translateY(0)}50%{transform:scale(1.08) translateY(-4px)}}@keyframes sww{0%,100%{transform:rotate(0)}50%{transform:rotate(-16deg)}}'
    + '@media (prefers-reduced-motion:reduce){.sw *{animation:none!important}}';

  var PANEL_CSS = '#sweep.away{opacity:0;transform:translate(-30px,10px) rotate(-12deg)}'
    + '#sweep-panel{position:fixed;left:max(10px,env(safe-area-inset-left,0px));z-index:902;width:min(340px,calc(100vw - 20px));max-height:min(70vh,560px);overflow:auto;background:#0b0e09;color:#e8eee0;border:1px solid rgba(200,255,46,.45);border-radius:16px;padding:12px 14px 14px;font:500 13px/1.45 "DM Sans",system-ui,sans-serif;box-shadow:0 12px 32px rgba(0,0,0,.7)}'
    + '#sweep-panel .sr-h{display:flex;align-items:center;gap:10px;margin-bottom:6px}#sweep-panel .sr-h b{display:block;font-size:15px}#sweep-panel .sr-h small{color:#9aa093;font-size:11.5px}'
    + '#sweep-panel .sr-s{margin:6px 0}#sweep-panel .sr-s b{color:#C8FF2E}#sweep-panel .sr-s.issue b{color:#FF4D57}'
    + '#sweep-panel ul{margin:2px 0 6px;padding-left:18px}#sweep-panel li{margin:2px 0}'
    + '#sweep-panel h4{margin:10px 0 4px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#9aa093}#sweep-panel p{margin:2px 0}'
    + '#sweep-panel table{width:100%;border-collapse:collapse;font-size:12px}#sweep-panel th{color:#9aa093;font-weight:500;text-align:right;padding:2px 4px}#sweep-panel td{padding:3px 4px;border-top:1px solid #20251c;text-align:right}'
    + '#sweep-panel td:first-child{text-align:left}#sweep-panel td i{font-style:normal;color:#FF4D57;font-size:10.5px}#sweep-panel td.up{color:#C8FF2E}#sweep-panel td.dn{color:#FF4D57}#sweep-panel td.sp{text-align:left;color:#9aa093;font-size:11px;padding-top:8px}'
    + '#sweep-panel .sr-n{color:#9aa093;font-size:11.5px;margin-top:10px}#sweep-panel .sr-ok{position:sticky;bottom:0;box-shadow:0 -10px 14px #0b0e09;margin-top:10px;width:100%;padding:10px;border-radius:12px;border:0;background:#C8FF2E;color:#0b0d0b;font:700 13px "DM Sans",system-ui,sans-serif;cursor:pointer}';
  // What the health report says, in a line: the same things the sweep flags from live data
  function readHealth(h) {
    var out = [], n = function (a) { return (a && a.length) || 0; };
    var ug = n(h.soccer && h.soccer.ungraded) + n(h.nhl && h.nhl.ungraded), up = n(h.soccer && h.soccer.unpriced) + n(h.nhl && h.nhl.unpriced);
    var nc = n(h.analyst && h.analyst.noClose), st = n(h.analyst && h.analyst.stale), sp = Object.keys(h.syncProblems || {}).length;
    if (ug) out.push(ug + ' game' + (ug > 1 ? 's' : '') + ' with no result yet');
    if (up) out.push(up + ' upcoming game' + (up > 1 ? 's' : '') + ' with no price');
    var si = n(h.soccer && h.soccer.standIn);
    if (si) out.push(si + ' upcoming game' + (si > 1 ? 's' : '') + ' priced from ' + (h.soccer.standIn[0].book === 'bet365' ? 'Bet365' : h.soccer.standIn[0].book) + ', not DraftKings (the Analyst sits ' + (si > 1 ? 'them' : 'it') + ' out)');
    if (nc) out.push(nc + ' Analyst bet' + (nc > 1 ? 's' : '') + ' missing a closing price');
    if (st) out.push(st + ' Analyst bet' + (st > 1 ? 's' : '') + ' open 2+ days');
    if (sp) out.push('a sync problem in ' + Object.keys(h.syncProblems).join(', '));
    if (h.writes && h.writes.limit && h.writes.used > 0.7 * h.writes.limit) out.push('storage writes at ' + h.writes.used + ' of ' + h.writes.limit);
    // low only when the backup key (ODDS_API_KEY_2) cannot take over either; an unread backup counts as unknown, not low
    var c1 = h.oddsApiCredits && h.oddsApiCredits.left, c2 = h.oddsApiCredits2 && h.oddsApiCredits2.left, low = function (x) { return x != null && x < 50; };
    if (low(c1) && (h.oddsApiCredits2 === undefined || h.oddsApiCredits2 === null || low(c2))) out.push('Odds API credits low (' + c1 + ' left' + (c2 != null ? ', backup ' + c2 : '') + ')');
    return out;
  }
  function setMood(m, text) {
    mood = m; note = text;
    if (el) el.innerHTML = svg(m);
    if (tip) { tip.className = m === 'issue' ? 'issue' : ''; tip.innerHTML = note; }
  }
  function decide() {
    if (q === 'clear' || q === 'issue') { H = null; return setMood(q, ''); }
    if (!swept()) return setMood('work', '<b>Sweep</b> on the night shift. I check the whole Hub at 12:37 AM: tests, the build, prices, grading and the Analyst. Tap me after that for my report.');
    fetch('/api/health', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (h) {
      H = h; if (!h) return setMood('work', '');
      setMood(readHealth(h).length ? 'issue' : 'clear', '');
    }).catch(function () { H = null; setMood('work', ''); });
  }
  // The day report: what he sees in the Hub's data, the Analyst's record, and the day's saves. Tests and the build are in the Notion report.
  function report() {
    var f = H ? readHealth(H) : (q === 'issue' ? ['an example problem (preview)'] : []), when = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date());
    var rows = function (list, sport) { return (list || []).filter(function (r) { return !r.retired; }).map(function (r) {
      return '<tr><td>' + (r.set ? r.set + '· ' : '') + esc(r.name.split(':')[0]) + (r.benched ? ' <i>benched</i>' : '') + '</td><td>' + r.settled + '</td><td class="' + (r.units > 0 ? 'up' : r.units < 0 ? 'dn' : '') + '">' + (r.units > 0 ? '+' : '') + r.units.toFixed(2) + 'u</td><td>' + (r.clv == null ? '–' : (r.clv > 0 ? '+' : '') + r.clv + '%') + '</td></tr>'; }).join(''); };
    var an = H && H.analyst ? '<h4>Analyst</h4><table><tr><th></th><th>settled</th><th>units</th><th>vs close</th></tr>' + rows(H.analyst.soccer) + '<tr><td colspan="4" class="sp">Hockey</td></tr>' + rows(H.analyst.nhl) + '</table>' : '';
    var by = H && H.writes ? Object.keys(H.writes.by || {}).sort(function (a, b) { return H.writes.by[b] - H.writes.by[a]; }).slice(0, 2) : [];
    var sv = H && H.writes ? '<h4>Saves today</h4><p>' + H.writes.used + ' of ' + H.writes.limit + (by.length ? ' · most from ' + by.map(function (k) { return esc(k) + ' (' + H.writes.by[k] + ')'; }).join(', ') : '') + (H.writes.saver ? ' · <b>saver mode on</b>' : '') + '</p>' : '';
    return '<div class="sr-h">' + svg(mood || 'work').replace('<svg ', '<svg width="44" height="46" ') + '<div><b>Sweep\'s report</b><small>' + when + ' · checked ' + (H && H.at ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }).format(new Date(H.at)) : 'just now') + '</small></div></div>'
      + (f.length ? '<p class="sr-s issue"><b>Found ' + f.length + ' thing' + (f.length > 1 ? 's' : '') + '</b></p><ul>' + f.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>'
        : '<p class="sr-s"><b>All clear.</b> No stuck games, prices are in, and every Analyst bet has its closing price.</p>')
      + an + sv
      + '<p class="sr-n">Tests, the build and code suggestions are in the full report in Notion (Game Day Hub sweep log).</p>'
      + '<button type="button" class="sr-ok">Got it · see you at 10 PM</button>';
  }
  function openPanel() {
    panel = document.createElement('div'); panel.id = 'sweep-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', "Sweep's report");
    panel.innerHTML = report(); document.body.appendChild(panel);
    panel.querySelector('.sr-ok').addEventListener('click', function () { close(); panel.remove(); panel = null; if (el) { el.className = 'away'; setTimeout(hide, 500); } });
  }
  var place = function () {
    var dock = document.querySelector('.dock'), b = dock ? 12 + dock.getBoundingClientRect().height : 2;
    if (el) { el.style.width = dock ? '60px' : '50px'; el.style.height = dock ? '63px' : '52px'; } // no bottom bar (Home): smaller and lower
    if (el) el.style.bottom = 'calc(' + b + 'px + env(safe-area-inset-bottom,0px))';
    if (tip) tip.style.bottom = 'calc(' + (b + 68) + 'px + env(safe-area-inset-bottom,0px))';
    if (panel) panel.style.bottom = 'calc(' + (b + 70) + 'px + env(safe-area-inset-bottom,0px))';
  };
  var show = function () {
    if (el) return;
    var st = document.createElement('style'); st.textContent = css + PANEL_CSS; document.head.appendChild(st);
    el = document.createElement('button'); el.id = 'sweep'; el.type = 'button'; el.className = 'out'; el.setAttribute('aria-label', 'Sweep, the night janitor');
    el.addEventListener('click', function () {
      if (panel) { panel.remove(); panel = null; return; }
      if (tip) { tip.remove(); tip = null; return; }
      if (mood === 'work' && !swept()) { tip = document.createElement('div'); tip.id = 'sweep-tip'; tip.setAttribute('role', 'status'); tip.innerHTML = note; document.body.appendChild(tip); return place(); }
      openPanel(); place();
    });
    document.body.appendChild(el); decide(); place(); requestAnimationFrame(function () { el.className = 'in'; });
  };
  var hide = function () { if (tip) { tip.remove(); tip = null; } if (panel) { panel.remove(); panel = null; } if (el) { el.remove(); el = null; } mood = null; };
  var last = null;
  var check = function () { if (closed()) return hide(); var s = swept(); if (!el) { last = s; return show(); } if (s !== last) { last = s; decide(); } };
  window.addEventListener('resize', place);
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', check) : check();
  setInterval(check, 60000);
})();
