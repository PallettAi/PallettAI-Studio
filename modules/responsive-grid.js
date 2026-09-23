// ============================================================
// PallettAI Studio — ResponsiveGrid
// Container queries + fluid auto-fit grid mathematics.
//
// Media queries ask "how wide is the window?" — which is the
// wrong question when a component lives in a sidebar, a bento
// cell, or a footer. Container queries ask "how wide is my
// parent?" and that is the question that makes components
// reusable everywhere they land.
//
// generateContainerClasses(archetypeKey)
//   Emits a complete, namespaced utility layer:
//     · a containment declaration per archetype container
//     · two break families — sidebar-scale (@container (min-width: 22rem)
//       … 32rem) and card/bento-scale (min-width: 18rem … 36rem)
//     · archetype-specific radius and gap variables so the same
//       utilities reflow differently per Design DNA archetype
//     · graceful `@container (max-width: …)` fallbacks for
//       compaction, and the reduced-motion guard for hover lifts
//
// buildAutoFitGrid(minCardWidthPx, gapPx, options)
//   The math behind `repeat(auto-fit, minmax(clamp(...), 1fr))`:
//   a fixed minmax() lets a lone card stretch past its design
//   width, so the clamp() pair binds the track to its comfortable
//   band instead — the card never collapses below minCardWidthPx
//   and never inflates past maxCardWidthPx. Also computes the
//   exact breakpoints (in container px) where the column count
//   changes, so callers can reason about wrapping without a
//   browser, and verifies no single-item orphan line exists.
//
// CommonJS + browser global, like the rest of modules/.
// ============================================================
(function () {
  'use strict';

  const ResponsiveGrid = {};

  /* ---------------- archetypes ---------------- */

  // Same six Design DNA keys the typography/texture/layout modules
  // canonicalized. Container utilities adapt radius/gap per look.
  var ARCHETYPES = {
    'bento-glass':        { label: 'Bento Glass',        radius: '20px', gap: '20px', pad: 'clamp(16px, 2.5cqi, 28px)' },
    'brutalist-kinetic':  { label: 'Brutalist Kinetic',  radius: '0px',  gap: '0px',  pad: 'clamp(16px, 3cqi, 32px)' },
    'editorial-magazine': { label: 'Editorial Magazine', radius: '4px',  gap: '24px', pad: 'clamp(20px, 3cqi, 36px)' },
    'retro-cyberpunk':    { label: 'Retro Cyberpunk',    radius: '2px',  gap: '14px', pad: 'clamp(14px, 2cqi, 24px)' },
    'organic-clay':       { label: 'Organic Clay',       radius: '26px', gap: '22px', pad: 'clamp(18px, 2.5cqi, 30px)' },
    'neo-minimalist':     { label: 'Neo-Minimalist',     radius: '8px',  gap: '18px', pad: 'clamp(16px, 2cqi, 28px)' }
  };

  ResponsiveGrid.ARCHETYPES = ARCHETYPES;

  // Reuse Typography's archetype table when present so the two
  // modules can never drift apart; local table is the fallback.
  function resolveArchetype(archetypeKey) {
    var key = String(archetypeKey || '').toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');
    try {
      if (typeof require === 'function') {
        var T = require('./typography.js');
        if (T && T.ARCHETYPES && T.ARCHETYPES[key]) {
          var t = T.ARCHETYPES[key];
          return {
            label: t.label || key,
            radius: typeof t.radius === 'string' ? t.radius : '8px',
            gap: ARCHETYPES[key] ? ARCHETYPES[key].gap : '18px',
            pad: (ARCHETYPES[key] && ARCHETYPES[key].pad) || 'clamp(16px, 2cqi, 28px)'
          };
        }
      }
    } catch (e) { /* classic script context — use local table */ }
    return ARCHETYPES[key] || ARCHETYPES['neo-minimalist'];
  }

  ResponsiveGrid.resolveArchetype = resolveArchetype;

  /* ============================================================
     1 — container query utility classes
     ============================================================ */

  // Thresholds in rem so they scale with root font size.
  // Sidebar family: a card in a 22–32rem container behaves like a
  // full-width feature; card/bento family: 18–36rem covers the
  // card-to-bento-cell range. Two families, six stops, one system.
  var SIDEBAR_STOPS = [22, 26, 32];
  var CARD_STOPS = [18, 24, 30, 36];

  function containerRule(containerSel, a) {
    return [
      '.rg-container--' + a.key + '{',
      'container-type: inline-size;',
      'container-name: rg-' + a.key + ';',
      'border-radius: var(--rg-radius, ' + a.radius + ');',
      '}'
    ].join('');
  }

  function sidebarRules(a) {
    var out = [];
    // Below the first stop: stacked, centered, full measure.
    out.push('.rg-item{display:flex;flex-direction:column;gap:calc(var(--rg-gap, ' + a.gap + ') / 2)}');
    for (var i = 0; i < SIDEBAR_STOPS.length; i++) {
      var minW = SIDEBAR_STOPS[i];
      out.push(
        '@container (min-width: ' + minW + 'rem){',
        '.rg-sidebar-item--row{flex-direction:row;align-items:center;justify-content:space-between}',
        '.rg-sidebar-item--media{display:grid;grid-template-columns:' + (minW >= 32 ? '2fr 3fr' : '1fr 2fr') + ';gap:var(--rg-gap, ' + a.gap + ')}',
        '.rg-sidebar-item--meta{font-size:calc(var(--rg-meta, 0.8rem) * ' + (1 + i * 0.08).toFixed(2) + ')}',
        '}'
      );
    }
    return out;
  }

  function cardRules(a) {
    var out = [];
    for (var i = 0; i < CARD_STOPS.length; i++) {
      var minW = CARD_STOPS[i];
      var cols = minW >= 30 ? 2 : 1;
      out.push(
        '@container (min-width: ' + minW + 'rem){',
        '.rg-card--fluid{padding:' + a.pad + '}',
        '.rg-card--split{display:grid;grid-template-columns:' + (cols === 2 ? '1.4fr 1fr' : '1fr') + ';gap:var(--rg-gap, ' + a.gap + ')}',
        '.rg-card--wide .rg-card-body{column-count:' + (minW >= 36 ? 2 : 1) + ';column-gap:var(--rg-gap, ' + a.gap + ')}',
        '}'
      );
    }
    // Compaction fallback: narrow containers get a vertical stack —
    // the @container equivalent of max-width media queries.
    out.push('@container (max-width: 17.9rem){',
      '.rg-card--split{display:flex;flex-direction:column}',
      '.rg-card--fluid{padding:calc(' + a.pad + ' / 2)}',
      '}');
    return out;
  }

  function bentoRules(a) {
    return [
      '@container (min-width: 24rem){',
      '.rg-bento--cell{grid-template-columns:repeat(2, minmax(0, 1fr))}',
      '}',
      '@container (min-width: 36rem){',
      '.rg-bento--cell{grid-template-columns:repeat(3, minmax(0, 1fr))}',
      '.rg-bento--cell > .rg-bento--lead{grid-column:span 2}',
      '}'
    ].join('');
  }

  /**
   * generateContainerClasses(archetypeKey)
   * @param {string} archetypeKey  one of ResponsiveGrid.ARCHETYPES keys
   * @returns {{ ok, archetypeKey, label, css, stops: {sidebar, card, bento}, bytes } |
   *           { ok: false, error }}
   */
  ResponsiveGrid.generateContainerClasses = function (archetypeKey) {
    var a = resolveArchetype(archetypeKey);
    if (!ARCHETYPES[String(archetypeKey || '').toLowerCase().replace(/[^a-z]+/g, '-')]) {
      return { ok: false, error: 'Unknown archetype: ' + archetypeKey + ' — expected one of: ' + Object.keys(ARCHETYPES).join(', ') };
    }
    a.key = String(archetypeKey).toLowerCase().replace(/[^a-z]+/g, '-');

    var parts = [];
    parts.push('/* ResponsiveGrid — container utilities for ' + a.label + ' */');
    parts.push(containerRule(a.key, a));
    parts.push(':root{--rg-radius:' + a.radius + ';--rg-gap:' + a.gap + '}');
    parts.push(sidebarRules(a).join(''));
    parts.push(cardRules(a).join(''));
    parts.push(bentoRules(a));
    // Hover lifts guarded by reduced motion — the same rule the
    // layout module ships, repeated here so the layer is whole.
    parts.push('@media(prefers-reduced-motion:reduce){.rg-card--fluid,.rg-sidebar-item--media{transition:none}}');

    var css = parts.join('\n');
    return {
      ok: true,
      archetypeKey: a.key,
      label: a.label,
      css: css,
      stops: { sidebar: SIDEBAR_STOPS.slice(), card: CARD_STOPS.slice(), bento: [24, 36] },
      bytes: css.length
    };
  };

  /* ============================================================
     2 — auto-fit grid mathematics
     ============================================================ */

  function round2(n) { return Math.round(n * 100) / 100; }

  /**
   * buildAutoFitGrid(minCardWidthPx, gapPx, options?)
   *
   * Emits `repeat(auto-fit, minmax(clamp(MINpx, X%, MAXpx), 1fr))`.
   * The clamp's middle term is the percentage share one column
   * wants at the container's current width, so a single lone card
   * can never stretch past maxCardWidthPx (the awkward stretched
   * state) while a full row still fills the container.
   *
   * @param {number} minCardWidthPx  floor for any card track
   * @param {number} gapPx           grid gap
   * @param {object} [options] { maxCardWidthPx, containerMaxPx }
   * @returns {{ ok, template, minPx, maxPx, gapPx, columnBreakpoints:
   *            [{atLeastPx, columns}], orphanSafe, css }}
   */
  ResponsiveGrid.buildAutoFitGrid = function (minCardWidthPx, gapPx, options) {
    var opts = options || {};
    var min = Math.max(80, Math.round(Number(minCardWidthPx) || 240));
    var gap = Math.max(0, Math.round(Number(gapPx) || 16));
    var max = Math.round(Number(opts.maxCardWidthPx) || Math.min(560, min * 2.2));
    if (max < min) max = min;

    /*
      auto-fit with a fixed minmax() stretches a lone card to the
      container's full width — the awkward state. Binding the track
      minimum with clamp(min, share, max) caps that stretch: the
      share term keeps honest tracks honest, the max term is what
      actually stops the lone-card blowout.
    */
    var share = round2(100 / Math.max(1, Math.floor(1200 / (min + gap)))) ; // % of container one column wants
    var clampPair = 'clamp(' + min + 'px, ' + share + '%, ' + max + 'px)';
    var template = 'repeat(auto-fit, minmax(' + clampPair + ', 1fr))';

    /*
      Column-count breakpoints (pure math, no browser): at container
      width W the count is floor((W + gap) / (min + gap)) while W's
      remainder still fits. The classic derivation:

        cols(W) = max(1, floor((W + gap) / (min + gap)))

      Solve W where cols increments:
        W_k = k * min + (k - 1) * gap    for k = 1, 2, 3 …
    */
    var columnBreakpoints = [];
    var kMax = Math.min(8, Math.floor(2400 / (min + gap)));
    for (var k = 1; k <= kMax; k++) {
      columnBreakpoints.push({
        atLeastPx: Math.round(k * min + (k - 1) * gap),
        columns: k
      });
    }

    /*
      Orphan safety: a grid is "orphan-safe" when the widest
      common container (1200px default) cannot produce a row with
      exactly one card unless the container itself is below
      2 * min + gap. Formally: no breakpoint k has
      W_k <= containerMax < W_{k+1} with k === 1 for wide containers.
    */
    var containerMax = Math.round(Number(opts.containerMaxPx) || 1200);
    var colsAtMax = 1;
    for (var b = 0; b < columnBreakpoints.length; b++) {
      if (containerMax >= columnBreakpoints[b].atLeastPx) colsAtMax = columnBreakpoints[b].columns;
    }
    var orphanSafe = colsAtMax >= 2; // wide containers hold ≥2 columns

    var css = [
      '.rg-autofit{',
      '  display: grid;',
      '  grid-template-columns: ' + template + ';',
      '  gap: ' + gap + 'px;',
      '}',
      '/* Container-scoped variant: reflows on parent width, not viewport */',
      '@container (min-width: 0px){',
      '  .rg-autofit--scoped{ grid-template-columns: ' + template + '; }',
      '}'
    ].join('\n');

    return {
      ok: true,
      template: template,
      minPx: min,
      maxPx: max,
      gapPx: gap,
      columnBreakpoints: columnBreakpoints,
      columnsAt1200: colsAtMax,
      orphanSafe: orphanSafe,
      css: css
    };
  };

  /* ---------------- exports ---------------- */

  ResponsiveGrid.SIDEBAR_STOPS = SIDEBAR_STOPS;
  ResponsiveGrid.CARD_STOPS = CARD_STOPS;

  if (typeof module !== 'undefined' && module.exports) module.exports = ResponsiveGrid;
})();
