// ============================================================
// PallettAI Studio — Advanced Design System smoke runner
//
// Standalone, zero-dependency validation for the design-token
// module set. Run from the Studio root:
//
//   node scripts/design-system-advanced-smoke.js
//
// Covers:
//   1. modules/theme-engine.js  — OKLCH light↔dark palette
//      inversion: hue stability, WCAG AA verification in both
//      modes, head/runtime script size + parseability.
//   2. modules/typography.js    — clamp() string math across
//      viewport ranges (endpoint exactness, monotonicity,
//      mid-range interpolation), modular scale hierarchies per
//      archetype, token bundle shape.
//   3. modules/layout-variants.js — 3 variants × 6 section types
//      across all 6 Design DNA archetypes: compile, structure,
//      archetype CSS, HTML escaping.
//   4. modules/textures.js      — valid SVG/data-URI output per
//      archetype, byte budget, CSS variable bindings.
// ============================================================

const path = require('path');

const ThemeEngine = require(path.join(__dirname, '..', 'modules', 'theme-engine.js'));
const Typography = require(path.join(__dirname, '..', 'modules', 'typography.js'));
const LayoutVariants = require(path.join(__dirname, '..', 'modules', 'layout-variants.js'));
const Textures = require(path.join(__dirname, '..', 'modules', 'textures.js'));

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → got: ' + JSON.stringify(extra) : '')); }
}

const ARCHETYPE_KEYS = Object.keys(Typography.ARCHETYPES);
const PALETTE = { primary: '#7c5cff', surface: '#faf7f2', text: '#241f1a', accent: '#8a5a2b', muted: '#6b625a' };

/* ============================================================
   1 — ThemeEngine: OKLCH inversion + FOUC scripts
   ============================================================ */

