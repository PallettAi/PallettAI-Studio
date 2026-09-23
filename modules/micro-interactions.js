// ============================================================
// PallettAI Studio — MicroInteractions
// Declarative micro-interaction timing + tactile state rules.
//
// generateSpringTransition(tension, friction)
//   Physically simulates a damped harmonic oscillator (RK4,
//   1ms timestep, react-spring damping convention) and fits a
//   cubic-bezier to the simulated motion. Control points PULL the
//   curve but are not ON it, so the fitter generates several
//   candidate curves — an exact two-point solve through the
//   half/90% amplitude milestones, an overshoot-matched candidate
//   for underdamped springs (y > 1 is legal in CSS Béziers, that
//   is how bounce easings overshoot; only x is constrained to
//   [0,1]), and single-anchor candidates — then keeps whichever
//   minimises the measured error against the reference motion.
//   Error is scored only over the VISIBLE portion: within 1% of
//   rest (react-spring's restDelta) differences are imperceptible.
//
//     ζ = friction / (2·√tension);  ζ < 1 underdamped (overshoots)
//
// generateInteractiveStatesCSS(componentType, options)
//   :hover / :active / :focus-visible / :disabled rules that only
//   animate transform + opacity (compositor-only) with a matching
//   will-change hint and reduced-motion guards.
//
// CommonJS + browser global, like the rest of modules/.
// ============================================================
(function () {
  'use strict';

  const MicroInteractions = {};

  function round(n, dp) {
    var f = Math.pow(10, dp == null ? 4 : dp);
    return Math.round(n * f) / f;
  }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  /* ---------------- spring simulation ---------------- */

  // Mass-normalised damped oscillator (react-spring convention:
  // friction is NOT doubled): x'' = -tension·(x - 1) - friction·x'
  // x(0)=0, x'(0)=0 → approaches rest at x=1.
  var DT = 0.001;         // 1ms
  var MAX_MS = 12000;
  var REST_DELTA = 0.01;  // 1% of remaining distance — react-spring's
                          // restDelta; sub-1% motion is invisible

  function simulateSpring(tension, friction, record) {
    var x = 0, v = 0;
    var steps = MAX_MS;
    var peakV = { t: 0, x: 0, v: 0 };
    var peakX = { t: 0, x: 0 };
    var settled = null;
    var maxOvershoot = 0;
    for (var i = 0; i < steps; i++) {
      // RK4 on (x, v)
      function acc(x_, v_) { return -tension * (x_ - 1) - friction * v_; }
      var k1x = v, k1v = acc(x, v);
      var k2x = v + DT / 2 * k1v, k2v = acc(x + DT / 2 * k1x, v + DT / 2 * k1v);
      var k3x = v + DT / 2 * k2v, k3v = acc(x + DT / 2 * k2x, v + DT / 2 * k2v);
      var k4x = v + DT * k3v, k4v = acc(x + DT * k3x, v + DT * k3v);
      x += DT / 6 * (k1x + 2 * k2x + 2 * k3x + k4x);
      v += DT / 6 * (k1v + 2 * k2v + 2 * k3v + k4v);
      var tNext = (i + 1) * DT;
      if (Math.abs(v) > Math.abs(peakV.v)) peakV = { t: tNext, x: x, v: v };
      if (x > peakX.x) peakX = { t: tNext, x: x };
      if (x > 1) maxOvershoot = Math.max(maxOvershoot, x - 1);
      var done = Math.abs(x - 1) < REST_DELTA && Math.abs(v) < REST_DELTA;
      if (done && settled == null) settled = tNext;
      if (Array.isArray(record)) record.push({ t: tNext, x: x, v: v });
      else if (typeof record === 'function') record({ t: tNext, x: x, v: v });
      if (done && i * DT > 0.2) break;
    }
    return { peakV: peakV, peakX: peakX, settled: settled == null ? MAX_MS / 1000 : settled, maxOvershoot: maxOvershoot };
  }

  function bezierAt(p1x, p1y, p2x, p2y, t) {
    var mt = 1 - t;
    var a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
    return {
      x: b * p1x + c * p2x + d,
      y: b * p1y + c * p2y + d
    };
  }

  // Progress(t) of a CSS cubic-bezier easing: invert x(u) = t by
  // bisection (x is monotonic for legal control points), return y(u).
  function driveCurve(p1x, p1y, p2x, p2y, settleS) {
    var out = [];
    var steps = Math.min(4000, Math.max(600, Math.round(settleS * 1000)));
    for (var i = 1; i <= steps; i++) {
      var tNorm = i / steps;
      var lo = 0, hi = 1;
      for (var it = 0; it < 40; it++) {
        var mid = (lo + hi) / 2;
        if (bezierAt(p1x, p1y, p2x, p2y, mid).x < tNorm) lo = mid; else hi = mid;
      }
      var u = (lo + hi) / 2;
      out.push({ t: tNorm * settleS, x: bezierAt(p1x, p1y, p2x, p2y, u).y });
    }
    return out;
  }

  /* ---------------- spring → bezier fitting ---------------- */

  /**
   * generateSpringTransition(tension, friction) ->
   *   { ok, cubicBezier, transition, durationMs, peak, overshoot,
   *     underdamped, fitError, clamped, damping }
   */
  MicroInteractions.generateSpringTransition = function (tension, friction) {
    var T = Number(tension), F = Number(friction);
    if (!isFinite(T) || !isFinite(F) || T <= 0 || F <= 0) {
      return { ok: false, error: 'tension and friction must be positive numbers' };
    }
    if (T > 1000 || F > 200) {
      return { ok: false, error: 'tension ≤ 1000 and friction ≤ 200 (got ' + T + ', ' + F + ')' };
    }

    var sim = simulateSpring(T, F);
    var underdamped = F * F < 4 * T; // ζ = F/(2√T) < 1 ⟺ F² < 4T

    // Reference recording (shared by fitting and validation).
    var ref = [];
    simulateSpring(T, F, function (s) { ref.push(s); });

    // Max error of a candidate curve vs the reference over the
    // VISIBLE portion of the motion (the tail within REST_DELTA of
    // rest is imperceptible by our own definition of "settled").
    function curveError(cx1, cy1, cx2, cy2) {
      var driven = driveCurve(cx1, cy1, cx2, cy2, sim.settled);
      var worst = 0;
      for (var i = 0; i < driven.length; i++) {
        var idx = Math.min(ref.length - 1, Math.round(driven[i].t / DT));
        var refX = ref[idx] ? ref[idx].x : 1;
        if (Math.abs(refX - 1) <= REST_DELTA) continue;
        worst = Math.max(worst, Math.abs(driven[i].x - refX));
      }
      return worst;
    }

    // Reference milestones.
    var tHalf = null, t90 = null, tPeakX = 0, xPeakX = 0;
    for (var si = 0; si < ref.length; si++) {
      if (tHalf == null && ref[si].x >= 0.5) tHalf = ref[si].t;
      else if (tHalf != null && t90 == null && ref[si].x >= 0.9) t90 = ref[si].t;
      if (ref[si].x > xPeakX) { xPeakX = ref[si].x; tPeakX = ref[si].t; }
    }

    var candidates = [];

    // Two-point exact fit: with control x positions a, b (or derived
    // from milestone times), solve the control heights so the curve
    // passes THROUGH milestone values at exactly the right times.
    // Heights may legitimately leave [0,1] (legal for Bézier y) —
    // the selector below keeps whatever actually measures best.
    function fitHeights(a, b, m1, m2) {
      var solveU = function (target) {
        var lo = 0, hi = 1;
        for (var it2 = 0; it2 < 40; it2++) {
          var um = (lo + hi) / 2;
          var xu = 3 * (1 - um) * (1 - um) * um * a + 3 * (1 - um) * um * um * b + um * um * um;
          if (xu < target) lo = um; else hi = um;
        }
        return (lo + hi) / 2;
      };
      var u1 = solveU(clamp(m1.t / sim.settled, 0.001, 0.998));
      var u2 = solveU(clamp(m2.t / sim.settled, 0.001, 0.999));
      var A1 = 3 * (1 - u1) * (1 - u1) * u1, B1 = 3 * (1 - u1) * u1 * u1, C1 = m1.v - u1 * u1 * u1;
      var A2 = 3 * (1 - u2) * (1 - u2) * u2, B2 = 3 * (1 - u2) * u2 * u2, C2 = m2.v - u2 * u2 * u2;
      var det = A1 * B2 - A2 * B1;
      if (Math.abs(det) < 1e-9) return null;
      var P1y = (C1 * B2 - C2 * B1) / det;
      var P2y = (A1 * C2 - A2 * C1) / det;
      if (!isFinite(P1y) || !isFinite(P2y) || P1y < -1 || P1y > 4 || P2y < -1 || P2y > 4) return null;
      return { x1: a, y1: P1y, x2: b, y2: P2y };
    }

    // Candidate 1: half → 90% milestones, control x's at those times
    // (classic monotonic fit).
    if (tHalf != null && t90 != null && t90 > tHalf) {
      var c1 = fitHeights(
        clamp(tHalf / sim.settled, 0.001, 0.998),
        clamp(t90 / sim.settled, 0.001, 0.999),
        { v: 0.5, t: tHalf }, { v: 0.9, t: t90 }
      );
      if (c1) candidates.push(c1);
    }

    // Candidate 2 (underdamped): grid search over control positions
    // anchoring half-amplitude → overshoot peak. The rebound's timing
    // lives in where the control x's sit, so a small search finds the
    // descent shape no fixed-anchor candidate can reach.
    if (underdamped && sim.maxOvershoot > 0.005 && tPeakX > tHalf && tHalf != null) {
      var m1 = { v: 0.5, t: tHalf };
      var m2 = { v: xPeakX, t: tPeakX };
      for (var a = 0.08; a <= 0.5; a += 0.04) {
        for (var b = 0.15; b <= 0.9; b += 0.06) {
          if (b <= a + 0.04) continue;
          var cg = fitHeights(round(a, 3), round(b, 3), m1, m2);
          if (cg) candidates.push(cg);
        }
      }
    }

    // Candidate 3 (underdamped): P1 timed at the overshoot peak;
    // P1y bisected until the driven peak equals the overshoot.
    if (underdamped && sim.maxOvershoot > 0.005 && tPeakX > 0) {
      var px1 = clamp(tPeakX / sim.settled, 0.001, 0.999);
      var loY = 1, hiY = 3;
      for (var bi = 0; bi < 14; bi++) {
        var midY = (loY + hiY) / 2;
        var dr = driveCurve(px1, midY, 1, 1, sim.settled);
        var maxDr = 0;
        for (var di = 0; di < dr.length; di++) maxDr = Math.max(maxDr, dr[di].x);
        if (maxDr < 1 + sim.maxOvershoot) loY = midY; else hiY = midY;
      }
      candidates.push({ x1: px1, y1: (loY + hiY) / 2, x2: 1, y2: 1 });

      // Candidate 4 (underdamped): same sharp apex, but P2 anchored at
      // the REST-CROSSING time (when the spring first falls back
      // through 1.0). With P2x=1 the descent rides the long tail and
      // the peak reads too wide; a mid-curve P2 pulls the curve back
      // down at the moment the real spring returns.
      var tRestDown = null;
      for (var rd = 0; rd < ref.length; rd++) {
        if (ref[rd].t > tPeakX && ref[rd].x <= 1) { tRestDown = ref[rd].t; break; }
      }
      if (tRestDown != null && tRestDown > tPeakX) {
        var px2 = clamp(tRestDown / sim.settled, px1 + 0.05, 0.999);
        var loY2 = 1, hiY2 = 3;
        for (var bi2 = 0; bi2 < 14; bi2++) {
          var midY2 = (loY2 + hiY2) / 2;
          var dr2 = driveCurve(px1, midY2, px2, 1, sim.settled);
          var maxDr2 = 0;
          for (var di2 = 0; di2 < dr2.length; di2++) maxDr2 = Math.max(maxDr2, dr2[di2].x);
          if (maxDr2 < 1 + sim.maxOvershoot) loY2 = midY2; else hiY2 = midY2;
        }
        candidates.push({ x1: px1, y1: (loY2 + hiY2) / 2, x2: px2, y2: 1 });
      }
    }

    // Candidates 3+: single-anchor curves at various amplitudes —
    // robust classics that often measure best for near-critical
    // damping, where the two-point solve overfits the creeping tail.
    [0.4, 0.5, 0.6, 0.7, 0.8].forEach(function (amp) {
      var anchor = null;
      for (var ai = 0; ai < ref.length; ai++) {
        if (ref[ai].x >= amp) { anchor = ref[ai]; break; }
      }
      if (!anchor) return;
      candidates.push({
        x1: clamp(anchor.t / sim.settled, 0.001, 0.999),
        y1: amp, x2: 1, y2: 1
      });
    });

    // Pick the candidate that actually measures best.
    var best = null, bestErr = Infinity;
    for (var ci = 0; ci < candidates.length; ci++) {
      var c = candidates[ci];
      var err = curveError(c.x1, c.y1, c.x2, c.y2);
      if (err < bestErr) { bestErr = err; best = c; }
    }
    if (!best) best = { x1: 0.25, y1: 0.5, x2: 1, y2: 1 };

    // Bounded coordinate-descent refinement (underdamped springs
    // only, and only when the candidate set left error on the
    // table): perturb each control coordinate by a shrinking step
    // and keep improvements. Each parameter of a bounce curve
    // interacts with the others, so hill-climbing from a good
    // structural candidate converges fast.
    if (underdamped && bestErr > 0.1) {
      var cur = { x1: best.x1, y1: best.y1, x2: best.x2, y2: best.y2 };
      for (var step = 0.08; step >= 0.01; step /= 2) {
        var improved = false;
        var params = ['x1', 'y1', 'x2', 'y2'];
        for (var pi = 0; pi < params.length; pi++) {
          var key = params[pi];
          for (var dir = -1; dir <= 1; dir += 2) {
            var trial = Object.assign({}, cur);
            trial[key] = cur[key] + dir * step;
            // Keep the curve structurally legal.
            if (trial.x1 <= 0.001 || trial.x1 >= 0.999) continue;
            if (trial.x2 <= 0.001 || trial.x2 >= 0.999) continue;
            if (trial.x2 <= trial.x1 + 0.02) continue;
            if (trial.y1 < -1 || trial.y1 > 4 || trial.y2 < -1 || trial.y2 > 4) continue;
            var terr = curveError(trial.x1, trial.y1, trial.x2, trial.y2);
            if (terr < bestErr - 1e-6) {
              bestErr = terr;
              cur = trial;
              improved = true;
            }
          }
        }
        if (!improved) break;
      }
      best = cur;
    }

    var p1x = best.x1, p1y = best.y1, p2x = best.x2, p2y = best.y2;
    var clamped = p1y < 0 || p1y > 1 || p2y < 0 || p2y > 1;

    var ms = Math.round(sim.settled * 1000);
    var curveStr = 'cubic-bezier(' + round(p1x, 4) + ', ' + round(p1y, 4) + ', ' + round(p2x, 4) + ', ' + round(p2y, 4) + ')';

    return {
      ok: true,
      cubicBezier: curveStr,
      transition: 'transform ' + ms + 'ms ' + curveStr + ', opacity ' + ms + 'ms ' + curveStr,
      durationMs: ms,
      settleMs: ms,
      peak: { timeMs: Math.round(sim.peakV.t * 1000), velocity: round(sim.peakV.v, 4) },
      overshoot: round(sim.maxOvershoot, 4),
      underdamped: underdamped,
      fitError: round(bestErr, 4),
      clamped: clamped,
      damping: round(F / (2 * Math.sqrt(T)), 4) // ζ; <1 underdamped, ≥1 overdamped (informational)
    };
  };

  /* ---------------- interactive state CSS ---------------- */

  var STATE_PRESETS = {
    button: {
      hover: 'translateY(-1px)',
      active: 'translateY(0) scale(0.98)',
      hoverOpacity: null,
      focusOutline: true,
      transitionMs: 150
    },
    card: {
      hover: 'translateY(-2px)',
      active: 'translateY(-1px) scale(0.995)',
      hoverOpacity: null,
      focusOutline: true,
      transitionMs: 200
    },
    link: {
      hover: 'translateY(-0.5px)',
      active: 'translateY(0)',
      hoverOpacity: 0.8,
      focusOutline: true,
      transitionMs: 120
    },
    nav: {
      hover: 'translateY(-1px)',
      active: 'scale(0.97)',
      hoverOpacity: 0.9,
      focusOutline: true,
      transitionMs: 140
    },
    input: {
      hover: 'none',
      active: 'none',
      hoverOpacity: null,
      focusOutline: true,
      transitionMs: 120
    },
    chip: {
      hover: 'scale(1.03)',
      active: 'scale(0.97)',
      hoverOpacity: null,
      focusOutline: true,
      transitionMs: 130
    },
    toggle: {
      hover: 'scale(1.02)',
      active: 'scale(0.95)',
      hoverOpacity: null,
      focusOutline: true,
      transitionMs: 160
    },
    modal: {
      hover: 'none',
      active: 'none',
      hoverOpacity: null,
      focusOutline: false,
      transitionMs: 240
    }
  };
  MicroInteractions.STATE_PRESETS = Object.keys(STATE_PRESETS);

  var ALIASES = { btn: 'button', tab: 'nav', field: 'input', badge: 'chip', switch: 'toggle', dialog: 'modal' };

  function canonComponent(t) {
    var k = String(t || '').trim().toLowerCase();
    if (STATE_PRESETS[k]) return k;
    return ALIASES[k] || null;
  }

  /**
   * generateInteractiveStatesCSS(componentType, options)
   * options: { selector, durationMs, easing, reducedMotionGuard = true,
   *            willChange = true }
   */
  MicroInteractions.generateInteractiveStatesCSS = function (componentType, options) {
    var type = canonComponent(componentType);
    if (!type) {
      return { ok: false, error: 'unknown component type: ' + String(componentType) + ' (known: ' + MicroInteractions.STATE_PRESETS.join(', ') + ')' };
    }
    var opts = options || {};
    var preset = STATE_PRESETS[type];
    var sel = String(opts.selector || ('.pai-' + type));
    var ms = opts.durationMs == null ? preset.transitionMs : clamp(Number(opts.durationMs) || preset.transitionMs, 40, 800);
    var easing = String(opts.easing || 'cubic-bezier(0.2, 0.7, 0.3, 1)');
    if (!/^cubic-bezier\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*\)$|^ease(-in)?(-out)?$|^linear$/.test(easing)) {
      return { ok: false, error: 'easing must be cubic-bezier(...) or a CSS keyword easing' };
    }

    var lines = [];
    lines.push(sel + ' {');
    lines.push('  transition: transform ' + ms + 'ms ' + easing + (preset.hoverOpacity != null ? ', opacity ' + ms + 'ms ' + easing : '') + ';');
    if (opts.willChange !== false && preset.hover !== 'none') lines.push('  will-change: transform' + (preset.hoverOpacity != null ? ', opacity' : '') + ';');
    lines.push('}');
    if (preset.hover !== 'none' || preset.hoverOpacity != null) {
      var h = [];
      if (preset.hover !== 'none') h.push('    transform: ' + preset.hover + ';');
      if (preset.hoverOpacity != null) h.push('    opacity: ' + preset.hoverOpacity + ';');
      lines.push('@media (hover: hover) {');
      lines.push('  ' + sel + ':hover {');
      lines.push(h.join('\n'));
      lines.push('  }');
      lines.push('}');
    }
    if (preset.active !== 'none') {
      lines.push(sel + ':active {');
      lines.push('    transform: ' + preset.active + ';');
      lines.push('    transition-duration: ' + Math.round(ms * 0.6) + 'ms;'); // press reacts faster
      lines.push('}');
    }
    if (preset.focusOutline) {
      lines.push(sel + ':focus-visible {');
      lines.push('    outline: 2px solid var(--c-primary, currentColor);');
      lines.push('    outline-offset: 2px;');
      lines.push('}');
    }
    lines.push(sel + ':disabled, ' + sel + '[aria-disabled="true"] {');
    lines.push('    opacity: 0.55;');
    lines.push('    transform: none;');
    lines.push('    pointer-events: none;');
    lines.push('}');
    if (opts.reducedMotionGuard !== false) {
      lines.push('@media (prefers-reduced-motion: reduce) {');
      lines.push('  ' + sel + ' {');
      lines.push('    transition: none;');
      lines.push('    transform: none;');
      lines.push('  }');
      lines.push('}');
    }

    var css = lines.join('\n') + '\n';
    return {
      ok: true,
      componentType: type,
      selector: sel,
      css: css,
      states: ['hover', 'active', 'focus-visible', 'disabled'],
      animatedProperties: ['transform'].concat(preset.hoverOpacity != null ? ['opacity'] : []),
      usesHardwareAcceleration: true,
      hasReducedMotionGuard: opts.reducedMotionGuard !== false,
      bytes: css.length
    };
  };

  /* ---------------- bundle ---------------- */

  /**
   * generateInteractionBundle(componentType, options)
   * Spring-fitted easing wired straight into the state CSS.
   */
  MicroInteractions.generateInteractionBundle = function (componentType, options) {
    var opts = options || {};
    var spring = MicroInteractions.generateSpringTransition(
      opts.tension == null ? 170 : opts.tension,
      opts.friction == null ? 26 : opts.friction
    );
    if (!spring.ok) return spring;
    var states = MicroInteractions.generateInteractiveStatesCSS(componentType, {
      selector: opts.selector,
      durationMs: opts.durationMs || spring.durationMs,
      easing: spring.cubicBezier,
      reducedMotionGuard: true
    });
    if (!states.ok) return states;
    return {
      ok: true,
      componentType: states.componentType,
      spring: spring,
      css: states.css,
      stylesheet: states.css
    };
  };

  /* CommonJS + browser global */
  if (typeof module !== 'undefined' && module.exports) module.exports = MicroInteractions;
  if (typeof window !== 'undefined') window.MicroInteractions = MicroInteractions;
})();
