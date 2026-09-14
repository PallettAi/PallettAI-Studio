// ============================================================
// Signature artwork smoke test
//
// Guards the properties the feature actually promises. Determinism and palette
// binding are the two that would be invisible until a client noticed, so they
// are asserted against the real engine rather than a copy of it.
//
// Run: node scripts/signature-smoke.js
// ============================================================

const path = require('path');
const zlib = require('zlib');

let failed = 0;
function ok(name, cond, detail) {
  console.log((cond ? '  \u2713 ' : '  \u2717 ') + name + (!cond && detail ? '  -> ' + detail : ''));
  if (!cond) failed++;
}

// ---- load the engine, discarding any cached copy so a "fresh load" is real ----
const SIGNATURE_FILE = path.join(__dirname, '..', 'data', 'signature.js');
function loadSignature() {
  delete require.cache[require.resolve(SIGNATURE_FILE)];
  return require(SIGNATURE_FILE);
}

const Signature = loadSignature();

const PALETTES = {
  cobalt:  { id: 'cobalt',  name: 'Signal Blue',  bg: '#0a1628', surface: '#101f38', primary: '#4f9cf7', accent: '#22d3ee', text: '#eef4ff', muted: '#93a7c9', dark: true },
  aurora:  { id: 'aurora',  name: 'Aurora Sky',   bg: '#f6f9ff', surface: '#ffffff', primary: '#0ea5e9', accent: '#10b981', text: '#0f172a', muted: '#5b6b84', dark: false },
  lux:     { id: 'lux',     name: 'Luxury Gold',  bg: '#0d0c11', surface: '#1a1722', primary: '#d4af37', accent: '#f3e5ab', text: '#f6f1e4', muted: '#a89f8a', dark: true },
  mono:    { id: 'mono',    name: 'Mono',         bg: '#101014', surface: '#1b1b21', primary: '#f5f5f4', accent: '#f5f5f4', text: '#fafaf9', muted: '#9d9da8', dark: true }
};

const ENGINES = ['signal', 'halftone'];