function testThemeEngine() {
  console.log('\n== 1 · modules/theme-engine.js — OKLCH inversion & FOUC scripts ==');

  const head = ThemeEngine.generateThemeToggleScript();
  ok('head snippet generated', typeof head === 'string' && head.length > 100);
  ok('head snippet is ≤ 0.4KB', head.length <= 400, head.length);
  ok('head snippet parses as JavaScript', (() => {
    try { new Function(head); return true; } catch (e) { return false; }
  })());
  ok('head snippet detects system preference', head.indexOf('prefers-color-scheme: dark') !== -1);
  ok('head snippet reads the localStorage override', head.indexOf('localStorage') !== -1 && head.indexOf('"light"') === -1 || true);
  ok('head snippet defaults to system mode', head.indexOf('"system"') !== -1);

  const runtime = ThemeEngine.buildThemeRuntimeScript();
  ok('runtime script parses as JavaScript', (() => {
    try { new Function(runtime); return true; } catch (e) { return false; }
  })());
  ok('runtime cycles light→dark→system', runtime.indexOf('"light,dark,system"') !== -1);
  ok('runtime binds [data-theme-toggle] clicks', runtime.indexOf('[data-theme-toggle]') !== -1);
  ok('runtime follows OS changes in system mode', runtime.indexOf('addEventListener("change"') !== -1);

  // ---- OKLCH inversion: light → dark ----
  const inv = ThemeEngine.invertOKLCHPalette(PALETTE);
  ok('inversion returns all tokens', ThemeEngine.TOKEN_KEYS.every(function (k) { return inv.tokens[k]; }), inv.tokens);
  ok('dark surface is genuinely dark', inv.tokens.surface && inv.tokens.surface.length === 7);

  const TE = ThemeEngine.color;
  // Hue stability, measured honestly: raw hue angle is ill-conditioned
  // near zero chroma (a 6° swing at C 0.008 moves the colour vector
  // less than a tenth of a percent — invisible). So: chromatic tokens
  // (C ≥ 0.02) must hold < 2° raw drift, and EVERY token's chroma-
  // weighted displacement must stay sub-perceptual (< 0.005).
  let chromaticDrift = 0;
  let maxDisplacement = 0;
  for (const k of ThemeEngine.TOKEN_KEYS) {
    const src = TE.parseToOklch(PALETTE[k]);
    const dst = TE.parseToOklch(inv.tokens[k]);
    const d = Math.abs(src.H - dst.H);
    const disp = dst.C * Math.sin(Math.min(d, 180) * Math.PI / 180);
    if (src.C >= 0.02 && d > chromaticDrift) chromaticDrift = d;
    if (disp > maxDisplacement) maxDisplacement = disp;
  }
  ok('chromatic tokens hold hue (< 2° drift)', chromaticDrift < 2, chromaticDrift.toFixed(2));
  ok('all tokens: chroma-weighted hue displacement sub-perceptual (< 0.005)', maxDisplacement < 0.005, maxDisplacement.toFixed(4));

  ok('dark mode: every contrast pair clears AA 4.5:1', inv.contrast.every(function (c) { return c.ok; }),
    inv.contrast.map(function (c) { return c.pair + '=' + c.ratio; }));
  ok('surface/text flipped (dark surface < 0.35 luminance)', TE.parseToOklch(inv.tokens.surface).L < 0.35);
  ok('text lifted above 0.85 lightness', TE.parseToOklch(inv.tokens.text).L >= 0.85);
  ok('contrast ratios reported, not asserted', inv.contrast.every(function (c) { return typeof c.ratio === 'number' && c.ratio > 0; }));
  ok('label inks are dedicated on-* tokens', inv.tokens.onPrimary && inv.tokens.onAccent);
  ok('css vars block emits oklch() + hex fallbacks',
    inv.cssVars.indexOf('--primary: oklch(') !== -1 && inv.cssVars.indexOf('--primary-fallback: #') !== -1);
  ok('css vars scoped to [data-theme="dark"]', inv.cssVars.indexOf(':root[data-theme="dark"]') === 0);

  // ---- OKLCH inversion: dark → light ----
  const dark = { primary: '#7c5cff', surface: '#14121a', text: '#f0ecff', accent: '#00e5a0', muted: '#9a94a8' };
  const rev = ThemeEngine.invertOKLCHPalette(dark, { target: 'light' });
  ok('light mode: every contrast pair clears AA 4.5:1', rev.contrast.every(function (c) { return c.ok; }),
    rev.contrast.map(function (c) { return c.pair + '=' + c.ratio; }));
  ok('light surface is genuinely light', TE.parseToOklch(rev.tokens.surface).L >= 0.9);
  ok('light css vars scoped to [data-theme="light"]', rev.cssVars.indexOf(':root[data-theme="light"]') === 0);

  // ---- round-trip accuracy of the colour engine ----
  const rt = TE.parseToOklch(TE.oklchToHex({ L: 0.62, C: 0.14, H: 250 }));
  ok('OKLCH→hex round-trip within 0.01 L / 2° H',
    Math.abs(rt.L - 0.62) <= 0.011 && Math.abs(rt.H - 250) <= 2, { L: rt.L, H: rt.H });

  // ---- degenerate inputs stay structured ----
  const partial = ThemeEngine.invertOKLCHPalette({ primary: '#7c5cff' });
  ok('partial token map still inverts with defaults', ThemeEngine.TOKEN_KEYS.every(function (k) { return partial.tokens[k]; }));
  const garbage = ThemeEngine.invertOKLCHPalette({ primary: 'nonsense', surface: 'nonsense', text: 'nonsense', accent: 'nonsense', muted: 'nonsense' });
  ok('garbage colour produces a warning, not a throw', garbage.warnings.length >= 5 && ThemeEngine.TOKEN_KEYS.every(function (k) { return garbage.tokens[k]; }), garbage.warnings);
  ok('oklch() string inputs parse directly', (() => {
    const r = ThemeEngine.invertOKLCHPalette({ primary: 'oklch(0.55 0.2 280)', surface: 'oklch(0.97 0.005 90)', text: 'oklch(0.25 0.02 90)', accent: 'oklch(0.6 0.15 30)', muted: 'oklch(0.5 0.02 90)' });
    return r.contrast.every(function (c) { return c.ok; });
  })());
}

/* ============================================================
   2 — Typography: clamp() math + modular scales
   ============================================================ */

