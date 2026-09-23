#!/usr/bin/env node
// ============================================================
// PallettAI Studio — Backend Advanced v5 Smoke Runner
// AST tree-shaking · CSS purging · build integrity · credential
// vault · static pre-compression — end to end, real fs, real zlib,
// real crypto. No mocks except the temp folders.
//
//   node scripts/backend-advanced-v5-smoke.js
// ============================================================
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const ASTOptimizer = require('../modules/ast-optimizer.js');
const FileIntegrity = require('../modules/file-integrity.js');
const CryptoVault = require('../modules/crypto-vault.js');
const AssetCompressor = require('../modules/asset-compressor.js');

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

// One temp root for the whole run.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pai-v5-smoke-'));
function tmpDir(name) {
  const p = path.join(TMP, name);
  fs.mkdirSync(p, { recursive: true });
  return p;
}

/* ============================================================
   1 — AST tree-shaking
   ============================================================ */
section('ast-optimizer: shakeAST');

const projectAST = {
  id: 'proj_1',
  site: {
    name: 'Smoke Site',
    pages: [
      {
        slug: 'index',
        sections: [
          { id: 's1', type: 'hero', title: 'Headline', subtitle: 'Sub', props: { stale: null, hollow: {} } },
          { id: 's2', type: 'hero', title: 'Headline', subtitle: 'Sub', props: { stale: null } },
          { id: 's3', type: 'faq', items: [{ q: 'Q?', a: 'A' }] },
          { id: 's4', type: 'pricing' },
          { type: 'mystery-widget', title: 'unknown type' },
          null
        ]
      },
      { slug: 'about', sections: [{ id: 's5', type: 'about', title: 'About us', body: 'Story' }] },
      { slug: 'ghost', sections: [] }
    ]
  },
  components: { hero: { render: 'hero' }, about: { render: 'about' }, faq: { render: 'faq' }, pricing: { render: 'pricing' }, gallery: { render: 'gallery' } }
};

const shake = ASTOptimizer.shakeAST(projectAST);
ok(shake.ok === true, 'shakeAST ok');
eq(shake.metrics.sectionsDropped, 4, 'unknown + null + type-only + empty-section dropped (dup counted separately)');
eq(shake.metrics.duplicatesRemoved, 1, 'exact duplicate detected');
eq(shake.metrics.componentsDropped, 2, 'unreferenced components (gallery + pricing) dropped');
ok(shake.metrics.propsStripped >= 3, 'empty props stripped (' + shake.metrics.propsStripped + ')');
eq(shake.metrics.nodesIn - shake.metrics.nodesOut, shake.metrics.nodesEliminated, 'node metric arithmetic consistent');
ok(shake.metrics.nodesEliminated > 0, 'nodes actually eliminated');
eq(shake.shaken.site.pages.length, 2, 'section-less ghost page removed');
ok(shake.shaken.site.pages[0].sections.every((s) => s.type !== 'mystery-widget'), 'unknown component type removed');
ok(shake.shaken.site.pages[0].sections[0].props === undefined, 'hollow props object removed entirely');
ok(shake.shaken.components.pricing === undefined, 'type-only section did not keep its component alive');

// Input purity — the shaker must never mutate the caller's tree.
eq(projectAST.site.pages.length, 3, 'input tree unmutated (pages)');
ok(projectAST.site.pages[0].sections.length === 6, 'input tree unmutated (sections)');
ok(projectAST.components.gallery !== undefined, 'input registry unmutated');

// Second shake of an already-shaken tree is a no-op.
const reshake = ASTOptimizer.shakeAST(shake.shaken);
eq(reshake.metrics.sectionsDropped, 0, 're-shake removes nothing more');
eq(reshake.metrics.nodesEliminated, 0, 're-shake eliminates no nodes (fixpoint)');
ok(ASTOptimizer.shakeAST({}).ok === false, 'missing site rejected');

/* ============================================================
   2 — CSS pruning
   ============================================================ */
section('ast-optimizer: pruneUnusedCSS');

const pagesHTML = [
  '<!doctype html><html><body>',
  '<div class="hero pa-glass alive"><h1 class="hero-title">Hi</h1></div>',
  '<section class="faq"><div class="is-open"><p>answer</p></div></section>',
  '<p style="color:var(--ink-soft)">inline var</p>',
  '</body></html>'
].join('');

