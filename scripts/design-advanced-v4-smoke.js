#!/usr/bin/env node
// ============================================================
// PallettAI Studio — Design Advanced v4 Smoke Runner
// Palette extraction · token serialization · bento geometry ·
// runtime injection — end-to-end with plain assertions.
//
//   node scripts/design-advanced-v4-smoke.js
// ============================================================
'use strict';

const zlib = require('zlib');
const ColorExtractor = require('../modules/color-extractor.js');
const TokenExporter = require('../modules/token-exporter.js');
const BentoMesh = require('../modules/bento-mesh.js');
const ThemeInjector = require('../modules/theme-injector.js');

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

/* ---------------- fixture builders ---------------- */

function crc32(buf) {
  const t = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  let c = 0xFFFFFFFF;
  for (const b of buf) c = t[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
// Real zlib-compressed RGB PNG.
function makePNG(w, h, pxFn) {
  const raw = Buffer.alloc(h * (1 + w * 3));
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;
    for (let x = 0; x < w; x++) { const c = pxFn(x, y); raw[o++] = c[0]; raw[o++] = c[1]; raw[o++] = c[2]; }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}
function makeBMP(w, h, rgb) {
  const rowBytes = w * 3, rowPad = (4 - (rowBytes % 4)) % 4;
  const pix = Buffer.alloc(h * (rowBytes + rowPad));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = y * (rowBytes + rowPad) + x * 3;
    pix[o] = rgb[2]; pix[o + 1] = rgb[1]; pix[o + 2] = rgb[0];
  }
  const dib = Buffer.alloc(40);
  dib.writeUInt32LE(40, 0); dib.writeInt32LE(w, 4); dib.writeInt32LE(h, 8);
  dib.writeUInt16LE(1, 12); dib.writeUInt16LE(24, 14);
  return Buffer.concat([Buffer.from('BM'), Buffer.alloc(8), Buffer.from([54, 0, 0, 0]), dib, pix]);
}
// Minimal iframe-document stub for the injector.
function makeDocStub() {
  const store = new Map();
  const el = {
    style: {
      setProperty: (k, v) => store.set(k, String(v)),
      getPropertyValue: (k) => (store.has(k) ? store.get(k) : ''),
      removeProperty: (k) => { const v = store.get(k); store.delete(k); return v || ''; }
    }
  };
  const classes = new Set();
  const styles = [];
  const doc = {
    documentElement: el,
    body: {
      classList: {
        add: (...cs) => cs.forEach((c) => classes.add(c)),
        remove: (...cs) => cs.forEach((c) => classes.delete(c)),
        contains: (c) => classes.has(c),
        get length() { return classes.size; },
        *[Symbol.iterator]() { yield* classes; }
      }
    },
    head: { appendChild: (s) => styles.push(s) },
    createElement: () => ({ id: '', textContent: '' }),
    getElementById: () => null
  };
  doc.__store = store;
  doc.__classes = classes;
  doc.__styles = styles;
  return doc;
}

/* ============================================================
   1 — palette extraction + OKLCH roles
   ============================================================ */
section('color-extractor: PNG / BMP / raw decode');

// Red-dominant logo with a blue corner block.
const logoPNG = makePNG(64, 64, (x, y) => (x < 20 && y < 20 ? [30, 60, 220] : [200, 30, 40]));
const pal = ColorExtractor.extractImagePalette(logoPNG, 4);
ok(pal.ok === true, 'PNG palette extraction ok');
eq(pal.size.width, 64, 'PNG dimensions read');
eq(pal.dominantHex, '#c81e28', 'dominant colour is the 90% cluster');
ok(pal.colors.length >= 2 && pal.colors.length <= 4, 'cluster count respects maxColors');
ok(Math.abs(pal.colors.reduce((s, c) => s + c.weight, 0) - 1) < 0.01, 'cluster weights sum to 1');
eq(pal.colors[0].hex, pal.dominantHex, 'dominant = heaviest cluster');

const bmp = ColorExtractor.extractImagePalette(makeBMP(16, 16, [200, 30, 40]), 3);
ok(bmp.ok === true, 'BMP palette extraction ok');
eq(bmp.colors[0].hex, '#c81e28', 'BMP uniform image yields exactly its colour');

const raw = Buffer.alloc(4 + 4 * 4 * 4);
raw[0] = 4; raw[1] = 0; raw[2] = 4; raw[3] = 0;
for (let i = 0; i < 16; i++) { raw[4 + i * 4] = 200; raw[4 + i * 4 + 1] = 30; raw[4 + i * 4 + 2] = 40; raw[4 + i * 4 + 3] = 255; }
const rawPal = ColorExtractor.extractImagePalette(raw, 3);
ok(rawPal.ok === true && rawPal.colors[0].hex === '#c81e28', 'raw RGBA buffer accepted');

ok(ColorExtractor.extractImagePalette(Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])).ok === false, 'JPEG rejected with honest error');
ok(ColorExtractor.extractImagePalette(Buffer.alloc(10)).ok === false, 'tiny buffer rejected');