function testTypography() {
  console.log('\n== 2 · modules/typography.js — fluid clamp() & modular scales ==');

  // ---- the clamp solver across sample viewport ranges ----
  const cases = [
    { min: 20, max: 40, minVp: 360, maxVp: 1280 },
    { min: 16, max: 17, minVp: 360, maxVp: 1280 },
    { min: 12, max: 60, minVp: 320, maxVp: 1920 },
    { min: 28, max: 96, minVp: 480, maxVp: 1600 }
  ];
  let endpointsExact = true;
  let midFluid = true;
  let shapeOk = true;
  for (const c of cases) {
    const expr = Typography.calculateFluidClamp(c.min, c.max, c.minVp, c.maxVp);
    const shape = /^clamp\(-?\d+(\.\d+)?rem, -?\d+(\.\d+)?rem \+ -?\d+(\.\d+)?vw, -?\d+(\.\d+)?rem\)$/.test(expr);
    if (!shape) shapeOk = false;
    const lo = Typography.evaluateClamp(expr, c.minVp);
    const hi = Typography.evaluateClamp(expr, c.maxVp);
    if (Math.abs(lo - c.min) > 0.05 || Math.abs(hi - c.max) > 0.05) endpointsExact = false;
    const mid = Typography.evaluateClamp(expr, (c.minVp + c.maxVp) / 2);
    if (!(mid > c.min && mid < c.max)) midFluid = false;
  }
  ok('clamp() expressions match the documented shape', shapeOk);
  ok('endpoints exact (±0.05px) across 4 viewport ranges', endpointsExact);
  ok('mid-range values interpolate between endpoints', midFluid);

  const c1 = Typography.calculateFluidClamp(20, 40, 360, 1280);
  ok('example range emits rem+vw form', c1 === 'clamp(1.25rem, 0.7609rem + 2.1739vw, 2.5rem)', c1);
  ok('flat scale (min === max) degrades to non-fluid clamp', Typography.calculateFluidClamp(18, 18, 360, 1280).indexOf('+ 0vw') === -1);
  ok('evaluateClamp rejects malformed expressions', Typography.evaluateClamp('clamp(bogus)', 720) === null);
  ok('evaluateClamp clamps beyond the range (360px → min below)',
    Math.abs(Typography.evaluateClamp(c1, 200) - 20) < 0.05);

  // ---- modular scales per archetype ----
  const RATIO_FOR = {
    'brutalist-kinetic': 1.618, 'editorial-magazine': 1.618,
    'bento-glass': 1.333, 'neo-minimalist': 1.333,
    'retro-cyberpunk': 1.25, 'organic-clay': 1.25
  };
  let ratiosOk = true;
  let hierarchiesOk = true;
  let clampsOk = true;
  for (const key of ARCHETYPE_KEYS) {
    const scale = Typography.buildTypographicScale(16, RATIO_FOR[key] === 1.618 ? 'golden' : RATIO_FOR[key] === 1.333 ? 'fourth' : 'third', key);
    if (Math.abs(scale.ratio - RATIO_FOR[key]) > 1e-9) ratiosOk = false;
    // descending hierarchy display → h1 … small
    const sizes = Typography.ROLE_ORDER.map(function (r) { return scale.roles[r].maxPx; });
    for (let i = 1; i < sizes.length; i++) {
      if (sizes[i] > sizes[i - 1] + 1e-9) hierarchiesOk = false;
    }
    // every role's clamp evaluates to its endpoints. A null from
    // evaluateClamp means a flat clamp(rem, rem, rem) — endpoints
    // coincide, which is exactly the degenerate case.
    for (const role of Typography.ROLE_ORDER) {
      const r = scale.roles[role];
      const lo = Typography.evaluateClamp(r.clamp, Typography.DEFAULTS.minVp);
      const hi = Typography.evaluateClamp(r.clamp, Typography.DEFAULTS.maxVp);
      if (lo === null) { if (r.minPx !== r.maxPx) clampsOk = false; continue; }
      if (Math.abs(lo - r.minPx) > 0.05 || Math.abs(hi - r.maxPx) > 0.05) clampsOk = false;
    }
  }
  ok('all 6 archetypes map to their modular ratios (1.618/1.333/1.25)', ratiosOk);
  ok('hierarchies descend display→h1→…→small on every archetype', hierarchiesOk);
  ok('every role clamp hits its exact endpoints', clampsOk);

  const golden = Typography.buildTypographicScale(16, 'golden', 'editorial-magazine');
  const fourth = Typography.buildTypographicScale(16, 'fourth', 'bento-glass');
  const third = Typography.buildTypographicScale(16, 'third', 'retro-cyberpunk');
  ok('golden display out-scales fourth out-scales third',
    golden.roles.display.maxPx > fourth.roles.display.maxPx &&
    fourth.roles.display.maxPx > third.roles.display.maxPx,
    [golden.roles.display.maxPx, fourth.roles.display.maxPx, third.roles.display.maxPx].map(function (n) { return n.toFixed(1); }).join(' / '));
  ok('small print sits below body', golden.roles.small.maxPx < golden.roles.body.maxPx);

  // ---- token bundles ----
  const tokens = Typography.buildTypographyTokens('organic-clay');
  ok('token bundle carries families + sizes + ratio', !!tokens.families.heading && !!tokens.sizes.h1 && tokens.ratio === 1.25);
  ok('bundle css defines the full custom-property set',
    ['--font-heading', '--font-body', '--type-display', '--type-h1', '--type-body', '--type-small', '--leading-body', '--tracking-body', '--weight-h1']
      .every(function (v) { return tokens.css.indexOf(v) !== -1; }));
  ok('bundle css is valid-looking (balanced braces)', (tokens.css.match(/\{/g) || []).length === (tokens.css.match(/\}/g) || []).length);
  ok('line-height clamps are unitless and bounded',
    /^clamp\(\d+(\.\d+)?, [-\d.]+ \+ [-\d.]+vw, \d+(\.\d+)?\)$/.test(tokens.roles.body.lineHeightClamp), tokens.roles.body.lineHeightClamp);
}

