// ============================================================
// PallettAI Studio — FluidTypography
// Viewport-adaptive type scales built on exact clamp() algebra.
//
// calculateFluidClamp(minSizePx, maxSizePx, minVpPx, maxVpPx)
//   Solves the straight line through the two breakpoint points
//   and emits a clean CSS expression:
//
//     clamp(MINrem, INTERCEPTrem + SLOPEvw, MAXrem)
//
//   SLOPE     = (max − min) / (maxVp − minVp)          [px per px]
//   INTERCEPT = min − slope · minVp                    [px]
//
//   Because the preferred value is linear between the endpoints,
//   the rendered size at ANY viewport is deterministic — type
//   never reflows after first paint, so this cannot cause CLS.
//   Viewport-anchored terms are rounded to 4 decimal places,
//   which keeps evaluated sizes within ~0.01px of the requested
//   endpoints across every sampled viewport.
//
// generateModularScale(baseSizePx, scaleRatio, steps)
//   A full hierarchy (display → h1…h6 → body → small → caption)
//   on a modular scale. The desktop column carries the pure ratio
//   steps; the mobile column compresses the scale toward the body
//   size (mobileContrast) so headings stay sane on phones. Every
//   step is rendered as its own clamp() through calculateFluidClamp.
//
//   Named ratios: golden 1.618, fourth 1.333, third 1.25,
//   second 1.125, minor 1.067 — or pass any number > 1.
//
// buildFluidTypeTokens(options)
//   The complete :root custom-property bundle: every role as
//   --font-size-*, plus unitless fluid line-heights and tracking.
//
// evaluateClampAt(clampString, viewportPx)
//   Reference evaluator used by tests to verify the maths.
//
// CommonJS + browser global, like the rest of modules/.
// ============================================================
(function () {
  'use strict';

  const FluidTypography = {};

  var PX_PER_REM = 16;

  var NAMED_RATIOS = {
    golden: 1.618,
    fourth: 1.333,
    third: 1.25,
    second: 1.125,
    minor: 1.067
  };
  FluidTypography.NAMED_RATIOS = NAMED_RATIOS;

  function round(n, dp) {
    var f = Math.pow(10, dp == null ? 4 : dp);
    return Math.round(n * f) / f;
  }

  function toRem(px) { return px / PX_PER_REM; }

  function fmtRem(px) {
    var rem = round(toRem(px), 4);
    return String(rem);
  }

  /* ------------------------------------------------------------
   * Core clamp solver
   * ---------------------------------------------------------- */

  /**
   * calculateFluidClamp(minSizePx, maxSizePx, minViewportPx, maxViewportPx)
   * -> { ok, clamp, minPx, maxPx, slopeVw, interceptRem, ... }
   *
   * Returns ok:false for degenerate inputs (non-finite, non-positive
   * viewport span). min > max is normalized by swapping, flagged as
   * `normalized`, so callers never get an inert clamp().
   */
  FluidTypography.calculateFluidClamp = function (minSizePx, maxSizePx, minViewportPx, maxViewportPx) {
    var minVp = minViewportPx == null ? 320 : minViewportPx;
    var maxVp = maxViewportPx == null ? 1440 : maxViewportPx;
    var lo = Number(minSizePx);
    var hi = Number(maxSizePx);

    if (!isFinite(lo) || !isFinite(hi) || !isFinite(minVp) || !isFinite(maxVp)) {
      return { ok: false, error: 'non-finite size or viewport' };
    }
    if (maxVp - minVp <= 0) {
      return { ok: false, error: 'maxViewportPx must exceed minViewportPx' };
    }
    if (lo <= 0 || hi <= 0) {
      return { ok: false, error: 'font sizes must be positive' };
    }

    var normalized = false;
    if (lo > hi) { var t = lo; lo = hi; hi = t; normalized = true; }

    var slopePxPerPx = (hi - lo) / (maxVp - minVp);
    var interceptPx = lo - slopePxPerPx * minVp;

    // Express the preferred value as intercept-rem + slope-vw.
    var slopeVw = round(slopePxPerPx * 100, 4);        // vw units are % of viewport width
    var interceptRem = round(toRem(interceptPx), 4);

    var clampStr;
    if (slopeVw === 0) {
      // Flat: pure clamp over a constant (still honours min/max).
      var flat = fmtRem(lo);
      clampStr = 'clamp(' + flat + 'rem, ' + flat + 'rem, ' + fmtRem(hi) + 'rem)';
    } else {
      var interceptTerm = interceptRem === 0 ? '' : (interceptRem < 0 ? '- ' + Math.abs(interceptRem) + 'rem' : interceptRem + 'rem + ');
      clampStr = 'clamp(' + fmtRem(lo) + 'rem, ' + interceptTerm + slopeVw + 'vw, ' + fmtRem(hi) + 'rem)';
    }

    return {
      ok: true,
      clamp: clampStr,
      minPx: lo,
      maxPx: hi,
      minViewportPx: minVp,
      maxViewportPx: maxVp,
      slopePxPerPx: round(slopePxPerPx, 6),
      slopeVw: slopeVw,
      interceptPx: round(interceptPx, 4),
      interceptRem: interceptRem,
      normalized: normalized,
      flat: slopeVw === 0
    };
  };

  /**
   * evaluateClampAt(clampString, viewportPx) -> px | null
   * Parses "clamp(MINrem, PREFER, MAXrem)" with a single
   * "Irem + Svw" (or bare Svw) preferred term and evaluates it.
   * Returns null on unparseable input.
   */
  FluidTypography.evaluateClampAt = function (clampString, viewportPx) {
    var m = /^clamp\(\s*([-\d.]+)rem\s*,\s*(.+?)\s*,\s*([-\d.]+)rem\s*\)$/.exec(String(clampString || '').trim());
    if (!m) return null;
    var minRem = parseFloat(m[1]);
    var maxRem = parseFloat(m[3]);
    var pref = m[2];

    var prefRem = 0;
    var prefVw = 0;
    var sumRe = /^\s*([-\d.]+)rem\s*\+\s*([-\d.]+)vw\s*$/.exec(pref);
    var vwOnlyRe = /^\s*([-\d.]+)vw\s*$/.exec(pref);
    if (sumRe) { prefRem = parseFloat(sumRe[1]); prefVw = parseFloat(sumRe[2]); }
    else if (vwOnlyRe) { prefVw = parseFloat(vwOnlyRe[1]); }
    else return null;

    var px = prefRem * PX_PER_REM + (prefVw / 100) * viewportPx;
    var lo = minRem * PX_PER_REM;
    var hi = maxRem * PX_PER_REM;
    return Math.min(hi, Math.max(lo, px));
  };

  /* ------------------------------------------------------------
   * Modular scale
   * ---------------------------------------------------------- */

  var ROLE_ORDER = ['caption', 'small', 'body', 'h6', 'h5', 'h4', 'h3', 'h2', 'h1', 'display'];
  // Step index relative to body (body = 0). caption/small step down.
  var ROLE_STEPS = {
    display: 7, h1: 6, h2: 5, h3: 4, h4: 3, h5: 2, h6: 1,
    body: 0, small: -1, caption: -2
  };

  function resolveRatio(scaleRatio) {
    if (typeof scaleRatio === 'number' && isFinite(scaleRatio) && scaleRatio > 1) return scaleRatio;
    var key = String(scaleRatio || '').trim().toLowerCase();
    if (NAMED_RATIOS[key]) return NAMED_RATIOS[key];
    var num = parseFloat(key);
    if (isFinite(num) && num > 1) return num;
    return null;
  }

  /**
   * generateModularScale(baseSizePx, scaleRatio, steps, options)
   *   steps: number of UPWARD steps (h1 depth). Default 6 → h6…h1.
   *   options.mobileContrast (0..1, default 0.72): how much of each
   *   step survives at the small viewport. options.minViewportPx /
   *   maxViewportPx feed the clamps. options.capDisplay drops the
   *   display role if the top step would be absurd (> 9rem desktop).
   */
  FluidTypography.generateModularScale = function (baseSizePx, scaleRatio, steps, options) {
    var base = Number(baseSizePx);
    if (!isFinite(base) || base <= 0) {
      return { ok: false, error: 'baseSizePx must be a positive number' };
    }
    var ratio = resolveRatio(scaleRatio);
    if (!ratio) {
      return { ok: false, error: 'scaleRatio must be a number > 1 or one of: ' + Object.keys(NAMED_RATIOS).join(', ') };
    }
    var opts = options || {};
    var upSteps = steps == null ? 6 : Math.max(1, Math.min(8, Math.floor(Number(steps) || 6)));
    var minVp = opts.minViewportPx == null ? 320 : opts.minViewportPx;
    var maxVp = opts.maxViewportPx == null ? 1440 : opts.maxViewportPx;
    var contrast = opts.mobileContrast == null ? 0.72 : Math.min(1, Math.max(0, Number(opts.mobileContrast)));

    // Roles: caption, small, body, then upSteps headings (h6 up to hN).
    var headings = [];
    for (var i = 1; i <= upSteps; i++) headings.push('h' + i); // h6 first … h1 last
    headings.reverse(); // h1 … h6
    var roles = ['caption', 'small', 'body'].concat(headings);
    if (opts.display !== false) roles.push('display');

    var rows = [];
    for (var r = 0; r < roles.length; r++) {
      var role = roles[r];
      var step = ROLE_STEPS[role] !== undefined ? ROLE_STEPS[role] : upSteps - headings.indexOf(role);
      var desktopPx = base * Math.pow(ratio, step);
      var mobilePx;
      if (desktopPx < base) {
        // Sub-body roles (caption/small): the legibility floor
        // governs and they stay FLAT — caption text has no business
        // shrinking or growing with the viewport, and steep ratios
        // (golden) push the raw step below 11px where fluid maths
        // would otherwise produce inverted clamps.
        var size = Math.max(desktopPx, 11);
        desktopPx = size;
        mobilePx = size;
      } else {
        // Body and up: compress toward body size at the small
        // viewport so headings stay sane on phones.
        mobilePx = base + (desktopPx - base) * contrast;
      }

      var lh; // unitless, tighter as sizes grow
      var desktopRem = desktopPx / PX_PER_REM;
      if (desktopRem >= 3) lh = 1.05;
      else if (desktopRem >= 2) lh = 1.12;
      else if (desktopRem >= 1.5) lh = 1.22;
      else if (desktopRem >= 1.25) lh = 1.3;
      else if (role === 'body') lh = 1.6;
      else lh = 1.5;

      var tracking = '0';
      if (desktopRem >= 2) tracking = '-0.02em';
      else if (desktopRem >= 1.25) tracking = '-0.01em';
      else if (desktopRem < 1) tracking = '0.01em';

      var cl = FluidTypography.calculateFluidClamp(mobilePx, desktopPx, minVp, maxVp);
      rows.push({
        role: role,
        step: step,
        minPx: cl.ok ? cl.minPx : round(mobilePx, 2),
        maxPx: cl.ok ? cl.maxPx : round(desktopPx, 2),
        clamp: cl.ok ? cl.clamp : fmtRem(desktopPx) + 'rem',
        lineHeight: lh,
        tracking: tracking
      });
    }

    // Hierarchy sanity: sizes ascend strictly from caption →
    // display (sub-body roles sit below body by design).
    for (var k = 0; k < rows.length - 1; k++) {
      if (rows[k].maxPx > rows[k + 1].maxPx + 0.01) {
        return { ok: false, error: 'hierarchy violation at ' + rows[k].role };
      }
    }

    return {
      ok: true,
      basePx: base,
      ratio: ratio,
      ratioKey: typeof scaleRatio === 'string' ? (NAMED_RATIOS[String(scaleRatio).toLowerCase()] ? String(scaleRatio).toLowerCase() : null) : null,
      steps: upSteps,
      minViewportPx: minVp,
      maxViewportPx: maxVp,
      mobileContrast: contrast,
      scale: rows
    };
  };

  /* ------------------------------------------------------------
   * Token bundle
   * ---------------------------------------------------------- */

  var TSHIRT = {
    xs: 'caption', sm: 'small', base: 'body',
    lg: 'h6', xl: 'h5', '2xl': 'h4', '3xl': 'h3', '4xl': 'h2', '5xl': 'h1', hero: 'display'
  };

  /**
   * buildFluidTypeTokens(options) -> { ok, css, scale, ... }
   * Full :root custom-property block: --font-size-* (t-shirt +
   * semantic aliases), --line-height-*, --tracking-*.
   */
  FluidTypography.buildFluidTypeTokens = function (options) {
    var opts = options || {};
    var scaleRes = FluidTypography.generateModularScale(
      opts.baseSizePx == null ? 16 : opts.baseSizePx,
      opts.scaleRatio || 'fourth',
      opts.steps,
      opts
    );
    if (!scaleRes.ok) return scaleRes;

    var byRole = {};
    scaleRes.scale.forEach(function (row) { byRole[row.role] = row; });

    var lines = [':root {'];
    // t-shirt sizes
    Object.keys(TSHIRT).forEach(function (size) {
      var row = byRole[TSHIRT[size]];
      lines.push('  --font-size-' + size + ': ' + row.clamp + ';');
    });
    // semantic aliases
    scaleRes.scale.forEach(function (row) {
      lines.push('  --font-size-' + row.role + ': ' + row.clamp + ';');
    });
    // line heights + tracking per role
    scaleRes.scale.forEach(function (row) {
      lines.push('  --line-height-' + row.role + ': ' + row.lineHeight + ';');
      lines.push('  --tracking-' + row.role + ': ' + row.tracking + ';');
    });
    lines.push('  --type-ratio: ' + scaleRes.ratio + ';');
    lines.push('  --type-base: ' + fmtRem(scaleRes.basePx) + 'rem;');
    lines.push('}');

    var css = lines.join('\n');

    return {
      ok: true,
      css: css,
      scale: scaleRes.scale,
      ratio: scaleRes.ratio,
      basePx: scaleRes.basePx,
      byRole: byRole
    };
  };

  FluidTypography.ROLE_ORDER = ROLE_ORDER;

  /* CommonJS + browser global */
  if (typeof module !== 'undefined' && module.exports) module.exports = FluidTypography;
  if (typeof window !== 'undefined') window.FluidTypography = FluidTypography;
})();
