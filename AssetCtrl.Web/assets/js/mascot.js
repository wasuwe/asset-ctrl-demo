/*
 * "Little PC" mascot, drawn as inline SVG and animated with requestAnimationFrame (no libraries).
 *
 *   AC.mascot.errorScene(el)   error page illustration: happy → unplugged → broken → bandage, played once, then holds
 *   AC.mascot.greet(name)      the PC peeks up in the bottom-right corner and says hi (after signing in)
 *
 * Ported from the "Error Page Animation" prototype (error-scene.jsx). Timings are in seconds.
 * prefers-reduced-motion: the error scene shows one still frame and the greeting does not move.
 */
(function () {
  'use strict';

  var INK = '#2B2622', BODY = '#EFE3CC', SCREEN = '#1F3B3A', GLOW = '#9BEFC9', ACCENT = '#F0735A';

  /** Scene starts (running sum of the prototype's scene durations: 2.6, 1.4, 2.5, 4, 1.5). */
  var C = { Happy: 0, Unplug: 2.6, Broken: 4.0, Message: 6.5, Reboot: 10.5 };
  /**
   * The error story plays once and then holds on the bandaged pose (just before the reboot).
   * Story-driven values use the story time (clamped at HOLD); ongoing idle motion (wobble,
   * dizzy stars, smoke) uses CLOCK, the real elapsed time, so the held pose still breathes.
   */
  var HOLD = C.Reboot - 0.1;
  var CLOCK = 0;

  var Ease = {
    outCubic: function (t) { t -= 1; return t * t * t + 1; },
    inOutCubic: function (t) { return t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1; },
    outBack: function (t) { var c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  };
  function tween(ease) {
    return function (from, to, start, end, T) {
      if (T <= start) { return from; }
      if (T >= end) { return to; }
      return from + (to - from) * ease((T - start) / (end - start));
    };
  }
  var enter = tween(Ease.outCubic), draw = tween(Ease.inOutCubic), pop = tween(Ease.outBack);
  function win(T, a, b) { return T >= a && T < b; }
  function n(v) { return Math.round(v * 100) / 100; }

  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  var uidSeq = 0;

  /* ------------------------------------------------------------- drawing */

  function star(x, y, r, fill, rot, op) {
    var pts = [];
    for (var i = 0; i < 10; i++) {
      var rr = i % 2 ? r * 0.45 : r, a = (Math.PI / 5) * i - Math.PI / 2;
      pts.push(n(Math.cos(a) * rr) + ',' + n(Math.sin(a) * rr));
    }
    return '<polygon points="' + pts.join(' ') + '" fill="' + fill + '" stroke="' + INK + '" stroke-width="4" stroke-linejoin="round"'
      + ' transform="translate(' + n(x) + ' ' + n(y) + ') rotate(' + n(rot || 0) + ')" opacity="' + (op === undefined ? 1 : n(op)) + '"/>';
  }

  function happyFace(T, dx, col, op) {
    var blink = win(T, 1.3, 1.45) || win(T, C.Reboot + 1.0, C.Reboot + 1.15) ? 0.12 : 1;
    var happyPop = T >= C.Reboot + 0.5 ? pop(0.6, 1, C.Reboot + 0.5, C.Reboot + 0.85, T) : 1;
    return '<g transform="translate(' + n(dx) + ' 0)" opacity="' + op + '">'
      + '<g transform="translate(300 215) scale(' + n(happyPop) + ') translate(-300 -215)">'
      + '<ellipse cx="240" cy="200" rx="17" ry="' + n(20 * blink) + '" fill="' + col + '"/>'
      + '<ellipse cx="360" cy="200" rx="17" ry="' + n(20 * blink) + '" fill="' + col + '"/>'
      + '<path d="M262 252 Q300 290 338 252" stroke="' + col + '" stroke-width="10" fill="none" stroke-linecap="round"/>'
      + '<ellipse cx="205" cy="250" rx="18" ry="10" fill="' + ACCENT + '" opacity="0.55"/>'
      + '<ellipse cx="395" cy="250" rx="18" ry="10" fill="' + ACCENT + '" opacity="0.55"/>'
      + '</g></g>';
  }

  function face(T) {
    var brokenOn = T >= C.Broken && T < C.Reboot + 0.5;
    var glitch = win(T, C.Unplug + 0.4, C.Broken);
    if (glitch) {
      var k = Math.floor(T * 24) % 3;
      return happyFace(T, -8 - k * 3, '#FF6F91', 0.8) + happyFace(T, 8 + k * 3, '#59D8FF', 0.8) + happyFace(T, 0, GLOW, k === 1 ? 0.3 : 1);
    }
    if (brokenOn) {
      var fade = enter(1, 0, C.Reboot + 0.35, C.Reboot + 0.5, T);
      var brokenPop = pop(0.5, 1, C.Broken, C.Broken + 0.35, T);
      var wob = Math.sin(CLOCK * 5) * 4;
      var eyes = [240, 360].map(function (cx) {
        return '<g stroke="' + GLOW + '" stroke-width="10" stroke-linecap="round">'
          + '<line x1="' + (cx - 16) + '" y1="184" x2="' + (cx + 16) + '" y2="216"/><line x1="' + (cx + 16) + '" y1="184" x2="' + (cx - 16) + '" y2="216"/></g>';
      }).join('');
      return '<g opacity="' + n(fade) + '" transform="translate(300 215) scale(' + n(brokenPop) + ') rotate(' + n(wob * 0.5) + ') translate(-300 -215)">'
        + eyes
        + '<path d="M252 268 q12 -14 24 0 t24 0 t24 0 t24 0" stroke="' + GLOW + '" stroke-width="9" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
        + '<path d="M318 270 q8 26 18 0" fill="' + ACCENT + '" stroke="' + INK + '" stroke-width="3"/></g>';
    }
    return happyFace(T, 0, GLOW, 1);
  }

  /** A waving arm on the right side of the monitor (greeting only). angle in degrees. */
  function arm(angle) {
    return '<g transform="rotate(' + n(angle) + ' 536 262)">'
      + '<path class="ac-mascot-line" d="M532 262 Q596 252 604 180" stroke="' + INK + '" stroke-width="26" fill="none" stroke-linecap="round"/>'
      + '<path d="M532 262 Q596 252 604 180" stroke="' + BODY + '" stroke-width="12" fill="none" stroke-linecap="round"/>'
      + '<circle cx="604" cy="168" r="24" fill="' + BODY + '" stroke="' + INK + '" stroke-width="8"/></g>';
  }

  /**
   * The PC in its own 600×540 coordinates.
   * opts: { uid, wave (arm angle in degrees, greeting only), bobT (clock for the bob when T loops),
   *         damage (0-3, error page: one level per failed "Try again"), damageT (seconds since the last level was added) }
   */
  function pc(T, opts) {
    var u = C.Unplug, b = C.Broken, m = C.Message, r = C.Reboot;
    var glitch = win(T, u + 0.4, b);
    var shake = glitch ? Math.sin(T * 90) * 10 * (1 - (T - u - 0.4) / (b - u - 0.4)) : 0;
    var bobW = T < u ? 1 : T >= r + 0.5 ? enter(0, 1, r + 0.5, r + 1.2, T) : 0;
    var bob = Math.sin(((opts.bobT === undefined ? T : opts.bobT) / 1.5) * Math.PI * 2) * 7 * bobW;
    var slump = pop(0, 1, b, b + 0.5, T) * (1 - pop(0, 1, r + 0.4, r + 0.8, T));
    var anticip = draw(0, 1, u, u + 0.35, T) * (1 - enter(0, 1, u + 0.35, u + 0.5, T));
    var sx = 1 + anticip * 0.04 + slump * 0.02, sy = 1 - anticip * 0.05 - slump * 0.04;
    var rot = slump * -4 + Math.sin(CLOCK * 2.2) * slump * 1.5;
    var crack = draw(1, 0, b, b + 0.4, T);
    var healed = enter(1, 0, r + 0.4, r + 0.6, T);
    var flicker = glitch && Math.floor(T * 18) % 2 === 0;
    var flash = win(T, r + 0.38, r + 0.6) ? enter(1, 0, r + 0.38, r + 0.6, T) : 0;
    var led = T >= u + 0.4 && T < r + 0.4 ? ACCENT : '#7BD389';
    var bandage = pop(0, 1, m + 0.9, m + 1.25, T) * healed;
    var sweat = pop(0, 1, m + 0.4, m + 0.7, T) * healed;
    var sweatY = enter(0, 30, m + 0.7, m + 2.6, T);
    var clip = 'ac-scr-' + opts.uid;

    // Extra damage per failed retry. A level's parts pop in when it is reached, then stay.
    var dmg = opts.damage || 0, dt = opts.damageT === undefined ? 99 : opts.damageT;
    var part = function (level) { return dmg < level ? 0 : dmg > level ? 1 : pop(0, 1, 0, 0.35, dt); };
    var crackIn = function (level) { return dmg < level ? 1 : dmg > level ? 0 : draw(1, 0, 0, 0.4, dt); }; // dash offset
    if (dmg && dt < 0.45) { shake += Math.sin(CLOCK * 90) * 9 * (1 - dt / 0.45); } // jolt when it gets worse
    var fit = dmg >= 2 && (CLOCK % 2.4) < 0.2;          // level 2+: the screen has short fits
    if (fit) { glitch = true; flicker = Math.floor(CLOCK * 18) % 2 === 0; }
    if (dmg >= 3) { rot -= 3; if (Math.floor(CLOCK * 4) % 2) { led = '#5B1D12'; } } // level 3: droops more, LED blinks
    var sparkP = dmg >= 3 ? CLOCK % 1.6 : 9;
    var spark = sparkP < 0.35 ? pop(0, 1, 0, 0.15, sparkP) * enter(1, 0, 0.15, 0.35, sparkP) : 0;
    var extraCracks = ''
      + (dmg >= 1 ? '<path d="M104 300 L160 262 L148 236 L206 200 M160 262 L198 288" stroke="#E9FFF5" stroke-width="4" fill="none" stroke-linejoin="round" stroke-linecap="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="' + n(crackIn(1)) + '" opacity="0.85"/>' : '')
      + (dmg >= 3 ? '<path d="M290 80 L312 132 L286 176 L330 236 L310 268 M312 132 L350 124" stroke="#E9FFF5" stroke-width="4" fill="none" stroke-linejoin="round" stroke-linecap="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="' + n(crackIn(3)) + '" opacity="0.85"/>' : '');
    var bandage2 = part(2);

    var bars = '', bt = fit ? CLOCK : T;
    if (glitch) {
      for (var i = 0; i < 4; i++) {
        var s = Math.sin(bt * 37 + i * 11);
        bars += '<rect x="' + n(100 + s * 20) + '" y="' + (90 + ((i * 70 + Math.floor(bt * 30) * 23) % 250)) + '" width="400" height="' + (8 + (i % 2) * 10)
          + '" fill="' + (i % 2 ? '#59D8FF' : '#FF6F91') + '" opacity="0.5"/>';
      }
    }
    var vents = [130, 158, 186].map(function (x) {
      return '<line x1="' + x + '" y1="390" x2="' + x + '" y2="402" stroke="' + INK + '" stroke-width="5" stroke-linecap="round" opacity="0.35"/>';
    }).join('');
    var dots = [[-8, -7], [8, -7], [-8, 7], [8, 7]].map(function (p) {
      return '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="2.6" fill="' + INK + '" opacity="0.5"/>';
    }).join('');

    return '<ellipse cx="300" cy="505" rx="' + n(230 - bob) + '" ry="16" fill="' + INK + '" opacity="0.12"/>'
      + '<g transform="translate(' + n(300 + shake) + ' 500) rotate(' + n(rot) + ') scale(' + n(sx) + ' ' + n(sy) + ') translate(-300 ' + n(-500 + bob * (1 - slump)) + ')">'
      + (opts.wave !== null && opts.wave !== undefined ? arm(opts.wave) : '')
      + '<path d="M250 420 h100 v50 h-100 z" fill="' + BODY + '" stroke="' + INK + '" stroke-width="8" stroke-linejoin="round"/>'
      + '<rect x="170" y="462" width="260" height="38" rx="19" fill="' + BODY + '" stroke="' + INK + '" stroke-width="8"/>'
      + '<rect x="60" y="40" width="480" height="385" rx="52" fill="' + BODY + '" stroke="' + INK + '" stroke-width="8"/>'
      + '<rect x="100" y="80" width="400" height="285" rx="30" fill="' + SCREEN + '" stroke="' + INK + '" stroke-width="6"/>'
      + '<clipPath id="' + clip + '"><rect x="100" y="80" width="400" height="285" rx="30"/></clipPath>'
      + '<g clip-path="url(#' + clip + ')" opacity="' + (flicker ? 0.45 : 1) + '">'
      + '<rect x="100" y="80" width="400" height="285" fill="' + GLOW + '" opacity="0.06"/>'
      + '<path d="M130 105 q20 -12 60 -8" stroke="#fff" stroke-opacity="0.18" stroke-width="10" fill="none" stroke-linecap="round"/>'
      + face(T) + bars
      + '<path d="M478 84 L436 146 L462 172 L408 222 L428 250 L386 304 M436 146 L392 136 L370 160 M408 222 L372 214"'
      + ' stroke="#E9FFF5" stroke-width="4" fill="none" stroke-linejoin="round" stroke-linecap="round"'
      + ' pathLength="1" stroke-dasharray="1" stroke-dashoffset="' + n(crack) + '" opacity="' + n(healed * (T >= b ? 0.85 : 0)) + '"/>'
      + extraCracks
      + '<rect x="100" y="80" width="400" height="285" fill="#fff" opacity="' + n(flash) + '"/>'
      + '</g>'
      + '<circle cx="478" cy="396" r="9" fill="' + led + '" stroke="' + INK + '" stroke-width="4"/>'
      + vents
      + (bandage > 0 ? '<g transform="translate(468 92) rotate(38) scale(' + n(bandage) + ')">'
        + '<rect x="-62" y="-20" width="124" height="40" rx="20" fill="#F7B7A3" stroke="' + INK + '" stroke-width="5"/>'
        + '<rect x="-20" y="-20" width="40" height="40" fill="#FBD3C5" stroke="' + INK + '" stroke-width="5"/>' + dots + '</g>' : '')
      + (bandage2 > 0 ? '<g transform="translate(118 368) rotate(-32) scale(' + n(bandage2) + ')">'
        + '<rect x="-56" y="-18" width="112" height="36" rx="18" fill="#F7B7A3" stroke="' + INK + '" stroke-width="5"/>'
        + '<rect x="-18" y="-18" width="36" height="36" fill="#FBD3C5" stroke="' + INK + '" stroke-width="5"/>' + dots + '</g>' : '')
      + (spark > 0 ? '<g transform="translate(540 64) scale(' + n(spark) + ')">' + star(0, 0, 22, '#FFD45E', CLOCK * 300) + star(26, -20, 10, '#FFFFFF', 0) + '</g>' : '')
      + (sweat > 0.02 ? '<path d="M28 ' + n(120 + sweatY) + ' q14 22 0 34 q-14 -12 0 -34 z" fill="#9FD8FF" stroke="' + INK + '" stroke-width="4"'
        + ' transform="translate(28 ' + n(137 + sweatY) + ') scale(' + n(sweat) + ') translate(-28 ' + n(-137 - sweatY) + ')"/>' : '')
      + '</g>';
  }

  /** Wall outlet, cable and plug (scene coordinates). */
  function cable(T) {
    var u = C.Unplug, r = C.Reboot;
    var wig = win(T, u, u + 0.4) ? Math.sin(T * 60) * 3 : 0;
    var out = enter(0, 1, u + 0.4, u + 0.75, T) * (1 - draw(0, 1, r + 0.05, r + 0.35, T));
    var arc = Math.sin(out * Math.PI) * -60;
    var px = 1352 - out * 90 + wig, py = 622 + out * 66 + arc, prot = out * -70;
    var sparkA = win(T, u + 0.4, u + 0.85) ? pop(0, 1, u + 0.4, u + 0.6, T) * enter(1, 0, u + 0.6, u + 0.85, T) : 0;
    var sparkB = win(T, r + 0.33, r + 0.65) ? pop(0, 1, r + 0.33, r + 0.48, T) * enter(1, 0, r + 0.48, r + 0.65, T) : 0;
    var spark = Math.max(sparkA, sparkB);
    return '<rect x="1366" y="584" width="64" height="80" rx="16" fill="#FFF8EC" stroke="' + INK + '" stroke-width="6"/>'
      + '<circle cx="1388" cy="614" r="5" fill="' + INK + '"/><circle cx="1408" cy="614" r="5" fill="' + INK + '"/>'
      + '<path d="M1388 638 q10 8 20 0" stroke="' + INK + '" stroke-width="4" fill="none" stroke-linecap="round"/>'
      + '<path d="M1195 470 C1270 480 1235 702 1300 702 S ' + n(px - 40) + ' ' + n(py + 10) + ' ' + n(px - 22) + ' ' + n(py) + '"'
      + ' class="ac-mascot-line" stroke="' + INK + '" stroke-width="9" fill="none" stroke-linecap="round"/>'
      + '<g transform="translate(' + n(px) + ' ' + n(py) + ') rotate(' + n(prot) + ')">'
      + '<rect x="-26" y="-15" width="34" height="30" rx="8" fill="#5B5550" stroke="' + INK + '" stroke-width="5"/>'
      + '<rect x="6" y="-11" width="12" height="6" fill="#C9B98F" stroke="' + INK + '" stroke-width="3"/>'
      + '<rect x="6" y="5" width="12" height="6" fill="#C9B98F" stroke="' + INK + '" stroke-width="3"/></g>'
      + (spark > 0 ? '<g transform="translate(1366 624) scale(' + n(spark) + ')">'
        + star(0, 0, 26, '#FFD45E', T * 200) + star(-34, -30, 13, '#FFD45E', -T * 260) + star(-30, 30, 10, '#FFFFFF', 0) + '</g>' : '');
  }

  /**
   * Smoke puffs and dizzy stars while broken (scene coordinates).
   * smoke 0 = the prototype's 3 light puffs, only while broken. Each level (failed "Try again")
   * adds more, bigger, darker puffs, and from level 1 the PC smokes through the whole loop.
   */
  var SMOKE_COLORS = ['#BDB3A4', '#A39888', '#857A6C', '#655B50'];
  function effects(T, smoke) {
    var b = C.Broken, r = C.Reboot, out = '';
    var on = pop(0, 1, b + 0.3, b + 0.7, T) * enter(1, 0, r + 0.25, r + 0.5, T);
    var level = Math.min(smoke || 0, SMOKE_COLORS.length - 1);
    var broken = T >= b + 0.2 && T <= r + 0.3;
    if (level === 0) {
      for (var i = 0; i < 3; i++) {
        var life = 1.8, t0 = b + 0.2 + i * 0.6;
        if (T < t0 || T > r + 0.3) { continue; }
        var p = ((CLOCK - t0) % life) / life;
        out += '<circle cx="' + n(1160 + Math.sin(p * 6 + i) * 14 + p * 30) + '" cy="' + n(250 - p * 150) + '" r="' + n(18 + p * 36)
          + '" fill="' + SMOKE_COLORS[0] + '" opacity="' + n((1 - p) * 0.55) + '"/>';
      }
    } else {
      // A steady stream: count puffs spread evenly over one life, so it never pauses at the loop seam.
      var count = 3 + level * 3, lifeL = 2.2 - level * 0.25, grow = 1 + level * 0.22;
      var dim = broken ? 1 : 0.55; // a little less while the PC is "fine"
      for (var k = 0; k < count; k++) {
        var pk = ((CLOCK + (k * lifeL) / count) % lifeL) / lifeL;
        var drift = Math.sin(k * 2.3) * 22 * level;           // fixed sideways spread per puff
        var src = k % 2 ? 1160 : 1120;                          // two vents on the top of the monitor
        out += '<circle cx="' + n(src + drift * pk + Math.sin(pk * 6 + k) * 14 + pk * 40) + '" cy="' + n(250 - pk * (150 + level * 40))
          + '" r="' + n((18 + pk * 36) * grow) + '" fill="' + SMOKE_COLORS[level] + '" opacity="' + n((1 - pk) * (0.5 + level * 0.1) * dim) + '"/>';
      }
    }
    if (on > 0) {
      for (var j = 0; j < 3; j++) {
        var a = CLOCK * 3.2 + (j * Math.PI * 2) / 3, z = Math.sin(a);
        out += star(960 + Math.cos(a) * 110, 196 + z * 24, (17 + z * 4) * on, j === 1 ? '#FFFFFF' : '#FFD45E', CLOCK * 120);
      }
    }
    return out;
  }

  /* ------------------------------------------------------------ playback */

  /** Run frame(T) every animation frame while el stays in the page. Returns a stop function. */
  function play(el, frame, loop) {
    var start = null, stopped = false;
    function tick(now) {
      if (stopped || !el.isConnected) { return; }
      if (start === null) { start = now; }
      var T = (now - start) / 1000;
      frame(loop ? T % loop : T);
      window.requestAnimationFrame(tick);
    }
    window.requestAnimationFrame(tick);
    return function () { stopped = true; };
  }

  /* ---------------------------------------------------------- error page */

  /**
   * Fill el with the looping error illustration (the error text is regular HTML next to it).
   * Returns { setSmoke(level) } so the page can add smoke after each failed "Try again".
   */
  function errorScene(el) {
    if (!el) { return null; }
    var uid = ++uidSeq, smoke = 0, damageAt = -99, still = reducedMotion(); // smoke = damage level
    el.innerHTML = '<svg class="ac-mascot-scene" viewBox="620 80 850 680" preserveAspectRatio="xMidYMax meet" role="img" aria-hidden="true" focusable="false"></svg>';
    var svg = el.firstChild;
    var lastClock = 0;
    function frame(clock) {
      CLOCK = lastClock = clock; // CLOCK is shared with the greeting, so keep this scene's own copy
      var T = Math.min(clock, HOLD); // story time: plays once, then holds
      var jx = win(T, C.Unplug + 0.4, C.Unplug + 0.8) ? Math.sin(T * 120) * 6 : 0;
      svg.innerHTML = '<g transform="translate(' + n(jx) + ' 0)">'
        + '<rect x="-2000" y="700" width="6000" height="400" class="ac-mascot-floor"/>'
        + '<line class="ac-mascot-line" x1="-2000" y1="700" x2="4000" y2="700" stroke="' + INK + '" stroke-width="6"/>'
        + cable(T)
        + '<g transform="translate(660 200)">' + pc(T, { uid: uid, damage: smoke, damageT: clock - damageAt }) + '</g>'
        + effects(T, smoke) + '</g>';
    }
    var STILL_T = HOLD; // reduced motion: only the final bandaged pose
    if (still) { frame(STILL_T); } else { play(el, frame, 0); }
    return {
      /** Damage level (failed retries): more smoke, cracks, a second bandage, fits and sparks. */
      setSmoke: function (level) {
        smoke = Math.max(0, level | 0);
        damageAt = lastClock;
        if (still) { frame(STILL_T); }
      },
    };
  }

  /* ------------------------------------------------------------ greeting */

  var greeter = null;

  /** The PC peeks up in the bottom-right corner, waves and says hi. Auto-hides; hover keeps it. */
  function greet(name) {
    if (greeter) { greeter.remove(); }
    var t = AC.t, uid = ++uidSeq, still = reducedMotion();
    var box = document.createElement('div');
    box.className = 'ac-greeter' + (still ? ' is-still' : '');
    box.setAttribute('role', 'status');
    box.innerHTML = '<div class="ac-greeter__bubble">'
      + '<button type="button" class="btn-close ac-greeter__close" aria-label="' + AC.esc(t('Close')) + '"></button>'
      + '<div class="ac-greeter__hi">' + AC.esc(name ? t('Hi, {name}!', { name: name }) : t('Hi there!')) + '</div>'
      + '<div class="ac-greeter__sub">' + AC.esc(t('Welcome to {app}.', { app: (AC.state.meta && AC.state.meta.app_name) || 'Asset Ctrl' })) + '</div>'
      + '</div>'
      + '<svg class="ac-greeter__pc" viewBox="40 20 640 500" aria-hidden="true" focusable="false"></svg>';
    document.body.appendChild(box);
    greeter = box;
    var svg = box.querySelector('svg');

    function frame(T) {
      // Happy loop only (blinks at 1.3s every 2.6s). Waves for the first 2.4s, then sways gently.
      CLOCK = T;
      var wave = T < 2.4 ? Math.sin(T * 9) * 20 : Math.sin(T * 2) * 4;
      svg.innerHTML = pc(T % 2.6, { uid: uid, wave: wave, bobT: T });
    }
    if (still) { frame(0.5); } else { play(box, frame, 0); }

    var hideTimer = null;
    function hide() {
      if (!box.isConnected) { return; }
      box.classList.add('is-leaving');
      window.setTimeout(function () { box.remove(); if (greeter === box) { greeter = null; } }, still ? 0 : 450);
    }
    function arm() { window.clearTimeout(hideTimer); hideTimer = window.setTimeout(hide, 6500); }
    box.addEventListener('mouseenter', function () { window.clearTimeout(hideTimer); });
    box.addEventListener('mouseleave', arm);
    box.querySelector('.ac-greeter__close').addEventListener('click', hide);
    arm();
  }

  /* ----------------------------------------------------------- mini badge */

  /**
   * A small PC that comes along with toasts and confirm dialogs. Static SVG; motion is CSS only
   * (pop in, gentle bob, blink; see .ac-mini in theme.css), so many can be on screen at once.
   * mood: 'happy' | 'sad' (errors) | 'thinking' (a question) | 'worried' (a risky choice)
   *       | 'typing' (watching the user fill a form, pencil in hand) | 'ready' (form filled, good to save)
   */
  function miniFace(mood) {
    var eye = function (cx, cy, rx, ry) { return '<ellipse class="ac-mini__eye" cx="' + cx + '" cy="' + cy + '" rx="' + rx + '" ry="' + ry + '" fill="' + GLOW + '"/>'; };
    var line = function (d, w) { return '<path d="' + d + '" stroke="' + GLOW + '" stroke-width="' + (w || 18) + '" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'; };
    var blush = '<ellipse cx="190" cy="262" rx="24" ry="13" fill="' + ACCENT + '" opacity="0.6"/><ellipse cx="410" cy="262" rx="24" ry="13" fill="' + ACCENT + '" opacity="0.6"/>';
    switch (mood) {
      case 'sad':
        return eye(240, 205, 22, 24) + eye(360, 205, 22, 24) + line('M258 296 Q300 256 342 296')
          + '<path class="ac-mini__tear" d="M226 236 q16 26 0 40 q-16 -14 0 -40 z" fill="#9FD8FF" stroke="' + INK + '" stroke-width="7"/>';
      case 'worried':
        return eye(240, 212, 20, 24) + eye(360, 212, 20, 24) + line('M206 178 L262 158', 14) + line('M394 178 L338 158', 14) /* inner ends up = worried, not angry */
          + line('M246 288 q13 -16 27 0 t27 0 t27 0 t27 0', 14) + blush;
      case 'thinking':
        return eye(256, 192, 19, 23) + eye(374, 192, 19, 23) + line('M270 284 h52', 16);
      case 'typing': // eyes down on the form, tongue out in concentration
        return eye(262, 228, 20, 20) + eye(378, 228, 20, 20) + line('M288 300 h48', 14)
          + '<path d="M300 302 q12 22 24 0" fill="' + ACCENT + '" stroke="' + INK + '" stroke-width="6"/>';
      case 'ready': // happy closed eyes ^ ^
        return line('M216 214 q24 -34 48 0', 18) + line('M336 214 q24 -34 48 0', 18) + line('M252 256 Q300 312 348 256') + blush;
      default: // happy
        return eye(240, 200, 22, 26) + eye(360, 200, 22, 26) + line('M252 256 Q300 304 348 256') + blush;
    }
  }

  function badge(mood, size) {
    mood = mood || 'happy';
    var extra = '';
    if (mood === 'thinking') {
      extra = '<text class="ac-mini__mark" x="560" y="120" font-size="170" font-weight="700" font-family="Kanit, sans-serif" fill="' + ACCENT + '" stroke="' + INK + '" stroke-width="8" paint-order="stroke">?</text>';
    } else if (mood === 'worried') {
      extra = '<path class="ac-mini__sweat" d="M560 100 q20 32 0 48 q-20 -16 0 -48 z" fill="#9FD8FF" stroke="' + INK + '" stroke-width="8"/>';
    } else if (mood === 'typing') { // a pencil scribbling at the lower right (outer g places it, inner g animates)
      extra = '<g transform="translate(560 360) rotate(30)"><g class="ac-mini__pencil">'
        + '<rect x="-20" y="-150" width="40" height="34" rx="8" fill="#F7B7A8" stroke="' + INK + '" stroke-width="8"/>'
        + '<rect x="-20" y="-118" width="40" height="130" fill="' + ACCENT + '" stroke="' + INK + '" stroke-width="8"/>'
        + '<path d="M-20 12 L20 12 L0 56 Z" fill="#F3D9A4" stroke="' + INK + '" stroke-width="8" stroke-linejoin="round"/>'
        + '<path d="M-7 42 L7 42 L0 56 Z" fill="' + INK + '"/></g></g>';
    } else if (mood === 'ready') { // a little sparkle
      extra = '<path class="ac-mini__spark" d="M570 40 Q578 92 630 100 Q578 108 570 160 Q562 108 510 100 Q562 92 570 40 Z" fill="#FFD66B" stroke="' + INK + '" stroke-width="7" stroke-linejoin="round"/>';
    }
    return '<svg class="ac-mini ac-mini--' + mood + '" viewBox="30 0 600 520" width="' + (size || 40) + '" aria-hidden="true" focusable="false">'
      + '<g class="ac-mini__body">'
      + '<path d="M250 420 h100 v50 h-100 z" fill="' + BODY + '" stroke="' + INK + '" stroke-width="18" stroke-linejoin="round"/>'
      + '<rect x="170" y="462" width="260" height="42" rx="21" fill="' + BODY + '" stroke="' + INK + '" stroke-width="18"/>'
      + '<rect x="60" y="40" width="480" height="385" rx="60" fill="' + BODY + '" stroke="' + INK + '" stroke-width="18"/>'
      + '<rect x="100" y="80" width="400" height="285" rx="34" fill="' + SCREEN + '"/>'
      + miniFace(mood) + extra
      + '</g></svg>';
  }

  window.AC = window.AC || {};
  AC.mascot = { errorScene: errorScene, greet: greet, badge: badge };
})();