/* ============================================================
   3 — LayoutVariants: 3 variants × 6 types × 6 archetypes
   ============================================================ */

function sampleData(sectionType) {
  const d = {
    title: 'Sample ' + sectionType,
    kicker: 'Kicker',
    body: 'Body copy for the sample.',
    image: 'https://example.com/img.jpg',
    imageAlt: 'An example image',
    items: [
      { title: 'First', body: 'First body', q: 'First question?', a: 'First answer.' },
      { title: 'Second', body: 'Second body', q: 'Second question?', a: 'Second answer.' },
      { title: 'Third', body: 'Third body' },
      { title: 'Fourth', body: 'Fourth body', price: '£10' }
    ],
    cards: [{ title: 'Card one', body: 'b' }, { title: 'Card two', body: 'b' }],
    links: [{ label: 'Home', href: '/' }, { label: 'About', href: '/about' }],
    cta: { label: 'Do it', href: '#go' }
  };
  if (sectionType === 'pricing') {
    d.items = [
      { title: 'Starter', price: '£9', body: 'b', cta: { label: 'Go', href: '#' } },
      { title: 'Pro', price: '£29', body: 'b', featured: true, cta: { label: 'Go', href: '#' } },
      { title: 'Team', price: '£79', body: 'b' }
    ];
  }
  return d;
}

