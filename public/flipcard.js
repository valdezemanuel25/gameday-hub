// FlipCard (Nov 6, 2026): an open Board card flips over on its Y axis to show that game's Movement card on the back. Swipe it sideways,
// or tap the pick % (soccer) or the win % (hockey), to flip it; tap the back (or its title), or swipe again, to flip back. Every open
// card that has a Movement card is ready to swipe as soon as it is drawn (FlipCard.sync, called at the end of each page's render()).
// Written for the Hub in plain JavaScript after the React FlipCard, with these settings: axis y, flipOnClick (on the back), draggable,
// dragDistance 0, tilt (max 12 degrees), glare (opacity 0.22), hoverScale 1.03, perspective 1100, a spring (stiffness 170, damping 20),
// radius 22, background #27272a, color #f5f5f5, shadow #000000 at 0.45. Tilt, glare and the hover scale follow a mouse; on a phone the
// card follows your finger while you swipe it.
//   FlipCard.toggle(cardEl, id, backHtml) flips that card; FlipCard.sync(backHtmlOf) readies every open card on the page and keeps the one
//   that was flipped flipped after a redraw. Fires 'flipcard' on document: { id, flipped }.
(function () {
  var O = { perspective: 1100, stiffness: 170, damping: 20, tiltMax: 12, glareOpacity: 0.22, hoverScale: 1.03, radius: 22, background: '#27272a', color: '#f5f5f5', shadowColor: '0,0,0', shadowOpacity: 0.45, drag: 0.55 };
  var css = '' +
    '.fc-wrap{position:relative;perspective:' + O.perspective + 'px;margin-bottom:10px;transition:height .38s cubic-bezier(.3,.9,.3,1);touch-action:pan-y;-webkit-tap-highlight-color:transparent}' +
    '.fc-in{position:relative;width:100%;height:100%;transform-style:preserve-3d;-webkit-transform-style:preserve-3d;will-change:transform}' +
    '.fc-face{position:absolute;inset:0 0 auto 0;backface-visibility:hidden;-webkit-backface-visibility:hidden;border-radius:' + O.radius + 'px;box-shadow:0 22px 48px rgba(' + O.shadowColor + ',' + O.shadowOpacity + ')}' +
    '.fc-front{transform:rotateY(0deg) translateZ(.5px)}' +
    '.fc-front>*{margin-bottom:0!important;border-radius:' + O.radius + 'px!important}' +
    // the back is the Movement card as the Movement tab draws it (its colours, outline and flags), see-through like the Board cards so the
    // moving background shows; the plain FlipCard background (#27272a) only shows if the back has no card of its own
    '.fc-back{transform:rotateY(180deg) translateZ(.5px);color:' + O.color + ';overflow:hidden;background:transparent;text-shadow:0 0 2px rgba(0,0,0,.95),0 0 9px rgba(0,0,0,.8)}' + // see-through (a dark outline keeps text readable over the dots, as on the soccer Board);: the Board's moving background shows behind the card, like the front
    '.fc-back:not(:has(>.mvg)){background:' + O.background + ';padding:4px 2px 10px}' +
    '.fc-back>.mvg{margin:0!important;border-radius:' + O.radius + 'px!important}' +
    '.fc-back .mvx{background:rgba(0,0,0,.34);border-radius:10px}' + // a light tint behind the price table only: still see-through, but the numbers read over bright dots
    '.fc-back .fc-tip{display:block;text-align:center;font-size:11.5px;opacity:.5;margin-top:8px;letter-spacing:.02em}' +
    '.fc-glare{position:absolute;inset:0;border-radius:' + O.radius + 'px;pointer-events:none;opacity:0;transition:opacity .25s;z-index:5;transform:translateZ(1px);' +
      'background:radial-gradient(circle at var(--gx,50%) var(--gy,50%),rgba(255,255,255,' + O.glareOpacity + ') 0%,rgba(255,255,255,0) 60%)}' +
    '.fc-wrap.fc-hov .fc-glare{opacity:1}' +
    '.fc-wrap.fc-on .fc-front,.fc-wrap:not(.fc-on) .fc-back{pointer-events:none}' +
    '@media (prefers-reduced-motion:reduce){.fc-wrap{transition:none}}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var flippedId = null;

  function heights(w) { var f = w._front.firstElementChild, b = w._back; return { f: f ? f.offsetHeight : 0, b: b.scrollHeight }; }
  // the height follows the face that is showing, switching as the card passes edge-on (90 degrees)
  function setHeight(w, back) { var h = heights(w); w.style.height = (back ? h.b : h.f) + 'px'; }
  function paint(w) {
    var back = Math.cos(w._x * Math.PI / 180) < 0; if (back !== w._vis) { w._vis = back; setHeight(w, back); }
    w._in.style.transform = 'scale(' + w._scale.toFixed(4) + ') rotateX(' + w._tx.toFixed(2) + 'deg) rotateY(' + (w._x + w._ty).toFixed(2) + 'deg)'; }
  // the spring: angle x moves toward the target with stiffness / damping (unit mass), stepped at 120 Hz
  function run(w) {
    if (w._raf) return; var last = performance.now();
    var step = function (t) {
      var dt = Math.min(0.05, (t - last) / 1000); last = t;
      if (!w._drag) { var n = Math.max(1, Math.round(dt * 120)), h = dt / n; for (var i = 0; i < n; i++) { var a = O.stiffness * (w._target - w._x) - O.damping * w._v; w._v += a * h; w._x += w._v * h; } }
      w._scale += ((w._hover ? O.hoverScale : 1) - w._scale) * 0.2; w._tx += (w._ttx - w._tx) * 0.2; w._ty += (w._tty - w._ty) * 0.2;
      paint(w);
      var rest = !w._drag && Math.abs(w._target - w._x) < 0.05 && Math.abs(w._v) < 0.05 && Math.abs(w._scale - (w._hover ? O.hoverScale : 1)) < 0.001 && Math.abs(w._tx - w._ttx) < 0.05 && Math.abs(w._ty - w._tty) < 0.05;
      if (rest) { w._x = w._target; w._v = 0; paint(w); w._raf = 0; return; }
      w._raf = requestAnimationFrame(step);
    };
    w._raf = requestAnimationFrame(step);
  }
  function settle(w, target, instant) {
    w._target = target; var on = Math.abs(target % 360) === 180;
    w.classList.toggle('fc-on', on);
    if (instant || reduce) { w._x = target; w._v = 0; paint(w); } else run(w);
    if (on !== w._on) { w._on = on; flippedId = on ? w._id : (flippedId === w._id ? null : flippedId); document.dispatchEvent(new CustomEvent('flipcard', { detail: { id: w._id, flipped: on } })); }
  }
  // the back: the Movement card, with the flip-back hint inside it
  function fillBack(w, html) {
    w._back.innerHTML = html; var tip = '<span class="fc-tip">Tap or swipe to flip back</span>', m = w._back.querySelector('.mvg');
    if (m) m.insertAdjacentHTML('beforeend', tip); else w._back.insertAdjacentHTML('beforeend', tip);
  }
  function wrap(el, id, backHtml) {
    var w = document.createElement('div'); w.className = 'fc-wrap'; w._id = id;
    w.innerHTML = '<div class="fc-in"><div class="fc-face fc-front"></div><div class="fc-face fc-back"></div></div><div class="fc-glare"></div>';
    el.parentNode.insertBefore(w, el);
    w._in = w.firstChild; w._front = w._in.firstChild; w._back = w._in.lastChild; w._front.appendChild(el);
    fillBack(w, backHtml);
    w._x = 0; w._v = 0; w._target = 0; w._on = false; w._scale = 1; w._tx = 0; w._ty = 0; w._ttx = 0; w._tty = 0;
    w._vis = false; setHeight(w, false); paint(w); hook(w); return w;
  }
  function hook(w) {
    var sx = 0, sy = 0, base = 0, moved = false, down = false, lastX = 0, lastT = 0, vel = 0, pid = null;
    // tilt, glare and the hover scale follow a mouse
    w.addEventListener('pointermove', function (e) {
      if (e.pointerType === 'mouse' && !w._drag) {
        var r = w.getBoundingClientRect(), px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
        w._ttx = -(py - 0.5) * 2 * O.tiltMax; w._tty = (px - 0.5) * 2 * O.tiltMax; w._hover = true; w.classList.add('fc-hov');
        w.style.setProperty('--gx', (px * 100).toFixed(1) + '%'); w.style.setProperty('--gy', (py * 100).toFixed(1) + '%'); run(w);
      }
      if (!down) return;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (!w._drag && Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy) * 1.2) { w._drag = true; moved = true; try { w.setPointerCapture(pid); } catch (x) {} }
      if (w._drag) {
        var t = performance.now(); vel = (e.clientX - lastX) / Math.max(1, t - lastT) * 1000 * O.drag; lastX = e.clientX; lastT = t;
        w._x = base + dx * O.drag; run(w);
        var r2 = w.getBoundingClientRect(); w.style.setProperty('--gx', ((e.clientX - r2.left) / r2.width * 100).toFixed(1) + '%'); w.style.setProperty('--gy', ((e.clientY - r2.top) / r2.height * 100).toFixed(1) + '%'); w.classList.add('fc-hov');
      }
    });
    w.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') { w._hover = false; w._ttx = 0; w._tty = 0; w.classList.remove('fc-hov'); run(w); } });
    var sideScroll = function (t) { for (var n = t; n && n !== w; n = n.parentElement) { if (/^(INPUT|SELECT|TEXTAREA)$/.test(n.tagName)) return true; if (n.scrollWidth > n.clientWidth + 2) { var ox = getComputedStyle(n).overflowX; if (ox === 'auto' || ox === 'scroll') return true; } } return false; };
    w.addEventListener('pointerdown', function (e) { if (e.button || sideScroll(e.target)) return; down = true; moved = false; sx = lastX = e.clientX; sy = e.clientY; lastT = performance.now(); base = w._x; vel = 0; pid = e.pointerId; });
    var up = function () {
      if (!down) return; down = false;
      if (w._drag) {
        w._drag = false; if (w.matches && !w.matches(':hover')) w.classList.remove('fc-hov');
        var proj = w._x + vel * 0.18; settle(w, Math.round(proj / 180) * 180); w._v = vel;
        setTimeout(function () { moved = false; }, 350); // a swipe swallows only its own click, never the next tap
      }
    };
    w.addEventListener('pointerup', up); w.addEventListener('pointercancel', up);
    // a swipe is not a tap; on the back, a tap (or its title) flips back (flipOnClick)
    w.addEventListener('click', function (e) {
      if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; return; }
      if (!w._on || !w._back.contains(e.target)) return;
      var b = e.target.closest('button,a,[data-npwhy],[data-getclose]');
      if (b && !b.hasAttribute('data-goboard')) return; // the Movement card's own buttons still work
      e.stopPropagation(); e.preventDefault(); settle(w, w._target - 180);
    }, true);
    if (window.ResizeObserver) { var ro = new ResizeObserver(function () { if (w.isConnected) setHeight(w, w._vis); else ro.disconnect(); }); if (w._front.firstElementChild) ro.observe(w._front.firstElementChild); ro.observe(w._back); }
  }
  function toggle(el, id, backHtml) {
    if (!el || !backHtml) return false;
    var w = el.parentNode && el.parentNode.classList.contains('fc-front') ? el.parentNode.parentNode.parentNode : null;
    if (!w) w = wrap(el, id, backHtml); else { fillBack(w, backHtml); if (w._vis) setHeight(w, true); }
    requestAnimationFrame(function () { settle(w, w._on ? w._target - 180 : w._target + 180); });
    return true;
  }
  // after the page draws: every open card with a Movement card (it shows a [data-gomove] %) is wrapped, so a swipe flips it straight away;
  // the card that was flipped is flipped again at once (no animation), with a fresh Movement card
  function sync(backHtmlOf) {
    var seen = {}, keep = false;
    document.querySelectorAll('[data-gomove]').forEach(function (t) {
      if (t.closest('.fc-back,.spl-in')) return;
      var id = t.getAttribute('data-gomove'), el = t.closest('.m') || t.closest('.card');
      if (!el || seen[id] || (el.parentNode && el.parentNode.classList && el.parentNode.classList.contains('fc-front'))) return; seen[id] = 1;
      var html = backHtmlOf(id); if (!html) return;
      var w = wrap(el, id, html);
      if (id === flippedId) { keep = true; settle(w, 180, true); }
    });
    if (flippedId && !keep) flippedId = null;
  }
  // one shared resize listener for every card on the page (a listener per card was never removed and kept every redrawn card alive)
  window.addEventListener('resize', function () { document.querySelectorAll('.fc-wrap').forEach(function (w) { if (w._back) setHeight(w, w._vis); }); });
  window.FlipCard = { toggle: toggle, sync: sync, reapply: sync, isFlipped: function (id) { return flippedId === id; } };
})();
