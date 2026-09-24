'use strict';
// ============================================================
// PallettAI Studio — offline site extras smoke
// ------------------------------------------------------------
// The opt-in visitor features the builder can now emit and the
// one-click designer rotation helpers, checked where they could
// break:
//
//   1. Rotation helpers — DB.nextFont / DB.nextPalette cycle the
//      built-in lists deterministically, wrap around, and always
//      land somewhere real.
//   2. Defaults stay byte-safe — a project that never opted in
//      exports exactly what it exported before (no theme toggle,
//      no print block, no launch files).
//   3. Visitor theme toggle — boot snippet + alternate palette
//      block + toggle button + runtime, with the alternate aimed
//      at the mode the authored palette is NOT (a dark site gets a
//      light alternate), and every builder token overridden.
//   4. Print stylesheet — chrome-free ink output with link targets.
//   5. Launch kit — branded 404.html + valid site.webmanifest +
//      head links, and no broken references across the export.
//   6. Designer wiring pins — the new buttons and toggles exist in
//      both the markup and the bindings of app.js (source-level,
//      the way ipc-hardening pins the shell).
//
// Usage: node scripts/site-extras-smoke.js   (exit 0 = green)
// ============================================================

const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');

// Builder resolves its data libs as globals in the renderer and as
// requires in Node — mirror the delivery-proof load order.
const DB = require(path.join(ROOT, 'data', 'db.js'));
global.DB = DB;
global.ONLINE = require(path.join(ROOT, 'data', 'online.js'));
global.Review = require(path.join(ROOT, 'data', 'review.js'));
global.Images = require(path.join(ROOT, 'data', 'images.js'));
global.Focus = require(path.join(ROOT, 'data', 'focus.js'));
global.OgCard = require(path.join(ROOT, 'data', 'ogcard.js'));
const Builder = require(path.join(ROOT, 'modules', 'builder.js'));
const Links = require(path.join(ROOT, 'data', 'links.js'));

let fails = 0;
let total = 0;
const ok = (cond, label) => {
  total++;
  console.log((cond ? '  ok   ' : '  FAIL ') + label);
  if (!cond) fails++;
};
const section = (title) => console.log('\n== ' + title + ' ==');

const makeProject = (siteExtra) => ({
  id: 'p1', name: 'Northwind Joinery', suites: [],
  site: Object.assign({
    name: 'Northwind Joinery', tagline: 'Bespoke kitchens, built to last',
    palette: 'midnight', font: 'inter', url: 'https://northwind.example',
    design: { radius: 18, spacing: 96, containerWidth: 1140 },
    pages: [{
      id: 'home', name: 'Home', slug: 'index', sections: [
        { type: 'hero', title: 'Bespoke kitchens', subtitle: 'We build kitchens. You get a quote in a day.' },
        { type: 'contact', title: 'Talk to us', text: 'Call us for a quote.' }
      ]
    }]
  }, siteExtra || {})
});
const htmlOf = (siteExtra) => Builder.buildSiteHTML(makeProject(siteExtra), { proExport: true });

// ============================================================
section('1. rotation helpers — deterministic wrap-around');
// ============================================================

const firstFont = DB.fonts[0].id;
const lastFont = DB.fonts[DB.fonts.length - 1].id;
ok(DB.nextFont(firstFont) === DB.fonts[1].id, 'nextFont advances one entry');
ok(DB.nextFont(lastFont) === firstFont, 'nextFont wraps at the end of the list');
ok(DB.nextFont('not-a-real-font') === firstFont, 'unknown id starts at the first entry');
ok(DB.nextFont('') === firstFont, 'empty id starts at the first entry');
let cursor = firstFont;
for (let i = 0; i < DB.fonts.length; i++) cursor = DB.nextFont(cursor);
ok(cursor === firstFont, 'a full cycle returns to the start (deterministic)');
ok(DB.nextPalette(DB.palettes[0].id) === DB.palettes[1].id, 'nextPalette advances one entry');
ok(DB.nextPalette(DB.palettes[DB.palettes.length - 1].id) === DB.palettes[0].id,
  'nextPalette wraps at the end of the list');
ok(DB.nextPalette('gone') === DB.palettes[0].id, 'unknown palette id starts at the first entry');
ok(DB.getFont(DB.nextFont(firstFont)).name.length > 0, 'rotated font resolves to a real entry');

// ============================================================
section('2. defaults — untouched projects export unchanged');
// ============================================================

const plain = htmlOf(null);
ok(plain.indexOf('data-theme-toggle') === -1, 'no theme toggle without the flag');
ok(plain.indexOf('pallettai.theme') === -1, 'no theme boot snippet without the flag');
ok(plain.indexOf('@media print') === -1, 'no print block without the flag');
ok(plain.indexOf('site.webmanifest') === -1, 'no manifest link without the flag');
const plainExtras = Builder.seoExtras(makeProject(null), {});
const plainNames = plainExtras.map((f) => f.name).sort();
ok(JSON.stringify(plainNames) === JSON.stringify(['llms.txt', 'robots.txt', 'sitemap.xml']),
  'file list without launch kit is the established set');

// ============================================================
section('3. visitor theme toggle (dark mode)');
// ============================================================

const darkOn = htmlOf({ darkMode: true });
ok(darkOn.indexOf('pallettai.theme') > -1, 'boot snippet resolves the theme before first paint');
ok(darkOn.indexOf('data-theme-toggle') > -1, 'toggle button present');
ok(darkOn.indexOf('class="pai-theme-toggle"') > -1, 'button is styled by its own class');
ok(darkOn.indexOf('pallettai:theme') > -1, 'runtime script ships with the page');
ok(darkOn.indexOf('--bg:') > -1 && darkOn.indexOf('--primary-text:') > -1,
  'alternate palette overrides the builder token names');

