// ============================================================
// PallettAI Studio — FontKinetic
// Variable-font physics + kinetic editorial typography.
//
// generateVariableFontCSS(fontFamily, axisConfig)
//   Emits an @font-face weight/stretch range plus a `.pa-vf`
//   class whose font-variation-settings interpolate smoothly on
//   hover (the axis LIST stays identical between states, which
//   is what makes font-variation-settings animatable), and a
//   scroll-driven variant behind @supports (animation-timeline).
//   Zero dependencies, no JS at runtime.
//
// generateKineticTextKeyframes(effectType, options)
//   kinetic-pulse      weight breathing 'wght' 300 → 700 → 300
//   kinetic-marquee    infinite translateX loop (-50% seam trick),
//                      duration via --marquee-duration
//   editorial-dropcap  ::first-letter initial with a per-archetype
//                      border treatment (6 archetypes)
//
// Every animated output carries a prefers-reduced-motion guard.
// CommonJS + browser global, like the rest of modules/.
// ============================================================
(function () {
  'use strict';

  const FontKinetic = {};

  var ARCHETYPES = [
    'bento-glass',
    'brutalist-kinetic',
    'editorial-magazine',
    'retro-cyberpunk',
    'organic-clay',
    'neo-minimalist'
  ];
  FontKinetic.ARCHETYPES = ARCHETYPES;

  var KINETIC_EFFECTS = ['kinetic-pulse', 'kinetic-marquee', 'editorial-dropcap'];
  FontKinetic.KINETIC_EFFECTS = KINETIC_EFFECTS;

  function canonArchetype(key) {
    var ALIASES = {
      'bento': 'bento-glass', 'glass': 'bento-glass',
      'brutalist': 'brutalist-kinetic', 'kinetic': 'brutalist-kinetic',
      'editorial': 'editorial-magazine', 'magazine': 'editorial-magazine',
      'cyberpunk': 'retro-cyberpunk', 'retro': 'retro-cyberpunk',
      'clay': 'organic-clay', 'organic': 'organic-clay',
      'neo': 'neo-minimalist', 'minimalist': 'neo-minimalist', 'minimal': 'neo-minimalist'
    };
    var k = String(key || 'editorial-magazine').trim().toLowerCase().replace(/[\s_]+/g, '-');
    if (ARCHETYPES.indexOf(k) !== -1) return k;
    return ALIASES[k] || null;
  }

  // CSS-ident escape for a font family name inside quotes.
  function fam(name) {
    var s = String(name || '').trim();
    return s.replace(/\\/g, '').replace(/"/g, '') || 'sans-serif';
  }

  // Axis tags are exactly 4 characters per the OpenType spec.
  function validAxisTag(tag) {
    return /^[A-Za-z0-9]{4}$/.test(String(tag || ''));
  }

  function num(v, fallback) {
    var n = Number(v);
    return isFinite(n) ? n : fallback;
  }

  /* ============================================================
     1 — variable font CSS
     ============================================================ */

  /**
   * generateVariableFontCSS(fontFamily, axisConfig)
   * @param {string} fontFamily  e.g. 'Inter'
   * @param {object} [axisConfig]
   *   axes        { wght:{min,max,default}, wdth:{...}, ... } — 4-char tags
   *   hover       { wght: 650, ... } target values on hover
   *   transitionMs  number (default 280)
   *   easing      string (default 'cubic-bezier(.4,0,.2,1)')
   *   scrollDriven  boolean — also emit .pa-vf--scroll (Chromium @supports)
   *   fontWeight    number|'auto' — static @font-face weight if no wght range
   *   fallbacks     array of fallback family names (default sans-serif chain)
   * @returns {{ ok, fontFamily, css, classes, axes, weightRange, stretchRange, skippedAxes } |
   *           { ok: false, error }}
   */
  FontKinetic.generateVariableFontCSS = function (fontFamily, axisConfig) {
    if (!fontFamily || !String(fontFamily).trim()) {
      return { ok: false, error: 'fontFamily is required.' };
    }
    var cfg = axisConfig || {};
    var family = fam(fontFamily);
    var fallbacks = Array.isArray(cfg.fallbacks) && cfg.fallbacks.length
      ? cfg.fallbacks.map(fam).join(', ')
      : 'ui-sans-serif, system-ui, sans-serif';

    // Normalise + validate axes (registration order preserved).
    var axes = [];           // [{ tag, min, max, def }]
    var skipped = [];
    var raw = cfg.axes || {};
    Object.keys(raw).forEach(function (tag) {
      if (!validAxisTag(tag)) { skipped.push(tag); return; }
      var a = raw[tag] || {};
      var min = a.min != null ? num(a.min, 0) : null;
      var max = a.max != null ? num(a.max, min != null ? min + 100 : 100) : null;
      var def = num(a.default != null ? a.default : a.def, min != null ? min : 100);
      if (min != null && max != null && def < min) def = min;
      if (min != null && max != null && def > max) def = max;
      axes.push({ tag: tag, min: min, max: max, def: def });
    });
    if (!axes.length && cfg.fontWeight == null) {
      return { ok: false, error: 'axisConfig needs at least one valid 4-char axis (e.g. wght) or a fontWeight.' };
    }

    var hover = cfg.hover || {};
    var transitionMs = Math.max(0, num(cfg.transitionMs, 280));
    var easing = String(cfg.easing || 'cubic-bezier(.4,0,.2,1)');

    var settings = function (values) {
      return axes.map(function (a) {
        return "'" + a.tag + "' " + (values[a.tag] != null ? num(values[a.tag], a.def) : a.def);
      }).join(', ');
    };
    var baseVals = {}, hoverVals = {};
    axes.forEach(function (a) { baseVals[a.tag] = a.def; });
    axes.forEach(function (a) {
      hoverVals[a.tag] = hover[a.tag] != null ? num(hover[a.tag], a.def) : a.def;
    });

    // @font-face ranges.
    var wght = null, wdth = null;
    axes.forEach(function (a) {
      if (a.tag === 'wght' && a.min != null && a.max != null) wght = { min: a.min, max: a.max };
      if (a.tag === 'wdth' && a.min != null && a.max != null) wdth = { min: a.min, max: a.max };
    });

    var out = [];
    out.push('/* PallettAI variable font — ' + family + ' */');
    out.push('@font-face {');
    out.push('  font-family: "' + family + '";');
    out.push('  src: local("' + family + '"), local("' + family + '-Variable");');
    if (wght) out.push('  font-weight: ' + wght.min + ' ' + wght.max + ';');
    else if (cfg.fontWeight != null) out.push('  font-weight: ' + num(cfg.fontWeight, 400) + ';');
    if (wdth) out.push('  font-stretch: ' + wdth.min + '% ' + wdth.max + '%;');
    out.push('  font-display: swap;');
    out.push('}');
    out.push('.pa-vf {');
    out.push('  font-family: "' + family + '", ' + fallbacks + ';');
    out.push('  font-variation-settings: ' + settings(baseVals) + ';');
    if (axes.length) {
      out.push('  transition: font-variation-settings ' + transitionMs + 'ms ' + easing + ';');
      out.push('  will-change: font-variation-settings;');
    }
    out.push('}');
    if (axes.length) {
      var hoverChanged = axes.some(function (a) { return hoverVals[a.tag] !== baseVals[a.tag]; });
      if (hoverChanged) {
        out.push('.pa-vf:hover {');
        out.push('  font-variation-settings: ' + settings(hoverVals) + ';');
        out.push('}');
      }
    }
    if (cfg.scrollDriven && axes.length) {
      out.push('@supports (animation-timeline: scroll()) {');
      out.push('  @keyframes pa-vf-scroll {');
      out.push('    from { font-variation-settings: ' + settings(baseVals) + '; }');
      out.push('    to   { font-variation-settings: ' + settings(hoverChanged ? hoverVals : baseVals) + '; }');
      out.push('  }');
      out.push('  .pa-vf--scroll {');
      out.push('    transition: none;');
      out.push('    animation: pa-vf-scroll linear both;');
      out.push('    animation-timeline: scroll();');
      out.push('  }');
      out.push('}');
    }
    out.push('@media (prefers-reduced-motion: reduce) {');
    out.push('  .pa-vf { transition: none; }');
    out.push('  .pa-vf--scroll { animation: none; }');
    out.push('}');

    var classes = ['pa-vf'];
    if (cfg.scrollDriven && axes.length) classes.push('pa-vf--scroll');

    return {
      ok: true,
      fontFamily: family,
      css: out.join('\n'),
      classes: classes,
      axes: axes.map(function (a) { return a.tag; }),
      weightRange: wght ? (wght.min + ' ' + wght.max) : (cfg.fontWeight != null ? String(num(cfg.fontWeight, 400)) : null),
      stretchRange: wdth ? (wdth.min + '% ' + wdth.max + '%') : null,
      skippedAxes: skipped
    };
  };

  /* ============================================================
     2 — kinetic text keyframes
     ============================================================ */

  var REDUCED = '@media (prefers-reduced-motion: reduce) {\n  __SELECTORS__ { animation: none; }\n}';

  function buildPulse() {
    var css = [
      '/* kinetic-pulse — weight breathing 300 → 700 → 300 */',
      '@keyframes pa-kinetic-pulse {',
      '  0%, 100% { font-variation-settings: "wght" 300; }',
      '  50%      { font-variation-settings: "wght" 700; }',
      '}',
      '.pa-kinetic--pulse {',
      '  font-variation-settings: "wght" 300;',
      '  animation: pa-kinetic-pulse 2.4s ease-in-out infinite;',
      '  will-change: font-variation-settings;',
      '}',
      '.pa-kinetic--pulse-slow { animation-duration: 4.2s; }'
    ].join('\n');
    return {
      ok: true,
      effectType: 'kinetic-pulse',
      css: css + '\n' + REDUCED.replace('__SELECTORS__', '.pa-kinetic--pulse, .pa-kinetic--pulse-slow'),
      className: 'pa-kinetic--pulse',
      keyframes: ['pa-kinetic-pulse']
    };
  }

  function buildMarquee(opts) {
    var dur = Math.max(4, num(opts.durationSec, 24));
    var css = [
      '/* kinetic-marquee — infinite scroll; duplicate the content once',
      '   inside .pa-marquee__track so the -50% loop is seamless:',
      '   <div class="pa-marquee"><div class="pa-marquee__track">',
      '     <span>TEXT</span><span aria-hidden="true">TEXT</span>',
      '   </div></div> */',
      '@keyframes pa-kinetic-marquee {',
      '  from { transform: translateX(0); }',
      '  to   { transform: translateX(-50%); }',
      '}',
      '.pa-marquee {',
      '  overflow: hidden;',
      '  white-space: nowrap;',
      '  --marquee-duration: ' + dur + 's;',
      '}',
      '.pa-marquee__track {',
      '  display: inline-flex;',
      '  gap: var(--marquee-gap, 2.5rem);',
      '  padding-right: var(--marquee-gap, 2.5rem);',
      '  will-change: transform;',
      '  animation: pa-kinetic-marquee var(--marquee-duration) linear infinite;',
      '}',
      '.pa-marquee:hover .pa-marquee__track { animation-play-state: paused; }'
    ].join('\n');
    return {
      ok: true,
      effectType: 'kinetic-marquee',
      css: css + '\n' + REDUCED.replace('__SELECTORS__', '.pa-marquee__track'),
      className: 'pa-marquee',
      keyframes: ['pa-kinetic-marquee']
    };
  }

  // ::first-letter treatments per archetype. Base class positions
  // the initial; the archetype modifier dresses it.
  var DROPCAP_TREATMENTS = {
    'editorial-magazine': [
      '  font-family: var(--font-serif, Georgia, serif);',
      '  font-weight: 600;',
      '  color: var(--c-ink, #111);',
      '  border-bottom: 3px double var(--c-primary, #111);',
      '  border-radius: 0;'
    ],
    'brutalist-kinetic': [
      '  font-family: var(--font-mono, ui-monospace, monospace);',
      '  font-weight: 800;',
      '  background: var(--c-primary);',
      '  color: var(--on-primary, #fff);',
      '  border: 4px solid var(--c-ink, #111);',
      '  border-radius: 0;',
      '  padding: .02em .14em .0em .1em;'
    ],
    'bento-glass': [
      '  font-weight: 650;',
      '  background: var(--c-glass-bg, rgba(255,255,255,.28));',
      '  -webkit-backdrop-filter: blur(12px);',
      '  backdrop-filter: blur(12px);',
      '  border: 1px solid var(--c-glass-border, rgba(255,255,255,.4));',
      '  border-radius: 14px;',
      '  padding: .04em .16em .0em .12em;'
    ],
    'organic-clay': [
      '  font-weight: 700;',
      '  background: var(--c-surface-2, #eee);',
      '  color: var(--c-ink, #333);',
      '  border-radius: 22px;',
      '  padding: .06em .2em .02em .16em;',
      '  box-shadow: inset 0 2px 3px rgba(255,255,255,.5), inset 0 -3px 5px rgba(0,0,0,.16);'
    ],
    'retro-cyberpunk': [
      '  font-family: var(--font-mono, ui-monospace, monospace);',
      '  font-weight: 700;',
      '  color: var(--c-neon, #0ff);',
      '  text-shadow: 0 0 8px var(--c-neon-glow, rgba(0,255,220,.85));',
      '  border-radius: 0;',
      '  clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px);',
      '  padding: .02em .18em .0em .12em;'
    ],
    'neo-minimalist': [
      '  font-weight: 700;',
      '  color: var(--c-primary, #111);',
      '  border-radius: 0;',
      '  box-shadow: 0 2px 0 0 var(--c-ink, #111);',
      '  padding: 0 .04em;'
    ]
  };

  function buildDropcap(opts) {
    var arch = canonArchetype(opts.archetypeKey);
    if (!arch) {
      return { ok: false, error: 'Unknown archetype: ' + opts.archetypeKey + ' — expected one of: ' + ARCHETYPES.join(', ') };
    }
    var size = num(opts.sizeEm, 3.2);
    var lines = [
      '/* editorial-dropcap — ' + arch + ' treatment */',
      '.pa-dropcap::first-letter {',
      '  float: left;',
      '  font-size: ' + size + 'em;',
      '  line-height: .82;',
      '  padding: .05em .14em .02em .1em;',
      '  margin: .04em .14em 0 0;'
    ].concat(DROPCAP_TREATMENTS[arch], ['}']).join('\n');
    return {
      ok: true,
      effectType: 'editorial-dropcap',
      css: lines,
      className: 'pa-dropcap pa-dropcap--' + arch,
      archetype: arch,
      keyframes: []
    };
  }

  /**
   * generateKineticTextKeyframes(effectType, options)
   * @param {string} effectType  'kinetic-pulse' | 'kinetic-marquee' | 'editorial-dropcap'
   * @param {object} [options]
   *   archetypeKey  for editorial-dropcap (default editorial-magazine)
   *   durationSec   for kinetic-marquee (default 24)
   *   sizeEm        for editorial-dropcap (default 3.2)
   * @returns {{ ok, effectType, css, className, keyframes, [archetype] } |
   *           { ok: false, error }}
   */
  FontKinetic.generateKineticTextKeyframes = function (effectType, options) {
    var opts = options || {};
    switch (effectType) {
      case 'kinetic-pulse': return buildPulse();
      case 'kinetic-marquee': return buildMarquee(opts);
      case 'editorial-dropcap': return buildDropcap(opts);
      default:
        return { ok: false, error: 'Unknown effectType: ' + effectType + ' — expected one of: ' + KINETIC_EFFECTS.join(', ') };
    }
  };

  /**
   * generateKineticStylesheet(options)
   * All three kinetic effects in one sheet; dropcap defaults to
   * editorial-magazine unless options.archetypeKey says otherwise.
   */
  FontKinetic.generateKineticStylesheet = function (options) {
    var opts = options || {};
    var parts = [
      FontKinetic.generateKineticTextKeyframes('kinetic-pulse'),
      FontKinetic.generateKineticTextKeyframes('kinetic-marquee', opts),
      FontKinetic.generateKineticTextKeyframes('editorial-dropcap', opts)
    ];
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i].ok) return parts[i];
    }
    return {
      ok: true,
      css: parts.map(function (p) { return p.css; }).join('\n\n'),
      classNames: parts.map(function (p) { return p.className; })
    };
  };

  /* ---------------- exports ---------------- */

  FontKinetic.canonicalArchetype = canonArchetype;

  if (typeof module !== 'undefined' && module.exports) module.exports = FontKinetic;
})();
