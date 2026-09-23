// ============================================================
// PallettAI Studio — SurfaceShaders
// Procedural, light-physics surface treatments in OKLCH.
//
//   generateGlassmorphismCSS(blurPx, opacity, borderOpacity)
//     Frosted multi-layer glass: backdrop blur + saturation,
//     SVG fractal-noise grain backdrop, sheen gradient, and a
//     sub-pixel (0.5px) inset edge highlight — the detail that
//     makes real glass read as glass instead of grey paste.
//
//   generateNeumorphicCSS(distancePx, blurPx, baseColorOKLCH, isPressed)
//     Dual-shadow soft-UI. Light comes from the top-left: the
//     extruded state casts a hue-tinted dark shadow bottom-right
//     and a light highlight top-left; pressed inverts both into
//     inset shadows. Derivatives keep hue H exactly and move only
//     L (chroma gently compressed toward white/black).
//
//   generateClaymorphismCSS(depthPx, cornerRadiusPx, primaryOKLCH)
//     Volumetric clay: a lighter tinted canvas of the same hue,
//     one ambient coloured drop shadow, and multi-layer inset
//     rim lights (strong white top, soft bounce + dark core
//     bottom). Card and pill shapes.
//
// All derived colours stay in OKLCH (emitted as oklch() strings
// with hex equivalents computed via Ottosson matrices + gamut
// mapping for validation and click-to-copy). CommonJS + browser
// global, like the rest of modules/.
// ============================================================
(function () {
  'use strict';

  const SurfaceShaders = {};

  /* ---------------- OKLCH plumbing ---------------- */

  function round(n, dp) {
    var f = Math.pow(10, dp == null ? 4 : dp);
    return Math.round(n * f) / f;
  }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  /**
   * parseOKLCH('oklch(0.62 0.19 25.6)' | 'oklch(0.62 0.19 25.6 / 0.4)'
   *           | {l,c,h}) -> { ok, l, c, h, alpha }
   */
  SurfaceShaders.parseOKLCH = function (input) {
    if (input && typeof input === 'object') {
      var l = Number(input.l), c = Number(input.c), h = Number(input.h);
      if (!isFinite(l) || !isFinite(c) || !isFinite(h)) return { ok: false, error: 'l, c, h must be finite numbers' };
      return { ok: true, l: clamp(l, 0, 1), c: Math.max(0, c), h: ((h % 360) + 360) % 360, alpha: input.a == null ? 1 : clamp(Number(input.a) || 0, 0, 1) };
    }
    var m = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*(?:\/\s*([\d.]+)\s*)?\)$/.exec(String(input || '').trim());
    if (!m) return { ok: false, error: 'not an oklch() colour: ' + String(input) };
    var pl = parseFloat(m[1]), pc = parseFloat(m[2]), ph = parseFloat(m[3]);
    return {
      ok: true,
      l: clamp(pl, 0, 1),
      c: Math.max(0, pc),
      h: ((ph % 360) + 360) % 360,
      alpha: m[4] == null ? 1 : clamp(parseFloat(m[4]), 0, 1)
    };
  };

  function oklchStr(c, alpha) {
    var a = alpha == null ? c.alpha : alpha;
    var core = round(c.l, 4) + ' ' + round(c.c, 4) + ' ' + round(c.h, 3);
    return a >= 1 ? 'oklch(' + core + ')' : 'oklch(' + core + ' / ' + round(a, 3) + ')';
  }

  function shift(base, dL, cScale, alpha) {
    return {
      l: clamp(base.l + dL, 0.04, 0.99),
      c: Math.max(0, base.c * cScale),
      h: base.h,                        // hue is never touched
      alpha: alpha == null ? 1 : alpha
    };
  }

  /* Ottosson OKLab → linear sRGB, with chroma-reduction gamut
   * mapping so out-of-sRGB derivations keep their hue. */
  function oklchToLinear(c) {
    var hRad = c.h * Math.PI / 180;
    var a = c.c * Math.cos(hRad), b = c.c * Math.sin(hRad);
    var l_ = c.l + 0.3963377774 * a + 0.2158037573 * b;
    var m_ = c.l - 0.1055613458 * a - 0.0638541728 * b;
    var s_ = c.l - 0.0894841775 * a - 1.2914855480 * b;
    var L = l_ * l_ * l_, M = m_ * m_ * m_, S = s_ * s_ * s_;
    return [
      +4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
      -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
      -0.0041960863 * L - 0.7034186147 * M + 1.7076147010 * S
    ];
  }

  function linearToSrgb8(u) {
    var v = u <= 0.0031308 ? 12.92 * u : 1.055 * Math.pow(u, 1 / 2.4) - 0.055;
    return Math.round(clamp(v, 0, 1) * 255);
  }

  function inGamut(lin) {
    return lin.every(function (u) { return u >= -1e-4 && u <= 1 + 1e-4; });
  }

  function toHex(c) {
    var chroma = c.c;
    var lin = oklchToLinear({ l: c.l, c: chroma, h: c.h });
    while (!inGamut(lin) && chroma > 0.0005) {
      chroma *= 0.97;
      lin = oklchToLinear({ l: c.l, c: chroma, h: c.h });
    }
    var rgb = lin.map(linearToSrgb8);
    return '#' + rgb.map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join('');
  }

  SurfaceShaders.oklchToHex = function (input) {
    var p = SurfaceShaders.parseOKLCH(input);
    if (!p.ok) return null;
    return toHex(p);
  };

  function describe(c) {
    return { css: oklchStr(c), hex: toHex(c), l: round(c.l, 4), c: round(c.c, 4), h: round(c.h, 3) };
  }

  /* ---------------- Glassmorphism ---------------- */

  var NOISE_SVG =
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E" +
    "%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E" +
    "%3CfeColorMatrix type='saturate' values='0'/%3E" +
    "%3CfeComponentTransfer%3E%3CfeFuncA type='linear' slope='0.07'/%3E%3C/feComponentTransfer%3E" +
    "%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)'/%3E%3C/svg%3E\")";

  /**
   * generateGlassmorphismCSS(blurPx, opacity, borderOpacity, options)
   * options: { selector = '.pai-glass', tint = {l:0.55,c:0.14,h:250},
   *            saturate = 1.4, radius = '20px', noise = true, sheen = true }
   */
  SurfaceShaders.generateGlassmorphismCSS = function (blurPx, opacity, borderOpacity, options) {
    var opts = options || {};
    var blur = clamp(Number(blurPx) || 0, 0, 40);
    var op = clamp(opacity == null ? 0.5 : Number(opacity), 0, 1);
    var bop = clamp(borderOpacity == null ? 0.4 : Number(borderOpacity), 0, 1);
    var tintP = SurfaceShaders.parseOKLCH(opts.tint || { l: 0.55, c: 0.14, h: 250 });
    if (!tintP.ok) return { ok: false, error: tintP.error };
    var tint = { l: tintP.l, c: tintP.c, h: tintP.h, alpha: 1 };
    var sel = String(opts.selector || '.pai-glass');
    var radius = String(opts.radius || '20px');

    var sheen =
      'linear-gradient(135deg, ' + oklchStr({ l: clamp(tint.l + 0.18, 0, 1), c: tint.c, h: tint.h, alpha: op * 1.15 }) + ' 0%, ' +
      oklchStr({ l: clamp(tint.l - 0.05, 0, 1), c: tint.c, h: tint.h, alpha: op * 0.85 }) + ' 100%)';

    var layers = [];
    if (opts.sheen !== false) layers.push(sheen);
    if (opts.noise !== false) layers.push(NOISE_SVG);

    var css =
      sel + ' {\n' +
      '  background-image: ' + layers.join(',\n    ') + ';\n' +
      '  background-color: ' + oklchStr(tint, op) + ';\n' +
      (blur > 0
        ? '  backdrop-filter: blur(' + round(blur, 2) + 'px)' + (opts.saturate === 0 ? '' : ' saturate(' + (opts.saturate || 1.4) + ')') + ';\n' +
          '  -webkit-backdrop-filter: blur(' + round(blur, 2) + 'px)' + (opts.saturate === 0 ? '' : ' saturate(' + (opts.saturate || 1.4) + ')') + ';\n'
        : '') +
      '  border: 1px solid ' + oklchStr(shift(tint, 0.35, 0.35), bop) + ';\n' +
      '  border-radius: ' + radius + ';\n' +
      '  box-shadow:\n' +
      '    inset 0 0 0 0.5px rgb(255 255 255 / ' + round(clamp(bop * 0.9, 0, 1), 3) + '),\n' +   // sub-pixel edge
      '    inset 0 1px 0 0 rgb(255 255 255 / ' + round(clamp(bop * 0.6, 0, 1), 3) + '),\n' +      // top rim
      '    inset 0 -1px 0 0 rgb(0 0 0 / 0.08),\n' +                                               // bottom occlusion
      '    0 8px 32px rgb(10 14 30 / ' + round(clamp(op * 0.24, 0.04, 0.5), 3) + ');\n' +         // ambient drop
      '  color: ' + oklchStr(shift(tint, -0.38, 0.4)) + ';\n' +
      '}';

    return {
      ok: true,
      css: css,
      selector: sel,
      blurPx: blur,
      opacity: op,
      borderOpacity: bop,
      derived: { tint: describe(tint), edge: describe(shift(tint, 0.35, 0.35)), ink: describe(shift(tint, -0.38, 0.4)) },
      hasNoise: opts.noise !== false,
      hasBackdropFilter: blur > 0
    };
  };

  /* ---------------- Neumorphism ---------------- */

  /**
   * generateNeumorphicCSS(distancePx, blurPx, baseColorOKLCH, isPressed, options)
   * options: { selector = '.pai-neu', radius = '20px' }
   * Light source: top-left. Extruded = dark shadow bottom-right +
   * light highlight top-left; pressed = both inset and swapped.
   */
  SurfaceShaders.generateNeumorphicCSS = function (distancePx, blurPx, baseColorOKLCH, isPressed, options) {
    var opts = options || {};
    var d = clamp(Number(distancePx) || 0, 0, 24);
    var b = clamp(Number(blurPx) == null ? d * 2 : Number(blurPx), 0, 60);
    var baseP = SurfaceShaders.parseOKLCH(baseColorOKLCH);
    if (!baseP.ok) return { ok: false, error: baseP.error };
    var base = { l: baseP.l, c: baseP.c, h: baseP.h, alpha: 1 };

    // Derivatives: hue frozen; dark loses a little chroma (shadows
    // desaturate), highlight compresses chroma hard toward white.
    var shadow = shift(base, -0.11, 0.85);
    var highlight = shift(base, base.l > 0.86 ? 0.99 - base.l : 0.09, 0.4);
    var ink = shift(base, base.l > 0.5 ? -0.4 : 0.45, base.l > 0.5 ? 0.5 : 0.7);

    var inset = isPressed ? 'inset ' : '';
    var dir = isPressed ? -1 : 1; // pressed throws dark top-left
    var shadows =
      inset + round(dir * d, 2) + 'px ' + round(dir * d, 2) + 'px ' + round(b, 2) + 'px ' + oklchStr(shadow) + ',\n' +
      inset + round(-dir * d, 2) + 'px ' + round(-dir * d, 2) + 'px ' + round(b, 2) + 'px ' + oklchStr(highlight);
    var sel = String(opts.selector || '.pai-neu');
    var css =
      sel + ' {\n' +
      '  background: ' + oklchStr(base) + ';\n' +
      '  color: ' + oklchStr(ink) + ';\n' +
      '  border: none;\n' +
      '  border-radius: ' + String(opts.radius || '20px') + ';\n' +
      '  box-shadow:\n' +
      '    ' + shadows.replace(/\n/g, '\n    ') + ';\n' +
      '}';

    return {
      ok: true,
      css: css,
      selector: sel,
      isPressed: !!isPressed,
      distancePx: d,
      blurPx: b,
      derived: { base: describe(base), shadow: describe(shadow), highlight: describe(highlight), ink: describe(ink) }
    };
  };

  /* ---------------- Claymorphism ---------------- */

  /**
   * generateClaymorphismCSS(depthPx, cornerRadiusPx, primaryOKLCH, options)
   * options: { selector = '.pai-clay', shape = 'card' | 'pill' }
   * Multi-layer rim lights: strong white top inset, soft light
   * bounce bottom inset, dark core inset, ambient coloured drop.
   */
  SurfaceShaders.generateClaymorphismCSS = function (depthPx, cornerRadiusPx, primaryOKLCH, options) {
    var opts = options || {};
    var depth = clamp(Number(depthPx) || 0, 1, 40);
    var baseP = SurfaceShaders.parseOKLCH(primaryOKLCH);
    if (!baseP.ok) return { ok: false, error: baseP.error };
    var primary = { l: baseP.l, c: baseP.c, h: baseP.h, alpha: 1 };

    var canvas = shift(primary, primary.l > 0.8 ? 0.06 : 0.16, 0.7);   // lighter, same hue
    var dark = shift(primary, -0.16, 1.0);
    var rimLight = { l: 0.985, c: Math.min(primary.c * 0.12, 0.02), h: primary.h };
    var bounce = shift(primary, 0.05, 0.5);
    var ink = shift(primary, primary.l > 0.5 ? -0.42 : 0.5, 0.6);

    var drop = round(depth * 1.6, 2);
    var radius = opts.shape === 'pill' ? '9999px' : String(clamp(Number(cornerRadiusPx) || 0, 0, 9999)) + 'px';

    var sel = String(opts.selector || '.pai-clay');
    var css =
      sel + ' {\n' +
      '  background: ' + oklchStr(canvas) + ';\n' +
      '  color: ' + oklchStr(ink) + ';\n' +
      '  border: none;\n' +
      '  border-radius: ' + radius + ';\n' +
      '  box-shadow:\n' +
      '    0 ' + round(depth * 0.9, 2) + 'px ' + drop + 'px ' + oklchStr(dark, 0.4) + ',\n' +            // ambient coloured drop
      '    inset 0 ' + round(depth * 0.35, 2) + 'px ' + round(depth * 0.7, 2) + 'px ' + oklchStr(rimLight, 0.95) + ',\n' + // top rim light
      '    inset 0 ' + round(-depth * 0.22, 2) + 'px ' + round(depth * 0.45, 2) + 'px ' + oklchStr(bounce, 0.6) + ',\n' +  // bottom bounce
      '    inset 0 ' + round(-depth * 0.3, 2) + 'px ' + round(depth * 0.6, 2) + 'px ' + oklchStr(dark, 0.3) + ';\n' +      // dark core
      '  padding: ' + round(depth * 0.6, 2) + 'px ' + round(depth * 0.9, 2) + 'px;\n' +
      '}';

    return {
      ok: true,
      css: css,
      selector: sel,
      shape: opts.shape === 'pill' ? 'pill' : 'card',
      depthPx: depth,
      cornerRadiusPx: radius,
      derived: { primary: describe(primary), canvas: describe(canvas), dark: describe(dark), rimLight: describe(rimLight) }
    };
  };

  /* ---------------- Bundle ---------------- */

  /**
   * generateAllShaders(baseColorOKLCH, options)
   * One stylesheet with every surface state for a token colour:
   * glass, neu extruded, neu pressed, clay card, clay pill.
   */
  SurfaceShaders.generateAllShaders = function (baseColorOKLCH, options) {
    var opts = options || {};
    var glass = SurfaceShaders.generateGlassmorphismCSS(opts.glassBlur == null ? 14 : opts.glassBlur, opts.glassOpacity, opts.glassBorderOpacity, { selector: '.pai-glass', tint: baseColorOKLCH });
    var neu = SurfaceShaders.generateNeumorphicCSS(opts.neuDistance == null ? 6 : opts.neuDistance, opts.neuBlur, baseColorOKLCH, false, { selector: '.pai-neu' });
    var neuPressed = SurfaceShaders.generateNeumorphicCSS(opts.neuDistance == null ? 6 : opts.neuDistance, opts.neuBlur, baseColorOKLCH, true, { selector: '.pai-neu--pressed' });
    var clay = SurfaceShaders.generateClaymorphismCSS(opts.clayDepth == null ? 18 : opts.clayDepth, opts.clayRadius == null ? 28 : opts.clayRadius, baseColorOKLCH, { selector: '.pai-clay' });
    var clayPill = SurfaceShaders.generateClaymorphismCSS(opts.clayDepth == null ? 18 : opts.clayDepth, 0, baseColorOKLCH, { selector: '.pai-clay--pill', shape: 'pill' });

    var fails = [glass, neu, neuPressed, clay, clayPill].filter(function (r) { return !r.ok; });
    if (fails.length) return { ok: false, error: fails[0].error };

    var stylesheet = [glass, neu, neuPressed, clay, clayPill].map(function (r) { return r.css; }).join('\n\n');
    return {
      ok: true,
      stylesheet: stylesheet,
      surfaces: { glass: glass, neu: neu, neuPressed: neuPressed, clay: clay, clayPill: clayPill }
    };
  };

  /* CommonJS + browser global */
  if (typeof module !== 'undefined' && module.exports) module.exports = SurfaceShaders;
  if (typeof window !== 'undefined') window.SurfaceShaders = SurfaceShaders;
})();