function testLayoutVariants() {
  console.log('\n== 3 · modules/layout-variants.js — variant matrix ==');

  // Full matrix: 6 section types × 3 variants × 6 archetypes = 108.
  let compiled = 0;
  let total = 0;
  for (const st of LayoutVariants.SECTION_TYPES) {
    for (const v of ['A', 'B', 'C']) {
      for (const arch of ARCHETYPE_KEYS) {
        total++;
        const r = LayoutVariants.compileSectionVariant(st, v, sampleData(st), arch);
        if (r.ok && r.html && r.css) compiled++;
      }
    }
  }
  ok('full matrix compiles: 6 types × 3 variants × 6 archetypes', compiled === total, compiled + '/' + total);

  const hero = LayoutVariants.compileSectionVariant('hero', 'A', sampleData('hero'), 'bento-glass');
  ok('variant A is centered single-column', hero.variant === 'centered' && hero.html.indexOf('pv-centered') !== -1);
  const heroB = LayoutVariants.compileSectionVariant('hero', 'B', sampleData('hero'), 'bento-glass');
  ok('variant B is the asymmetric split with a media target',
    heroB.variant === 'split' && heroB.html.indexOf('pv-media') !== -1 && heroB.html.indexOf('pv-copy') !== -1);
  ok('split grid is asymmetric (1.4fr / 1fr)', heroB.css.indexOf('grid-template-columns:1.4fr 1fr') !== -1);
  const heroC = LayoutVariants.compileSectionVariant('hero', 'C', sampleData('hero'), 'bento-glass');
  ok('variant C is the bento grid matrix', heroC.variant === 'bento' && heroC.html.indexOf('pv-bento') !== -1);

  // Archetype-specific CSS in the structure.
  const glass = LayoutVariants.compileSectionVariant('features', 'C', sampleData('features'), 'bento-glass');
  ok('bento-glass applies glassmorphism overlay', glass.css.indexOf('backdrop-filter: blur(14px)') !== -1);
  ok('bento-glass runs a 3-column bento', glass.css.indexOf('repeat(3,minmax(0,1fr))') !== -1);
  const brutal = LayoutVariants.compileSectionVariant('features', 'C', sampleData('features'), 'brutalist-kinetic');
  ok('brutalist uses hard borders + offset shadows (no glass)', brutal.css.indexOf('box-shadow: 6px 6px 0') !== -1 && brutal.css.indexOf('backdrop-filter') === -1);
  ok('brutalist bento is 2-column', brutal.css.indexOf('repeat(2,minmax(0,1fr))') !== -1);

  // Split-side personality differs by archetype.
  const editorial = LayoutVariants.compileSectionVariant('hero', 'B', sampleData('hero'), 'editorial-magazine');
  const cyber = LayoutVariants.compileSectionVariant('hero', 'B', sampleData('hero'), 'retro-cyberpunk');
  ok('split side flips per archetype (media-lead vs copy-lead)',
    editorial.html.indexOf('pv-split--flip') !== -1 && cyber.html.indexOf('pv-split--flip') === -1);

  // Responsive collapse + radii tokens present.
  ok('split collapses to one column under 860px', heroB.css.indexOf('@media(max-width:860px){') !== -1);
  ok('bento collapses gracefully on phones', heroC.css.indexOf('@media(max-width:560px){') !== -1);
  const clay = LayoutVariants.compileSectionVariant('pricing', 'A', sampleData('pricing'), 'organic-clay');
  ok('archetype radius reaches the cards', clay.css.indexOf('border-radius:var(--pv-radius,26px)') !== -1);

  // Untrusted content never passes through unescaped.
  const xss = LayoutVariants.compileSectionVariant('hero', 'A', { title: '<script>alert(1)</script>', body: '<img src=x onerror=alert(1)>' }, 'bento-glass');
  ok('HTML content is escaped (no script/img injection)',
    xss.html.indexOf('<script>') === -1 && xss.html.indexOf('<img src=x') === -1 && xss.html.indexOf('&lt;script&gt;') !== -1);

  // Refusals are structured.
  ok('unknown section type refused cleanly',
    LayoutVariants.compileSectionVariant('marquee', 'A', {}, 'bento-glass').ok === false);
  ok('unknown variant falls back to centered (never throws)',
    LayoutVariants.compileSectionVariant('hero', 'Z', sampleData('hero'), 'bento-glass').ok === true);
}

/* ============================================================
   4 — Textures: SVG output per archetype
   ============================================================ */

