'use strict';
// ============================================================
// PallettAI Studio — scroll-motion predefined motion classes
// ------------------------------------------------------------
// The §3 deliverable of modules/scroll-motion.js: the three class
// contracts the DeepSeek AST compiler attaches to HTML sections
// and the dynamic CSS generator behind them. Checked where they
// could break:
//
//   1. Surface — exactly three predefined classes with the required
//      names, metadata that matches the emitted CSS, and zero JS
//      globals created at require time.
//   2. Sheet shape — BOTH scroll CSS APIs present (named
//      @scroll-timeline at-rule + animation-timeline: view()),
//      the six-layer contract per class (inert keyframes, scaffold,
//      @supports-not fallback, legacy layer, shipped layer, explicit
//      reduced-motion stop) in that order, longhands after the
//      animation shorthand, balanced braces, no markup characters.
//   3. Effect contracts — reveal entry range, parallax ::before
//      inherit/overscan scaffold, kinetic right-to-left travel and
//      cover ranges, tuning knobs readable from custom properties.
//   4. Options — scope prefixing + sanitization, legacy:false drop,
//      alias byte-identity, bad_input throws, determinism, byte
//      budget, and a regression guard that the §1/§2 API is
//      untouched.
//
// Usage: node scripts/scroll-motion-classes-smoke.js   (exit 0 = green)
// ============================================================

let fails = 0;
let total = 0;
const ok = (cond, label) => {
  total++;
  console.log((cond ? '  ok   ' : '  FAIL ') + label);
  if (!cond) fails++;
};
const section = (title) => console.log('\n== ' + title + ' ==');
const balanced = (css) => (css.match(/{/g) || []).length === (css.match(/}/g) || []).length;
const throwsCode = (fn, code) => {
  try { fn(); return false; } catch (e) { return e.code === code; }
};

// ============================================================
section('1. surface — three classes, zero globals');
// ============================================================

// Snapshot the global surface BEFORE the module loads: the engine must
// be CommonJS module scope only — no window/global leakage.
const gBefore = Object.keys(global).length;
const scroll = require('../modules/scroll-motion.js');
ok(Object.keys(global).length === gBefore, 'requiring the module creates no JS globals');

ok(Array.isArray(scroll.MOTION_CLASSES) && scroll.MOTION_CLASSES.length === 3,
  'exactly three predefined motion classes');
const names = scroll.MOTION_CLASSES.map((m) => m.className).sort();
ok(JSON.stringify(names) ===
  JSON.stringify(['motion-kinetic-text', 'motion-parallax-bg', 'motion-reveal-up']),
  'class names are the three required contracts');
const keys = scroll.MOTION_CLASSES.map((m) => m.key);
ok(JSON.stringify(keys) === JSON.stringify(['reveal-up', 'parallax-bg', 'kinetic-text']),
  'class order is stable (reveal-up, parallax-bg, kinetic-text)');
scroll.MOTION_CLASSES.forEach((m) => {
  ok(m.className === 'motion-' + m.key, m.key + ': className derives from key');
  ok(typeof m.blurb === 'string' && m.blurb.length > 10, m.key + ': blurb present');
  ok(/^--motion-/.test(m.knob), m.key + ': tuning knob is a --motion-* custom property');
  ok(typeof m.knobDefault === 'string' && m.knobDefault.length > 0, m.key + ': knob default present');
  ok(typeof m.range === 'string' && m.range.indexOf('%') > -1, m.key + ': scroll range present');
});

// ============================================================
section('2. sheet shape — both APIs, six-layer contract');
// ============================================================

const ALL = scroll.generateMotionClassesCSS();
ok(ALL.indexOf('@scroll-timeline') > -1, 'named @scroll-timeline API emitted');
ok(ALL.indexOf('animation-timeline:view()') > -1, 'shipped animation-timeline API emitted');
ok(ALL.indexOf('animation-timeline:--motion-') > -1, 'named timeline references emitted');
ok((ALL.match(/@scroll-timeline /g) || []).length === 3, 'one named timeline per class');
ok((ALL.match(/@keyframes /g) || []).length === 3, 'one keyframes block per class');
ok((ALL.match(/@keyframes pai-motion-/g) || []).length === 3,
  'keyframes namespaced pai-motion-* (no CSS global collisions)');
