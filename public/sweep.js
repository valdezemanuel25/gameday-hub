// Sweep, the night janitor: the nightly sweep's mascot (the scheduled task that checks the Hub at 12:37 AM Central and reports).
// Shown only on the night shift, 10 PM to 6 AM Central, small in the bottom-left corner, above a page's bottom bar if it has one.
// Moods: "work" until the night's sweep has run (12:45 AM), then "clear" or "issue" from the Hub's read-only health report
// (/api/health, the same one the sweep reads). Tap him for a one-line note. Display only: reads, never saves.
// Add ?sweep=1 to the address to see him by day (and ?sweep=clear / ?sweep=issue to see a mood).
(function () {
  var q = (location.search.match(/[?&]sweep=(\w+)/) || [])[1], force = !!q, el = null, tip = null, mood = null, note = '';
  var ct = function () { var p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date()), g = function (t) { return +(p.find(function (x) { return x.type === t; }) || {}).value; }; return g('hour') * 60 + g('minute'); };
  var onShift = function () { var m = ct(); return force || m >= 22 * 60 || m < 6 * 60; };
  var swept = function () { var m = ct(); return m >= 45 && m < 6 * 60; }; // the sweep runs at 12:37 AM

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

  // What the health report says, in a line: the same things the sweep flags from live data
  function readHealth(h) {
    var out = [], n = function (a) { return (a && a.length) || 0; };
    var ug = n(h.soccer && h.soccer.ungraded) + n(h.nhl && h.nhl.ungraded), up = n(h.soccer && h.soccer.unpriced) + n(h.nhl && h.nhl.unpriced);
    var nc = n(h.analyst && h.analyst.noClose), st = n(h.analyst && h.analyst.stale), sp = Object.keys(h.syncProblems || {}).length;
    if (ug) out.push(ug + ' game' + (ug > 1 ? 's' : '') + ' with no result yet');
    if (up) out.push(up + ' upcoming game' + (up > 1 ? 's' : '') + ' with no price');
    if (nc) out.push(nc + ' Analyst bet' + (nc > 1 ? 's' : '') + ' missing a closing price');
    if (st) out.push(st + ' Analyst bet' + (st > 1 ? 's' : '') + ' open 2+ days');
    if (sp) out.push('a sync problem in ' + Object.keys(h.syncProblems).join(', '));
    if (h.writes && h.writes.limit && h.writes.used > 0.7 * h.writes.limit) out.push('storage writes at ' + h.writes.used + ' of ' + h.writes.limit);
    if (h.oddsApiCredits && h.oddsApiCredits.left != null && h.oddsApiCredits.left < 50) out.push('Odds API credits low (' + h.oddsApiCredits.left + ' left)');
    return out;
  }
  function setMood(m, text) {
    mood = m; note = text;
    if (el) el.innerHTML = svg(m);
    if (tip) { tip.className = m === 'issue' ? 'issue' : ''; tip.innerHTML = note; }
  }
  function decide() {
    if (q === 'clear' || q === 'issue') return setMood(q, q === 'clear' ? '<b>All clear.</b> Tonight\'s sweep found nothing wrong.' : '<b>Found something:</b> an example problem (preview).');
    if (!swept() && q !== '1') return setMood('work', '<b>Sweep</b> on the night shift. I check the whole Hub at 12:37 AM: tests, the build, prices, grading and the Analyst, then leave my report in Notion. I never change anything.');
    if (!swept()) return setMood('work', '<b>Sweep</b> on the night shift. I check the whole Hub at 12:37 AM, then leave my report in Notion.');
    fetch('/api/health', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (h) {
      if (!h) return setMood('work', '<b>Sweep</b>: tonight\'s report is in Notion.');
      var f = readHealth(h);
      setMood(f.length ? 'issue' : 'clear', f.length ? '<b>Found ' + f.length + ' thing' + (f.length > 1 ? 's' : '') + ':</b> ' + f.join('; ') + '. Full report in Notion.' : '<b>All clear.</b> No stuck games, prices are in and the Analyst is up to date.');
    }).catch(function () { setMood('work', '<b>Sweep</b>: tonight\'s report is in Notion.'); });
  }
  var place = function () {
    var dock = document.querySelector('.dock'), b = dock ? 12 + dock.getBoundingClientRect().height : 2;
    if (el) { el.style.width = dock ? '60px' : '50px'; el.style.height = dock ? '63px' : '52px'; } // no bottom bar (Home): smaller and lower
    if (el) el.style.bottom = 'calc(' + b + 'px + env(safe-area-inset-bottom,0px))';
    if (tip) tip.style.bottom = 'calc(' + (b + 68) + 'px + env(safe-area-inset-bottom,0px))';
  };
  var show = function () {
    if (el) return;
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    el = document.createElement('button'); el.id = 'sweep'; el.type = 'button'; el.className = 'out'; el.setAttribute('aria-label', 'Sweep, the night janitor');
    el.addEventListener('click', function () {
      if (tip) { tip.remove(); tip = null; return; }
      tip = document.createElement('div'); tip.id = 'sweep-tip'; tip.setAttribute('role', 'status'); tip.className = mood === 'issue' ? 'issue' : ''; tip.innerHTML = note;
      document.body.appendChild(tip); place();
    });
    document.body.appendChild(el); decide(); place(); requestAnimationFrame(function () { el.className = 'in'; });
  };
  var hide = function () { if (tip) { tip.remove(); tip = null; } if (el) { el.remove(); el = null; } mood = null; };
  var last = null;
  var check = function () { if (!onShift()) return hide(); var s = swept(); if (!el) { last = s; return show(); } if (s !== last) { last = s; decide(); } };
  window.addEventListener('resize', place);
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', check) : check();
  setInterval(check, 60000);
})();
