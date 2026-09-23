// ============================================================
// PallettAI Studio — ThemeMigrator
// Onboards legacy static sites into the Design DNA framework.
//
// parseLegacyStylesheet(cssContent)
//   Brace-aware scan of a legacy stylesheet: hardcoded hex colours,
//   rgb()/rgba() colours, px values, font-family stacks, font-size
//   declarations, and the class/context a declaration lives in.
//   Comments and strings are masked first so commented-out code is
//   never migrated. Keeps per-rule provenance (selector + line) so
//   every converted value is traceable back to its source.
//
// mapLegacyToArchetype(parsedTokens)
//   Scores the legacy palette/typography/spacing against each of
//   the six Design DNA archetypes (hue saturation, radius, shadow
//   and border behaviour, font families, type scale) and maps the
//   site to the closest match. All hex/rgb colours convert to
//   OKLCH (Ottosson, hue-stable) and cluster into semantic roles
//   (primary/secondary/accent/background/surface/ink/muted).
//
// generateMigrationReport(migrationDelta)
//   Itemized JSON report: per-rule converted/manual-review lists,
//   converted token counts, a WCAG AA check on the final palette,
//   and summary stats — clients can see exactly what changed and
//   what needs eyes.
//
// CommonJS + browser global, like the rest of modules/.
// ============================================================
(function () {
  'use strict';

  const ThemeMigrator = {};

  /* ---------------- colour maths (self-contained) ---------------- */

  function hexToRgb(hex) {
    var m = /^#([0-9a-f]{3,8})$/i.exec(String(hex || '').trim());
    if (!m) return null;
    var h = m[1];
    if (h.length === 3 || h.length === 4) {
      h = h.split('').map(function (c) { return c + c; }).join('');
    }
    if (h.length !== 6 && h.length !== 8) return null;
    return {
      r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
    };
  }

  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(function (u) { return ('0' + Math.round(Math.max(0, Math.min(255, u))).toString(16)).slice(-2); }).join('');
  }

  function srgbLin(u) {
    var v = u / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }

  function relativeLuminance(rgb) {
    if (!rgb) return null;
    return 0.2126 * srgbLin(rgb.r) + 0.7152 * srgbLin(rgb.g) + 0.0722 * srgbLin(rgb.b);
  }

  function wcagRatio(fg, bg) {
    var a = relativeLuminance(hexToRgb(fg)), b = relativeLuminance(hexToRgb(bg));
    if (a == null || b == null) return null;
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }
  ThemeMigrator.wcagRatio = wcagRatio;

  function rgbToOklch(r, g, b) {
    var R = srgbLin(r), G = srgbLin(g), B = srgbLin(b);
    var l = 0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B;
    var m = 0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B;
    var s = 0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B;
    var l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
    var L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
    var A = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
    var Bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;
    return { l: L, c: Math.sqrt(A * A + Bb * Bb), h: (Math.atan2(Bb, A) * 180 / Math.PI + 360) % 360 };
  }

  function hexToOklch(hex) { var rgb = hexToRgb(hex); return rgb ? rgbToOklch(rgb.r, rgb.g, rgb.b) : null; }
  ThemeMigrator.hexToOklch = hexToOklch;

  function oklchStr(o, dp) {
    var f = Math.pow(10, dp == null ? 3 : dp);
    return 'oklch(' + Math.round(o.l * 1000) / 1000 + ' ' + Math.round(o.c * 1000) / 1000 + ' ' + Math.round(o.h * 10) / 10 + ')';
  }

  function hexToRgbStr(hex) {
    var rgb = hexToRgb(hex);
    return rgb ? rgbToHex(rgb.r, rgb.g, rgb.b) : hex;
  }

  /* ---------------- stylesheet parsing ---------------- */

  function maskCommentsAndStrings(css) {
    var out = [];
    var i = 0, n = css.length;
    var inBlock = false, inString = null;
    while (i < n) {
      var ch = css[i], next = css[i + 1];
      if (inBlock) {
        if (ch === '*' && next === '/') { inBlock = false; out.push('  '); i += 2; }
        else { out.push(ch === '\n' ? '\n' : ' '); i++; }
        continue;
      }
      if (inString) {
        if (ch === '\\') { out.push('  '); i += 2; continue; }
        if (ch === inString) { inString = null; out.push(' '); i++; continue; }
        out.push(' '); i++;
        continue;
      }
      if (ch === '/' && next === '*') { inBlock = true; out.push('  '); i += 2; continue; }
      if (ch === '"' || ch === "'") { inString = ch; out.push(' '); i++; continue; }
      out.push(ch); i++;
    }
    return { masked: out.join(''), hadComments: inBlock === false };
  }

  /* Rule context: selector, declarations, line. */
  function parseRules(css, masked) {
    var rules = [];
    var re = /([^{}]+)\{([^{}]*)\}/g;
    var m;
    while ((m = re.exec(masked))) {
      var selector = m[1].trim().replace(/\s+/g, ' ');
      if (selector === '@media' || selector.startsWith('@')) continue; // header of at-rules; body rules matched separately
      var body = m[2];
      var decls = [];
      var lineNo = masked.slice(0, m.index).split('\n').length;
      var dre = /([-a-zA-Z]+)\s*:\s*([^;]+);?/g;
      var d;
      while ((d = dre.exec(body))) {
        decls.push({ prop: d[1].toLowerCase(), value: d[2].trim(), line: lineNo });
      }
      rules.push({ selector: selector, declarations: decls, line: lineNo });
    }
    return rules;
  }

  var FONT_PROPS = ['font-family', 'font-size', 'line-height', 'font-weight', 'letter-spacing'];
  var COLOR_PROPS = ['color', 'background', 'background-color', 'border-color', 'border', 'border-top-color', 'border-bottom-color', 'border-left-color', 'border-right-color', 'outline-color', 'fill', 'stroke', 'box-shadow', 'text-shadow'];
  var RADIUS_PROPS = ['border-radius', 'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'];
  var PX_PROPS = FONT_PROPS.concat(COLOR_PROPS, RADIUS_PROPS, ['padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'gap', 'width', 'height']);

  /**
   * parseLegacyStylesheet(cssContent) ->
   *   { ok, colors, fonts, sizes, radii, spacing, rules, stats }
   */
  ThemeMigrator.parseLegacyStylesheet = function (cssContent) {
    var css = String(cssContent || '');
    if (!css.trim()) return { ok: false, error: 'empty stylesheet' };

    var maskedResult = maskCommentsAndStrings(css);
    var masked = maskedResult.masked;
    var rules = parseRules(css, masked);

    var colors = [];   // { value(hex|rgba()), context, prop, line }
    var fonts = [];    // { family, context, line }
    var sizes = [];    // { px, context, prop, line }
    var radii = [];    // { px, context, line }
    var spacing = [];  // { px, context, prop, line }

    var seen = {};
    function push(list, key, obj) {
      if (seen[key]) { seen[key].count++; return; }
      seen[key] = obj; obj.count = 1;
      list.push(obj);
      // keep 'seen' small
    }

    var HEX_RE = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;
    var RGB_RE = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/g;

    rules.forEach(function (rule) {
      rule.declarations.forEach(function (decl) {
        var ctx = rule.selector;
        var isColorProp = COLOR_PROPS.indexOf(decl.prop) !== -1;
        var isFontProp = decl.prop === 'font-family';
        var isSizeProp = decl.prop === 'font-size';
        var isRadiusProp = RADIUS_PROPS.indexOf(decl.prop) !== -1;
        var isSpacingProp = /^(padding|margin|gap)/.test(decl.prop);

        if (isColorProp || !decl.prop.match(/^(font|padding|margin|gap|width|height|border-radius|line-height|letter-spacing)/)) {
          // scan any declaration for colours (colours hide in gradients, shadows…)
          var m2;
          HEX_RE.lastIndex = 0;
          while ((m2 = HEX_RE.exec(decl.value))) {
            var hex = m2[0];
            var full = hexToRgb(hex);
            if (!full) continue;
            push(colors, 'c:' + hex.toLowerCase(), { value: hex.toLowerCase(), context: ctx, prop: decl.prop, line: decl.line });
          }
          RGB_RE.lastIndex = 0;
          while ((m2 = RGB_RE.exec(decl.value))) {
            var hexEquiv = rgbToHex(+m2[1], +m2[2], +m2[3]);
            push(colors, 'c:' + hexEquiv.toLowerCase(), { value: hexEquiv.toLowerCase(), rgba: true, alpha: m2[4] != null ? +m2[4] : 1, context: ctx, prop: decl.prop, line: decl.line });
          }
        }

        if (isFontProp) {
          var fam = decl.value.split(',')[0].replace(/["']/g, '').trim();
          if (fam && fam !== 'inherit' && fam !== 'initial') {
            push(fonts, 'f:' + fam.toLowerCase(), { family: fam, context: ctx, line: decl.line });
          }
        }
        if (isSizeProp) {
          var sm = /^\s*([\d.]+)px\s*$/.exec(decl.value);
          if (sm) push(sizes, 's:' + sm[1], { px: parseFloat(sm[1]), context: ctx, prop: decl.prop, line: decl.line });
        }
        if (isRadiusProp) {
          var rm = /^\s*([\d.]+)px/.exec(decl.value);
          if (rm) push(radii, 'r:' + rm[1], { px: parseFloat(rm[1]), context: ctx, line: decl.line });
        }
        if (isSpacingProp) {
          var pm = /([\d.]+)px/g;
          var pmm;
          while ((pmm = pm.exec(decl.value))) {
            push(spacing, 'sp:' + pmm[1], { px: parseFloat(pmm[1]), context: ctx, prop: decl.prop, line: decl.line });
          }
        }
      });
    });

    var pxCount = 0;
    rules.forEach(function (r) {
      r.declarations.forEach(function (d) {
        if (/^\s*-?[\d.]+px/.test(d.value)) pxCount++;
      });
    });

    return {
      ok: true,
      colors: colors,
      fonts: fonts,
      sizes: sizes,
      radii: radii,
      spacing: spacing,
      rules: rules.map(function (r) { return { selector: r.selector, declarations: r.declarations.length, line: r.line }; }),
      stats: {
        rules: rules.length,
        declarations: rules.reduce(function (s, r) { return s + r.declarations.length; }, 0),
        uniqueColors: colors.length,
        uniqueFonts: fonts.length,
        pxDeclarations: pxCount
      }
    };
  };

  /* ---------------- archetype mapping ---------------- */

  var ARCHETYPES = ['bento-glass', 'brutalist-kinetic', 'editorial-magazine', 'retro-cyberpunk', 'organic-clay', 'neo-minimalist'];
  ThemeMigrator.ARCHETYPES = ARCHETYPES;

  var HUE_FAMILIES = {
    'bento-glass':        { lo: 210, hi: 300 },  // cool blues/violets
    'brutalist-kinetic':  { lo: 0,   hi: 70 },   // hot oranges/yellows, near-neutrals
    'editorial-magazine': { lo: 20,  hi: 200 },  // warm neutrals, deep reds, muted
    'retro-cyberpunk':    { lo: 160, hi: 330 },  // cyan→magenta
    'organic-clay':       { lo: 10,  hi: 140 },  // earth tones, warm greens
    'neo-minimalist':     { lo: 200, hi: 260 }   // restrained cool accent
  };

  var FAM_BY_KEY = {
    'bento-glass':        ['inter', 'system-ui', 'sf pro', 'segoe ui', 'roboto', 'helvetica'],
    'brutalist-kinetic':  ['archivo', 'mono', 'impact', 'arial black', 'courier', 'space grotesk'],
    'editorial-magazine': ['georgia', 'playfair', 'times', 'garamond', 'serif', 'didot', 'bodoni', 'merriweather'],
    'retro-cyberpunk':    ['mono', 'courier', 'share tech', 'vt323', 'orbitron', 'jetbrains'],
    'organic-clay':       ['nunito', 'quicksand', 'comfortaa', 'avenir', 'rounded', 'poppins', 'baloo'],
    'neo-minimalist':     ['helvetica', 'neue haas', 'inter', 'system-ui', 'univers', 'akzidenz']
  };

  function hueInFamily(h, fam) {
    if (fam.lo <= fam.hi) return h >= fam.lo && h <= fam.hi;
    return h >= fam.lo || h <= fam.hi; // wraps
  }

  function scoreArchetype(parsed, arch) {
    var score = 0;
    var evidence = [];

    // 1. Colour character.
    var chromaTotal = 0, chromaCount = 0, inFamily = 0, darkBg = false, lightBg = false;
    var maxL = 0, minL = 1;
    parsed.colors.forEach(function (c) {
      var o = hexToOklch(c.value);
      if (!o) return;
      chromaTotal += o.c; chromaCount++;
      maxL = Math.max(maxL, o.l); minL = Math.min(minL, o.l);
      if (o.c > 0.05 && hueInFamily(o.h, HUE_FAMILIES[arch])) { inFamily++; score += 1; evidence.push(c.value + ' in ' + arch + ' hue family'); }
      if (o.l < 0.25) darkBg = darkBg || (c.prop === 'background' || c.prop === 'background-color' || c.prop === 'color');
      if (o.l > 0.9) lightBg = true;
    });
    var avgC = chromaCount ? chromaTotal / chromaCount : 0;

    // High-chroma neon palette.
    if (avgC > 0.18) {
      score += arch === 'retro-cyberpunk' || arch === 'brutalist-kinetic' ? 3 : 0;
      evidence.push('high average chroma ' + avgC.toFixed(2));
    }
    // Dark backgrounds.
    if (darkBg) {
      score += arch === 'retro-cyberpunk' ? 3 : 0;
      evidence.push('dark background present');
    }
    // Low-chroma minimal palettes.
    if (avgC < 0.05) {
      score += arch === 'neo-minimalist' || arch === 'editorial-magazine' ? 2 : 0;
      evidence.push('low chroma palette');
    }

    // 2. Radius character.
    var radiusScore = 0;
    parsed.radii.forEach(function (r) { radiusScore += r.px; });
    var avgRadius = parsed.radii.length ? radiusScore / parsed.radii.length : -1;
    if (avgRadius >= 0) {
      if (avgRadius <= 2) { score += arch === 'brutalist-kinetic' || arch === 'editorial-magazine' ? 3 : 0; evidence.push('sharp radii ~' + avgRadius.toFixed(0) + 'px'); }
      else if (avgRadius <= 10) { score += arch === 'neo-minimalist' || arch === 'editorial-magazine' ? 2 : 0; evidence.push('moderate radii'); }
      else if (avgRadius <= 20) { score += arch === 'bento-glass' ? 3 : 0; evidence.push('soft radii ~' + avgRadius.toFixed(0) + 'px'); }
      else { score += arch === 'organic-clay' || arch === 'bento-glass' ? 3 : 0; evidence.push('large radii ~' + avgRadius.toFixed(0) + 'px'); }
    }

    // 3. Shadow density (glass/clay signatures).
    var hasShadows = parsed.colors.some(function (c) { return /shadow/.test(c.prop || ''); });
    if (hasShadows && (arch === 'bento-glass' || arch === 'organic-clay')) { score += 1; evidence.push('shadow usage'); }

    // 4. Typography families.
    parsed.fonts.forEach(function (f) {
      var lf = f.family.toLowerCase();
      FAM_BY_KEY[arch].forEach(function (needle) {
        if (lf.indexOf(needle) !== -1) {
          score += 2;
          evidence.push('font ' + f.family + ' matches ' + arch);
        }
      });
    });

    // 5. Type scale: serif headings → editorial.
    if (arch === 'editorial-magazine') {
      var hasSerif = parsed.fonts.some(function (f) {
        var lf = f.family.toLowerCase();
        return /georgia|times|serif|garamond|playfair|didot/.test(lf);
      });
      if (hasSerif) { score += 2; evidence.push('serif families present'); }
    }

    // 6. Hue-family coverage bonus (distinct in-family colours).
    score += Math.min(2, inFamily);

    return { archetype: arch, score: score, evidence: evidence.slice(0, 8) };
  }

  /**
   * mapLegacyToArchetype(parsedTokens) ->
   *   { ok, archetype, confidence, palette(oklch roles), conversions,
   *     scores, warnings }
   */
  ThemeMigrator.mapLegacyToArchetype = function (parsedTokens) {
    if (!parsedTokens || !parsedTokens.ok) {
      return { ok: false, error: 'pass a parseLegacyStylesheet() result' };
    }
    var parsed = parsedTokens;

    var scores = ARCHETYPES.map(function (a) { return scoreArchetype(parsed, a); })
      .sort(function (a, b) { return b.score - a.score; });
    var winner = scores[0], runnerUp = scores[1] || { score: 0 };
    var maxS = Math.max(1, winner.score);
    var confidence = Math.min(0.99, 0.4 + 0.5 * (winner.score - runnerUp.score) / maxS);

    // Palette role assignment in OKLCH.
    var colours = parsed.colors.map(function (c) {
      return { hex: c.value, oklch: hexToOklch(c.value), count: c.count, context: c.context, prop: c.prop };
    }).filter(function (c) { return c.oklch; });

    var sorted = colours.slice().sort(function (a, b) { return b.count - a.count; });
    var neutrals = sorted.filter(function (c) { return c.oklch.c < 0.06; });
    var chromatic = sorted.filter(function (c) { return c.oklch.c >= 0.06; });

    function pick(pred) {
      var list = sorted.filter(pred);
      return list.length ? list[0] : null;
    }
    // Provenance first: a colour explicitly set on body/html background IS
    // the site canvas — frequency alone would let a white card background
    // steal the role.
    var isBodyBg = function (c) { return /background/.test(c.prop || '') && /^(body|html)\b/.test(c.context || ''); };
    var primary = pick(function (c) { return c.oklch.c >= 0.06 && c.oklch.l >= 0.3 && c.oklch.l <= 0.75; }) ||
                  chromatic[0] || null;
    var background = pick(function (c) { return c.oklch.c < 0.06 && c.oklch.l > 0.9 && isBodyBg(c); }) ||
                     pick(function (c) { return c.oklch.c < 0.06 && c.oklch.l > 0.9; }) ||
                     neutrals.filter(function (c) { return c.oklch.l > 0.5; })[0] ||
                     (colours.length ? sorted.slice().sort(function (a, b) { return b.oklch.l - a.oklch.l; })[0] : null);
    var ink = pick(function (c) { return c.oklch.c < 0.06 && c.oklch.l < 0.3; }) ||
              neutrals.filter(function (c) { return c.oklch.l <= 0.5; })[0] ||
              (colours.length ? sorted.slice().sort(function (a, b) { return a.oklch.l - b.oklch.l; })[0] : null);
    var surface = pick(function (c) { return c.oklch.c < 0.06 && c.oklch.l > 0.85 && c !== background; }) ||
                  neutrals.filter(function (c) { return c.oklch.l > 0.5 && c !== background; })[0] || null;
    var secondary = chromatic.filter(function (c) { return c !== primary; })[0] || null;
    var accent = chromatic.filter(function (c) { return c !== primary && c !== secondary; })[0] || null;

    var palette = {};
    if (primary) palette.primary = { hex: primary.hex, oklch: oklchStr(primary.oklch), h: primary.oklch.h, c: primary.oklch.c, l: primary.oklch.l };
    if (secondary) palette.secondary = { hex: secondary.hex, oklch: oklchStr(secondary.oklch), h: secondary.oklch.h, c: secondary.oklch.c, l: secondary.oklch.l };
    if (accent) palette.accent = { hex: hexToRgbStr(accent.hex), oklch: oklchStr(accent.oklch), h: accent.oklch.h, c: accent.oklch.c, l: accent.oklch.l };
    if (background) palette.background = { hex: hexToRgbStr(background.hex), oklch: oklchStr(background.oklch), h: background.oklch.h, c: background.oklch.l > 0.9 ? background.oklch.c : background.oklch.c * 0.5, l: background.oklch.l };
    if (surface) palette.surface = { hex: hexToRgbStr(surface.hex), oklch: oklchStr(surface.oklch), h: surface.oklch.h, c: surface.oklch.c, l: surface.oklch.l };
    if (ink) palette.ink = { hex: hexToRgbStr(ink.hex), oklch: hexToRgbStr(ink.hex) === ink.hex ? oklchStr(ink.oklch) : oklchStr(ink.oklch), h: ink.oklch.h, c: ink.oklch.c, l: ink.oklch.l };
    if (primary) {
      var mutedL = Math.min(0.6, Math.max(0.4, ink ? ink.oklch.l + 0.25 : 0.5));
      var mutedOklch = { l: mutedL, c: Math.min(0.03, primary.oklch.c * 0.3), h: primary.oklch.h };
      palette.muted = {
        hex: oklchToHexStr(mutedOklch),
        oklch: oklchStr(mutedOklch),
        h: mutedOklch.h, c: mutedOklch.c, l: mutedOklch.l,
        derived: true
      };
    }

    var conversions = colours.map(function (c) {
      return { from: c.hex, to: oklchStr(c.oklch), count: c.count, prop: c.prop, context: c.context };
    });

    return {
      ok: true,
      archetype: winner.archetype,
      confidence: Math.round(confidence * 100) / 100,
      scores: scores.map(function (s) { return { archetype: s.archetype, score: s.score, evidence: s.evidence }; }),
      palette: palette,
      conversions: conversions,
      warnings: colours.filter(function (c) { return c.oklch.c > 0.33; }).map(function (c) {
        return c.hex + ' is likely out of sRGB gamut; consumers should gamut-map';
      })
    };
  };

  /* oklch → hex (chroma-reduction gamut mapping) for derived neutrals. */
  function oklchToHexStr(o) {
    var c = o.c;
    function lin(c2) {
      var hRad = o.h * Math.PI / 180;
      var aa = c2 * Math.cos(hRad), bb = c2 * Math.sin(hRad);
      var l_ = o.l + 0.3963377774 * aa + 0.2158037573 * bb;
      var m_ = o.l - 0.1055613458 * aa - 0.0638541728 * bb;
      var s_ = o.l - 0.0894841775 * aa - 1.2914855480 * bb;
      var L = l_ * l_ * l_, M = m_ * m_ * m_, S = s_ * s_ * s_;
      return [
        +4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
        -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
        -0.0041960863 * L - 0.7034186147 * M + 1.7076147010 * S
      ];
    }
    var rgbLin = lin(c);
    var guard = 0;
    while (rgbLin.some(function (u) { return u < -1e-4 || u > 1 + 1e-4; }) && c > 0.0005 && guard++ < 64) {
      c *= 0.97; rgbLin = lin(c);
    }
    function enc(u) {
      var vv = u <= 0.0031308 ? 12.92 * u : 1.055 * Math.pow(Math.max(0, Math.min(1, u)), 1 / 2.4) - 0.055;
      return Math.round(Math.max(0, Math.min(1, vv)) * 255);
    }
    return '#' + rgbLin.map(function (u) { return ('0' + enc(u).toString(16)).slice(-2); }).join('');
  }

  /* ---------------- migration report ---------------- */

  /**
   * generateMigrationReport(migrationDelta)
   * migrationDelta: { parse, mapping, converted: [ {rule, from, to} ],
   *                   manual: [ {rule, reason} ] }
   * Also accepts the output of runMigration() shape:
   *   { parse, mapping, converted, manual }
   */
  ThemeMigrator.generateMigrationReport = function (migrationDelta) {
    var delta = migrationDelta || {};
    var parse = delta.parse, mapping = delta.mapping;
    if (!parse || !parse.ok || !mapping || !mapping.ok) {
      return { ok: false, error: 'migrationDelta needs { parse, mapping } from parseLegacyStylesheet + mapLegacyToArchetype' };
    }
    var converted = Array.isArray(delta.converted) ? delta.converted : [];
    var manual = Array.isArray(delta.manual) ? delta.manual : [];

    // WCAG AA re-check on the final palette.
    var contrast = [];
    var p = mapping.palette || {};
    if (p.ink && p.background) {
      var r1 = wcagRatio(p.ink.hex, p.background.hex);
      contrast.push({ pair: 'ink/background', ratio: r1 == null ? null : Math.round(r1 * 100) / 100, min: 4.5, pass: r1 != null && r1 >= 4.5 });
    }
    if (p.primary && p.background) {
      var r2 = wcagRatio(p.primary.hex, p.background.hex);
      contrast.push({ pair: 'primary/background', ratio: r2 == null ? null : Math.round(r2 * 100) / 100, min: 3, pass: r2 != null && r2 >= 3 });
    }
    if (p.primary && p.surface) {
      var r3 = wcagRatio(p.primary.hex, p.surface.hex);
      contrast.push({ pair: 'primary/surface', ratio: r3 == null ? null : Math.round(r3 * 100) / 100, min: 3, pass: r3 != null && r3 >= 3 });
    }

    var report = {
      ok: true,
      generatedAt: new Date().toISOString(),
      archetype: mapping.archetype,
      confidence: mapping.confidence,
      summary: {
        rulesScanned: parse.stats.rules,
        declarationsScanned: parse.stats.declarations,
        colorsFound: parse.stats.uniqueColors,
        colorsConverted: (mapping.conversions || []).length,
        tokensEmitted: Object.keys(p).length,
        converted: converted.length,
        manualReview: manual.length
      },
      palette: p,
      contrastChecks: contrast,
      converted: converted,
      manualReview: manual,
      archetypeScores: mapping.scores,
      warnings: (mapping.warnings || []).concat(
        contrast.filter(function (c) { return c.pass === false; }).map(function (c) {
          return c.pair + ' contrast ' + c.ratio + ':1 fails WCAG (' + c.min + ':1 required) — assign to manual review';
        })
      )
    };

    // Failed contrast pairs are automatically escalated to manual review.
    contrast.forEach(function (c) {
      if (c.pass === false) {
        report.manualReview.push({
          rule: 'palette.' + c.pair.replace('/', '.'),
          reason: 'contrast ' + c.ratio + ':1 < ' + c.min + ':1 WCAG requirement'
        });
        report.summary.manualReview = report.manualReview.length;
      }
    });

    return report;
  };

  /* CommonJS + browser global */
  if (typeof module !== 'undefined' && module.exports !== undefined) module.exports = ThemeMigrator;
  if (typeof window !== 'undefined') window.ThemeMigrator = ThemeMigrator;
})();
