// ============================================================
// PallettAI Studio — Textures
// Procedural inline SVG pattern/texture generator.
//
// generateArchetypeTexture(archetypeKey, primaryColorOKLCH, options)
//   Emits the archetype's signature background as a self-contained
//   inline SVG string and — because a background-image cannot hold
//   raw SVG — as a `data:image/svg+xml` URI with CSS-variable
//   colour bindings. Colours arrive as oklch() strings or hex and
//   are bound through CSS custom properties, so themes can retint
//   the texture by swapping variables, not re-generating markup.
//
//     bento-glass         20px blueprint grid + gradient backdrop
//     brutalist-kinetic   8px halftone dot matrix + hazard stripes
//     editorial-magazine  paper grain + vertical column guides
//     retro-cyberpunk     scanline grid + neon glow filters
//     organic-clay        smooth topographic wave paths
//
// Every string stays under 1.5KB, every hue comes from CSS
// variables, and no network request is involved — ever.
//
// CommonJS + browser global, like the rest of modules/.
// ============================================================
(function () {
  'use strict';

  const Textures = {};

  /* ---------------- colour helpers ---------------- */

  // Local minimal OKLCH→sRGB conversion (Ottosson's public-domain
  // matrices) — enough to bind oklch() input colours to hex data-URI
  // palettes without pulling the theme engine in.
  function clamp01(x) { return Math.max(0, Math.min(1, x)); }

  function linearToSrgb(c) {
    return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  }

  function oklchToRgb(l, c, h) {
    var rad = h * Math.PI / 180;
    var a = Math.cos(rad) * c;
    var b = Math.sin(rad) * c;
    var l_ = l + 0.3963377774 * a + 0.2158037573 * b;
    var m_ = l - 0.1055613458 * a - 0.0638541728 * b;
    var s_ = l - 0.0894841775 * a - 1.2914855480 * b;
    var L = l_ * l_ * l_, M = m_ * m_ * m_, S = s_ * s_ * s_;
    return {
      r: 4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
      g: -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
      b: -0.0041960863 * L - 0.7034186147 * M + 1.7076147010 * S
    };
  }

  function inGamut(lin) {
    return lin.r >= -0.0005 && lin.r <= 1.0005 && lin.g >= -0.0005 && lin.g <= 1.0005 && lin.b >= -0.0005 && lin.b <= 1.0005;
  }

  function oklchToHex(l, c, h) {
    // Gamut map by chroma reduction — clamping linear values before
    // the transfer curve was the bug that saturated vivid hues to
    // primary red/blue. Hue and lightness stay fixed while chroma
    // walks down until the colour fits sRGB.
    var cc = Math.max(0, c);
    var lin = oklchToRgb(l, cc, h);
    for (var i = 0; i < 24 && !inGamut(lin); i++) {
      cc *= 0.94;
      lin = oklchToRgb(l, cc, h);
    }
    var to = function (v) {
      var n = Math.round(clamp01(linearToSrgb(clamp01(v))) * 255).toString(16);
      return n.length === 1 ? '0' + n : n;
    };
    return '#' + to(lin.r) + to(lin.g) + to(lin.b);
  }

  // Accept '#abc', '#aabbcc', 'oklch(0.62 0.17 250)'.
  function parseColor(input) {
    var s = String(input == null ? '' : input).trim();
    var hex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(s);
    if (hex) {
      var h = hex[1];
      if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
      return { hex: '#' + h.toLowerCase(), css: '#' + h.toLowerCase() };
    }
    var m = /^oklch\(\s*([\d.]+)%?\s+([\d.]+)\s+([\d.]+)\s*\)$/i.exec(s);
    if (m) {
      var L = parseFloat(m[1]);
      if (/%$/.test(m[1]) || L > 1) L = L > 1 ? L / 100 : L;
      var C = parseFloat(m[2]);
      var H = parseFloat(m[3]);
      return { hex: oklchToHex(clamp01(L), Math.max(0, C), H), css: 'oklch(' + L + ' ' + C + ' ' + H + ')' };
    }
    return { hex: '#7c5cff', css: '#7c5cff' };
  }

  function b64Utf8(s) {
    if (typeof Buffer !== 'undefined' && Buffer.from) {
      try { return Buffer.from(s, 'utf8').toString('base64'); } catch (e) { /* fall through */ }
    }
    if (typeof btoa === 'function') {
      try { return btoa(unescape(encodeURIComponent(s))); } catch (e) { return ''; }
    }
    return '';
  }

  /* ---------------- texture recipes ---------------- */

  var ARCHETYPE_KEYS = [
    'bento-glass', 'brutalist-kinetic', 'editorial-magazine',
    'retro-cyberpunk', 'organic-clay'
  ];

  /*
    Each recipe returns { svg, vars } where `vars` maps CSS custom
    property names to their resolved values. All archetype palettes
    keep the input hue — textures tint, they never re-hue.
  */

  var RECIPES = {

    'bento-glass': function (col, opts) {
      var cell = Math.max(8, Math.round(Number(opts.cell) || 20)); // the 20px blueprint
      var svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="' + (cell * 2) + '" height="' + (cell * 2) + '" viewBox="0 0 ' + (cell * 2) + ' ' + (cell * 2) + '">' +
        '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
        '<stop offset="0" stop-color="var(--tx-accent)" stop-opacity="0.10"/>' +
        '<stop offset="1" stop-color="var(--tx-surface)" stop-opacity="0.02"/>' +
        '</linearGradient></defs>' +
        '<rect width="100%" height="100%" fill="url(#g)"/>' +
        '<path d="M ' + (cell + 0.5) + ' 0 V ' + (cell * 2) + ' M 0 ' + (cell + 0.5) + ' H ' + (cell * 2) + '" stroke="var(--tx-line)" stroke-opacity="0.25" fill="none"/>' +
        '<path d="M 0.5 0 V ' + (cell * 2) + ' M ' + (cell * 2 - 0.5) + ' 0 V ' + (cell * 2) + '" stroke="var(--tx-line)" stroke-opacity="0.12" fill="none"/>' +
        '</svg>';
      return { svg: svg, vars: { '--tx-accent': col.css, '--tx-surface': col.hex, '--tx-line': col.hex } };
    },

    'brutalist-kinetic': function (col, opts) {
      // 8px halftone dot matrix; `stripes` opts into hazard diagonals.
      var cell = Math.max(4, Math.round(Number(opts.cell) || 8));
      var r = (cell * 0.22).toFixed(2);
      var svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="' + cell + '" height="' + cell + '" viewBox="0 0 ' + cell + ' ' + cell + '">' +
        '<rect width="100%" height="100%" fill="var(--tx-surface)"/>' +
        '<circle cx="' + (cell / 2) + '" cy="' + (cell / 2) + '" r="' + r + '" fill="var(--tx-accent)"/>' +
        '</svg>';
      if (opts.stripes) {
        svg =
          '<svg xmlns="http://www.w3.org/2000/svg" width="' + (cell * 4) + '" height="' + (cell * 4) + '" viewBox="0 0 ' + (cell * 4) + ' ' + (cell * 4) + '">' +
          '<rect width="100%" height="100%" fill="var(--tx-surface)"/>' +
          '<path d="M -1 ' + (cell * 2) + ' L ' + (cell * 2) + ' -1 M 0 ' + (cell * 4) + ' L ' + (cell * 4) + ' 0 M ' + (cell * 2) + ' ' + (cell * 4 + 1) + ' L ' + (cell * 4 + 1) + ' ' + (cell * 2) + '" stroke="var(--tx-accent)" stroke-width="' + cell + '" fill="none"/>' +
          '</svg>';
      }
      return { svg: svg, vars: { '--tx-accent': col.css, '--tx-surface': col.surfaceHex } };
    },

    'editorial-magazine': function (col, opts) {
      // Paper grain (fractal noise, very low opacity) + vertical
      // column guide rules at the archetype's measure.
      var cols = Math.max(2, Math.round(Number(opts.columns) || 6));
      var w = 1200, h = 400;
      var step = w / cols;
      var guides = '';
      for (var i = 1; i < cols; i++) {
        guides += '<path d="M ' + (i * step + 0.5) + ' 0 V ' + h + '" stroke="var(--tx-line)" stroke-opacity="0.10"/>';
      }
      var svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
        '<defs><filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="11" stitchTiles="stitch"/>' +
        '<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.05 0"/></filter></defs>' +
        '<rect width="100%" height="100%" fill="var(--tx-surface)"/>' +
        '<rect width="100%" height="100%" filter="url(#grain)"/>' +
        guides +
        '</svg>';
      return { svg: svg, vars: { '--tx-surface': col.surfaceHex, '--tx-line': col.hex } };
    },

    'retro-cyberpunk': function (col, opts) {
      // Scanline grid with neon glow (feGaussianBlur + feMerge).
      var cell = Math.max(3, Math.round(Number(opts.cell) || 4));
      var svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="' + (cell * 2) + '" height="' + (cell * 2) + '" viewBox="0 0 ' + (cell * 2) + ' ' + (cell * 2) + '">' +
        '<defs><filter id="neon" x="-50%" y="-50%" width="200%" height="200%">' +
        '<feGaussianBlur stdDeviation="1.2" result="b"/>' +
        '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>' +
        '</filter></defs>' +
        '<rect width="100%" height="100%" fill="var(--tx-surface)"/>' +
        '<path d="M 0 ' + (cell / 2) + ' H ' + (cell * 2) + '" stroke="var(--tx-accent)" stroke-width="1" filter="url(#neon)"/>' +
        '<path d="M ' + (cell / 2) + ' 0 V ' + (cell * 2) + '" stroke="var(--tx-accent)" stroke-opacity="0.35"/>' +
        '</svg>';
      return { svg: svg, vars: { '--tx-accent': col.css, '--tx-surface': col.surfaceHex } };
    },

    'organic-clay': function (col, opts) {
      // Smooth topographic wave paths — cubic beziers, never
      // polylines; opacity layers fake the contour depth.
      var w = 240, h = 160;
      var lines = Math.max(3, Math.round(Number(opts.lines) || 5));
      var paths = '';
      for (var i = 0; i < lines; i++) {
        var y = 24 + i * ((h - 48) / Math.max(1, lines - 1));
        var amp = 14 + (i % 3) * 6;
        paths += '<path d="M -10 ' + y + ' C ' + (w * 0.25) + ' ' + (y - amp) + ', ' + (w * 0.45) + ' ' + (y + amp) + ', ' + (w * 0.7) + ' ' + y + ' S ' + (w + 10) + ' ' + (y - amp * 0.6) + ', ' + (w + 10) + ' ' + y + '" fill="none" stroke="var(--tx-accent)" stroke-opacity="' + (0.5 - i * (0.4 / lines)).toFixed(2) + '" stroke-width="1.5"/>';
      }
      var svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
        '<rect width="100%" height="100%" fill="var(--tx-surface)"/>' +
        paths +
        '</svg>';
      return { svg: svg, vars: { '--tx-accent': col.css, '--tx-surface': col.surfaceHex } };
    }
  };

  /* ---------------- main entry ---------------- */

  /**
   * generateArchetypeTexture(archetypeKey, primaryColorOKLCH, options?)
   * @param {string} archetypeKey  bento-glass | brutalist-kinetic |
   *        editorial-magazine | retro-cyberpunk | organic-clay
   * @param {string} primaryColorOKLCH  'oklch(...)' or hex accent
   * @param {object} [options] { asUri, cell, columns, lines, stripes, surface, dataUriOnly }
   * @returns {{ ok, archetype, svg, dataUri, cssVars, css, bytes } |
   *           { ok: false, error }}
   */
  Textures.generateArchetypeTexture = function (archetypeKey, primaryColorOKLCH, options) {
    var opts = options || {};
    var key = String(archetypeKey || '').toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');
    var recipe = RECIPES[key];
    if (!recipe) {
      return { ok: false, error: 'Unknown archetype: ' + archetypeKey + ' — expected one of: ' + ARCHETYPE_KEYS.join(', ') };
    }
    var col = parseColor(primaryColorOKLCH);
    // Surfaces: a neutral, dark or light, derived from the input's
    // lightness so the texture works on both themes.
    var surface = opts.surface || (function () {
      var m = /^oklch\(\s*([\d.]+)%?\s/.exec(String(primaryColorOKLCH || ''));
      var L = m ? parseFloat(m[1]) : 0.5;
      if (L > 1) L = L / 100;
      return L >= 0.55 ? '#ffffff' : '#101014';
    })();
    col.surfaceHex = surface;

    var out = recipe(col, opts);
    var svg = out.svg;
    var vars = out.vars;
    var b64 = b64Utf8(svg);
    var dataUri = b64 ? 'data:image/svg+xml;base64,' + b64 : '';

    var cssVars = ':root{' + Object.keys(vars).map(function (k) { return k + ':' + vars[k]; }).join(';') + '}';
    var css = '.pv-tex--' + key + '{background-image:url("' + dataUri + '");background-size:' + (opts.bgSize || 'auto') + '}';

    return {
      ok: true,
      archetype: key,
      svg: opts.dataUriOnly ? '' : svg,
      dataUri: dataUri,
      cssVars: cssVars,
      css: cssVars + css,
      bytes: svg.length
    };
  };

  /* ---------------- exports ---------------- */

  Textures.ARCHETYPE_KEYS = ARCHETYPE_KEYS;
  Textures.parseColor = parseColor;
  Textures.oklchToHex = oklchToHex;

  if (typeof module !== 'undefined' && module.exports) module.exports = Textures;
})();
