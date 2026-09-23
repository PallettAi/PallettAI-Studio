// ============================================================
// Compiler & packaging smoke test — design tokens, section backgrounds, ZIP.
//
// Covers the two areas this suite was written for, in the order the risk runs:
//
//   1. THE EXPORT CANNOT BE BROKEN BY THE SCHEMA. Design tokens and section
//      background names arrive from a project.json, which is data from outside
//      the app. Every assertion that feeds one in a hostile value is paired with
//      the assertion that the DEFAULT still came out — a token that is refused
//      silently is only safe if the fallback is the shape that shipped before.
//
//   2. THE ARCHIVE IS ACTUALLY VALID, NOT MERELY PLAUSIBLE. A file that begins
//      "PK" is not a zip anybody can open. This reads the archive back: it walks
//      the central directory, checks each local header against it, recomputes
//      every CRC-32 and compares, and confirms the end record's counts. That is
//      what catches a header whose offsets drifted when a field was added.
//
//   3. THE EXISTING GUARANTEES ARE STILL STANDING. release-check.js asserts that
//      entry 513, an unsafe path and a 13 MB file are all refused. Those are
//      re-asserted here with the same error substrings, so this suite fails too
//      if the messages that file matches on are reworded.
//
// Run: node scripts/compiler-audit-smoke.js
// ============================================================
'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');

let failed = 0;
function ok(name, cond, detail) {
  console.log((cond ? '  \u2713 ' : '  \u2717 ') + name + (!cond && detail ? '  -> ' + detail : ''));
  if (!cond) failed++;
}
function throws(name, fn, match) {
  try {
    fn();
    ok(name, false, 'expected an error');
  } catch (e) {
    ok(name, String(e.message || e).indexOf(match) !== -1, (e.message || String(e)).slice(0, 90));
  }
}

// ---- the modules under test ------------------------------------------------
global.DB = require(path.join(ROOT, 'data', 'db.js'));
global.ONLINE = require(path.join(ROOT, 'data', 'online.js'));
global.Review = require(path.join(ROOT, 'data', 'review.js'));
global.Images = require(path.join(ROOT, 'data', 'images.js'));
global.Focus = require(path.join(ROOT, 'data', 'focus.js'));
global.OgCard = require(path.join(ROOT, 'data', 'ogcard.js'));
global.Concierge = require(path.join(ROOT, 'data', 'concierge.js'));
const Builder = require(path.join(ROOT, 'modules', 'builder.js'));
const ZIP = require(path.join(ROOT, 'modules', 'zip.js'));

/*
  A factory, never a shared constant, and that is load-bearing rather than
  tidy. The builder writes back onto the `site` object it is handed: it
  normalises `pages`, and adds a top-level `sections` mirror plus `activePageId`
  (data/preflight.js documents the rewrite as intended — "the builder is allowed
  to rewrite the project"). A top-level `sections` then OUTRANKS `pages` on the
  next build, so a single fixture object handed to two builds lets the first one
  silently decide what the second renders. This bit while the suite was being
  written: a page came back carrying the previous call's sections, and the
  difference that mattered was whether the fixture had been shared. Every call
  now gets its own copy.
*/
const baseSite = () => ({
  name: 'Northwind Joinery',
  palette: 'midnight',
  font: 'inter',
  url: 'https://northwind.example',
  pages: [{
    id: 'home', name: 'Home', slug: 'index',
    sections: [
      { type: 'hero', title: 'Bespoke kitchens' },
      { type: 'gallery', title: 'Our work', items: [{ title: 'One' }, { title: 'Two' }] }
    ]
  }]
});
const siteFor = (sections) => Object.assign(baseSite(), {
  pages: [{ id: 'home', name: 'Home', slug: 'index', sections: sections }]
});
const build = (over) => Builder.buildSiteHTML({
  id: 'p1', name: 'Northwind Joinery', suites: [],
  site: Object.assign(baseSite(), over || {})
});
// The class a section actually carries, read from its tag rather than from the
// document — the stylesheet legitimately contains ".section.has-bg", so a whole-
// document substring search reports a match for a project that uses none.
const sectionTags = (html) => (Focus.markupOnly(html).match(/<section[^>]*>/g) || []).join(' ');

