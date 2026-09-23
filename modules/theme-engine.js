// ============================================================
// PallettAI Studio — ThemeEngine
// Zero-FOUC dark/light token switching + OKLCH inversion.
//
// Three pieces:
//
// 1. generateThemeToggleScript(options)
//    A ~0.3KB minified inline snippet for the exported <head>.
//    It resolves the theme BEFORE first paint — stored override
//    in localStorage ('light' | 'dark' | 'system'), else the OS
//    preference — so there is no flash of the wrong colours.
//
// 2. buildThemeRuntimeScript(options)
//    The toggle-button runtime: cycles the stored override,
//    follows live OS changes while in 'system', and keeps
//    <meta name="color-scheme"> in sync.
//
// 3. invertOKLCHPalette(tokenMap, options)
//    The maths a dark mode deserves. Every token is read into
//    OKLCH (from hex or oklch() strings); lightness is mirrored
//    into the dark-mode floor/ceiling band, chroma is rescaled
//    toward the archetype's dark-mode chroma, and hue is kept
//    EXACTLY stable. Text tokens are then verified against their
//    backgrounds at WCAG AA (4.5:1) and nudged in lightness until
//    they clear — with the final ratios reported, not assumed.
//
// CommonJS + browser global, like the rest of modules/.
// ============================================================
(function () {
  'use strict';

  const ThemeEngine = {};

  /* ============================================================
     1 — the head snippet (FOUC killer)
     ============================================================ */

  // Kept as one literal so the byte count is honest and stable.
  // Resolves override → system and sets <html data-theme> before
  // first paint; the emitted CSS block sets color-scheme per
  // data-theme, so the snippet never touches styles. ≈0.3KB.
  var HEAD_SNIPPET = '(function(){try{var k="pallettai.theme",L=localStorage,s=L.getItem(k)||"system",d=matchMedia("(prefers-color-scheme: dark)"),t=s=="system"?d.matches?"dark":"light":s;document.documentElement.dataset.theme=t;window.__pt={mode:()=>s,sys:d}}catch(_){}})();';

  /**
   * The toggle snippet is inlined into the exported <head>, so its
   * literals must be safe inside an HTML <script> element. JSON.stringify
   * alone leaves `<` intact — a storageKey containing `</script>` would
   * close the element early and let the rest parse as markup.
   */
  function jsLiteral(value) {
    return JSON.stringify(String(value))
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026');
  }

  ThemeEngine.generateThemeToggleScript = function (options) {
    var opts = options || {};
    if (opts.storageKey && opts.storageKey !== 'pallettai.theme') {
      // Same logic, custom key — still one pass, still tiny.
      var k = jsLiteral(opts.storageKey);
      return '(function(){try{var k=' + k + ',L=localStorage,s=L.getItem(k)||"system",d=matchMedia("(prefers-color-scheme: dark)"),t=s=="system"?d.matches?"dark":"light":s;document.documentElement.dataset.theme=t;window.__pt={mode:()=>s,sys:d}}catch(_){}})();';
    }
    return HEAD_SNIPPET;
  };

  /* ============================================================
     2 — the runtime (toggle button behaviour)
     ============================================================ */

  ThemeEngine.buildThemeRuntimeScript = function (options) {
    var opts = options || {};
    var key = jsLiteral(opts.storageKey || 'pallettai.theme');
    var cycle = jsLiteral(opts.cycle || 'light,dark,system');
    return [
      '(function(){',
      '"use strict";',
      'var CYCLE=' + cycle + '.split(","),K=' + key + ';',
      'var DARK=window.matchMedia("(prefers-color-scheme: dark)");',
      'function mode(){try{return localStorage.getItem(K)||"system";}catch(e){return "system";}}',
      'function resolve(m){return m==="system"?(DARK.matches?"dark":"light"):m;}',
      'function apply(m){var t=resolve(m);document.documentElement.dataset.theme=t;',
      'document.documentElement.style.colorScheme=t;',
      'document.documentElement.setAttribute("data-theme-mode",m);',
      'document.dispatchEvent(new CustomEvent("pallettai:theme",{detail:{mode:m,theme:t}}));}',
      'function set(m){try{localStorage.setItem(K,m);}catch(e){}apply(m);}',
      'function next(){var c=CYCLE,m=mode(),i=c.indexOf(m);set(c[(i+1+c.length)%c.length]);}',
      'document.addEventListener("click",function(ev){var b=ev.target.closest&&ev.target.closest("[data-theme-toggle]");if(b){ev.preventDefault();next();}});',
      'DARK.addEventListener&&DARK.addEventListener("change",function(){if(mode()==="system")apply("system");});',
      'apply(mode());',
      '})();'
    ].join('\n');
  };

  /* ============================================================
     3 — colour maths: sRGB ⇄ OKLab ⇄ OKLCH
     ============================================================ */

  function clamp01(x) { return Math.max(0, Math.min(1, x)); }

  function kebab(s) { return String(s).replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase(); }

  function srgbToLinear(c) {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  function linearToSrgb(c) {
    return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  }

  // hex '#rgb' '#rrggbb' → { r,g,b } in 0..1 sRGB (non-linear)
  function hexToRgb01(hex) {
    var h = String(hex || '').trim().replace(/^#/, '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    return {
      r: parseInt(h.slice(0, 2), 16) / 255,
      g: parseInt(h.slice(2, 4), 16) / 255,
      b: parseInt(h.slice(4, 6), 16) / 255
    };
  }

  function rgb01ToHex(rgb) {
    var to = function (v) {
      var n = Math.round(clamp01(v) * 255).toString(16);
      return n.length === 1 ? '0' + n : n;
    };
    return '#' + to(rgb.r) + to(rgb.g) + to(rgb.b);
  }

  // Björn Ottosson's OKLab matrices (public domain).
  function linearToOklab(c) {
    var l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
    var m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
    var s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
    var l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
    return {
      L: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
      a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
      b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
    };
  }
  function oklabToLinear(lab) {
    var l_ = lab.L + 0.3963377774 * lab.a + 0.2158037573 * lab.b;
    var m_ = lab.L - 0.1055613458 * lab.a - 0.0638541728 * lab.b;
    var s_ = lab.L - 0.0894841775 * lab.a - 1.2914855480 * lab.b;
    var l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
    return {
      r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      b: -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    };
  }

  function oklabToOklch(lab) {
    var C = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
    var H = Math.atan2(lab.b, lab.a) * 180 / Math.PI;
    if (H < 0) H += 360;
    return { L: lab.L, C: C, H: H };
  }
  function oklchToOklab(lch) {
    var rad = lch.H * Math.PI / 180;
    return { L: lch.L, a: Math.cos(rad) * lch.C, b: Math.sin(rad) * lch.C };
  }

  // Parse 'oklch(0.62 0.17 250)' / 'oklch(62% 0.17 250)' or hex.
  function parseToOklch(str) {
    var s = String(str == null ? '' : str).trim().toLowerCase();
    var m = /^oklch\(\s*([\d.]+)%?\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(s);
    if (m) {
      var L = parseFloat(m[1]);
      if (/%$/.test(m[1]) || L > 1) L = L > 1 ? L / 100 : L;
      return { L: clamp01(L), C: Math.max(0, parseFloat(m[2])), H: ((parseFloat(m[3]) % 360) + 360) % 360 };
    }
    var rgb = hexToRgb01(s);
    if (rgb) return oklabToOklch(linearToOklab({ r: srgbToLinear(rgb.r), g: srgbToLinear(rgb.g), b: srgbToLinear(rgb.b) }));
    return null;
  }

  // OKLCH → best-effort sRGB hex (gamut mapped by chroma reduction).
  // The sRGB transfer curve is applied BEFORE byte packing — linear
  // values written raw were the bug that made every hex darker.
  function oklchToHex(lch) {
    var c = { L: clamp01(lch.L), C: Math.max(0, lch.C), H: lch.H };
    var out = null;
    for (var i = 0; i < 24; i++) {
      var lin = oklabToLinear(oklchToOklab(c));
      if (lin.r >= -0.0005 && lin.r <= 1.0005 && lin.g >= -0.0005 && lin.g <= 1.0005 && lin.b >= -0.0005 && lin.b <= 1.0005) {
        out = { r: clamp01(linearToSrgb(clamp01(lin.r))), g: clamp01(linearToSrgb(clamp01(lin.g))), b: clamp01(linearToSrgb(clamp01(lin.b))) };
        break;
      }
      c.C = Math.max(0, c.C * 0.94);
    }
    if (!out) {
      var grey = oklabToLinear({ L: c.L, a: 0, b: 0 });
      out = { r: clamp01(linearToSrgb(clamp01(grey.r))), g: clamp01(linearToSrgb(clamp01(grey.g))), b: clamp01(linearToSrgb(clamp01(grey.b))) };
    }
    return rgb01ToHex(out);
  }

  function oklchToCss(lch) {
    return 'oklch(' + (Math.round(clamp01(lch.L) * 1000) / 1000) + ' ' +
      (Math.round(lch.C * 1000) / 1000) + ' ' + (Math.round(lch.H * 10) / 10) + ')';
  }

  // WCAG 2.1 relative luminance + contrast, from 0..1 sRGB.
  function luminance01(rgb) {
    var lin = { r: srgbToLinear(rgb.r), g: srgbToLinear(rgb.g), b: srgbToLinear(rgb.b) };
    return 0.2126 * lin.r + 0.7152 * lin.g + 0.0722 * lin.b;
  }
  function hexLuminance(hex) {
    var rgb = hexToRgb01(hex);
    return rgb ? luminance01(rgb) : 0;
  }
  function contrastRatio(hexA, hexB) {
    var la = hexLuminance(hexA), lb = hexLuminance(hexB);
    var hi = Math.max(la, lb), lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  }

  /* ============================================================
     4 — palette inversion
     ============================================================ */

  // Dark-mode bands. Lightness mirrors into these floors/ceilings:
  // backgrounds live low, text lives high, accents stay mid-band.
  var DARK_BAND = { surfaceFloor: 0.14, surfaceCeil: 0.32, textFloor: 0.86, textCeil: 0.97, accentFloor: 0.62, accentCeil: 0.85 };
  // Dark-mode chroma targets per hue family — hues keep their
  // identity while chroma steps down to what dark ground can hold.
  function darkChromaTarget(H) {
    if (H >= 250 && H < 320) return 0.14; // violet/blue family
    if (H >= 180 && H < 250) return 0.11; // cyan/blue-green
    if (H >= 120 && H < 180) return 0.10; // greens
    if (H >= 60 && H < 120) return 0.13;  // yellows/greens
    if (H >= 30 && H < 60) return 0.13;   // oranges
    return 0.13;                          // reds/magentas
  }

  var TOKEN_KEYS = ['primary', 'surface', 'text', 'accent', 'muted'];

  function bandForRole(role) {
    if (role === 'surface') return [DARK_BAND.surfaceFloor, DARK_BAND.surfaceCeil];
    if (role === 'text') return [DARK_BAND.textFloor, DARK_BAND.textCeil];
    return [DARK_BAND.accentFloor, DARK_BAND.accentCeil];
  }

  function classify(tokenKey) {
    if (tokenKey === 'surface') return 'surface';
    if (tokenKey === 'text' || tokenKey === 'muted') return 'text';
    return 'accent';
  }

  /**
   * invertOKLCHPalette(tokenMap, options?)
   * @param {object} tokenMap  { primary, surface, text, accent, muted }
   *   — hex or oklch() strings
   * @param {object} [options] { target 'dark'|'light', chromaScale, minContrast }
   * @returns { tokens, cssVars, mode, contrast, warnings }
   *   tokens: same keys, inverted values (css hex)
   *   cssVars: ready-to-inject custom property block
   *   contrast: per-pair WCAG verification incl. the adjusted flag
   */
  ThemeEngine.invertOKLCHPalette = function (tokenMap, options) {
    var opts = options || {};
    var mode = opts.target === 'light' ? 'light' : 'dark';
    var minContrast = Number(opts.minContrast) || 4.5;
    var warnings = [];

    // Read every token into OKLCH first — one parse, one truth.
    var parsed = {};
    for (var i = 0; i < TOKEN_KEYS.length; i++) {
      var key = TOKEN_KEYS[i];
      var v = tokenMap ? tokenMap[key] : undefined;
      var lch = parseToOklch(v);
      if (!lch) {
        if (v != null && v !== '') warnings.push('"' + key + '" is not a hex or oklch() colour — substituted a neutral.');
        // Sensible neutral defaults so partial maps still invert.
        lch = key === 'surface' ? { L: 0.97, C: 0.004, H: 90 }
          : key === 'text' ? { L: 0.24, C: 0.01, H: 90 }
          : { L: 0.55, C: 0.15, H: 270 };
      }
      parsed[key] = lch;
    }

    var out = {};
    var chromaScale = Number(opts.chromaScale) || (mode === 'dark' ? 1 : 1);

    for (var j = 0; j < TOKEN_KEYS.length; j++) {
      var k2 = TOKEN_KEYS[j];
      var src = parsed[k2];
      var role = classify(k2);
      var res;
      if (mode === 'dark') {
        var band = bandForRole(role);
        // L mirrors: how far above/below mid the source sat, flipped
        // into the dark band. Hue is passed through untouched.
        var flipped = 1 - src.L;
        var span = band[1] - band[0];
        var L = band[0] + clamp01(flipped) * span;
        // Keep mid-band accents from collapsing onto surfaces.
        if (role === 'accent') L = Math.max(L, band[0] + span * 0.55);
        // Chroma: rescale toward the hue family's dark-mode target —
        // but neutrals stay neutral. Hue in a near-zero-chroma colour
        // is noise, and injecting chroma turned warm greys brown.
        var cTarget = darkChromaTarget(src.H) * (role === 'text' ? 0.25 : 1);
        var C;
        if (src.C < 0.02) {
          C = Math.max(0.002, Math.min(0.012, src.C * 1.2));
        } else {
          C = Math.max(0, Math.min(0.37, ((src.C + cTarget) / 2) * chromaScale));
        }
        res = { L: L, C: C, H: src.H };
      } else {
        // Light mode is a restorative pass: pull surface/text back to
        // paper/ink, keep the hue, relax chroma for print-like calm.
        if (role === 'surface') res = { L: 0.955 + (1 - Math.abs(0.97 - src.L)) * 0, C: Math.min(src.C, 0.012), H: src.H };
        else if (role === 'text') res = { L: Math.min(src.L, 0.30), C: Math.min(src.C, 0.03), H: src.H };
        else res = { L: Math.max(0.42, Math.min(src.L, 0.62)), C: Math.min(src.C * 1.05, 0.2), H: src.H };
      }
      out[k2] = res;
    }

    // AA verification and repair. Pairs the generated UI actually
    // paints. Label inks are their own tokens (--on-primary,
    // --on-accent): fixing the INK, not the button, keeps brand
    // colour stable while the label passes AA.
    var pairs = [
      ['text', 'surface', 'body text on surface'],
      ['muted', 'surface', 'muted text on surface']
    ];
    var labelPairs = [
      ['onPrimary', 'primary', 'button label on primary'],
      ['onAccent', 'accent', 'button label on accent']
    ];
    var hexes = {};
    for (var k3 in out) hexes[k3] = oklchToHex(out[k3]);

    // Label inks start near the closest pole of the button's L.
    out.onPrimary = { L: out.primary.L >= 0.5 ? 0.16 : 0.96, C: 0.02, H: out.primary.H };
    out.onAccent = { L: out.accent.L >= 0.5 ? 0.16 : 0.96, C: 0.02, H: out.accent.H };
    hexes.onPrimary = oklchToHex(out.onPrimary);
    hexes.onAccent = oklchToHex(out.onAccent);

    var contrast = [];
    var verify = function (fgK, bgK, label) {
      var ratio = contrastRatio(hexes[fgK], hexes[bgK]);
      var adjusted = false;
      var guard = 0;
      while (ratio < minContrast && guard < 24) {
        guard++;
        var fg = out[fgK];
        var bgL = out[bgK].L;
        var dir = fg.L > bgL ? 1 : -1;
        var stepL = clamp01(fg.L + dir * 0.02);
        if (stepL === fg.L) break; // saturated against the rail
        fg.L = stepL;
        hexes[fgK] = oklchToHex(fg);
        ratio = contrastRatio(hexes[fgK], hexes[bgK]);
        adjusted = true;
      }
      contrast.push({
        pair: label,
        tokens: [fgK, bgK],
        ratio: Math.round(ratio * 100) / 100,
        target: minContrast,
        ok: ratio >= minContrast,
        adjusted: adjusted
      });
    };
    for (var p = 0; p < pairs.length; p++) verify(pairs[p][0], pairs[p][1], pairs[p][2]);
    for (var q = 0; q < labelPairs.length; q++) verify(labelPairs[q][0], labelPairs[q][1], labelPairs[q][2]);

    // Emit CSS custom properties — oklch() native where supported,
    // hex fallbacks beside them for older engines.
    var modeSel = mode === 'dark' ? 'dark' : 'light';
    var cssVars = [':root[data-theme="' + modeSel + '"] {'];
    for (var k4 in out) {
      cssVars.push('  --' + kebab(k4) + ': ' + oklchToCss(out[k4]) + ';');
      cssVars.push('  --' + kebab(k4) + '-fallback: ' + hexes[k4] + ';');
    }
    cssVars.push('  color-scheme: ' + modeSel + ';');
    cssVars.push('}');

    return {
      tokens: hexes,
      tokensOklch: (function () {
        var t = {};
        for (var kk in out) t[kk] = oklchToCss(out[kk]);
        return t;
      })(),
      cssVars: cssVars.join('\n'),
      mode: mode,
      contrast: contrast,
      warnings: warnings
    };
  };

  /* ---------------- exports ---------------- */

  ThemeEngine.generateThemeToggleScript = ThemeEngine.generateThemeToggleScript;
  ThemeEngine.buildThemeRuntimeScript = ThemeEngine.buildThemeRuntimeScript;
  ThemeEngine.HEAD_SNIPPET_BYTES = HEAD_SNIPPET.length;
  ThemeEngine.TOKEN_KEYS = TOKEN_KEYS;
  ThemeEngine.DARK_BAND = DARK_BAND;

  // colour helpers exposed for the typography/texture modules + tests
  ThemeEngine.color = {
    parseToOklch: parseToOklch,
    oklchToHex: oklchToHex,
    oklchToCss: oklchToCss,
    oklchToOklab: oklchToOklab,
    oklabToLinear: oklabToLinear,
    linearToOklab: linearToOklab,
    hexToRgb01: hexToRgb01,
    rgb01ToHex: rgb01ToHex,
    contrastRatio: contrastRatio,
    srgbToLinear: srgbToLinear,
    linearToSrgb: linearToSrgb
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = ThemeEngine;
})();