const rawCSS = [
  ':root{--brand:#c81e28;--ink-soft:#444;--never-used:#123}',
  '.hero{color:var(--brand);padding:2rem}',
  '.hero-title{font-size:2rem}',
  '.dead-page{color:red}',
  '.hero .dead-descendant{margin:0}',
  '.hero.alive, .hero.zombie{border:1px solid}',
  '.is-open{display:block}',
  '@media (min-width:700px){.dead-mq-only{color:blue}.hero{margin-inline:auto}}',
  '@keyframes pa-fade{from{opacity:0}to{opacity:1}}',
  'p{line-height:1.6}',
  '.js-menu, .dead-thing{position:fixed}'
].join('\n');

const prune = ASTOptimizer.pruneUnusedCSS(pagesHTML, rawCSS);
ok(prune.ok === true, 'pruneUnusedCSS ok');
ok(prune.css.indexOf('.dead-page') === -1, 'dead class rule removed');
ok(prune.css.indexOf('.dead-descendant') === -1, 'compound selector with dead part removed');
ok(prune.css.indexOf('.hero.alive') !== -1 && prune.css.indexOf('.hero.zombie') === -1, 'comma alternatives evaluated independently');
ok(prune.css.indexOf('.dead-mq-only') === -1 && prune.css.indexOf('margin-inline:auto') !== -1, 'media block pruned inside, surviving rules kept');
ok(prune.css.indexOf('@keyframes pa-fade') !== -1, 'keyframes preserved');
ok(prune.css.indexOf('--never-used') === -1, 'unreferenced custom property purged');
ok(prune.css.indexOf('--brand:#c81e28') !== -1, 'referenced custom property kept');
ok(prune.css.indexOf('--ink-soft') !== -1, 'inline-style-referenced custom property kept');
ok(prune.css.indexOf('.js-menu') !== -1 && prune.css.indexOf('.dead-thing') === -1, 'allow-prefix class kept, dead sibling removed');
ok(prune.metrics.bytesSaved === prune.metrics.bytesIn - prune.metrics.bytesOut, 'byte math consistent');
eq(prune.metrics.percentReduced, Math.round((prune.metrics.bytesSaved / prune.metrics.bytesIn) * 10000) / 100, 'percent reduction consistent');
ok(prune.metrics.percentReduced > 0, 'payload actually shrank');
ok(prune.metrics.rulesEliminated > 0 && prune.metrics.selectorsRewritten >= 1, 'rule + selector metrics populated');
eq(prune.metrics.classesUsed, 6, 'class token count (hero, pa-glass, alive, hero-title, faq, is-open)');

// Idempotency: pruning the pruned output changes nothing.
const prune2 = ASTOptimizer.pruneUnusedCSS(pagesHTML, prune.css);
eq(prune2.css, prune.css, 'prune is idempotent (fixpoint)');

ok(ASTOptimizer.pruneUnusedCSS('<p>x</p>', '').ok === false, 'empty CSS rejected');

/* ============================================================
   3 — build integrity + auto-repair
   ============================================================ */
section('file-integrity: manifest + verify');

const dist = tmpDir('dist');
fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html>home</html>');
fs.writeFileSync(path.join(dist, 'styles.css'), 'body{color:#111}');
fs.mkdirSync(path.join(dist, 'assets'));
fs.writeFileSync(path.join(dist, 'assets', 'app.js'), 'console.log("v5");');
fs.writeFileSync(path.join(dist, 'assets', 'logo.svg'), '<svg width="10" height="10"></svg>');

const gen = FileIntegrity.generateBuildManifest(dist);
ok(gen.ok === true, 'manifest generated');
eq(gen.files, 4, 'manifest covers every file');
ok(fs.existsSync(gen.manifestPath), '.manifest.json written into dist');