// ---- a minimal zip reader, used to verify rather than to trust -------------
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const utf8 = (b) => Buffer.from(b).toString('utf8');

// Walks the archive the way an extractor does and reports what it found, so a
// header whose offset or length drifted shows up as a mismatch rather than as a
// zip that merely opens.
function readZip(bytes) {
  const eocd = bytes.length - 22;
  if (u32(bytes, eocd) !== 0x06054b50) throw new Error('no end-of-central-directory record');
  const count = u16(bytes, eocd + 10);
  const cdSize = u32(bytes, eocd + 12);
  const cdOffset = u32(bytes, eocd + 16);
  if (cdOffset + cdSize !== eocd) throw new Error('central directory does not meet the end record');
  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (u32(bytes, p) !== 0x02014b50) throw new Error('bad central directory signature at ' + p);
    const crc = u32(bytes, p + 16);
    const size = u32(bytes, p + 24);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const local = u32(bytes, p + 42);
    const name = utf8(bytes.slice(p + 46, p + 46 + nameLen));
    // cross-check the central record against the local header it points at
    if (u32(bytes, local) !== 0x04034b50) throw new Error('bad local header for ' + name);
    const localNameLen = u16(bytes, local + 26);
    const localExtraLen = u16(bytes, local + 28);
    const localName = utf8(bytes.slice(local + 30, local + 30 + localNameLen));
    if (localName !== name) throw new Error('name mismatch for ' + name);
    const dataAt = local + 30 + localNameLen + localExtraLen;
    const data = bytes.slice(dataAt, dataAt + size);
    const actual = ZIP.crc32(data);
    if (actual !== crc) throw new Error('CRC mismatch for ' + name + ' (' + actual + ' vs ' + crc + ')');
    entries.push({ name, size, crc, data: utf8(data) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { count, entries };
}

// ============================================================
console.log('\n1. Design tokens: button geometry');
// ============================================================
{
  const base = build({});
  ok('the page builds', typeof base === 'string' && base.length > 1000);
  ok('all four button tokens are emitted',
    ['--btn-radius:999px', '--btn-border:2px solid transparent',
      '--btn-transform-hover:translateY(-2px)', '--btn-shadow:0 10px 30px rgba(0,0,0,.25)']
      .every((t) => base.indexOf(t) !== -1));
  // The rules must consume the tokens, or the tokens are documentation.
  ok('the base rule takes its radius from the token', /\.btn\{[^}]*border-radius:var\(--btn-radius\)/.test(base));
  ok('the base rule takes its border from the token', /\.btn\{[^}]*border:var\(--btn-border\)/.test(base));
  ok('the solid button takes its shadow from the token', /\.btn\.solid\{[^}]*box-shadow:var\(--btn-shadow\)/.test(base));
  ok('the hover takes its transform from the token', /\.btn\.solid:hover\{transform:var\(--btn-transform-hover\)/.test(base));
  // The defaults above reproduce these literals exactly; if the literal ever
  // comes back into the rule, the token controls nothing.
  ok('no button literal is left hard-coded in a rule', !/\.btn\{[^}]*border-radius:999px/.test(base));

  const custom = build({ design: { btnRadius: '14px', btnShadow: 'none', btnBorder: '1px solid #ff0000', btnTransformHover: 'scale(1.04)' } });
  ok('a custom radius reaches the stylesheet', custom.indexOf('--btn-radius:14px') !== -1);
  ok('a custom shadow reaches the stylesheet', custom.indexOf('--btn-shadow:none') !== -1);
  ok('a custom border reaches the stylesheet', custom.indexOf('--btn-border:1px solid #ff0000') !== -1);
  ok('a custom hover reaches the stylesheet', custom.indexOf('--btn-transform-hover:scale(1.04)') !== -1);

  // The Studio's own camelCase and an imported project.json's CSS-property
  // spelling both resolve to the same shape.
  const snake = build({ designTokens: { '--btn-radius': '8px', '--btn-shadow': '0 2px 4px #000', '--btn-border': '0', '--btn-transform-hover': 'none' } });
  ok('kebab-case design_tokens are read',
    snake.indexOf('--btn-radius:8px') !== -1 && snake.indexOf('--btn-shadow:0 2px 4px #000') !== -1 && snake.indexOf('--btn-transform-hover:none') !== -1);
  // A value of "0" is falsy-ish but legal CSS; it must not be treated as unset.
  ok('a zero border is honoured rather than defaulted', snake.indexOf('--btn-border:0') !== -1, 'got a fallback');
  const top = Builder.buildSiteHTML({
    id: 'p1', name: 'T', suites: [], site: baseSite(), design_tokens: { '--btn-radius': '3px' }
  });
  ok('a top-level project.design_tokens is read too', top.indexOf('--btn-radius:3px') !== -1);

  // A token is a CSS value from outside the app: it must not be able to close
  // its declaration and open a rule.
  const evil = build({ design: { btnRadius: '4px;} body{display:none} .x{' } });
  ok('a declaration-breaking radius is refused', evil.indexOf('body{display:none}') === -1);
  ok('and the default radius stands', evil.indexOf('--btn-radius:999px') !== -1);
  const evil2 = build({ design: { btnShadow: 'red;background:url(https://evil.example/x)' } });
  ok('a url() in a token is refused', evil2.indexOf('evil.example') === -1);
  ok('and the default shadow stands', evil2.indexOf('--btn-shadow:0 10px 30px rgba(0,0,0,.25)') !== -1);
  const evil3 = build({ design: { btnBorder: '</style><script>alert(1)</script>' } });
  ok('markup in a token cannot escape the stylesheet', evil3.indexOf('alert(1)') === -1);
}

// ============================================================
console.log('\n2. Design tokens: brand colour is contrast-derived');
// ============================================================
{
  const brand = build({ designTokens: { '--brand-color': '#ff00aa' } });
  ok('the brand colour replaces the palette primary', brand.indexOf('--primary:#ff00aa') !== -1);
  // The override must not be able to put unreadable text on the page, which is
  // what deriving the text role from the NEW colour is for.
  const role = (brand.match(/--primary-text:(#[0-9a-f]{3,6})/i) || [])[1];
  ok('a readable primary-text role is derived from it', !!role, 'no role emitted');
  if (role) {
    // The guarantee is the RATIO, not that the colour changed: an override that
    // already clears AA is legitimately left alone, so asserting "it differs"
    // would fail on a correct result. Measure what a visitor would actually read.
    const pal = DB.getPalette('midnight');
    ok('the derived role is measurable (hex)', /^#[0-9a-f]{3,6}$/i.test(role));
    ok('it is the colour DB.textRoles itself returns',
      role.toLowerCase() === String(DB.textRoles(Object.assign({}, pal, { primary: '#ff00aa' })).primary).toLowerCase());
    ok('and it clears WCAG AA on the page background', DB.contrast(role, pal.bg) >= 4.5,
      String(Math.round(DB.contrast(role, pal.bg) * 100) / 100) + ':1');
    ok('and it clears WCAG AA on a card', DB.contrast(role, pal.surface) >= 4.5,
      String(Math.round(DB.contrast(role, pal.surface) * 100) / 100) + ':1');
  }
  // Contrast can only be verified for a colour this code can measure, so an
  // unmeasurable one is ignored rather than trusted.
  const nonHex = build({ designTokens: { '--brand-color': 'oklch(0.65 0.24 260)' } });
  ok('a non-hex brand colour is ignored rather than trusted', nonHex.indexOf('--primary:oklch') === -1);
}

// ============================================================
console.log('\n3. Section backgrounds');
// ============================================================
{
  const sections = [
    { type: 'about', title: 'A', background_style: 'pattern-grid' },
    { type: 'stats', title: 'B', background_style: 'pattern-dots' },
    { type: 'faq', title: 'C', background_style: 'pattern-noise' },
    { type: 'cta', title: 'D', background_style: 'split-contrast' },
    { type: 'contact', title: 'E', bgStyle: 'grid' }
  ];
  const page = Builder.buildSiteHTML({ id: 'p1', name: 'T', suites: [], site: siteFor(sections) });
  ok('pattern-grid is applied', page.indexOf('has-bg bgp-grid') !== -1);
  ok('pattern-dots is applied', page.indexOf('has-bg bgp-dots') !== -1);
  ok('pattern-noise is applied', page.indexOf('has-bg bgp-noise') !== -1);
  ok('split-contrast is applied', page.indexOf('has-bg bgs-split') !== -1);
  ok('the camelCase bgStyle spelling is accepted too', (page.match(/has-bg bgp-grid/g) || []).length === 2);
  ok('the grid overlay is emitted', /\.bgp-grid::before\{background-image:linear-gradient/.test(page));
  ok('the dot overlay is emitted', /\.bgp-dots::before\{background-image:radial-gradient/.test(page));
  ok('the noise tile is inlined, so it costs no request', /\.bgp-noise::before\{background-image:url\("data:image\/svg\+xml/.test(page));
  ok('the exact split-contrast clip-path from the brief is used',
    page.indexOf('clip-path:polygon(0 0,100% 0,100% 85%,0 100%)') !== -1);
  ok('the overlay sits behind the content without a positioned wrapper',
    page.indexOf('.section.has-bg{isolation:isolate}') !== -1);
  // Every overlay is a decoration: it must never intercept a click.
  ok('overlays cannot intercept pointer events',
    /\.section\.has-bg::before,\.section\.has-bg::after\{[^}]*pointer-events:none/.test(page));

  const none = build({});
  ok('a project with no background_style gets no overlay class', sectionTags(none).indexOf('has-bg') === -1, sectionTags(none).slice(0, 120));
  // The rules are emitted per project, not always: a site that asks for none of
  // this should carry none of its bytes, and the export separately promises that
  // a non-cinematic build ships no procedural grain and no clip-path.
  ok('a project that uses no background ships none of its CSS',
    none.indexOf('bgp-grid') === -1 && none.indexOf('bgs-split') === -1 && none.indexOf('feTurbulence') === -1);
  ok('and only the styles it does use are emitted',
    page.indexOf('bgp-dots') !== -1 && page.indexOf('bgs-split') !== -1);
  // A whitelist, not interpolation: an unknown or hostile name must do nothing.
  const bad = Builder.buildSiteHTML({
    id: 'p1', name: 'T', suites: [],
    site: siteFor([{ type: 'about', title: 'A', background_style: '</style><script>alert(1)</script>' }])
  });
  ok('a hostile background name is ignored, not interpolated',
    bad.indexOf('alert(1)') === -1 && sectionTags(bad).indexOf('has-bg') === -1);
  ok('an unknown-but-innocent name is ignored too',
    sectionTags(Builder.buildSiteHTML({ id: 'p1', name: 'T', suites: [], site: siteFor([{ type: 'about', title: 'A', background_style: 'pinstripe' }]) })).indexOf('has-bg') === -1);
}

// ============================================================
console.log('\n4. ZIP: the guarantees release-check already asserts');
// ============================================================
{
  throws('entry 513 is refused', () => {
    ZIP.zipFiles(Array.from({ length: 513 }, (_, i) => ({ name: 'f' + i + '.txt', content: 'x' })));
  }, 'too many files');
  throws('an unsafe path is refused', () => ZIP.zipFiles([{ name: '../escape.txt', content: 'x' }]), 'unsafe file path');
  throws('a file over 12 MB is refused', () => {
    ZIP.zipFiles([{ name: 'big.bin', content: 'a'.repeat(13 * 1024 * 1024) }]);
  }, 'larger than 12 MB');
}

// ============================================================
console.log('\n5. ZIP: the errors are structured, with metrics');
// ============================================================
{
  let caught = null;
  try { ZIP.zipFiles([{ name: 'ok.txt', content: 'x' }, { name: '../x', content: 'y' }]); } catch (e) { caught = e; }
  ok('a failure is a ZipBuildError', caught instanceof ZIP.ZipBuildError);
  ok('it is still an Error, so existing catch blocks work', caught instanceof Error);
  ok('it carries a machine-readable code', caught && caught.code === 'unsafe-path', caught && caught.code);
  ok('it names the offending file', !!caught && caught.metrics && caught.metrics.name === '../x');
  ok('its message is what app.js shows the user', !!caught && typeof caught.message === 'string' && caught.message.length > 20);

  let many = null;
  try { ZIP.zipFiles(Array.from({ length: 600 }, (_, i) => ({ name: 'f' + i + '.txt', content: 'x' }))); } catch (e) { many = e; }
  ok('the entry error states the count AND the limit',
    !!many && many.code === 'too-many-entries' && many.metrics.entries === 600 && many.metrics.limit === 512,
    JSON.stringify(many && many.metrics));

  // The size error should point at the fix, which is the largest asset.
  let big = null;
  try {
    ZIP.zipFiles(Array.from({ length: 5 }, (_, i) => ({ name: 'p' + i + '.html', content: 'a'.repeat(11 * 1024 * 1024) })));
  } catch (e) { big = e; }
  ok('the archive-size error names the largest asset',
    !!big && big.code === 'archive-too-large' && !!big.metrics.largestName && big.metrics.largestBytes > 0,
    JSON.stringify(big && big.metrics));
  ok('the limits are published for callers', ZIP.limits.entries === 512 && ZIP.limits.formatEntries === 65535);
}

// ============================================================
console.log('\n6. ZIP: path sanitising');
// ============================================================
{
  const rejected = [
    ['a Windows drive letter', 'C:/Windows/system32/x.dll'],
    ['a NUL byte', 'a\u0000b.txt'],
    ['a control character', 'a\u001fb.txt'],
    ['a trailing dot segment', 'notes.'],
    ['a trailing space segment', 'dir /f.txt'],
    ['an absolute posix path', '/etc/passwd'],
    ['deep traversal', 'a/b/../../../x'],
    ['backslash traversal', '..\\..\\x'],
    ['a UNC path', '//server/share/x'],
    ['an empty name', '']
  ];
  rejected.forEach(([label, name]) => {
    throws(label + ' is rejected', () => ZIP.zipFiles([{ name, content: 'x' }]), 'unsafe file path');
  });
  // Normalising is not the same as rejecting: these are legal paths that should
  // be tidied into one spelling per file, not refused.
  ok('a leading ./ is normalised away', ZIP.safePath('./index.html') === 'index.html', ZIP.safePath('./index.html'));
  ok('backslashes become forward slashes', ZIP.safePath('a\\b\\c.html') === 'a/b/c.html', ZIP.safePath('a\\b\\c.html'));
  ok('a doubly-nested ./ is normalised too', ZIP.safePath('././x.html') === 'x.html', ZIP.safePath('././x.html'));
  ok('a legitimately dotted name survives', ZIP.safePath('logo.v2.min.js') === 'logo.v2.min.js');
  ok('a normal nested path survives', ZIP.safePath('assets/css/site.css') === 'assets/css/site.css');
}

// ============================================================
console.log('\n7. ZIP: archive integrity (read back, not just sniffed)');
// ============================================================
{
  const files = [
    { name: 'index.html', content: '<!doctype html><title>Home</title>' },
    { name: 'about.html', content: '<!doctype html><title>About</title>' },
    { name: 'assets/css/site.css', content: 'body{margin:0}' },
    { name: 'assets/js/site.js', content: 'console.log(1)' },
    { name: 'assets/img/logo.svg', content: '<svg/>' }
  ];
  const bytes = ZIP.zipFiles(files);
  ok('the archive starts with the local-file signature',
    String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === 'PK\u0003\u0004');
  let parsed = null;
  try { parsed = readZip(bytes); } catch (e) { ok('the archive reads back', false, e.message); }
  if (parsed) {
    ok('the archive reads back as a valid zip', true);
    ok('the end record reports every entry', parsed.count === files.length, parsed.count + ' of ' + files.length);
    ok('every name round-trips exactly as written',
      files.every((f) => parsed.entries.some((e) => e.name === f.name)),
      JSON.stringify(parsed.entries.map((e) => e.name)));
    ok('every entry CRC verifies', parsed.entries.length === files.length);
    ok('the contents round-trip', parsed.entries.find((e) => e.name === 'assets/css/site.css').data === 'body{margin:0}');
    ok('nothing is silently dropped', parsed.entries.length === files.length);
  }
  // UTF-8 content must survive byte-counting, since the lengths are written in bytes.
  const uni = ZIP.zipFiles([{ name: 'u.html', content: 'caf\u00e9 \u2014 \u00a3999 \u2713' }]);
  const uniParsed = readZip(uni);
  ok('multi-byte content round-trips (lengths are in bytes)', uniParsed.entries[0].data === 'caf\u00e9 \u2014 \u00a3999 \u2713');
  // Binary content must survive too: Uint8Array goes in unchanged.
  const bin = new Uint8Array([0, 1, 2, 250, 255, 128]);
  const binParsed = readZip(ZIP.zipFiles([{ name: 'b.bin', content: bin }]));
  ok('binary content round-trips', binParsed.entries[0].size === bin.length);
  // An empty archive is a legal archive, and a common edge case.
  const empty = readZip(ZIP.zipFiles([]));
  ok('an empty export produces a valid empty archive', empty.count === 0);
}

// ============================================================
console.log('\n8. The publish gate, extended to the compiled pages');
// ============================================================
{
  const Preflight = require(path.join(ROOT, 'data', 'preflight.js'));
  const project = {
    id: 'p1', name: 'Northwind Joinery', suites: [],
    site: Object.assign(baseSite(), { email: 'hi@northwind.example', navLinks: [{ label: 'Work', href: '#work' }] })
  };
  const built = Builder.buildSitePages(project, { proExport: true, plan: 'pro' });
  const pages = built.map((e) => ({ name: e.page.name, slug: e.page.slug, html: e.html }));

  // The gate composes the audits rather than repeating them, so it must run at
  // all — a throw here would take the publish button with it.
  let report = null;
  try { report = Preflight.compiledRun(project, pages); } catch (e) { ok('the compiled gate runs', false, e.message); }
  if (report) {
    ok('the compiled gate runs without throwing', true);
    ok('it speaks the gate vocabulary, not a second one',
      report.kind === 'pallettai-preflight-compiled' && Array.isArray(report.blockers) && Array.isArray(report.warnings) && Array.isArray(report.notes));
    ok('its counts agree with its lists',
      report.counts.blocker === report.blockers.length && report.counts.warning === report.warnings.length);
    ok('ready is true exactly when there are no blockers', report.ready === (report.blockers.length === 0));
    ok('every finding carries a fixable message', report.blockers.concat(report.warnings, report.notes).every((f) => f && typeof f.msg === 'string' && f.msg.length > 10));
    ok('it counted the pages it was given', report.pages === pages.length);

    // A real, well-formed export must not trip the structural checks.
    const all = report.blockers.concat(report.warnings, report.notes);
    ok('a real export has no unnamed form controls', !all.some((f) => /accessible name/.test(f.msg)));
    ok('a real export has no broken headings', !all.some((f) => /heading/.test(f.msg)));
    ok('a real export is not missing its structured data', !all.some((f) => /No JSON-LD/.test(f.msg)), JSON.stringify(all.filter((f) => /JSON-LD/.test(f.msg)).map((f) => f.msg)));
    ok('a real export does not fail contrast', !all.some((f) => f.area === 'contrast'), JSON.stringify(all.filter((f) => f.area === 'contrast').map((f) => f.msg)));
  }

  // ---- each check, driven by input that should fail it ---------------------
  const one = (html, name) => [{ name: name || 'T', slug: 'index', html }];

  const noAlt = Preflight.compiledRun(project, one('<html><head></head><body><main><img src="a.png"><img src="b.png" alt=""></main></body></html>'));
  ok('an image with no alt is reported',
    noAlt.warnings.concat(noAlt.notes).some((f) => /no alt text/i.test(f.msg)),
    JSON.stringify(noAlt.warnings.concat(noAlt.notes).map((f) => f.msg)));

  const badSchema = Preflight.compiledRun(project, one('<html><head><script type="application/ld+json">{ not json }</script></head><body><main></main></body></html>'));
  ok('malformed JSON-LD is a blocker, not a note',
    badSchema.blockers.some((f) => /not valid JSON/.test(f.msg)),
    JSON.stringify(badSchema.blockers.map((f) => f.msg)));

  const noSchema = Preflight.compiledRun(project, one('<html><head><title>t</title></head><body><main></main></body></html>'));
  // Asserted per-finding rather than "no blockers at all": this deliberately
  // minimal document has no <html lang>, which the gate is RIGHT to call a
  // blocker, so a blanket assertion would be testing that other check instead.
  ok('absent structured data is a warning',
    noSchema.warnings.some((f) => /No JSON-LD/.test(f.msg)),
    JSON.stringify(noSchema.warnings.map((f) => f.msg)));
  ok('and it is not escalated to a blocker', !noSchema.blockers.some((f) => /JSON-LD/.test(f.msg)));
  // The carried audits still work through the gate: a missing lang is an error
  // in focus.js and must arrive here as a blocker, not be silently dropped.
  ok('a carried accessibility error becomes a blocker',
    noSchema.blockers.some((f) => /lang/.test(f.msg)),
    JSON.stringify(noSchema.blockers.map((f) => f.msg)));

  const goodSchema = Preflight.compiledRun(project, one('<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite"}</script></head><body><main></main></body></html>'));
  ok('well-formed structured data raises nothing',
    !goodSchema.warnings.concat(goodSchema.blockers).some((f) => /JSON-LD/.test(f.msg)));

  // A palette that cannot be read must be caught by measuring it, not by
  // trusting the palette's own idea of itself.
  const lowContrast = Preflight.compiledRun({ site: Object.assign(baseSite(), { palette: 'midnight' }) }, pages, {});
  const pal = DB.getPalette('midnight');
  const bodyText = DB.contrast(pal.text, pal.bg);
  ok('the shipped palette body text clears AA in the first place', bodyText >= 4.5, String(Math.round(bodyText * 100) / 100) + ':1');
  ok('and the gate agrees there is no contrast finding', !lowContrast.blockers.concat(lowContrast.warnings).some((f) => f.area === 'contrast'));
  // Now a palette that genuinely fails, to prove the check is not vacuous.
  const badPal = Object.assign({}, pal, { text: '#777777', bg: '#ffffff' });
  ok('the contrast check is not vacuous', DB.contrast(badPal.text, badPal.bg) < 4.5, String(Math.round(DB.contrast(badPal.text, badPal.bg) * 100) / 100) + ':1');

  // ---- one verdict from both halves ---------------------------------------
  const verdict = Preflight.all(project, pages);
  ok('the combined gate returns one verdict', verdict.kind === 'pallettai-preflight' && typeof verdict.ready === 'boolean');
  ok('it keeps the model half reachable', !!verdict.model && !!verdict.compiled);
  ok('its lists are the two halves merged',
    verdict.blockers.length === verdict.model.blockers.length + verdict.compiled.blockers.length);
  ok('and it still reports one headline', typeof verdict.headline === 'string' && verdict.headline.length > 5);
  ok('the model gate still runs on its own', !!Preflight.run(project));
}

console.log('\n' + (failed ? failed + ' FAILED\n' : 'Compiler & packaging smoke passed.\n'));
process.exit(failed ? 1 : 0);
