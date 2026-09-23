// ============================================================
// PallettAI Studio — ThemeInjector
// Runtime token injection & archetype switching for the
// Studio preview iframe — instant feedback, zero reloads.
//
// injectThemeTokens(iframeDocument, tokenMap, options)
//   Writes every token as a CSS custom property straight onto
//   documentElement.style (setProperty) — no <style> churn, no
//   iframe reload. Diffing means only CHANGED variables hit the
//   DOM, so untouched properties keep their CSS transitions.
//
// switchArchetypeRuntime(iframeDocument, newArchetypeKey, tokenCatalog)
//   Installs a transition stylesheet once (opacity + colour
//   transitions, 200ms, reduced-motion aware), fades the body
//   out, swaps the archetype body class + font hooks + token
//   block, waits the fade, fades back in. Returns a promise and
//   never leaves the document faded out — every exit path
//   restores opacity.
//
// Both functions also run headless: pass a plain stub object with
// documentElement/body/classList/setProperty and they work —
// which is exactly how the smoke suite drives them.
//
// CommonJS + browser global, like the rest of modules/.
// ============================================================
(function () {
  'use strict';

  const ThemeInjector = {};

  var ARCHETYPES = ['bento-glass', 'brutalist-kinetic', 'editorial-magazine', 'retro-cyberpunk', 'organic-clay', 'neo-minimalist'];
  ThemeInjector.ARCHETYPES = ARCHETYPES;

  var ARCH_BODY_CLASS = 'pa-arch-';

  function canon(key) {
    var ALIASES = {
      'bento': 'bento-glass', 'glass': 'bento-glass',
      'brutalist': 'brutalist-kinetic', 'kinetic': 'brutalist-kinetic',
      'editorial': 'editorial-magazine', 'magazine': 'editorial-magazine',
      'cyberpunk': 'retro-cyberpunk', 'retro': 'retro-cyberpunk',
      'clay': 'organic-clay', 'organic': 'organic-clay',
      'neo': 'neo-minimalist', 'minimalist': 'neo-minimalist', 'minimal': 'neo-minimalist'
    };
    var k = String(key || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
    if (ARCHETYPES.indexOf(k) !== -1) return k;
    return ALIASES[k] || null;
  }
  ThemeInjector.canonicalKey = canon;

  /* ---------------- token flattening ---------------- */

  var COLOR_ALIASES = {
    primary: 'primary', primaryHover: 'primary-hover', secondary: 'secondary',
    accent: 'accent', background: 'background', surface: 'surface',
    surfaceAlt: 'surface-alt', text: 'text', muted: 'muted', border: 'border',
    onPrimary: 'on-primary', danger: 'danger', warning: 'warning',
    success: 'success', info: 'info'
  };

  function flattenTokens(tokenMap) {
    var out = {};
    var t = tokenMap || {};
    var colors = t.colors || {};
    Object.keys(colors).forEach(function (k) {
      var name = COLOR_ALIASES[k] || String(k).replace(/[^a-zA-Z0-9-]+/g, '-');
      out['--pai-' + name] = String(colors[k]);
    });
    var fonts = t.fonts || {};
    Object.keys(fonts).forEach(function (f) {
      out['--pai-font-' + f] = String(fonts[f]);
    });
    var type = t.typography || {};
    Object.keys(type).forEach(function (k) {
      var spec = type[k];
      if (spec && typeof spec === 'object') {
        if (spec.size != null) out['--pai-text-' + k] = String(spec.size);
        if (spec.lineHeight != null) out['--pai-text-' + k + '-lh'] = String(spec.lineHeight);
        if (spec.tracking != null) out['--pai-text-' + k + '-ls'] = String(spec.tracking);
      } else if (spec != null) {
        out['--pai-text-' + k] = String(spec);
      }
    });
    var spacing = t.spacing || {};
    Object.keys(spacing).forEach(function (k) {
      var n = Number(spacing[k]);
      out['--pai-space-' + k] = isFinite(n) ? (Math.round((n / 16) * 10000) / 10000) + 'rem' : String(spacing[k]);
    });
    var radii = t.radii || {};
    Object.keys(radii).forEach(function (k) {
      var v = radii[k];
      out['--pai-radius-' + k] = (typeof v === 'number' && isFinite(v)) ? v + 'px' : String(v);
    });
    var shadows = t.shadows || {};
    Object.keys(shadows).forEach(function (k) {
      out['--pai-shadow-' + k] = String(shadows[k]);
    });
    return out;
  }
  ThemeInjector.flattenTokens = flattenTokens;

  /* ============================================================
     1 — direct variable injection
     ============================================================ */

  /**
   * injectThemeTokens(iframeDocument, tokenMap, options)
   * @param {Document|object} iframeDocument  iframe document (or stub)
   * @param {object} tokenMap  canonical Studio token map
   * @param {object} [options] { prefix, replace (drop vars absent from tokenMap) }
   * @returns {{ ok, applied: string[], removed: string[], skipped: string[], total } |
   *           { ok: false, error }}
   */
  ThemeInjector.injectThemeTokens = function (iframeDocument, tokenMap, options) {
    if (!iframeDocument || !iframeDocument.documentElement || typeof iframeDocument.documentElement.style.setProperty !== 'function') {
      return { ok: false, error: 'iframeDocument with documentElement.style.setProperty is required.' };
    }
    var opts = options || {};
    var prefix = String(opts.prefix || 'pai').replace(/[^a-z0-9-]/gi, '') || 'pai';
    var target = iframeDocument.documentElement.style;

    // Flat 'key: value' maps are accepted directly.
    var flat = {};
    var isFlat = tokenMap && !tokenMap.colors && !tokenMap.fonts && !tokenMap.typography;
    if (isFlat) {
      Object.keys(tokenMap).forEach(function (k) {
        flat[k.indexOf('--') === 0 ? k : '--' + prefix + '-' + k] = String(tokenMap[k]);
      });
    } else {
      var flattened = flattenTokens(tokenMap);
      Object.keys(flattened).forEach(function (k) {
        flat[k.replace('--pai-', '--' + prefix + '-')] = flattened[k];
      });
    }

    var applied = [], removed = [], skipped = [];
    var keys = Object.keys(flat);

    // Diff against what we own from previous injections.
    var state = iframeDocument.__paiThemeState || (iframeDocument.__paiThemeState = { owned: {} });
    var owned = state.owned;

    if (opts.replace) {
      Object.keys(owned).forEach(function (k) {
        if (flat[k] == null) {
          target.removeProperty(k);
          delete owned[k];
          removed.push(k);
        }
      });
    }

    for (var i = 0; i < keys.length; i++) {
      var prop = keys[i], val = flat[prop];
      if (val == null || val === '') { skipped.push(prop); continue; }
      if (owned[prop] === val && !opts.replace) { continue; } // unchanged — don't touch transitions
      target.setProperty(prop, val);
      owned[prop] = val;
      applied.push(prop);
    }

    return { ok: true, applied: applied, removed: removed, skipped: skipped, total: keys.length };
  };

  /* ============================================================
     2 — runtime archetype switch
     ============================================================ */

  var TRANSITION_CSS = [
    '.pa-arch-fade { transition: opacity 200ms ease; }',
    '.pa-arch-fade * { transition: background-color 200ms ease, color 200ms ease, border-color 200ms ease, box-shadow 200ms ease; }',
    '.pa-arch-faded { opacity: 0; }',
    '@media (prefers-reduced-motion: reduce) {',
    '  .pa-arch-fade, .pa-arch-fade * { transition: none; }',
    '  .pa-arch-faded { opacity: 1; }',
    '}'
  ].join('\n');

  // Per-archetype structural hooks: body class, font-family
  // token overrides, letter-spacing/default tracking hint.
  var ARCH_HOOKS = {
    'bento-glass': { fonts: { sans: 'Inter, system-ui, sans-serif', display: 'Inter, system-ui, sans-serif' }, tracking: 'normal' },
    'brutalist-kinetic': { fonts: { sans: 'Archivo, "Helvetica Neue", Arial, sans-serif', display: 'Archivo Black, Archivo, sans-serif' }, tracking: '-0.01em' },
    'editorial-magazine': { fonts: { serif: 'Georgia, "Times New Roman", serif', display: 'Georgia, "Times New Roman", serif' }, tracking: 'normal' },
    'retro-cyberpunk': { fonts: { sans: '"IBM Plex Mono", ui-monospace, monospace', display: '"Orbitron", "IBM Plex Mono", monospace' }, tracking: '0.02em' },
    'organic-clay': { fonts: { sans: 'Nunito, "Segoe UI", sans-serif', display: 'Nunito, "Segoe UI", sans-serif' }, tracking: 'normal' },
    'neo-minimalist': { fonts: { sans: 'Inter, system-ui, sans-serif', display: 'Inter, system-ui, sans-serif' }, tracking: '-0.005em' }
  };

  function ensureTransitionStyle(doc) {
    var STYLE_ID = '__pai-arch-transitions';
    var el = doc.getElementById ? doc.getElementById(STYLE_ID) : null;
    if (!el) {
      el = doc.createElement('style');
      el.id = STYLE_ID;
      el.textContent = TRANSITION_CSS;
      (doc.head || doc.documentElement).appendChild(el);
    }
    return el;
  }

  function nextFrame() {
    return new Promise(function (resolve) {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(function () { resolve(); });
      else setTimeout(resolve, 16);
    });
  }

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /**
   * switchArchetypeRuntime(iframeDocument, newArchetypeKey, tokenCatalog, options)
   * @param {Document|object} iframeDocument
   * @param {string} newArchetypeKey
   * @param {object} [tokenCatalog]  { archetypeKey → tokenMap }, or a function(key) → tokenMap
   * @param {object} [options] { fadeMs (default 200), className, applyTokens (default true) }
   * @returns Promise<{ ok, archetype, previous, bodyClass, tokensApplied, fadeMs }> |
   *          Promise<{ ok: false, error }>
   */
  ThemeInjector.switchArchetypeRuntime = function (iframeDocument, newArchetypeKey, tokenCatalog, options) {
    return new Promise(function (resolve) {
      if (!iframeDocument || !iframeDocument.documentElement) {
        resolve({ ok: false, error: 'iframeDocument with documentElement is required.' });
        return;
      }
      var key = canon(newArchetypeKey);
      if (!key) {
        resolve({ ok: false, error: 'Unknown archetype: ' + newArchetypeKey + ' — expected one of: ' + ARCHETYPES.join(', ') });
        return;
      }
      var opts = options || {};
      var fadeMs = Math.max(0, Number(opts.fadeMs != null ? opts.fadeMs : 200));
      var body = iframeDocument.body;
      if (!body || !body.classList) {
        resolve({ ok: false, error: 'iframeDocument.body with classList is required.' });
        return;
      }

      ensureTransitionStyle(iframeDocument);
      var previous = null;
      // Array.from covers both real DOM classList (indexed + iterable)
      // and set-like test stubs.
      var classList = [];
      try { classList = Array.from ? Array.from(body.classList) : []; } catch (e) { /* inaccessible */ }
      for (var i = 0; i < classList.length; i++) {
        var c = String(classList[i] || '');
        if (c.indexOf(ARCH_BODY_CLASS) === 0) { previous = c.slice(ARCH_BODY_CLASS.length); break; }
      }

      // Fade out (skipped when the document says motion-reduce).
      var reduced = false;
      try { reduced = iframeDocument.defaultView && iframeDocument.defaultView.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* stub */ }
      var timing = reduced ? 0 : fadeMs;

      var finish = function (tokensApplied) {
        // Swap archetype class + structural hooks.
        body.classList.remove(ARCH_BODY_CLASS + (previous || ''));
        if (previous) body.classList.remove('pa-arch-fade', 'pa-arch-faded');
        body.classList.add(ARCH_BODY_CLASS + key);

        // Font hooks: set family + tracking tokens for the new look.
        var hooks = ARCH_HOOKS[key];
        var style = iframeDocument.documentElement.style;
        if (hooks) {
          Object.keys(hooks.fonts).forEach(function (f) {
            style.setProperty('--pai-font-' + f, hooks.fonts[f]);
          });
          style.setProperty('--pai-tracking', hooks.tracking);
        }

        // Catalog tokens (map or resolver function).
        var applied = [];
        if (opts.applyTokens !== false && tokenCatalog) {
          var tm = typeof tokenCatalog === 'function' ? tokenCatalog(key, iframeDocument) : tokenCatalog[key];
          if (tm) {
            var res = ThemeInjector.injectThemeTokens(iframeDocument, tm, { prefix: opts.prefix });
            if (res.ok) applied = res.applied;
          }
        }

        // Fade back in.
        if (previous) body.classList.remove('pa-arch-faded');
        var done = function () {
          resolve({
            ok: true,
            archetype: key,
            previous: previous,
            bodyClass: ARCH_BODY_CLASS + key,
            tokensApplied: applied,
            fontsApplied: hooks ? Object.keys(hooks.fonts) : [],
            fadeMs: timing
          });
        };
        if (timing > 0) wait(timing).then(done); else done();
      };

      if (previous && timing > 0) {
        body.classList.add('pa-arch-fade', 'pa-arch-faded');
        nextFrame().then(function () { return wait(timing); }).then(function () { finish(); });
      } else {
        finish();
      }
    });
  };

  /**
   * readInjectedTokens(iframeDocument, prefix)
   * Test/debug helper: list every token this module owns on the
   * documentElement, with computed values where available.
   */
  ThemeInjector.readInjectedTokens = function (iframeDocument, prefix) {
    var p = String(prefix || 'pai');
    var state = iframeDocument && iframeDocument.__paiThemeState;
    var out = {};
    if (!state) return out;
    Object.keys(state.owned).forEach(function (k) {
      var v = null;
      try {
        v = iframeDocument.documentElement.style.getPropertyValue(k) || null;
      } catch (e) { /* stub */ }
      out[k] = v != null && v !== '' ? v : state.owned[k];
    });
    return out;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = ThemeInjector;
})();
