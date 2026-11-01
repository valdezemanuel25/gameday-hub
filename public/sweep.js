// Sweep, the night janitor: the nightly sweep's mascot (the scheduled task that checks the Hub at 12:37 AM Central and reports).
// Shown only on the night shift, 10 PM to 6 AM Central, small in the bottom-left corner, above a page's bottom bar if it has one.
// Tap him for a word about what he does. Display only; it reads nothing and saves nothing (add ?sweep=1 to the address to see him by day).
(function () {
  var SVG = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 200 200\" class=\"sweep\"> <defs> <radialGradient id=\"sw-body\" cx=\"45%\" cy=\"35%\" r=\"65%\"><stop offset=\"0\" stop-color=\"#33382f\"/><stop offset=\"1\" stop-color=\"#121412\"/></radialGradient> <radialGradient id=\"sw-halo\" cx=\"50%\" cy=\"50%\" r=\"50%\"><stop offset=\"0\" stop-color=\"#E6FF7A\" stop-opacity=\".95\"/><stop offset=\".35\" stop-color=\"#C8FF2E\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#C8FF2E\" stop-opacity=\"0\"/></radialGradient> <filter id=\"sw-glow\" x=\"-50%\" y=\"-50%\" width=\"200%\" height=\"200%\"><feGaussianBlur stdDeviation=\"2.4\" result=\"b\"/><feMerge><feMergeNode in=\"b\"/><feMergeNode in=\"SourceGraphic\"/></feMerge></filter> <linearGradient id=\"sw-visor\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#151a10\"/><stop offset=\"1\" stop-color=\"#050604\"/></linearGradient> </defs> <style> .sweep .ant{animation:pulse 1.6s ease-in-out infinite;transform-origin:100px 26px} .sweep .halo{animation:halo 1.6s ease-in-out infinite;transform-origin:100px 26px} .sweep .eyes{animation:blink 4.2s infinite;transform-origin:100px 101px} .sweep .broom{animation:sweep 1.4s ease-in-out infinite;transform-origin:166px 90px} .sweep .dust circle{animation:dust 1.4s ease-out infinite;opacity:0} .sweep .dust circle:nth-child(2){animation-delay:.25s}.sweep .dust circle:nth-child(3){animation-delay:.5s} @keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.18)}} @keyframes halo{0%,100%{opacity:.75;transform:scale(1)}50%{opacity:1;transform:scale(1.35)}} @keyframes blink{0%,44%,50%,100%{transform:scaleY(1)}47%{transform:scaleY(.1)}} @keyframes sweep{0%,100%{transform:rotate(-12deg)}50%{transform:rotate(14deg)}} @keyframes dust{0%{opacity:0;transform:translate(0,0)}20%{opacity:.8}100%{opacity:0;transform:translate(-26px,-14px)}} @media (prefers-reduced-motion:reduce){.sweep *{animation:none!important}} </style> <line x1=\"100\" y1=\"34\" x2=\"100\" y2=\"54\" stroke=\"#9aa093\" stroke-width=\"4\" stroke-linecap=\"round\"/> <circle class=\"halo\" cx=\"100\" cy=\"26\" r=\"17\" fill=\"url(#sw-halo)\"/> <circle class=\"ant\" cx=\"100\" cy=\"26\" r=\"8\" fill=\"#DBFF4F\" stroke=\"#F4FFC2\" stroke-width=\"2\" filter=\"url(#sw-glow)\"/> <circle cx=\"97.5\" cy=\"23.5\" r=\"2.4\" fill=\"#fff\"/> <circle cx=\"100\" cy=\"108\" r=\"58\" fill=\"url(#sw-body)\" stroke=\"#4a5145\" stroke-width=\"3\"/> <rect x=\"44\" y=\"92\" width=\"10\" height=\"20\" rx=\"4\" fill=\"#C8FF2E\" filter=\"url(#sw-glow)\"/> <rect x=\"146\" y=\"92\" width=\"10\" height=\"20\" rx=\"4\" fill=\"#C8FF2E\" filter=\"url(#sw-glow)\"/> <rect x=\"58\" y=\"82\" width=\"84\" height=\"38\" rx=\"19\" fill=\"url(#sw-visor)\" stroke=\"#D8FF55\" stroke-width=\"3.5\" filter=\"url(#sw-glow)\"/> <path d=\"M68 89 h40\" stroke=\"#ffffff\" stroke-opacity=\".18\" stroke-width=\"3\" stroke-linecap=\"round\"/> <g class=\"eyes\" filter=\"url(#sw-glow)\"><circle cx=\"84\" cy=\"101\" r=\"7.5\" fill=\"#DBFF4F\"/><circle cx=\"116\" cy=\"101\" r=\"7.5\" fill=\"#DBFF4F\"/></g> <path d=\"M86 136 Q100 146 114 136\" stroke=\"#C8FF2E\" stroke-width=\"3.5\" fill=\"none\" stroke-linecap=\"round\"/> <g class=\"dust\" fill=\"#C8FF2E\"><circle cx=\"128\" cy=\"186\" r=\"3\"/><circle cx=\"136\" cy=\"190\" r=\"2.2\"/><circle cx=\"122\" cy=\"192\" r=\"2.6\"/></g> <g class=\"broom\"> <line x1=\"166\" y1=\"86\" x2=\"150\" y2=\"176\" stroke=\"#E0A662\" stroke-width=\"6\" stroke-linecap=\"round\"/> <path d=\"M134 168 L166 174 L162 194 L126 188 Z\" fill=\"#E0A662\"/><path d=\"M130 184 L163 190\" stroke=\"#8a6436\" stroke-width=\"2\"/> </g> <path d=\"M150 112 Q166 106 166 92\" stroke=\"#4a5145\" stroke-width=\"9\" fill=\"none\" stroke-linecap=\"round\"/><circle cx=\"166\" cy=\"88\" r=\"7\" fill=\"#4a5145\"/> </svg>";
  var force = /[?&]sweep=1\b/.test(location.search), el = null, tip = null;
  var hourCT = function () { return +new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hourCycle: 'h23' }).format(new Date()); };
  var onShift = function () { var h = hourCT(); return force || h >= 22 || h < 6; };
  var css = '#sweep{position:fixed;left:max(10px,env(safe-area-inset-left,0px));z-index:900;width:58px;height:58px;padding:0;border:0;background:none;cursor:pointer;-webkit-tap-highlight-color:transparent;filter:drop-shadow(0 4px 10px rgba(0,0,0,.6));transition:opacity .4s,transform .4s}'
    + '#sweep svg{width:100%;height:100%;display:block}#sweep.in{opacity:1;transform:none}#sweep.out{opacity:0;transform:translateY(12px)}'
    + '#sweep-tip{position:fixed;left:max(10px,env(safe-area-inset-left,0px));z-index:901;max-width:min(260px,calc(100vw - 32px));background:#0d100b;color:#e8eee0;border:1px solid rgba(200,255,46,.45);border-radius:14px;padding:10px 12px;font:500 13px/1.4 "DM Sans",system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.6)}'
    + '#sweep-tip b{color:#C8FF2E}';
  var place = function () {
    var dock = document.querySelector('.dock'), b = dock ? 12 + dock.getBoundingClientRect().height : 2;
    if (el) { el.style.width = el.style.height = dock ? '58px' : '48px'; } // no bottom bar (Home): smaller and lower, clear of the page's own content
    if (el) el.style.bottom = 'calc(' + b + 'px + env(safe-area-inset-bottom,0px))';
    if (tip) tip.style.bottom = 'calc(' + (b + 64) + 'px + env(safe-area-inset-bottom,0px))';
  };
  var show = function () {
    if (el) return;
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    el = document.createElement('button'); el.id = 'sweep'; el.type = 'button'; el.className = 'out'; el.setAttribute('aria-label', 'Sweep, the night janitor'); el.innerHTML = SVG;
    el.addEventListener('click', function () {
      if (tip) { tip.remove(); tip = null; return; }
      tip = document.createElement('div'); tip.id = 'sweep-tip'; tip.setAttribute('role', 'status');
      tip.innerHTML = '<b>Sweep</b> on the night shift. I check the whole Hub at 12:37 AM: tests, the build, prices, grading and the Analyst, then leave my report in Notion. I never change anything.';
      document.body.appendChild(tip); place();
    });
    document.body.appendChild(el); place(); requestAnimationFrame(function () { el.className = 'in'; });
  };
  var hide = function () { if (tip) { tip.remove(); tip = null; } if (el) { el.remove(); el = null; } };
  var check = function () { onShift() ? show() : hide(); };
  window.addEventListener('resize', place);
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', check) : check();
  setInterval(check, 60000);
})();
