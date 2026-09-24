'use strict';
// ============================================================
// PallettAI Studio — static compiler smoke
// ------------------------------------------------------------
// modules/static-compiler.js + main/index.js, checked where they
// could break:
//
//   1. OKLCH token injection — root variables with hex -fallback
//      siblings, key normalization, non-colour values kept safe.
//   2. styles.css + index.html — master sheet assembly, inline
//      critical styling, structural DOM serialization, escaping,
//      widget mounts + bundle reference.
//   3. Offline guarantee — every src/href forced onto relative
//      paths, remote and dangerous schemes rejected, fonts local.
//   4. manifest.json — sha256 per file, self-verifying digest,
//      determinism, generatedAt opt-in.
//   5. writeExportTree — fs.promises writes, path-traversal
//      refusal, root/relative outDir refusal, verify pass.
//   6. main/index.js — the project:compile-static channel:
//      sender policy fail-closed, full compile+write cycle into a
//      real temp directory, picker flow, coded error envelope.
//
// Usage: node scripts/static-compiler-smoke.js   (exit 0 = green)
// ============================================================

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const StaticCompiler = require('../modules/static-compiler.js');
const Bridge = require('../main/index.js');

let fails = 0;
let total = 0;
const ok = (cond, label) => {
  total++;
  console.log((cond ? '  ok   ' : '  FAIL ') + label);
  if (!cond) fails++;
};
const section = (title) => console.log('\n== ' + title + ' ==');
const throwsCode = (fn, code) => {
  try { fn(); return false; } catch (e) { return e.code === code; }
};
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pai-static-'));

