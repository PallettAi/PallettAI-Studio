'use strict';
// Temporary audit probe — exercises suspected injection/robustness issues.
var fs = require('fs'), os = require('os'), path = require('path');

function line(t) { console.log('\n===== ' + t + ' ====='); }

/* A. security-forms: endpoint URL interpolated into a block comment */
line('A. security-forms comment/JS injection via endpoint URL');
var SF = require('../modules/security-forms.js');
var attacks = [
  'https://evil.example.com/*/globalThis.PWNED=1;/*',
  'https://evil.example.com/normal',
  'https://evil.example.com/</script><script>alert(1)</script>'
];
attacks.forEach(function (u) {
  var r = SF.generateProgressiveFormScript(u);
  var accepted = r.meta && r.meta.ok;
  var head = r.script ? r.script.split('\n').slice(0, 3).join(' | ') : '';
  var parses = null;
  if (r.script) {
    try { new Function(r.script); parses = true; } catch (e) { parses = 'THROWS: ' + e.message; }
  }
  console.log('url in   :', u);
  console.log('  accepted:', accepted, '| normalized:', r.meta && r.meta.endpoint);
  console.log('  parses  :', parses);
  console.log('  head    :', head);
  var injected = r.script && /globalThis\.PWNED\s*=\s*1/.test(r.script.replace(/\/\*[\s\S]*?\*\//g, function (m) { return m.indexOf('PWNED') !== -1 ? '' : m; }));
  console.log('  raw PWNED occurs in script:', !!(r.script && r.script.indexOf('PWNED') !== -1));
  console.log('  </script> occurs raw      :', !!(r.script && r.script.indexOf('</script>') !== -1));
  void injected;
});

/* B. file-integrity: malformed signature length */
line('B. file-integrity malformed signature');
var FI = require('../modules/file-integrity.js');
console.log('exports:', Object.keys(FI).join(', '));
var dist = fs.mkdtempSync(path.join(os.tmpdir(), 'pai-fi-'));
fs.writeFileSync(path.join(dist, 'index.html'), '<html>hello</html>');
try {
  var gen = FI.generateBuildManifest(dist, { signingKey: 'k'.repeat(32) });
  console.log('manifest ok:', gen.ok, 'key:', !!gen.signingKey);
  var mpath = gen.manifestPath || path.join(dist, '.manifest.json');
  var m = JSON.parse(fs.readFileSync(mpath, 'utf8'));
  console.log('manifest shape keys:', Object.keys(m).join(','), '| sig:', String(m.signature).slice(0, 16) + '…');
  var good = FI.verifyBuildIntegrity(dist, mpath, { signingKey: 'k'.repeat(32) });
  console.log('verify clean ->', good.ok, good.error || '');
  // attacker truncates the signature
  m.signature = 'abc';
  fs.writeFileSync(mpath, JSON.stringify(m));
  var v;
  try {
    v = FI.verifyBuildIntegrity(dist, mpath, { signingKey: 'k'.repeat(32) });
    console.log('verify truncated-sig -> ok=' + v.ok + ' error=' + v.error);
  } catch (e) {
    console.log('*** THREW on truncated signature:', e.constructor.name + ': ' + e.message);
  }
  // attacker replaces signature with a non-hex string of correct length
  m.signature = 'z'.repeat(String(m.signature).length > 3 ? 64 : 64);
  fs.writeFileSync(mpath, JSON.stringify(m));
  try {
    v = FI.verifyBuildIntegrity(dist, mpath, { signingKey: 'k'.repeat(32) });
    console.log('verify bogus-64-sig -> ok=' + v.ok + ' error=' + v.error);
  } catch (e) {
    console.log('*** THREW on bogus signature:', e.constructor.name + ': ' + e.message);
  }
} catch (e) {
  console.log('*** THREW:', e.constructor.name + ': ' + e.message);
}

/* C. CSS-value injection in token exporters */
line('C. CSS injection via token value / name');
var TE = require('../modules/token-exporter.js');
console.log('exports:', Object.keys(TE).join(', '));
var evil = { colors: { brand: 'red; } body { display: none } .x {' } };
try {
  var css = TE.exportToCSSVariables(evil, 'pai');
  console.log('css:', JSON.stringify(typeof css === 'string' ? css : css.css || css));
} catch (e) { console.log('threw:', e.message); }
try {
  var tw = TE.exportToTailwindV4(evil);
  console.log('tailwind:', JSON.stringify(typeof tw === 'string' ? tw : tw.css || tw).slice(0, 300));
} catch (e) { console.log('tailwind threw:', e.message); }
var evilName = {}; evilName['--x: red; } html{background:url(//evil)} .y'] = '#fff';
try {
  console.log('evil name css:', JSON.stringify(TE.exportToCSSVariables(evilName, 'pai')));
} catch (e) { console.log('evil name threw:', e.message); }

/* D. prototype pollution via untrusted JSON in importer / token-compiler */
line('D. prototype pollution via __proto__ payloads');
var TC = require('../modules/token-compiler.js');
var before = ({}).polluted;
var manifestWithProto = JSON.parse('{"colors":{"brand":"#3B82F6"},"__proto__":{"polluted":"yes"},"scopes":{"__proto__":{"colors":{"ink":"#111111"}}}}');
try {
  var res = TC.compileDesignTokens(manifestWithProto);
  console.log('token-compiler ok:', res.ok, '| tokens:', res.tokens.length, '| Object.prototype.polluted:', ({}).polluted);
  console.log('  scopes keys:', Object.keys(res.scopes).join(','), '| scope entry count:', res.scopes.__proto__ ? Object.keys(res.scopes.__proto__).length : 'n/a');
} catch (e) { console.log('token-compiler threw:', e.message); }
console.log('global Object.prototype.polluted before/after:', before, ({}).polluted);

var IMP = require('../modules/importer.js');
console.log('importer exports:', Object.keys(IMP).join(', '));
var poisoned = JSON.parse('{"kind":"pallettai.project","project":{"site":{"pages":[]},"tokens":{"colors":{"__proto__":{"polluted":"yes"},"brand":"#fff"}},"__proto__":{"polluted":"yes"}}}');
try {
  var fn = IMP.importProject || IMP.parseProjectFile || IMP.loadProject;
  if (typeof fn === 'function') {
    var r2 = fn(poisoned);
    console.log('importer result ok:', r2 && r2.ok, '| Object.prototype.polluted:', ({}).polluted);
  } else {
    console.log('no obvious import entrypoint among exports');
  }
} catch (e) { console.log('importer threw:', e.message); }

/* E. decompression bomb in color-extractor PNG */
line('E. color-extractor inflate limits');
var CE = require('../modules/color-extractor.js');
console.log('exports:', Object.keys(CE).join(', '));
var zlib = require('zlib');
// 2000x2000 RGBA uncompressed = 16MB of zeros → highly compressible
var W = 2000, H = 2000;
var rawRows = Buffer.alloc((W * 4 + 1) * H); // filter byte 0 + RGBA zeros
var compressed = zlib.deflateSync(rawRows);
function crc32(buf) {
  var table = crc32.table || (crc32.table = (function () {
    var t = [];
    for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })());
  var c = 0xffffffff;
  for (var i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  var len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  var td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  var crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
var ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
var png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))
]);
console.log('bomb png bytes:', png.length, '| expands to', (W * H * 4 / 1048576).toFixed(1), 'MB raw');
var t0 = Date.now();
try {
  var pal = CE.extractImagePalette(png, 5);
  console.log('extract ms:', Date.now() - t0, '| ok:', pal && pal.ok, '| colors:', pal && pal.palette && pal.palette.length);
} catch (e) { console.log('threw after', Date.now() - t0, 'ms:', e.message); }

/* F. oversized / hostile inputs to other parsers */
line('F. misc hostile inputs');
var VM = require('../modules/vision-qa.js');
console.log('vision-qa exports:', Object.keys(VM).join(', '));
var AS = require('../modules/ast-optimizer.js');
console.log('ast-optimizer exports:', Object.keys(AS).join(', '));
try {
  var deep = JSON.parse('{"a":' + '{"a":'.repeat(5000) + '1' + '}'.repeat(5000) + '}');
  console.log('deep-json parse ok (before passing to ast)');
  void deep;
} catch (e) { console.log('deep json parse threw:', e.message); }