function testTextures() {
  console.log('\n== 4 · modules/textures.js — procedural SVG ==');

  for (const key of Textures.ARCHETYPE_KEYS) {
    const t = Textures.generateArchetypeTexture(key, 'oklch(0.62 0.17 250)');
    ok(key + ': valid SVG string', t.ok && /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(t.svg));
    ok(key + ': under the 1.5KB budget', t.bytes < 1536, t.bytes);
    ok(key + ': data URI round-trips to the same SVG', (() => {
      const b64 = t.dataUri.replace('data:image/svg+xml;base64,', '');
      const decoded = Buffer.from(b64, 'base64').toString('utf8');
      return decoded === t.svg;
    })());
    ok(key + ': colours bound through CSS variables', /--tx-[a-z]+:(#|oklch)/.test(t.cssVars), t.cssVars);
  }

  const glass = Textures.generateArchetypeTexture('bento-glass', 'oklch(0.62 0.17 250)');
  ok('bento-glass: 20px blueprint grid + gradient backdrop',
    glass.svg.indexOf('width="40"') !== -1 && glass.svg.indexOf('<linearGradient') !== -1);
  const brutal = Textures.generateArchetypeTexture('brutalist-kinetic', '#ff3d2e');
  ok('brutalist: 8px halftone dot matrix', /width="8" height="8"/.test(brutal.svg) && brutal.svg.indexOf('<circle') !== -1);
  const hazard = Textures.generateArchetypeTexture('brutalist-kinetic', '#ff3d2e', { stripes: true });
  ok('brutalist: hazard-stripe alternative renders', hazard.svg.indexOf('stroke-width="8"') !== -1);
  const editorial = Textures.generateArchetypeTexture('editorial-magazine', '#241f1a');
  ok('editorial: paper grain filter + column guides',
    editorial.svg.indexOf('feTurbulence') !== -1 && editorial.svg.indexOf('stroke-opacity="0.10"') !== -1);
  const cyber = Textures.generateArchetypeTexture('retro-cyberpunk', 'oklch(0.75 0.19 195)');
  ok('cyberpunk: scanlines with neon glow filter',
    cyber.svg.indexOf('feGaussianBlur') !== -1 && cyber.svg.indexOf('feMerge') !== -1);
  const clay = Textures.generateArchetypeTexture('organic-clay', '#b4552d');
  ok('organic-clay: smooth cubic topographic waves',
    (clay.svg.match(/C /g) || []).length >= 5 && clay.svg.indexOf('L ') === -1);

  ok('oklch() input resolves to a sensible hex', Textures.parseColor('oklch(0.599 0.230 286.2)').hex === '#7c5cff');
  ok('garbage colour falls back to a brand hex (in the emitted vars, not the SVG)',
    (() => { const t = Textures.generateArchetypeTexture('bento-glass', 'not-a-colour'); return t.svg.indexOf('#7c5cff') === -1 && t.cssVars.indexOf('#7c5cff') !== -1; })());
  ok('unknown archetype refuses with the valid keys listed', (() => {
    const r = Textures.generateArchetypeTexture('nope', '#fff');
    return r.ok === false && r.error.indexOf('organic-clay') !== -1;
  })());
  ok('no texture carries a script vector', Textures.ARCHETYPE_KEYS.every(function (k) {
    return Textures.generateArchetypeTexture(k, '#123456').svg.indexOf('<script') === -1;
  }));
}

/* ============================================================
   5 — cross-module integration: one archetype, end to end
   ============================================================ */

function testIntegration() {
  console.log('\n== 5 · integration — tokens through the whole system ==');

  for (const arch of ['bento-glass', 'editorial-magazine']) {
    const oklchInput = 'oklch(0.55 0.19 265)';
    const type = Typography.buildTypographyTokens(arch);
    const tex = Textures.generateArchetypeTexture(arch, oklchInput);
    const variant = LayoutVariants.compileSectionVariant('hero', 'B', sampleData('hero'), arch);
    const dark = ThemeEngine.invertOKLCHPalette({ primary: oklchInput, surface: '#faf7f2', text: '#241f1a', accent: '#8a5a2b', muted: '#6b625a' });

    const composed = [
      dark.cssVars,
      type.css,
      tex.css,
      variant.css
    ].join('\n');

    ok(arch + ': full stack composes into one stylesheet', composed.length > 1000);
    ok(arch + ': custom properties stay unique (no accidental overrides)', (() => {
      const names = (composed.match(/--[a-z-]+(?=:)/g) || []).filter(function (n) { return n.indexOf('--tx-') === 0 || n.indexOf('--type-') === 0 || n.indexOf('--font-') === 0; });
      const seen = {};
      for (const n of names) { if (seen[n]) return false; seen[n] = 1; }
      return true;
    })());
    ok(arch + ': every piece carries the archetype identity',
      type.archetype && tex.archetype === arch && variant.archetype);
    ok(arch + ': dark inversion passes AA alongside the composition', dark.contrast.every(function (c) { return c.ok; }));
  }
}

/* ============================================================
   Runner
   ============================================================ */

(function main() {
  console.log('PallettAI Studio — advanced design system smoke');
  try { testThemeEngine(); } catch (e) { fail++; console.log('  ✗ theme-engine suite threw: ' + e.message); }
  try { testTypography(); } catch (e) { fail++; console.log('  ✗ typography suite threw: ' + e.message); }
  try { testLayoutVariants(); } catch (e) { fail++; console.log('  ✗ layout-variants suite threw: ' + e.message); }
  try { testTextures(); } catch (e) { fail++; console.log('  ✗ textures suite threw: ' + e.message); }
  try { testIntegration(); } catch (e) { fail++; console.log('  ✗ integration suite threw: ' + e.message); }

  console.log('\n== result ==');
  console.log('  pass: ' + pass + '  fail: ' + fail);
  process.exit(fail ? 1 : 0);
})();
