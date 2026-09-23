#!/usr/bin/env node
// ============================================================
// PallettAI Studio — Design Advanced v3 Smoke Runner
// Exercises the layout-container / perception / micro-style /
// variable-font modules end to end with plain assertions.
//
//   node scripts/design-advanced-v3-smoke.js
// ============================================================
'use strict';

const ResponsiveGrid = require('../modules/responsive-grid.js');
const ColorMatrix = require('../modules/color-matrix.js');
const ComponentStyles = require('../modules/component-styles.js');
const FontKinetic = require('../modules/font-kinetic.js');

let pass = 0;
let fail = 0;
const failures = [];

function ok(cond, label) {
  if (cond) { pass++; return; }
  fail++;
  failures.push(label);
  console.error('  ✗ ' + label);
}
function eq(a, b, label) { ok(a === b, label + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }

function section(name) { console.log('\n== ' + name + ' =='); }

/* ============================================================
   1 — container query CSS across width thresholds
   ============================================================ */
section('responsive-grid: container queries');

const ARCHETYPE_MAP = ResponsiveGrid.ARCHETYPES;
const ARCHETYPES = Object.keys(ARCHETYPE_MAP);
ok(ARCHETYPES.length === 6, 'six canonical archetypes exposed');

for (const a of ARCHETYPES) {
  const g = ResponsiveGrid.generateContainerClasses(a);
  ok(g && g.ok === true, a + ': generateContainerClasses ok');
  if (!g || !g.ok) continue;
  ok(typeof g.css === 'string' && g.css.length > 100, a + ': emits non-trivial CSS');
  ok(/@container\s*\(/.test(g.css), a + ': uses @container rules');
  ok(/\(min-width:\s*[\d.]+rem\)/.test(g.css), a + ': rem-based container thresholds');
  ok(g.stops.sidebar.length >= 3 && g.stops.card.length >= 4 && g.stops.bento.length === 2, a + ': sidebar/card/bento stop families');
  ok(g.css.indexOf('--rg-radius:') !== -1 && g.css.indexOf('--rg-gap:') !== -1, a + ': archetype radius/gap variables');
  ok(g.css.indexOf('prefers-reduced-motion') !== -1, a + ': reduced-motion guard');
  // Braces balance — cheap but real malformed-CSS guard.
  const opens = (g.css.match(/\{/g) || []).length;
  const closes = (g.css.match(/\}/g) || []).length;
  eq(opens, closes, a + ': braces balanced');
}

const brut = ResponsiveGrid.generateContainerClasses('brutalist-kinetic');
ok(brut.stops.card.join(',') === '18,24,30,36', 'brutalist: card stops 18/24/30/36rem');
ok(brut.css.indexOf('grid-template-columns:1.4fr 1fr') !== -1, 'brutalist: split card at wide stops');
ok(brut.css.indexOf('@container (max-width: 17.9rem)') !== -1, 'brutalist: compaction fallback present');

ok(ResponsiveGrid.generateContainerClasses('nope').ok === false, 'unknown archetype rejected');

// Auto-fit grid: exact breakpoint math, k·min + (k−1)·gap.
section('responsive-grid: auto-fit grid');
for (const [min, gap] of [[260, 16], [220, 24], [180, 8], [320, 32]]) {
  const grid = ResponsiveGrid.buildAutoFitGrid(min, gap);
  ok(grid && grid.ok === true, 'autoFit(' + min + ',' + gap + ') ok');
  if (!grid || !grid.ok) continue;
  ok(grid.template.indexOf('repeat(auto-fit') !== -1, 'autoFit: repeat(auto-fit');
  ok(grid.template.indexOf('minmax(clamp(') !== -1, 'autoFit: minmax(clamp() form');
  ok(grid.template.indexOf(', 1fr)') !== -1, 'autoFit: 1fr max track');
  const bp = {};
  for (const b of grid.columnBreakpoints) bp[b.columns] = b.atLeastPx;
  ok(bp[2] === 2 * min + gap, 'autoFit: 2-col breakpoint = ' + (2 * min + gap));
  ok(bp[3] === 3 * min + 2 * gap, 'autoFit: 3-col breakpoint = ' + (3 * min + 2 * gap));
  ok(bp[4] === 4 * min + 3 * gap, 'autoFit: 4-col breakpoint = ' + (4 * min + 3 * gap));
  ok(grid.columnsAt1200 >= 2 && grid.orphanSafe === true, 'autoFit: wide containers hold ≥2 columns (orphan-safe)');
  ok(grid.css.indexOf('@container') !== -1, 'autoFit: css variant is container-scoped');
}
// The clamp pair must honour its band, and absurd input is
// clamped to the engineering floor rather than accepted raw.
const wide = ResponsiveGrid.buildAutoFitGrid(320, 32);
ok(wide.minPx === 320 && wide.maxPx >= 320, 'autoFit: track band honours min ≤ max');
const clamped = ResponsiveGrid.buildAutoFitGrid(-5, 16);
ok(clamped.ok === true && clamped.minPx === 80, 'autoFit: absurd input clamped to 80px floor');

/* ============================================================
   2 — APCA Lc + auto-tune
   ============================================================ */
section('color-matrix: APCA contrast');

const bw = ColorMatrix.calculateAPCAContrast('#000000', '#ffffff');
ok(bw.ok === true && Math.abs(bw.Lc - 106.5) < 1, 'black on white Lc ≈ +106.5 (got ' + bw.Lc + ')');
eq(bw.polarity, 'dark-on-light', 'black on white polarity');

const wb = ColorMatrix.calculateAPCAContrast('#ffffff', '#000000');
ok(wb.ok === true && Math.abs(wb.Lc - -107.9) < 1, 'white on black Lc ≈ −107.9 (got ' + wb.Lc + ')');
eq(wb.polarity, 'light-on-dark', 'white on black polarity');

const same = ColorMatrix.calculateAPCAContrast('#888888', '#888888');
ok(same.ok === true && same.Lc === 0, 'identical colours → Lc 0');

ok(ColorMatrix.calculateAPCAContrast('garbage', '#fff').ok === false, 'bad colour rejected');
ok(ColorMatrix.calculateAPCAContrast('oklch(0.3 0.02 250)', 'oklch(0.94 0.01 80)').absLc > 60, 'oklch inputs work');

// Dark-mode realism: light text on a dark surface must pass too.
const dark = ColorMatrix.calculateAPCAContrast('oklch(0.88 0.02 250)', 'oklch(0.21 0.02 260)');
ok(dark.absLc >= 60 && dark.polarity === 'light-on-dark', 'dark-mode pair readable (Lc ' + dark.Lc + ')');

section('color-matrix: autoTuneTokenPair');

// Failing pair, target 75 (body text).
const tuned = ColorMatrix.autoTuneTokenPair('oklch(0.62 0.19 25)', 'oklch(0.96 0.01 80)', 75);
ok(tuned.ok === true && tuned.reached === true, 'autotune reaches Lc 75');
ok(tuned.Lc >= 75, 'autotune result ≥ target (got ' + tuned.Lc + ')');
ok(tuned.LcInitial < 75, 'autotune started below target (Lc ' + tuned.LcInitial + ')');

// Hue and chroma must be FROZEN — parse the output colour back.
const tunedOut = ColorMatrix.parseColorToOklch(tuned.foreground);
const tunedIn = ColorMatrix.parseColorToOklch('oklch(0.62 0.19 25)');
ok(Math.abs(tunedOut.H - tunedIn.H) < 0.01, 'autotune: hue unchanged (' + tunedOut.H + ')');
ok(Math.abs(tunedOut.C - tunedIn.C) < 1e-9, 'autotune: chroma unchanged');

// Polarity preserved: it got DARKER, never crossed the background.
ok(tunedOut.L < tunedIn.L, 'autotune: dark fg lightened-direction only (L ' + tunedIn.L + ' → ' + tunedOut.L + ')');

// Reverse direction: light fg on dark bg must get LIGHTER.
const tunedDark = ColorMatrix.autoTuneTokenPair('oklch(0.70 0.15 260)', 'oklch(0.18 0.02 260)', 75);
ok(tunedDark.ok === true && tunedDark.reached === true, 'dark-mode autotune reaches 75');
ok(tunedDark.polarity === 'light-on-dark' && tunedDark.to > 0.70, 'dark-mode autotune lightens only (→ L ' + tunedDark.to + ')');

// Header target Lc 45 needs less movement than body target 75.
const soft = ColorMatrix.autoTuneTokenPair('oklch(0.62 0.19 25)', 'oklch(0.96 0.01 80)', 45);
ok(soft.reached && Math.abs(soft.to - soft.from) < Math.abs(tuned.to - tuned.from), 'Lc 45 target moves lightness less than Lc 75');

// Honest failure: grey on grey cannot reach 75.
const hopeless = ColorMatrix.autoTuneTokenPair('oklch(0.55 0.01 250)', 'oklch(0.60 0.01 250)', 75);
ok(hopeless.ok === true && hopeless.reached === false, 'unreachable target reported honestly');
ok(Math.abs(hopeless.Lc) < 75, 'unreachable result not faked (|Lc| ' + Math.abs(hopeless.Lc) + ')');

section('color-matrix: colour-blindness simulation');

for (const vt of ColorMatrix.VISION_TYPES) {
  const sim = ColorMatrix.simulateColorBlindness('oklch(0.62 0.19 25)', vt);
  ok(sim.ok === true && sim.visionType === vt, vt + ': simulation ok');
  ok(/^#[0-9a-f]{6}$/i.test(sim.output.hex), vt + ': hex output well-formed');
  ok(Math.abs(sim.output.L - 0.62) < 0.1, vt + ': lightness roughly preserved (Δ' + Math.abs(sim.output.L - 0.62).toFixed(3) + ')');
}
// Signature CVD facts:
const deutan = ColorMatrix.simulateColorBlindness('oklch(0.62 0.19 25)', 'deuteranopia');
const deutanIn = ColorMatrix.parseColorToOklch('oklch(0.62 0.19 25)');
ok(deutan.output.C < deutanIn.C * 0.75, 'deuteranopia collapses red chroma hard (C ' + deutanIn.C.toFixed(2) + ' → ' + deutan.output.C.toFixed(2) + ')');
ok(ColorMatrix.simulateColorBlindness('#808080', 'protanopia').output.hex === '#808080', 'grey is a CVD fixed point');
ok(ColorMatrix.simulateColorBlindness('#808080', 'deuteranopia').output.hex === '#808080', 'grey fixed under deuteranopia too');
const tri = ColorMatrix.simulateColorBlindness('oklch(0.6 0.15 260)', 'tritanopia');
ok(Math.abs(tri.output.H - 260) > 15 || tri.output.C < 0.05, 'tritanopia shifts blue hue or kills chroma');
ok(ColorMatrix.simulateColorBlindness('#fff', 'wibble').ok === false, 'unknown vision type rejected');

// Distinct palette stays distinct for deuteranopes (blue vs orange).
const p1 = ColorMatrix.simulateColorBlindness('oklch(0.6 0.16 260)', 'deuteranopia').output.hex; // blue
const p2 = ColorMatrix.simulateColorBlindness('oklch(0.75 0.16 70)', 'deuteranopia').output.hex; // orange
ok(p1 !== p2, 'blue/orange remain distinct under deuteranopia (' + p1 + ' vs ' + p2 + ')');

/* ============================================================
   3 — micro-style tokens across all 6 archetypes
   ============================================================ */
section('component-styles: archetype micro-styles');

for (const a of ComponentStyles.ARCHETYPES) {
  const b = ComponentStyles.generateButtonTokens(a);
  const c = ComponentStyles.generateCardAndBadgeTokens(a);
  ok(b.ok === true && b.css.length > 100, a + ': button tokens generated');
  ok(c.ok === true && c.css.length > 100, a + ': card/badge/input tokens generated');
  ok(b.classes.indexOf('pa-btn') === 0 && b.classes.indexOf('pa-btn--ghost') !== -1, a + ': button class list');
  ok(c.classes.indexOf('pa-card') === 0 && c.classes.indexOf('pa-input') !== -1, a + ': component class list');
  ok(b.css.indexOf('var(--c-') !== -1, a + ': colours bound to tokens, not literals');
}

const sig = {
  'brutalist-kinetic': function (css) {
    return css.indexOf('4px solid var(--c-ink') !== -1 &&
      css.indexOf('border-radius:0') !== -1 &&
      css.indexOf('4px 4px 0 0') !== -1;
  },
  'bento-glass': function (css) {
    return css.indexOf('blur(12px)') !== -1 &&
      css.indexOf('1px solid var(--c-glass-border') !== -1 &&
      css.indexOf('linear-gradient(') !== -1;
  },
  'organic-clay': function (css) {
    return css.indexOf('9999px') !== -1 &&
      css.indexOf('inset 0 2px 3px') !== -1 &&
      css.indexOf('inset 0 -3px 5px') !== -1;
  },
  'editorial-magazine': function (css) {
    return css.indexOf('font-mono') !== -1 &&
      css.indexOf('0 0 0 1px var(--c-ink') !== -1 &&
      css.indexOf('scaleX(1)') !== -1;
  },
  'retro-cyberpunk': function (css) {
    return css.indexOf('clip-path:polygon(') !== -1 &&
      css.indexOf('text-shadow:0 0') !== -1 &&
      css.indexOf('box-shadow:0 0') !== -1;
  },
  'neo-minimalist': function (css) {
    return css.indexOf('border:none') !== -1 &&
      css.indexOf('0 2px 0 0 var(--c-ink') !== -1;
  }
};
for (const a of Object.keys(sig)) {
  ok(sig[a](ComponentStyles.generateButtonTokens(a).css), a + ': signature button treatments present');
}

ok(ComponentStyles.generateButtonTokens('editorial').archetype === 'editorial-magazine', 'alias resolution works');
ok(ComponentStyles.generateButtonTokens('nope').ok === false, 'unknown archetype rejected');
const sheet = ComponentStyles.generateComponentStylesheet('bento-glass');
ok(sheet.ok === true && sheet.css.indexOf('/* PallettAI components') === 0, 'combined stylesheet composes both layers');

/* ============================================================
   4 — variable font CSS + kinetic keyframes
   ============================================================ */
section('font-kinetic: variable font axes');

const vf = FontKinetic.generateVariableFontCSS('Inter', {
  axes: { wght: { min: 300, max: 700, default: 400 }, wdth: { min: 75, max: 125, default: 100 } },
  hover: { wght: 650 },
  scrollDriven: true
});
ok(vf.ok === true, 'variable font CSS generated');
ok(vf.axes.join(',') === 'wght,wdth', 'axes preserved in order');
eq(vf.weightRange, '300 700', '@font-face weight range');
eq(vf.stretchRange, '75% 125%', '@font-face stretch range');
ok(vf.css.indexOf("'wght' 400, 'wdth' 100") !== -1, 'base font-variation-settings present');
ok(vf.css.indexOf("'wght' 650") !== -1, 'hover state present');
ok(vf.css.indexOf('transition: font-variation-settings') !== -1, 'smooth transition declared');
ok(vf.css.indexOf('animation-timeline: scroll()') !== -1, 'scroll-driven variant behind @supports');
ok(vf.css.indexOf('prefers-reduced-motion') !== -1, 'reduced-motion guard present');
ok(vf.css.indexOf('font-weight: 300 700;') !== -1, '@font-face range syntax');
ok(vf.skippedAxes.join(',') === '', 'no valid axes skipped');

const badAxis = FontKinetic.generateVariableFontCSS('X', { axes: { wght: { min: 100, max: 900 }, 'bogus!': {} } });
ok(badAxis.ok === true && badAxis.skippedAxes.join(',') === 'bogus!', 'invalid axis tag skipped, not fatal');

const noAxes = FontKinetic.generateVariableFontCSS('X', { axes: { 'nope!': {} } });
ok(noAxes.ok === false, 'zero valid axes rejected cleanly');
ok(FontKinetic.generateVariableFontCSS('').ok === false, 'empty family rejected');

section('font-kinetic: kinetic keyframes');

const pulse = FontKinetic.generateKineticTextKeyframes('kinetic-pulse');
ok(pulse.ok === true && pulse.css.indexOf('@keyframes pa-kinetic-pulse') !== -1, 'kinetic-pulse keyframes');
ok(pulse.css.indexOf('"wght" 300') !== -1 && pulse.css.indexOf('"wght" 700') !== -1, 'kinetic-pulse breathes 300→700');
ok(pulse.css.indexOf('infinite') !== -1, 'kinetic-pulse loops');
ok(pulse.css.indexOf('prefers-reduced-motion') !== -1, 'kinetic-pulse guarded');

const marquee = FontKinetic.generateKineticTextKeyframes('kinetic-marquee', { durationSec: 18 });
ok(marquee.ok === true && marquee.css.indexOf('@keyframes pa-kinetic-marquee') !== -1, 'kinetic-marquee keyframes');
ok(marquee.css.indexOf('translateX(-50%)') !== -1, 'kinetic-marquee seamless -50% loop');
ok(marquee.css.indexOf('--marquee-duration: 18s') !== -1, 'kinetic-marquee duration tokenised');
ok(marquee.css.indexOf('animation-play-state: paused') !== -1, 'kinetic-marquee pauses on hover');

for (const a of FontKinetic.ARCHETYPES) {
  const dc = FontKinetic.generateKineticTextKeyframes('editorial-dropcap', { archetypeKey: a });
  ok(dc.ok === true && dc.css.indexOf('::first-letter') !== -1, 'dropcap for ' + a);
  ok(dc.css.indexOf('float: left;') !== -1, 'dropcap for ' + a + ': floated initial');
}
ok(FontKinetic.generateKineticTextKeyframes('editorial-dropcap').archetype === 'editorial-magazine', 'dropcap default archetype');
const brutalDc = FontKinetic.generateKineticTextKeyframes('editorial-dropcap', { archetypeKey: 'brutalist-kinetic' });
ok(brutalDc.css.indexOf('4px solid') !== -1, 'brutalist dropcap border treatment');
const cyberDc = FontKinetic.generateKineticTextKeyframes('editorial-dropcap', { archetypeKey: 'retro-cyberpunk' });
ok(cyberDc.css.indexOf('clip-path') !== -1 && cyberDc.css.indexOf('text-shadow') !== -1, 'cyberpunk dropcap treatment');

ok(FontKinetic.generateKineticTextKeyframes('spin').ok === false, 'unknown effect rejected');
ok(FontKinetic.generateKineticTextKeyframes('editorial-dropcap', { archetypeKey: 'nope' }).ok === false, 'unknown dropcap archetype rejected');
ok(FontKinetic.generateKineticStylesheet({ archetypeKey: 'organic-clay' }).ok === true, 'combined kinetic stylesheet composes');

/* ============================================================
   5 — cross-module integration
   ============================================================ */
section('cross-module integration');

// One archetype's full output must compose into a single sheet
// with balanced braces and no duplicated class definitions.
for (const a of ARCHETYPES) {
  const parts = [
    ResponsiveGrid.generateContainerClasses(a),
    ResponsiveGrid.buildAutoFitGrid(260, 16),
    ComponentStyles.generateComponentStylesheet(a),
    FontKinetic.generateKineticStylesheet({ archetypeKey: a })
  ];
  const joined = parts.map(function (p) { return p.css; }).join('\n');
  const opens = (joined.match(/\{/g) || []).length;
  const closes = (joined.match(/\}/g) || []).length;
  ok(opens === closes && opens > 10, a + ': composed sheet braces balanced (' + opens + ')');
  ok(joined.indexOf('@container') !== -1 && joined.indexOf('prefers-reduced-motion') !== -1, a + ': composed sheet keeps container scoping + motion guard');
  ok(joined.indexOf('.rg-autofit{') !== -1 && joined.indexOf('.pa-btn{') !== -1, a + ': grid + component layers coexist');
}

// Contrast pipeline: tuned output must pass an APCA re-check.
const recheck = ColorMatrix.calculateAPCAContrast(tuned.foreground, tuned.background);
ok(recheck.ok === true && Math.abs(recheck.Lc) >= 75, 'autotuned pair re-verifies at |Lc| ≥ 75 (got ' + Math.abs(recheck.Lc) + ')');

// Grid + APCA together: the auto-fit band and a tuned ink can be
// emitted into the same design system without conflicting units.
const sysSheet = ResponsiveGrid.buildAutoFitGrid(220, 24).css + '\n' +
  ComponentStyles.generateComponentStylesheet('organic-clay').css;
ok(sysSheet.indexOf('grid-template-columns: repeat(auto-fit') !== -1 && sysSheet.indexOf('9999px') !== -1, 'auto-fit grid + clay components coexist in one sheet');

/* ============================================================
   summary
   ============================================================ */
console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) {
  console.log('\nFailures:');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('design-advanced-v3 smoke: ALL GREEN');
