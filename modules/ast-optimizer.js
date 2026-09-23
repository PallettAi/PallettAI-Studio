// ============================================================
// PallettAI Studio — ASTOptimizer
// Site-schema tree-shaking + CSS purging with compile metrics.
//
// shakeAST(projectAST)
//   The Studio's site schema is a JSON tree:
//     { site: { pages: [{ slug, sections: [...] }] } }
//   (a flat site.sections is accepted too). The shaker:
//     · drops component definitions from the registry that no
//       section references (projectAST.components / .schemas)
//     · drops sections whose type is unknown to the registry
//       (when a registry exists), sections with no content at
//       all, and exact duplicates of an earlier section
//     · strips empty prop structures ({}, all-null props)
//     · never mutates the input — returns a shaken copy
//
// pruneUnusedCSS(htmlOutput, rawCSSBundle, options)
//   Brace-aware (not naive-split) CSS segmentation:
//     · extracts class tokens from every class="…" in the HTML
//     · a selector survives only if ALL its class tokens are used
//       (or match an allow-prefix — runtime-injected classes like
//       is-/js-/pa- are protected by default); comma alternatives
//       are evaluated independently and dead ones are rewritten
//       away; element/global rules and @-blocks are kept
//     · custom properties are purged only from :root/html/body
//       blocks, and only when no var() reference remains in the
//       kept CSS or the HTML's inline styles — a conservative,
//       honest scope
//     · classes the page's own script toggles at runtime
//       (classList.add/toggle/remove, className = …, setAttribute
//       ('class', …)) are treated as USED even though they appear in
//       no class attribute. Without this the theme toggle's rules —
//       body.theme-light / body.theme-dark, plus menu and accordion
//       states — look unreferenced and are deleted: the page ships,
//       loads, and the toggle silently stops working. The scan makes
//       protection self-keeping rather than a prefix list to maintain.
//   Returns per-compile metrics for both operations: eliminated
//   node counts and payload percentage reduction.
//
// Zero dependencies. CommonJS + browser global.
// ============================================================
(function () {
  'use strict';

  const ASTOptimizer = {};

  // UTF-8 byte length without assuming Buffer — the module is loaded
  // both as CommonJS and as a browser classic script, and a metric
  // that throws in one of those is worse than no metric.
  var byteLength = (function () {
    if (typeof Buffer !== 'undefined' && Buffer.byteLength) {
      return function (s) { return Buffer.byteLength(s, 'utf8'); };
    }
    if (typeof TextEncoder !== 'undefined') {
      var enc = new TextEncoder();
      return function (s) { return enc.encode(s).length; };
    }
    return function (s) { return s.length; };
  })();

  /* ============================================================
     shared tree utilities
     ============================================================ */

  function isObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function countNodes(value) {
    // A "node" is any object or array in the site tree. Scalars are
    // leaves, not nodes — the metric counts structure, not text.
    if (Array.isArray(value)) return 1 + value.reduce(function (s, v) { return s + countNodes(v); }, 0);
    if (isObject(value)) {
      var n = 1;
      Object.keys(value).forEach(function (k) { n += countNodes(value[k]); });
      return n;
    }
    return 0;
  }

  function stableStringify(v) {
    if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
    if (isObject(v)) {
      return '{' + Object.keys(v).sort().map(function (k) {
        return JSON.stringify(k) + ':' + stableStringify(v[k]);
      }).join(',') + '}';
    }
    return JSON.stringify(v);
  }

  function contentHash(v) {
    var s = stableStringify(v);
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  function hasContent(section) {
    if (!isObject(section)) return false;
    // id/type/props are structural — content is everything else. A
    // section whose only keys are structural is a stub, not content.
    var keys = Object.keys(section).filter(function (k) { return k !== 'id' && k !== 'type' && k !== 'props'; });
    for (var i = 0; i < keys.length; i++) {
      var v = section[keys[i]];
      if (typeof v === 'string' && v.trim()) return true;
      if (Array.isArray(v) && v.length) return true;
      if (typeof v === 'number' || typeof v === 'boolean') return true;
    }
    var props = section.props;
    if (isObject(props)) {
      var vals = Object.keys(props).map(function (k) { return props[k]; }).filter(function (v2) { return v2 !== null && v2 !== undefined && v2 !== ''; });
      if (vals.length) return true;
    }
    return false;
  }

  function stripEmptyProps(section) {
    var stripped = 0;
    ['props', 'attrs', 'styles'].forEach(function (k) {
      if (isObject(section[k])) {
        var kept = {};
        Object.keys(section[k]).forEach(function (pk) {
          var v = section[k][pk];
          if (v === null || v === undefined || v === '') { stripped++; return; }
          if (isObject(v) && !Object.keys(v).length) { stripped++; return; }
          if (Array.isArray(v) && !v.length) { stripped++; return; }
          kept[pk] = v;
        });
        if (Object.keys(kept).length) section[k] = kept;
        else { delete section[k]; if (k === 'props') stripped++; }
      }
    });
    return stripped;
  }

  /* ============================================================
     1 — shakeAST
     ============================================================ */

  function collectSectionTypes(projectAST) {
    var types = [];
    var site = projectAST.site || {};
    var pageLists = [];
    if (Array.isArray(site.pages)) pageLists = site.pages.map(function (p) { return (p && p.sections) || []; });
    if (Array.isArray(site.sections)) pageLists.push(site.sections);
    pageLists.forEach(function (sections) {
      sections.forEach(function (s) { if (s && s.type) types.push(String(s.type)); });
    });
    return types;
  }

  /**
   * shakeAST(projectAST, options)
   * @param {object} projectAST  { site: {pages|sections…}, components?, schemas? }
   * @param {object} [options] { dedupe (default true), dropUnknownTypes (default true when registry present) }
   * @returns {{ ok, shaken, metrics: { nodesIn, nodesOut, nodesEliminated,
   *            sectionsDropped, componentsDropped, propsStripped, duplicatesRemoved, durationMs } }} |
   *           { ok: false, error }
   */
  ASTOptimizer.shakeAST = function (projectAST, options) {
    if (!projectAST || !isObject(projectAST.site)) {
      return { ok: false, error: 'projectAST with a site object is required.' };
    }
    var t0 = typeof process !== 'undefined' && process.hrtime ? process.hrtime.bigint() : null;
    var opts = options || {};
    var nodesIn = countNodes(projectAST);

    var shaken = JSON.parse(JSON.stringify(projectAST));
    var site = shaken.site;
    var metrics = {
      nodesIn: nodesIn,
      nodesOut: 0,
      nodesEliminated: 0,
      sectionsDropped: 0,
      componentsDropped: 0,
      propsStripped: 0,
      duplicatesRemoved: 0,
      durationMs: 0
    };

    // Registry of known component types: projectAST.components or .schemas
    // (either an array of {type} / keys, or a map type → definition).
    var registry = null;
    if (isObject(shaken.components)) registry = shaken.components;
    else if (Array.isArray(shaken.components)) {
      registry = {};
      shaken.components.forEach(function (c) { if (c && c.type) registry[c.type] = c; });
      shaken.components = registry;
    } else if (isObject(shaken.schemas)) registry = shaken.schemas;
    else if (Array.isArray(shaken.schemas)) {
      registry = {};
      shaken.schemas.forEach(function (c) { if (c && c.type) registry[c.type] = c; });
      shaken.schemas = registry;
    }

    var referenced = {};
    var seenHashes = {};
    var dedupe = opts.dedupe !== false;

    function cleanSectionList(sections) {
      var out = [];
      if (!Array.isArray(sections)) return out;
      for (var i = 0; i < sections.length; i++) {
        var s = sections[i];
        if (!isObject(s) || !s.type) { metrics.sectionsDropped++; continue; }
        if (registry && opts.dropUnknownTypes !== false && !registry[s.type]) { metrics.sectionsDropped++; continue; }
        if (!hasContent(s)) { metrics.sectionsDropped++; continue; }
        metrics.propsStripped += stripEmptyProps(s);
        if (dedupe) {
          var h = contentHash(Object.assign({}, s, { id: null }));
          if (seenHashes[h]) { metrics.duplicatesRemoved++; continue; }
          seenHashes[h] = true;
        }
        referenced[s.type] = true;
        out.push(s);
      }
      return out;
    }

    if (Array.isArray(site.pages)) {
      site.pages.forEach(function (p) {
        if (!isObject(p)) { metrics.sectionsDropped++; return; }
        p.sections = cleanSectionList(p.sections);
      });
      // A page with no sections renders nothing — drop it too.
      var before = site.pages.length;
      site.pages = site.pages.filter(function (p) { return isObject(p) && Array.isArray(p.sections) && p.sections.length; });
      metrics.sectionsDropped += before - site.pages.length;
    }
    if (Array.isArray(site.sections)) site.sections = cleanSectionList(site.sections);

    // Tree-shake the registry: unreferenced component definitions go.
    if (registry) {
      Object.keys(registry).forEach(function (type) {
        if (!referenced[type]) { delete registry[type]; metrics.componentsDropped++; }
      });
      if (shaken.schemas) shaken.schemas = registry;
    }

    metrics.nodesOut = countNodes(shaken);
    metrics.nodesEliminated = metrics.nodesIn - metrics.nodesOut;
    if (t0) metrics.durationMs = Number(process.hrtime.bigint() - t0) / 1e6;
    return { ok: true, shaken: shaken, metrics: metrics };
  };

  /* ============================================================
     2 — pruneUnusedCSS
     ============================================================ */

  var DEFAULT_ALLOW_PREFIXES = ['is-', 'has-', 'js-', 'pa-', 'rg-', 'bento-', 'marquee', 'dropcap'];

  // Extract class tokens from HTML class attributes + inline styles.
  function extractUsedClasses(html) {
    var used = new Set();
    var re = /class\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
    var m;
    while ((m = re.exec(html))) {
      var raw = m[1] != null ? m[1] : m[2];
      raw.split(/\s+/).forEach(function (c) { if (c) used.add(c); });
    }
    return used;
  }

  // Class tokens the document's OWN script adds or removes at runtime.
  //
  // This is the difference between a pruner and a site-breaker. A theme
  // toggle writes `document.body.classList.toggle('theme-light')` and the
  // body ships as `<body id="top">` — no theme class in any class
  // attribute — so every `body.theme-light{…}` rule looks unreferenced and
  // gets deleted. The site builds, ships, loads, and the toggle silently
  // does nothing; the failure is invisible in a build log. The same is
  // true of `open`, `in`, `active`, `show` and friends, which are the
  // states menus and accordions live in.
  //
  // The Studio emits its scripts inline, so scanning the document is
  // sufficient here — and it is *self-keeping*: a new toggle in the
  // builder is protected the moment it ships, with no list to update.
  // An external script would be invisible to this scan; callers in that
  // position pass `allowPrefixes`.
  function extractRuntimeClasses(html) {
    var found = new Set();
    function addTokens(text) {
      if (!text) return;
      String(text).split(/\s+/).forEach(function (t) {
        // A class token, not a selector or an expression.
        if (t && /^[a-zA-Z][\w-]*$/.test(t)) found.add(t);
      });
    }
    var m;
    // classList.add/remove/toggle/replace/contains('a', "b") — every
    // quoted argument is a class token.
    var listRe = /classList\s*\.\s*(?:add|remove|toggle|replace|contains|supports)\s*\(([^)]*)\)/g;
    while ((m = listRe.exec(html))) {
      var args = m[1];
      var q = /['"]([^'"]+)['"]/g;
      var a;
      while ((a = q.exec(args))) addTokens(a[1]);
    }
    // element.className = '…' | `…` and classList.value = '…'
    var nameRe = /(?:className|\.classList\.value|classList\.value)\s*=\s*(['"`])([^'"`]*)\1/g;
    while ((m = nameRe.exec(html))) addTokens(m[2]);
    // setAttribute('class', 'a b c')
    var attrRe = /setAttribute\s*\(\s*['"]class['"]\s*,\s*(['"])([^'"]*)\1/g;
    while ((m = attrRe.exec(html))) addTokens(m[2]);
    // classList.remove(...someArray) / add(...list) — a spread or array
    // literal of quoted tokens.
    var spreadRe = /classList\s*\.\s*(?:add|remove|toggle)\s*\(\s*\.\.\.\s*\[([^\]]*)\]\s*\)/g;
    while ((m = spreadRe.exec(html))) {
      var sq = /['"]([^'"]+)['"]/g;
      var s;
      while ((s = sq.exec(m[1]))) addTokens(s[1]);
    }
    return found;
  }

  function extractInlineVars(html) {
    var used = new Set();
    var re = /var\(\s*(--[\w-]+)/g;
    var m;
    while ((m = re.exec(html))) used.add(m[1]);
    return used;
  }

  // Split CSS into top-level segments: {prelude, body, start}.
  // Brace-aware — @media bodies stay intact as single segments.
  function segmentCSS(css) {
    var segs = [];
    var i = 0, n = css.length;
    var depth = 0, segStart = 0, preludeEnd = -1;
    for (i = 0; i < n; i++) {
      var ch = css[i];
      if (ch === '{') {
        if (depth === 0) preludeEnd = i;
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0 && preludeEnd !== -1) {
          segs.push({
            prelude: css.slice(segStart, preludeEnd).trim(),
            body: css.slice(preludeEnd + 1, i),
            end: i + 1
          });
          segStart = i + 1;
          preludeEnd = -1;
        }
        if (depth < 0) depth = 0; // tolerate stray braces
      }
    }
    if (segStart < n) {
      var tail = css.slice(segStart).trim();
      if (tail) segs.push({ prelude: tail, body: null, end: n, tailOnly: true });
    }
    return segs;
  }

  function selectorClassTokens(sel) {
    var out = [];
    var re = /\.([a-zA-Z0-9_-]+)/g;
    var m;
    while ((m = re.exec(sel))) out.push(m[1]);
    return out;
  }

  function classAllowed(cls, allowPrefixes) {
    for (var i = 0; i < allowPrefixes.length; i++) {
      if (cls.indexOf(allowPrefixes[i]) === 0) return true;
    }
    return false;
  }

  // Evaluate one selector alternative against the used set.
  function selectorAlive(sel, used, allowPrefixes) {
    var toks = selectorClassTokens(sel);
    if (!toks.length) return true; // element/global selector — keep
    for (var i = 0; i < toks.length; i++) {
      if (!used.has(toks[i]) && !classAllowed(toks[i], allowPrefixes)) return false;
    }
    return true;
  }

  function pruneSelectorList(prelude, used, allowPrefixes) {
    var alts = prelude.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    var alive = alts.filter(function (s) { return selectorAlive(s, used, allowPrefixes); });
    return alive.join(',');
  }

  function isRootish(prelude) {
    var s = prelude.replace(/,[\s]*$/, '').trim();
    return s === ':root' || s === 'html' || s === 'body' || s === ':root,' || /^[^,{]*:root\b[^,{]*$/.test(s);
  }

  // Recursively prune a segment list; returns kept CSS text.
  // varsOnly: keep every rule exactly as-is and only purge dead
  // custom properties from rootish blocks (used by pass 2 — pass 2
  // must never re-run class elimination).
  function pruneSegments(segs, used, allowPrefixes, stats, isTopLevel, varsOnly) {
    var out = [];
    for (var i = 0; i < segs.length; i++) {
      var seg = segs[i];
      if (seg.tailOnly) { out.push(seg.prelude); continue; }
      var pre = seg.prelude;
      var atMatch = /^@([\w-]+)/.exec(pre);

      if (atMatch && (atMatch[1] === 'media' || atMatch[1] === 'supports' || atMatch[1] === 'container' || atMatch[1] === 'layer')) {
        var inner = pruneSegments(segmentCSS(seg.body), used, allowPrefixes, stats, true, varsOnly);
        if (inner.trim()) out.push(pre + '{' + inner + '}');
        else if (!varsOnly) stats.rulesEliminated++;
        continue;
      }
      if (atMatch) {
        // @keyframes/@font-face/@import/@font-feature-values/unknown — keep whole.
        out.push(pre + '{' + seg.body + '}');
        continue;
      }

      if (varsOnly) {
        var vbody = isRootish(pre) ? pruneRootVars(seg.body, stats) : seg.body;
        out.push(pre + '{' + vbody + '}');
        continue;
      }

      // Plain rule.
      stats.rulesIn++;
      var keptSel = pruneSelectorList(pre, used, allowPrefixes);
      if (!keptSel) { stats.rulesEliminated++; continue; }
      var body = seg.body;
      if (keptSel !== pre) stats.selectorsRewritten++;
      if (isTopLevel && isRootish(keptSel)) {
        body = pruneRootVars(body, stats);
      }
      out.push((keptSel !== pre ? keptSel : pre) + '{' + body + '}');
    }
    return out.join('');
  }

  function pruneRootVars(body, stats) {
    // Declarations: split on ';' at depth 0 of the body (var values
    // can contain parens but rarely braces/semicolons inside strings —
    // font shorthand may contain quotes; keep it simple and safe by
    // only dropping clearly-var-shaped declarations).
    var decls = body.split(';');
    var kept = [];
    for (var i = 0; i < decls.length; i++) {
      var d = decls[i].trim();
      if (!d) continue;
      var vm = /^(--[\w-]+)\s*:/.exec(d);
      if (vm) {
        stats.varsIn++;
        if (stats.usedVars.has(vm[1])) { kept.push(d); stats.varsOut++; }
        else stats.varsEliminated++;
      } else {
        kept.push(d);
        stats.varsOut++;
      }
    }
    return kept.length ? kept.join(';') + ';' : '';
  }

  /**
   * pruneUnusedCSS(htmlOutput, rawCSSBundle, options)
   * @param {string|string[]} htmlOutput  one HTML string or an array (pages)
   * @param {string} rawCSSBundle
   * @param {object} [options] { allowPrefixes, keepAllVars }
   * @returns {{ ok, css, metrics: { bytesIn, bytesOut, bytesSaved, percentReduced,
   *            rulesIn, rulesEliminated, selectorsRewritten, classesUsed,
   *            varsIn, varsOut, varsEliminated, keyframesKept } }} |
   *           { ok: false, error }
   */
  ASTOptimizer.pruneUnusedCSS = function (htmlOutput, rawCSSBundle, options) {
    if (typeof rawCSSBundle !== 'string' || !rawCSSBundle.trim()) {
      return { ok: false, error: 'rawCSSBundle must be a non-empty CSS string.' };
    }
    var html = Array.isArray(htmlOutput) ? htmlOutput.join('\n') : String(htmlOutput || '');
    var opts = options || {};
    var allowPrefixes = Array.isArray(opts.allowPrefixes) ? opts.allowPrefixes : DEFAULT_ALLOW_PREFIXES;

    var usedVars = extractInlineVars(html);
    // Classes the page's own script toggles are USED, whatever the
    // markup says — see extractRuntimeClasses for why this is not
    // optional.
    var usedClasses = extractUsedClasses(html);
    var runtimeClasses = extractRuntimeClasses(html);
    runtimeClasses.forEach(function (c) { usedClasses.add(c); });
    var stats = {
      rulesIn: 0, rulesEliminated: 0, selectorsRewritten: 0,
      varsIn: 0, varsOut: 0, varsEliminated: 0,
      usedVars: usedVars
    };

    var css = rawCSSBundle;
    var keyframesKept = (css.match(/@keyframes/g) || []).length;

    // Pass 1: prune rules (seg-based). var() usage inside KEPT css
    // must count as used before root-var pruning — do root pruning
    // inside the same walk only after we know global usage. Simplest
    // correct order: collect var() usage from the whole (kept-shaped)
    // bundle first — definitions in :root don't create usage, but
    // var() references anywhere do.
    var allVarUses = css.match(/var\(\s*(--[\w-]+)/g) || [];
    allVarUses.forEach(function (v) {
      var name = /--[\w-]+/.exec(v)[0];
      usedVars.add(name);
    });

    var pruned = pruneSegments(segmentCSS(css), usedClasses, allowPrefixes, stats, true);

    // Pass 2: with rule pruning done, drop vars that ended up with no
    // references at all (kept CSS + HTML) from rootish blocks only.
    // pruneSegments already consulted usedVars — which included
    // references from ALL rules including eliminated ones; re-check
    // against the SURVIVING css to be exact.
    var survivingUses = pruned.match(/var\(\s*(--[\w-]+)/g) || [];
    var live = new Set(usedVars);
    survivingUses.forEach(function (v) { live.add(/--[\w-]+/.exec(v)[0]); });
    var stats2 = { varsIn: 0, varsOut: 0, varsEliminated: 0, usedVars: live, rulesIn: 0, rulesEliminated: 0, selectorsRewritten: 0 };
    if (opts.keepAllVars) {
      stats2.varsIn = stats.varsIn; stats2.varsOut = stats.varsIn;
    } else {
      // Pass 2 is vars-ONLY: rules were already decided in pass 1.
      pruned = pruneSegments(segmentCSS(pruned), new Set(), allowPrefixes, stats2, true, true);
      // merge stats (pass-2 root-var pruning only)
      stats.varsIn += stats2.varsIn;
      stats.varsOut += stats2.varsOut;
      stats.varsEliminated += stats2.varsEliminated;
    }

    var bytesIn = byteLength(rawCSSBundle);
    var bytesOut = byteLength(pruned);
    var metrics = {
      bytesIn: bytesIn,
      bytesOut: bytesOut,
      bytesSaved: bytesIn - bytesOut,
      percentReduced: bytesIn ? Math.round(((bytesIn - bytesOut) / bytesIn) * 10000) / 100 : 0,
      rulesIn: stats.rulesIn,
      rulesEliminated: stats.rulesEliminated,
      selectorsRewritten: stats.selectorsRewritten,
      classesUsed: usedClasses.size,
      runtimeProtected: runtimeClasses.size,
      varsIn: stats.varsIn,
      varsOut: stats.varsOut,
      varsEliminated: stats.varsEliminated,
      keyframesKept: keyframesKept
    };
    return { ok: true, css: pruned, metrics: metrics };
  };

  /* ---------------- exports ---------------- */

  ASTOptimizer.countNodes = countNodes;
  ASTOptimizer.contentHash = contentHash;
  ASTOptimizer.segmentCSS = segmentCSS;
  ASTOptimizer.extractRuntimeClasses = extractRuntimeClasses;
  ASTOptimizer.DEFAULT_ALLOW_PREFIXES = DEFAULT_ALLOW_PREFIXES;

  if (typeof module !== 'undefined' && module.exports) module.exports = ASTOptimizer;
})();
