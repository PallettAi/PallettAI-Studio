// ============================================================
// PallettAI Studio — ComponentStyles
// Archetype micro-style & component-variant generator.
//
// Per-Design-DNA CSS for the atoms every section reuses:
// buttons (primary/secondary/ghost), cards, status badges and
// input fields. Each archetype gets a coherent physical language:
//
//   brutalist-kinetic   hard 4px black borders, 0 radius, 4px
//                       hard offset shadow on hover, press-in
//                       active state. Monospace labels.
//   bento-glass         12px backdrop blur, 1px translucent
//                       border, subtle gradient overlay, soft
//                       lift on hover.
//   organic-clay        9999px pill radii, dual inset shadows
//                       for tactile depth, cushioned press.
//   editorial-magazine  monospaced labels, thin double-line
//                       borders, underline slide-in on hover.
//   retro-cyberpunk     neon text/glow shadows, clipped-corner
//                       polygon (clip-path), hard glow shift.
//   neo-minimalist      borderless, ultra-clean, high-contrast
//                       underline focus ring, gentle tint hover.
//
// All colour flows through tokens the studio already emits
// (--c-primary/--c-surface/--c-ink/...), never literals.
// CommonJS + browser global, like the rest of modules/.
// ============================================================
(function () {
  'use strict';

  const ComponentStyles = {};

  const ARCHETYPES = [
    'bento-glass',
    'brutalist-kinetic',
    'editorial-magazine',
    'retro-cyberpunk',
    'organic-clay',
    'neo-minimalist'
  ];
  ComponentStyles.ARCHETYPES = ARCHETYPES;

  var ALIASES = {
    'bento': 'bento-glass',
    'glass': 'bento-glass',
    'brutalist': 'brutalist-kinetic',
    'kinetic': 'brutalist-kinetic',
    'editorial': 'editorial-magazine',
    'magazine': 'editorial-magazine',
    'cyberpunk': 'retro-cyberpunk',
    'retro': 'retro-cyberpunk',
    'clay': 'organic-clay',
    'organic': 'organic-clay',
    'neo': 'neo-minimalist',
    'minimalist': 'neo-minimalist',
    'minimal': 'neo-minimalist'
  };
  function canon(key) {
    var k = String(key || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
    if (ARCHETYPES.indexOf(k) !== -1) return k;
    if (ALIASES[k]) return ALIASES[k];
    return null;
  }

  function esc(s) { return String(s).replace(/[^\w.-]/g, '-'); }

  /* ============================================================
     1 — buttons
     ============================================================ */

  var BUTTON_RULES = {
    'brutalist-kinetic': [
      '.pa-btn{',
      '  font-family:var(--font-mono,ui-monospace,monospace);',
      '  font-weight:700;letter-spacing:.02em;text-transform:uppercase;',
      '  border:4px solid var(--c-ink,#111);border-radius:0;',
      '  background:var(--c-primary);color:var(--on-primary,#fff);',
      '  padding:.7em 1.4em;box-shadow:none;',
      '  transition:transform .12s ease,box-shadow .12s ease,background .12s ease;}',
      '.pa-btn:hover{transform:translate(-4px,-4px);box-shadow:4px 4px 0 0 var(--c-ink,#111);}',
      '.pa-btn:active{transform:translate(0,0);box-shadow:0 0 0 0 var(--c-ink,#111);}',
      '.pa-btn--secondary{background:var(--c-surface,#fff);color:var(--c-ink,#111);}',
      '.pa-btn--ghost{border-color:transparent;background:transparent;color:var(--c-ink,#111);}',
      '.pa-btn--ghost:hover{border-color:var(--c-ink,#111);}'
    ],
    'bento-glass': [
      '.pa-btn{',
      '  border:1px solid var(--c-glass-border,rgba(255,255,255,.35));border-radius:12px;',
      '  background:linear-gradient(135deg,var(--c-glass-bg,rgba(255,255,255,.28)),var(--c-glass-bg-2,rgba(255,255,255,.10)));',
      '  -webkit-backdrop-filter:blur(12px) saturate(1.4);backdrop-filter:blur(12px) saturate(1.4);',
      '  color:var(--c-ink,#111);padding:.7em 1.5em;',
      '  box-shadow:0 1px 0 rgba(255,255,255,.35) inset,0 8px 24px var(--c-shadow,rgba(20,20,40,.12));',
      '  transition:transform .2s ease,box-shadow .2s ease;}',
      '.pa-btn:hover{transform:translateY(-2px);box-shadow:0 2px 0 rgba(255,255,255,.4) inset,0 14px 34px var(--c-shadow,rgba(20,20,40,.18));}',
      '.pa-btn:active{transform:translateY(0);}',
      '.pa-btn--secondary{background:var(--c-glass-bg,rgba(255,255,255,.18));}',
      '.pa-btn--ghost{background:transparent;border-color:var(--c-glass-border,rgba(255,255,255,.25));box-shadow:none;}'
    ],
    'organic-clay': [
      '.pa-btn{',
      '  border:none;border-radius:9999px;',
      '  background:var(--c-primary);color:var(--on-primary,#fff);',
      '  padding:.75em 1.6em;',
      '  box-shadow:inset 0 2px 3px rgba(255,255,255,.45),inset 0 -3px 5px rgba(0,0,0,.18),0 4px 10px var(--c-shadow,rgba(60,40,30,.16));',
      '  transition:box-shadow .18s ease,transform .18s ease;}',
      '.pa-btn:hover{transform:translateY(-1px);box-shadow:inset 0 2px 3px rgba(255,255,255,.5),inset 0 -3px 5px rgba(0,0,0,.2),0 8px 18px var(--c-shadow,rgba(60,40,30,.22));}',
      '.pa-btn:active{transform:translateY(1px);box-shadow:inset 0 3px 6px rgba(0,0,0,.22),inset 0 -1px 2px rgba(255,255,255,.35);}',
      '.pa-btn--secondary{background:var(--c-surface-2,var(--c-surface,#eee));color:var(--c-ink,#333);}',
      '.pa-btn--ghost{background:transparent;box-shadow:inset 0 0 0 2px var(--c-surface-2,#ddd);color:var(--c-ink,#333);}'
    ],
    'editorial-magazine': [
      '.pa-btn{',
      '  font-family:var(--font-mono,ui-monospace,monospace);',
      '  font-size:.85em;letter-spacing:.12em;text-transform:uppercase;',
      '  border:none;border-radius:0;',
      '  background:transparent;color:var(--c-ink,#111);',
      '  padding:.6em .2em;',
      '  box-shadow:0 0 0 1px var(--c-ink,#111),0 0 0 4px var(--c-surface,#fff),0 0 0 5px var(--c-ink,#111);',
      '  position:relative;transition:color .15s ease;}',
      '.pa-btn::after{content:"";position:absolute;left:0;bottom:-2px;height:2px;width:100%;',
      '  background:var(--c-primary);transform:scaleX(0);transform-origin:left;transition:transform .25s ease;}',
      '.pa-btn:hover::after{transform:scaleX(1);}',
      '.pa-btn--secondary{box-shadow:0 0 0 1px var(--c-ink,#111);}',
      '.pa-btn--secondary::after{height:1px;}',
      '.pa-btn--ghost{box-shadow:none;border-bottom:1px solid var(--c-ink,#111);border-radius:0;}'
    ],
    'retro-cyberpunk': [
      '.pa-btn{',
      '  font-family:var(--font-mono,ui-monospace,monospace);',
      '  text-transform:uppercase;letter-spacing:.08em;',
      '  border:none;border-radius:0;',
      '  background:var(--c-primary);color:var(--on-primary,#050510);',
      '  padding:.7em 1.5em;',
      '  clip-path:polygon(10px 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%,0 10px);',
      '  text-shadow:0 0 6px var(--c-neon-glow,rgba(0,255,220,.85)),0 0 18px var(--c-neon-glow-2,rgba(255,0,200,.4));',
      '  box-shadow:0 0 12px var(--c-neon-glow,rgba(0,255,220,.5));',
      '  transition:box-shadow .15s ease,text-shadow .15s ease,filter .15s ease;}',
      '.pa-btn:hover{filter:brightness(1.15);box-shadow:0 0 22px var(--c-neon-glow,rgba(0,255,220,.8)),0 0 44px var(--c-neon-glow-2,rgba(255,0,200,.45));}',
      '.pa-btn--secondary{background:var(--c-surface-2,#0c0c1c);color:var(--c-neon,#0ff);text-shadow:0 0 8px var(--c-neon,#0ff);}',
      '.pa-btn--ghost{background:transparent;color:var(--c-neon,#0ff);text-shadow:0 0 8px var(--c-neon,#0ff);}'
    ],
    'neo-minimalist': [
      '.pa-btn{',
      '  border:none;border-radius:8px;',
      '  background:var(--c-primary);color:var(--on-primary,#fff);',
      '  padding:.65em 1.3em;font-weight:500;',
      '  box-shadow:none;transition:background .15s ease,box-shadow .15s ease;}',
      '.pa-btn:hover{background:var(--c-primary-hover,var(--c-primary));}',
      '.pa-btn:active{background:var(--c-primary-active,var(--c-primary));}',
      '.pa-btn:focus-visible{outline:none;box-shadow:0 2px 0 0 var(--c-ink,#111);border-radius:0;}',
      '.pa-btn--secondary{background:transparent;color:var(--c-ink,#111);}',
      '.pa-btn--secondary:hover{background:var(--c-tint,rgba(0,0,0,.05));}',
      '.pa-btn--ghost{background:transparent;color:var(--c-ink,#111);}'
    ]
  };

  var BADGE_CARD_RULES = {
    'brutalist-kinetic': [
      '.pa-card{border:4px solid var(--c-ink,#111);border-radius:0;background:var(--c-surface,#fff);',
      '  box-shadow:6px 6px 0 0 var(--c-ink,#111);}',
      '.pa-badge{font-family:var(--font-mono,ui-monospace,monospace);text-transform:uppercase;font-weight:700;',
      '  border:2px solid var(--c-ink,#111);border-radius:0;padding:.15em .6em;background:var(--c-primary);color:var(--on-primary,#fff);}',
      '.pa-badge--muted{background:var(--c-surface,#fff);color:var(--c-ink,#111);}',
      '.pa-input{border:3px solid var(--c-ink,#111);border-radius:0;background:var(--c-surface,#fff);padding:.6em .8em;',
      '  font-family:var(--font-mono,ui-monospace,monospace);}',
      '.pa-input:focus{outline:none;box-shadow:4px 4px 0 0 var(--c-primary);}'
    ],
    'bento-glass': [
      '.pa-card{border:1px solid var(--c-glass-border,rgba(255,255,255,.35));border-radius:20px;',
      '  background:linear-gradient(160deg,var(--c-glass-bg,rgba(255,255,255,.24)),var(--c-glass-bg-2,rgba(255,255,255,.08)));',
      '  -webkit-backdrop-filter:blur(12px) saturate(1.3);backdrop-filter:blur(12px) saturate(1.3);',
      '  box-shadow:0 1px 0 rgba(255,255,255,.3) inset,0 16px 40px var(--c-shadow,rgba(20,20,40,.12));}',
      '.pa-badge{border-radius:9999px;padding:.2em .75em;font-size:.78em;',
      '  background:var(--c-glass-bg,rgba(255,255,255,.22));border:1px solid var(--c-glass-border,rgba(255,255,255,.3));color:var(--c-ink,#111);}',
      '.pa-badge--muted{opacity:.7;}',
      '.pa-input{border:1px solid var(--c-glass-border,rgba(255,255,255,.35));border-radius:12px;',
      '  background:var(--c-glass-bg-2,rgba(255,255,255,.12));padding:.65em .9em;color:var(--c-ink,#111);}',
      '.pa-input:focus{outline:none;border-color:var(--c-primary);box-shadow:0 0 0 3px var(--c-focus-ring,rgba(80,120,255,.25));}'
    ],
    'organic-clay': [
      '.pa-card{border:none;border-radius:28px;background:var(--c-surface,#fff);',
      '  box-shadow:inset 0 3px 6px rgba(255,255,255,.6),inset 0 -5px 10px rgba(0,0,0,.06),0 14px 30px var(--c-shadow,rgba(60,40,30,.14));}',
      '.pa-badge{border:none;border-radius:9999px;padding:.25em .85em;background:var(--c-primary);color:var(--on-primary,#fff);',
      '  box-shadow:inset 0 2px 3px rgba(255,255,255,.4),inset 0 -2px 4px rgba(0,0,0,.18);}',
      '.pa-badge--muted{background:var(--c-surface-2,#eee);color:var(--c-ink,#333);}',
      '.pa-input{border:none;border-radius:18px;background:var(--c-surface-2,#eee);padding:.7em 1em;',
      '  box-shadow:inset 0 2px 5px rgba(0,0,0,.10),inset 0 -1px 2px rgba(255,255,255,.6);}',
      '.pa-input:focus{outline:none;box-shadow:inset 0 2px 5px rgba(0,0,0,.10),0 0 0 3px var(--c-focus-ring,rgba(80,120,255,.2));}'
    ],
    'editorial-magazine': [
      '.pa-card{border-top:1px solid var(--c-ink,#111);border-bottom:1px solid var(--c-ink,#111);border-radius:0;',
      '  background:var(--c-surface,#fff);box-shadow:none;}',
      '.pa-badge{font-family:var(--font-mono,ui-monospace,monospace);text-transform:uppercase;letter-spacing:.1em;',
      '  font-size:.72em;border-radius:0;padding:.2em .5em;background:transparent;color:var(--c-ink,#111);',
      '  border-top:1px solid var(--c-ink,#111);border-bottom:1px solid var(--c-ink,#111);}',
      '.pa-badge--muted{color:var(--c-muted,#666);border-color:var(--c-muted,#666);}',
      '.pa-input{border:none;border-bottom:1px solid var(--c-ink,#111);border-radius:0;background:transparent;padding:.5em .1em;',
      '  font-family:var(--font-serif,Georgia,serif);font-size:1.05em;}',
      '.pa-input:focus{outline:none;border-bottom:2px solid var(--c-primary);}'
    ],
    'retro-cyberpunk': [
      '.pa-card{border:none;border-radius:0;background:var(--c-surface-2,#0c0c1c);color:var(--c-ink,#e6f7ff);',
      '  clip-path:polygon(14px 0,100% 0,100% calc(100% - 14px),calc(100% - 14px) 100%,0 100%,0 14px);',
      '  box-shadow:0 0 0 1px var(--c-neon,#0ff),0 0 18px var(--c-neon-glow,rgba(0,255,220,.35));}',
      '.pa-badge{font-family:var(--font-mono,ui-monospace,monospace);text-transform:uppercase;font-size:.75em;',
      '  border-radius:0;padding:.2em .6em;background:transparent;color:var(--c-neon,#0ff);',
      '  box-shadow:0 0 0 1px var(--c-neon,#0ff),0 0 8px var(--c-neon-glow,rgba(0,255,220,.5)) inset;}',
      '.pa-badge--muted{color:var(--c-muted,#8899aa);box-shadow:0 0 0 1px var(--c-muted,#8899aa);}',
      '.pa-input{border:none;border-radius:0;background:rgba(0,20,30,.6);color:var(--c-neon,#0ff);padding:.6em .8em;',
      '  font-family:var(--font-mono,ui-monospace,monospace);',
      '  clip-path:polygon(8px 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,0 100%,0 8px);',
      '  box-shadow:0 0 0 1px var(--c-neon,#0ff);}',
      '.pa-input:focus{outline:none;box-shadow:0 0 0 1px var(--c-neon,#0ff),0 0 14px var(--c-neon-glow,rgba(0,255,220,.6));}'
    ],
    'neo-minimalist': [
      '.pa-card{border:none;border-radius:14px;background:var(--c-surface,#fff);',
      '  box-shadow:0 1px 2px rgba(0,0,0,.05),0 8px 24px rgba(0,0,0,.06);}',
      '.pa-badge{border:none;border-radius:9999px;padding:.25em .8em;font-size:.78em;font-weight:500;',
      '  background:var(--c-tint,rgba(0,0,0,.06));color:var(--c-ink,#111);}',
      '.pa-badge--muted{opacity:.65;}',
      '.pa-input{border:1px solid transparent;border-radius:10px;background:var(--c-tint,rgba(0,0,0,.04));padding:.65em .9em;}',
      '.pa-input:focus{outline:none;background:var(--c-surface,#fff);box-shadow:0 2px 0 0 var(--c-ink,#111);}'
    ]
  };

  function baseLayer(prefix, rules, meta) {
    return {
      ok: true,
      archetype: meta.archetype,
      namespace: prefix,
      css: rules.join('\n'),
      classes: meta.classes
    };
  }

  /**
   * generateButtonTokens(archetypeKey)
   * @param {string} archetypeKey  one of the six canonical keys (aliases ok)
   * @returns {{ ok, archetype, css, classes, variables } |
   *           { ok: false, error }}
   *
   * classes: pa-btn, pa-btn--secondary, pa-btn--ghost
   */
  ComponentStyles.generateButtonTokens = function (archetypeKey) {
    var key = canon(archetypeKey);
    if (!key) return { ok: false, error: 'Unknown archetype: ' + archetypeKey };
    return baseLayer('pa-btn', BUTTON_RULES[key], {
      archetype: key,
      classes: ['pa-btn', 'pa-btn--secondary', 'pa-btn--ghost']
    });
  };

  /**
   * generateCardAndBadgeTokens(archetypeKey)
   * @param {string} archetypeKey  one of the six canonical keys (aliases ok)
   * @returns {{ ok, archetype, css, classes, variables } |
   *           { ok: false, error }}
   *
   * classes: pa-card, pa-badge (+ --muted), pa-input
   */
  ComponentStyles.generateCardAndBadgeTokens = function (archetypeKey) {
    var key = canon(archetypeKey);
    if (!key) return { ok: false, error: 'Unknown archetype: ' + archetypeKey };
    return baseLayer('pa-card', BADGE_CARD_RULES[key], {
      archetype: key,
      classes: ['pa-card', 'pa-badge', 'pa-badge--muted', 'pa-input']
    });
  };

  /**
   * generateComponentStylesheet(archetypeKey)
   * Combined button + card/badge/input layer for one archetype.
   */
  ComponentStyles.generateComponentStylesheet = function (archetypeKey) {
    var b = ComponentStyles.generateButtonTokens(archetypeKey);
    var c = ComponentStyles.generateCardAndBadgeTokens(archetypeKey);
    if (!b.ok) return b;
    if (!c.ok) return c;
    return {
      ok: true,
      archetype: b.archetype,
      css: '/* PallettAI components — ' + b.archetype + ' */\n' + b.css + '\n' + c.css,
      classes: b.classes.concat(c.classes)
    };
  };

  /* ---------------- exports ---------------- */

  ComponentStyles.canonicalKey = canon;
  ComponentStyles.BUTTON_RULES = BUTTON_RULES;
  ComponentStyles.BADGE_CARD_RULES = BADGE_CARD_RULES;

  if (typeof module !== 'undefined' && module.exports) module.exports = ComponentStyles;
})();
