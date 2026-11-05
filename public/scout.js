// Scout, the free-rein analyst's mascot (src/scout.js has the whole idea). He sits bottom right on Home, Soccer and Hockey, across from
// Sweep. Tap him for his book: the record, where his edge is coming from (the Hub model each thesis started from), his open bets and
// settled ones, each with what he took and why, the models he read and the outside sources that confirmed or changed it.
// Display only: reads /api/scout, never saves. Add ?scout=up / ?scout=down / ?scout=scan to see a mood; ?scout=1 opens his book (the bet alert links there).
(function () {
  var busy = false, said = '', q = (location.search.match(/[?&]scout=(\w+)/) || [])[1], el = null, panel = null, D = null, tab = 'open', mood = 'scan';
  var esc = function (t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var C = '#3ee8ff', CH = '#c9f8ff';
  function svg(state) {
    var down = state === 'down', up = state === 'up';
    // one big lens eye that scans left and right; happy: a curved eye; down: a flat eye and a sweat drop
    var eye = up ? '<path d="M86 102 q14 -14 28 0" stroke="' + C + '" stroke-width="5" fill="none" stroke-linecap="round"/>'
      : down ? '<rect x="86" y="99" width="28" height="5" rx="2.5" fill="' + C + '"/>'
      : '<g class="scan"><circle cx="100" cy="101" r="10" fill="' + C + '"/><circle cx="96.5" cy="97.5" r="3" fill="#fff"/></g>';
    var mouth = up ? '<path d="M88 134 Q100 145 112 134" stroke="' + C + '" stroke-width="3.5" fill="none" stroke-linecap="round"/>'
      : down ? '<path d="M89 140 Q100 133 111 140" stroke="' + C + '" stroke-width="3.5" fill="none" stroke-linecap="round"/>'
      : '<path d="M90 137 h20" stroke="' + C + '" stroke-width="3.5" stroke-linecap="round"/>';
    var drop = down ? '<path class="drop" d="M150 70 q6 9 0 13 q-6 -4 0 -13z" fill="' + C + '"/>' : '';
    // the spyglass in his right hand, raised while he scans
    var glass = state === 'scan'
      ? '<g class="glass"><path d="M150 112 Q166 104 168 90" stroke="#3c4a52" stroke-width="9" fill="none" stroke-linecap="round"/><g transform="rotate(-38 170 84)"><rect x="160" y="72" width="34" height="13" rx="4" fill="#2a343a" stroke="' + C + '" stroke-width="2"/><rect x="190" y="70" width="8" height="17" rx="3" fill="' + C + '" opacity=".85"/></g></g>'
      : '<path d="M150 112 Q164 118 166 132" stroke="#3c4a52" stroke-width="9" fill="none" stroke-linecap="round"/><circle cx="166" cy="136" r="7" fill="#3c4a52"/>';
    var pop = up ? '<g class="pop"><circle cx="48" cy="44" r="14" fill="' + C + '"/><path d="M41 47 l6 -7 l5 4 l7 -9" stroke="#061014" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>' : '';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 210" class="sc ' + state + '"><defs>'
      + '<radialGradient id="scb" cx="42%" cy="32%" r="68%"><stop offset="0" stop-color="#33424a"/><stop offset=".6" stop-color="#161d21"/><stop offset="1" stop-color="#0b1013"/></radialGradient>'
      + '<radialGradient id="sch"><stop offset="0" stop-color="' + CH + '" stop-opacity=".95"/><stop offset=".35" stop-color="' + C + '" stop-opacity=".5"/><stop offset="1" stop-color="' + C + '" stop-opacity="0"/></radialGradient>'
      + '<filter id="scg" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.4" result="x"/><feMerge><feMergeNode in="x"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'
      + '<linearGradient id="scv" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d1c22"/><stop offset="1" stop-color="#03070a"/></linearGradient></defs>'
      + '<ellipse class="shadow" cx="100" cy="196" rx="44" ry="6" fill="#000" opacity=".55"/><g class="float">'
      // antenna with a little radar dish that turns
      + '<line x1="100" y1="38" x2="100" y2="54" stroke="#8f9da5" stroke-width="4" stroke-linecap="round"/>'
      + '<circle class="halo" cx="100" cy="30" r="17" fill="url(#sch)"/><g class="dish"><path d="M88 30 a12 12 0 0 0 24 0 z" fill="' + C + '" stroke="' + CH + '" stroke-width="1.6" filter="url(#scg)"/><line x1="100" y1="30" x2="100" y2="20" stroke="' + CH + '" stroke-width="2"/><circle cx="100" cy="19" r="2.6" fill="#fff"/></g>'
      + '<circle cx="100" cy="108" r="58" fill="url(#scb)" stroke="#4a5960" stroke-width="3"/><path d="M62 78 Q74 58 100 54" stroke="#fff" stroke-opacity=".08" stroke-width="6" fill="none" stroke-linecap="round"/>'
      + '<rect x="44" y="94" width="10" height="18" rx="4" fill="' + C + '" filter="url(#scg)"/>'
      + '<rect x="62" y="84" width="76" height="34" rx="17" fill="url(#scv)" stroke="' + C + '" stroke-width="3.5" filter="url(#scg)"/><path d="M72 90 h34" stroke="#fff" stroke-opacity=".18" stroke-width="3" stroke-linecap="round"/>'
      + '<g filter="url(#scg)">' + eye + '</g>' + mouth + glass + drop + '</g>' + pop + '</svg>';
  }
  var css = '#scout{position:fixed;right:max(10px,env(safe-area-inset-right,0px));z-index:900;width:60px;height:60px;padding:0;border:0;background:none;cursor:pointer;-webkit-tap-highlight-color:transparent;filter:drop-shadow(0 4px 10px rgba(0,0,0,.6));transition:opacity .4s,transform .4s;opacity:0;transform:translateY(12px)}'
    + '#scout.in{opacity:1;transform:none}#scout svg{width:100%;height:100%;display:block;overflow:visible}'
    + '#scout .badge{position:absolute;top:-2px;left:-4px;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:' + C + ';color:#061014;font:800 11px/18px "DM Sans",system-ui,sans-serif;text-align:center;box-shadow:0 0 10px rgba(62,232,255,.6)}'
    + '.sc .float{animation:scf 3.2s ease-in-out infinite}.sc .shadow{animation:scs 3.2s ease-in-out infinite;transform-origin:100px 196px}'
    + '.sc .halo{animation:sch 1.8s ease-in-out infinite;transform-origin:100px 30px}.sc .dish{animation:scd 2.6s ease-in-out infinite;transform-origin:100px 30px}'
    + '.sc .scan{animation:scn 3.4s ease-in-out infinite}.sc .glass{animation:scg 3.4s ease-in-out infinite;transform-origin:150px 112px}'
    + '.sc .pop{animation:sco 2.4s ease-in-out infinite;transform-origin:48px 44px}.sc .drop{animation:scr 1.8s ease-in infinite}'
    + '@keyframes scf{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}@keyframes scs{0%,100%{transform:scaleX(1);opacity:.55}50%{transform:scaleX(.86);opacity:.35}}'
    + '@keyframes sch{0%,100%{opacity:.6;transform:scale(1)}50%{opacity:1;transform:scale(1.35)}}@keyframes scd{0%,100%{transform:rotate(-22deg)}50%{transform:rotate(22deg)}}'
    + '@keyframes scn{0%,100%{transform:translateX(-12px)}45%,55%{transform:translateX(12px)}}@keyframes scg{0%,100%{transform:rotate(0)}50%{transform:rotate(-6deg)}}'
    + '@keyframes sco{0%,100%{transform:scale(.9)}50%{transform:scale(1.08) translateY(-3px)}}@keyframes scr{0%{opacity:0;transform:translateY(-4px)}30%{opacity:1}100%{opacity:0;transform:translateY(14px)}}'
    + '@media (prefers-reduced-motion:reduce){.sc *{animation:none!important}}'
    + '#scout-panel{box-sizing:border-box;position:fixed;right:max(10px,env(safe-area-inset-right,0px));z-index:902;width:min(380px,calc(100vw - 20px));max-height:min(74vh,620px);overflow:auto;overscroll-behavior:contain;background:#081014;color:#e3eef2;border:1px solid rgba(62,232,255,.45);border-radius:16px;padding:12px 14px 14px;font:500 13px/1.45 "DM Sans",system-ui,sans-serif;box-shadow:0 12px 32px rgba(0,0,0,.7),0 0 24px rgba(62,232,255,.12)}'
    + '#scout-panel .scx-h{display:flex;align-items:center;gap:10px;margin-bottom:8px}#scout-panel .scx-h b{display:block;font-size:15px}#scout-panel .scx-h small{color:#8ea3ab;font-size:11.5px}'
    + '#scout-panel .scx-x{margin-left:auto;width:30px;height:30px;border-radius:50%;border:1px solid rgba(255,255,255,.14);background:none;color:#e3eef2;font-size:17px;cursor:pointer;flex:none}'
    + '#scout-panel .scx-rec{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:4px 0 8px}#scout-panel .scx-rec div{background:#0d1a20;border-radius:10px;padding:6px 4px;text-align:center}'
    + '#scout-panel .scx-rec small{display:block;color:#8ea3ab;font-size:10.5px}#scout-panel .scx-rec b{font-size:14px}#scout-panel .scx-up{color:' + C + '}#scout-panel .scx-dn{color:#FF4D57}'
    + '#scout-panel h4{margin:10px 0 4px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#8ea3ab}'
    + '#scout-panel table{display:table;width:100%;margin:0;background:none;border-collapse:collapse;font-size:12px}#scout-panel tr{background:none}#scout-panel th{color:#8ea3ab;font-weight:500;text-align:right;padding:2px 4px}#scout-panel td{padding:3px 4px;border-top:1px solid #15252c;text-align:right}#scout-panel td:first-child,#scout-panel th:first-child{text-align:left}'
    + '#scout-panel .scx-tabs{display:flex;gap:6px;margin:10px 0 6px}#scout-panel .scx-tabs button{flex:1;padding:7px;border-radius:10px;border:1px solid rgba(62,232,255,.25);background:none;color:#cfe3ea;font:600 12px "DM Sans",system-ui,sans-serif;cursor:pointer}'
    + '#scout-panel .scx-tabs button.on{background:' + C + ';color:#061014;border-color:' + C + '}'
    + '#scout-panel details{border-top:1px solid #15252c;padding:7px 0}#scout-panel summary{list-style:none;cursor:pointer;display:flex;gap:8px;align-items:baseline}#scout-panel summary::-webkit-details-marker{display:none}'
    + '#scout-panel summary .scx-g{display:block;flex:1;min-width:0}#scout-panel summary .scx-g b{display:block;font-size:13px}#scout-panel summary .scx-g small{display:block;color:#8ea3ab;font-size:11px}#scout-panel summary .scx-u{font-weight:700;white-space:nowrap}'
    + '#scout-panel .scx-cols,#scout-panel summary.scx-r{display:grid;grid-template-columns:minmax(0,1fr) 44px 58px 62px;gap:4px;align-items:baseline}#scout-panel .scx-cols{color:#8ea3ab;font-size:11px;padding:2px 0 4px}#scout-panel .scx-cols span:not(:first-child),#scout-panel summary.scx-r .scx-c{text-align:right;white-space:nowrap;font-size:12.5px}'
    + '#scout-panel summary.scx-r .scx-g b::after{content:" ›";color:#8ea3ab;font-weight:500}#scout-panel details[open] summary.scx-r .scx-g b::after{content:" ˅"}#scout-panel details .scx-in{padding:4px 0 2px}'
    + '#scout-panel .scx-why{margin:6px 0 2px;color:#dbe8ec}#scout-panel .scx-meta{color:#8ea3ab;font-size:11.5px;margin:3px 0}#scout-panel a{color:' + C + '}'
    + '#scout-panel ul{margin:2px 0;padding-left:16px}#scout-panel li{margin:2px 0;font-size:12px}#scout-panel .scx-tag{display:inline-block;padding:0 6px;border-radius:6px;background:#10252d;color:' + C + ';font-size:10.5px;font-weight:700;margin-right:4px}'
    + '#scout-panel .scx-go{display:block;width:100%;margin:12px 0 4px;padding:10px;border-radius:12px;border:0;background:' + C + ';color:#061014;font:700 13px "DM Sans",system-ui,sans-serif;cursor:pointer}#scout-panel .scx-go[disabled]{opacity:.6}'
    + '.anl.scl .k{color:' + C + '!important;border-color:rgba(62,232,255,.45)!important}.scl{cursor:pointer}'
    + '#scout-panel .scx-n{color:#8ea3ab;font-size:11.5px;margin-top:10px}';
  var signed = function (x, d) { return x == null ? '–' : (x > 0 ? '+' : '') + (d != null ? x.toFixed(d) : x); };
  var am = function (m) { return m > 0 ? '+' + m : String(m); };
  var LBL = { H: 'Home', D: 'Draw', A: 'Away', O: 'Over', U: 'Under', B: 'Both score Yes', N: 'Both score No' };
  var pickName = function (b) {
    if (b.key === 'H') return b.home; if (b.key === 'A') return b.away; if (b.key === 'D') return 'Draw';
    if (b.key === 'O' || b.key === 'U') return LBL[b.key] + ' ' + (b.line || 2.5); return LBL[b.key];
  };
  var when = function (iso) { return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)); };
  var host = function (u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };
  var TH = [['edge', 'Edge'], ['agree', 'For it'], ['against', 'Against it'], ['move', 'Price move'], ['outsideSaid', 'ESPN'], ['risk', 'What would make it wrong']];
  function thesis(b) {
    var t = b.thesis || {}, rows = TH.filter(function (x) { return t[x[0]]; }).map(function (x) { return '<li><b>' + x[1] + '</b> ' + esc(t[x[0]]) + '</li>'; }).join('');
    return (rows ? '<ul class="scx-th">' + rows + '</ul>' : '') + (b.critic ? '<p class="scx-meta"><b>Critic</b> ' + esc(b.critic) + '</p>' : '');
  }
  function betRow(b) {
    // ROI on this one bet: units won or lost per unit staked (settled bets only)
    var roi = b.status === 'open' ? 'open' : b.status === 'late' || b.status === 'bad' ? 'not counted' : b.res === 'void' ? 'void' : b.units == null || !b.stake ? '–' : signed(Math.round(100 * b.units / b.stake)) + '%';
    var roiCls = b.units > 0 && b.status === 'settled' ? 'scx-up' : b.units < 0 && b.status === 'settled' ? 'scx-dn' : '';
    var src = (b.outside || []).map(function (o) { return '<li>' + esc(o.note || o.said || '') + (o.url ? ' · <a href="' + esc(o.url) + '" target="_blank" rel="noopener">' + esc(o.src || host(o.url)) + '</a>' : o.src ? ' · ' + esc(o.src) : '') + '</li>'; }).join('');
    var mods = b.models ? (typeof b.models === 'string' ? '<p class="scx-meta">' + esc(b.models) + '</p>' : '<ul>' + Object.keys(b.models).map(function (k) { return '<li><b>' + esc(k) + '</b> ' + esc(b.models[k]) + '</li>'; }).join('') + '</ul>') : '';
    return '<details><summary class="scx-r"><span class="scx-g"><b>' + esc(pickName(b)) + ' ' + am(b.price) + '</b><small>' + esc(b.home) + ' v ' + esc(b.away) + ' · ' + when(b.kickoff) + (b.score ? ' · ' + esc(b.score) : '') + '</small></span>'
      + '<span class="scx-c">' + esc(b.stake) + 'u</span><span class="scx-c ' + roiCls + '">' + roi + '</span><span class="scx-c">' + (b.clv == null ? '–' : signed(b.clv) + '%') + '</span></summary>'
      + '<div class="scx-in"><p class="scx-meta">' + (b.sport === 'nhl' ? 'NHL' : esc(b.leagueName || b.league)) + (b.lead ? ' · <span class="scx-tag">' + esc(b.lead) + '</span>' : '') + (b.outsideCheck ? '<span class="scx-tag">' + esc(b.outsideCheck) + '</span>' : '') + (b.conf ? 'confidence ' + esc(b.conf) + '/5' : '') + (b.units != null && b.status === 'settled' ? ' · ' + signed(b.units, 2) + 'u' : '') + (b.note ? ' · ' + esc(b.note) : '') + '</p>'
      + '<p class="scx-why">' + esc(b.why) + '</p>' + thesis(b) + (mods ? '<p class="scx-meta">What the Hub said</p>' + mods : '') + (src ? '<p class="scx-meta">Outside check</p><ul>' + src + '</ul>' : '') + '</div></details>';
  }
  function compareTable() {
    var C = D && D.compare; if (!C || !(C.scout.settled || C.baseline.settled || C.dropped.settled)) return '';
    var row = function (n, s) { return '<tr><td>' + n + '</td><td>' + s.settled + '</td><td class="' + (s.units > 0 ? 'scx-up' : s.units < 0 ? 'scx-dn' : '') + '">' + signed(s.units, 2) + '</td><td>' + (s.roi == null ? '–' : signed(s.roi) + '%') + '</td><td>' + (s.clv == null ? '–' : signed(s.clv) + '%') + '</td></tr>'; };
    return '<h4>Scout v the code</h4><table><tr><th></th><th>bets</th><th>units</th><th>ROI</th><th>vs close</th></tr>' + row('Scout', C.scout) + row('Every code edge, 1u', C.baseline) + row('Critic dropped', C.dropped) + '</table>';
  }
  function body() {
    if (!D) return '<p class="scx-n">Loading his book…</p>';
    var a = D.record.all, open = D.bets.filter(function (b) { return b.status === 'open'; }), done = D.bets.filter(function (b) { return b.status !== 'open'; });
    var leads = Object.keys(D.record.lead || {}).map(function (k) { return [k, D.record.lead[k]]; }).filter(function (x) { return x[1].settled; }).sort(function (x, y) { return y[1].settled - x[1].settled; }).slice(0, 6);
    var run = D.runs[0];
    return '<div class="scx-rec"><div><small>settled</small><b>' + a.wins + '-' + (a.settled - a.wins) + '</b></div><div><small>units</small><b class="' + (a.units > 0 ? 'scx-up' : a.units < 0 ? 'scx-dn' : '') + '">' + signed(a.units, 2) + '</b></div>'
      + '<div><small>ROI</small><b>' + (a.roi == null ? '–' : signed(a.roi) + '%') + '</b></div><div><small>vs close</small><b>' + (a.clv == null ? '–' : signed(a.clv) + '%') + '</b></div></div>'
      + (leads.length ? '<h4>Where the edge is coming from</h4><table><tr><th>Started from</th><th>bets</th><th>units</th><th>vs close</th></tr>' + leads.map(function (x) { var s = x[1]; return '<tr><td>' + esc(x[0]) + '</td><td>' + s.settled + '</td><td class="' + (s.units > 0 ? 'scx-up' : s.units < 0 ? 'scx-dn' : '') + '">' + signed(s.units, 2) + '</td><td>' + (s.clv == null ? '–' : signed(s.clv) + '%') + '</td></tr>'; }).join('') + '</table>' : '')
      + compareTable()
      + '<div class="scx-tabs"><button type="button" data-t="open" class="' + (tab === 'open' ? 'on' : '') + '">Open (' + open.length + ')</button><button type="button" data-t="done" class="' + (tab === 'done' ? 'on' : '') + '">Settled (' + done.length + ')</button></div>'
      + ((tab === 'open' ? open : done).length ? '<div class="scx-cols"><span>Bet</span><span>Stake</span><span>ROI</span><span>vs close</span></div>' + (tab === 'open' ? open : done).map(betRow).join('') : '<p class="scx-n">' + (tab === 'open' ? 'No open bets right now.' : 'Nothing settled yet.') + '</p>')
      + (run ? '<details class="scx-last"><summary><h4 style="margin:0">Last look · ' + when(run.at) + ' · took ' + (run.took || 0) + ' ›</h4></summary><p class="scx-meta">' + esc(run.note) + '</p></details>' : '')
      + '<button type="button" class="scx-go"' + (busy ? ' disabled' : '') + '>' + (busy ? 'Scout is looking…' : 'Look now') + '</button>' + (said ? '<p class="scx-meta">' + esc(said) + '</p>' : '')
      + '<p class="scx-n">Paper bets only, no real money. Scout has no rules: he starts from the Hub\'s models, checks ESPN for injuries, lineups and news, writes each bet as a thesis, and a critic tries to talk him out of it. The Hub grades him at DraftKings\' price. He looks on his own at 5:43 AM and 3:43 PM, on Cloudflare\'s AI.</p>';
  }
  function render() { if (!panel) return; panel.querySelector('.scx-b').innerHTML = body(); }
  function head() {
    var last = D && D.runs[0] ? 'last look ' + when(D.runs[0].at) : 'free rein · paper bets';
    return '<div class="scx-h">' + svg(mood).replace('<svg ', '<svg width="44" height="44" ') + '<div><b>Scout\'s book</b><small>' + last + '</small></div><button type="button" class="scx-x" aria-label="Close">×</button></div>';
  }
  function openPanel() {
    panel = document.createElement('div'); panel.id = 'scout-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', "Scout's book");
    panel.innerHTML = head() + '<div class="scx-b"></div>'; document.body.appendChild(panel); render(); place();
    panel.addEventListener('click', function (e) {
      if (e.target.closest('.scx-x')) { panel.remove(); panel = null; return; }
      var t = e.target.closest('[data-t]'); if (t) { tab = t.getAttribute('data-t'); render(); }
      if (e.target.closest('.scx-go') && !busy) { busy = true; said = ''; render();
        fetch('/api/scout/run', { method: 'POST', credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (j) {
          said = j.error ? 'That look failed: ' + j.error : j.skipped === 'cooldown' ? j.note : 'Looked at ' + j.looked + ' game' + (j.looked === 1 ? '' : 's') + ', took ' + j.took + '.'; tab = 'open';
        }).catch(function () { said = 'Could not reach the Hub.'; }).then(function () { busy = false; load(); render(); }); }
    });
  }
  var place = function () {
    var dock = document.querySelector('.dock'), b = dock ? 12 + dock.getBoundingClientRect().height : 2;
    if (el) { el.style.width = el.style.height = dock ? '60px' : '50px'; el.style.bottom = 'calc(' + b + 'px + env(safe-area-inset-bottom,0px))'; }
    if (panel) panel.style.bottom = 'calc(' + (b + 68) + 'px + env(safe-area-inset-bottom,0px))';
  };
  function setMood() {
    if (q === 'up' || q === 'down' || q === 'scan') mood = q;
    else if (D && D.record.all.settled >= 5) mood = D.record.all.units > 0 ? 'up' : D.record.all.units < 0 ? 'down' : 'scan';
    else mood = 'scan';
    var n = D ? D.bets.filter(function (b) { return b.status === 'open'; }).length : 0;
    if (el) el.innerHTML = svg(mood) + (n ? '<span class="badge">' + n + '</span>' : '');
  }
  // His bets by game, for the tag on the game cards (window.scoutLine, called by the Soccer and Hockey pages)
  window.ScoutBets = null; var lastSig = '[]';
  window.scoutLine = function (c, sport) {
    var L = window.ScoutBets && window.ScoutBets.get(sport + '|' + c.id); if (!L || !L.length) return '';
    var one = function (b) { var r = b.res === 'win' ? ' <span class="w">✓</span>' : b.res === 'loss' ? ' <span class="l">✗</span>' : b.res === 'void' ? ' void' : '';
      return '<b>' + esc(pickName(b)) + ' ' + am(b.price) + '</b>' + (b.stake !== 1 ? ' ' + b.stake + 'u' : '') + r; };
    return '<span class="anl scl" data-scoutopen="1"><span class="k">Scout</span>' + L.map(one).join(' · ') + '<span class="go">›</span></span>';
  };
  function load() {
    fetch('/api/scout', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (j && j.record) { D = j; D.runs = D.runs || []; D.bets = D.bets || [];
        var m = new Map(); D.bets.forEach(function (b) { if (b.status === 'late' || b.status === 'bad') return; var k = b.sport + '|' + b.gid; (m.get(k) || m.set(k, []).get(k)).push(b); });
        var sig = JSON.stringify(D.bets.map(function (b) { return [b.id, b.res || '']; })); window.ScoutBets = m; if (sig !== lastSig) { lastSig = sig; if (m.size) document.dispatchEvent(new CustomEvent('scout:bets')); } }
      setMood(); render(); if (panel) panel.querySelector('.scx-h small').textContent = D && D.runs[0] ? 'last look ' + when(D.runs[0].at) : 'free rein · paper bets';
    }).catch(function () {});
  }
  function show() {
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    el = document.createElement('button'); el.id = 'scout'; el.type = 'button'; el.setAttribute('aria-label', "Scout, the free-rein analyst: open his book");
    el.addEventListener('click', function () { if (panel) { panel.remove(); panel = null; return; } openPanel(); });
    document.body.appendChild(el); setMood(); place(); load();
    document.addEventListener('click', function (e) { var t = e.target.closest && e.target.closest('[data-scoutopen]'); if (!t) return; e.preventDefault(); e.stopPropagation(); if (!panel) openPanel(); }, true);
    if (q === '1') openPanel(); requestAnimationFrame(function () { el.className = 'in'; });
    window.addEventListener('resize', place);
    setInterval(load, 10 * 60000);
  }
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', show) : show();
})();
