'use strict';
// ============================================================
// PallettAI Studio — scroll-driven motion & parallax engine
// Native CSS scroll timelines for viewport motion — no JS
// animation library, no rAF main-thread cost for the common
// cases — with a tiny IntersectionObserver + rAF parallax
// fallback for layered depth on browsers without scroll
// timelines (or for effects that must track a sensitivity
// map rather than pure viewport progress).
// ------------------------------------------------------------
//   1. generateScrollTimelineCSS(animationType, targetSelector)
//        'reveal'     — fade/translate entry tied to view()
//        'scale-down' — page-progress zoom-out tied to scroll()
//        'progress'   — scaleX progress bar tied to scroll()
//      Returns @keyframes + animation-timeline declarations.
//   2. generateParallaxLayersScript(sensitivityMap) → < 0.8KB
//      inline JS: selector → depth map, IntersectionObserver
//      gates the work to on-screen layers, rAF batches it.
//   3. MOTION_CLASSES + generateMotionClassCSS(classKey, options)
//      / generateMotionClassesCSS(options) — the three predefined
//      motion classes the DeepSeek AST compiler attaches to HTML
//      sections, emitted by the dynamic CSS generator in §3:
//        .motion-reveal-up    — fade + slide-up on viewport entry
//        .motion-parallax-bg  — background drifts slower than scroll
//        .motion-kinetic-text — horizontal type travel driven by
//                               vertical scroll distance
//      Both scroll CSS APIs are used — the named @scroll-timeline
//      at-rule for engines that shipped it, and the shipped
//      animation-timeline: view() property — with every layer fenced
//      by @supports so browsers without scroll-driven animations get
//      the authored, fully visible state instead.
//   4. prefers-reduced-motion is honored twice, deliberately:
//      — applying blocks are gated by (prefers-reduced-motion:
//        no-preference), so reduce visitors never receive the
//        animation AT ALL, and
//      — an explicit reduce override sets `animation: none`
//        for the selector, so a stray animation can never move
//        a spatial element under reduce.
//      Net guarantee: without @supports (animation-timeline),
//      without JS, or under reduce, the element renders in its
//      authored, fully visible state — content is never hidden
//      behind an animation the visitor cannot receive.
// ============================================================

