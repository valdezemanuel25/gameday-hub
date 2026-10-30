/* PatternWaves backdrop (vanilla WebGL port of the React <PatternWaves> settings the Hub uses).
   One full-screen canvas fixed behind the page. Dot colour comes from the page:
     <script src="/waves.js" data-color="#C8FF2E" defer></script>
   Settings mirror: preset/wave "silk", pattern "dot", fade "edges", interactive, cursorSize 50,
   cursorStrength .6, spacing 9, markSize .95, depth .95, light 0, shine .8, contrast 1.2,
   speed .12, scale 1, direction 20, opacity 1, fadeSize .5, intro, paused false.
   Display only: it reads nothing from the Hub and changes nothing. */
(function () {
  var me = document.currentScript;
  var O = {
    color: (me && me.dataset.color) || '#ffffff',
    cursorSize: 50, cursorStrength: 0.6, spacing: 9, markSize: 0.95, depth: 0.95,
    light: 0, shine: 0.8, contrast: 1.2, speed: 0.12, scale: 1, direction: 20,
    opacity: +((me && me.dataset.opacity) || 1), fadeSize: 0.5, intro: true, paused: false
  };
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function start() {
    var cv = document.createElement('canvas');
    cv.id = 'pw-bg';
    cv.setAttribute('aria-hidden', 'true');
    cv.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;height:100dvh;pointer-events:none;z-index:0;display:block';
    document.body.insertBefore(cv, document.body.firstChild);
    var st = document.createElement('style');
    st.textContent = '.m,.bd,.tile,.box,.mvg,.alert,.note,.xq{-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px)}';
    document.head.appendChild(st);
    var gl = cv.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false });
    if (!gl) { cv.remove(); return; }

    var vs = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
    var fs = [
      'precision highp float;',
      'uniform vec2 R;uniform float T,DPR,SP,MS,DE,LI,SH,CO,SC,DIR,OP,FS,IN,CS,CST;uniform vec3 C;uniform vec2 M;uniform float MA;',
      // silk: long, slow, folded sine layers along a rotated axis
      'float silk(vec2 p,float t){',
      '  float a=radians(DIR);mat2 r=mat2(cos(a),-sin(a),sin(a),cos(a));vec2 q=r*p/(SC*150.);',
      '  float h=sin(q.x*1.10+t*0.9+sin(q.y*0.80-t*0.5)*1.6);',
      '  h+=0.55*sin(q.x*0.55-q.y*1.35+t*0.7+sin(q.x*0.9+t*0.3));',
      '  h+=0.30*sin(q.y*2.10+q.x*0.40-t*1.1);',
      '  return h/1.85;}',
      'void main(){',
      '  vec2 px=vec2(gl_FragCoord.x,R.y-gl_FragCoord.y)/DPR;vec2 vp=R/DPR;',
      '  float t=T;',
      '  float h=silk(px,t);',
      // slope for shine
      '  float e=2.;vec2 g=vec2(silk(px+vec2(e,0.),t)-h,silk(px+vec2(0.,e),t)-h)/e;',
      // cursor push
      '  vec2 dm=px-M;float dd=length(dm);float cf=MA*exp(-(dd*dd)/(CS*CS*1.6));',
      '  vec2 off=(dd>0.?dm/dd:vec2(0.))*cf*CST*SP*1.6 + vec2(g.y,-g.x)*DE*SP*40.;',
      '  vec2 p=px-off;',
      '  vec2 cell=(floor(p/SP)+.5)*SP;float d=length(p-cell);',
      // brightness: wave height, contrast, shine highlight, ambient light, cursor glow
      '  float b=h*.5+.5;b=clamp((b-.5)*CO+.5,0.,1.);b=pow(b,1.8);',
      '  float sp=pow(clamp(dot(normalize(vec3(-g*150.,1.)),normalize(vec3(.35,-.45,1.))),0.,1.),18.)*SH;',
      '  b=clamp(b*(1.-LI*.0)+LI*.25+sp*.9+cf*CST*.6,0.,1.);',
      '  float rad=SP*.5*MS*(.18+.82*b);',
      '  float dot_=1.-smoothstep(rad-.9,rad+.3,d);',
      // fade edges
      '  vec2 uv=px/vp;float ed=min(min(uv.x,1.-uv.x),min(uv.y,1.-uv.y));',
      '  float fade=smoothstep(0.,FS*.5,ed);',
      // intro: radial reveal from the centre
      '  float rv=smoothstep(IN*1.25-.25,IN*1.25,1.-length(uv-.5)*1.3);',
      '  float a=dot_*(.05+.95*b)*fade*OP*IN*mix(1.,rv,1.-IN);',
      '  vec3 col=mix(C,vec3(1.),sp*.55+cf*.25);',
      '  gl_FragColor=vec4(col*a,a);}'
    ].join('\n');

    function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; }
    var pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { cv.remove(); return; }
    gl.useProgram(pr);
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var al = gl.getAttribLocation(pr, 'a');
    gl.enableVertexAttribArray(al);
    gl.vertexAttribPointer(al, 2, gl.FLOAT, false, 0, 0);
    var U = {};
    'R T DPR SP MS DE LI SH CO SC DIR OP FS IN CS CST C M MA'.split(' ').forEach(function (k) { U[k] = gl.getUniformLocation(pr, k); });

    var hex = O.color.replace('#', '');
    if (hex.length === 3) hex = hex.replace(/./g, '$&$&');
    var rgb = [0, 2, 4].map(function (i) { return parseInt(hex.substr(i, 2), 16) / 255; });
    gl.uniform3f(U.C, rgb[0], rgb[1], rgb[2]);
    // window.pwSetColor('#rrggbb'): fade the dots to a new colour over ~0.8s (the home screen uses it)
    var cur = rgb.slice(), tgt = rgb.slice();
    window.pwSetColor = function (h) {
      h = String(h).replace('#', ''); if (h.length === 3) h = h.replace(/./g, '$&$&');
      tgt = [0, 2, 4].map(function (i) { return parseInt(h.substr(i, 2), 16) / 255; });
      if (!raf && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); } // wake a stopped (reduced-motion) loop
    };
    gl.uniform1f(U.SP, O.spacing); gl.uniform1f(U.MS, O.markSize); gl.uniform1f(U.DE, O.depth);
    gl.uniform1f(U.LI, O.light); gl.uniform1f(U.SH, O.shine); gl.uniform1f(U.CO, O.contrast);
    gl.uniform1f(U.SC, O.scale); gl.uniform1f(U.DIR, O.direction); gl.uniform1f(U.OP, O.opacity);
    gl.uniform1f(U.FS, O.fadeSize); gl.uniform1f(U.CS, O.cursorSize); gl.uniform1f(U.CST, O.cursorStrength);

    var dpr = 1;
    function size() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      var w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      gl.viewport(0, 0, w, h);
      gl.uniform2f(U.R, w, h); gl.uniform1f(U.DPR, dpr);
    }
    size();
    addEventListener('resize', size);

    // interactive cursor (canvas ignores clicks; we listen on the window so the page stays usable)
    var mx = -9999, my = -9999, ma = 0, mt = 0;
    function mv(e) { var p = e.touches ? e.touches[0] : e; mx = p.clientX; my = p.clientY; mt = 1; }
    addEventListener('pointermove', mv, { passive: true });
    addEventListener('touchmove', mv, { passive: true });
    document.addEventListener('pointerleave', function () { mt = 0; });
    addEventListener('blur', function () { mt = 0; });

    var t0 = performance.now(), last = t0, time = 0, raf = 0;
    function frame(now) {
      var dt = Math.min((now - last) / 1000, 0.05); last = now;
      if (!O.paused && !reduce) time += dt * O.speed * 25.714; // speed 0.35 = the first preview's pace
      ma += (mt - ma) * Math.min(dt * 6, 1);
      var intro = O.intro && !reduce ? Math.min((now - t0) / 1800, 1) : 1;
      intro = 1 - Math.pow(1 - intro, 3);
      gl.uniform1f(U.T, time + 36.0);
      gl.uniform1f(U.IN, intro);
      gl.uniform2f(U.M, mx, my); gl.uniform1f(U.MA, ma);
      if (cur[0] !== tgt[0] || cur[1] !== tgt[1] || cur[2] !== tgt[2]) {
        var k = Math.min(dt * 4, 1), done = true;
        for (var ci = 0; ci < 3; ci++) { cur[ci] += (tgt[ci] - cur[ci]) * k; if (Math.abs(tgt[ci] - cur[ci]) < 0.002) cur[ci] = tgt[ci]; else done = false; }
        gl.uniform3f(U.C, cur[0], cur[1], cur[2]);
      }
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      var fading = cur[0] !== tgt[0] || cur[1] !== tgt[1] || cur[2] !== tgt[2];
      raf = (reduce && intro >= 1 && !fading) ? 0 : requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    // save battery: stop drawing while the tab is hidden
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
      else if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
    });
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
