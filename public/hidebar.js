/* Top bar (Home / Soccer / NHL / Brew) hides when you scroll down and comes back as soon as you scroll up.
   Display only: it never touches data or links. It sticks to the top as before; this only slides it out of view. */
(function () {
  var bar = document.getElementById('hub-bar');
  if (!bar) return;
  var st = document.createElement('style');
  st.textContent = '#hub-bar{transition:transform .28s ease,opacity .2s ease}#hub-bar.hb-hide{transform:translateY(-110%);opacity:0;pointer-events:none}' +
    '@media (prefers-reduced-motion:reduce){#hub-bar{transition:none}}';
  document.head.appendChild(st);
  var last = window.pageYOffset || 0, ticking = false, MIN = 6, TOP = 80;
  function update() {
    ticking = false;
    var y = Math.max(0, window.pageYOffset || document.documentElement.scrollTop || 0), d = y - last;
    if (y <= TOP) bar.classList.remove('hb-hide');             // near the top: always shown
    else if (d > MIN) bar.classList.add('hb-hide');            // scrolling down: hidden
    else if (d < -MIN) bar.classList.remove('hb-hide');        // scrolling up: shown
    if (Math.abs(d) > MIN || y <= TOP) last = y;
  }
  window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
})();
