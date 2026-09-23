'use strict';
// ============================================================
// Backend Advanced v6 — parallel pipeline, incremental compiler,
// CSP/SRI synthesis, headless CLI engine
//
// The four modules of this brief, checked where they could break:
//
//   1. build-pipeline     — queue construction + minify toggle,
//                           round-robin distribution invariants,
//                           pool sizing against injected cores/
//                           memory (cores vs memory vs idle
//                           decisions), telemetry math, then a
//                           REAL worker_threads run asserting
//                           results, per-worker completion,
//                           exact minification (string content
//                           preserved), sha256 parity, progress
//                           call count === job count, byte-equal
//                           determinism across two runs AND across
//                           thread vs local-executor modes, plus
//                           the failure paths (executor throw,
//                           empty response) keeping the
//                           done+failed===total invariant.
//   2. incremental-compiler — subtree precision (leaf edit compiles
//                           1 node of N), document-order changed
//                           list, exact fragments incl. escaping,
//                           Δt present and sane, typed errors, and
//                           invalidation: direct hits, key→key
//                           propagation, cycles, string form,
//                           untouched keys surviving.
//   3. security-csp       — staple directives, no unsafe-inline by
//                           default, preset origins per provider,
//                           malformed-origin rejection, sha384
//                           LENGTH pinning the algorithm, inline
//                           script/style hashes flowing into the
//                           policy, SRI integrity replace-not-
//                           stack, hex/base64/prefixed hash forms,
//                           single idempotent meta (double- and
//                           single-quoted pre-existing ones both
//                           replaced), placement errors.
//   4. cli-engine         — flag grammar (both value forms, bool
//                           negation, aliases, unknown/missing/
//                           bad-value errors), validation matrix
//                           → exit 2 with NO stats file, build
//                           failure → exit 1 WITH ok:false stats,
//                           success → exit 0 + parsed
//                           build-stats.json + real workers,
//                           --config merge with flags winning,
//                           verbose progress gating, main()
//                           codes for help/usage/success/failure,
//                           and filename sanitization stopping a
//                           '../' page id from escaping outDir.
//
// Usage: node scripts/backend-advanced-v6-smoke.js   (exit 0 = green)
// ============================================================

const fs = require('fs');
const os = require('os');
const path = require('path');
const nodeCrypto = require('crypto');

const bp = require('../modules/build-pipeline.js');
const ic = require('../modules/incremental-compiler.js');
const csp = require('../modules/security-csp.js');
const cli = require('../modules/cli-engine.js');

let fails = 0;
let total = 0;
const ok = (cond, label) => {
  total++;
  console.log((cond ? '  ok   ' : '  FAIL ') + label);
  if (!cond) fails++;
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const section = (title) => console.log('\n== ' + title + ' ==');
const throwsCode = (fn, code) => {
  try { fn(); return false; } catch (e) { return e.code === code; }
};

const tmpDirs = [];
const tmpDir = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pai-v6-'));
  tmpDirs.push(d);
  return d;
};
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2));

const SCHEMA = {
  pages: [
    { id: 'a', title: 'A<b>', html: '<p>raw & ready</p>' },
    { id: 'b', title: 'B', html: '<p>two</p>' },
    { id: 'c', title: 'C', html: '<p>three</p>' },
    { id: 'd', title: 'D', html: '<p>four</p>' }
  ],
  styles: [
    { id: 's0', css: '/* c */\nbody  {\n  color : red ;\n}' },
    { id: 's1', css: '.q::before{content:"  /* keep */  "}' }
  ],
  assets: [
    { id: 'x', data: 'AAA' },
    { id: 'y', data: 'payload-2' }
  ]
};