// The alternate aims at the mode the authored palette is NOT.
const lightPal = DB.palettes.find((p) => !p.dark) || DB.palettes[0];
const darkPal = DB.palettes.find((p) => p.dark) || DB.palettes[0];
const lightBase = htmlOf({ darkMode: true, palette: lightPal.id });
const darkBase = htmlOf({ darkMode: true, palette: darkPal.id });
ok(lightBase.indexOf(':root[data-theme="dark"]') > -1,
  'a light site gets a dark alternate (' + lightPal.name + ')');
ok(lightBase.indexOf('color-scheme:dark') > -1, 'and paints it with a dark colour scheme');
ok(darkBase.indexOf(':root[data-theme="light"]') > -1,
  'a dark site gets a light alternate (' + darkPal.name + ')');
ok(darkBase.indexOf('color-scheme:light') > -1, 'and paints it with a light colour scheme');
ok(darkBase.indexOf(':root[data-theme="dark"]') === -1,
  'the authored dark palette is not duplicated as an alternate');

// ============================================================
section('4. print stylesheet');
// ============================================================

const printOn = htmlOf({ printStyles: true });
ok(printOn.indexOf('@media print') > -1, 'print block present with the flag');
ok(printOn.indexOf('attr(href)') > -1, 'link targets print after the link text');
ok(printOn.indexOf('.nav') > -1 && printOn.indexOf('display:none!important') > -1,
  'chrome (nav/footer/buttons) drops away on paper');
ok(printOn.indexOf('break-inside:avoid') > -1, 'cards do not split across pages');

// ============================================================
section('5. launch kit — 404, webmanifest, head links');
// ============================================================

const kitProject = makeProject({ launchKit: true });
const kitExtras = Builder.seoExtras(kitProject, {});
const kitNames = kitExtras.map((f) => f.name).sort();
ok(JSON.stringify(kitNames) === JSON.stringify(
  ['404.html', 'llms.txt', 'robots.txt', 'site.webmanifest', 'sitemap.xml']),
  'launch kit adds 404.html and site.webmanifest to the export');

const manifest = kitExtras.find((f) => f.name === 'site.webmanifest');
let parsed = null;
try { parsed = JSON.parse(manifest.content); } catch (e) { parsed = null; }
ok(parsed && parsed.name === 'Northwind Joinery' && parsed.start_url === './index.html',
  'webmanifest is valid JSON with the site identity');
ok(parsed && /^#[0-9a-fA-F]{3,8}$/.test(parsed.theme_color) && /^#[0-9a-fA-F]{3,8}$/.test(parsed.background_color),
  'manifest colours come from the palette');

const notFound = kitExtras.find((f) => f.name === '404.html');
ok(notFound.content.indexOf('<h1>404</h1>') > -1 && notFound.content.indexOf('Northwind Joinery') > -1,
  '404 page is branded with the site name');
ok(notFound.content.indexOf('<style>') > -1 && notFound.content.indexOf('rel="stylesheet"') === -1,
  '404 page is self-contained (no external CSS to fail with it)');

const kitHtml = htmlOf({ launchKit: true });
ok(kitHtml.indexOf('<link rel="manifest" href="site.webmanifest">') > -1,
  'pages link the manifest');
ok(kitHtml.indexOf('<meta name="theme-color"') > -1, 'pages carry the theme-color meta');

// The link auditor must agree the export hangs together.
const kitPages = Builder.buildSitePages(kitProject, { proExport: true })
  .map((e) => ({ name: e.page.name, slug: e.page.slug, html: e.html }));
const audit = Links.audit(kitPages, kitExtras);
ok(audit.errors === 0, 'no broken references with every extra enabled: '
  + JSON.stringify((audit.findings || []).slice(0, 3)));

// Determinism: extras and pages reproduce byte-for-byte.
ok(JSON.stringify(Builder.seoExtras(kitProject, {}).map((f) => f.content))
  === JSON.stringify(kitExtras.map((f) => f.content)), 'extras output is deterministic');
ok(htmlOf({ darkMode: true }) === htmlOf({ darkMode: true }), 'page output is deterministic');

// ============================================================
section('6. designer wiring pins (app.js source)');
// ============================================================

const appSrc = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
[['btnRotatePalette', 'palette rotation button'],
 ['btnRotateFont', 'font rotation button'],
 ['siteDarkMode', 'dark mode toggle'],
 ['sitePrintStyles', 'print styles toggle'],
 ['siteLaunchKit', 'launch kit toggle']].forEach(([id, label]) => {
  const inMarkup = appSrc.indexOf('id="' + id + '"') > -1;
  const inBinding = new RegExp('\\$\\([\'"]#' + id + '[\'"]\\)').test(appSrc);
  ok(inMarkup && inBinding, label + ' is both rendered and bound (id "' + id + '")');
});
ok(appSrc.indexOf('DB.nextFont(') > -1 && appSrc.indexOf('DB.nextPalette(') > -1,
  'rotation buttons drive the shared cycling helpers');
ok(/histCapture\(\);[\s\S]{0,120}DB\.next/.test(appSrc),
  'rotations are captured in undo history');

console.log('\n' + (total - fails) + '/' + total + ' checks passed'
  + (fails ? ' — ' + fails + ' FAILED' : ' — ALL PASS'));
process.exit(fails ? 1 : 0);