ok((ALL.match(/@media \(prefers-reduced-motion: no-preference\)\{/g) || []).length === 6,
  'both animation layers gated on no-preference (2 per class)');
ok((ALL.match(/\{animation:none\}/g) || []).length === 3,
  'explicit reduce stop targets every class');
ok(balanced(ALL), 'braces balanced across the whole sheet');
ok(ALL.indexOf('<') === -1 && ALL.indexOf('>') === -1,
  'generated sheet carries no markup characters');

// The shorthand-reset gotcha: animation-timeline must come AFTER the
// animation shorthand in every animated rule, or it resets to auto.
ok(/animation:[a-z-]+ linear both;[^}]*animation-timeline:/.test(ALL),
  'longhands follow the animation shorthand (timeline not reset)');

['reveal-up', 'parallax-bg', 'kinetic-text'].forEach((key) => {
  const css = scroll.generateMotionClassCSS(key);
  const fall = css.indexOf('@supports not (animation-timeline: view())');
  const legacy = css.indexOf('@supports (animation-timeline: --motion-');
  const modern = css.indexOf('@supports (animation-timeline: view())');
  const reduce = css.indexOf('@media (prefers-reduced-motion: reduce)');
  const kf = css.indexOf('@keyframes');
  ok(kf > -1 && kf < fall, key + ': inert keyframes come first');
  ok(fall > -1, key + ': @supports-not graceful fallback present');
  ok(legacy > fall, key + ': legacy @scroll-timeline layer after the fallback');
  ok(modern > legacy, key + ': shipped layer after the legacy layer (wins the cascade)');
  ok(reduce > modern, key + ': explicit reduce stop is last');
  ok(css.indexOf('{animation:none}') > -1, key + ': reduce forces animation:none');
  ok(balanced(css), key + ': braces balanced');
});

// ============================================================
section('3. effect contracts — ranges, scaffolds, knobs');
// ============================================================

const reveal = scroll.generateMotionClassCSS('reveal-up');
ok(reveal.indexOf('@keyframes pai-motion-reveal-up{from{opacity:0;') > -1,
  'reveal keyframes start hidden (opacity 0)');
ok(reveal.indexOf('var(--motion-rise,28px)') > -1, 'reveal travel reads --motion-rise');
ok(reveal.indexOf('to{opacity:1;transform:none}') > -1, 'reveal settles fully visible');
ok(reveal.indexOf('animation-range:entry 0% entry 100%') > -1,
  'reveal tied to the entry phase of view()');
ok(reveal.indexOf('scroll-offsets:entry 0%, entry 100%') > -1,
  'legacy timeline carries the same entry offsets');
ok(reveal.indexOf('.motion-reveal-up{opacity:1;transform:none}') > -1,
  'fallback pins the authored, fully visible state');

const parallax = scroll.generateMotionClassCSS('parallax-bg');
ok(parallax.indexOf('.motion-parallax-bg{position:relative}') > -1,
  'parallax scaffold anchors its layer');
ok(parallax.indexOf(".motion-parallax-bg::before{content:'';position:absolute;") > -1,
  'parallax background lives on an oversized ::before');
ok(parallax.indexOf('inset:calc(var(--motion-depth,5vh)*-1) 0') > -1,
  'overscan equals the drift depth (no edge reveal)');
ok(parallax.indexOf('z-index:-1;background:inherit') > -1,
  'layer inherits the authored background, paints under content');
ok(parallax.indexOf('animation: pai-motion-parallax-bg') === -1
  && parallax.indexOf('animation:pai-motion-parallax-bg linear both') > -1,
  'animation drives the ::before target');
ok(parallax.indexOf('.motion-parallax-bg::before{animation:pai-motion-parallax-bg') > -1,
  'animation attaches to the ::before, not the section');
ok(parallax.indexOf('animation-range:cover 0% cover 100%') > -1,
  'parallax runs across the whole traversal (cover range)');
ok(parallax.indexOf('scroll-offsets:cover 0%, cover 100%') > -1,
  'legacy parallax timeline covers the same range');

