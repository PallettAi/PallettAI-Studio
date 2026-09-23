// ============================================================
// PallettAI Studio — TokenCompiler
// Atomic design-token compilation pipeline.
//
// compileDesignTokens(tokenManifestPath)
//   Reads a JSON manifest that stitches together multi-file token
//   groups (colors, typography, spacing, shadows, radii) and
//   resolves inheritance:
//
//     {
//       "name": "acme",
//       "extends": "base.manifest.json",      // parent chain, deep-merged
//       "colors":    "colors.json",           // string path OR inline object
//       "typography": { ... },
//       "scopes":    { "dark": "colors-dark.json" },
//       "archetypes": { "bento-glass": { ... } },
//       "pairs": [ { "fg": "color-text", "bg": "color-background", "min": 4.5 } ]
//     }
//
//   Groups flatten to custom-property names with the conventional
//   aliases colors→color, typography→type, shadows→shadow,
//   radii→radius (other groups keep their name).
//
//   Validation catches invalid hex/oklch values (including OKLCH
//   boundaries: L outside [0,1], C < 0 or likely-out-of-gamut),
//   missing contrast pairs, and archetype tokens that reference
//   token names that do not exist. Issues are severity-graded —
//   invalid values are errors; contrast and gamut risks are
//   warnings unless opts.strict.
//
// generateOptimizedCSSVariables(compiledTokens)
//   Emits a minified custom-property stylesheet: one :root block
//   plus diffed [data-theme]/[data-archetype] scope blocks (only
//   properties that differ from root). Invalid tokens are dropped
//   from output and reported in `dropped`.
//
// CommonJS + browser global, like the rest of modules/.
// ============================================================
(function () {
  'use strict';

  const TokenCompiler = {};

  var fs = null;
  var path = null;
  if (typeof require === 'function') {
    try { fs = require('fs'); } catch (e) { fs = null; }
    try { path = require('path'); } catch (e) { path = null; }
  }

  var GROUP_ALIASES = {
    colors: 'color',
    typography: 'type',
    spacing: 'spacing',
    shadows: 'shadow',
    radii: 'radius'
  };
  TokenCompiler.GROUP_ALIASES = GROUP_ALIASES;

  var CANONICAL_ARCHETYPES = [
    'bento-glass', 'brutalist-kinetic', 'editorial-magazine',
    'retro-cyberpunk', 'organic-clay', 'neo-minimalist'
  ];
  TokenCompiler.CANONICAL_ARCHETYPES = CANONICAL_ARCHETYPES;

  var ARCHETYPE_ALIASES = {
    'bento': 'bento-glass', 'glass': 'bento-glass',
    'brutalist': 'brutalist-kinetic', 'kinetic': 'brutalist-kinetic',
    'editorial': 'editorial-magazine', 'magazine': 'editorial-magazine',
    'cyberpunk': 'retro-cyberpunk', 'retro': 'retro-cyberpunk',
    'clay': 'organic-clay', 'organic': 'organic-clay',
    'neo': 'neo-minimalist', 'minimalist': 'neo-minimalist'
  };

  function canonArchetype(key) {
    var k = String(key || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
    if (CANONICAL_ARCHETYPES.indexOf(k) !== -1) return k;
    return ARCHETYPE_ALIASES[k] || null;
  }

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
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
    };
  }

  function srgbLin(u) {
    var v = u / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }

  function relativeLuminance(rgb) {
    if (!rgb) return null;
    return 0.2126 * srgbLin(rgb.r) + 0.7152 * srgbLin(rgb.g) + 0.0722 * srgbLin(rgb.b);
  }

  function wcagRatio(fgHex, bgHex) {
    var a = relativeLuminance(hexToRgb(fgHex));
    var b = relativeLuminance(hexToRgb(bgHex));
    if (a == null || b == null) return null;
    var hi = Math.max(a, b), lo = Math.min(a, b);
    return (hi + 0.05) / (lo + 0.05);
  }
  TokenCompiler.wcagRatio = wcagRatio;

  function hexToOklch(hex) {
    var rgb = hexToRgb(hex);
    if (!rgb) return null;
    var R = srgbLin(rgb.r), G = srgbLin(rgb.g), B = srgbLin(rgb.b);
    var l = 0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B;
    var m = 0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B;
    var s = 0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B;
    var l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
    var L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
    var A = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
    var Bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;
    return { l: L, c: Math.sqrt(A * A + Bb * Bb), h: (Math.atan2(Bb, A) * 180 / Math.PI + 360) % 360 };
  }
  TokenCompiler.hexToOklch = hexToOklch;

  var OKLCH_RE = /^oklch\(\s*(-?[\d.]+%?)\s+(-?[\d.]+%?)\s+(-?[\d.]+)(?:deg)?\s*(?:\/\s*(-?[\d.%]+)\s*)?\)$/;
  var HEX_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
  var FUNC_COLOR_RE = /^(rgb|rgba|hsl|hsla|lab|lch|hwb|color-mix)\(/;

  function parseOklchValue(str) {
    var m = OKLCH_RE.exec(String(str).trim());
    if (!m) return null;
    function pct(v) {
      if (v == null) return null;
      var n = parseFloat(v);
      if (!isFinite(n)) return NaN;
      return /%$/.test(v) ? n / 100 : n;
    }
    var L = pct(m[1]), C = pct(m[2]), A = pct(m[4]);
    var H = parseFloat(m[3]);
    return { l: L, c: C, h: H, alpha: A == null ? 1 : A };
  }
  TokenCompiler.parseOklchValue = parseOklchValue;

  /**
   * Validate a single colour-ish value. Returns a list of issue codes
   * (empty = fine): 'invalid-color', 'oklch-l-bound', 'oklch-c-bound',
   * 'oklch-gamut-risk'.
   */
  function validateColorValue(value) {
    var v = String(value).trim();
    if (OKLCH_RE.test(v)) {
      var o = parseOklchValue(v);
      var issues = [];
      if (!o || !isFinite(o.l) || !isFinite(o.c) || !isFinite(o.h)) return ['invalid-color'];
      if (o.l < 0 || o.l > 1) issues.push('oklch-l-bound');
      if (o.c < 0) issues.push('oklch-c-bound');
      else if (o.c > 0.37) issues.push('oklch-gamut-risk');
      if (o.alpha < 0 || o.alpha > 1) issues.push('invalid-color');
      return issues;
    }
    if (HEX_RE.test(v)) return hexToRgb(v) ? [] : ['invalid-color'];
    if (FUNC_COLOR_RE.test(v)) return []; // grammar-level check only
    return ['invalid-color'];
  }

  function isColorLike(group, tokenName) {
    return group === 'colors' || group === 'color' ||
      /color|ink|surface|background|-on-/.test(tokenName);
  }

  /* ---------------- manifest loading ---------------- */

  function deepMerge(base, over) {
    if (!over || typeof over !== 'object') return base;
    var out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    for (var k in over) {
      if (!Object.prototype.hasOwnProperty.call(over, k)) continue;
      var bv = out[k], ov = over[k];
      if (ov && typeof ov === 'object' && !Array.isArray(ov) &&
          bv && typeof bv === 'object' && !Array.isArray(bv)) {
        out[k] = deepMerge(bv, ov);
      } else {
        out[k] = ov;
      }
    }
    return out;
  }

  /**
   * Is this group value a path to a token file, or an inline value?
   * The manifest format documents `"colors": "colors.json"` — a plain
   * relative filename — so a trailing .json is the signal; colour-like
   * strings and CSS functions are never paths.
   */
  function isTokenFilePath(val) {
    if (typeof val !== 'string') return false;
    var v = val.trim();
    if (!/\.json$/i.test(v)) return false;
    if (v.charAt(0) === '#' || v.charAt(0) === '(') return false; // colour-ish
    if (/^[a-z-]+\s*\(/i.test(v)) return false;                   // url(...), var(...), etc.
    return true;
  }

  /**
   * Flatten a loaded sub-manifest into a plain token body: resolve its
   * own `extends` chain (root-first, child wins) and strip the internal
   * bookkeeping keys (__dir / parent / __extendsRoot). Without this, a
   * group referenced by file path would leak `--color-__dir` into the
   * token stream and fail colour validation.
   */
  function materializeBody(node) {
    var chain = [];
    var n = node;
    while (n) { chain.push(n); n = n.parent; }
    chain.reverse();
    var out = {};
    for (var i = 0; i < chain.length; i++) {
      var link = chain[i];
      for (var k in link) {
        if (!Object.prototype.hasOwnProperty.call(link, k)) continue;
        if (k === '__dir' || k === 'parent' || k === '__extendsRoot') continue;
        var lv = link[k], ov = out[k];
        if (lv && typeof lv === 'object' && !Array.isArray(lv) &&
            ov && typeof ov === 'object' && !Array.isArray(ov)) {
          out[k] = deepMerge(ov, lv);
        } else {
          out[k] = lv;
        }
      }
    }
    return out;
  }

  function readJsonFile(p, issues) {
    var raw;
    try {
      raw = fs.readFileSync(p, 'utf8');
    } catch (e) {
      issues.push({ severity: 'error', code: 'file-unreadable', message: 'cannot read ' + p });
      return null;
    }
    try {
      return JSON.parse(raw);
    } catch (e) {
      issues.push({ severity: 'error', code: 'file-invalid-json', message: p + ': ' + e.message });
      return null;
    }
  }

  /**
   * Load a manifest (object or path), resolving `extends` chains and
   * string file references inside groups / scopes / archetypes.
   */
  function loadManifest(source, issues, seen, baseDir) {
    var manifest = source;
    var dir = baseDir;
    if (typeof source === 'string') {
      if (!fs) {
        issues.push({ severity: 'error', code: 'no-fs', message: 'string paths require a filesystem' });
        return null;
      }
      var abs = path.resolve(source);
      if (seen.indexOf(abs) !== -1) {
        issues.push({ severity: 'error', code: 'circular-extends', message: 'circular manifest chain at ' + abs });
        return null;
      }
      seen.push(abs);
      manifest = readJsonFile(abs, issues);
      if (manifest == null) return null;
      dir = path.dirname(abs);
    } else if (manifest && typeof manifest === 'object') {
      dir = dir || '.';
    } else {
      issues.push({ severity: 'error', code: 'bad-manifest', message: 'manifest must be a path or object' });
      return null;
    }

    var resolved = { __dir: dir };

    // extends: parent first, child overrides.
    if (manifest.extends) {
      var parentPath = path ? path.resolve(dir, manifest.extends) : manifest.extends;
      var parent = loadManifest(parentPath, issues, seen, path ? path.dirname(parentPath) : '.');
      if (parent) {
        resolved.__extendsRoot = parent.__extendsRoot || parent;
        resolved.parent = parent;
      }
    }

    for (var key in manifest) {
      if (!Object.prototype.hasOwnProperty.call(manifest, key)) continue;
      if (key === 'extends') continue;
      var val = manifest[key];
      if (fs && isTokenFilePath(val)) {
        // string path into a token file — materialize so the body's own
        // extends chain is resolved and internal keys never leak.
        var child = loadManifest(path.resolve(dir, val), issues, seen, path.dirname(path.resolve(dir, val)));
        resolved[key] = child ? materializeBody(child) : child;
      } else {
        resolved[key] = val;
      }
    }
    return resolved;
  }

  /* ---------------- flattening + validation ---------------- */

  function flattenGroup(groupName, obj, out, issues, scope) {
    var alias = GROUP_ALIASES[groupName] || groupName;
    for (var key in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
      // Internal manifest bookkeeping must never become a token.
      if (key === '__dir' || key === 'parent' || key === '__extendsRoot') continue;
      var v = obj[key];
      var name = alias + '-' + key;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        // Recurse with the COMPOSED name so intermediate segments
        // survive (typography.body.size → type-body-size).
        flattenGroup(name, v, out, issues, scope);
      } else if (typeof v === 'string' || typeof v === 'number') {
        var value = String(v);
        var entry = {
          path: name,
          group: alias,
          value: value,
          scope: scope || null
        };
        if (isColorLike(alias, name)) {
          var issuesFor = validateColorValue(value);
          entry.valid = issuesFor.length === 0;
          entry.colorIssues = issuesFor;
        } else {
          entry.valid = true;
          entry.colorIssues = [];
        }
        out.push(entry);
      } else {
        issues.push({
          severity: 'error', code: 'bad-token-value',
          message: scope ? scope + ':' + name : name + ' — unsupported value type'
        });
      }
    }
  }

  /**
   * compileDesignTokens(tokenManifestPath | manifestObject, options)
   * options: { strict = false }
   */
  TokenCompiler.compileDesignTokens = function (tokenManifestPath, options) {
    var opts = options || {};
    var issues = [];
    var manifest = loadManifest(tokenManifestPath, issues, [], '.');
    if (!manifest) {
      return { ok: false, error: issues.length ? issues[0].message : 'manifest failed to load', issues: issues };
    }

    // Apply inheritance chain: walk .parent links child→root,
    // then merge root-first so the child always wins.
    var chain = [];
    var node = manifest;
    while (node) {
      chain.push(node);
      node = node.parent;
    }
    chain.reverse();
    var merged = {};
    for (var i = 0; i < chain.length; i++) {
      var link = chain[i];
      for (var k in link) {
        if (k === '__dir' || k === 'parent' || k === '__extendsRoot') continue;
        if (link[k] && typeof link[k] === 'object' && !Array.isArray(link[k]) &&
            merged[k] && typeof merged[k] === 'object' && !Array.isArray(merged[k])) {
          merged[k] = deepMerge(merged[k], link[k]);
        } else {
          merged[k] = link[k];
        }
      }
    }

    // Flatten root groups.
    var tokens = [];
    var GROUPS = ['colors', 'color', 'typography', 'spacing', 'shadows', 'radii', 'radius', 'motion', 'zindex'];
    for (var g = 0; g < GROUPS.length; g++) {
      var gname = GROUPS[g];
      if (merged[gname] && typeof merged[gname] === 'object') {
        flattenGroup(gname, merged[gname], tokens, issues, null);
      }
    }

    // Scopes: { dark: { colors: {...} } } → flat overrides per scope.
    var scopes = {};
    if (merged.scopes && typeof merged.scopes === 'object') {
      for (var sc in merged.scopes) {
        if (!/^[a-z][a-z0-9-]*$/i.test(sc)) {
          issues.push({ severity: 'error', code: 'bad-scope-name', message: 'scope name ' + sc });
          continue;
        }
        var flat = [];
        var scopeObj = merged.scopes[sc];
        for (var sg in scopeObj) {
          if (scopeObj[sg] && typeof scopeObj[sg] === 'object') {
            flattenGroup(sg, scopeObj[sg], flat, issues, sc);
          }
        }
        scopes[sc] = flat;
      }
    }

    // Archetypes: { 'bento-glass': { colors: {...} } } → overrides.
    var archetypes = {};
    if (merged.archetypes && typeof merged.archetypes === 'object') {
      for (var ak in merged.archetypes) {
        var canon = canonArchetype(ak);
        if (!canon) {
          issues.push({ severity: 'warning', code: 'unknown-archetype', message: 'archetype key ' + ak + ' is not canonical' });
          canon = String(ak).trim().toLowerCase().replace(/[\s_]+/g, '-');
        }
        var aflat = [];
        var aobj = merged.archetypes[ak];
        for (var ag in aobj) {
          if (aobj[ag] && typeof aobj[ag] === 'object') {
            flattenGroup(ag, aobj[ag], aflat, issues, canon);
          }
        }
        archetypes[canon] = aflat;
      }
    }

    // ---- semantic validation ----
    var byName = {};
    tokens.forEach(function (t) { byName[t.path] = t; });

    // 1. value issues (errors)
    tokens.forEach(function (t) {
      (t.colorIssues || []).forEach(function (code) {
        var sev = code === 'oklch-gamut-risk' ? 'warning' : 'error';
        issues.push({
          severity: opts.strict ? 'error' : sev,
          code: code,
          message: 'token --' + t.path + ': ' + t.value,
          token: t.path
        });
      });
    });

    // 2. missing contrast pairs: defaults + manifest-declared.
    var pairs = Array.isArray(merged.pairs) ? merged.pairs.slice() : [];
    function hasPair(fg, bg) {
      return pairs.some(function (p) { return p.fg === fg && p.bg === bg; });
    }
    if (byName['color-text'] && byName['color-background'] && !hasPair('color-text', 'color-background')) {
      pairs.push({ fg: 'color-text', bg: 'color-background', min: 4.5 });
    }
    if (byName['color-on-primary'] && byName['color-primary'] && !hasPair('color-on-primary', 'color-primary')) {
      pairs.push({ fg: 'color-on-primary', bg: 'color-primary', min: 4.5 });
    }
    var contrastResults = [];
    for (var p = 0; p < pairs.length; p++) {
      var pair = pairs[p];
      var fgT = byName[pair.fg], bgT = byName[pair.bg];
      if (!fgT || !bgT) {
        issues.push({
          severity: 'warning', code: 'missing-contrast-pair',
          message: 'contrast pair references missing token(s): ' + pair.fg + ' / ' + pair.bg,
          token: (!fgT ? pair.fg : pair.bg)
        });
        contrastResults.push({ fg: pair.fg, bg: pair.bg, min: pair.min || 4.5, ratio: null, status: 'missing-token' });
        continue;
      }
      // Convert both to hex when possible; oklch() pairs need hex to compute WCAG.
      var ratio = wcagRatio(toComparableHex(fgT.value), toComparableHex(bgT.value));
      if (ratio == null) {
        contrastResults.push({ fg: pair.fg, bg: pair.bg, min: pair.min || 4.5, ratio: null, status: 'not-computable' });
        continue;
      }
      var min = pair.min || 4.5;
      var passed = ratio >= min;
      contrastResults.push({ fg: pair.fg, bg: pair.bg, min: min, ratio: Math.round(ratio * 100) / 100, status: passed ? 'pass' : 'fail' });
      if (!passed) {
        issues.push({
          severity: opts.strict ? 'error' : 'warning',
          code: 'contrast-fail',
          message: pair.fg + ' on ' + pair.bg + ' = ' + (Math.round(ratio * 100) / 100) + ':1 (min ' + min + ':1)',
          token: pair.fg
        });
      }
    }

    // 3. unmapped archetype tokens (archetype overrides that reference
    //    nothing in root, or unknown canonical names).
    var archetypeNames = Object.keys(archetypes);
    for (var an = 0; an < archetypeNames.length; an++) {
      var aname = archetypeNames[an];
      archetypes[aname].forEach(function (t) {
        var rootName = t.path;
        var sameGroup = tokens.some(function (r) { return r.group === t.group; });
        var exists = tokens.some(function (r) { return r.path === rootName && r.group === t.group; });
        // Warn only when the group exists at root but this specific
        // token does not — that shape smells like a typo. A whole
        // archetype-only group is a legitimate addition.
        if (sameGroup && !exists) {
          issues.push({
            severity: 'warning', code: 'unmapped-archetype-token',
            message: 'archetype ' + aname + ' overrides --' + rootName + ' which has no root token',
            token: rootName
          });
        }
      });
    }

    var errors = issues.filter(function (x) { return x.severity === 'error'; });
    var invalidTokens = tokens.filter(function (t) { return t.valid === false; }).map(function (t) { return t.path; });

    return {
      ok: errors.length === 0,
      name: merged.name || null,
      tokens: tokens,
      byName: byName,
      scopes: scopes,
      archetypes: archetypes,
      pairs: pairs,
      contrastResults: contrastResults,
      issues: issues,
      invalidTokens: invalidTokens,
      stats: {
        tokens: tokens.length,
        scopes: Object.keys(scopes).length,
        archetypes: archetypeNames.length,
        errors: errors.length,
        warnings: issues.length - errors.length
      }
    };
  };

  /* oklch() → hex so WCAG ratios can be computed for OKLCH tokens. */
  function toComparableHex(value) {
    var v = String(value).trim();
    if (HEX_RE.test(v)) return v;
    var o = parseOklchValue(v);
    if (!o) return v; // rgb()/hsl() left as-is; wcagRatio returns null
    // OKLCH → sRGB hex (Ottosson) with gamut clamp by chroma reduction.
    var c = o.c;
    function lin(c2) {
      var hRad = o.h * Math.PI / 180;
      var a = c2 * Math.cos(hRad), b = c2 * Math.sin(hRad);
      var l_ = o.l + 0.3963377774 * a + 0.2158037573 * b;
      var m_ = o.l - 0.1055613458 * a - 0.0638541728 * b;
      var s_ = o.l - 0.0894841775 * a - 1.2914855480 * b;
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
      c *= 0.97;
      rgbLin = lin(c);
    }
    function enc(u) {
      var vv = u <= 0.0031308 ? 12.92 * u : 1.055 * Math.pow(Math.max(0, Math.min(1, u)), 1 / 2.4) - 0.055;
      return Math.round(Math.max(0, Math.min(1, vv)) * 255);
    }
    return '#' + rgbLin.map(function (u) { return ('0' + enc(u).toString(16)).slice(-2); }).join('');
  }
  TokenCompiler.toComparableHex = toComparableHex;

  /* ---------------- CSS emission ---------------- */

  function emitBlock(selector, entries) {
    if (!entries.length) return '';
    var body = entries.map(function (t) { return '--' + t.path + ':' + t.value; }).join(';');
    return selector + '{' + body + ';}';
  }

  function diffScope(scopeEntries, rootByName) {
    // Keep only entries whose value differs from root (or root missing).
    return scopeEntries.filter(function (t) {
      var root = rootByName[t.path];
      return !root || root.value !== t.value;
    });
  }

  /**
   * generateOptimizedCSSVariables(compiledTokens, options)
   * options: { scopeAttribute = 'data-theme', archetypeAttribute = 'data-archetype' }
   */
  TokenCompiler.generateOptimizedCSSVariables = function (compiledTokens, options) {
    if (!compiledTokens || !compiledTokens.tokens) {
      return { ok: false, error: 'pass a compileDesignTokens() result' };
    }
    var opts = options || {};
    var scopeAttr = opts.scopeAttribute || 'data-theme';
    var archAttr = opts.archetypeAttribute || 'data-archetype';

    var valid = compiledTokens.tokens.filter(function (t) { return t.valid !== false; });
    var dropped = compiledTokens.tokens.filter(function (t) { return t.valid === false; }).map(function (t) { return t.path; });
    var byName = {};
    valid.forEach(function (t) { byName[t.path] = t; });

    var blocks = [emitBlock(':root', valid)];

    Object.keys(compiledTokens.scopes || {}).forEach(function (scope) {
      var diffed = diffScope(compiledTokens.scopes[scope].filter(function (t) { return t.valid !== false; }), byName);
      var block = emitBlock('[' + scopeAttr + '="' + scope + '"]', diffed);
      if (block) blocks.push(block);
    });

    Object.keys(compiledTokens.archetypes || {}).forEach(function (arch) {
      var diffed = diffScope(compiledTokens.archetypes[arch].filter(function (t) { return t.valid !== false; }), byName);
      var block = emitBlock('[' + archAttr + '="' + arch + '"]', diffed);
      if (block) blocks.push(block);
    });

    var css = blocks.filter(Boolean).join('\n') + '\n';
    return {
      ok: true,
      css: css,
      blocks: blocks.filter(Boolean),
      dropped: dropped,
      rootCount: valid.length,
      scopeBlockCount: blocks.length - 1,
      bytes: css.length
    };
  };

  /* CommonJS + browser global */
  if (typeof module !== 'undefined' && module.exports) module.exports = TokenCompiler;
  if (typeof window !== 'undefined') window.TokenCompiler = TokenCompiler;
})();