function fail(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

// animationType aliases → canonical keys.
const TYPES = {
  reveal: 'reveal',
  'fade-up': 'reveal',
  fade: 'reveal',
  fadein: 'reveal',
  'fade-in': 'reveal',
  'scale-down': 'scale-down',
  scaledown: 'scale-down',
  zoom: 'scale-down',
  progress: 'progress',
  'progress-bar': 'progress',
  'scroll-progress': 'progress'
};

/**
 * generateScrollTimelineCSS(animationType, targetSelector) → CSS text.
 *
 * Every variant is three layers deep on purpose:
 *   1. @keyframes — inert on their own.
 *   2. @supports (animation-timeline: …) { @media
 *      (prefers-reduced-motion: no-preference) { SEL {…} } }
 *      — the animation only exists where the browser can drive
 *      it from scroll AND the visitor accepts motion.
 *   3. @media (prefers-reduced-motion: reduce) { SEL { animation:
 *      none } } — an explicit stop, even if something else
 *      tried to animate the selector.
 */
function generateScrollTimelineCSS(animationType, targetSelector) {
  const key = TYPES[String(animationType == null ? '' : animationType).toLowerCase().trim()];
  if (!key) {
    throw fail('bad_input', 'Unknown animationType "' + String(animationType)
      + '". Use reveal, scale-down, or progress.');
  }
  const sel = String(targetSelector == null ? '' : targetSelector).trim().replace(/[<>{}]/g, '');
  if (!sel) throw fail('bad_input', 'targetSelector is required');

  let keyframes;
  let rule;
  if (key === 'reveal') {
    keyframes = '@keyframes pai-reveal{'
      + 'from{opacity:0;transform:translateY(24px)}'
      + 'to{opacity:1;transform:none}}';
    rule = sel + '{animation:pai-reveal linear both;'
      + 'animation-timeline:view();'
      + 'animation-range:entry 0% entry 100%}';
  } else if (key === 'scale-down') {
    keyframes = '@keyframes pai-scale-down{'
      + 'from{transform:scale(1)}'
      + 'to{transform:scale(.92)}}';
    rule = sel + '{animation:pai-scale-down linear both;'
      + 'animation-timeline:scroll();'
      + 'animation-range:0 100%}';
  } else {
    keyframes = '@keyframes pai-progress{'
      + 'from{transform:scaleX(0)}'
      + 'to{transform:scaleX(1)}}';
    rule = sel + '{transform-origin:left center;'
      + 'animation:pai-progress linear both;'
      + 'animation-timeline:scroll();'
      + 'animation-range:0 100%}';
  }

  return keyframes + '\n'
    + '@supports (animation-timeline: view()){\n'
    + '@media (prefers-reduced-motion: no-preference){\n'
    + rule + '\n'
    + '}\n'
    + '}\n'
    + '@media (prefers-reduced-motion: reduce){\n'
    + sel + '{animation:none}\n'
    + '}';
}

// ---- parallax fallback -------------------------------------------

const DEFAULT_DEPTH = 0.1;

/**
 * generateParallaxLayersScript(sensitivityMap) → inline JS, budget < 0.8KB (819 B).
 *
 * sensitivityMap = {'[data-depth="bg"]': 0.15, '[data-depth="fg"]': -0.08}
 * Depth signs: positive shifts the layer toward the viewport
 * center as it passes (background drift), negative moves with
 * the scroll (foreground rise). Zero/invalid depths are dropped.
 *
 * Mechanics: IntersectionObserver marks which layers are on
 * screen (the first callback fires for everything, visible or
 * not); scroll/resize schedule ONE rAF; the frame loop only
 * touches visible layers. Without IntersectionObserver every
 * layer counts as visible and the rAF path still runs. Under
 * prefers-reduced-motion the script returns before registering
 * anything — layers keep their authored position.
 */
function generateParallaxLayersScript(sensitivityMap) {
  if (!sensitivityMap || typeof sensitivityMap !== 'object' || !Object.keys(sensitivityMap).length) {
    throw fail('bad_input', 'generateParallaxLayersScript requires a selector → depth map');
  }
  const map = {};
  let kept = 0;
  Object.keys(sensitivityMap).forEach((sel) => {
    const d = Number(sensitivityMap[sel]);
    const s = String(sel).trim().replace(/[<>{}]/g, '');
    if (!s || !Number.isFinite(d) || d === 0) return;
    map[s] = d;
    kept++;
  });
  if (!kept) throw fail('bad_input', 'sensitivityMap has no selector with a finite, non-zero depth');
  const json = JSON.stringify(map)
    .replace(/<\//g, '<\\/')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

  return '(function(){'
    + 'var M=' + json + ';'
    + 'if(matchMedia("(prefers-reduced-motion:reduce)").matches)return;'
    + 'var L=[],k,n,i;'      + 'for(k in M){n=document.querySelectorAll(k);for(i=0;i<n.length;i++)L.push([n[i],M[k]])}'
    + 'if(!L.length)return;'
    + 'var io="IntersectionObserver" in window?'
      + 'new IntersectionObserver(function(es){'
        + 'es.forEach(function(e){e.target._pv=e.isIntersecting})}):0,'
      + 'q=0;'
    + 'function draw(){q=0;var h=innerHeight/2,j,x,r,o;'
      + 'for(j=0;j<L.length;j++){x=L[j][0];if(x._pv===false)continue;'
        + 'r=x.getBoundingClientRect();o=(h-(r.top+r.height/2))*L[j][1];'
        + 'x.style.transform="translateY("+(o|0)+"px)"}}'
    + 'function wake(){if(!q)q=requestAnimationFrame(draw)}'
    + 'addEventListener("scroll",wake,{passive:1});'
    + 'addEventListener("resize",wake,{passive:1});'
    + 'if(io)for(i=0;i<L.length;i++)io.observe(L[i][0]);'
    + 'draw()})();';
}

/* ============================================================
   3 — predefined motion classes (DeepSeek AST compiler targets)
   ------------------------------------------------------------
   The AST compiler stamps these three class names onto the HTML
   sections it emits; generateMotionClassesCSS() is the dynamic CSS
   generator that makes them move. GSAP-level scroll physics with
   zero runtime JS — the browser's scroll-driven animation engine
   does the work off the main thread.

     .motion-reveal-up    fades + slides up on viewport entry
     .motion-parallax-bg  background drifts slower than the scroll
     .motion-kinetic-text type travels horizontally, driven by
                          vertical scroll distance

   Every class is assembled from the same six layers, in order:

     1. @keyframes            inert until an animation references it
     2. scaffolding (if any)  ungated static structure
     3. @supports not (animation-timeline: view()) — the graceful
        fallback: the target is pinned to its authored, fully
        visible state, so browsers without scroll-driven CSS
        animations render a complete page, never a hidden one
     4. @scroll-timeline + animation-timeline: --motion-* — the
        original named-timeline API, for engines that shipped it
     5. animation-timeline: view() + animation-range — the shipped
        scroll-driven API. Layers 4 and 5 both sit behind @supports
        and @media (prefers-reduced-motion: no-preference); layer 5
        wins wherever both parse, because it comes later at
        identical specificity
     6. @media (prefers-reduced-motion: reduce) — an explicit
        animation:none stop, even if another sheet tried to animate
        the target.

   Namespace hygiene (no global conflicts, CSS or JS): keyframes are
   `pai-motion-*`, named timelines are `--motion-*` dashed idents,
   and every effect reads its travel distance from a custom property
   (--motion-rise / --motion-depth / --motion-shift) so the compiler
   tunes sections with inline styles instead of regenerating the
   sheet. This file itself is CommonJS module scope — no globals.

   Ownership contract: these classes own `transform` (and `opacity`)
   on their targets — never author another transform on the same
   element — and the kinetic band should be clipped (overflow: hidden
   on its section, or overflow-x: clip on the root) so the
   plus/minus --motion-shift travel never adds a horizontal scrollbar.
   ============================================================ */

// classKey → spec. MOTION_CLASSES below is derived from this table
// so the public metadata can never drift from the emitted CSS.
const MOTION_SPECS = {
  'reveal-up': {
    className: 'motion-reveal-up',
    keyframeName: 'pai-motion-reveal-up',
    timelineName: '--motion-reveal-up',
    targetSuffix: '',
    knob: '--motion-rise',
    knobDefault: '28px',
    blurb: 'Fades and slides elements up as they enter the viewport.',
    // Entry phase: hidden below its travel distance, settled once inside.
    keyframes: 'from{opacity:0;transform:translate3d(0,var(--motion-rise,28px),0)}'
      + 'to{opacity:1;transform:none}',
    legacyOffsets: 'entry 0%, entry 100%',
    modernRange: 'entry 0% entry 100%',
    fallback: 'opacity:1;transform:none',
    scaffold: []
  },
  'parallax-bg': {
    className: 'motion-parallax-bg',
    keyframeName: 'pai-motion-parallax-bg',
    timelineName: '--motion-parallax-bg',
    targetSuffix: '::before',
    knob: '--motion-depth',
    knobDefault: '5vh',
    blurb: 'Moves background images at a slower rate than the scroll speed.',
    // The background lives on an oversized ::before that counter-drifts
    // across the element's whole traversal (cover 0% to cover 100%), so
    // the image lags the scroll instead of locking to it. Bigger
    // --motion-depth = slower apparent background.
    keyframes: 'from{transform:translate3d(0,calc(var(--motion-depth,5vh)*-1),0)}'
      + 'to{transform:translate3d(0,var(--motion-depth,5vh),0)}',
    legacyOffsets: 'cover 0%, cover 100%',
    modernRange: 'cover 0% cover 100%',
    fallback: 'transform:none',
    // Scaffolding is ungated: the ::before exists everywhere (and the
    // section stays position: relative) so unsupported browsers still
    // paint the background — statically, via `background: inherit`,
    // which copies the author's image/size/position onto the layer.
    // The overscan is exactly the drift depth, so the travel never
    // reveals an edge. The section's own background stays put beneath
    // as paint insurance; the opaque ::before covers it.
    scaffold: [
      ['', 'position:relative'],
      ['::before', "content:'';position:absolute;"
        + 'inset:calc(var(--motion-depth,5vh)*-1) 0;'
        + 'z-index:-1;background:inherit']
    ]
  },
  'kinetic-text': {
    className: 'motion-kinetic-text',
    keyframeName: 'pai-motion-kinetic-text',
    timelineName: '--motion-kinetic-text',
    targetSuffix: '',
    knob: '--motion-shift',
    knobDefault: '8vw',
    blurb: 'Horizontally scrolls large typographic elements with vertical scroll distance.',
    // Horizontal travel right-to-left across the element's vertical
    // traversal of the viewport — the view timeline is itself pure
    // scroll distance, so type position is a direct function of how
    // far the visitor has scrolled.
    keyframes: 'from{transform:translate3d(var(--motion-shift,8vw),0,0)}'
      + 'to{transform:translate3d(calc(var(--motion-shift,8vw)*-1),0,0)}',
    legacyOffsets: 'cover 0%, cover 100%',
    modernRange: 'cover 0% cover 100%',
    fallback: 'transform:none',
    scaffold: []
  }
};

// Public metadata — what the AST compiler needs to attach motion:
// the class string, the timeline that drives it, its range, and the
// tuning knob it can set per section as an inline custom property.
const MOTION_CLASSES = Object.keys(MOTION_SPECS).map((key) => {
  const s = MOTION_SPECS[key];
  return {
    key: key,
    className: s.className,
    timeline: 'view()',
    range: s.modernRange,
    knob: s.knob,
    knobDefault: s.knobDefault,
    blurb: s.blurb
  };
});

// Editor/shorthand names → canonical class keys (the same aliasing
// convention generateScrollTimelineCSS uses above).
const MOTION_ALIASES = {
  'reveal-up': 'reveal-up', reveal: 'reveal-up', 'fade-up': 'reveal-up', rise: 'reveal-up',
  'parallax-bg': 'parallax-bg', parallax: 'parallax-bg', background: 'parallax-bg', bg: 'parallax-bg',
  'kinetic-text': 'kinetic-text', kinetic: 'kinetic-text', text: 'kinetic-text', marquee: 'kinetic-text'
};

/**
 * generateMotionClassCSS(classKey, options) → CSS text (one class).
 *
 * classKey — 'reveal-up' | 'parallax-bg' | 'kinetic-text' (aliases in
 *            MOTION_ALIASES are accepted; input is normalized first).
 * options  — { scope, legacy }
 *   scope   container selector to scope the class under, e.g. '#hero'
 *           emits '#hero .motion-reveal-up'. Tags and block delimiters
 *           are stripped so a dirty scope cannot escape its rules.
 *   legacy  false to skip the @scroll-timeline named-timeline layer
 *           (default: include it — it costs nothing where unknown).
 */
function generateMotionClassCSS(classKey, options) {
  const key = MOTION_ALIASES[String(classKey == null ? '' : classKey)
    .toLowerCase().trim().replace(/[\s_]+/g, '-')];
  if (!key) {
    throw fail('bad_input', 'Unknown motion class "' + String(classKey)
      + '". Use reveal-up, parallax-bg, or kinetic-text.');
  }
  const spec = MOTION_SPECS[key];
  const opts = (options && typeof options === 'object') ? options : {};
  const scope = String(opts.scope == null ? '' : opts.scope).trim().replace(/[<>{};]/g, '');
  // className is the bare class token (what the compiler writes into
  // class="" attributes); the selector adds the dot.
  const sel = (scope ? scope + ' ' : '') + '.' + spec.className;
  const target = sel + spec.targetSuffix;

  const out = [];
  out.push('/* ' + spec.className + ' — ' + spec.blurb + ' */');

  // (1) keyframes — inert on their own.
  out.push('@keyframes ' + spec.keyframeName + '{' + spec.keyframes + '}');

  // (2) scaffolding — ungated static structure (parallax layer only).
  spec.scaffold.forEach((part) => out.push(sel + part[0] + '{' + part[1] + '}'));

  // (3) graceful fallback — authored state, pinned. This sits before
  // the animation layers deliberately: an active CSS animation always
  // outranks normal declarations, so the pins only take effect where
  // no scroll-driven animation can run. transform:none here is the
  // authored look (centered), not the animation end state.
  out.push('@supports not (animation-timeline: view()){');
  out.push(target + '{' + spec.fallback + '}');
  out.push('}');

  // (4) original @scroll-timeline API — the at-rule is a named
  // timeline; browsers that never knew it drop the whole block. The
  // gate tests the named-reference syntax, which parses in every
  // timeline-capable engine (legacy or shipped) and nowhere else.
  if (opts.legacy !== false) {
    out.push('@scroll-timeline ' + spec.timelineName
      + '{source:auto;orientation:block;scroll-offsets:' + spec.legacyOffsets + '}');
    out.push('@supports (animation-timeline: ' + spec.timelineName + '){');
    out.push('@media (prefers-reduced-motion: no-preference){');
    // Longhands AFTER the animation shorthand — the shorthand resets
    // animation-timeline to auto if it comes last.
    out.push(target + '{animation:' + spec.keyframeName + ' linear both;will-change:transform;'
      + 'animation-timeline:' + spec.timelineName + '}');
    out.push('}');
    out.push('}');
  }

  // (5) shipped scroll-driven API — view() progress maps the target's
  // vertical traversal of the viewport onto the keyframes.
  out.push('@supports (animation-timeline: view()){');
  out.push('@media (prefers-reduced-motion: no-preference){');
  out.push(target + '{animation:' + spec.keyframeName + ' linear both;will-change:transform;'
    + 'animation-timeline:view();animation-range:' + spec.modernRange + '}');
  out.push('}');
  out.push('}');

  // (6) explicit reduced-motion stop — last, so it wins the cascade
  // against any stray animation aimed at the same target.
  out.push('@media (prefers-reduced-motion: reduce){' + target + '{animation:none}}');

  return out.join('\n');
}

/**
 * generateMotionClassesCSS(options) → the complete sheet: all three
 * predefined motion classes, same options as generateMotionClassCSS.
 * Output is deterministic (same input, same bytes).
 */
function generateMotionClassesCSS(options) {
  const sheet = MOTION_CLASSES
    .map((m) => generateMotionClassCSS(m.key, options))
    .join('\n\n');
  return '/* PallettAI Studio — scroll-motion classes (generated; deterministic).\n'
    + '   Per-section tuning knobs (inline style on the section):\n'
    + '     --motion-rise   reveal-up entry travel (default 28px)\n'
    + '     --motion-depth  parallax-bg counter-drift (default 5vh)\n'
    + '     --motion-shift  kinetic-text horizontal travel (default 8vw)\n'
    + '   Clip the kinetic band (overflow: hidden on its section) so the\n'
    + '   travel never adds a horizontal scrollbar. */\n'
    + sheet + '\n';
}

module.exports = {
  generateScrollTimelineCSS,
  generateParallaxLayersScript,
  MOTION_CLASSES,
  generateMotionClassCSS,
  generateMotionClassesCSS
};
