// ============================================================
// PallettAI Studio — Vision & Media smoke runner
//
// Standalone validation for the vision/media/grader-converter
// module set. Zero dependencies — run from the Studio root:
//
//   node scripts/vision-media-smoke.js
//
// Covers:
//   1. modules/media.js — a mock upload (synthetic JPEG carrying
//      EXIF/GPS + IPTC, synthetic PNG carrying tEXt + eXIf) goes
//      through optimizeLocalImage: metadata must be stripped,
//      srcset/ladder logic must hold, and graceful degradation
//      (codec-unavailable) must be structured, never a throw.
//   2. pallettai-website/grader/converter.js — a mock grader
//      report (the real worker's response shape) converts into a
//      .pallettai payload whose project imports clean through
//      modules/importer.js: schema, palette AA autofix, archetype.
//   3. modules/vision-qa.js — a simulated site render passes
//      through analyseRender and returns structured JSON:
//      { score, visual_defects, layout_suggestions }.
//   4. modules/security-forms.js — the client vault and the
//      progressive form router generate valid export scripts.
// ============================================================

const path = require('path');
const Media = require(path.join(__dirname, '..', 'modules', 'media.js'));
const VisionQA = require(path.join(__dirname, '..', 'modules', 'vision-qa.js'));
const Importer = require(path.join(__dirname, '..', 'modules', 'importer.js'));
const SecurityForms = require(path.join(__dirname, '..', 'modules', 'security-forms.js'));
const GraderConverter = require(path.join(__dirname, '..', '..', 'pallettai-website', 'grader', 'converter.js'));

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → got: ' + JSON.stringify(extra) : '')); }
}

/* ============================================================
   Mock asset builders (pure buffers, no fixture files)
   ============================================================ */

function jpegSegment(marker, payload) {
  const len = payload.length + 2;
  return Buffer.concat([
    Buffer.from([0xff, marker, (len >> 8) & 0xff, len & 0xff]),
    payload
  ]);
}

// Synthetic JPEG: SOI + APP1(EXIF w/ GPS) + APP13(IPTC) + DQT + DHT + SOF0 + SOS + scan + EOI
function buildMockJpeg() {
  const exif = jpegSegment(0xe1, Buffer.concat([
    Buffer.from('Exif\0\0', 'binary'),
    Buffer.from('MM\0*\0\0\0\x08\0\x07GPSLatitudeRefNGPSLatitude51,30,12.3')
  ]));
  const iptc = jpegSegment(0xed, Buffer.from('IPTC:captions-and-keywords'));
  const xmp = jpegSegment(0xe1, Buffer.from('<?xpacket?><x:xmpmeta>GPS 51.5,-0.1</x:xmpmeta>'));
  const dqt = jpegSegment(0xdb, Buffer.alloc(65, 0x07));
  const dht = jpegSegment(0xc4, Buffer.alloc(20, 0x01));
  const sof = jpegSegment(0xc0, Buffer.from([0x08, 0x00, 0x20, 0x00, 0x20, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]));
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x0c, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00]);
  const scan = Buffer.from([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0]);
  const eoi = Buffer.from([0xff, 0xd9]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), exif, iptc, xmp, dqt, dht, sof, sos, scan, eoi]);
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4); // fixture CRCs are placeholders; the walk ignores them
  return Buffer.concat([len, Buffer.from(type, 'binary'), data, crc]);
}

