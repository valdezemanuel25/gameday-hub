// Spotlight pop-up (Nov 3, 2026): a game's Board card opened over the Movement tab, in a "spotlight card": a soft white light follows the
// pointer (or finger) across the card, the border glows when the pointer is near it, with a small flare on the border. Written for the
// Hub in plain JavaScript after React Bits' SpotlightCard, with these settings: theme dark, spotlightColor #ffffff, intensity 0.15,
// spotlightSize 240, softness 0.7, shape circle, borderGlow 0.6, proximity 80, smoothing 0.3, grain 0, ambient off, flare on.
// Spotlight.open(html, fromEl) shows it; tap outside, the x, or Esc closes it. Display only: the card inside is read-only.
(function () {
  var O = { color: '255,255,255', intensity: 0.15, size: 240, softness: 0.7, borderGlow: 0.6, proximity: 80, smoothing: 0.3, flare: true };
  var css = '' +
    '.spl-back{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(3,4,3,.62);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);opacity:0;transition:opacity .22s ease}' +
    '.spl-back.on{opacity:1}' +
    '.spl-card{position:relative;width:100%;max-height:min(78vh,900px);display:flex;flex-direction:column;overflow:hidden;border-radius:20px;background:rgba(14,16,14,.94);border:1px solid rgba(255,255,255,.09);box-shadow:0 30px 80px rgba(0,0,0,.6);' +
      'transform:translate(var(--dx,0),var(--dy,0)) scale(.86);opacity:0;transition:transform .42s cubic-bezier(.2,1.3,.35,1),opacity .25s ease;--sx:-999px;--sy:-999px;--sa:0;--ga:0}' +
    '.spl-scroll{overflow:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:6px;border-radius:inherit}' +
    '.spl-frame{position:relative;width:min(560px,100%)}' +
    '.spl-back.on .spl-card{transform:none;opacity:1}' +
    '.spl-back.off .spl-card{transform:scale(.94);opacity:0;transition:transform .18s ease,opacity .18s ease}' +
    // the spotlight: a circle of light under the pointer, soft edge (softness 0.7: full light only in the inner 30%)
    '.spl-light{position:absolute;inset:0;pointer-events:none;border-radius:inherit;z-index:2;opacity:var(--sa);transition:opacity .25s ease;' +
      'background:radial-gradient(circle ' + O.size + 'px at var(--sx) var(--sy),rgba(' + O.color + ',' + O.intensity + ') 0%,rgba(' + O.color + ',' + O.intensity + ') ' + Math.round((1 - O.softness) * 100) + '%,rgba(' + O.color + ',0) 100%)}' +
    // the border glow: the same light, only on the 1.5px border ring, stronger (borderGlow 0.6), when the pointer is within 80px of an edge
    '.spl-ring{position:absolute;inset:0;pointer-events:none;border-radius:inherit;z-index:3;padding:1.5px;opacity:var(--ga);' +
      'background:radial-gradient(circle ' + Math.round(O.size * 0.75) + 'px at var(--sx) var(--sy),rgba(' + O.color + ',' + O.borderGlow + ') 0%,rgba(' + O.color + ',0) 70%);' +
      '-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box exclude,linear-gradient(#000 0 0)}' +
    // the flare: a small bright point on the border nearest the pointer
    '.spl-flare{position:absolute;width:90px;height:3px;left:var(--fx);top:var(--fy);transform:translate(-50%,-50%) rotate(var(--fr,0deg));pointer-events:none;z-index:4;opacity:var(--ga);' +
      'background:radial-gradient(ellipse at center,rgba(255,255,255,.95) 0%,rgba(255,255,255,.35) 35%,rgba(255,255,255,0) 70%);filter:blur(.4px)}' +
    '.spl-x{display:block;margin:12px auto 0;position:relative;z-index:6;width:40px;height:40px;border-radius:50%;border:1px solid rgba(255,255,255,.16);background:rgba(10,12,10,.7);color:#fff;font-size:20px;line-height:1;cursor:pointer}' +
    '.spl-in{position:relative;z-index:1}' +
    // read-only inside: the card\'s own buttons do nothing here (its More details still opens)
    '.spl-in button,.spl-in input,.spl-in select,.spl-in textarea,.spl-in [data-gomove],.spl-in [data-goboard]{pointer-events:none}' +
    '@media (prefers-reduced-motion:reduce){.spl-card,.spl-back{transition:none!important}}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  var back = null, raf = 0;
  function close() {
    if (!back) return; var b = back; back = null; cancelAnimationFrame(raf);
    b.classList.remove('on'); b.classList.add('off'); setTimeout(function () { b.remove(); }, 220);
    document.removeEventListener('keydown', onKey); document.documentElement.style.overflow = '';
  }
  function onKey(e) { if (e.key === 'Escape') close(); }
  function open(html, fromEl) {
    close();
    back = document.createElement('div'); back.className = 'spl-back';
    back.innerHTML = '<div class="spl-frame"><div class="spl-card" role="dialog" aria-modal="true"><div class="spl-light"></div><div class="spl-ring"></div>' + (O.flare ? '<div class="spl-flare"></div>' : '') +
      '<div class="spl-scroll"><div class="spl-in">' + html + '</div></div></div><button type="button" class="spl-x" aria-label="Close">×</button></div>';
    document.body.appendChild(back); document.documentElement.style.overflow = 'hidden';
    var card = back.querySelector('.spl-card');
    // pop out from the tapped title
    if (fromEl && fromEl.getBoundingClientRect) { var r = fromEl.getBoundingClientRect(); card.style.setProperty('--dx', Math.round(r.left + r.width / 2 - innerWidth / 2) * 0.35 + 'px'); card.style.setProperty('--dy', Math.round(r.top + r.height / 2 - innerHeight / 2) * 0.35 + 'px'); }
    requestAnimationFrame(function () { requestAnimationFrame(function () { if (back) back.classList.add('on'); }); });
    back.addEventListener('click', function (e) { if (e.target === back || e.target.closest('.spl-x')) close(); });
    document.addEventListener('keydown', onKey);
    // pointer light, smoothed (smoothing 0.3: each frame moves 70% of the way to the pointer)
    var tx = -999, ty = -999, x = -999, y = -999, on = false;
    var move = function (e) { var p = e.touches ? e.touches[0] : e, r = card.getBoundingClientRect(); tx = p.clientX - r.left; ty = p.clientY - r.top; if (x < -900) { x = tx; y = ty; } on = true; };
    card.addEventListener('pointermove', move); card.addEventListener('touchmove', move, { passive: true }); card.addEventListener('touchstart', move, { passive: true });
    card.addEventListener('pointerleave', function () { on = false; });
    var tick = function () {
      if (!back) return;
      x += (tx - x) * (1 - O.smoothing); y += (ty - y) * (1 - O.smoothing);
      card.style.setProperty('--sx', x + 'px'); card.style.setProperty('--sy', y + 'px'); card.style.setProperty('--sa', on ? 1 : 0);
      // border: glow fades in within 80px of the nearest edge; the flare sits on that edge
      var w = card.clientWidth, h = card.clientHeight, d = Math.min(x, w - x, y, h - y), g = on ? Math.max(0, 1 - d / O.proximity) : 0;
      card.style.setProperty('--ga', g.toFixed(3));
      var e2 = [[x, 0, 0], [x, h, 0], [0, y, 90], [w, y, 90]][[y, h - y, x, w - x].indexOf(d)] || [x, 0, 0];
      card.style.setProperty('--fx', e2[0] + 'px'); card.style.setProperty('--fy', e2[1] + 'px'); card.style.setProperty('--fr', e2[2] + 'deg');
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }
  window.Spotlight = { open: open, close: close };
})();