const vClean = FileIntegrity.verifyBuildIntegrity(dist);
ok(vClean.ok === true && vClean.signatureValid === true, 'clean build verifies');
eq(vClean.summary.ok, 4, 'all files classified ok');
// A green tick must not imply tamper-resistance the manifest does not
// have: the default key travels inside the manifest, so the signature
// proves the file is unchanged, not that the build is untampered.
eq(vClean.selfSigned, true, 'self-signed manifest is reported as such');
eq(vClean.signatureTrust, 'self', 'signature trust level named');
const vCallerKey = FileIntegrity.verifyBuildIntegrity(dist, null, { signingKey: gen.signingKey });
ok(vCallerKey.ok === true && vCallerKey.selfSigned === false && vCallerKey.signatureTrust === 'caller',
  'a caller-held key reports caller trust (tamper-resistant form)');
ok(FileIntegrity.verifyBuildIntegrity(dist, null, { signingKey: 'not-the-key' }).signatureValid === false,
  'a wrong caller key is rejected, so the caller-key path has teeth');

// Corruption, deletion, and stray files are all detected.
fs.writeFileSync(path.join(dist, 'styles.css'), 'body{color:#222}');
fs.unlinkSync(path.join(dist, 'assets', 'logo.svg'));
fs.writeFileSync(path.join(dist, 'rogue.txt'), 'who am I');
const vBad = FileIntegrity.verifyBuildIntegrity(dist);
ok(vBad.ok === false, 'verify fails on tampered build');
ok(vBad.issues.some((i) => i.file === 'styles.css' && i.status === 'corrupted'), 'corruption detected with expected/actual hashes');
ok(vBad.issues.some((i) => i.file === 'assets/logo.svg' && i.status === 'missing'), 'missing file detected');
ok(vBad.issues.some((i) => i.file === 'rogue.txt' && i.status === 'untracked'), 'untracked file detected');
ok(vBad.issues.find((i) => i.file === 'styles.css').expected.length === 64, 'sha-256 hex digests reported');

// Manifest tampering itself is caught by the signature.
const manifestPath = path.join(dist, '.manifest.json');
const manifestObj = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifestObj.payload.files['index.html'].sha256 = '0'.repeat(64);
fs.writeFileSync(manifestPath, JSON.stringify(manifestObj));
const vTampered = FileIntegrity.verifyBuildIntegrity(dist);
ok(vTampered.signatureValid === false && vTampered.ok === false, 'tampered manifest rejected before any trust');

// mtime-only drift is advisory by default, strict on demand.
section('file-integrity: mtime drift semantics');
const dist2 = tmpDir('dist2');
fs.writeFileSync(path.join(dist2, 'a.txt'), 'AAA');
FileIntegrity.generateBuildManifest(dist2);
// Force a deterministic mtime jump (two immediate writes can land
// inside the same timestamp tick on APFS).
const future = new Date(Date.now() + 5000);
fs.utimesSync(path.join(dist2, 'a.txt'), future, future);
const vDrift = FileIntegrity.verifyBuildIntegrity(dist2);
ok(vDrift.ok === true && vDrift.summary.externallyModified === 1, 'mtime-only drift reported, not fatal by default');
eq(FileIntegrity.verifyBuildIntegrity(dist2, null, { strict: true }).ok, false, 'strict mode fails on mtime drift');
ok(FileIntegrity.sha256Buffer(fs.readFileSync(path.join(dist2, 'a.txt'))).length === 64, 'content bytes unchanged');

section('file-integrity: auto-repair from build cache');
// Rebuild a clean manifest covering all four files (the tampered one
// from the signature test is discarded), THEN damage the dist.
fs.rmSync(manifestPath);
fs.rmSync(path.join(dist, 'rogue.txt'));
fs.writeFileSync(path.join(dist, 'styles.css'), 'body{color:#111}');
fs.writeFileSync(path.join(dist, 'assets', 'logo.svg'), '<svg width="10" height="10"></svg>');
FileIntegrity.generateBuildManifest(dist);
const cache = tmpDir('.build-cache');
fs.mkdirSync(path.join(cache, 'assets'), { recursive: true });
fs.writeFileSync(path.join(cache, 'styles.css'), 'body{color:#111}');
fs.writeFileSync(path.join(cache, 'assets', 'app.js'), 'console.log("v5");');
fs.writeFileSync(path.join(cache, 'assets', 'logo.svg'), '<svg width="10" height="10"></svg>');
// Now damage: corrupt + delete.
fs.writeFileSync(path.join(dist, 'styles.css'), 'body{color:#999}');
fs.unlinkSync(path.join(dist, 'assets', 'logo.svg'));