const kinetic = scroll.generateMotionClassCSS('kinetic-text');
ok(kinetic.indexOf('from{transform:translate3d(var(--motion-shift,8vw),0,0)}') > -1,
  'kinetic text starts shifted right by --motion-shift');
ok(kinetic.indexOf('to{transform:translate3d(calc(var(--motion-shift,8vw)*-1),0,0)}') > -1,
  'kinetic text travels left as vertical scroll advances');
ok(kinetic.indexOf('animation-range:cover 0% cover 100%') > -1,
  'kinetic travel tied to vertical scroll distance (cover range)');
ok(kinetic.indexOf('animation-timeline:view()') > -1,
  'kinetic travel driven by the view() timeline');
ok(kinetic.indexOf('.motion-kinetic-text{transform:none}') > -1,
  'fallback re-centers the type (authored position)');

// ============================================================
section('4. options — scope, legacy, aliases, determinism');
// ============================================================

const scoped = scroll.generateMotionClassesCSS({ scope: '#hero' });
ok(scoped.indexOf('#hero .motion-reveal-up{') > -1, 'scope prefixes class rules');
ok(scoped.indexOf('#hero .motion-parallax-bg::before{') > -1, 'scope prefixes scaffold layers');
ok(scoped.indexOf('#hero .motion-kinetic-text{transform:none}') > -1, 'scope prefixes fallback pins');

const dirty = scroll.generateMotionClassesCSS({ scope: '<style>.x{;}</style>' });
ok(dirty.indexOf('<') === -1 && dirty.indexOf('>') === -1 && balanced(dirty),
  'dirty scope sanitized (tags, braces, semicolons stripped)');

const noLegacy = scroll.generateMotionClassesCSS({ legacy: false });
ok(noLegacy.indexOf('@scroll-timeline') === -1, 'legacy:false drops the named-timeline layer');
ok(noLegacy.indexOf('animation-timeline:--motion-') === -1, 'legacy:false drops named references');
ok(noLegacy.indexOf('animation-timeline:view()') > -1, 'legacy:false keeps the shipped layer');

ok(scroll.generateMotionClassCSS('parallax') === scroll.generateMotionClassCSS('parallax-bg'),
  "'parallax' aliases to parallax-bg byte-identically");
ok(scroll.generateMotionClassCSS('kinetic') === scroll.generateMotionClassCSS('kinetic-text'),
  "'kinetic' aliases to kinetic-text byte-identically");
ok(scroll.generateMotionClassCSS('reveal') === scroll.generateMotionClassCSS('reveal-up'),
  "'reveal' aliases to reveal-up byte-identically");
ok(scroll.generateMotionClassCSS('PARALLAX_BG') === scroll.generateMotionClassCSS('parallax-bg'),
  'class keys normalize case, spaces and underscores');

ok(throwsCode(() => scroll.generateMotionClassCSS('parallaxx'), 'bad_input'),
  'unknown class key throws bad_input');
ok(throwsCode(() => scroll.generateMotionClassCSS(''), 'bad_input'), 'empty key throws bad_input');
ok(throwsCode(() => scroll.generateMotionClassCSS(null), 'bad_input'), 'null key throws bad_input');

ok(scroll.generateMotionClassesCSS() === scroll.generateMotionClassesCSS(),
  'generator output is deterministic (byte-stable)');
console.log('  (sheet: ' + ALL.length + ' B, budget 8192)');
ok(ALL.length < 8192, 'all three classes ship under 8KB');

// Regression guard: §1/§2 of the module must be untouched by §3.
const oldApi = scroll.generateScrollTimelineCSS('reveal', '.card');
ok(oldApi.indexOf('@keyframes pai-reveal') > -1
  && oldApi.indexOf('animation-timeline:view()') > -1,
  'generateScrollTimelineCSS still emits its reveal timeline');
const oldPara = scroll.generateParallaxLayersScript({ '[data-depth="bg"]': 0.15 });
ok(oldPara.length < 819 && oldPara.indexOf('IntersectionObserver') > -1,
  'generateParallaxLayersScript still ships its sub-0.8KB fallback');

console.log('\n' + (total - fails) + '/' + total + ' checks passed'
  + (fails ? ' — ' + fails + ' FAILED' : ' — ALL PASS'));
process.exit(fails ? 1 : 0);
