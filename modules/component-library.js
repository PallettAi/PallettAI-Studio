// ============================================================
// PallettAI Studio — ComponentLibrary
// Scoped CSS for complex interactive components, per archetype.
//
// generateComponentTokens(componentType, archetypeKey) emits a
// complete rule set (class block + scoped custom properties) for:
//
//   accordion / modal      transitions, backdrop-filter, radii
//   tabs / segmented       gliding active indicator, focus rings
//   tooltip / dropdown     floating elevation, arrow geometry,
//                          popover backdrop blur
//   input / switch         custom check affordances, focus
//                          outlines, invalid "error glow" states
//
// The gliding indicator is CSS-only: position derives from two
// custom properties the host sets (--pai-tabs-active index and
// --pai-tabs-count), so it animates without layout thrash.
//
// Every archetype shares the six token families Studio already
// emits (--c-primary/--c-surface/--c-ink/...) — no literals.
// CommonJS + browser global, like the rest of modules/.
// ============================================================
(function () {
  'use strict';

  const ComponentLibrary = {};

  const ARCHETYPES = [
    'bento-glass',
    'brutalist-kinetic',
    'editorial-magazine',
    'retro-cyberpunk',
    'organic-clay',
    'neo-minimalist'
  ];
  ComponentLibrary.ARCHETYPES = ARCHETYPES;

  const COMPONENT_TYPES = [
    'accordion', 'modal', 'tabs', 'segmented',
    'tooltip', 'dropdown', 'input', 'switch'
  ];
  ComponentLibrary.COMPONENT_TYPES = COMPONENT_TYPES;

  const ALIASES = {
    'bento': 'bento-glass', 'glass': 'bento-glass',
    'brutalist': 'brutalist-kinetic', 'kinetic': 'brutalist-kinetic',
    'editorial': 'editorial-magazine', 'magazine': 'editorial-magazine',
    'cyberpunk': 'retro-cyberpunk', 'retro': 'retro-cyberpunk',
    'clay': 'organic-clay', 'organic': 'organic-clay',
    'neo': 'neo-minimalist', 'minimalist': 'neo-minimalist',
    'minimal': 'neo-minimalist'
  };

  function canonArchetype(key) {
    var k = String(key || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
    if (ARCHETYPES.indexOf(k) !== -1) return k;
    if (ALIASES[k]) return ALIASES[k];
    return null;
  }

  function canonComponent(type) {
    var t = String(type || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
    if (COMPONENT_TYPES.indexOf(t) !== -1) return t;
    var map = { 'form-input': 'input', 'field': 'input', 'toggle': 'switch', 'segment': 'segmented', 'popover': 'tooltip', 'menu': 'dropdown', 'dialog': 'modal' };
    return map[t] || null;
  }

  /* ------------------------------------------------------------
   * Archetype physics. One coherent spec drives every component.
   * ---------------------------------------------------------- */
  const INK = 'var(--c-ink, #111318)';
  const SURF = 'var(--c-surface, #ffffff)';
  const PRIM = 'var(--c-primary, #2f5fe0)';
  const DANGER = 'var(--c-danger, #d43a3a)';

  var SPEC = {
    'brutalist-kinetic': {
      label: 'Brutalist Kinetic',
      radius: '0px', radiusPill: '0px',
      border: '3px solid ' + INK,
      borderWeak: '3px solid ' + INK,
      ring: '0 0 0 3px ' + SURF + ', 0 0 0 6px ' + INK,
      elevation: '6px 6px 0 0 ' + INK,
      elevationHover: '2px 2px 0 0 ' + INK,
      indicatorShadow: '3px 3px 0 0 ' + INK,
      blur: 'none', backdropTint: SURF,
      transition: 'transform 80ms steps(2, end), box-shadow 80ms steps(2, end)',
      transitionFast: 'none',
      font: 'ui-monospace, "JetBrains Mono", "SF Mono", monospace',
      uppercase: true, tracking: '0.06em',
      invalidGlow: '0 0 0 3px ' + DANGER,
      arrowShape: 'square', clip: 'none'
    },
    'bento-glass': {
      label: 'Bento Glass',
      radius: '16px', radiusPill: '9999px',
      border: '1px solid color-mix(in oklab, ' + INK + ' 14%, transparent)',
      borderWeak: '1px solid color-mix(in oklab, ' + INK + ' 10%, transparent)',
      ring: '0 0 0 2px ' + SURF + ', 0 0 0 4px color-mix(in oklab, ' + PRIM + ' 65%, transparent)',
      elevation: '0 12px 32px -8px rgb(16 20 34 / 0.28), 0 2px 8px rgb(16 20 34 / 0.12)',
      elevationHover: '0 16px 40px -8px rgb(16 20 34 / 0.34), 0 3px 10px rgb(16 20 34 / 0.14)',
      indicatorShadow: '0 2px 8px rgb(16 20 34 / 0.18)',
      blur: 'blur(12px) saturate(1.4)', backdropTint: 'color-mix(in oklab, ' + SURF + ' 62%, transparent)',
      transition: 'box-shadow 220ms cubic-bezier(0.2, 0.7, 0.3, 1), transform 220ms cubic-bezier(0.2, 0.7, 0.3, 1)',
      transitionFast: 'opacity 160ms ease, transform 160ms ease',
      font: '"Inter", system-ui, sans-serif',
      uppercase: false, tracking: '0',
      invalidGlow: '0 0 0 3px color-mix(in oklab, ' + DANGER + ' 30%, transparent)',
      arrowShape: 'rounded', clip: 'none'
    },
    'organic-clay': {
      label: 'Organic Clay',
      radius: '24px', radiusPill: '9999px',
      border: '1px solid color-mix(in oklab, ' + INK + ' 8%, transparent)',
      borderWeak: '1px solid color-mix(in oklab, ' + INK + ' 6%, transparent)',
      ring: '0 0 0 3px color-mix(in oklab, ' + PRIM + ' 40%, transparent)',
      elevation: '0 10px 24px -6px rgb(60 42 30 / 0.22), inset 0 2px 3px rgb(255 255 255 / 0.65), inset 0 -3px 5px rgb(60 42 30 / 0.12)',
      elevationHover: '0 14px 30px -6px rgb(60 42 30 / 0.28), inset 0 2px 3px rgb(255 255 255 / 0.65), inset 0 -3px 5px rgb(60 42 30 / 0.12)',
      indicatorShadow: 'inset 0 2px 3px rgb(255 255 255 / 0.7), 0 3px 6px rgb(60 42 30 / 0.2)',
      blur: 'blur(6px)', backdropTint: 'color-mix(in oklab, ' + SURF + ' 80%, transparent)',
      transition: 'box-shadow 260ms cubic-bezier(0.34, 1.4, 0.44, 1), transform 260ms cubic-bezier(0.34, 1.4, 0.44, 1)',
      transitionFast: 'opacity 200ms ease, transform 200ms cubic-bezier(0.34, 1.4, 0.44, 1)',
      font: '"Nunito", "Avenir Next", system-ui, sans-serif',
      uppercase: false, tracking: '0.01em',
      invalidGlow: '0 0 0 4px color-mix(in oklab, ' + DANGER + ' 22%, transparent)',
      arrowShape: 'blob', clip: 'none'
    },
    'editorial-magazine': {
      label: 'Editorial Magazine',
      radius: '2px', radiusPill: '2px',
      border: '1px solid ' + INK,
      borderWeak: '1px solid color-mix(in oklab, ' + INK + ' 35%, transparent)',
      ring: '0 0 0 2px ' + SURF + ', 0 0 0 3px ' + INK,
      elevation: '0 6px 18px -6px rgb(20 18 14 / 0.30)',
      elevationHover: '0 10px 24px -6px rgb(20 18 14 / 0.36)',
      indicatorShadow: '0 1px 0 0 ' + INK,
      blur: 'none', backdropTint: SURF,
      transition: 'opacity 300ms cubic-bezier(0.22, 1, 0.36, 1), transform 300ms cubic-bezier(0.22, 1, 0.36, 1)',
      transitionFast: 'opacity 220ms ease',
      font: 'ui-monospace, "Source Code Pro", monospace',
      uppercase: true, tracking: '0.12em',
      invalidGlow: '0 2px 0 0 ' + DANGER,
      arrowShape: 'serif', clip: 'none'
    },
    'retro-cyberpunk': {
      label: 'Retro Cyberpunk',
      radius: '0px', radiusPill: '0px',
      border: '2px solid color-mix(in oklab, ' + PRIM + ' 80%, ' + INK + ')',
      borderWeak: '1px solid color-mix(in oklab, ' + PRIM + ' 55%, transparent)',
      ring: '0 0 0 2px ' + INK + ', 0 0 12px 2px color-mix(in oklab, ' + PRIM + ' 70%, transparent)',
      elevation: '0 0 18px color-mix(in oklab, ' + PRIM + ' 55%, transparent), 0 0 40px color-mix(in oklab, ' + PRIM + ' 25%, transparent)',
      elevationHover: '0 0 26px color-mix(in oklab, ' + PRIM + ' 75%, transparent), 0 0 60px color-mix(in oklab, ' + PRIM + ' 35%, transparent)',
      indicatorShadow: '0 0 10px color-mix(in oklab, ' + PRIM + ' 80%, transparent)',
      blur: 'blur(10px) saturate(1.6)', backdropTint: 'color-mix(in oklab, ' + INK + ' 72%, transparent)',
      transition: 'box-shadow 140ms linear, clip-path 140ms linear',
      transitionFast: 'opacity 120ms steps(3, end)',
      font: 'ui-monospace, "Share Tech Mono", monospace',
      uppercase: true, tracking: '0.1em',
      invalidGlow: '0 0 10px ' + DANGER + ', 0 0 2px ' + DANGER,
      arrowShape: 'clipped', clip: 'polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)'
    },
    'neo-minimalist': {
      label: 'Neo-Minimalist',
      radius: '10px', radiusPill: '9999px',
      border: 'none',
      borderWeak: '1px solid color-mix(in oklab, ' + INK + ' 8%, transparent)',
      ring: '0 0 0 2px ' + SURF + ', 0 0 0 2px ' + INK + ', 0 2px 0 0 ' + INK,
      elevation: '0 1px 2px rgb(18 20 26 / 0.08), 0 8px 20px -12px rgb(18 20 26 / 0.18)',
      elevationHover: '0 2px 4px rgb(18 20 26 / 0.10), 0 12px 28px -12px rgb(18 20 26 / 0.24)',
      indicatorShadow: '0 1px 3px rgb(18 20 26 / 0.16)',
      blur: 'none', backdropTint: SURF,
      transition: 'background-color 180ms ease, box-shadow 180ms ease, transform 180ms ease',
      transitionFast: 'opacity 150ms ease, transform 150ms ease',
      font: '"Helvetica Neue", system-ui, sans-serif',
      uppercase: false, tracking: '0',
      invalidGlow: '0 1px 0 0 ' + DANGER + ', 0 0 0 3px color-mix(in oklab, ' + DANGER + ' 18%, transparent)',
      arrowShape: 'rounded', clip: 'none'
    }
  };

  /* ------------------------------------------------------------
   * Per-component rule builders. Each returns a CSS string for
   * class base `.pai-<type>` plus its scoped tokens.
   * ---------------------------------------------------------- */

  function accordionCSS(base, spec) {
    var labelStyle = spec.uppercase
      ? 'text-transform: uppercase; letter-spacing: ' + spec.tracking + ';'
      : 'letter-spacing: ' + spec.tracking + ';';
    return (
      /* tokens */
      '.' + base + '{\n' +
      '  --' + base + '-radius: ' + spec.radius + ';\n' +
      '  --' + base + '-border: ' + spec.borderWeak + ';\n' +
      '  --' + base + '-duration: 240ms;\n' +
      '  font-family: ' + spec.font + ';\n' +
      '}\n' +
      '.' + base + '__item{\n' +
      '  border: var(--' + base + '-border);\n' +
      '  border-radius: var(--' + base + '-radius);\n' +
      '  background: ' + SURF + ';\n' +
      '  overflow: hidden;\n' +
      '  transition: ' + spec.transition + ';\n' +
      '}\n' +
      '.' + base + '__item[data-open="true"]{ box-shadow: ' + spec.elevation + '; }\n' +
      '.' + base + '__item + .pai-accordion__item{ margin-block-start: 10px; }\n' +
      '.' + base + '__trigger{\n' +
      '  all: unset; display: flex; width: 100%; box-sizing: border-box;\n' +
      '  align-items: center; justify-content: space-between; gap: 12px;\n' +
      '  padding: 14px 18px; cursor: pointer; ' + labelStyle + '\n' +
      '  font-weight: 600; transition: ' + spec.transitionFast + ';\n' +
      '}\n' +
      '.' + base + '__trigger:hover{ background: color-mix(in oklab, ' + PRIM + ' 6%, ' + SURF + '); }\n' +
      '.' + base + '__trigger:focus-visible{ box-shadow: ' + spec.ring + '; z-index: 1; }\n' +
      '.' + base + '__icon{ transition: transform var(--' + base + '-duration) ' + (spec.clip !== 'none' ? 'steps(3, end)' : 'ease') + '; }\n' +
      '.' + base + '__item[data-open="true"] .' + base + '__icon{ transform: rotate(90deg); }\n' +
      /* 0fr -> 1fr grid trick: smooth height without measuring JS */
      '.' + base + '__panel{\n' +
      '  display: grid; grid-template-rows: 0fr;\n' +
      '  transition: grid-template-rows var(--' + base + '-duration) cubic-bezier(0.2, 0.7, 0.3, 1);\n' +
      '}\n' +
      '.' + base + '__item[data-open="true"] .' + base + '__panel{ grid-template-rows: 1fr; }\n' +
      '.' + base + '__panel > .' + base + '__panel-inner{ overflow: hidden; }\n' +
      '.' + base + '__panel-inner{\n' +
      '  padding: 0 18px 16px; color: ' + INK + ';\n' +
      '  opacity: 0; transform: translateY(-4px);\n' +
      '  transition: opacity var(--' + base + '-duration) ease, transform var(--' + base + '-duration) ease;\n' +
      '}\n' +
      '.' + base + '__item[data-open="true"] .' + base + '__panel-inner{ opacity: 1; transform: none; }\n' +
      '@media (prefers-reduced-motion: reduce){\n' +
      '  .pai-accordion__panel, .pai-accordion__icon, .pai-accordion__panel-inner{ transition: none; }\n' +
      '}'
    );
  }

  function modalCSS(base, spec) {
    var blurLayer = spec.blur === 'none'
      ? 'background: ' + spec.backdropTint + ';'
      : 'background: ' + spec.backdropTint + ';\n  backdrop-filter: ' + spec.blur + ';\n  -webkit-backdrop-filter: ' + spec.blur + ';';
    return (
      '.' + base + '{\n' +
      '  --' + base + '-radius: ' + spec.radius + ';\n' +
      '  --' + base + '-duration: 280ms;\n' +
      '  font-family: ' + spec.font + ';\n' +
      '  border: ' + spec.border + ';\n' +
      '  border-radius: var(--' + base + '-radius);\n' +
      '  background: ' + SURF + ';\n' +
      '  color: ' + INK + ';\n' +
      '  padding: 24px; max-width: min(560px, calc(100vw - 32px));\n' +
      '  box-shadow: ' + spec.elevation + ';\n' +
      '  clip-path: ' + spec.clip + ';\n' +
      '  opacity: 0; transform: translateY(14px) scale(0.985);\n' +
      '  transition: opacity var(--' + base + '-duration) ease, transform var(--' + base + '-duration) cubic-bezier(0.2, 0.7, 0.3, 1);\n' +
      '}\n' +
      '.' + base + '[open], .' + base + '[data-open="true"]{ opacity: 1; transform: none; }\n' +
      '.' + base + '::backdrop{\n' +
      '  ' + (spec.blur === 'none' ? 'background: rgb(10 12 18 / 0.5);' : 'background: rgb(10 12 18 / 0.45);\n  backdrop-filter: ' + spec.blur + ';\n  -webkit-backdrop-filter: ' + spec.blur + ';') + '\n' +
      '}\n' +
      '.' + base + '__title{ margin: 0 0 8px; font-weight: 700; }\n' +
      '.' + base + '__close{ all: unset; cursor: pointer; float: inline-end; padding: 6px; border-radius: var(--' + base + '-radius); }\n' +
      '.' + base + '__close:focus-visible{ box-shadow: ' + spec.ring + '; }\n' +
      '@media (prefers-reduced-motion: reduce){\n' +
      '  .pai-modal, .pai-modal__backdrop{ transition: none; transform: none; }\n' +
      '}'
    );
  }

  /* Shared gliding-indicator math: the host sets
   * --<base>-count and --<base>-active (0-based); the indicator
   * slides with a transform, so it never triggers layout. */
  function indicatorCore(base, spec, selector) {
    return (
      selector + '{\n' +
      '  position: absolute; inset-block: 4px; inset-inline-start: 4px;\n' +
      '  width: calc((100% - 8px) / max(var(--' + base + '-count, 1), 1));\n' +
      '  transform: translateX(calc(var(--' + base + '-active, 0) * 100%));\n' +
      '  border-radius: ' + (spec.radiusPill === '9999px' ? '9999px' : spec.radius) + ';\n' +
      '  background: ' + PRIM + ';\n' +
      '  box-shadow: ' + spec.indicatorShadow + ';\n' +
      '  transition: transform ' + (spec.clip !== 'none' ? '140ms steps(3, end)' : '260ms cubic-bezier(0.2, 0.7, 0.3, 1)') + ';\n' +
      '  pointer-events: none;\n' +
      '}\n' +
      '@media (prefers-reduced-motion: reduce){ ' + selector + '{ transition: none; } }'
    );
  }

  function tabsCSS(base, spec) {
    var labelStyle = spec.uppercase
      ? 'text-transform: uppercase; letter-spacing: ' + spec.tracking + ';'
      : 'letter-spacing: ' + spec.tracking + ';';
    return (
      '.' + base + '{\n' +
      '  --' + base + '-count: 1; --' + base + '-active: 0;\n' +
      '  position: relative; display: flex; gap: 2px;\n' +
      '  padding: 4px; border-radius: ' + spec.radius + ';\n' +
      '  clip-path: ' + spec.clip + ';\n' +
      '  border: ' + spec.borderWeak + ';\n' +
      '  background: ' + SURF + ';\n' +
      '  font-family: ' + spec.font + ';\n' +
      '}\n' +
      indicatorCore(base, spec, '.' + base + '__indicator') + '\n' +
      '.' + base + '__tab{\n' +
      '  all: unset; position: relative; z-index: 1; flex: 1; cursor: pointer;\n' +
      '  box-sizing: border-box; text-align: center; padding: 8px 14px;\n' +
      '  border-radius: ' + (spec.radiusPill === '9999px' ? '9999px' : 'calc(' + spec.radius + ' - 2px)') + ';\n' +
      '  color: ' + INK + '; ' + labelStyle + ' font-weight: 600;\n' +
      '  transition: color 180ms ease, ' + spec.transitionFast + ';\n' +
      '}\n' +
      '.' + base + '__tab:hover{ color: ' + PRIM + '; }\n' +
      '.' + base + '__tab[aria-selected="true"]{ color: var(--c-on-primary, #fff); }\n' +
      '.' + base + '__tab:focus-visible{ box-shadow: ' + spec.ring + '; z-index: 2; }\n' +
      /* fallback voice when no indicator element is present */
      '.' + base + ':not(:has(.' + base + '__indicator)) .' + base + '__tab[aria-selected="true"]{\n' +
      '  background: ' + PRIM + ';\n' +
      '  box-shadow: ' + spec.indicatorShadow + ';\n' +
      '}\n' +
      '@media (prefers-reduced-motion: reduce){ .pai-tabs__tab{ transition: none; } }'
    );
  }

  function segmentedCSS(base, spec) {
    var out = tabsCSS(base, spec);
    /* segmented = pill container variant of tabs */
    out += '\n.' + base + '{ border-radius: ' + spec.radiusPill + '; }\n' +
      '.' + base + '__tab{ border-radius: ' + spec.radiusPill + '; }\n';
    return out;
  }

  function tooltipCSS(base, spec) {
    var blurLayer = spec.blur === 'none' ? '' :
      'backdrop-filter: ' + spec.blur + ';\n  -webkit-backdrop-filter: ' + spec.blur + ';\n  ';
    var arrow;
    if (spec.arrowShape === 'square') {
      arrow = '.' + base + '__bubble::after{\n  content: ""; position: absolute; inset-block-start: 100%; inset-inline-start: 14px;\n  width: 10px; height: 10px; background: ' + INK + ';\n  transform: translateY(-5px) rotate(45deg);\n}';
    } else if (spec.arrowShape === 'clipped') {
      arrow = '.' + base + '__bubble::after{\n  content: ""; position: absolute; inset-block-start: 100%; inset-inline-start: 14px;\n  border: 7px solid transparent; border-top-color: ' + PRIM + ';\n  filter: drop-shadow(0 0 6px color-mix(in oklab, ' + PRIM + ' 80%, transparent));\n}';
    } else if (spec.arrowShape === 'serif') {
      arrow = '.' + base + '__bubble::after{\n  content: ""; position: absolute; inset-block-start: 100%; inset-inline-start: 14px;\n  border: 6px solid transparent; border-top-color: ' + INK + ';\n}';
    } else {
      arrow = '.' + base + '__bubble::after{\n  content: ""; position: absolute; inset-block-start: 100%; inset-inline-start: 14px;\n  width: 12px; height: 12px; border-radius: 3px;\n  background: inherit; transform: translateY(-6px) rotate(45deg);\n}';
    }
    return (
      '.' + base + '{ position: relative; display: inline-flex; font-family: ' + spec.font + '; }\n' +
      '.' + base + '__bubble{\n' +
      '  position: absolute; inset-block-end: calc(100% + 10px); inset-inline-start: 0;\n' +
      '  z-index: 40; max-width: 260px; padding: 8px 12px;\n' +
      '  border-radius: ' + spec.radius + ';\n' +
      '  border: ' + spec.borderWeak + ';\n' +
      '  background: ' + (spec.arrowShape === 'clipped' ? INK : spec.backdropTint) + ';\n' +
      '  color: ' + (spec.arrowShape === 'clipped' ? 'var(--c-on-ink, #e8fdff)' : INK) + ';\n' +
      '  ' + blurLayer + 'box-shadow: ' + spec.elevation + ';\n' +
      '  clip-path: ' + spec.clip + ';\n' +
      '  opacity: 0; translate: 0 4px; pointer-events: none;\n' +
      '  transition: ' + spec.transitionFast + ';\n' +
      '  transition-delay: 0ms;\n' +
      '}\n' +
      '.' + base + ':hover .' + base + '__bubble,\n.' + base + ':focus-within .' + base + '__bubble{\n' +
      '  opacity: 1; translate: 0 0; pointer-events: auto; transition-delay: 120ms;\n' +
      '}\n' +
      arrow + '\n' +
      '@media (prefers-reduced-motion: reduce){ .pai-tooltip__bubble{ transition: opacity 1ms; translate: none; } }'
    );
  }

  function dropdownCSS(base, spec) {
    var blurLayer = spec.blur === 'none' ? '' :
      'backdrop-filter: ' + spec.blur + ';\n  -webkit-backdrop-filter: ' + spec.blur + ';\n  ';
    return (
      '.' + base + '{ position: relative; display: inline-block; font-family: ' + spec.font + '; }\n' +
      '.' + base + '__menu{\n' +
      '  position: absolute; inset-block-start: calc(100% + 8px); inset-inline-start: 0; z-index: 50;\n' +
      '  min-width: 200px; margin: 0; padding: 6px; list-style: none; box-sizing: border-box;\n' +
      '  border: ' + spec.borderWeak + ';\n' +
      '  border-radius: ' + spec.radius + ';\n' +
      '  background: ' + spec.backdropTint + ';\n' +
      '  ' + blurLayer + 'box-shadow: ' + spec.elevation + ';\n' +
      '  clip-path: ' + spec.clip + ';\n' +
      '  opacity: 0; translate: 0 -6px; scale: 0.98; pointer-events: none; visibility: hidden;\n' +
      '  transition: ' + spec.transitionFast + ', visibility 0s linear 180ms;\n' +
      '}\n' +
      '.' + base + '[data-open="true"] .' + base + '__menu,\n.' + base + '__menu:popover-open{\n' +
      '  opacity: 1; translate: 0 0; scale: 1; pointer-events: auto; visibility: visible;\n' +
      '  transition-delay: 0ms;\n' +
      '}\n' +
      /* [popover] gains dismiss + light-dom for free where supported */
      '.' + base + '__menu[popover]{ position: fixed; inset: auto; margin: 0; }\n' +
      '.' + base + '__item{\n' +
      '  display: block; width: 100%; box-sizing: border-box; padding: 9px 12px;\n' +
      '  border-radius: calc(' + spec.radius + ' - 4px);\n' +
      '  color: ' + INK + '; text-decoration: none; cursor: pointer;\n' +
      '  transition: ' + spec.transitionFast + ';\n' +
      '}\n' +
      '.' + base + '__item:hover{ background: color-mix(in oklab, ' + PRIM + ' 10%, ' + SURF + '); }\n' +
      '.' + base + '__item:focus-visible{ box-shadow: ' + spec.ring + '; outline: none; }\n' +
      '.' + base + '__trigger:focus-visible{ box-shadow: ' + spec.ring + '; }\n' +
      '@media (prefers-reduced-motion: reduce){ .pai-dropdown__menu{ transition: none; translate: none; scale: none; } }'
    );
  }

  function inputCSS(base, spec) {
    var borderless = spec.border === 'none';
    var fieldBorder = borderless ? '1px solid transparent' : spec.borderWeak;
    var fieldBg = borderless ? 'color-mix(in oklab, ' + INK + ' 4%, ' + SURF + ')' : SURF;
    return (
      '.' + base + '{\n' +
      '  --' + base + '-radius: ' + (spec.radiusPill === '9999px' ? '14px' : spec.radius) + ';\n' +
      '  font-family: ' + spec.font + ';\n' +
      '}\n' +
      '.' + base + '__field{\n' +
      '  all: unset; display: block; width: 100%; box-sizing: border-box;\n' +
      '  padding: 11px 14px; font: inherit; color: ' + INK + ';\n' +
      '  background: ' + fieldBg + ';\n' +
      '  border: ' + fieldBorder + ';\n' +
      '  border-radius: var(--' + base + '-radius);\n' +
      '  box-shadow: ' + (spec.arrowShape === 'blob' ? 'inset 0 2px 4px rgb(60 42 30 / 0.08)' : 'none') + ';\n' +
      '  transition: box-shadow 180ms ease, border-color 180ms ease;\n' +
      '}\n' +
      '.' + base + '__field::placeholder{ color: color-mix(in oklab, ' + INK + ' 45%, transparent); }\n' +
      '.' + base + '__field:hover{ border-color: color-mix(in oklab, ' + PRIM + ' 45%, transparent); }\n' +
      '.' + base + '__field:focus-visible{ box-shadow: ' + spec.ring + '; }\n' +
      '.' + base + '__field:disabled{ opacity: 0.55; cursor: not-allowed; }\n' +
      /* validation error glow */
      '.' + base + '__field[aria-invalid="true"]{\n' +
      '  border-color: ' + DANGER + ';\n' +
      '  box-shadow: ' + spec.invalidGlow + ';\n' +
      '}\n' +
      '.' + base + '__field[aria-invalid="true"]:focus-visible{ box-shadow: ' + spec.invalidGlow + ', ' + spec.ring + '; }\n' +
      '.' + base + '__error{\n' +
      '  margin-block-start: 6px; font-size: 0.85em; color: ' + DANGER + ';\n' +
      (spec.uppercase ? '  text-transform: uppercase; letter-spacing: ' + spec.tracking + ';\n' : '') +
      '}\n' +
      '@media (prefers-reduced-motion: reduce){ .pai-input__field{ transition: none; } }'
    );
  }

  function switchCSS(base, spec) {
    var thumb = spec.arrowShape === 'blob'
      ? 'inset 0 2px 3px rgb(255 255 255 / 0.8), 0 3px 6px rgb(60 42 30 / 0.25)'
      : '0 1px 3px rgb(18 20 26 / 0.3)';
    return (
      '.' + base + '{\n' +
      '  --' + base + '-w: 46px; --' + base + '-h: 26px; --' + base + '-pad: 3px;\n' +
      '  position: relative; display: inline-flex; align-items: center; gap: 10px;\n' +
      '  cursor: pointer; font-family: ' + spec.font + ';\n' +
      '}\n' +
      '.' + base + '__native{ position: absolute; opacity: 0; width: 1px; height: 1px; }\n' +
      '.' + base + '__track{\n' +
      '  width: var(--' + base + '-w); height: var(--' + base + '-h);\n' +
      '  border-radius: ' + spec.radiusPill + ';\n' +
      '  border: ' + spec.borderWeak + ';\n' +
      '  background: color-mix(in oklab, ' + INK + ' 18%, ' + SURF + ');\n' +
      '  position: relative; transition: background-color 200ms ease;\n' +
      '  flex: none;\n' +
      '}\n' +
      '.' + base + '__track::after{\n' +
      '  content: ""; position: absolute; inset-block-start: var(--' + base + '-pad);\n' +
      '  inset-inline-start: var(--' + base + '-pad);\n' +
      '  width: calc(var(--' + base + '-h) - var(--' + base + '-pad) * 2);\n' +
      '  height: calc(var(--' + base + '-h) - var(--' + base + '-pad) * 2);\n' +
      '  border-radius: ' + spec.radiusPill + ';\n' +
      '  background: ' + SURF + ';\n' +
      '  box-shadow: ' + thumb + ';\n' +
      '  transition: transform ' + (spec.clip !== 'none' ? '140ms steps(3, end)' : '220ms cubic-bezier(0.34, 1.4, 0.44, 1)') + ';\n' +
      '}\n' +
      '.' + base + '__native:checked + .' + base + '__track{ background: ' + PRIM + '; }\n' +
      '.' + base + '__native:checked + .' + base + '__track::after{\n' +
      '  transform: translateX(calc(var(--' + base + '-w) - var(--' + base + '-h)));\n' +
      '}\n' +
      '.' + base + '__native:focus-visible + .' + base + '__track{ box-shadow: ' + spec.ring + '; }\n' +
      '.' + base + '__native:disabled + .' + base + '__track{ opacity: 0.5; cursor: not-allowed; }\n' +
      /* checkbox / radio affordances reusing the same physics */
      '.' + base + '__check{\n' +
      '  width: 20px; height: 20px; flex: none; border-radius: calc(' + spec.radius + ' / 2);\n' +
      '  border: ' + (spec.border === 'none' ? '2px solid color-mix(in oklab, ' + INK + ' 30%, transparent)' : spec.border) + ';\n' +
      '  display: inline-grid; place-content: center; background: ' + SURF + ';\n' +
      '  transition: background-color 160ms ease;\n' +
      '}\n' +
      '.' + base + '__check::after{\n' +
      '  content: ""; width: 10px; height: 10px; scale: 0;\n' +
      '  background: var(--c-on-primary, #fff);\n' +
      '  clip-path: polygon(14% 44%, 0 62%, 40% 100%, 100% 16%, 84% 4%, 38% 68%);\n' +
      '  transition: scale 160ms cubic-bezier(0.34, 1.56, 0.64, 1);\n' +
      '}\n' +
      '.' + base + '__native:checked ~ .' + base + '__check{ background: ' + PRIM + '; }\n' +
      '.' + base + '__native:checked ~ .' + base + '__check::after{ scale: 1; }\n' +
      '@media (prefers-reduced-motion: reduce){ .pai-switch__track::after, .pai-switch__check::after{ transition: none; } }'
    );
  }

  var BUILDERS = {
    accordion: accordionCSS,
    modal: modalCSS,
    tabs: tabsCSS,
    segmented: segmentedCSS,
    tooltip: tooltipCSS,
    dropdown: dropdownCSS,
    input: inputCSS,
    switch: switchCSS
  };

  /* ---------------------------------------------------------- */

  ComponentLibrary.generateComponentTokens = function (componentType, archetypeKey) {
    var type = canonComponent(componentType);
    if (!type) {
      return { ok: false, error: 'unknown component type: ' + String(componentType) };
    }
    var key = canonArchetype(archetypeKey);
    if (!key) {
      return { ok: false, error: 'unknown archetype: ' + String(archetypeKey) };
    }
    var spec = SPEC[key];
    var base = 'pai-' + type;
    var css = BUILDERS[type](base, spec);

    return {
      ok: true,
      componentType: type,
      archetype: key,
      archetypeLabel: spec.label,
      classBase: base,
      css: css,
      byteLength: css.length,
      tokens: {
        radius: spec.radius,
        radiusPill: spec.radiusPill,
        border: spec.border,
        focusRing: spec.ring,
        elevation: spec.elevation,
        backdropBlur: spec.blur,
        transition: spec.transition,
        invalidGlow: spec.invalidGlow,
        clipPath: spec.clip
      },
      usesBackdropFilter: spec.blur !== 'none'
    };
  };

  ComponentLibrary.generateAll = function (archetypeKey) {
    var key = canonArchetype(archetypeKey);
    if (!key) return { ok: false, error: 'unknown archetype: ' + String(archetypeKey) };
    var out = {};
    var total = 0;
    for (var i = 0; i < COMPONENT_TYPES.length; i++) {
      var r = ComponentLibrary.generateComponentTokens(COMPONENT_TYPES[i], key);
      out[r.componentType] = r;
      total += r.byteLength;
    }
    return { ok: true, archetype: key, components: out, totalBytes: total };
  };

  ComponentLibrary.canonicalArchetype = canonArchetype;
  ComponentLibrary.canonicalComponent = canonComponent;

  /* CommonJS + browser global */
  if (typeof module !== 'undefined' && module.exports) module.exports = ComponentLibrary;
  if (typeof window !== 'undefined') window.ComponentLibrary = ComponentLibrary;
})();