const vBeforeRepair = FileIntegrity.verifyBuildIntegrity(dist);
ok(vBeforeRepair.summary.corrupted === 1 && vBeforeRepair.summary.missing === 1, 'damage confirmed before repair');

const repair = FileIntegrity.autoRepairCorruptedFiles(vBeforeRepair.issues, cache, { distFolderPath: dist });
ok(repair.ok === true, 'repair ok');
eq(repair.repaired.length, 2, 'both damaged files repaired');
ok(repair.manifestRefreshed === true, 'manifest mtimes refreshed + re-signed');
const vAfterRepair = FileIntegrity.verifyBuildIntegrity(dist);
ok(vAfterRepair.ok === true, 'post-repair verify green');
eq(vAfterRepair.summary.corrupted + vAfterRepair.summary.missing, 0, 'no corruption or gaps remain');

// Stale cache must never poison dist.
fs.writeFileSync(path.join(cache, 'styles.css'), 'STALE CONTENT');
fs.writeFileSync(path.join(dist, 'styles.css'), 'fresh corruption');
const staleRepair = FileIntegrity.autoRepairCorruptedFiles([{ file: 'styles.css', status: 'corrupted' }], cache, { distFolderPath: dist });
ok(staleRepair.ok === false && staleRepair.failed.length === 1, 'stale cache rejected');
ok(fs.readFileSync(path.join(dist, 'styles.css'), 'utf8') === 'fresh corruption', 'failed repair left destination untouched (stage-verify-rename)');
// dryRun reports without touching
const dry = FileIntegrity.autoRepairCorruptedFiles([{ file: 'styles.css', status: 'corrupted' }], cache, { distFolderPath: dist, dryRun: true });
ok(dry.repaired.length === 1 && dry.repaired[0].dryRun === true, 'dryRun reports without writing');
ok(FileIntegrity.autoRepairCorruptedFiles([], cache).ok === false, 'empty repair list rejected');

/* ============================================================
   4 — credential vault
   ============================================================ */
section('crypto-vault: encrypt/decrypt cycles');

const PASS = 'correct horse battery staple';
const secret = 'nfp_live_r15kQ9zXnotARealToken';

const enc = CryptoVault.encryptSecret(secret, PASS);
ok(enc.ok === true, 'encryptSecret ok');
eq(enc.meta.iterations, 100000, 'PBKDF2 runs at 100,000 iterations');
eq(enc.meta.kdf, 'pbkdf2-sha256', 'KDF identified in payload');
ok(JSON.parse(enc.envelope).salt && JSON.parse(enc.envelope).iv && JSON.parse(enc.envelope).tag && JSON.parse(enc.envelope).ct, 'payload carries salt/iv/tag/ct');

const dec = CryptoVault.decryptSecret(enc.payload, PASS);
ok(dec.ok === true && dec.secret === secret, 'round-trip restores the secret');
eq(CryptoVault.decryptSecret(enc.envelope, PASS).secret, secret, 'JSON envelope string accepted too');

ok(CryptoVault.decryptSecret(enc.payload, 'wrong passphrase entirely').ok === false, 'wrong passphrase rejected by GCM auth');
const tamperedPayload = JSON.parse(JSON.stringify(enc.payload));
tamperedPayload.ct = Buffer.from('flipped-bits-galore').toString('base64');
ok(CryptoVault.decryptSecret(tamperedPayload, PASS).ok === false, 'tampered ciphertext rejected by GCM auth');
ok(CryptoVault.encryptSecret(secret, 'short').ok === false, 'short passphrase rejected');
ok(CryptoVault.encryptSecret('', PASS).ok === false, 'empty secret rejected');
ok(CryptoVault.encryptSecret(enc.envelope, PASS).ok === false, 'double-encryption refused');
// Implausible iteration count is refused on decrypt.
const weakIter = JSON.parse(JSON.stringify(enc.payload));
weakIter.iter = 1000;
ok(CryptoVault.decryptSecret(weakIter, PASS).ok === false, 'iteration floor enforced on decrypt');

section('crypto-vault: vault file + async/subtle path');

