#!/usr/bin/env node
// ============================================================
// PallettAI Studio — Design System v6 smoke runner
//
// Covers the four v6 modules:
//   1. modules/component-library.js   (8 component types × 6 archetypes)
//   2. modules/fluid-typography.js    (clamp algebra + modular scales)
//   3. modules/surface-shaders.js     (glass / neumorphic / clay, OKLCH)
//   4. modules/stylebook-generator.js (interactive /styleguide.html)
//
// Plus a cross-module composition suite: type tokens + component
// CSS + surface shaders compose into one stylesheet with balanced
// braces and zero duplicate top-level selectors, and the
// stylebook embeds each archetype's real component CSS.
//
// Run: node scripts/design-advanced-v6-smoke.js
// ============================================================
'use strict';

const path = require('path');
const ComponentLibrary = require(path.join(__dirname, '..', 'modules', 'component-library.js'));
const FluidTypography = require(path.join(__dirname, '..', 'modules', 'fluid-typography.js'));
const SurfaceShaders = require(path.join(__dirname, '..', 'modules', 'surface-shaders.js'));
const StylebookGenerator = require(path.join(__dirname, '..', 'modules', 'stylebook-generator.js'));

let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond) {
  if (cond) { pass++; return; }
  fail++;
  failures.push(name);
  console.log('  ✗ ' + name);
}

function section(title) {
  console.log('\n— ' + title);
}

function balanced(css) {
  return (css.match(/{/g) || []).length === (css.match(/}/g) || []).length;
}