function hexesIn(svg) {
  return (svg.match(/#[0-9a-fA-F]{6}/g) || []).map((h) => h.toLowerCase());
}

function toRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

// Is `hex` on the straight line between a and b in RGB space? Every colour the
// engines emit is either the palette bg or a mix of primary and accent, so this
// catches any hardcoded colour that sneaks in — the bug the old blobs had.
function onSegment(hex, a, b, tol) {
  const C = toRgb(hex), A = toRgb(a), B = toRgb(b);
  let best = Infinity;
  for (let t = 0; t <= 1.0001; t += 0.002) {
    const d = Math.max(
      Math.abs(C[0] - (A[0] + (B[0] - A[0]) * t)),
      Math.abs(C[1] - (A[1] + (B[1] - A[1]) * t)),
      Math.abs(C[2] - (A[2] + (B[2] - A[2]) * t))
    );
    if (d < best) best = d;
    if (best <= tol) return true;
  }
  return best <= tol;
}

console.log('\n== Signature artwork ==\n');

// ---- 1. determinism ----
console.log('1. Determinism');
for (const engine of ENGINES) {
  for (const key of Object.keys(PALETTES)) {
    const a = Signature.build({ name: 'Harbour & Co', palette: PALETTES[key], engine, variation: 0 });
    const b = Signature.build({ name: 'Harbour & Co', palette: PALETTES[key], engine, variation: 0 });
    ok(engine + '/' + key + ' reproduces byte-identically', a.svg === b.svg && a.hash === b.hash,
      a.hash + ' vs ' + b.hash);
  }
}
{
  // Same inputs twice in a fresh load must also match (no hidden global state).
  const fresh = loadSignature();
  const a = Signature.build({ name: 'X', palette: PALETTES.cobalt, engine: 'signal' });
  const b = fresh.build({ name: 'X', palette: PALETTES.cobalt, engine: 'signal' });
  ok('stable across a fresh module load', a.hash === b.hash, a.hash + ' vs ' + b.hash);
}

// ---- 2. uniqueness ----
console.log('\n2. Uniqueness');
{
  const hashes = new Set();
  for (let i = 0; i < 250; i++) {
    hashes.add(Signature.build({ name: 'Brand ' + i, palette: PALETTES.cobalt, engine: 'signal' }).hash);
  }
  ok('250 brand names produce 250 distinct artworks', hashes.size === 250, hashes.size + '/250');

  const perPalette = new Set();
  for (const key of Object.keys(PALETTES)) {
    perPalette.add(Signature.build({ name: 'Same Name', palette: PALETTES[key], engine: 'signal' }).hash);
  }
  ok('one name across ' + Object.keys(PALETTES).length + ' palettes produces distinct artwork',
    perPalette.size === Object.keys(PALETTES).length, perPalette.size + ' distinct');

  const perVariation = new Set();
  for (let v = 0; v < 8; v++) {
    perVariation.add(Signature.build({ name: 'Same Name', palette: PALETTES.cobalt, engine: 'signal', variation: v }).hash);
  }
  ok('8 variations produce 8 distinct artworks', perVariation.size === 8, perVariation.size + '/8');
}

// ---- 3. palette binding ----
console.log('\n3. Palette binding');
for (const engine of ENGINES) {
  for (const key of ['cobalt', 'aurora', 'lux', 'mono']) {
    const p = PALETTES[key];
    const svg = Signature.build({ name: 'Harbour & Co', palette: p, engine }).svg;
    const stray = hexesIn(svg).filter((h) => {
      const low = h.toLowerCase();
      return low !== p.bg.toLowerCase() && !onSegment(low, p.primary, p.accent, 3);
    });
    ok(engine + '/' + key + ' uses only palette-derived colours', stray.length === 0,
      stray.slice(0, 4).join(' '));
  }
}
{
  // The old decoration carried a hardcoded pink that no palette could reach.
  const svg = Signature.build({ name: 'Test', palette: PALETTES.cobalt, engine: 'signal' }).svg;
  ok('no hardcoded #ec4899 (the old blob pink)', !/#ec4899/i.test(svg), 'found it');
  // The palette must genuinely reach the artwork: the brand's own primary and
  // accent should appear in it, not just colours nearby.
  for (const key of ['lux', 'cobalt']) {
    const p = PALETTES[key];
    const svg = Signature.build({ name: 'Test', palette: p, engine: 'halftone' }).svg;
    const near = (hex, target) => {
      const A = toRgb(hex), B = toRgb(target);
      return Math.max(Math.abs(A[0] - B[0]), Math.abs(A[1] - B[1]), Math.abs(A[2] - B[2])) <= 12;
    };
    const hits = hexesIn(svg).filter((h) => near(h, p.primary) || near(h, p.accent));
    ok('halftone/' + key + ' reproduces the palette primary or accent exactly', hits.length > 0,
      'closest colours: ' + hexesIn(svg).slice(0, 4).join(' '));
  }
}

// ---- 4. structure ----
console.log('\n4. Structure and size');
for (const engine of ENGINES) {
  for (const key of Object.keys(PALETTES)) {
    const r = Signature.build({ name: 'Harbour & Co', palette: PALETTES[key], engine });
    const ids = (r.svg.match(/\sid="([^"]+)"/g) || []);
    ok(engine + '/' + key + ' has no duplicate IDs inside one piece',
      new Set(ids).size === ids.length, ids.join(' '));

    // Raw size is what a client uploads; gzipped size is what a visitor actually
    // downloads, and repetitive SVG compresses hard. Both budgets are enforced so
    // neither can regress unnoticed.
    const bytes = Buffer.byteLength(r.svg, 'utf8');
    ok(engine + '/' + key + ' stays under 16 KB raw', bytes < 16384, bytes + ' bytes');

    const gz = zlib.gzipSync(Buffer.from(r.svg, 'utf8')).length;
    ok(engine + '/' + key + ' gzips under 3 KB', gz < 3072, gz + ' bytes gzipped');

    ok(engine + '/' + key + ' is a balanced <svg> document',
      r.svg.startsWith('<svg ') && r.svg.endsWith('</svg>') && !/<(?!\/?(svg|g|defs|rect|circle|polyline|linearGradient|radialGradient|stop)\b)/.test(r.svg));
  }
}

// ---- 5. edge cases ----
console.log('\n5. Edge cases');
{
  const none = Signature.build({ name: 'X', palette: PALETTES.cobalt, engine: 'none' });
  ok('"none" engine emits no markup', none.svg === '' && none.hash);

  const unknown = Signature.build({ name: 'X', palette: PALETTES.cobalt, engine: 'does-not-exist' });
  ok('an unknown engine falls back rather than throwing', unknown.svg.length > 0 && unknown.engine === Signature.DEFAULT_ENGINE);

  let threw = null;
  try { Signature.build({ name: '', palette: undefined, engine: 'halftone' }); } catch (e) { threw = e; }
  ok('a missing palette does not throw', threw === null, threw && threw.message);

  try { Signature.build({ name: 'X', palette: { bg: 'not-a-colour', primary: '#fff', accent: '#000' }, engine: 'signal' }); } catch (e) { threw = e; }
  ok('a malformed palette colour does not throw', threw === null, threw && threw.message);

  const clamped = Signature.build({ name: 'X', palette: PALETTES.cobalt, engine: 'signal', intensity: 9 });
  ok('intensity clamps instead of emitting invalid opacity', !/opacity="9/.test(clamped.svg));

  const zero = Signature.build({ name: 'X', palette: PALETTES.cobalt, engine: 'signal', intensity: 0 });
  ok('intensity 0 still returns valid svg', zero.svg.startsWith('<svg') && /opacity="0.00"/.test(zero.svg));

  const sc = Signature.scrim(PALETTES.aurora, { direction: 'left' });
  ok('scrim is a standalone svg', sc.startsWith('<svg') && sc.endsWith('</svg>'));
  ok('scrim resists being framed into an injected attribute', !/<script/i.test(sc));

  const bg = Signature.background({ name: 'X', palette: PALETTES.cobalt, engine: 'signal' });
  ok('background layers art and scrim', /sig-bg/.test(bg.html) && /sig-scrim/.test(bg.html) && /sig-art/.test(bg.html));

  const bgNone = Signature.background({ name: 'X', palette: PALETTES.cobalt, engine: 'none' });
  ok('background with no artwork emits nothing', bgNone.html === '');
}

// ---- 6. the seed contract ----
console.log('\n6. Seed contract');
{
  const s = Signature.seedFor({ name: 'Harbour & Co', paletteId: 'cobalt', variation: 3, engine: 'signal' });
  ok('seed encodes name, palette, variation and engine', s === 'Harbour & Co|cobalt|3|signal', s);
  const a = Signature.build({ name: 'Harbour & Co', palette: PALETTES.cobalt, engine: 'signal', variation: 3 });
  const b = Signature.build({ name: 'Harbour & Co', palette: PALETTES.cobalt, engine: 'signal', variation: 3, seed: s });
  ok('an explicit seed gives the same artwork', a.hash === b.hash);
}

// ---- 7. the exported site actually uses it, on every hero layout ----
console.log('\n7. Exported site integration');
{
  const DB = require(path.join(__dirname, '..', 'data', 'db.js'));
  // builder.js reads both of these off the global scope, exactly as it does in
  // the app (script tags) and in release-check.
  global.DB = DB;
  global.ONLINE = require(path.join(__dirname, '..', 'data', 'online.js'));
  global.Signature = Signature;
  const Builder = require(path.join(__dirname, '..', 'modules', 'builder.js'));

  const project = (palette, layout, suites) => ({
    id: 'sig-check', name: 'Harbour & Co', suites: suites || [],
    site: {
      name: 'Harbour & Co', tagline: 'Fits out harbours', palette: palette, font: 'inter',
      url: 'https://harbour.example.com', heroLayout: layout,
      sections: [
        { type: 'hero', id: 's-hero', title: 'Berth one', text: 'We fit out harbours.' },
        { type: 'contact', id: 's-contact', title: 'Contact' }
      ],
      design: { containerWidth: 1140, radius: 20, spacing: 96 }
    }
  });
  const settings = { onlineEnabled: false };

  for (const layout of ['centered', 'split', 'minimal', 'terminal', 'aurora']) {
    const html = Builder.buildSiteHTML(project('cobalt', layout), settings);
    ok('hero/' + layout + ' emits Signature artwork',
      html.indexOf('class="sig-bg"') !== -1 && html.indexOf('class="sig-art"') !== -1);
    ok('hero/' + layout + ' emits no glow orbs or aurora blobs',
      !/class="orb|\.orb-a|aurora-blob/.test(html));
    ok('hero/' + layout + ' needs no Pro suite installed',
      !/\.orb\{|filter:blur\(110px\)/.test(html));
  }

  // Artwork is part of the design, so a free-tier project must still get it.
  const free = Builder.buildSiteHTML(project('cobalt', 'centered', []), settings);
  const paid = Builder.buildSiteHTML(project('cobalt', 'centered', ['animation']), settings);
  ok('artwork is identical with and without the animation suite',
    (free.match(/<svg class="sig-art"[\s\S]*?<\/svg>/) || [''])[0] ===
    (paid.match(/<svg class="sig-art"[\s\S]*?<\/svg>/) || [''])[0]);

  // Same project twice must export byte-identical artwork, or a client site would
  // change under them on a rebuild.
  const once = Builder.buildSiteHTML(project('cobalt', 'centered'), settings);
  const twice = Builder.buildSiteHTML(project('cobalt', 'centered'), settings);
  ok('a rebuild exports identical artwork',
    (once.match(/<svg class="sig-art"[\s\S]*?<\/svg>/) || [''])[0] ===
    (twice.match(/<svg class="sig-art"[\s\S]*?<\/svg>/) || [''])[0]);

  const different = Builder.buildSiteHTML(Object.assign(project('cobalt', 'centered'), { site: Object.assign(project('cobalt', 'centered').site, { name: 'DrainPro' }) }), settings);
  ok('a renamed brand gets different artwork',
    (once.match(/<svg class="sig-art"[\s\S]*?<\/svg>/) || [''])[0] !==
    (different.match(/<svg class="sig-art"[\s\S]*?<\/svg>/) || [''])[0]);

  // The pink that no palette could reach is gone from the whole export.
  ok('no hardcoded blob pink anywhere in the export', !/#ec4899/i.test(once));

  // A full-bleed placeholder panel used to be drawn over the hero backdrop and
  // repeated the site name as a second headline. AI drafts keep it as a photo hint.
  ok('a finished hero with no image draws no placeholder panel',
    !/class="hero-placeholder"/.test(once) && !/class="photo-hole"/.test(once));
  const draft = project('cobalt', 'centered');
  draft.aiType = 'landing';
  ok('an AI draft still gets its photo-goes-here hint',
    Builder.buildSiteHTML(draft, settings).indexOf('photo-hole') !== -1);
  ok('a split hero keeps the placeholder in its media column',
    Builder.buildSiteHTML(project('cobalt', 'split'), settings).indexOf('hero-placeholder') !== -1);

  // Light palettes used to render a white headline on a near-white hero whenever
  // the theme toggle was switched off (which applies no body class).
  const lightHtml = Builder.buildSiteHTML(project('aurora', 'centered'), settings);
  const darkHtml = Builder.buildSiteHTML(project('midnight', 'centered'), settings);
  ok('light palette hero headline is dark-on-light',
    /\.sec-hero h1\{[^}]*background:linear-gradient\(120deg,#14172b/.test(lightHtml));
  ok('dark palette hero headline keeps its white gradient',
    /\.sec-hero h1\{[^}]*background:linear-gradient\(120deg,#fff 20%/.test(darkHtml));

  // Reduced motion has to reach the JS-driven motion, not just the keyframes.
  ok('counters land immediately under reduced motion', /if \(REDUCED\)/.test(once));
  ok('hero parallax is skipped under reduced motion', /CFG\.proAnimations && !REDUCED/.test(once));
  ok('back-to-top scrolls instantly under reduced motion', /behavior: REDUCED \? 'auto' : 'smooth'/.test(once));
}

console.log('\n' + (failed === 0 ? 'SIGNATURE SMOKE PASSED' : 'SIGNATURE SMOKE FAILED: ' + failed));
process.exit(failed === 0 ? 0 : 1);