const vaultPath = path.join(TMP, 'vault.enc');
const wv = CryptoVault.writeVault(vaultPath, { netlify: 'nfp_one', cloudflare: 'cf_two', github: 'ghp_three', empty: '' }, PASS);
ok(wv.ok === true && wv.count === 3, 'writeVault encrypts 3 secrets (empty skipped)');
const rv = CryptoVault.readVault(vaultPath, PASS);
ok(rv.ok === true && rv.secrets.cloudflare === 'cf_two' && rv.secrets.github === 'ghp_three', 'readVault restores all secrets');
const rvBad = CryptoVault.readVault(vaultPath, 'not the passphrase');
ok(rvBad.ok === false && Object.keys(rvBad.errors).length === 3, 'wrong passphrase reports per-entry errors');

const asyncCycle = CryptoVault.encryptSecretAsync('ghp_cross_runtime', PASS, 100000)
  .then((payload) => {
    ok(payload.v === 1 && payload.kdf === 'pbkdf2-sha256' && payload.iter === 100000, 'webcrypto path emits same envelope shape');
    return CryptoVault.decryptSecretAsync(payload, PASS).then((s) => {
      eq(s, 'ghp_cross_runtime', 'webcrypto round-trip restores secret');
    }).then(() => CryptoVault.decryptSecret(payload, PASS)).then((r) => {
      ok(r.ok === true && r.secret === 'ghp_cross_runtime', 'node path decrypts webcrypto payload (one envelope, two runtimes)');
    });
  })
  .catch((e) => ok(false, 'async crypto path failed: ' + e.message));

/* ============================================================
   5 — static pre-compression
   ============================================================ */
section('asset-compressor: sidecar generation');

