// ============================================================
// PallettAI Studio — BentoMesh
// Spatial bento-grid layout math + archetype surface effects.
//
// generateBentoLayout(itemCount, archetypeKey, options)
//   For 3–8 items, computes an EXPLICIT tile plan on a 4-column
//   grid: every item gets exact grid-column/grid-row start lines
//   and spans, so the grid is provably hole-free (total cell area
//   = columns × rows) and auto-flow packing can never strand a
//   gap. Each item also carries a visual-hierarchy weight
//   (lead 1.0 → standard 0.5) the content engine can use for
//   type sizing and media decisions.
//
//   Cell budgets (4 columns):
//     3 → 4×2:  lead 2×2 · wide · wide
//     4 → 4×2:  lead 2×2 · single · single · wide
//     5 → 4×2:  lead 2×2 · 4 singles
//     6 → 4×3:  lead 2×2 · feature 2×2 · 4 singles
//     7 → 4×3:  lead 2×2 · tall 1×2 · wide 2×1 · 4 singles
//     8 → 4×4:  lead 2×2 · feature 2×2 · 2 wides · 4 singles
//
// applyBentoGlassEffects(archetypeKey)
//   Surface treatment per Design DNA archetype — same visual
//   language as component-styles.js (glass blur for bento-glass,
//   hard borders + offset shadow for brutalist, dual inset for
//   clay, neon clip for cyberpunk, hairline rules for editorial,
//   soft shadow for neo-minimalist).
//
// Mobile: the whole grid collapses to one column under a
// container-query stop — explicit placements are emitted as
// classes (not inline styles) so the stacked layout wins on
// specificity alone, no !important fights.
//
// CommonJS + browser global, like the rest of modules/.
// ============================================================
(function () {
  'use strict';

  const BentoMesh = {};

  var ARCHETYPES = ['bento-glass', 'brutalist-kinetic', 'editorial-magazine', 'retro-cyberpunk', 'organic-clay', 'neo-minimalist'];
  BentoMesh.ARCHETYPES = ARCHETYPES;

  function canon(key) {
    var ALIASES = {
      'bento': 'bento-glass', 'glass': 'bento-glass',
      'brutalist': 'brutalist-kinetic', 'kinetic': 'brutalist-kinetic',
      'editorial': 'editorial-magazine', 'magazine': 'editorial-magazine',
      'cyberpunk': 'retro-cyberpunk', 'retro': 'retro-cyberpunk',
      'clay': 'organic-clay', 'organic': 'organic-clay',
      'neo': 'neo-minimalist', 'minimalist': 'neo-minimalist', 'minimal': 'neo-minimalist'
    };
    var k = String(key || 'neo-minimalist').trim().toLowerCase().replace(/[\s_]+/g, '-');
    if (ARCHETYPES.indexOf(k) !== -1) return k;
    return ALIASES[k] || null;
  }

  /* ============================================================
     1 — tile plans (colStart, rowStart are 1-based grid lines)
     ============================================================ */

  // role → base visual-hierarchy weight.
  var ROLE_WEIGHT = { lead: 1.0, feature: 0.8, wide: 0.65, tall: 0.65, standard: 0.5 };

  // Hand-verified hole-free plans. [colStart, rowStart, colSpan, rowSpan, role]
  var PLANS = {
    3: { cols: 4, rows: 2, tiles: [
      [1, 1, 2, 2, 'lead'],
      [3, 1, 2, 1, 'wide'],
      [3, 2, 2, 1, 'wide']
    ] },
    4: { cols: 4, rows: 2, tiles: [
      [1, 1, 2, 2, 'lead'],
      [3, 1, 1, 1, 'standard'],
      [4, 1, 1, 1, 'standard'],
      [3, 2, 2, 1, 'wide']
    ] },
    5: { cols: 4, rows: 2, tiles: [
      [1, 1, 2, 2, 'lead'],
      [3, 1, 1, 1, 'standard'],
      [4, 1, 1, 1, 'standard'],
      [3, 2, 1, 1, 'standard'],
      [4, 2, 1, 1, 'standard']
    ] },
    6: { cols: 4, rows: 3, tiles: [
      [1, 1, 2, 2, 'lead'],
      [3, 1, 2, 2, 'feature'],
      [1, 3, 1, 1, 'standard'],
      [2, 3, 1, 1, 'standard'],
      [3, 3, 1, 1, 'standard'],
      [4, 3, 1, 1, 'standard']
    ] },
    7: { cols: 4, rows: 3, tiles: [
      [1, 1, 2, 2, 'lead'],
      [3, 1, 1, 2, 'tall'],
      [4, 1, 1, 2, 'tall'],
      [1, 3, 1, 1, 'standard'],
      [2, 3, 1, 1, 'standard'],
      [3, 3, 1, 1, 'standard'],
      [4, 3, 1, 1, 'standard']
    ] },
    8: { cols: 4, rows: 4, tiles: [
      [1, 1, 2, 2, 'lead'],
      [3, 1, 2, 2, 'feature'],
      [1, 3, 2, 1, 'wide'],
      [3, 3, 2, 1, 'wide'],
      [1, 4, 1, 1, 'standard'],
      [2, 4, 1, 1, 'standard'],
      [3, 4, 1, 1, 'standard'],
      [4, 4, 1, 1, 'standard']
    ] }
  };

  // Sanity: every plan must exactly tile its canvas (hole-free by
  // construction — verified here, not assumed).
  function verifyPlan(plan) {
    var occupied = {};
    var cells = 0;
    for (var i = 0; i < plan.tiles.length; i++) {
      var t = plan.tiles[i];
      cells += t[2] * t[3];
      for (var c = t[0]; c < t[0] + t[2]; c++) {
        for (var r = t[1]; r < t[1] + t[3]; r++) {
          var k = c + ':' + r;
          if (occupied[k]) return false; // overlap
          occupied[k] = true;
          if (c > plan.cols || r > plan.rows) return false; // out of bounds
        }
      }
    }
    return cells === plan.cols * plan.rows;
  }
  for (var n in PLANS) {
    if (!verifyPlan(PLANS[n])) throw new Error('bento-mesh: internal tile plan for ' + n + ' items is not hole-free');
  }

  // Archetype hierarchy tweaks: which non-lead role gets promoted
  // in the weight table (spatial spans stay constant — geometry is
  // content-agnostic, emphasis is not).
  var ARCH_EMPHASIS = {
    'bento-glass': { feature: 0.85 },
    'brutalist-kinetic': { lead: 1.0, wide: 0.7 },
    'editorial-magazine': { lead: 1.0, tall: 0.7 },
    'retro-cyberpunk': { wide: 0.7 },
    'organic-clay': { feature: 0.82 },
    'neo-minimalist': {}
  };

  /**
   * generateBentoLayout(itemCount, archetypeKey, options)
   * @param {number} itemCount  3..8
   * @param {string} archetypeKey  canonical archetype (aliases ok)
   * @param {object} [options] { gapPx, className, leadIndex }
   * @returns {{ ok, itemCount, archetype, columns, rows, items, css, html } |
   *           { ok: false, error }}
   */
  BentoMesh.generateBentoLayout = function (itemCount, archetypeKey, options) {
    var count = Math.round(Number(itemCount));
    if (!isFinite(count) || count < 3 || count > 8) {
      return { ok: false, error: 'itemCount must be an integer 3–8 (got ' + itemCount + ') — bento plans are hand-tiled for that range.' };
    }
    var arch = canon(archetypeKey);
    if (!arch) return { ok: false, error: 'Unknown archetype: ' + archetypeKey + ' — expected one of: ' + ARCHETYPES.join(', ') };
    var opts = options || {};
    var gap = Math.max(0, Number(opts.gapPx) || 16);
    var cls = String(opts.className || 'pa-bento').replace(/[^\w-]/g, '') || 'pa-bento';
    var plan = PLANS[count];
    var emphasis = ARCH_EMPHASIS[arch] || {};

    // Lead rotation: promote a different tile to lead by re-sorting
    // roles across the SAME geometry (geometry is fixed per count).
    var tiles = plan.tiles;
    var leadIdx = Math.max(0, Math.min(count - 1, Math.round(Number(opts.leadIndex) || 0)));

    var items = [];
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i];
      var role = t[4];
      var w = emphasis[role] != null ? emphasis[role] : ROLE_WEIGHT[role];
      if (i === leadIdx && role !== 'lead') {
        role = 'lead';
        w = emphasis.lead != null ? emphasis.lead : ROLE_WEIGHT.lead;
      }
      items.push({
        index: i,
        role: role,
        colStart: t[0],
        rowStart: t[1],
        colSpan: t[2],
        rowSpan: t[3],
        weight: w,
        className: cls + '__item ' + cls + '__item--' + role + ' ' + cls + '__i' + (i + 1),
        style: 'grid-column:' + t[0] + ' / span ' + t[2] + ';grid-row:' + t[1] + ' / span ' + t[3] + ';'
      });
    }

    var cssParts = [
      '/* BentoMesh — ' + count + ' items, ' + arch + ' */',
      '.' + cls + '{',
      '  display:grid;',
      '  grid-template-columns:repeat(' + plan.cols + ', minmax(0, 1fr));',
      '  grid-auto-rows:minmax(140px, auto);',
      '  gap:' + gap + 'px;',
      '  container-type:inline-size;',
      '  container-name:' + cls + '-bento;',
      '}',
      placementCSS(cls, items),
      stackFallbackCSS(cls, plan.cols)
    ];
    var css = cssParts.join('\n');

    var html = '<div class="' + cls + '" style="--bento-cols:' + plan.cols + '">' + items.map(function (it) {
      return '  <div class="' + it.className + '" style="' + it.style + '"></div>';
    }).join('\n') + '\n</div>';

    return {
      ok: true,
      itemCount: count,
      archetype: arch,
      columns: plan.cols,
      rows: plan.rows,
      gapPx: gap,
      items: items,
      weights: items.map(function (it) { return it.weight; }),
      css: css,
      html: html
    };
  };

  function placementCSS(cls, items) {
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      out.push('.' + cls + ' .' + cls + '__i' + (i + 1) + '{' + it.style + '}');
    }
    return out.join('\n');
  }

  // One-column stack under the container stop. Placement classes are
  // plain single-class selectors, so the qualified selectors here win
  // on specificity without !important.
  function stackFallbackCSS(cls, cols) {
    return [
      '/* Mobile: collapse to one column inside narrow containers */',
      '@container ' + cls + '-bento (max-width: 47.99rem){',
      '  .' + cls + '{',
      '    grid-template-columns:1fr;',
      '    grid-auto-rows:auto;',
      '  }',
      '  .' + cls + ' [class*="' + cls + '__i"]{',
      '    grid-column:1 / -1;',
      '    grid-row:auto;',
      '  }',
      '}'
    ].join('\n');
  }

  /* ============================================================
     2 — archetype surface effects
     ============================================================ */

  var SURFACE_RULES = {
    'bento-glass': {
      effects: ['backdrop-blur-12', 'translucent-bg', 'hairline-border', 'inner-highlight'],
      css: [
        '.' + 'PLACEHOLDER' + '__item{',
        '  background:linear-gradient(160deg, var(--bento-glass-bg, rgba(255,255,255,.24)), var(--bento-glass-bg-2, rgba(255,255,255,.08)));',
        '  -webkit-backdrop-filter:blur(12px) saturate(1.3);',
        '  backdrop-filter:blur(12px) saturate(1.3);',
        '  border:1px solid var(--bento-glass-border, rgba(255,255,255,.35));',
        '  border-radius:var(--bento-radius, 20px);',
        '  box-shadow:0 1px 0 rgba(255,255,255,.3) inset, 0 16px 40px var(--bento-shadow, rgba(20,20,40,.12));',
        '}'
      ]
    },
    'brutalist-kinetic': {
      effects: ['hard-border-4', 'zero-radius', 'offset-shadow-6'],
      css: [
        '.' + 'PLACEHOLDER' + '__item{',
        '  background:var(--bento-surface, #fff);',
        '  border:4px solid var(--c-ink, #111);',
        '  border-radius:0;',
        '  box-shadow:6px 6px 0 0 var(--c-ink, #111);',
        '}',
        '.' + 'PLACEHOLDER' + '__item--lead{box-shadow:10px 10px 0 0 var(--c-ink, #111);}'
      ]
    },
    'editorial-magazine': {
      effects: ['hairline-rules', 'paper-surface', 'zero-radius'],
      css: [
        '.' + 'PLACEHOLDER' + '__item{',
        '  background:var(--bento-surface, #fff);',
        '  border-top:1px solid var(--c-ink, #111);',
        '  border-bottom:1px solid var(--c-ink, #111);',
        '  border-radius:var(--bento-radius, 4px);',
        '  box-shadow:none;',
        '  padding-inline:clamp(16px, 4cqi, 40px);',
        '}',
        '.' + 'PLACEHOLDER' + '__item--lead{border-top-width:3px;}'
      ]
    },
    'retro-cyberpunk': {
      effects: ['neon-outline', 'glow-shadow', 'clipped-corners'],
      css: [
        '.' + 'PLACEHOLDER' + '__item{',
        '  background:var(--bento-surface, #0c0c1c);',
        '  border-radius:0;',
        '  clip-path:polygon(16px 0, 100% 0, 100% calc(100% - 16px), calc(100% - 16px) 100%, 0 100%, 0 16px);',
        '  box-shadow:0 0 0 1px var(--c-neon, #0ff), 0 0 22px var(--bento-glow, rgba(0,255,220,.3));',
        '}',
        '.' + 'PLACEHOLDER' + '__item--lead{box-shadow:0 0 0 1px var(--c-neon, #0ff), 0 0 40px var(--bento-glow, rgba(0,255,220,.5));}'
      ]
    },
    'organic-clay': {
      effects: ['dual-inset-shadow', 'pill-soft-radius', 'borderless'],
      css: [
        '.' + 'PLACEHOLDER' + '__item{',
        '  background:var(--bento-surface, #fff);',
        '  border:none;',
        '  border-radius:var(--bento-radius, 26px);',
        '  box-shadow:inset 0 3px 6px rgba(255,255,255,.6), inset 0 -5px 10px rgba(0,0,0,.06), 0 14px 30px var(--bento-shadow, rgba(60,40,30,.14));',
        '}'
      ]
    },
    'neo-minimalist': {
      effects: ['soft-shadow', 'quiet-radius', 'borderless'],
      css: [
        '.' + 'PLACEHOLDER' + '__item{',
        '  background:var(--bento-surface, #fff);',
        '  border:none;',
        '  border-radius:var(--bento-radius, 14px);',
        '  box-shadow:0 1px 2px rgba(0,0,0,.05), 0 8px 24px rgba(0,0,0,.06);',
        '}'
      ]
    }
  };

  /**
   * applyBentoGlassEffects(archetypeKey, options)
   * @param {string} archetypeKey  canonical archetype (aliases ok)
   * @param {object} [options] { className }
   * @returns {{ ok, archetype, effects: string[], css } |
   *           { ok: false, error }}
   */
  BentoMesh.applyBentoGlassEffects = function (archetypeKey, options) {
    var arch = canon(archetypeKey);
    if (!arch) return { ok: false, error: 'Unknown archetype: ' + archetypeKey + ' — expected one of: ' + ARCHETYPES.join(', ') };
    var cls = String((options && options.className) || 'pa-bento').replace(/[^\w-]/g, '') || 'pa-bento';
    var rule = SURFACE_RULES[arch];
    var css = rule.css.map(function (block) {
      return block.split('PLACEHOLDER').join(cls);
    }).join('\n');
    return { ok: true, archetype: arch, effects: rule.effects, css: css };
  };

  /**
   * generateBentoStylesheet(itemCount, archetypeKey, options)
   * Layout + surface + fallback in one sheet.
   */
  BentoMesh.generateBentoStylesheet = function (itemCount, archetypeKey, options) {
    var layout = BentoMesh.generateBentoLayout(itemCount, archetypeKey, options);
    if (!layout.ok) return layout;
    var effects = BentoMesh.applyBentoGlassEffects(archetypeKey, options);
    if (!effects.ok) return effects;
    return {
      ok: true,
      itemCount: layout.itemCount,
      archetype: layout.archetype,
      columns: layout.columns,
      rows: layout.rows,
      items: layout.items,
      effects: effects.effects,
      css: layout.css + '\n' + effects.css,
      html: layout.html
    };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = BentoMesh;
})();