section('color-extractor: determinism + OKLCH roles');

const again = ColorExtractor.extractImagePalette(logoPNG, 4);
eq(JSON.stringify(again.colors), JSON.stringify(pal.colors), 'same input → same palette (deterministic k-means)');

const roles = ColorExtractor.mapPaletteToOKLCH(pal.colors.map((c) => c.hex));
ok(roles.ok === true, 'mapPaletteToOKLCH ok');
for (const role of ['primary', 'secondary', 'accent', 'background', 'surface', 'text']) {
  const c = roles.palette[role];
  ok(c && isFinite(c.L) && isFinite(c.C) && isFinite(c.H), role + ': OKLCH components finite');
  ok(/^#[0-9a-f]{6}$/i.test(c.hex), role + ': hex attached');
  ok(c.css.indexOf('oklch(') === 0, role + ': css string attached');
}
ok(roles.palette.background.L > 0.9 || roles.palette.background.L < 0.25, 'background is a pole (L ' + roles.palette.background.L.toFixed(2) + ')');
eq(roles.derivedNeutrals.join(','), 'secondary,background,surface,text', 'saturated-only logo derives neutrals honestly');
ok(roles.palette.primary.C > 0.15, 'brand colour kept as primary (C ' + roles.palette.primary.C.toFixed(2) + ')');

// Palette WITH real neutrals → no derivation, chroma preserved.
const r4 = ColorExtractor.mapPaletteToOKLCH(['#f4f1ea', '#1a1a1a', '#c81e28', '#1e3cdc']);
ok(r4.derivedNeutrals.indexOf('background') === -1 && r4.derivedNeutrals.indexOf('text') === -1, 'real neutrals keep background/text roles');
eq(r4.palette.background.hex, '#f4f1ea', 'lightest neutral becomes background');
ok(['#c81e28', '#1e3cdc'].indexOf(r4.palette.primary.hex) !== -1, 'a brand colour becomes primary');

ok(ColorExtractor.mapPaletteToOKLCH(['#fff']).ok === false, 'single colour rejected (need contrast)');
ok(ColorExtractor.mapPaletteToOKLCH(['nope', '#fff']).ok === false, 'invalid hex rejected');

section('color-extractor: archetype contrast enforcement');

const cyber = ColorExtractor.enforceArchetypeContrast(roles.palette, 'retro-cyberpunk');
ok(cyber.ok === true, 'enforcement ok on dark archetype');
eq(cyber.passes, true, 'dark archetype gate passes after adjustment');
for (const a of cyber.adjustments) {
  ok(a.ratio >= 4.5 || a.unreachable === true, a.role + ': WCAG ≥4.5 after adjustment (' + a.ratio + ')');
}
const edit = ColorExtractor.enforceArchetypeContrast(roles.palette, 'editorial-magazine');
eq(edit.passes, true, 'light archetype gate passes');
ok(edit.adjustments.every((a) => a.ratio >= 4.5), 'all editorial adjustments clear AA');
// Hue must never move during enforcement.
for (const role of ['primary', 'accent', 'text']) {
  const before = roles.palette[role];
  const after = cyber.palette[role];
  if (after) ok(Math.abs(after.H - before.H) < 0.5, role + ': hue stable through enforcement');
}
ok(ColorExtractor.enforceArchetypeContrast(roles.palette, 'nope').ok === false, 'unknown archetype rejected');
ok(ColorExtractor.enforceArchetypeContrast({}).ok === false, 'empty palette rejected');

/* ============================================================
   2 — token exporter
   ============================================================ */
section('token-exporter: Tailwind v4 @theme');

const tokenMap = {
  colors: {
    primary: roles.palette.primary.hex,
    accent: roles.palette.accent.hex,
    background: cyber.palette.background.hex,
    surface: '#ffffff',
    text: '#1a1a1a',
    onPrimary: '#ffffff'
  },
  fonts: { sans: 'Inter, system-ui, sans-serif', mono: 'ui-monospace, monospace' },
  typography: {
    h1: { size: 'clamp(2rem, 1.5rem + 2vw, 3.5rem)', lineHeight: 1.1, tracking: '-0.02em' },
    body: { size: '1rem', lineHeight: 1.6 }
  },
  spacing: { 4: 16, 8: 32 },
  radii: { md: 12, pill: 9999 },
  shadows: { md: '0 8px 24px rgba(0,0,0,.12)' },
  meta: { name: 'Redline', archetype: 'retro-cyberpunk' }
};

const tw = TokenExporter.exportToTailwindV4(tokenMap);
ok(tw.ok === true, 'Tailwind v4 export ok');
ok(tw.css.startsWith('@theme {') && tw.css.trimEnd().endsWith('}'), 'output is a single @theme block');
for (const p of ['--color-primary', '--color-accent', '--font-sans', '--text-h1', '--radius-pill', '--shadow-md']) {
  ok(tw.css.indexOf(p + ':') !== -1, p + ' declared');
}
ok(tw.css.indexOf('--text-h1--line-height: 1.1;') !== -1, 'v4 line-height modifier token');
ok(tw.css.indexOf('--text-h1--letter-spacing: -0.02em;') !== -1, 'v4 letter-spacing modifier token');
ok(tw.css.indexOf('--spacing: 1rem;') !== -1, 'v4 spacing multiplier from scale');
ok(tw.vars.length >= 14, 'var list complete (' + tw.vars.length + ')');
ok(TokenExporter.exportToTailwindV4({}).warnings.length > 0, 'empty map warns instead of lying');

section('token-exporter: W3C DTCG JSON');

const sd = TokenExporter.exportToStyleDictionary(tokenMap);
ok(sd.ok === true, 'DTCG export ok');
eq(sd.json.color.primary.$type, 'color', 'colour $type');
eq(sd.json.color.primary.$value, roles.palette.primary.hex, 'colour $value verbatim');
eq(sd.json.radius.md.$type, 'dimension', 'radius $type');
eq(sd.json.radius.md.$value, '12px', 'radius dimension value');
eq(sd.json.typography.h1.lineHeight.$type, 'number', 'unitless line-height stays number');
eq(sd.json.typography.h1.lineHeight.$value, 1.1, 'line-height value not corrupted to px');
ok(sd.json.typography.h1.fontSize.$type === undefined && sd.json.typography.h1.fontSize.$value.indexOf('clamp(') === 0, 'clamp size left honestly untyped');
ok(sd.json.spacing['spacing-4'].$value === '16px', 'spacing dimension');
ok(sd.tokenCount === 18, 'token count exact (' + sd.tokenCount + ')');
ok(typeof sd.string === 'string' && sd.string.indexOf('{') === 0, 'JSON string form present');
ok(JSON.parse(sd.string).color.primary.$value === sd.json.color.primary.$value, 'JSON string round-trips');

section('token-exporter: minified CSS variables');

const cv = TokenExporter.exportToCSSVariables(tokenMap);
ok(cv.ok === true, 'CSS variables export ok');
ok(cv.css.startsWith(':root{--pai-primary:') && cv.css.indexOf('\n') === -1, 'minified :root block, single line');
ok(cv.css.endsWith('}'), 'block closes');
ok((cv.css.match(/--pai-/g) || []).length === cv.vars.length, 'every var declared exactly once');
ok(cv.css.indexOf('--pai-space-4:1rem;') !== -1, 'spacing px→rem');
ok(cv.css.indexOf('--pai-radius-pill:9999px') !== -1, 'numeric radius → px');
const cv2 = TokenExporter.exportToCSSVariables(tokenMap, 'BrandX');
ok(cv2.css.indexOf('--brandx-primary:') !== -1, 'custom prefix honoured');

const all = TokenExporter.exportAll(tokenMap);
ok(all.ok === true && all.tailwind && all.styleDictionary && all.cssVariables, 'exportAll composes three formats');
ok(all.counts.dtcgTokens === sd.tokenCount && all.counts.cssVars === cv.vars.length, 'counts consistent');

/* ============================================================
   3 — bento mesh
   ============================================================ */
section('bento-mesh: span math 3–8');

for (let n = 3; n <= 8; n++) {
  const l = BentoMesh.generateBentoLayout(n, 'bento-glass');
  ok(l.ok === true, n + ' items: layout ok');
  const occ = new Set();
  let cells = 0, overlap = false, oob = false;
  for (const it of l.items) {
    cells += it.colSpan * it.rowSpan;
    for (let c = it.colStart; c < it.colStart + it.colSpan; c++) {
      for (let r = it.rowStart; r < it.rowStart + it.rowSpan; r++) {
        const k = c + ':' + r;
        if (occ.has(k)) overlap = true;
        occ.add(k);
        if (c > l.columns || r > l.rows) oob = true;
      }
    }
  }
  eq(cells, l.columns * l.rows, n + ' items: exact tile fill (hole-free)');
  ok(!overlap && !oob, n + ' items: no overlaps, no out-of-bounds');
  ok(l.items.length === n, n + ' items: item count preserved');
  ok(l.weights[0] === 1, n + ' items: lead weight 1.0');
  ok(Math.min.apply(null, l.weights) >= 0.5, n + ' items: weights stay in 0.5–1.0 band');
  ok(l.items.every((it) => /grid-column:\d+ \/ span \d+/.test(it.style)), n + ' items: explicit placements');
}
ok(BentoMesh.generateBentoLayout(2, 'bento-glass').ok === false, '2 items rejected');
ok(BentoMesh.generateBentoLayout(9, 'bento-glass').ok === false, '9 items rejected');
ok(BentoMesh.generateBentoLayout(5, 'nope').ok === false, 'unknown archetype rejected');

// Lead rotation keeps geometry, shifts weights.
const base = BentoMesh.generateBentoLayout(6, 'bento-glass');
const rotated = BentoMesh.generateBentoLayout(6, 'bento-glass', { leadIndex: 2 });
eq(JSON.stringify(rotated.items.map((i) => [i.colStart, i.rowStart, i.colSpan, i.rowSpan])),
  JSON.stringify(base.items.map((i) => [i.colStart, i.rowStart, i.colSpan, i.rowSpan])), 'lead rotation preserves geometry');
eq(rotated.items[2].role, 'lead', 'leadIndex promotes requested tile');

section('bento-mesh: archetype effects + mobile fallback');

const glassFx = BentoMesh.applyBentoGlassEffects('bento-glass');
ok(glassFx.css.indexOf('blur(12px)') !== -1, 'bento glass: 12px backdrop blur');
ok(glassFx.effects.indexOf('backdrop-blur-12') !== -1, 'bento glass: effect list');
const brutFx = BentoMesh.applyBentoGlassEffects('brutalist');
ok(brutFx.css.indexOf('4px solid var(--c-ink') !== -1 && brutFx.css.indexOf('6px 6px 0 0') !== -1, 'brutalist: hard border + offset shadow');
const clayFx = BentoMesh.applyBentoGlassEffects('organic-clay');
ok(clayFx.css.indexOf('inset 0 3px 6px') !== -1 && clayFx.css.indexOf('border:none') !== -1, 'clay: dual inset, borderless');
const cyberFx = BentoMesh.applyBentoGlassEffects('retro-cyberpunk');
ok(cyberFx.css.indexOf('clip-path:polygon(') !== -1, 'cyberpunk: clipped corners');

for (const a of BentoMesh.ARCHETYPES) {
  const ss = BentoMesh.generateBentoStylesheet(5, a);
  ok(ss.ok === true, a + ': composed stylesheet ok');
  ok(ss.css.indexOf('@container pa-bento-bento (max-width: 47.99rem)') !== -1, a + ': container-query mobile fallback');
  ok(ss.css.indexOf('grid-template-columns:1fr;') !== -1, a + ': fallback stacks to one column');
  ok(ss.css.indexOf('grid-row:auto;') !== -1, a + ': fallback releases explicit rows');
  const opens = (ss.css.match(/\{/g) || []).length;
  const closes = (ss.css.match(/\}/g) || []).length;
  eq(opens, closes, a + ': braces balanced');
}

/* ============================================================
   4 — runtime theme injection
   ============================================================ */
section('theme-injector: variable injection');

const doc = makeDocStub();
const inj1 = ThemeInjector.injectThemeTokens(doc, tokenMap);
ok(inj1.ok === true, 'injection ok');
ok(inj1.applied.length >= 14, 'all tokens applied (' + inj1.applied.length + ')');
eq(doc.__store.get('--pai-primary'), roles.palette.primary.hex, 'setProperty receives colour value verbatim');
eq(doc.__store.get('--pai-radius-md'), '12px', 'numeric radius injected as px');
eq(doc.__store.get('--pai-space-4'), '1rem', 'spacing injected as rem');

const inj2 = ThemeInjector.injectThemeTokens(doc, tokenMap);
eq(inj2.applied.length, 0, 'identical re-injection touches nothing (diffed)');

const inj3 = ThemeInjector.injectThemeTokens(doc, Object.assign({}, tokenMap, { colors: Object.assign({}, tokenMap.colors, { primary: '#ff0000' }) }));
eq(inj3.applied.join(','), '--pai-primary', 'changed token only is re-applied');

const flat = ThemeInjector.injectThemeTokens(makeDocStub(), { primary: '#0f0', '--x-custom': '1' });
ok(flat.applied.indexOf('--pai-primary') !== -1 && flat.applied.indexOf('--x-custom') !== -1, 'flat maps + raw custom props accepted');
ok(ThemeInjector.injectThemeTokens(null, tokenMap).ok === false, 'missing document rejected');
ok(ThemeInjector.injectThemeTokens({}, tokenMap).ok === false, 'stub without documentElement rejected');

section('theme-injector: runtime archetype switch');

const catalog = {
  'retro-cyberpunk': { colors: { primary: '#00fff2', background: '#0c0c1c', text: '#e6f7ff' } },
  'organic-clay': { colors: { primary: '#b3552e', background: '#f3ede6', text: '#33241c' } }
};
(async function () {
  const sw1 = await ThemeInjector.switchArchetypeRuntime(doc, 'retro-cyberpunk', catalog, { fadeMs: 4 });
  ok(sw1.ok === true, 'switch resolves');
  eq(sw1.archetype, 'retro-cyberpunk', 'canonical archetype returned');
  eq(sw1.bodyClass, 'pa-arch-retro-cyberpunk', 'body class swapped');
  eq(doc.__store.get('--pai-primary'), '#00fff2', 'catalog tokens injected during switch');
  ok(doc.__store.get('--pai-font-display').indexOf('Orbitron') !== -1, 'archetype font hooks applied');
  ok(!doc.__classes.has('pa-arch-faded'), 'document not left faded out');
  ok(doc.__styles.length === 1 && doc.__styles[0].textContent.indexOf('200ms') !== -1, 'transition stylesheet installed once with 200ms fades');
  ok(doc.__styles[0].textContent.indexOf('prefers-reduced-motion') !== -1, 'fade is reduced-motion aware');

  const sw2 = await ThemeInjector.switchArchetypeRuntime(doc, 'organic-clay', catalog, { fadeMs: 4 });
  eq(sw2.previous, 'retro-cyberpunk', 'previous archetype reported on second switch');
  ok(doc.__classes.has('pa-arch-organic-clay') && !doc.__classes.has('pa-arch-retro-cyberpunk'), 'classes swapped cleanly');
  eq(doc.__store.get('--pai-primary'), '#b3552e', 'new catalog tokens injected');

  // Catalog as resolver function.
  const sw3 = await ThemeInjector.switchArchetypeRuntime(doc, 'editorial-magazine', (key) => ({ colors: { primary: '#111111' }, fonts: { serif: 'Georgia, serif' } }), { fadeMs: 4 });
  ok(sw3.ok === true && doc.__store.get('--pai-primary') === '#111111', 'function catalog resolved');

  const bad = await ThemeInjector.switchArchetypeRuntime(doc, 'wibble', catalog);
  ok(bad.ok === false && /Unknown archetype/.test(bad.error), 'unknown archetype rejects via promise');
  ok(ThemeInjector.canonicalKey('Editorial Magazine') === 'editorial-magazine', 'canonicalKey normalises');
})();

/* ============================================================
   5 — cross-module integration
   ============================================================ */
section('cross-module integration');

// extract → roles → enforce → export → inject, one chain.
const doc2 = makeDocStub();
const chainEnforced = ColorExtractor.enforceArchetypeContrast(roles.palette, 'neo-minimalist');
const chainTokens = {
  colors: {
    primary: chainEnforced.palette.primary.hex,
    accent: chainEnforced.palette.accent.hex,
    background: chainEnforced.palette.background.hex,
    text: chainEnforced.palette.text.hex,
    surface: chainEnforced.palette.surface.hex
  }
};
const chainInjected = ThemeInjector.injectThemeTokens(doc2, chainTokens);
ok(chainInjected.ok && chainInjected.applied.length === 5, 'extraction → injection chain applies 5 colour roles');
const chainExported = TokenExporter.exportToTailwindV4(chainTokens);
ok(chainExported.css.indexOf(chainTokens.colors.primary) !== -1, 'extracted hex survives the Tailwind export verbatim');

// Bento sheet + injected tokens + kinetic-free components coexist.
const sheet = BentoMesh.generateBentoStylesheet(6, 'retro-cyberpunk');
const composed = sheet.css + '\n' + chainExported.css;
ok(composed.indexOf('@container') !== -1 && composed.indexOf('@theme') !== -1, 'container queries + @theme compose in one artifact');
ok(sheet.items[0].colSpan === 2 && sheet.items[0].rowSpan === 2, 'lead keeps its 2×2 in composed output');

/* ============================================================
   summary
   ============================================================ */
setTimeout(() => {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (fail > 0) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('design-advanced-v4 smoke: ALL GREEN');
}, 50);