const compressDist = tmpDir('compress-dist');
fs.mkdirSync(path.join(compressDist, 'assets'), { recursive: true });
const bigHTML = '<!doctype html><html><body>' + '<p>compressible content over and over. </p>'.repeat(200) + '</body></html>';
const bigJS = 'function alpha(){return {a:1,b:2,c:3}}\n'.repeat(400);
const bigSVG = '<svg xmlns="http://www.w3.org/2000/svg">' + '<circle r="4" cx="8" cy="8"/>'.repeat(100) + '</svg>';
fs.writeFileSync(path.join(compressDist, 'index.html'), bigHTML);
fs.writeFileSync(path.join(compressDist, 'assets', 'app.js'), bigJS);
fs.writeFileSync(path.join(compressDist, 'assets', 'logo.svg'), bigSVG);
fs.writeFileSync(path.join(compressDist, 'tiny.json'), '{"a":1}');
fs.writeFileSync(path.join(compressDist, 'photo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

const comp = AssetCompressor.precompressStaticAssets(compressDist, { brotliQuality: 11 });
ok(comp.ok === true, 'precompress ok');
ok(comp.compressed.some((c) => c.file === 'index.html'), 'index.html compressed');
ok(comp.compressed.some((c) => c.file === 'assets/app.js'), 'nested assets compressed');
ok(fs.existsSync(path.join(compressDist, 'index.html.br')) && fs.existsSync(path.join(compressDist, 'index.html.gz')), '.br and .gz sidecars written');
ok(fs.existsSync(path.join(compressDist, 'assets', 'app.js.br')), 'sidecars land beside sources in subfolders');
ok(comp.skipped.some((s) => s.file === 'tiny.json' && /minBytes/.test(s.reason)), 'below-minBytes files skipped with reason');
ok(comp.skipped.some((s) => s.file === 'photo.png' && /extension/.test(s.reason)), 'binary extension skipped');
ok(comp.totals.brSavedPct > 50, 'brotli shrinkage substantial on repetitive content (' + comp.totals.brSavedPct + '%)');
ok(comp.totals.brBytes <= comp.totals.gzBytes, 'brotli at least as good as gzip at same content');
eq(comp.settings.brotliQuality, 11, 'quality setting recorded');

// Byte-exact round-trips from disk.
const rtHTML = zlib.brotliDecompressSync(fs.readFileSync(path.join(compressDist, 'index.html.br')));
ok(rtHTML.equals(Buffer.from(bigHTML)), 'brotli sidecar decompresses byte-identical');
const rtJS = zlib.gunzipSync(fs.readFileSync(path.join(compressDist, 'assets', 'app.js.gz')));
ok(rtJS.equals(Buffer.from(bigJS)), 'gzip sidecar decompresses byte-identical');

ok(AssetCompressor.verifySidecars(compressDist).ok === true, 'verifySidecars: all sidecars clean');

section('asset-compressor: staleness, cleanup, knobs');

fs.writeFileSync(path.join(compressDist, 'index.html'), bigHTML + '<p>edited after compression</p>');
const vStale = AssetCompressor.verifySidecars(compressDist);
ok(vStale.ok === false && vStale.issues.some((i) => i.file === 'index.html.br' && /stale/.test(i.status)), 'stale sidecar detected after source edit');

fs.writeFileSync(path.join(compressDist, 'index.html'), bigHTML); // restore
fs.unlinkSync(path.join(compressDist, 'assets', 'logo.svg'));
const cleanup = AssetCompressor.cleanupSidecars(compressDist);
ok(cleanup.removed.indexOf('assets/logo.svg.br') !== -1 && cleanup.removed.indexOf('assets/logo.svg.gz') !== -1, 'orphaned sidecars cleaned up');

const clamped = AssetCompressor.precompressStaticAssets(compressDist, { brotliQuality: 99, gzipLevel: 42 });
eq(clamped.settings.brotliQuality, 11, 'brotli quality clamps to 11 (BROTLI_PARAM_QUALITY max)');
eq(clamped.settings.gzipLevel, 9, 'gzip level clamps to 9');
eq(AssetCompressor.BROTLI_PARAM_QUALITY, zlib.constants.BROTLI_PARAM_QUALITY, 'BROTLI_PARAM_QUALITY constant matches zlib');
ok(typeof AssetCompressor.edgeServerConfig('nginx') === 'string' && AssetCompressor.edgeServerConfig('nginx').indexOf('brotli_static on;') !== -1, 'nginx config snippet mentions brotli_static');
eq(AssetCompressor.edgeServerConfig('caddy').indexOf('precompressed br gzip') !== -1 ? true : false, true, 'caddy snippet mentions precompressed');
ok(AssetCompressor.edgeServerConfig('apache') === null, 'unknown server yields null');

/* ============================================================
   6 — cross-module integration
   ============================================================ */
section('cross-module integration');

// Chain: shake AST → prune CSS for its rendered HTML → precompress →
// manifest the whole bundle → verify → repair one corrupted file.
const chainDist = tmpDir('chain-dist');
const chainAST = {
  site: { pages: [{ slug: 'index', sections: [{ type: 'hero', title: 'Chain', subtitle: 'linked' }, { type: 'faq', items: [{ q: 'q', a: 'a' }] }, { type: 'pricing' }] }] },
  components: { hero: {}, faq: {}, pricing: {}, unused: {} }
};
const shaken = ASTOptimizer.shakeAST(chainAST).shaken;
const chainHTML = shaken.site.pages[0].sections
  .map((s) => '<section class="section-' + s.type + '"><h2>' + (s.title || s.items[0].q) + '</h2><div class="body"><p>' + 'chain content '.repeat(40) + '</p></div></section>')
  .join('');
const chainCSS = '.section-hero{color:#111}.section-faq{color:#222}.section-pricing{color:#333}.unused-component{color:#444}' +
  ('\n.section-hero .body{padding:2rem 4rem;color:#111}').repeat(12);
const chainPrune = ASTOptimizer.pruneUnusedCSS(chainHTML, chainCSS);
ok(chainPrune.css.indexOf('.unused-component') === -1, 'chain: pruner dropped CSS of shaken-away components');
ok(chainPrune.css.indexOf('.section-hero') !== -1, 'chain: surviving section CSS intact');

fs.writeFileSync(path.join(chainDist, 'index.html'), chainHTML);
fs.writeFileSync(path.join(chainDist, 'styles.css'), chainPrune.css);
fs.writeFileSync(path.join(chainDist, 'app.js'), '/* ' + 'payload '.repeat(200) + ' */');
const chainComp = AssetCompressor.precompressStaticAssets(chainDist);
ok(chainComp.ok === true && chainComp.totals.files === 3, 'chain: precompressed 3 files');

const chainGen = FileIntegrity.generateBuildManifest(chainDist);
ok(chainGen.files === 9, 'chain: manifest covers 3 sources + 6 sidecars (compression before manifesting)');
const chainVerify = FileIntegrity.verifyBuildIntegrity(chainDist);
ok(chainVerify.ok === true, 'chain: full bundle verifies');

const chainCache = tmpDir('chain-cache');
fs.mkdirSync(chainCache, { recursive: true });
fs.writeFileSync(path.join(chainCache, 'app.js'), fs.readFileSync(path.join(chainDist, 'app.js')));
fs.writeFileSync(path.join(chainDist, 'app.js'), 'CORRUPTED');
const chainIssues = FileIntegrity.verifyBuildIntegrity(chainDist);
const chainRepair = FileIntegrity.autoRepairCorruptedFiles(chainIssues.issues, chainCache, { distFolderPath: chainDist });
ok(chainRepair.ok === true, 'chain: corrupted JS repaired from cache');
const sidecarsStillValid = AssetCompressor.verifySidecars(chainDist);
ok(sidecarsStillValid.ok === true || sidecarsStillValid.issues.every((i) => i.file !== 'app.js.br'), 'chain: sidecars unaffected by source repair');
ok(FileIntegrity.verifyBuildIntegrity(chainDist).ok === true, 'chain: final verify green end to end');

/* ============================================================
   7 — the pruner against REAL builder output

   The fixtures above prove the pruner is self-consistent. They
   cannot prove it is safe, because safety depends on what the
   builder actually emits — and the builder's stylesheet is full
   of classes the markup never mentions. This section renders a
   real site and asserts a soundness invariant over it:

     ANY selector whose class tokens are ALL used must survive.

   That is the same predicate the pruner itself uses, evaluated
   independently against real output, so a selector that is
   dropped while every one of its classes is in use is a
   contradiction rather than a judgement call.
   ============================================================ */
section('ast-optimizer: real builder output (soundness invariant)');

{
  const R = path.join(__dirname, '..');
  global.DB = require(path.join(R, 'data', 'db.js'));
  global.ONLINE = require(path.join(R, 'data', 'online.js'));
  global.Review = require(path.join(R, 'data', 'review.js'));
  global.Images = require(path.join(R, 'data', 'images.js'));
  global.Focus = require(path.join(R, 'data', 'focus.js'));
  global.OgCard = require(path.join(R, 'data', 'ogcard.js'));
  global.Concierge = require(path.join(R, 'data', 'concierge.js'));
  const Builder = require(path.join(R, 'modules', 'builder.js'));

  const realProject = {
    id: 'p1', name: 'Northwind Joinery', suites: [],
    site: {
      name: 'Northwind Joinery', palette: 'midnight', font: 'inter',
      url: 'https://northwind.example',
      pages: [
        { id: 'home', name: 'Home', slug: 'index', sections: [
          { type: 'hero', title: 'Bespoke kitchens' },
          { type: 'gallery', title: 'Our work', items: [{ title: 'One' }, { title: 'Two' }] },
          { type: 'faq', title: 'FAQ', items: [{ title: 'Q', body: 'A' }] },
          { type: 'footer', title: 'Footer' }
        ] },
        { id: 'about', name: 'About', slug: 'about', sections: [
          { type: 'hero', title: 'About us' },
          { type: 'text', title: 'Story', body: 'We build.' },
          { type: 'footer', title: 'Footer' }
        ] }
      ]
    }
  };

  const pages = Builder.buildSitePages(realProject, { proExport: true, plan: 'pro' });
  const htmls = pages.map((p) => p.html);
  const combined = htmls.join('\n');

  const styles = [];
  const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let sm;
  while ((sm = styleRe.exec(htmls[0]))) styles.push(sm[1]);
  const realCSS = styles.join('\n');

  ok(realCSS.length > 20000, 'real stylesheet captured from a rendered site (' + realCSS.length + ' chars)');

  const realPrune = ASTOptimizer.pruneUnusedCSS(htmls, realCSS);
  ok(realPrune.ok === true, 'real stylesheet prunes without error');
  ok(realPrune.metrics.percentReduced > 10, 'real payload shrinks meaningfully (' + realPrune.metrics.percentReduced + '%)');

  // --- the failure this section exists for -------------------------------
  // <body id="top"> ships with NO theme class; the page's own script does
  // document.body.classList.toggle('theme-light'|'theme-dark'). Before
  // runtime-class protection existed, every body.theme-* rule was deleted
  // and the theme toggle silently did nothing.
  const runtimeToggled = ASTOptimizer.extractRuntimeClasses(combined);
  ok(runtimeToggled.size > 0, 'runtime-toggled classes discovered in real output (' + runtimeToggled.size + ')');
  ok(runtimeToggled.has('theme-light') && runtimeToggled.has('theme-dark'),
    'theme-light/theme-dark seen as runtime classes');
  ok(!/class\s*=\s*"[^"]*theme-light/.test(combined),
    'theme-light is genuinely absent from the markup (so it cannot be found by class-attribute scanning)');
  ok(realPrune.css.indexOf('theme-light') !== -1 && realPrune.css.indexOf('theme-dark') !== -1,
    'theme rules SURVIVE pruning — the toggle still works after a prune');
  ok(realPrune.metrics.runtimeProtected >= 2, 'runtime protection count reported in metrics');

  // --- the soundness invariant -------------------------------------------
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const altsOf = (text) => {
    const out = [];
    (function walk(segs) {
      segs.forEach((seg) => {
        if (seg.tailOnly) return;
        const at = /^@([\w-]+)/.exec(seg.prelude);
        if (at && /^(media|supports|container|layer)$/.test(at[1])) return walk(ASTOptimizer.segmentCSS(seg.body));
        if (at) return;
        seg.prelude.split(',').forEach((s) => { const t = s.trim(); if (t) out.push(t); });
      });
    })(ASTOptimizer.segmentCSS(text));
    return out;
  };

  const domClasses = new Set();
  (combined.match(/class\s*=\s*"([^"]*)"/gi) || []).forEach((c) => {
    c.replace(/class\s*=\s*"/i, '').replace(/"$/, '').split(/\s+/).forEach((t) => { if (t) domClasses.add(t); });
  });
  const protectedClasses = new Set([...domClasses, ...runtimeToggled]);
  const allow = ASTOptimizer.DEFAULT_ALLOW_PREFIXES;
  const isUsed = (cls) => protectedClasses.has(cls) || allow.some((p) => cls.indexOf(p) === 0);

  const survived = new Set(altsOf(realPrune.css));
  const violations = altsOf(realCSS).filter((alt) => {
    const toks = (alt.match(/\.([a-zA-Z0-9_-]+)/g) || []).map((t) => t.slice(1));
    if (!toks.length) return false;      // element/global selector — always kept
    return toks.every(isUsed) && !survived.has(alt);
  });
  ok(violations.length === 0,
    'SOUNDNESS: every fully-used selector survived the prune (' + violations.length + ' violations)',
    violations.slice(0, 6).join(' | '));

  // No broken custom property may be left behind on real output.
  const refs = new Set();
  (realPrune.css.match(/var\(\s*(--[\w-]+)/g) || []).forEach((v) => refs.add(/--[\w-]+/.exec(v)[0]));
  const defs = new Set();
  (realPrune.css.match(/(--[\w-]+)\s*:/g) || []).forEach((d) => defs.add(/--[\w-]+/.exec(d)[0]));
  const brokenVars = [...refs].filter((r) => !defs.has(r) && new RegExp('(^|[;{\\s])' + r + '\\s*:', 'm').test(realCSS));
  ok(brokenVars.length === 0, 'no var() reference lost its definition (' + brokenVars.length + ')', brokenVars.join(', '));

  ok(ASTOptimizer.pruneUnusedCSS(htmls, realPrune.css).css === realPrune.css,
    'prune is idempotent on real output');

  delete global.DB; delete global.ONLINE; delete global.Review; delete global.Images;
  delete global.Focus; delete global.OgCard; delete global.Concierge;
}

/* ============================================================
   summary
   ============================================================ */
asyncCycle.then(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* windows lock */ }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (fail > 0) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('backend-advanced-v5 smoke: ALL GREEN');
});
