// ============================================================
// PallettAI Studio — TokenExporter
// Design-token serialization for external developer workflows.
//
// The Studio's canonical tokenMap shape (all roles optional,
// unknown keys are preserved under their own namespaces):
//
//   {
//     colors: {
//       primary, primaryHover, secondary, accent, background,
//       surface, surfaceAlt, text, muted, border,
//       onPrimary, danger, warning, success, info
//     },
//     fonts: { sans, serif, mono, display },
//     typography: {
//       display, h1, h2, h3, h4, h5, h6, body, small   — each
//       { size: 'clamp(...)' | px number, lineHeight, tracking }
//     },
//     spacing: { 1..15 } — px numbers (mapped to rem),
//     radii:   { sm, md, lg, pill, full },
//     shadows: { sm, md, lg },
//     meta:    { name, archetype, description }
//   }
//
// Three serializers, one truth:
//   exportToTailwindV4   → @theme block for Tailwind CSS v4
//   exportToStyleDictionary → W3C DTCG JSON (design-tokens.org)
//   exportToCSSVariables → minified :root custom properties
//
// CommonJS + browser global, like the rest of modules/.
// ============================================================
(function () {
  'use strict';

  const TokenExporter = {};

  /* ---------------- normalization ---------------- */

  var COLOR_ALIASES = {
    primary: ['primary', 'brand'],
    primaryHover: ['primaryHover', 'primary-hover', 'primary_hover'],
    secondary: ['secondary'],
    accent: ['accent'],
    background: ['background', 'bg', 'canvas'],
    surface: ['surface', 'card'],
    surfaceAlt: ['surfaceAlt', 'surface-alt', 'surface_alt'],
    text: ['text', 'ink', 'foreground', 'fg'],
    muted: ['muted', 'mutedText', 'muted-text'],
    border: ['border', 'line'],
    onPrimary: ['onPrimary', 'on-primary', 'on_primary', 'onBrand'],
    danger: ['danger', 'error', 'dangerColor'],
    warning: ['warning', 'warningColor'],
    success: ['success', 'successColor'],
    info: ['info', 'infoColor']
  };

  function normalizeTokenMap(tokenMap) {
    var t = tokenMap || {};
    var norm = { colors: {}, fonts: {}, typography: {}, spacing: {}, radii: {}, shadows: {}, meta: t.meta || {} };

    // Colors: accept a flat map too ('bg', 'brand', 'ink'...).
    var rawColors = t.colors || {};
    Object.keys(COLOR_ALIASES).forEach(function (role) {
      var aliases = COLOR_ALIASES[role];
      for (var i = 0; i < aliases.length; i++) {
        var v = rawColors[aliases[i]];
        if (v != null) { norm.colors[role] = v; break; }
      }
    });
    // Keep unknown colour keys under an extensions namespace.
    Object.keys(rawColors).forEach(function (k) {
      var known = Object.keys(COLOR_ALIASES).some(function (role) { return COLOR_ALIASES[role].indexOf(k) !== -1; });
      if (!known) norm.colors[k] = rawColors[k];
    });

    var rawFonts = t.fonts || {};
    ['sans', 'serif', 'mono', 'display'].forEach(function (f) {
      if (rawFonts[f] != null) norm.fonts[f] = rawFonts[f];
    });

    var rawType = t.typography || {};
    var TYPE_KEYS = ['display', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'body', 'small'];
    TYPE_KEYS.forEach(function (k) {
      var v = rawType[k];
      if (v == null) return;
      if (typeof v === 'object') {
        norm.typography[k] = { size: v.size, lineHeight: v.lineHeight, tracking: v.tracking != null ? v.tracking : v.letterSpacing };
      } else {
        norm.typography[k] = { size: v };
      }
    });

    var rawSpacing = t.spacing || {};
    Object.keys(rawSpacing).forEach(function (k) {
      var n = Number(rawSpacing[k]);
      if (isFinite(n)) norm.spacing[k] = n;
    });
    if (!Object.keys(norm.spacing).length) {
      [1, 2, 3, 4, 6, 8, 10, 12, 16].forEach(function (n, i) { norm.spacing[i + 1] = n * 4; });
    }

    ['radii', 'shadows'].forEach(function (grp) {
      var raw = t[grp] || {};
      Object.keys(raw).forEach(function (k) { norm[grp][k] = raw[k]; });
    });

    return norm;
  }
  TokenExporter.normalizeTokenMap = normalizeTokenMap;

  function isColorLike(v) {
    if (typeof v !== 'string') return false;
    return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v.trim()) ||
      /^(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color)\(/.test(v.trim());
  }

  function cssEscapeName(s) {
    return String(s).trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'x';
  }

  /**
   * A custom-property VALUE may never terminate its declaration (`;`),
   * close the block (`}`), open a comment (`/*`), or carry a backslash
   * escape (`\7d` encodes a `}`). Legitimate token values — colours,
   * clamp(), shadows, font stacks — never need any of those, so an
   * unsafe value is dropped with a warning rather than emitted, which
   * would otherwise let a token value inject arbitrary CSS rules.
   */
  var UNSAFE_VALUE_RE = /[;{}]|\\|\/\*|[\u0000-\u001f\u007f]/;

  function safeCssValue(v) {
    var s = (typeof v === 'number' && isFinite(v)) ? String(v) : String(v == null ? '' : v).trim();
    if (!s) return null;
    if (UNSAFE_VALUE_RE.test(s)) return null;
    return s;
  }
  TokenExporter.safeCssValue = safeCssValue;

  function pxToRem(px) {
    var n = Number(px);
    if (!isFinite(n)) return String(px);
    return (Math.round((n / 16) * 10000) / 10000) + 'rem';
  }

  function numToPx(v) {
    if (typeof v === 'number' && isFinite(v)) return v + 'px';
    return String(v);
  }

  /* ============================================================
     1 — Tailwind CSS v4 @theme
     ============================================================ */

  /**
   * exportToTailwindV4(tokenMap)
   * @param {object} tokenMap  canonical Studio token map
   * @returns {{ ok, css, vars: string[], bytes, warnings: string[] }} |
   *           { ok: false, error }
   *
   * Tailwind v4 reads design tokens from a single `@theme` block in
   * CSS. `--color-*` generates the colour utilities (bg-brand,
   * text-ink, ...), `--font-*` the font-family utilities,
   * `--text-*` the font-size tokens, `--spacing` the spacing scale
   * multiplier, `--radius-*` rounded-* utilities.
   */
  TokenExporter.exportToTailwindV4 = function (tokenMap) {
    var t = normalizeTokenMap(tokenMap);
    var warnings = [];
    var lines = ['@theme {'];
    var vars = [];

    var colorKeys = Object.keys(t.colors);
    if (!colorKeys.length) warnings.push('no colors in tokenMap — the @theme block will not generate colour utilities');
    colorKeys.forEach(function (role) {
      var name = cssEscapeName(role);
      var val = safeCssValue(t.colors[role]);
      if (val == null) { warnings.push('colour "' + role + '" dropped - value contains CSS-structural characters'); return; }
      lines.push('  --color-' + name + ': ' + val + ';');
      vars.push('--color-' + name);
    });

    Object.keys(t.fonts).forEach(function (f) {
      var fv = safeCssValue(t.fonts[f]);
      if (fv == null) { warnings.push('font "' + f + '" dropped - value contains CSS-structural characters'); return; }
      lines.push('  --font-' + cssEscapeName(f) + ': ' + fv + ';');
      vars.push('--font-' + cssEscapeName(f));
    });

    Object.keys(t.typography).forEach(function (k) {
      var role = cssEscapeName(k);
      var spec = t.typography[k];
      var size = safeCssValue(spec.size);
      if (size == null) { warnings.push('typography "' + k + '" dropped - unsafe size value'); return; }
      lines.push('  --text-' + role + ': ' + size + ';');
      vars.push('--text-' + role);
      if (spec.lineHeight != null) {
        var lh = safeCssValue(spec.lineHeight);
        if (lh == null) { warnings.push('typography "' + k + '" line-height dropped - unsafe value'); }
        else {
          lines.push('  --text-' + role + '--line-height: ' + lh + ';');
          vars.push('--text-' + role + '--line-height');
        }
      }
      if (spec.tracking != null) {
        var trk = safeCssValue(spec.tracking);
        if (trk == null) { warnings.push('typography "' + k + '" tracking dropped - unsafe value'); }
        else {
          lines.push('  --text-' + role + '--letter-spacing: ' + trk + ';');
          vars.push('--text-' + role + '--letter-spacing');
        }
      }
    });

    var spacingKeys = Object.keys(t.spacing);
    if (spacingKeys.length) {
      // Tailwind v4's dynamic spacing scale is driven by one variable.
      var base = t.spacing[4] != null ? t.spacing[4] : t.spacing[spacingKeys[Math.floor(spacingKeys.length / 2)]];
      var baseVal = safeCssValue(pxToRem(base));
      if (baseVal == null) { warnings.push('spacing base dropped - unsafe value'); }
      else { lines.push('  --spacing: ' + baseVal + ';'); vars.push('--spacing'); }
    }

    Object.keys(t.radii).forEach(function (r) {
      var rv = safeCssValue(numToPx(t.radii[r]));
      if (rv == null) { warnings.push('radius "' + r + '" dropped - unsafe value'); return; }
      lines.push('  --radius-' + cssEscapeName(r) + ': ' + rv + ';');
      vars.push('--radius-' + cssEscapeName(r));
    });

    Object.keys(t.shadows).forEach(function (s) {
      var sv = safeCssValue(t.shadows[s]);
      if (sv == null) { warnings.push('shadow "' + s + '" dropped - unsafe value'); return; }
      lines.push('  --shadow-' + cssEscapeName(s) + ': ' + sv + ';');
      vars.push('--shadow-' + cssEscapeName(s));
    });

    lines.push('}');

    var css = lines.join('\n');
    return { ok: true, css: css, vars: vars, bytes: css.length, warnings: warnings };
  };

  /* ============================================================
     2 — W3C DTCG JSON
     ============================================================ */

  function dtcgValue(v, kind) {
    if (typeof v === 'number' && isFinite(v)) {
      // Numbers are only dimensions when the token family says so;
      // a unitless 1.1 line-height must never become "1.1px".
      if (kind === 'spacing' || kind === 'radius') return { $type: 'dimension', $value: v + 'px' };
      return { $type: 'number', $value: v };
    }
    if (isColorLike(v)) return { $type: 'color', $value: String(v).trim() };
    if (typeof v === 'string' && /^[+-]?[0-9.]+(px|rem|em|%)$/.test(v.trim())) {
      return { $type: 'dimension', $value: v.trim() };
    }
    // Fonts, shadows, clamps: opaque strings → no $type claim.
    return { $value: String(v) };
  }

  function dtcgGroup(obj, extra) {
    var g = {};
    if (extra) Object.keys(extra).forEach(function (k) { g[k] = extra[k]; });
    Object.keys(obj).forEach(function (k) {
      var v = obj[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        g[cssEscapeName(k)] = dtcgGroup(v, v.$description ? { $description: v.$description } : null);
      } else {
        g[cssEscapeName(k)] = dtcgValue(v);
      }
    });
    return g;
  }

  /**
   * exportToStyleDictionary(tokenMap)
   * @param {object} tokenMap  canonical Studio token map
   * @returns {{ ok, json: object, string: string, tokenCount, warnings: string[] }} |
   *           { ok: false, error }
   *
   * W3C Design Tokens Community Group format:
   *   { "…": { "$type": "color", "$value": "#…" }, groups nest objects }
   * Colour/dimension tokens carry $type; strings that could be
   * either (fonts, shadows, clamps) carry only $value — the spec
   * makes $type optional and honest omission beats lying.
   */
  TokenExporter.exportToStyleDictionary = function (tokenMap) {
    var t = normalizeTokenMap(tokenMap);
    var warnings = [];
    var json = {};
    var count = 0;

    function countTokens(group) {
      Object.keys(group).forEach(function (k) {
        var v = group[k];
        if (v && v.$value !== undefined) count++;
        else if (v && typeof v === 'object') countTokens(v);
      });
    }

    if (Object.keys(t.colors).length) {
      json.color = dtcgGroup(t.colors, { $description: 'Brand & semantic colours' });
    } else {
      warnings.push('no colors in tokenMap');
    }
    if (Object.keys(t.fonts).length) json.font = dtcgGroup(t.fonts, { $description: 'Font families' });
    if (Object.keys(t.typography).length) {
      var typeGroup = {};
      Object.keys(t.typography).forEach(function (k) {
        var spec = t.typography[k];
        var g = {};
        if (spec.size != null) g.fontSize = dtcgValue(spec.size);
        if (spec.lineHeight != null) g.lineHeight = dtcgValue(spec.lineHeight);
        if (spec.tracking != null) g.letterSpacing = dtcgValue(spec.tracking);
        if (Object.keys(g).length) typeGroup[cssEscapeName(k)] = g;
      });
      json.typography = typeGroup;
    }
    if (Object.keys(t.spacing).length) {
      var sp = {};
      Object.keys(t.spacing).forEach(function (k) {
        sp['spacing-' + k] = dtcgValue(t.spacing[k], 'spacing');
      });
      json.spacing = sp;
    }
    if (Object.keys(t.radii).length) {
      var rad = {};
      Object.keys(t.radii).forEach(function (k) {
        rad[cssEscapeName(k)] = dtcgValue(t.radii[k], 'radius');
      });
      json.radius = rad;
    }
    if (Object.keys(t.shadows).length) json.shadow = dtcgGroup(t.shadows);

    if (t.meta && (t.meta.name || t.meta.archetype || t.meta.description)) {
      json.$description = [t.meta.name, t.meta.archetype, t.meta.description].filter(Boolean).join(' — ');
    }

    countTokens(json);
    var str = JSON.stringify(json, null, 2);
    return { ok: true, json: json, string: str, tokenCount: count, bytes: str.length, warnings: warnings };
  };

  /* ============================================================
     3 — minified CSS variables
     ============================================================ */

  /**
   * exportToCSSVariables(tokenMap, prefix)
   * @param {object} tokenMap  canonical Studio token map
   * @param {string} [prefix]  default 'pai'
   * @returns {{ ok, css, vars: string[], bytes, warnings: string[] }} |
   *           { ok: false, error }
   *
   * Emits a minified `:root{--pai-…}` declaration block. Values
   * pass through verbatim (hex, oklch(), clamp() all legal).
   */
  TokenExporter.exportToCSSVariables = function (tokenMap, prefix) {
    var t = normalizeTokenMap(tokenMap);
    var p = cssEscapeName(prefix || 'pai') || 'pai';
    var warnings = [];
    var decls = [];
    var vars = [];

    var colorKeys = Object.keys(t.colors);
    if (!colorKeys.length) warnings.push('no colors in tokenMap');
    function pushDecl(prop, rawValue, warnLabel) {
      var val = safeCssValue(rawValue);
      if (val == null) { warnings.push(warnLabel + ' dropped - value contains CSS-structural characters'); return; }
      decls.push(prop + ':' + val);
      vars.push(prop);
    }
    colorKeys.forEach(function (role) {
      pushDecl('--' + p + '-' + cssEscapeName(role), t.colors[role], 'colour "' + role + '"');
    });
    Object.keys(t.fonts).forEach(function (f) {
      pushDecl('--' + p + '-font-' + cssEscapeName(f), t.fonts[f], 'font "' + f + '"');
    });
    Object.keys(t.typography).forEach(function (k) {
      var role = cssEscapeName(k);
      var spec = t.typography[k];
      pushDecl('--' + p + '-text-' + role, spec.size, 'typography "' + k + '"');
      if (spec.lineHeight != null) pushDecl('--' + p + '-text-' + role + '-lh', spec.lineHeight, 'typography "' + k + '" line-height');
      if (spec.tracking != null) pushDecl('--' + p + '-text-' + role + '-ls', spec.tracking, 'typography "' + k + '" tracking');
    });
    Object.keys(t.spacing).forEach(function (k) {
      pushDecl('--' + p + '-space-' + k, pxToRem(t.spacing[k]), 'spacing ' + k);
    });
    Object.keys(t.radii).forEach(function (r) {
      pushDecl('--' + p + '-radius-' + cssEscapeName(r), numToPx(t.radii[r]), 'radius "' + r + '"');
    });
    Object.keys(t.shadows).forEach(function (s) {
      pushDecl('--' + p + '-shadow-' + cssEscapeName(s), t.shadows[s], 'shadow "' + s + '"');
    });

    var css = ':root{' + decls.join(';') + (decls.length ? ';' : '') + '}';
    return { ok: true, css: css, vars: vars, bytes: css.length, warnings: warnings };
  };

  /* ============================================================
     round-trip helper
     ============================================================ */

  /**
   * exportAll(tokenMap, prefix) — all three formats at once.
   */
  TokenExporter.exportAll = function (tokenMap, prefix) {
    var tw = TokenExporter.exportToTailwindV4(tokenMap);
    var sd = TokenExporter.exportToStyleDictionary(tokenMap);
    var cv = TokenExporter.exportToCSSVariables(tokenMap, prefix);
    if (!tw.ok) return tw;
    if (!sd.ok) return sd;
    if (!cv.ok) return cv;
    return {
      ok: true,
      tailwind: tw.css,
      styleDictionary: sd.string,
      cssVariables: cv.css,
      counts: { tailwindVars: tw.vars.length, dtcgTokens: sd.tokenCount, cssVars: cv.vars.length }
    };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = TokenExporter;
})();