// Synthetic PNG: signature + IHDR + tEXt + eXIf(GPS) + zTXt + IDAT + IEND
function buildMockPng() {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    pngChunk('IHDR', Buffer.alloc(13)),
    pngChunk('tEXt', Buffer.from('Comment|shot on a phone near a landmark')),
    pngChunk('eXIf', Buffer.from('GPSDATA:51.5007,-0.1246')),
    pngChunk('zTXt', Buffer.from('CompressedComment|more metadata')),
    pngChunk('IDAT', Buffer.from('pixelpixelpixel')),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

/* ============================================================
   1 — Media: metadata stripping + WebP/SVG generation
   ============================================================ */

async function testMedia() {
  console.log('\n== 1 · modules/media.js — optimizeLocalImage ==');

  // WebP/SVG generation is probed without a browser. The four
  // archetype patterns are the SVG half of the guarantee.
  ok('no DOM → encode path reports codec-unavailable, not a crash', Media.encodeAvailable === false);

  const jpg = buildMockJpeg();
  const r1 = await Media.optimizeLocalImage(jpg, { name: 'client photo.jpg' });
  ok('mock JPEG processed', !!r1 && r1.ok === true, r1 && r1.reason);
  ok('EXIF/GPS APP1 stripped', r1.stripped.some(function (s) { return /APP1/.test(s); }), r1.stripped);
  ok('IPTC APP13 stripped', r1.stripped.some(function (s) { return /APP13/.test(s); }), r1.stripped);
  ok('decode-critical segments survive (DQT/SOF/SOS)', (() => {
    const b = Buffer.from(r1.bytes);
    const soi = b[0] === 0xff && b[1] === 0xd8;
    let hasDQT = false, hasSOF = false, hasSOS = false, appn = false;
    let i = 2;
    while (i + 4 <= b.length) {
      if (b[i] !== 0xff) break;
      const m = b[i + 1];
      if (m === 0xda) { hasSOS = true; break; }
      if (m === 0xd9) break;
      if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      const len = (b[i + 2] << 8) | b[i + 3];
      if (len < 2) break;
      if (m === 0xdb) hasDQT = true;
      if (m === 0xc0 || m === 0xc2) hasSOF = true;
      if (m >= 0xe0 && m <= 0xef) appn = true;
      i += 2 + len;
    }
    return soi && hasDQT && hasSOF && hasSOS && !appn;
  })());
  ok('structured degradation reason', r1.reason === 'codec-unavailable', r1.reason);
  ok('suggested filename normalised', r1.suggestedFilename === 'client photo.jpg', r1.suggestedFilename);

  // The stripped bytes themselves must be intact and clean.
  const strippedJpg = await Media.optimizeLocalImage(jpg, { name: 'x.jpg' });
  ok('stripped JPEG keeps the scan intact (SOI…SOS…EOI)', (() => {
    const b = Buffer.from(strippedJpg.bytes);
    return b[0] === 0xff && b[1] === 0xd8 && b.indexOf(Buffer.from([0xff, 0xda])) !== -1 &&
      b.lastIndexOf(Buffer.from([0xff, 0xd9])) === b.length - 2;
  })());

  const png = buildMockPng();
  const r2 = await Media.optimizeLocalImage(png, { name: 'shot.png' });
  ok('mock PNG processed', !!r2 && r2.ok === true, r2 && r2.reason);
  ok('PNG tEXt comment stripped', r2.stripped.indexOf('tEXt') !== -1, r2.stripped);
  ok('PNG eXIf (GPS) stripped', r2.stripped.indexOf('eXIf') !== -1, r2.stripped);
  ok('PNG zTXt stripped', r2.stripped.indexOf('zTXt') !== -1, r2.stripped);
  ok('PNG critical chunks kept (IHDR/IDAT/IEND)',
    r2.stripped.indexOf('IHDR') === -1 && r2.stripped.indexOf('IDAT') === -1 && r2.stripped.indexOf('IEND') === -1,
    r2.stripped);
  ok('stripped PNG bytes contain no leftover metadata chunk types', (() => {
    const b = Buffer.from(r2.bytes);
    const text = b.toString('binary');
    return text.indexOf('GPSDATA') === -1 && text.indexOf('CompressedComment') === -1 &&
      text.indexOf('shot on a phone') === -1;
  })());

  ok('junk input → structured result, ok:false', await (async () => {
    const r = await Media.optimizeLocalImage(Buffer.from('this is not an image'));
    return r && r.ok === false && r.reason === 'codec-unavailable';
  })());
  ok('empty input → null', (await Media.optimizeLocalImage(Buffer.alloc(0))) === null);
  ok('null input → null', (await Media.optimizeLocalImage(null)) === null);

  console.log('\n== 1b · modules/media.js — generateArchetypePattern ==');

  const grid = Media.generateArchetypePattern('pattern-grid', '#7C5CFF');
  ok('pattern-grid generates inline SVG', /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(grid));
  ok('pattern-grid honours primary colour', grid.indexOf('#7c5cff') !== -1);

  const dots = Media.generateArchetypePattern('pattern-dots', 'rgb(255, 0, 170)');
  ok('pattern-dots accepts rgb() colours', dots.indexOf('#ff00aa') !== -1);

  const noise = Media.generateArchetypePattern('pattern-noise', '#00e5a0', { seed: 11 });
  ok('pattern-noise embeds <filter id="noise">', noise.indexOf('<filter id="noise"') !== -1);
  ok('pattern-noise uses fractalNoise turbulence',
    /feTurbulence type="fractalNoise"/.test(noise) && /numOctaves="(3|4|5)"/.test(noise));
  ok('pattern-noise seed varies output',
    Media.generateArchetypePattern('pattern-noise', '#00e5a0', { seed: 12 }) !== noise);

  const scan = Media.generateArchetypePattern('pattern-scanlines', '#ff3d2e');
  ok('pattern-scanlines generates overlay rects', /<rect[^>]+fill="#ff3d2e"/.test(scan));
  const scanUrl = Media.generateArchetypePattern('pattern-scanlines', '#ff3d2e', { asDataUrl: true });
  ok('pattern data-URL mode', scanUrl.indexOf('data:image/svg+xml;base64,') === 0);

  ok('unknown pattern type refuses safely', Media.generateArchetypePattern('pattern-confetti', '#fff') === '');
  ok('unparseable colour falls back to a valid hex', Media.generateArchetypePattern('pattern-grid', 'not-a-colour').indexOf('#7c5cff') !== -1);
  ok('SVG contains no script vectors', [grid, dots, noise, scan].every(function (s) { return !/<script/i.test(s); }));
}

/* ============================================================
   2 — Grader report → .pallettai payload → importer
   ============================================================ */

function mockGraderReport() {
  // Same shape the Cloudflare worker / local harness returns:
  // { score, band, categories, checks[], facts? }
  return {
    url: 'https://www.acme-bakery.co.uk',
    score: 38,
    band: 'Needs work',
    categories: {
      Speed: { got: 9, max: 36 },
      Mobile: { got: 5, max: 20 },
      SEO: { got: 12, max: 30 },
      Security: { got: 8, max: 14 }
    },
    checks: [
      { id: 'https', cat: 'Security', label: 'Served over HTTPS', weight: 8, status: 'fail', detail: 'Plain HTTP.', fix: 'Add TLS.' },
      { id: 'forms', cat: 'Security', label: 'Forms submit securely', weight: 6, status: 'pass', detail: 'No forms.', fix: null },
      { id: 'ttfb', cat: 'Speed', label: 'Time to first byte', weight: 18, status: 'warn', detail: 'First byte in 900 ms.', fix: 'CDN.' },
      { id: 'compression', cat: 'Speed', label: 'Text compression', weight: 9, status: 'pass', detail: 'GZIP.', fix: null },
      { id: 'payload', cat: 'Speed', label: 'HTML payload', weight: 9, status: 'pass', detail: '180 KB.', fix: null },
      { id: 'viewport', cat: 'Mobile', label: 'Mobile viewport tag', weight: 15, status: 'fail', detail: 'No viewport.', fix: 'Add one.' },
      { id: 'imgdims', cat: 'Mobile', label: 'Images with set dimensions', weight: 5, status: 'fail', detail: '6 of 6 images lack dimensions.', fix: 'Set width/height.' },
      { id: 'title', cat: 'SEO', label: 'Page title', weight: 8, status: 'warn', detail: 'Long title.', fix: 'Shorten.' },
      { id: 'description', cat: 'SEO', label: 'Meta description', weight: 7, status: 'fail', detail: 'Missing.', fix: 'Write one.' },
      { id: 'og', cat: 'SEO', label: 'Social share tags', weight: 5, status: 'fail', detail: 'No og tags.', fix: 'Add them.' },
      { id: 'h1', cat: 'SEO', label: 'One clear heading', weight: 4, status: 'pass', detail: 'One h1.', fix: null },
      { id: 'canonical', cat: 'SEO', label: 'Canonical URL', weight: 3, status: 'warn', detail: 'No canonical.', fix: 'Add it.' },
      { id: 'jsonld', cat: 'SEO', label: 'Structured data', weight: 3, status: 'fail', detail: 'No JSON-LD.', fix: 'Add it.' }
    ],
    facts: {
      title: 'Acme Bakery — bread, pastries and coffee in Leeds',
      description: 'Wood-fired sourdough, pastries and specialty coffee, baked every morning in central Leeds.'
    }
  };
}

function testConverter() {
  console.log('\n== 2 · grader/converter.js — exportGraderToProject ==');
  const report = mockGraderReport();
  const payload = GraderConverter.exportGraderToProject(report);

  ok('payload envelope', payload.kind === 'pallettai.project' && payload.version === 1 && !!payload.generatedBy);
  ok('project carries schemaVersion 2', payload.project && payload.project.schemaVersion === 2);
  ok('archetype chosen from site vocabulary (bakery → warm)', payload.project.site.dna.look === 'warm', payload.project.site.dna.look);
  ok('grader provenance rides along', payload.grader && payload.grader.auditedScore === 38 && payload.grader.url === report.url);

  const fixes = payload.grader.autofixes.map(function (f) { return f.id; });
  ok('mobile viewport autofix present', fixes.indexOf('mobile-viewport') !== -1, fixes);
  ok('responsive-image autofix present', fixes.indexOf('responsive-images') !== -1, fixes);
  ok('social-card autofix present', fixes.indexOf('social-card') !== -1, fixes);
  ok('structured-data autofix present', fixes.indexOf('structured-data') !== -1, fixes);
  ok('https autofix present', fixes.indexOf('https-endpoints') !== -1, fixes);

  // WCAG contrast: every generated text/surface pair must clear AA 4.5.
  const pal = payload.project.site.palette;
  const rgbOf = function (hex) {
    const h = hex.replace('#', '');
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  };
  const lum = function (c) {
    const lin = ['r', 'g', 'b'].map(function (k) {
      const s = c[k] / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  };
  const ratio = function (a, b) {
    const la = lum(rgbOf(a));
    const lb = lum(rgbOf(b));
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };
  ok('body text on surface clears AA 4.5:1', ratio(pal.text, pal.surface) >= 4.5, ratio(pal.text, pal.surface).toFixed(2));
  ok('button label on primary clears AA 4.5:1', ratio(pal.surface, pal.primary) >= 4.5, ratio(pal.surface, pal.primary).toFixed(2));
  ok('contrast autofix recorded', fixes.some(function (id) { return id === 'wcag-contrast'; }) || ratio(pal.text, pal.surface) >= 4.5);

  // Responsive image placeholders: explicit dims + srcset ladder.
  const hero = payload.project.site.sections.find(function (s) { return s.type === 'hero'; });
  ok('hero carries explicit width/height', hero && hero.imageW === 1280 && hero.imageH === 720, hero && [hero.imageW, hero.imageH]);
  const ladderTokens = hero ? hero.imageSrcset.split(', ').map(function (e) { return e.split(' ').pop(); }).join(',') : '';
  ok('hero carries a srcset ladder (320→1280w)', ladderTokens === '320w,640w,960w,1280w', ladderTokens);
  ok('placeholders are self-contained data URLs', hero && hero.image.indexOf('data:image/svg+xml;base64,') === 0);
  ok('OG share card generated at 1200×630', payload.project.site.meta.ogImage.indexOf('data:image/svg+xml;base64,') === 0);

  // And the whole payload must import clean through the Studio side.
  const imported = Importer.parseProjectFile(JSON.stringify(payload));
  ok('generated payload imports clean through Studio', imported.ok, imported.errors);
  ok('import preserves archetype', imported.ok && imported.project.site.dna.look === 'warm');
  ok('import preserves all sections', imported.ok && imported.project.site.sections.length === payload.project.site.sections.length,
    imported.ok ? imported.project.site.sections.length : imported.errors);
  ok('import keeps AA-clean palette', imported.ok && imported.project.site.palette.text === pal.text);

  // Dedupe: converting twice is stable (deterministic generator).
  const again = GraderConverter.exportGraderToProject(report);
  ok('conversion is deterministic', JSON.stringify(again.project.site.dna) === JSON.stringify(payload.project.site.dna) &&
    again.project.site.sections.length === payload.project.site.sections.length);

  // Degenerate inputs never throw.
  ok('empty report still yields an importable project',
    Importer.parseProjectFile(JSON.stringify(GraderConverter.exportGraderToProject({}))).ok);
  ok('null-ish report yields an importable project',
    Importer.parseProjectFile(JSON.stringify(GraderConverter.exportGraderToProject(null))).ok);
}

/* ============================================================
   3 — VisionQA: simulated render → structured JSON
   ============================================================ */

async function testVisionQA() {
  console.log('\n== 3 · modules/vision-qa.js — analyseRender ==');

  // A "render" is any buffer; the Node path exercises the pure
  // heuristics + archetype rules. Use a synthetic JPEG header so
  // dimension decode succeeds and the edge signal has real geometry.
  const jpegProbe = Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegSegment(0xc0, Buffer.from([0x08, 0x02, 0xd0, 0x05, 0x00, 0x03, 0x01, 0x22, 0x00])),
    Buffer.from([0x00, 0x00])
  ]);

  const project = {
    site: {
      name: 'Acme',
      sections: [{ type: 'hero', title: 'Hello' }],
      dna: { look: 'editorial', radius: 24, spacing: 56 }
    }
  };
  const report = await VisionQA.analyseRender(jpegProbe, project, { label: 'acme-desktop' });

  ok('report is structured JSON with the contract keys',
    typeof report.score === 'number' && Array.isArray(report.visual_defects) && Array.isArray(report.layout_suggestions));
  ok('score in range', report.score >= 0 && report.score <= 100, report.score);
  ok('archetype detected from project', report.archetype === 'editorial', report.archetype);
  ok('defects carry type/severity/where/detail',
    report.visual_defects.every(function (d) { return d.type && d.severity && d.where && d.detail; }));
  ok('suggestions carry kind/where/suggestion/priority',
    report.layout_suggestions.every(function (s) { return s.kind && s.where && s.suggestion && s.priority; }));
  ok('non-sharp buttons flagged on Editorial', report.visual_defects.some(function (d) {
    return d.type === 'archetype-mismatch' && /button|corner|round/i.test(d.where + d.detail);
  }), report.visual_defects.map(function (d) { return d.type; }));
  ok('tight section rhythm flagged on Editorial', report.visual_defects.some(function (d) {
    return d.type === 'archetype-mismatch' && /rhythm|spacing|sections/i.test(d.where);
  }));
  ok('button-radius suggestion offered', report.layout_suggestions.some(function (s) {
    return /radius/i.test(s.suggestion);
  }));
  ok('score reflects detected defects (below 100)', report.score < 100, report.score);

  // A clean project on its own archetype must score 100.
  const clean = await VisionQA.analyseRender(jpegProbe, { site: { dna: { look: 'editorial', radius: 8, spacing: 120 } } }, { label: 'clean' });
  ok('clean archetype render scores 100', clean.score === 100, clean.score);
  ok('clean render has no defects', clean.visual_defects.length === 0);

  // Techy body-serif rule fires via declared tokens.
  const techy = await VisionQA.analyseRender(Buffer.from([0x00]), {
    site: { dna: { look: 'techy', radius: 6, spacing: 110, font: 'georgia' } }
  }, { label: 'techy', ui: { bodyFont: 'georgia, serif' } });
  ok('serif body flagged on Techy', techy.visual_defects.some(function (d) {
    return d.type === 'archetype-mismatch' && /body/i.test(d.where);
  }));

  // Estimated findings are marked, so the DOM pass can down-weight them.
  const estimated = report.visual_defects.filter(function (d) { return d.estimated === true; });
  ok('estimated findings are labelled estimated:true',
    report.mode !== 'dom' ? estimated.length === report.visual_defects.length : true);

  // Every archetype in Studio's DNA tray must produce a valid report.
  const looks = ['editorial', 'light', 'warm', 'bright', 'dark', 'bold', 'noir', 'playful', 'techy', 'minimal'];
  let allLooksOk = true;
  for (const look of looks) {
    const r = await VisionQA.analyseRender(Buffer.from([0x01]), { site: { dna: { look: look, radius: 24, spacing: 50 } } }, { label: look });
    if (typeof r.score !== 'number' || !Array.isArray(r.visual_defects) || r.archetype !== look) allLooksOk = false;
  }
  ok('all 10 DNA archetypes produce valid reports', allLooksOk);

  // Degenerate inputs stay structured.
  const empty = await VisionQA.analyseRender(null, null, {});
  ok('no screenshot + no project → valid report on default archetype',
    typeof empty.score === 'number' && empty.archetype === 'editorial');
}

/* ============================================================
   4 — SecurityForms: vault + progressive forms
   ============================================================ */

async function testSecurityForms() {
  console.log('\n== 4 · modules/security-forms.js ==');

  const vault = await SecurityForms.generateClientVaultScript('client-edit-passphrase-1');
  ok('vault script generated', vault.script.length > 1000);
  ok('vault uses WebCrypto at build time', vault.meta.realCrypto === true);
  ok('PBKDF2 at the OWASP floor (210k)', vault.seed.iterations === 210000, vault.seed.iterations);
  ok('sample payload is sealed (no plaintext marker)', vault.seed.sample.indexOf('pallettai-client-vault') === -1);
  ok('script embeds the gate, never the password',
    vault.script.indexOf('client-edit-passphrase-1') === -1 && vault.script.indexOf('deriveKey') !== -1);
  ok('vault JSON literal parses', (() => {
    const m = /var VAULT = (\{.*?\});/.exec(vault.script);
    if (!m) return false;
    try { const v = JSON.parse(m[1]); return v.sample && v.iv && v.salt; } catch (e) { return false; }
  })());

  // GCM authentication: a wrong password must fail to decrypt.
  const crypto = require('crypto').webcrypto;
  const enc = new TextEncoder();
  const b64 = function (s) { return new Uint8Array(Buffer.from(s, 'base64')); };
  const deriveKey = async function (pw) {
    const bk = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: b64(vault.seed.salt), iterations: vault.seed.iterations, hash: 'SHA-256' },
      bk, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  };
  const rightKey = await deriveKey('client-edit-passphrase-1');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(vault.seed.iv) }, rightKey, b64(vault.seed.sample));
  ok('right password decrypts the sample', new TextDecoder().decode(plain).indexOf('pallettai-client-vault:') === 0);
  let wrongFailed = false;
  try {
    const wrongKey = await deriveKey('wrong-password-123');
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(vault.seed.iv) }, wrongKey, b64(vault.seed.sample));
  } catch (e) { wrongFailed = true; }
  ok('wrong password fails GCM authentication', wrongFailed);

  // Refusals.
  let refused = false;
  try { await SecurityForms.generateClientVaultScript('short'); } catch (e) { refused = true; }
  ok('short password refused', refused);

  // Progressive form router.
  const forms = SecurityForms.generateProgressiveFormScript('https://forms.example.com/submit');
  ok('form script generated for https endpoint', forms.meta.ok === true && forms.script.length > 1000);
  ok('router posts JSON with AbortController timeout',
    forms.script.indexOf('"Content-Type": "application/json"') !== -1 && forms.script.indexOf('AbortController') !== -1);
  ok('offline queue uses localStorage fallback',
    forms.script.indexOf('localStorage') !== -1 && forms.script.indexOf('navigator.onLine') !== -1);
  ok('inline validation via checkValidity',
    forms.script.indexOf('checkValidity') !== -1 && forms.script.indexOf('aria-invalid') !== -1);
  ok('failure fallback messaging present',
    forms.script.indexOf('did not send') !== -1 && forms.script.indexOf('saved and will send automatically') !== -1);

  const insecure = SecurityForms.generateProgressiveFormScript('http://forms.example.com/submit');
  ok('plain-HTTP endpoint refused', insecure.meta.ok === false && /https/.test(insecure.meta.error));
  const junk = SecurityForms.generateProgressiveFormScript('not a url');
  ok('malformed endpoint refused', junk.meta.ok === false);
}

/* ============================================================
   Runner
   ============================================================ */

(async function main() {
  console.log('PallettAI Studio — vision & media smoke');
  try { await testMedia(); } catch (e) { fail++; console.log('  ✗ media suite threw: ' + e.message); }
  try { testConverter(); } catch (e) { fail++; console.log('  ✗ converter suite threw: ' + e.message); }
  try { await testVisionQA(); } catch (e) { fail++; console.log('  ✗ vision suite threw: ' + e.message); }
  try { await testSecurityForms(); } catch (e) { fail++; console.log('  ✗ security-forms suite threw: ' + e.message); }

  console.log('\n== result ==');
  console.log('  pass: ' + pass + '  fail: ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.error('runner error:', e);
  process.exit(1);
});