/** Top-level (non-@media) selectors of a CSS string. */
function topSelectors(css) {
  const noMedia = css.replace(/@media[^{]+\{(?:[^{}]|\{[^{}]*\})*\}/g, '');
  const out = [];
  const re = /^([^{}\n]+)\{/gm;
  let m;
  while ((m = re.exec(noMedia))) {
    const sel = m[1].trim();
    if (sel) out.push(sel);
  }
  return out;
}

function duplicates(list) {
  const seen = new Set();
  const dup = new Set();
  for (const s of list) {
    if (seen.has(s)) dup.add(s);
    seen.add(s);
  }
  return Array.from(dup);
}

/* ============================================================
 * 1. Component library
 * ============================================================ */
section('component-library: full 8 × 6 matrix');

const TYPES = ComponentLibrary.COMPONENT_TYPES;
check('8 component types declared', TYPES.length === 8 &&
  ['accordion', 'modal', 'tabs', 'segmented', 'tooltip', 'dropdown', 'input', 'switch'].every(t => TYPES.includes(t)));
check('6 archetypes declared', ComponentLibrary.ARCHETYPES.length === 6);

for (const type of TYPES) {
  for (const arch of ComponentLibrary.ARCHETYPES) {
    const r = ComponentLibrary.generateComponentTokens(type, arch);
    check(type + '/' + arch + ' compiles', r.ok === true &&
      typeof r.css === 'string' && r.css.length > 200 && balanced(r.css) &&
      r.css.includes('.' + r.classBase));
  }
}

section('component-library: archetype signatures (on the components that carry them)');

const SIGNATURES = [
  ['brutalist-kinetic', 'accordion', ['--pai-accordion-radius: 0px', 'ui-monospace', 'uppercase', '6px 6px 0 0', 'steps(']],
  ['bento-glass', 'modal', ['backdrop-filter: blur(12px)', '-webkit-backdrop-filter', 'cubic-bezier']],
  ['organic-clay', 'switch', ['9999px', 'inset 0 2px 3px']],
  ['editorial-magazine', 'input', ['letter-spacing: 0.12em']],
  ['retro-cyberpunk', 'dropdown', ['clip-path: polygon(', '0 0 18px', '0 0 40px']],
  ['neo-minimalist', 'input', ['1px solid transparent']]
];
for (const [arch, type, needles] of SIGNATURES) {
  const css = ComponentLibrary.generateComponentTokens(type, arch).css;
  for (const n of needles) check(arch + ' ' + type + ' has ' + JSON.stringify(n), css.includes(n));
}
check('cyberpunk tabs carry the clipped-corner treatment',
  ComponentLibrary.generateComponentTokens('tabs', 'retro-cyberpunk').css.includes('clip-path: polygon('));
check('brutalist tabs use the hard-offset indicator shadow',
  ComponentLibrary.generateComponentTokens('tabs', 'brutalist-kinetic').css.includes('3px 3px 0 0'));

section('component-library: interactivity contracts');

const bentoTabs = ComponentLibrary.generateComponentTokens('tabs', 'bento-glass').css;
check('gliding indicator is custom-property driven', bentoTabs.includes('--pai-tabs-count') && bentoTabs.includes('--pai-tabs-active'));
check('indicator moves by transform only (no layout thrash)', bentoTabs.includes('translateX(calc(var(--pai-tabs-active'));
check('tabs fall back to filled state without an indicator element', bentoTabs.includes(':not(:has('));
check('segmented control inherits tabs and pillifies', (() => {
  const css = ComponentLibrary.generateComponentTokens('segmented', 'organic-clay').css;
  return css.split('9999px').length > 2 && css.includes('.pai-segmented');
})());
check('input validation error glow wired to aria-invalid',
  ComponentLibrary.generateComponentTokens('input', 'retro-cyberpunk').css.includes('aria-invalid'));
check('switch checkmark uses a clip-path glyph',
  ComponentLibrary.generateComponentTokens('switch', 'organic-clay').css.includes('clip-path: polygon(14% 44%'));
check('focus-visible rings on every interactive component',
  ['modal', 'tabs', 'dropdown', 'input', 'switch', 'accordion'].every(t =>
    ComponentLibrary.generateComponentTokens(t, 'neo-minimalist').css.includes(':focus-visible')));
check('accordion animates via grid-template-rows 0fr→1fr',
  ComponentLibrary.generateComponentTokens('accordion', 'neo-minimalist').css.includes('grid-template-rows: 0fr'));
check('open accordion lifts with the archetype elevation',
  ComponentLibrary.generateComponentTokens('accordion', 'brutalist-kinetic').css.includes('data-open="true"]{ box-shadow: 6px 6px 0 0'));
check('modal styles the native ::backdrop',
  ComponentLibrary.generateComponentTokens('modal', 'bento-glass').css.includes('::backdrop'));
check('tooltip reveal uses transition-delay',
  ComponentLibrary.generateComponentTokens('tooltip', 'bento-glass').css.includes('transition-delay: 120ms'));
check('animated components carry reduced-motion guards',
  ['accordion', 'modal', 'tabs', 'tooltip', 'dropdown', 'switch'].every(t =>
    ComponentLibrary.generateComponentTokens(t, 'brutalist-kinetic').css.includes('prefers-reduced-motion')));

section('component-library: hygiene, rejections, aliases');

check('no colour literals outside token fallbacks',
  !/#[0-9a-f]{3,8}\b/i.test(bentoTabs.replace(/var\(--[^)]*,\s*#[0-9a-f]+\)/gi, '')));
check('unknown component type rejected', ComponentLibrary.generateComponentTokens('carousel', 'bento-glass').ok === false);
check('unknown archetype rejected', ComponentLibrary.generateComponentTokens('tabs', 'brutalism').ok === false);
check('alias "clay" canonicalises', ComponentLibrary.generateComponentTokens('tabs', 'Clay').archetype === 'organic-clay');
check('alias "dialog" maps to modal', ComponentLibrary.generateComponentTokens('dialog', 'glass').componentType === 'modal');
const allBrut = ComponentLibrary.generateAll('brutalist-kinetic');
check('generateAll returns all 8 with summed bytes',
  allBrut.ok && Object.keys(allBrut.components).length === 8 &&
  allBrut.totalBytes === Object.values(allBrut.components).reduce((s, c) => s + c.byteLength, 0));

/* ============================================================
 * 2. Fluid typography
 * ============================================================ */
section('fluid-typography: exact clamp() algebra');

const RANGES = [[320, 1440], [360, 1280], [390, 1728], [375, 1024]];
let worst = 0;
for (const [mn, mx] of RANGES) {
  const r = FluidTypography.calculateFluidClamp(16, 28, mn, mx);
  check('clamp ok over ' + mn + '–' + mx, r.ok === true);
  const atMin = FluidTypography.evaluateClampAt(r.clamp, mn);
  const atMax = FluidTypography.evaluateClampAt(r.clamp, mx);
  check('endpoints exact over ' + mn + '–' + mx, Math.abs(atMin - 16) < 0.01 && Math.abs(atMax - 28) < 0.01);
  worst = Math.max(worst, Math.abs(atMin - 16), Math.abs(atMax - 28));
  const mid = FluidTypography.evaluateClampAt(r.clamp, (mn + mx) / 2);
  check('midpoint strictly between over ' + mn, mid > 16 && mid < 28);
}
check('worst endpoint error under 0.01px', worst < 0.01);

const std = FluidTypography.calculateFluidClamp(16, 28, 320, 1440);
check('known slope 1.0714vw', Math.abs(std.slopeVw - 1.0714) < 1e-9);
check('known intercept 0.7857rem', Math.abs(std.interceptRem - 0.7857) < 1e-9);
check('exact canonical string', std.clamp === 'clamp(1rem, 0.7857rem + 1.0714vw, 1.75rem)');
check('clean clamp string shape', /^clamp\([\d.]+rem, [-\d.]+rem \+ [\d.]+vw, [\d.]+rem\)$/.test(std.clamp));
check('hard floor below min viewport', FluidTypography.evaluateClampAt(std.clamp, 200) === 16);
check('hard cap above max viewport', FluidTypography.evaluateClampAt(std.clamp, 2400) === 28);
check('classic 0.8rem + 1vw case exact',
  FluidTypography.calculateFluidClamp(16, 27.2, 320, 1440).clamp === 'clamp(1rem, 0.8rem + 1vw, 1.7rem)');
check('flat size yields flat clamp', FluidTypography.calculateFluidClamp(18, 18, 320, 1440).flat === true);
check('inverted min/max normalized with flag', FluidTypography.calculateFluidClamp(28, 16, 320, 1440).normalized === true);
check('inverted viewport rejected', FluidTypography.calculateFluidClamp(16, 28, 1440, 320).ok === false);
check('non-finite sizes rejected', FluidTypography.calculateFluidClamp(NaN, 28, 320, 1440).ok === false);
check('unparseable clamp evaluates to null', FluidTypography.evaluateClampAt('clamp(1rem, garbage, 2rem)', 800) === null);

section('fluid-typography: modular scales');

for (const ratio of ['golden', 'fourth', 'third']) {
  const s = FluidTypography.generateModularScale(16, ratio, 6);
  check(ratio + ' scale builds', s.ok === true && Array.isArray(s.scale));
  check(ratio + ' role order caption→display',
    s.scale.map(x => x.role).join(',') === 'caption,small,body,h6,h5,h4,h3,h2,h1,display');
  let ascending = true;
  for (let i = 0; i < s.scale.length - 1; i++) {
    if (s.scale[i].maxPx > s.scale[i + 1].maxPx + 0.01) ascending = false;
  }
  check(ratio + ' hierarchy strictly ascending', ascending);
  check(ratio + ' body pinned to base', s.scale.find(x => x.role === 'body').maxPx === 16);
  check(ratio + ' h1 hits exact ratio^6',
    Math.abs(s.scale.find(x => x.role === 'h1').maxPx - 16 * Math.pow(s.ratio, 6)) < 0.02);
  check(ratio + ' display stays fluid', s.scale.find(x => x.role === 'display').minPx < s.scale.find(x => x.role === 'display').maxPx);
  const cap = s.scale.find(x => x.role === 'caption');
  check(ratio + ' caption floored at 11px flat (legibility)', Math.abs(cap.minPx - 11) < 0.01 && Math.abs(cap.maxPx - 11) < 0.01);
}
const golden = FluidTypography.generateModularScale(16, 'golden', 6);
check('golden h1 = 16 · 1.618^6', Math.abs(golden.scale.find(x => x.role === 'h1').maxPx - 16 * Math.pow(1.618, 6)) < 0.02);
check('heading line heights tighten monotonically as type grows',
  golden.scale.filter(x => x.step > 0).map(x => x.lineHeight)
    .every((lh, i, arr) => i === 0 || lh <= arr[i - 1]));
check('body is the roomiest line height; display the tightest',
  golden.scale.find(x => x.role === 'body').lineHeight === 1.6 &&
  golden.scale.find(x => x.role === 'display').lineHeight === 1.05);
check('numeric ratio accepted', FluidTypography.generateModularScale(16, 1.414, 4).ratio === 1.414);
check('string numeric ratio accepted', FluidTypography.generateModularScale(16, '1.5', 4).ok === true);
check('unknown ratio rejected', FluidTypography.generateModularScale(16, 'nope', 4).ok === false);
check('non-positive base rejected', FluidTypography.generateModularScale(-3, 'golden').ok === false);

section('fluid-typography: token bundle');

const tokens = FluidTypography.buildFluidTypeTokens({ baseSizePx: 16, scaleRatio: 'fourth' });
check('token bundle builds', tokens.ok === true);
check('t-shirt sizes emitted', ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', 'hero']
  .every(s => tokens.css.includes('--font-size-' + s + ':')));
check('semantic role aliases emitted', tokens.css.includes('--font-size-display:') && tokens.css.includes('--font-size-caption:'));
check('unitless line-height tokens', tokens.css.includes('--line-height-body: 1.6'));
check('tracking tokens', tokens.css.includes('--tracking-display: -0.02em'));
check('bundle is one balanced :root block', tokens.css.startsWith(':root {') && balanced(tokens.css));

/* ============================================================
 * 3. Surface shaders
 * ============================================================ */
section('surface-shaders: OKLCH plumbing');

const parsed = SurfaceShaders.parseOKLCH('oklch(0.62 0.19 25.6)');
check('parses oklch() strings', parsed.ok && parsed.l === 0.62 && Math.abs(parsed.h - 25.6) < 1e-9 && parsed.alpha === 1);
check('parses alpha channel', SurfaceShaders.parseOKLCH('oklch(0.5 0.1 180 / 0.4)').alpha === 0.4);
check('parses object form', SurfaceShaders.parseOKLCH({ l: 0.7, c: 0.12, h: 280 }).ok === true);
check('rejects non-oklch colour strings', SurfaceShaders.parseOKLCH('red').ok === false);
check('hue wraps into [0, 360)', SurfaceShaders.parseOKLCH({ l: 0.5, c: 0.1, h: 420 }).h === 60);
const outOfGamut = SurfaceShaders.oklchToHex('oklch(0.55 0.3 29)');
check('gamut mapping keeps hue (not hard-clamped to pure red)', /^#[0-9a-f]{6}$/.test(outOfGamut || '') && outOfGamut !== '#ff0000');

section('surface-shaders: glassmorphism');

const glass = SurfaceShaders.generateGlassmorphismCSS(16, 0.55, 0.4);
check('glass builds', glass.ok === true);
check('blur + saturate + -webkit- prefix',
  glass.css.includes('backdrop-filter: blur(16px) saturate(1.4)') && glass.css.includes('-webkit-backdrop-filter'));
check('SVG fractal-noise grain embedded', glass.css.includes('data:image/svg+xml') && glass.css.includes('feTurbulence'));
check('sub-pixel (0.5px) edge highlight', glass.css.includes('inset 0 0 0 0.5px'));
check('top rim, bottom occlusion, ambient drop layers',
  glass.css.includes('inset 0 1px 0 0') && glass.css.includes('inset 0 -1px 0 0') && glass.css.includes('0 8px 32px'));
check('colour emitted in OKLCH', (glass.css.match(/oklch\(/g) || []).length >= 3);
check('derived swatches carry hex equivalents', !!(glass.derived.tint.hex && glass.derived.edge.hex && glass.derived.ink.hex));
check('blur clamped at 40px', SurfaceShaders.generateGlassmorphismCSS(999, 0.5, 0.4).blurPx === 40);
check('zero blur drops the filter entirely', !SurfaceShaders.generateGlassmorphismCSS(0, 0.5, 0.4).css.includes('backdrop-filter'));
check('custom selector honoured', SurfaceShaders.generateGlassmorphismCSS(12, 0.5, 0.4, { selector: '.card-glass' }).selector === '.card-glass');
check('glass braces balanced', balanced(glass.css));

section('surface-shaders: neumorphism');

const neuRaised = SurfaceShaders.generateNeumorphicCSS(6, 12, 'oklch(0.93 0.02 85)', false);
const neuPressed = SurfaceShaders.generateNeumorphicCSS(6, 12, 'oklch(0.93 0.02 85)', true);
check('both states build', neuRaised.ok === true && neuPressed.ok === true);
check('no invalid shadow lists (regression: double commas)', ![neuRaised.css, neuPressed.css, glass.css].some(c => /,,/.test(c)));
check('raised: dark shadow bottom-right, not inset',
  neuRaised.css.split('box-shadow:')[1].includes('6px 6px 12px oklch(') && !neuRaised.css.split('box-shadow:')[1].includes('inset'));
check('pressed: inset shadows, dark thrown top-left',
  neuPressed.css.split('box-shadow:')[1].includes('inset -6px -6px 12px oklch(') &&
  neuPressed.css.split('box-shadow:')[1].includes('inset 6px 6px 12px oklch('));
check('surface keeps the base colour exactly', neuRaised.css.includes('background: oklch(0.93 0.02 85)'));
check('hue frozen across all derivatives',
  neuRaised.derived.shadow.h === 85 && neuRaised.derived.highlight.h === 85 && neuRaised.derived.ink.h === 85);
check('only lightness/chroma move', neuRaised.derived.shadow.l < 0.93 && neuRaised.derived.highlight.l > 0.93);
check('distance clamped at 24px', SurfaceShaders.generateNeumorphicCSS(999, 12, 'oklch(0.93 0.02 85)').distancePx === 24);
check('non-OKLCH colour rejected', SurfaceShaders.generateNeumorphicCSS(6, 12, 'rgb(1,2,3)').ok === false);

section('surface-shaders: claymorphism');

const clay = SurfaceShaders.generateClaymorphismCSS(18, 28, 'oklch(0.72 0.13 60)');
check('clay builds', clay.ok === true);
check('explicit corner radius', clay.css.includes('border-radius: 28px'));
check('four-layer shadow stack', (clay.css.split('box-shadow:')[1].match(/,/g) || []).length === 3);
check('ambient coloured drop leads', /0 16.2px 28.8px oklch\(/.test(clay.css));
check('three inset rim lights', (clay.css.match(/inset 0 -?[\d.]+px [\d.]+px oklch\(/g) || []).length === 3);
check('canvas lighter, same hue', clay.derived.canvas.l > clay.derived.primary.l && clay.derived.canvas.h === clay.derived.primary.h);
check('pill shape variant', SurfaceShaders.generateClaymorphismCSS(18, 0, 'oklch(0.72 0.13 60)', { shape: 'pill' }).css.includes('border-radius: 9999px'));
check('padding scales with depth', clay.css.includes('padding: 10.8px 16.2px'));
check('junk colour rejected', SurfaceShaders.generateClaymorphismCSS(18, 28, 'not-a-colour').ok === false);

section('surface-shaders: bundle');

const bundle = SurfaceShaders.generateAllShaders('oklch(0.6 0.15 250)');
check('bundle builds with 5 surfaces', bundle.ok === true && Object.keys(bundle.surfaces).length === 5);
check('bundle joins into one stylesheet', bundle.stylesheet.split('.pai-').length >= 6);
check('every derivative hue-stable at 250°',
  Object.values(bundle.surfaces).every(s => Object.values(s.derived).every(d => Math.abs(d.h - 250) < 0.01)));

/* ============================================================
 * 4. Stylebook generator
 * ============================================================ */
section('stylebook-generator: page structure');

const book = StylebookGenerator.generateStylebookHTML({}, 'bento-glass');
check('default page builds', book.ok === true && typeof book.html === 'string');
check('standalone document (doctype, lang, viewport, noindex)',
  /^<!DOCTYPE html>\n<html lang="en">/.test(book.html) &&
  book.html.includes('name="viewport"') && book.html.includes('noindex'));
check('archetype switcher lists all 6', (book.html.match(/data-archetype="/g) || []).length >= 6);
check('all 6 archetype registries embedded', (book.html.match(/css: "/g) || []).length === 6);
check('active archetype preselected', book.html.includes('data-archetype="bento-glass"'));
check('swatch grid host present', book.html.includes('id="sb-swatches"'));
check('viewport simulator present', book.html.includes('id="sb-vp-slider"') && book.html.includes('min="320"'));
check('typography specimens carry clamp data', (book.html.match(/data-clamp="clamp\(/g) || []).length >= 8);
check('component demos rendered', ['pai-btn', 'pai-badge', 'pai-switch__track', 'pai-accordion__trigger', 'pai-tabs__tab', 'pai-input__field']
  .every(c => book.html.includes(c)));
check('accordion demos are keyboard-wired (aria-expanded)', book.html.includes('aria-expanded'));
check('clipboard copy has a legacy fallback', book.html.includes('execCommand("copy")'));
check('data island namespaced', book.html.includes('__PAI_STYLEBOOK__'));
check('no raw </script> inside embedded CSS', !book.html.includes('css: "</'));
check('hash deep-linking wired', book.html.includes('location.hash'));
check('page size sane (30KB–200KB)', book.byteLength > 30000 && book.byteLength < 200000);

section('stylebook-generator: catalog handling + injection safety');

const customBook = StylebookGenerator.generateStylebookHTML({
  colors: { primary: '#8b5cf6', ink: 'oklch(0.2 0.03 260)' },
  typography: [{ role: 'body', clamp: 'clamp(1rem, 0.8rem + 1vw, 1.7rem)', lineHeight: 1.6, tracking: '0' }],
  name: 'Acme <b>Brand</b>'
}, 'editorial-magazine');
check('custom catalog builds', customBook.ok === true);
check('catalog title HTML-escaped', customBook.html.includes('Acme &lt;b&gt;Brand&lt;/b&gt;'));
check('catalog colours actually reach the page', customBook.html.includes('#8b5cf6') && customBook.html.includes('oklch(0.2 0.03 260)'));
check('script-tag colour injection rejected',
  StylebookGenerator.generateStylebookHTML({ colors: { primary: 'red;}</style><script>alert(1)</script>' } }, 'bento-glass').ok === false);
check('colour names validated', StylebookGenerator.generateStylebookHTML({ colors: { 'x y': '#fff' } }, 'bento-glass').ok === false);
check('malformed typography clamp rejected',
  StylebookGenerator.generateStylebookHTML({ typography: [{ role: 'body', clamp: 'clamp(1rem, <img src=x>, 2rem)' }] }, 'bento-glass').ok === false);
check('empty typography array rejected', StylebookGenerator.generateStylebookHTML({ typography: [] }, 'bento-glass').ok === false);
check('unknown archetype rejected', StylebookGenerator.generateStylebookHTML({}, 'brutalism').ok === false);
for (const a of StylebookGenerator.ARCHETYPES) {
  check('stylebook builds for ' + a, StylebookGenerator.generateStylebookHTML({}, a).ok === true);
}

/* ============================================================
 * 5. Cross-module composition
 * ============================================================ */
section('composition: tokens + components + shaders in one stylesheet');

// The archetype's fluid type tokens...
const compTokens = FluidTypography.buildFluidTypeTokens({ baseSizePx: 16, scaleRatio: 'fourth' });
// ...every component except `segmented` (which intentionally re-emits the tabs rules)...
const compCss = ['accordion', 'modal', 'tabs', 'tooltip', 'dropdown', 'input', 'switch']
  .map(t => ComponentLibrary.generateComponentTokens(t, 'bento-glass').css).join('\n\n');
// ...and the surface shaders for the archetype tint.
const shaderSheet = SurfaceShaders.generateAllShaders('oklch(0.6 0.15 255)').stylesheet;
const composed = compTokens.css + '\n\n' + compCss + '\n\n' + shaderSheet;

check('composed sheet has balanced braces', balanced(composed));
const dupes = duplicates(topSelectors(composed));
check('zero duplicate top-level selectors', dupes.length === 0);
check('composition carries all three families',
  composed.includes('--font-size-hero:') && composed.includes('.pai-tabs__indicator') && composed.includes('.pai-clay {'));

section('composition: stylebook embeds real per-archetype CSS');

const cyberBook = StylebookGenerator.generateStylebookHTML({}, 'retro-cyberpunk');
check('cyberpunk stylebook embeds the clipped-corner component CSS', cyberBook.html.includes('clip-path: polygon('));
check('cyberpunk stylebook embeds the glow elevation', cyberBook.html.includes('0 0 18px'));
check('stylebook surfaces tint from the active palette', (() => {
  const clayBook = StylebookGenerator.generateStylebookHTML({}, 'organic-clay');
  return clayBook.ok && clayBook.html.includes('.pai-clay {');
})());

/* ============================================================ */
console.log('\n==========================================');
console.log('design-advanced-v6-smoke: ' + pass + '/' + (pass + fail) + ' checks pass');
if (fail > 0) {
  console.log('Failures:');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('ALL GREEN');