const run = async () => {
  // ==========================================================
  section('1. build-pipeline — queue, distribution, pool sizing, telemetry');
  // ==========================================================

  const queue = bp.buildJobQueue(SCHEMA);
  ok(queue.length === 8, 'queue = 4 pages + 2 styles + 2 assets = 8 jobs');
  ok(queue[0].id === 'page:a' && queue[4].id === 'css:s0' && queue[7].id === 'asset:y',
    'queue order: pages → css → assets');
  const noMinify = bp.buildJobQueue(SCHEMA, { minify: false });
  ok(noMinify.length === 6 && !noMinify.some((j) => j.kind === 'css'),
    'minify:false drops css jobs from the queue');

  const bins = bp.distributeJobs(queue, 3);
  ok(bins.length === 3 && bins.reduce((n, b) => n + b.length, 0) === 8,
    'distribution keeps every job exactly once');
  ok(bins[0].length === 3 && bins[1].length === 3 && bins[2].length === 2,
    'round-robin sizes differ by at most one (3/3/2)');
  ok(bins[0][0].id === 'page:a' && bins[0][1].id === 'page:d' && bins[0][2].id === 'asset:x',
    'bin order follows queue order (indices 0,3,6)');
  ok(bp.distributeJobs(queue, 1)[0].length === 8, 'single worker gets the whole queue');
  ok(bp.distributeJobs([], 4).length === 4 && bp.distributeJobs([], 4).every((b) => !b.length),
    'empty queue → empty bins, never a crash');

  const life1 = bp.manageWorkerLifecycle(new Array(100), { cores: 4, freeMem: 1e12 });
  ok(life1.size === 4 && life1.limit === 'cores', '100 jobs / 4 cores → size 4, limited by cores');
  const life2 = bp.manageWorkerLifecycle(new Array(100), {
    cores: 8, totalMem: 8 * 1024 * 1024 * 1024,
    freeMem: 100 * 1024 * 1024, perWorkerBytes: 192 * 1024 * 1024
  });
  ok(life2.size === 1 && life2.limit === 'memory' && life2.starved === true
    && life2.byMemory === 10,
    'starved floor: 100MB free (<192MB/worker) collapses the pool to 1 thread');
  const life2b = bp.manageWorkerLifecycle(new Array(100), {
    cores: 8, totalMem: 1024 * 1024 * 1024,
    freeMem: 8 * 1024 * 1024 * 1024, perWorkerBytes: 192 * 1024 * 1024
  });
  ok(life2b.size === 1 && life2b.limit === 'memory' && life2b.starved === false
    && life2b.byMemory === 1,
    'budget binds honestly: 1GB total × 25% / 192MB → byMemory 1, not starved');
  const life3 = bp.manageWorkerLifecycle(new Array(100), {
    cores: 4, totalMem: 4 * 1024 * 1024 * 1024,
    freeMem: 1000 * 1024 * 1024, perWorkerBytes: 192 * 1024 * 1024
  });
  ok(life3.size === 4 && life3.limit === 'cores' && life3.byMemory === 5
    && life3.starved === false,
    '4GB total allows 5 workers → cores (4) still binds; free 1000MB not starved');
  const life4 = bp.manageWorkerLifecycle(new Array(2), { cores: 8, freeMem: 1e12 });
  ok(life4.size === 2, 'fewer jobs than cores → size = jobs');
  const life5 = bp.manageWorkerLifecycle([], { cores: 4 });
  ok(life5.size === 0 && life5.limit === 'idle', 'empty queue → idle, size 0');
  const life6 = bp.manageWorkerLifecycle(new Array(10));
  ok(life6.size >= 1 && life6.size <= Math.min(10, life6.cores), 'auto sizing stays in 1..min(jobs,cores)');

  const progress = [];
  const tel = bp.createTelemetry(3, (s) => progress.push(s));
  tel.record('w0', true, 111);
  tel.record('w0', false, 222);
  tel.record('w1', true, 333);
  const snap = tel.snapshot();
  ok(snap.done === 2 && snap.failed === 1 && snap.total === 3, 'telemetry counts done/failed');
  ok(snap.completionRate === 2 / 3, 'completion rate = done/total');
  ok(snap.workers === 2 && snap.perWorker.w0.done === 1 && snap.perWorker.w0.failed === 1,
    'per-worker completion tracked separately');
  ok(snap.perWorker.w0.memBytes === 222 && snap.memBytes === 555,
    'per-worker memory reported and summed');
  ok(Number.isFinite(snap.throughput) && snap.throughput >= 0 && snap.elapsedMs >= 0,
    'throughput + elapsed are sane numbers');
  ok(progress.length === 3 && typeof progress[2].completionRate === 'number',
    'onProgress fired per completed job (real-time telemetry)');

  // ---- real worker threads -----------------------------------
  const progress2 = [];
  const real = await bp.executeParallelBuild(SCHEMA, 2, {
    onProgress: (s) => progress2.push(s)
  });
  ok(real.report.ok === true, 'real-thread build reports ok');
  ok(real.report.workers === 2, 'workerCount 2 honored');
  ok(real.report.done === 8 && real.report.failed === 0 && real.report.total === 8,
    'all 8 jobs completed, none failed');
  ok(real.report.done + real.report.failed === real.report.total,
    'invariant: done + failed === total');
  ok(real.report.perWorker.w0 && real.report.perWorker.w1
    && real.report.perWorker.w0.done >= 1 && real.report.perWorker.w1.done >= 1,
    'BOTH threads received work (real parallel distribution)');
  ok(real.report.perWorker.w0.memBytes >= 0 && real.report.perWorker.w0.memBytes < 1e9,
    'worker memory telemetry is a plausible heap figure');
  ok(progress2.length === 8 && progress2[7].completionRate === 1,
    'progress fired exactly once per job; final rate is 1');
  ok(Number.isFinite(real.report.throughput) && real.report.throughput > 0,
    'throughput metric positive after a real build');

  ok(real.results.pages.a.indexOf('<!doctype html>') === 0
    && real.results.pages.a.indexOf('<title>A&lt;b&gt;</title>') > -1,
    'page rendered: doctype first, title HTML-escaped');
  ok(real.results.pages.a.indexOf('<p>raw & ready</p>') > -1,
    'body content passes through untouched');
  ok(real.results.styles.s0 === 'body{color:red;}', 'css minified to exact expected bytes');
  ok(real.results.styles.s1 === '.q::before{content:"  /* keep */  "}',
    'quote-aware scanner: string content (incl. /* */) survives verbatim');
  const expectHash = nodeCrypto.createHash('sha256').update('AAA').digest('hex');
  ok(real.results.assets.x.sha256 === expectHash && real.results.assets.x.bytes === 3,
    'asset sha256 + byte count computed off-thread');

  const again = await bp.executeParallelBuild(SCHEMA, 2);
  ok(eq(real.results.pages, again.results.pages)
    && eq(real.results.styles, again.results.styles)
    && eq(real.results.assets, again.results.assets),
    'byte-identical results across two thread runs (determinism)');
  const local = await bp.executeParallelBuild(SCHEMA, 'auto',
    { executor: bp.localExecutor, cores: 3, freeMem: 1e12 });
  ok(eq(real.results.pages, local.results.pages)
    && eq(real.results.styles, local.results.styles),
    'local executor produces identical bytes to the thread pool');
  ok(local.report.ok === true && local.report.workers === 3,
    'executor seam is really called (auto sizing saw cores:3)');

  const thrown = await bp.executeParallelBuild(SCHEMA, 1, {
    executor: () => Promise.reject(new Error('disk full'))
  });
  ok(thrown.report.ok === false && thrown.report.failed === 8
    && thrown.report.done + thrown.report.failed === thrown.report.total,
    'executor throw → all jobs failed, invariant still holds');
  ok(thrown.results.errors[0].error === 'disk full', 'failure reason propagated to errors');
  const empty = await bp.executeParallelBuild(SCHEMA, 1, {
    executor: () => Promise.resolve({ results: [] })
  });
  ok(empty.report.failed === 8 && empty.results.errors[0].error === 'missing result from worker',
    'empty worker response cannot claim done work (missing-result guard)');

  let badSchemaCode = null;
  await bp.executeParallelBuild({ pages: 'nope' }, 1).catch((e) => { badSchemaCode = e.code; });
  ok(badSchemaCode === 'bad_input', 'schema without pages array throws bad_input');
  let badWc = null;
  await bp.executeParallelBuild(SCHEMA, 'many').catch((e) => { badWc = e.code; });
  ok(badWc === 'bad_input', 'non-numeric workerCount throws bad_input');

  // ==========================================================
  section('2. incremental-compiler — subtree deltas, invalidation, Δt');
  // ==========================================================

  const t1 = ic.nowMs();
  const t2 = ic.nowMs();
  ok(Number.isFinite(t1) && t2 >= t1, 'nowMs() is a monotonic high-res clock');

  const tree = {
    id: 'root', tag: 'div', classes: 'page', children: [
      { id: 'nav', tag: 'nav', children: [{ id: 'logo', type: 'text', text: 'Acme <3' }] },
      {
        id: 'main', tag: 'main', children: [
          {
            id: 'hero', tag: 'section', classes: 'hero', children: [
              { id: 'h1', tag: 'h1', children: [{ id: 'title', type: 'text', text: 'Welcome' }] }
            ]
          },
          { id: 'grid', tag: 'div', children: [{ id: 'card1', tag: 'article' }, { id: 'card2', tag: 'article' }] }
        ]
      }
    ]
  };
  const cache = ic.createASTCache(tree);
  ok(cache.total === 10 && cache.root === 'root', 'cache flattens to 10 indexed nodes');
  ok(cache.nodes.nav.parent === 'root' && cache.nodes.title.parent === 'h1',
    'parent pointers recorded for ancestor walks');
  ok(throwsCode(() => ic.createASTCache({ children: [] }), 'bad_input'), 'tree without id throws bad_input');
  ok(throwsCode(() => ic.createASTCache(
    { id: 'r', children: [{ id: 'dup' }, { id: 'dup' }] }), 'bad_input'),
    'duplicate node ids throw bad_input');

  const leaf = ic.compileIncrementalDelta('card1', cache);
  ok(leaf.found === true && eq(leaf.changed, ['card1']), 'leaf edit touches exactly itself');
  ok(leaf.compiled === 1 && leaf.total === 10 && leaf.partial === true,
    '1 of 10 compiled — partial, not a site rebuild');
  ok(Number.isFinite(leaf.dtMs) && leaf.dtMs >= 0 && leaf.dtMs < 50,
    'Δt finite, ≥0 and comfortably inside the sub-10ms preview budget ('
    + leaf.dtMs.toFixed(4) + 'ms)');
  ok(leaf.fragments.card1 === '<article data-node="card1"></article>', 'exact fragment bytes');

  const sub = ic.compileIncrementalDelta('hero', cache);
  ok(eq(sub.changed, ['hero', 'h1', 'title']) && sub.compiled === 3,
    'component edit collects its subtree in document order');
  const whole = ic.compileIncrementalDelta('root', cache);
  ok(whole.compiled === whole.total && whole.partial === false,
    'root edit is the legitimate full compile (partial=false)');
  ok(ic.compileIncrementalDelta('logo', cache).fragments.logo === 'Acme &lt;3',
    'text nodes HTML-escaped in fragments');
  const comp = ic.createASTCache({ id: 'c1', type: 'component', name: 'Pricing' });
  ok(comp && ic.compileIncrementalDelta('c1', comp).fragments.c1.indexOf('<!-- component Pricing -->') === 0,
    'component nodes compile to a marked placeholder');

  ok(throwsCode(() => ic.compileIncrementalDelta('ghost', cache), 'bad_input'),
    'unknown node id throws bad_input (no silent blank preview)');
  ok(throwsCode(() => ic.compileIncrementalDelta('', cache), 'bad_input'), 'empty id throws bad_input');
  ok(throwsCode(() => ic.compileIncrementalDelta('root', null), 'bad_input'), 'null cache throws bad_input');

  const graph = {
    'css:theme': ['styles/theme.css'],
    'html:home': ['pages/home.html', 'css:theme'],
    'html:about': ['pages/about.html', 'css:theme'],
    'html:fresh': ['pages/fresh.html']
  };
  const inv1 = ic.invalidateCacheKeys(graph, ['styles/theme.css']);
  ok(eq(inv1.invalid, ['css:theme', 'html:home', 'html:about']),
    'changed theme.css invalidates its keys AND dependents (key→key propagation)');
  ok(eq(inv1.remaining, ['html:fresh']), 'untouched key survives — no full recompile');
  ok(Number.isFinite(inv1.dtMs) && inv1.dtMs >= 0, 'invalidation reports Δt too');
  const inv2 = ic.invalidateCacheKeys(graph, ['pages/about.html']);
  ok(eq(inv2.invalid, ['html:about']) && inv2.remaining.length === 3,
    'single file change hits exactly one key');
  const inv3 = ic.invalidateCacheKeys(graph, []);
  ok(inv3.invalid.length === 0 && inv3.remaining.length === 4,
    'no changes → nothing invalidated');
  const inv4 = ic.invalidateCacheKeys(graph, 'styles/theme.css');
  ok(inv4.invalid.length === 3, 'changedFiles accepts a bare string');
  const chained = ic.invalidateCacheKeys({ a: ['f.css'], b: ['a'], c: ['b'], d: ['g.css'] }, ['f.css']);
  ok(eq(chained.invalid, ['a', 'b', 'c']), 'propagation walks the full key chain');
  const cyc = ic.invalidateCacheKeys({ a: ['f.css', 'b'], b: ['a'] }, ['f.css']);
  ok(cyc.invalid.length === 2, 'cyclic graph terminates with both keys stale');
  const strDep = ic.invalidateCacheKeys({ k: 'solo.css' }, ['solo.css']);
  ok(eq(strDep.invalid, ['k']), 'string (non-array) dependency accepted');
  ok(throwsCode(() => ic.invalidateCacheKeys(null, ['x']), 'bad_input'), 'null graph throws bad_input');
  ok(throwsCode(() => ic.invalidateCacheKeys('nope', ['x']), 'bad_input'), 'string graph throws bad_input');

  // ==========================================================
  section('3. security-csp — policy synthesis, meta injection, SRI');
  // ==========================================================

  const def = csp.generateStrictCSP();
  ['default-src \'self\'', 'script-src \'self\'', 'style-src \'self\'',
    'img-src \'self\' data: blob:', 'connect-src \'self\'',
    'form-action \'self\'', 'base-uri \'self\'',
    'object-src \'none\'', 'frame-ancestors \'none\'']
    .forEach((d) => ok(def.indexOf(d) > -1, 'default policy has ' + d));
  ok(def.indexOf('unsafe-inline') === -1 && def.indexOf('unsafe-eval') === -1,
    "default policy carries NO 'unsafe-inline'/'unsafe-eval' anywhere");
  ok(/; upgrade-insecure-requests$/.test(def), 'upgrade-insecure-requests on by default');
  ok(csp.generateStrictCSP() === def, 'policy output is deterministic');
  ok(csp.generateStrictCSP({ upgradeInsecureRequests: false }).indexOf('upgrade-insecure-requests') === -1,
    'upgrade-insecure-requests can be opted out');

  const styley = csp.generateStrictCSP({ unsafeInlineStyle: true });
  const styleSeg = styley.split('style-src')[1].split(';')[0];
  const scriptSeg = styley.split('script-src')[1].split(';')[0];
  ok(styleSeg.indexOf('\'unsafe-inline\'') > -1 && scriptSeg.indexOf('\'unsafe-inline\'') === -1,
    "unsafeInlineStyle relaxes ONLY style-src, script-src stays strict");
  ok(csp.generateStrictCSP({ unsafeEval: true }).indexOf('\'unsafe-eval\'') > -1,
    'unsafeEval opt-in appears in script-src');
  ok(csp.generateStrictCSP({ scriptHashes: ['sha384-abc='] }).indexOf('sha384-abc=') > -1,
    'caller script hashes land in script-src');
  ok(csp.generateStrictCSP({ frameAncestors: '\'self\'' }).indexOf('frame-ancestors \'self\'') > -1,
    'frame-ancestors overridable');
  ok(csp.generateStrictCSP({ reportUri: 'https://x.example/csp' }).indexOf('report-uri https://x.example/csp') > -1,
    'report-uri appended when given');
  ok(throwsCode(() => csp.generateStrictCSP({ reportUri: 'javascript:alert(1)' }), 'bad_input'),
    'non-http reportUri throws bad_input');
  ok(throwsCode(() => csp.generateStrictCSP({ scriptSrc: ['plausible.io'] }), 'bad_input'),
    'unquoted origin throws bad_input (silent CSP failure avoided)');
  ok(throwsCode(() => csp.generateStrictCSP({ scriptSrc: ["'self' https://ok.example ", 'bad origin '] }), 'bad_input'),
    'origin with whitespace throws bad_input');

  ['plausible', 'fathom', 'simpleanalytics', 'umami', 'ga'].forEach((name) => {
    const p = csp.generateStrictCSP({ analytics: name });
    ok(p.indexOf('script-src') > -1, 'analytics preset ' + name + ' accepted');
  });
  ok(csp.generateStrictCSP({ analytics: 'fathom' }).indexOf('https://cdn.usefathom.com') > -1,
    'fathom resolves to its CDN origin');
  ['web3forms', 'formspree', 'formtorch', 'netlify'].forEach((name) => {
    ok(csp.generateStrictCSP({ forms: name }).indexOf('form-action') > -1,
      'form preset ' + name + ' accepted');
  });
  ok(csp.generateStrictCSP({ widgets: 'youtube' })
    .indexOf('https://www.youtube-nocookie.com') > -1, 'youtube adds privacy embed frame origin');
  const stripe = csp.generateStrictCSP({ widgets: 'stripe' });
  ok(stripe.indexOf('https://js.stripe.com') > -1 && stripe.indexOf('https://api.stripe.com') > -1,
    'stripe contributes script + connect origins');
  ok(csp.generateStrictCSP({ widgets: 'maps' }).indexOf('https://maps.gstatic.com') > -1,
    'maps contributes img origins');
  ok(throwsCode(() => csp.generateStrictCSP({ analytics: 'matomo' }), 'bad_input'),
    'unknown analytics preset throws bad_input');
  ok(throwsCode(() => csp.generateStrictCSP({ forms: 'typeform' }), 'bad_input'),
    'unknown form preset throws bad_input');
  ok(throwsCode(() => csp.generateStrictCSP({ widgets: 'disqus' }), 'bad_input'),
    'unknown widget preset throws bad_input');

  const h = csp.sha384Hash('hello');
  ok(/^sha384-[A-Za-z0-9+/]{64}$/.test(h), 'sha384Hash: prefix + 64-char base64 = 48-byte digest');
  ok(csp.sha384Hash('hello') !== csp.sha384Hash('hello!'), 'hash is content-sensitive');

  const fixtureHtml = '<!doctype html><html><head><meta charset="utf-8">'
    + '<style>.a{color:red}</style></head><body>'
    + '<script>window.BOOT=1</script>'
    + '<script src="/static/app.js"></script>'
    + '<script src="https://cdn.example/lib.js"></script>'
    + '<link rel="stylesheet" href="/static/main.css">'
    + '<link rel="stylesheet" href="https://cdn.example/lib.css">'
    + '<link rel="preload" as="style" href="/static/main.css">'
    + '</body></html>';
  const appB64 = 'A'.repeat(64);
  const libHex = nodeCrypto.randomBytes(48).toString('hex'); // 96 hex chars
  const out = csp.injectSRIAndCSPHeaders(fixtureHtml, {
    '/static/app.js': appB64,
    'lib.js': csp.sha384Hash('lib-bytes'),
    'lib.css': libHex
  });
  ok((out.html.match(/http-equiv="Content-Security-Policy"/g) || []).length === 1,
    'exactly one CSP meta tag');
  ok(/<head><meta http-equiv="Content-Security-Policy"/.test(out.html),
    'meta injected immediately after <head>');
  ok(out.html.indexOf('integrity="sha384-' + appB64 + '"') > -1,
    'SRI integrity attached to matching external script');
  ok(out.sri.length === 3 && out.sri.every((s) => s.integrity.indexOf('sha384-') === 0),
    'SRI applied to both scripts + stylesheet (3 tags)');
  const cssEntry = out.sri.find((s) => s.url.indexOf('lib.css') > -1);
  ok(cssEntry.integrity === 'sha384-' + libHex, '96-char hex hash accepted as-is (SRI hex form)');
  ok(out.sri.filter((s) => s.url === '/static/main.css').length === 0,
    'tags without a shaHashes key are left untouched');
  ok(out.policy.indexOf(csp.sha384Hash('window.BOOT=1')) > -1,
    'inline script sha384 flows into script-src');
  ok(out.policy.indexOf(csp.sha384Hash('.a{color:red}')) > -1,
    'inline style sha384 flows into style-src');
  ok(out.policy.indexOf('unsafe-inline') === -1,
    'inline code allowed by HASH only — never unsafe-inline');
  ok(out.html.indexOf('rel="preload"') > -1,
    'non-stylesheet link untouched (preload is not an SRI target)');

  const reRun = csp.injectSRIAndCSPHeaders(out.html, { '/static/app.js': appB64 });
  ok((reRun.html.match(/http-equiv="Content-Security-Policy"/g) || []).length === 1,
    'second injection replaces the meta — policies never stack');
  ok((reRun.html.match(/integrity=/g) || []).length === 3,
    'second injection replaces integrity, never duplicates it');
  const preStamped = '<html><head></head><body>'
    + '<script src="/static/app.js" integrity="sha384-OLD"></script></body></html>';
  const stampOut = csp.injectSRIAndCSPHeaders(preStamped, { '/static/app.js': appB64 });
  ok(stampOut.html.indexOf('sha384-OLD') === -1
    && (stampOut.html.match(/integrity=/g) || []).length === 1,
    'existing integrity replaced in place');
  const singleQ = "<html><head><meta http-equiv='Content-Security-Policy' content=\"old\"></head></html>";
  const sq = csp.injectSRIAndCSPHeaders(singleQ, {});
  ok((sq.html.match(/Content-Security-Policy/g) || []).length === 1
    && sq.html.indexOf('content="old"') === -1,
    'single-quoted pre-existing meta replaced too');
  ok(throwsCode(() => csp.injectSRIAndCSPHeaders('<html><body>no head here</body></html>', {}), 'bad_input'),
    'html without head placement throws bad_input');
  ok(throwsCode(() => csp.injectSRIAndCSPHeaders('', {}), 'bad_input'), 'empty html throws bad_input');
  ok(throwsCode(() => csp.injectSRIAndCSPHeaders('<head></head>', ['/array']), 'bad_input'),
    'array shaHashes throws bad_input');
  ok(throwsCode(() => csp.injectSRIAndCSPHeaders('<head></head>', { 'x.js': '' }), 'bad_input'),
    'empty hash value throws bad_input');
  const pref = csp.injectSRIAndCSPHeaders('<head></head><script src="https://a/x.js"></script>',
    { 'https://a/x.js': 'sha384-KEEP' });
  ok(pref.html.indexOf('integrity="sha384-KEEP"') > -1
    && pref.html.indexOf('sha384-sha384') === -1,
    'already-prefixed hash kept verbatim (no double prefix)');

  // ==========================================================
  section('4. cli-engine — flags, exit codes, build report');
  // ==========================================================

  ok(cli.EXIT.OK === 0 && cli.EXIT.BUILD_ERROR === 1 && cli.EXIT.VALIDATION === 2,
    'UNIX exit codes: 0/1/2');

  const pa = cli.parseArgs(['/proj', '--out-dir=out', '--minify', '--parallel=2', '--verbose']);
  ok(pa.errors.length === 0 && pa.flags.projectPath === '/proj'
    && pa.flags.outDir === 'out' && pa.flags.minify === true
    && pa.flags.parallel === 2 && pa.flags.verbose === true,
    'value + boolean flags parse (both = and space forms)');
  ok(cli.parseArgs(['/p', '--out', 'o2']).flags.outDir === 'o2', "--out aliases --out-dir");
  ok(cli.parseArgs(['/p', '--minify=false']).flags.minify === false,
    'boolean negation =false honored');
  ok(cli.parseArgs(['/p', '--parallel=auto']).flags.parallel === 'auto', '--parallel=auto accepted');
  const pb = cli.parseArgs(['/p', '--bogus', '--parallel', 'many', '--config']);
  ok(pb.errors.some((e) => e.indexOf('unknown flag: --bogus') > -1),
    'unknown flag reported');
  ok(pb.errors.some((e) => e.indexOf('--parallel must be') > -1),
    'bad --parallel value reported');
  ok(pb.errors.some((e) => e.indexOf('missing value for --config') > -1),
    'flag missing its value reported');
  ok(cli.parseArgs(['/a', '/b']).errors.some((e) => e.indexOf('unexpected argument') > -1),
    'extra positional reported');
  const help = cli.usage();
  ['--config', '--out-dir', '--minify', '--parallel', '--verbose', 'Exit codes']
    .forEach((s) => ok(help.indexOf(s) > -1, 'usage documents ' + s));

  const dir = tmpDir();
  writeJson(path.join(dir, 'pai-project.json'), {
    pages: SCHEMA.pages.slice(0, 2),
    styles: [{ id: 'main', css: '/* keep-out */\nbody {  color: blue  }' }],
    assets: [{ id: 'logo', data: 'AAA', ext: 'txt' }]
  });
  const outDir = path.join(dir, 'dist');

  const good = await cli.runHeadlessBuild(dir,
    { minify: true, parallel: 2, outDir });
  ok(good.code === cli.EXIT.OK, 'successful build exits 0');
  ok(good.statsPath && fs.existsSync(good.statsPath), 'build-stats.json written');
  const report = JSON.parse(fs.readFileSync(good.statsPath, 'utf8'));
  ok(report.ok === true && report.exitCode === 0, 'report records ok + exit 0');
  ok(eq(report.counts, { pages: 2, styles: 1, assets: 1 }),
    'report counts pages/styles/assets');
  ok(report.workers === 2 && report.completionRate === 1,
    'report carries worker count + completion rate');
  ok(Number.isFinite(report.durationMs) && report.durationMs >= 0
    && Number.isFinite(Date.parse(report.startedAt))
    && Number.isFinite(Date.parse(report.finishedAt)),
    'report has machine-readable timestamps + duration');
  ok(fs.existsSync(path.join(outDir, 'a.html'))
    && fs.readFileSync(path.join(outDir, 'a.html'), 'utf8').indexOf('<title>A&lt;b&gt;</title>') > -1,
    'page files written to outDir');
  ok(fs.readFileSync(path.join(outDir, 'main.css'), 'utf8') === 'body{color:blue}',
    '--minify produced minified css on disk');
  ok(fs.readFileSync(path.join(outDir, 'logo.txt'), 'utf8') === 'AAA',
    'asset written with its ext');

  const noMin = await cli.runHeadlessBuild(dir,
    { parallel: 1, outDir: path.join(dir, 'dist-nominify') });
  ok(noMin.code === cli.EXIT.OK && noMin.stats.counts.styles === 0
    && !fs.existsSync(path.join(dir, 'dist-nominify', 'main.css')),
    'without --minify no css job runs and no css file ships');

  writeJson(path.join(dir, 'cfg.json'), { outDir: 'from-config', minify: true });
  const withCfg = await cli.runHeadlessBuild(dir, { config: 'cfg.json', parallel: 1 });
  ok(withCfg.code === cli.EXIT.OK
    && withCfg.stats.outDir === path.join(dir, 'from-config'),
    '--config outDir honored (resolved against project base)');
  ok(fs.existsSync(path.join(dir, 'from-config', 'main.css'))
    && fs.readFileSync(path.join(dir, 'from-config', 'main.css'), 'utf8').indexOf('/*') === -1,
    'config file minify:true takes effect');
  const flagWins = await cli.runHeadlessBuild(dir,
    { config: 'cfg.json', outDir: path.join(dir, 'from-flag'), parallel: 1 });
  ok(flagWins.stats.outDir === path.join(dir, 'from-flag'),
    'explicit flag beats config file');

  writeJson(path.join(dir, 'badcfg.json'), '{not json');
  const badCfg = await cli.runHeadlessBuild(dir, { config: 'badcfg.json' });
  ok(badCfg.code === cli.EXIT.VALIDATION, 'unparseable --config → exit 2');
  writeJson(path.join(dir, 'badpcfg.json'), { parallel: 'lots' });
  const badPar = await cli.runHeadlessBuild(dir, { config: 'badpcfg.json' });
  ok(badPar.code === cli.EXIT.VALIDATION, 'bad parallel from config → exit 2');
  const progPar = await cli.runHeadlessBuild(dir, { parallel: 0, outDir });
  ok(progPar.code === cli.EXIT.VALIDATION, 'programmatic parallel:0 → exit 2');

  // validation matrix → 2, and NO stats file appears
  const missing = await cli.runHeadlessBuild(path.join(dir, 'ghost.json'), {});
  ok(missing.code === cli.EXIT.VALIDATION && missing.statsPath === null,
    'missing project → exit 2, no stats file');
  writeJson(path.join(dir, 'broken.json'), '{oops');
  ok((await cli.runHeadlessBuild(path.join(dir, 'broken.json'), {})).code === cli.EXIT.VALIDATION,
    'unparseable project → exit 2');
  writeJson(path.join(dir, 'empty.json'), { pages: [] });
  ok((await cli.runHeadlessBuild(path.join(dir, 'empty.json'), {})).code === cli.EXIT.VALIDATION,
    'empty pages → exit 2');
  writeJson(path.join(dir, 'dup.json'), { pages: [{ id: 'x' }, { id: 'x' }] });
  ok((await cli.runHeadlessBuild(path.join(dir, 'dup.json'), {})).code === cli.EXIT.VALIDATION,
    'duplicate page id → exit 2');
  writeJson(path.join(dir, 'noid.json'), { pages: [{ title: 'no id' }] });
  ok((await cli.runHeadlessBuild(path.join(dir, 'noid.json'), {})).code === cli.EXIT.VALIDATION,
    'page without id → exit 2');
  const emptyProj = tmpDir();
  ok((await cli.runHeadlessBuild(emptyProj, {})).code === cli.EXIT.VALIDATION,
    'directory without pai-project.json → exit 2');

  // build failure → 1 WITH ok:false stats
  const boom = await cli.runHeadlessBuild(dir,
    { outDir: path.join(dir, 'dist-boom') },
    { executeBuild: () => { throw new Error('boom'); } });
  ok(boom.code === cli.EXIT.BUILD_ERROR, 'thrown build → exit 1');
  ok(boom.statsPath && fs.existsSync(boom.statsPath), 'build-stats.json written on FAILURE');
  const boomReport = JSON.parse(fs.readFileSync(boom.statsPath, 'utf8'));
  ok(boomReport.ok === false && boomReport.exitCode === 1
    && boomReport.errors[0] === 'boom', 'failure report: ok:false + error text');

  // verbose gating
  const quietLogs = [];
  await cli.runHeadlessBuild(dir,
    { outDir: path.join(dir, 'dist-q') },
    { log: (m) => quietLogs.push(m) });
  ok(quietLogs.length === 1 && quietLogs[0].indexOf('build ok') === 0,
    'quiet run logs only the success line');
  const loudLogs = [];
  await cli.runHeadlessBuild(dir,
    { outDir: path.join(dir, 'dist-v'), verbose: true },
    { log: (m) => loudLogs.push(m) });
  ok(loudLogs.some((l) => l.indexOf('[progress]') === 0),
    '--verbose emits per-job progress lines');

  // main(): usage + code plumbing
  const helpLogs = [];
  ok(await cli.main(['--help'], { log: (m) => helpLogs.push(m) }) === cli.EXIT.OK
    && helpLogs.join('\n').indexOf('Usage:') > -1, '--help → exit 0 + usage text');
  const errLogs = [];
  ok(await cli.main(['--weird'], { log: (m) => errLogs.push(m) }) === cli.EXIT.VALIDATION
    && errLogs.some((l) => l.indexOf('unknown flag') > -1), 'main unknown flag → 2');
  ok(await cli.main([], { log: () => {} }) === cli.EXIT.VALIDATION,
    'main without project path → 2');
  ok(await cli.main([dir, '--minify', '--parallel=1',
    '--out-dir=' + path.join(dir, 'dist-main')], { log: () => {} }) === cli.EXIT.OK,
    'main full success → 0');
  ok(await cli.main([dir, '--out-dir=' + path.join(dir, 'dist-main2')],
    { log: () => {}, executeBuild: () => { throw new Error('ci exploded'); } }) === cli.EXIT.BUILD_ERROR,
    'main build failure → 1');

  // hostile page id cannot escape outDir
  const evil = tmpDir();
  writeJson(path.join(evil, 'pai-project.json'), {
    pages: [{ id: '../escape', title: 'evil', html: '<p>x</p>' }],
    styles: [], assets: []
  });
  const evilOut = path.join(evil, 'dist');
  const evilRun = await cli.runHeadlessBuild(evil, { outDir: evilOut, parallel: 1 });
  ok(evilRun.code === cli.EXIT.OK && fs.existsSync(path.join(evilOut, '..-escape.html')),
    "page id '../escape' written INSIDE outDir under a sanitized name");
  ok(!fs.existsSync(path.join(evil, 'escape.html')),
    'nothing landed outside outDir (path traversal blocked)');
};

run()
  .then(() => {
    console.log('\n' + (total - fails) + '/' + total + ' checks passed'
      + (fails ? ' — ' + fails + ' FAILED' : ' — ALL PASS'));
    tmpDirs.forEach((d) => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
    process.exit(fails ? 1 : 0);
  })
  .catch((e) => {
    console.error('\nRUNNER ERROR: ' + (e && e.stack || e));
    tmpDirs.forEach((d) => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e2) { /* ignore */ } });
    process.exit(1);
  });