// The reference project: everything the compiler must handle at once.
const FIXTURE = {
  meta: {
    title: 'Acme & Co <site>',
    description: 'A "quoted" description',
    lang: 'en-GB',
    themeColor: 'oklch(62% 0.17 250)'
  },
  theme: {
    tokens: {
      primary: 'oklch(0.62 0.17 250)',
      surface: '#f4f4f6',
      'Brand Accent': '#ff0055',
      spacing: '1.5rem',
      evil: 'red;}</style><script>alert(1)</script>'
    },
    fonts: [
      { family: 'Acme Sans', files: ['assets/fonts/acme.woff2'], weight: 400, role: 'body' },
      { family: 'Orphan Font', files: [] }
    ]
  },
  page: {
    structure: [
      {
        tag: 'header',
        attrs: { class: 'hero', 'data-x': 'a"b' },
        children: [
          { tag: 'h1', text: 'Hello & <welcome>' },
          { tag: 'img', attrs: { src: './assets/logo.svg', alt: 'Logo' } },
          { tag: 'img', attrs: { src: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', alt: 'pixel' } },
          { tag: 'br' }
        ]
      },
      {
        tag: 'main',
        children: [
          { tag: 'script', text: 'if (a < b) { console.log("</style>"); }' },
          { tag: 'p', attrs: { hidden: true }, text: 'body copy' }
        ]
      }
    ]
  },
  widgets: [
    { id: 'widget-alpha', title: 'Alpha', html: '<b>a</b>', css: '.a{color:red}', js: 'root.dataset.a=1;' },
    { id: 'widget-beta', title: 'Beta', html: '<i>b</i>', css: '.b{color:blue}', js: 'root.dataset.b=1;' }
  ],
  assets: [
    { path: 'assets/logo.svg', data: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' },
    { path: 'assets/fonts/acme.woff2', data: 'AAECAwQF', encoding: 'base64' }
  ],
  styles: '.hero{padding:2rem}'
};

// ============================================================
section('1. OKLCH token injection');
// ============================================================

const warnings = [];
const tokensCss = StaticCompiler.generateTokensCSS(FIXTURE.theme.tokens, warnings);
ok(tokensCss.indexOf(':root {') === 0, 'tokens emit as a :root variable block');
ok(tokensCss.indexOf('--color-primary: oklch(') > -1, 'oklch() value lands in --color-primary');
ok(tokensCss.indexOf('--color-primary-fallback: #') > -1, 'hex -fallback sibling emitted');
ok(tokensCss.indexOf('--color-surface: oklch(') > -1, 'hex input is normalized to oklch()');
ok(tokensCss.indexOf('--color-brand-accent: ') > -1, 'multi-word keys kebab into valid names');
ok(tokensCss.indexOf('--color-spacing: 1.5rem;') > -1, 'non-colour value emitted verbatim');
ok(tokensCss.indexOf('<') === -1 && (tokensCss.match(/}/g) || []).length === 1,
  'declaration-breaking characters stripped from verbatim values');
ok(tokensCss.indexOf('</style>') === -1, 'no style-block breakout survives sanitizing');
ok(warnings.some((w) => w.indexOf('spacing') > -1), 'non-colour token warns (no hex fallback)');
ok(warnings.some((w) => w.indexOf('evil') > -1), 'stripped token warns');
ok(throwsCode(() => StaticCompiler.generateTokensCSS({ '++': 'red' }, []), 'bad_input'),
  'unusable token key throws bad_input');
ok(StaticCompiler.generateTokensCSS({ spacing: '1rem' }).indexOf('--color-spacing') > -1,
  'public token generator tolerates a missing warnings array');
ok(StaticCompiler.generateFontsCSS([{ family: 'X', files: [] }]).indexOf('@font-face') === -1,
  'public font generator tolerates a missing warnings array');

// ============================================================
section('2. styles.css + index.html');
// ============================================================

const build = StaticCompiler.compileProject(FIXTURE);
const fileOf = (p) => build.files.find((f) => f.path === p);
ok(build.ok === true && build.entry === 'index.html', 'compile resolves with index.html as entry');

const styles = fileOf('styles.css').data.toString('utf8');
ok(styles.indexOf('--color-primary: oklch(') > -1, 'master styles.css carries the tokens');
ok(styles.indexOf('@font-face {') > -1 && styles.indexOf('url("assets/fonts/acme.woff2")') > -1,
  'local @font-face emitted with relative url()');
ok(styles.indexOf('--font-body: "Acme Sans"') > -1, 'font role becomes a root variable');
ok(styles.indexOf('@supports (color: oklch(0 0 0))') > -1, 'oklch() upgrade is supports-gated');
ok(styles.indexOf('.hero{padding:2rem}') > -1, 'project styles ride through verbatim');

const html = fileOf('index.html').data.toString('utf8');
ok(html.indexOf('<!doctype html>') === 0, 'index.html is a clean document');
ok(html.indexOf('<html lang="en-GB">') > -1, 'language tag honored');
ok(html.indexOf('<title>Acme &amp; Co &lt;site&gt;</title>') > -1, 'title escaped');
ok(html.indexOf('content="A &quot;quoted&quot; description"') > -1, 'description attribute escaped');
ok(html.indexOf('<meta name="theme-color" content="#') > -1, 'theme-color meta carries hex');
ok(html.indexOf('<link rel="stylesheet" href="styles.css">') > -1,
  'master sheet referenced by relative path');
ok(html.indexOf('<style data-critical>') > -1 && html.indexOf('--color-primary: oklch(')
  < html.indexOf('</head>'), 'critical styling inlined in the head');
ok(html.indexOf('Hello &amp; &lt;welcome&gt;') > -1, 'text nodes escaped');
ok(html.indexOf('data-x="a&quot;b"') > -1, 'attribute values escaped');
ok(html.indexOf('<br>') > -1 && html.indexOf('</br>') === -1, 'void tags not closed');
ok(html.indexOf('if (a < b)') > -1, 'script text stays raw code');
const closer = StaticCompiler.compileProject({
  page: { structure: [{ tag: 'script', text: 'var s = "</script><script>";' }] }
}).files.find((f) => f.path === 'index.html').data.toString('utf8');
ok(closer.indexOf('var s = "<\\/script><script>";') > -1,
  'raw script text cannot close its own element');
ok(html.indexOf('hidden') > -1, 'boolean attribute emitted bare');
ok(throwsCode(() => StaticCompiler.compileProject({
  page: { structure: [{ tag: 'div><script', text: 'x' }] }
}), 'bad_input'), 'tag names validated');
ok(throwsCode(() => StaticCompiler.compileProject({ page: { structure: [] } }), 'bad_input'),
  'empty structure throws bad_input');
ok(throwsCode(() => StaticCompiler.compileProject(null), 'bad_input'), 'null project throws bad_input');
ok(StaticCompiler.compileProject({ structure: [{ tag: 'p', text: 'x' }] }).ok === true,
  'top-level `structure` alias accepted');

// ============================================================
section('3. offline guarantee — relative refs only');
// ============================================================

ok(html.indexOf('src="./assets/logo.svg"') === -1 && html.indexOf('src="assets/logo.svg"') > -1,
  'leading ./ normalized away');
ok(html.indexOf('data:image/gif;base64,') > -1, 'data: URIs pass through (still offline)');
ok(throwsCode(() => StaticCompiler.compileProject({
  page: { structure: [{ tag: 'img', attrs: { src: '/assets/logo.svg' } }] }
}), 'bad_input'), 'absolute path ref rejected');
ok(throwsCode(() => StaticCompiler.compileProject({
  page: { structure: [{ tag: 'img', attrs: { src: 'https://cdn.example.com/x.png' } }] }
}), 'bad_input'), 'remote URL ref rejected (self-contained exports)');
ok(throwsCode(() => StaticCompiler.compileProject({
  page: { structure: [{ tag: 'a', attrs: { href: 'javascript:alert(1)' } }] }
}), 'bad_input'), 'javascript: scheme rejected outright');
const allowRemote = StaticCompiler.compileProject({
  page: { structure: [{ tag: 'img', attrs: { src: 'https://cdn.example.com/x.png' } }] }
}, { allowRemote: true });
ok(allowRemote.warnings.some((w) => w.indexOf('remote') > -1),
  'allowRemote keeps the URL but warns the export is not self-contained');
ok(build.warnings.some((w) => w.indexOf('Orphan Font') > -1), 'fileless font skipped with a warning');
ok(throwsCode(() => StaticCompiler.compileProject({
  theme: { fonts: [{ family: 'X', files: ['https://x/y.woff2'] }] },
  page: { structure: [{ tag: 'p', text: 'x' }] }
}), 'bad_input'), 'remote font file rejected');

// ============================================================
section('4. widget injection');
// ============================================================

const bundleFile = fileOf('scripts/widgets.js');
ok(!!bundleFile, 'widget bundle emitted as scripts/widgets.js');
const bundle = bundleFile.data.toString('utf8');
ok((bundle.match(/pallett-engine v1/g) || []).length === 1,
  'shared engine emitted exactly once for two widgets');
ok(bundle.indexOf('pallett-config v1') > -1, 'per-widget configs present');
ok(bundle.indexOf('pallett-config v1') < bundle.indexOf('pallett-engine v1'),
  'configs register BEFORE the engine (no fallback flash)');
ok(html.indexOf('<pallet-widget id="widget-alpha"></pallet-widget>') > -1
  && html.indexOf('<pallet-widget id="widget-beta"></pallet-widget>') > -1,
  'mount nodes appended to the body');
ok(html.indexOf('<script src="scripts/widgets.js" defer></script>') > -1,
  'bundle referenced by relative path');

const preMounted = StaticCompiler.compileProject({
  page: { structure: [{ tag: 'pallet-widget', attrs: { id: 'widget-alpha' } }] },
  widgets: [{ id: 'widget-alpha', html: '<b>a</b>', css: '.a{}', js: '' }]
});
const preHtml = preMounted.files.find((f) => f.path === 'index.html').data.toString('utf8');
ok((preHtml.match(/id="widget-alpha"/g) || []).length === 1,
  'an existing mount in the structure is not duplicated');

// ============================================================
section('5. assets + secure manifest');
// ============================================================

const logo = fileOf('assets/logo.svg');
const font = fileOf('assets/fonts/acme.woff2');
ok(logo.bytes === Buffer.byteLength('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
  && logo.sha256 === sha(logo.data), 'text asset bytes + sha256 correct');
ok(Buffer.isBuffer(font.data) && font.data.length === 6 && font.sha256 === sha(font.data),
  'base64 asset decoded to exact bytes and hashed');
ok(throwsCode(() => StaticCompiler.compileProject(Object.assign({}, FIXTURE, {
  assets: [{ path: '../evil.txt', data: 'x' }]
})), 'bad_input'), 'traversal asset path refused');
ok(throwsCode(() => StaticCompiler.compileProject(Object.assign({}, FIXTURE, {
  assets: [{ path: 'styles.css', data: 'x' }]
})), 'bad_input'), 'asset cannot shadow a generated file');
ok(throwsCode(() => StaticCompiler.compileProject(Object.assign({}, FIXTURE, {
  assets: [{ path: 'a/b.txt', data: '1' }, { path: 'a/b.txt', data: '2' }]
})), 'bad_input'), 'duplicate asset path refused');
ok(throwsCode(() => StaticCompiler.compileProject(Object.assign({}, FIXTURE, {
  assets: [{ path: 'Index.html', data: 'x' }]
})), 'bad_input'), 'case-variant collision with a generated file refused (case-insensitive disk)');
ok(throwsCode(() => StaticCompiler.compileProject(Object.assign({}, FIXTURE, {
  assets: [{ path: 'a/b.txt' }]
})), 'bad_input'), 'dataless asset refused');
ok(build.warnings.filter((w) => w.indexOf('spacing') > -1).length === 1,
  'token warnings reported exactly once (master + critical share one pass)');
ok(throwsCode(() => StaticCompiler.compileProject({
  page: { structure: [{ tag: 'p', text: 'x' }] },
  widgets: [{ script: '/* pallett-engine v1 */ (function(){})();' }]
}), 'bad_input'), 'widget without a usable id refused (its mount could never attach)');

const manifest = build.manifest;
ok(manifest.algorithm === 'sha256' && manifest.format === 'pallettai-static-export',
  'manifest records its algorithm and format');
ok(manifest.files.every((f) => /^[a-f0-9]{64}$/.test(f.sha256)), 'every listed file has a sha256');
ok(!manifest.files.some((f) => f.path === 'manifest.json'),
  'manifest.json does not list itself (no chicken-and-egg hash)');
const canonical = manifest.files.map((f) => f.path + '\n' + f.sha256 + '\n').join('');
ok(manifest.digest === sha(Buffer.from(canonical, 'utf8')),
  'digest is a sha256 over the canonical file list (self-verifying)');
ok(manifest.counts.bytes === manifest.files.reduce((n, f) => n + f.bytes, 0),
  'byte count matches the listed files');
ok(manifest.generatedAt === undefined, 'no timestamp by default (byte-stable exports)');
ok(StaticCompiler.compileProject(FIXTURE).manifestJson === build.manifestJson,
  'two compiles of one project are byte-identical');
const stamped = StaticCompiler.compileProject(FIXTURE, { generatedAt: '2026-09-24T00:00:00Z' });
ok(stamped.manifest.generatedAt === '2026-09-24T00:00:00Z', 'generatedAt stamps when asked');

// Pre-built file trees get the same integrity story (renderer mode).
const prebuiltFiles = [
  { name: 'index.html', content: '<!doctype html><p>hi</p>' },
  { path: 'assets/note.txt', data: 'hello' }
];
const built = StaticCompiler.compileFileTree(prebuiltFiles);
ok(built.ok === true && built.entry === 'index.html',
  'compileFileTree accepts {name, content} and {path, data} entries');
ok(built.files.find((f) => f.path === 'assets/note.txt').sha256 === sha(Buffer.from('hello')),
  'pre-built files are checksummed like compiler output');
ok(built.manifest.files.length === 2
  && !built.manifest.files.some((f) => f.path === 'manifest.json'),
  'pre-built manifest lists the delivered files, not itself');
ok(StaticCompiler.compileFileTree(prebuiltFiles).manifestJson === built.manifestJson,
  'compileFileTree is deterministic');
ok(StaticCompiler.compileFileTree([{ path: 'a.txt', data: 'x' }]).entry === 'a.txt',
  'entry falls back to the first file when there is no index.html');
ok(throwsCode(() => StaticCompiler.compileFileTree([]), 'bad_input'),
  'empty file list throws bad_input');
ok(throwsCode(() => StaticCompiler.compileFileTree([{ path: 'manifest.json', data: 'x' }]), 'bad_input'),
  'manifest.json is reserved for the generated manifest');
ok(throwsCode(() => StaticCompiler.compileFileTree([
  { path: 'a/b.txt', data: '1' }, { name: 'a/B.TXT', content: '2' }
]), 'bad_input'), 'case-variant duplicate refused in file trees');
ok(throwsCode(() => StaticCompiler.compileFileTree([{ path: 'x.txt' }]), 'bad_input'),
  'dataless file refused');

// ============================================================
section('6. export writer — fs.promises, traversal proof');
// ============================================================

(async () => {
  const outA = path.join(TMP, 'site-a');
  const write = await StaticCompiler.writeExportTree(build, outA, { verify: true });
  ok(write.ok && write.count === build.files.length, 'every file written and verified');
  ok(fs.existsSync(path.join(outA, 'index.html'))
    && fs.existsSync(path.join(outA, 'styles.css'))
    && fs.existsSync(path.join(outA, 'manifest.json'))
    && fs.existsSync(path.join(outA, 'assets', 'fonts', 'acme.woff2')),
    'tree lands with nested asset directories created');
  ok(fs.readFileSync(path.join(outA, 'index.html'), 'utf8') === html,
    'written bytes match the compile output');

  const escapeAttempt = { files: [{ path: 'x/../../evil.txt', data: 'boom', bytes: 4, sha256: sha(Buffer.from('boom')) }] };
  let escaped = false;
  try { await StaticCompiler.writeExportTree(escapeAttempt, outA); } catch (e) { escaped = e.code === 'bad_input'; }
  ok(escaped, 'writer refuses a traversal path even if compile were bypassed');
  ok(!fs.existsSync(path.join(TMP, 'evil.txt')), 'nothing was written outside the output directory');

  let refused = false;
  try { await StaticCompiler.writeExportTree(build, 'relative/dir'); } catch (e) { refused = e.code === 'bad_input'; }
  ok(refused, 'relative output directory refused');
  refused = false;
  try { await StaticCompiler.writeExportTree(build, path.parse(TMP).root); } catch (e) { refused = e.code === 'bad_input'; }
  ok(refused, 'filesystem root refused as output directory');
  refused = false;
  try { await StaticCompiler.writeExportTree({}, outA); } catch (e) { refused = e.code === 'bad_input'; }
  ok(refused, 'non-tree input refused');

  // ============================================================
  section('7. Electron bridge — project:compile-static');
  // ============================================================

  const makeIpc = () => {
    const handlers = {};
    return { handlers, handle: (name, fn) => { handlers[name] = fn; } };
  };

  // Fail closed: no sender policy → nothing compiles, ever.
  const closedIpc = makeIpc();
  Bridge.registerStaticCompileIpc({ ipcMain: closedIpc, defaultOutputDir: TMP });
  const closed = await closedIpc.handlers[Bridge.CHANNEL]({}, { project: FIXTURE });
  ok(closed.ok === false && closed.code === 'unauthorised',
    'bridge fails closed with no isTrusted policy wired');
  ok(Bridge.CHANNEL === 'project:compile-static', 'channel name is the documented one');

  const deniedIpc = makeIpc();
  Bridge.registerStaticCompileIpc({ ipcMain: deniedIpc, fromMainFrame: () => false, defaultOutputDir: TMP });
  const denied = await deniedIpc.handlers[Bridge.CHANNEL]({}, { project: FIXTURE });
  ok(denied.ok === false && denied.code === 'unauthorised', 'untrusted sender rejected');

  const throwIpc = makeIpc();
  Bridge.registerStaticCompileIpc({
    ipcMain: throwIpc,
    fromMainFrame: () => { throw new Error('sender check exploded'); },
    defaultOutputDir: TMP
  });
  const threw = await throwIpc.handlers[Bridge.CHANNEL]({}, { project: FIXTURE });
  ok(threw.ok === false && typeof threw.error === 'string',
    'a throwing sender check still resolves to an envelope (never rejects across IPC)');

  // The full cycle: compile + async write into a fresh directory.
  const outB = path.join(TMP, 'site-b');
  const goodIpc = makeIpc();
  const reg = Bridge.registerStaticCompileIpc({
    ipcMain: goodIpc, fromMainFrame: () => true, defaultOutputDir: outB
  });
  ok(reg.channel === 'project:compile-static', 'registration reports the documented channel');
  const good = await goodIpc.handlers[Bridge.CHANNEL]({}, {
    project: FIXTURE, outputDir: outB, verify: true
  });
  ok(good.ok === true && good.value.files === build.files.length,
    'trusted payload compiles and writes: ' + (good.error || 'ok'));
  ok(good.value.manifest.digest === build.manifest.digest, 'result carries the integrity manifest');
  ok(fs.existsSync(path.join(outB, 'manifest.json')), 'export folder materialized on disk');
  ok(good.value.warnings.length > 0, 'warnings surface to the renderer');

  // Files mode: the renderer's Builder output shape, written + manifested.
  const outF = path.join(TMP, 'site-files');
  const filesIpc = makeIpc();
  Bridge.registerStaticCompileIpc({ ipcMain: filesIpc, fromMainFrame: () => true, defaultOutputDir: outF });
  const filesRun = await filesIpc.handlers[Bridge.CHANNEL]({}, {
    files: [{ name: 'index.html', content: '<!doctype html><p>rendered</p>' }],
    verify: true
  });
  ok(filesRun.ok === true && fs.existsSync(path.join(outF, 'index.html'))
    && fs.existsSync(path.join(outF, 'manifest.json')),
    'files-mode payload (renderer delivery shape) compiles and writes: ' + (filesRun.error || 'ok'));
  ok(filesRun.value.manifest.files.length === 1,
    'files-mode manifest checksums exactly the delivered files');

  // Bare-project alias + defaultOutputDir fallback.
  const outC = path.join(TMP, 'site-c');
  const aliasIpc = makeIpc();
  Bridge.registerStaticCompileIpc({ ipcMain: aliasIpc, fromMainFrame: () => true, defaultOutputDir: outC });
  const aliasRun = await aliasIpc.handlers[Bridge.CHANNEL]({}, FIXTURE);
  ok(aliasRun.ok === true && fs.existsSync(path.join(outC, 'index.html')),
    'bare project object accepted, defaultOutputDir used');

  // Native picker flow.
  const outD = path.join(TMP, 'site-d');
  const pickIpc = makeIpc();
  Bridge.registerStaticCompileIpc({
    ipcMain: pickIpc,
    fromMainFrame: () => true,
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [outD] }) }
  });
  const picked = await pickIpc.handlers[Bridge.CHANNEL]({}, { project: FIXTURE, pickDirectory: true });
  ok(picked.ok === true && fs.existsSync(path.join(outD, 'index.html')),
    'picker flow writes to the selected directory');

  const cancelIpc = makeIpc();
  Bridge.registerStaticCompileIpc({
    ipcMain: cancelIpc,
    fromMainFrame: () => true,
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) }
  });
  const cancelled = await cancelIpc.handlers[Bridge.CHANNEL]({}, { project: FIXTURE, pickDirectory: true });
  ok(cancelled.ok === false && cancelled.code === 'cancelled', 'cancelled picker reported as cancelled');

  // Coded error envelope: a bad project never rejects across IPC.
  const badIpc = makeIpc();
  Bridge.registerStaticCompileIpc({ ipcMain: badIpc, fromMainFrame: () => true, defaultOutputDir: TMP });
  const bad = await badIpc.handlers[Bridge.CHANNEL]({}, { project: { page: { structure: [] } } });
  ok(bad.ok === false && bad.code === 'bad_input' && typeof bad.error === 'string',
    'invalid project returns a coded envelope, never a rejected invoke()');
  const bareIpc = makeIpc();
  Bridge.registerStaticCompileIpc({ ipcMain: bareIpc, fromMainFrame: () => true }); // no defaultOutputDir
  const noDir = await bareIpc.handlers[Bridge.CHANNEL]({}, { project: FIXTURE });
  ok(noDir.ok === false && noDir.code === 'bad_input', 'missing output directory is a coded error');

  // Cleanup the temp tree.
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* best effort */ }

  console.log('\n' + (total - fails) + '/' + total + ' checks passed'
    + (fails ? ' — ' + fails + ' FAILED' : ' — ALL PASS'));
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error('\nRUNNER ERROR: ' + (e && e.stack || e));
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* best effort */ }
  process.exit(1);
});
