// ============================================================
// PallettAI Studio — Typography
// Fluid type + modular scale calculator (clamp() mathematics).
//
// calculateFluidClamp(minSizePx, maxSizePx, minVpPx, maxVpPx)
//   Solves the line y = intercept + slope·vw through the two
//   breakpoint points and emits a clean CSS clamp() expression:
//
//     clamp(MINrem, INTERCEPTrem + SLOPEvw, MAXrem)
//
//   where SLOPE      = (max − min) / (maxVp − minVp)   [rem/vw]
//         INTERCEPT  = min − slope · minVp / 100        [rem]
//
//   Both viewport-anchored terms are rounded to 4dp, which keeps
//   every evaluated size within a hair of the requested endpoints.
//
// buildTypographicScale(baseSizePx, ratioKey, archetype)
//   A full hierarchy — display, h1…h6, body, small — on a modular
//   scale, each step rendered as its own clamp() between a mobile
//   base and a desktop ratio-driven size. Ratios are keyed to the
//   active Design DNA archetype:
//
//     Brutalist Kinetic / Editorial Magazine … 1.618 golden
//     Bento Glass / Neo-Minimalist ………………… 1.333 perfect fourth
//     Retro Cyberpunk / Organic Clay ……………… 1.250 major third
//
//   Line-heights invert as sizes grow (tight display leading,
//   roomy small print); tracking opens on small caps-size text.
//
// buildTypographyTokens(archetypeKey, options)
//   The complete CSS custom-property bundle: families, every
//   clamp() size, line-heights, tracking, and fluid rhythm.
//
// CommonJS + browser global, like the rest of modules/.
// ============================================================
(function () {
  'use strict';

  const Typography = {};

  /* ---------------- archetypes & ratios ---------------- */

  const MODULAR_RATIOS = {
    golden: 1.618,        // Brutalist Kinetic, Editorial Magazine
    fourth: 1.333,        // Bento Glass, Neo-Minimalist
    third: 1.25           // Retro Cyberpunk, Organic Clay
  };

  // Design DNA archetypes → ratio + type personality.
  const ARCHETYPES = {
    'brutalist-kinetic': {
      label: 'Brutalist Kinetic', ratioKey: 'golden', ratioValue: 1.618,
      headingFamily: '"Archivo Black", "Arial Black", sans-serif',
      bodyFamily: '"Archivo", Helvetica, sans-serif',
      headingTracking: '-0.03em', bodyTracking: '0',
      headingCase: 'uppercase', radius: '0px'
    },
    'editorial-magazine': {
      label: 'Editorial Magazine', ratioKey: 'golden', ratioValue: 1.618,
      headingFamily: '"Playfair Display", Georgia, serif',
      bodyFamily: '"Source Serif 4", Georgia, serif',
      headingTracking: '-0.02em', bodyTracking: '0.002em',
      headingCase: 'none', radius: '4px'
    },
    'bento-glass': {
      label: 'Bento Glass', ratioKey: 'fourth', ratioValue: 1.333,
      headingFamily: '"Inter", system-ui, sans-serif',
      bodyFamily: '"Inter", system-ui, sans-serif',
      headingTracking: '-0.025em', bodyTracking: '0',
      headingCase: 'none', radius: '20px'
    },
    'neo-minimalist': {
      label: 'Neo-Minimalist', ratioKey: 'fourth', ratioValue: 1.333,
      headingFamily: '"Helvetica Now", "Neue Haas", Helvetica, sans-serif',
      bodyFamily: '"Helvetica Neue", Helvetica, sans-serif',
      headingTracking: '-0.02em', bodyTracking: '0.005em',
      headingCase: 'none', radius: '8px'
    },
    'retro-cyberpunk': {
      label: 'Retro Cyberpunk', ratioKey: 'third', ratioValue: 1.25,
      headingFamily: '"Chakra Petch", "Orbitron", monospace',
      bodyFamily: '"Space Grotesk", monospace',
      headingTracking: '0.01em', bodyTracking: '0.01em',
      headingCase: 'uppercase', radius: '2px'
    },
    'organic-clay': {
      label: 'Organic Clay', ratioKey: 'third', ratioValue: 1.25,
      headingFamily: '"Fraunces", Georgia, serif',
      bodyFamily: '"Nunito Sans", system-ui, sans-serif',
      headingTracking: '-0.015em', bodyTracking: '0.003em',
      headingCase: 'none', radius: '26px'
    }
  };

  Typography.MODULAR_RATIOS = MODULAR_RATIOS;
  Typography.ARCHETYPES = ARCHETYPES;

  var DEFAULT_BASE = 16;
  var DEFAULT_MIN_VP = 360;
  var DEFAULT_MAX_VP = 1280;

  function clampNumber(n, lo, hi, dflt) {
    var v = Number(n);
    if (!isFinite(v)) return dflt;
    return Math.max(lo, Math.min(hi, v));
  }

  function resolveArchetype(archetype) {
    if (!archetype) return ARCHETYPES['bento-glass'];
    var key = String(archetype).toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');
    if (ARCHETYPES[key]) return ARCHETYPES[key];
    // tolerate the legacy 10-look names where they overlap
    var alias = { editorial: 'editorial-magazine', minimal: 'neo-minimalist', techy: 'retro-cyberpunk', warm: 'organic-clay', bold: 'brutalist-kinetic' };
    if (alias[key] && ARCHETYPES[alias[key]]) return ARCHETYPES[alias[key]];
    return ARCHETYPES['bento-glass'];
  }

  function rem(px) {
    return (Math.round((px / 16) * 10000) / 10000) + 'rem';
  }

  function round4(n) {
    return Math.round(n * 10000) / 10000;
  }

  /* ============================================================
     1 — the clamp() solver
     ============================================================ */

  /**
   * calculateFluidClamp(minFontSizePx, maxFontSizePx, minViewportPx, maxViewportPx)
   * → 'clamp(MINrem, Xrem + Yvw, MAXrem)'
   *
   * The slope is expressed in vw so the value scales with viewport
   * width; the intercept absorbs the offset at minVp. Verified:
   * at 360px wide the expression evaluates to ~min, at maxVp to
   * ~max (within the 4dp rounding of the emitted coefficients).
   */
  Typography.calculateFluidClamp = function (minFontSizePx, maxFontSizePx, minViewportPx, maxViewportPx) {
    var min = clampNumber(minFontSizePx, 1, 500, DEFAULT_BASE);
    var max = clampNumber(maxFontSizePx, min, 500, min);
    var minVp = clampNumber(minViewportPx, 200, 4000, DEFAULT_MIN_VP);
    var maxVp = clampNumber(maxViewportPx, minVp + 1, 4000, DEFAULT_MAX_VP);

    var slope = (max - min) / (maxVp - minVp);          // px per px of viewport
    var slopeVw = round4(slope * 100);                  // rem-per-100vw → vw units
    var interceptPx = min - slope * minVp;              // px at viewport 0
    var interceptRem = round4(interceptPx / 16);

    // Degenerate flat scale (max === min): no fluid part.
    if (slopeVw === 0) return 'clamp(' + rem(min) + ', ' + rem(min) + ', ' + rem(max) + ')';

    var mid = interceptRem + 'rem + ' + slopeVw + 'vw';
    return 'clamp(' + rem(min) + ', ' + mid + ', ' + rem(max) + ')';
  };

  /**
   * Verify helper: evaluate a clamp() expression at a viewport width
   * (also exported so the smoke suite tests the real string, not
   * the inputs).
   */
  Typography.evaluateClamp = function (clampExpr, viewportPx) {
    var m = /^clamp\(([-\d.]+)(rem|px),\s*([-\d.]+)rem\s*\+\s*([-\d.]+)vw,\s*([-\d.]+)(rem|px)\)$/.exec(String(clampExpr || '').replace(/\s+/g, ' ').trim());
    if (!m) return null;
    var toPx = function (v, unit) { return unit === 'rem' ? v * 16 : v; };
    var lo = toPx(parseFloat(m[1]), m[2]);
    var intercept = parseFloat(m[3]) * 16;
    var slopePx = parseFloat(m[4]) * viewportPx / 100;
    var hi = toPx(parseFloat(m[5]), m[6]);
    return Math.max(lo, Math.min(hi, intercept + slopePx));
  };

  /* ============================================================
     2 — modular scale
     ============================================================ */

  var ROLE_ORDER = ['display', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'body', 'small'];

  // Scale exponents: display sits at ratio^4 and the hierarchy
  // DESCENDS from there — h1 = ratio^3 … body = ratio^0, small a
  // half-step below. (Cumulative upward steps were the bug that
  // made h6 outrank display.)
  var ROLE_STEPS = { display: 4, h1: 3, h2: 2, h3: 1, h4: 0.5, h5: 0, h6: 0, body: 0, small: -0.5 };

  // Line-height ladder: display type sits tight, small print airier.
  var LINE_HEIGHTS = {
    display: { mobile: 1.05, desktop: 1.02 },
    h1: { mobile: 1.12, desktop: 1.08 },
    h2: { mobile: 1.18, desktop: 1.12 },
    h3: { mobile: 1.25, desktop: 1.2 },
    h4: { mobile: 1.3, desktop: 1.25 },
    h5: { mobile: 1.35, desktop: 1.3 },
    h6: { mobile: 1.4, desktop: 1.35 },
    body: { mobile: 1.6, desktop: 1.6 },
    small: { mobile: 1.55, desktop: 1.5 }
  };

  // Tracking: smaller text opens up, display pulls in. Multiples of
  // the archetype's base tracking.
  function trackingFor(role, archetype) {
    var base = parseFloat(archetype.headingTracking || '0');
    var bodyBase = parseFloat(archetype.bodyTracking || '0');
    if (role === 'display' || role === 'h1') return base + 'em';
    if (role === 'h2' || role === 'h3') return (base * 0.5) + 'em';
    if (role === 'h4' || role === 'h5' || role === 'h6') return (base * 0.25) + 'em';
    if (role === 'small') return (bodyBase + 0.01) + 'em';
    return bodyBase + 'em';
  }

  /**
   * buildTypographicScale(baseSizePx, ratioKey, archetype)
   * @param {number} baseSizePx   body size at the mobile breakpoint
   * @param {string} ratioKey     'golden' | 'fourth' | 'third' (or the archetype key)
   * @param {string|object} [archetype]  Design DNA archetype key/object
   * @returns {object} { ratio, ratioKey, archetype, roles: { role: { minPx, maxPx,
   *                   clamp, lineHeight, lineHeightClamp, tracking, weight } }, css }
   */
  Typography.buildTypographicScale = function (baseSizePx, ratioKey, archetype) {
    var arch = resolveArchetype(archetype);
    var ratio = MODULAR_RATIOS[ratioKey] || MODULAR_RATIOS[arch.ratioKey] || 1.333;
    var base = clampNumber(baseSizePx, 12, 24, DEFAULT_BASE);
    var desktopBase = Math.min(base + 1, 19);

    var roles = {};
    for (var i = 0; i < ROLE_ORDER.length; i++) {
      var role = ROLE_ORDER[i];
      var step = ROLE_STEPS[role];
      // Desktop: true modular steps from the desktop body.
      var maxPx = Math.max(11, desktopBase * Math.pow(ratio, step));
      // Mobile: half the headroom above the desktop body — phone
      // hierarchies compress but never invert. The order matters:
      // floor maxPx FIRST, then derive minPx, then floor both, so a
      // below-base role can never end up min > max.
      if (role === 'small') maxPx = Math.max(12.5, maxPx);
      var minPx = Math.max(11, base + (maxPx - desktopBase) * 0.5);
      if (role === 'small') minPx = Math.max(12, Math.min(minPx, maxPx));

      var lh = LINE_HEIGHTS[role];
      var weight = role === 'body' || role === 'small'
        ? 400
        : (role === 'h5' || role === 'h6' ? 600 : 700);
      if (role === 'display') weight = 800;

      roles[role] = {
        minPx: round4(minPx),
        maxPx: round4(maxPx),
        clamp: Typography.calculateFluidClamp(minPx, maxPx, DEFAULT_MIN_VP, DEFAULT_MAX_VP),
        lineHeight: lh,
        lineHeightClamp: lhClampExpr(lh, DEFAULT_MIN_VP, DEFAULT_MAX_VP),
        tracking: trackingFor(role, arch),
        weight: weight,
        case: (role === 'body' || role === 'small') ? (arch.bodyCase || 'none') : arch.headingCase
      };
    }

    var css = buildScaleCss(roles, arch);
    return { ratio: ratio, ratioKey: ratioKey, archetype: arch.label, roles: roles, css: css };
  };

  // Line-height fluid expression: unitless value eases from the
  // mobile leading at minVp to the desktop leading at maxVp.
  // clamp(desktopLH, intercept + slopeVw·vw, mobileLH) — the slope
  // is negative because leading tightens as viewports widen.
  function lhClampExpr(lh, minVp, maxVp) {
    var lo = Math.min(lh.desktop, lh.mobile);
    var hi = Math.max(lh.desktop, lh.mobile);
    var slopeVw = round4((lh.desktop - lh.mobile) / (maxVp - minVp) * 100);
    var intercept = round4(lh.mobile - slopeVw * minVp / 100);
    return 'clamp(' + lo + ', ' + intercept + ' + ' + slopeVw + 'vw, ' + hi + ')';
  }

  function buildScaleCss(roles, arch) {
    var out = [];
    out.push('/* ' + arch.label + ' — fluid modular scale */');
    for (var i = 0; i < ROLE_ORDER.length; i++) {
      var role = ROLE_ORDER[i];
      var r = roles[role];
      out.push('--type-' + role + ': ' + r.clamp + ';');
    }
    out.push('--leading-display: ' + roles.display.lineHeightClamp + ';');
    out.push('--leading-body: ' + roles.body.lineHeightClamp + ';');
    out.push('--tracking-display: ' + roles.display.tracking + ';');
    out.push('--tracking-body: ' + roles.body.tracking + ';');
    return out.join('\n');
  }

  /* ============================================================
     3 — full token bundle
     ============================================================ */

  /**
   * buildTypographyTokens(archetypeKey, options?)
   * @param {string} archetypeKey  one of Typography.ARCHETYPES keys
   * @param {object} [options] { baseSizePx, ratioKey, minViewportPx, maxViewportPx }
   * @returns {object} { archetype, ratio, families, sizes, css }
   */
  Typography.buildTypographyTokens = function (archetypeKey, options) {
    var opts = options || {};
    var arch = resolveArchetype(archetypeKey);
    var ratioKey = opts.ratioKey || arch.ratioKey;
    var base = clampNumber(opts.baseSizePx, 12, 24, 16);
    var minVp = clampNumber(opts.minViewportPx, 200, 4000, DEFAULT_MIN_VP);
    var maxVp = clampNumber(opts.maxViewportPx, minVp + 1, 4000, DEFAULT_MAX_VP);

    var scale = Typography.buildTypographicScale(base, ratioKey, arch);

    // Re-solve every role against caller-provided viewports when
    // they differ from the defaults.
    if (minVp !== DEFAULT_MIN_VP || maxVp !== DEFAULT_MAX_VP) {
      for (var i = 0; i < ROLE_ORDER.length; i++) {
        var role = ROLE_ORDER[i];
        var r = scale.roles[role];
        r.clamp = Typography.calculateFluidClamp(r.minPx, r.maxPx, minVp, maxVp);
      }
    }

    var cssParts = [
      '/* PallettAI — ' + arch.label + ' type tokens */',
      ':root {',
      '  --font-heading: ' + arch.headingFamily + ';',
      '  --font-body: ' + arch.bodyFamily + ';',
      '  --radius-control: ' + arch.radius + ';'
    ];
    for (var j = 0; j < ROLE_ORDER.length; j++) {
      var role2 = ROLE_ORDER[j];
      var rr = scale.roles[role2];
      cssParts.push('  --type-' + role2 + ': ' + rr.clamp + ';');
      cssParts.push('  --leading-' + role2 + ': ' + rr.lineHeightClamp + ';');
      cssParts.push('  --tracking-' + role2 + ': ' + rr.tracking + ';');
      cssParts.push('  --weight-' + role2 + ': ' + rr.weight + ';');
    }
    cssParts.push('  --viewport-fluid: ' + minVp + 'px to ' + maxVp + 'px;');
    cssParts.push('}');
    // Element bindings: hierarchy classes stay semantic.
    cssParts.push('h1{font-size:var(--type-h1);line-height:var(--leading-h1);letter-spacing:var(--tracking-h1);font-weight:var(--weight-h1)}');
    cssParts.push('h2{font-size:var(--type-h2);line-height:var(--leading-h2);letter-spacing:var(--tracking-h2);font-weight:var(--weight-h2)}');
    cssParts.push('h3{font-size:var(--type-h3);line-height:var(--leading-h3);letter-spacing:var(--tracking-h3);font-weight:var(--weight-h3)}');
    cssParts.push('body{font-size:var(--type-body);line-height:var(--leading-body);letter-spacing:var(--tracking-body);font-family:var(--font-body)}');
    cssParts.push('small{font-size:var(--type-small);letter-spacing:var(--tracking-small)}');

    return {
      archetype: arch.label,
      archetypeKey: arch === ARCHETYPES[archetypeKey] ? archetypeKey : undefined,
      ratio: scale.ratio,
      ratioKey: ratioKey,
      roles: scale.roles,
      families: { heading: arch.headingFamily, body: arch.bodyFamily },
      sizes: (function () {
        var s = {};
        for (var k in scale.roles) s[k] = scale.roles[k].clamp;
        return s;
      })(),
      css: cssParts.join('\n')
    };
  };

  /* ---------------- exports ---------------- */

  Typography.ROLE_ORDER = ROLE_ORDER;
  Typography.LINE_HEIGHTS = LINE_HEIGHTS;
  Typography.DEFAULTS = { base: DEFAULT_BASE, minVp: DEFAULT_MIN_VP, maxVp: DEFAULT_MAX_VP };
  Typography.resolveArchetype = resolveArchetype;

  if (typeof module !== 'undefined' && module.exports) module.exports = Typography;
})();
