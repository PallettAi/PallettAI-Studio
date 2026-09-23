'use strict';

/*
  ============================================================
  backend-system-smoke — vault, assets, IPC primitives, profiler
  ------------------------------------------------------------
  Runs standalone under Node with no test framework:

      node scripts/backend-system-smoke.js

  Everything here touches a real temporary directory under the repo
  and cleans up after itself, because the claims being tested are
  about the filesystem: an atomic save that leaves no temp file, a
  snapshot rotation that never deletes what it just wrote, a cancelled
  build that leaves nothing behind. A mocked filesystem would prove
  none of them.
  ============================================================
*/

const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const Vault = require(path.join(ROOT, 'modules', 'project-vault.js'));
const Assets = require(path.join(ROOT, 'modules', 'asset-pipeline.js'));
const Ipc = require(path.join(ROOT, 'modules', 'ipc-router.js'));
const Profiler = require(path.join(ROOT, 'modules', 'compiler-profiler.js'));

let passed = 0;
let failed = 0;

function ok(label, condition, detail) {
  if (condition) {
    passed++;
    console.log('  \u2713 ' + label);
  } else {
    failed++;
    console.log('  \u2717 ' + label + (detail ? '\n      ' + detail : ''));
  }
}

function eq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(label, a === e, 'expected ' + e + '\n      actual   ' + a);
}

function section(title) {
  console.log('\n' + title);
}

const WORK = path.join(ROOT, '.pallettai-smoke');
const VAULT = path.join(WORK, 'vault');

function clean() {
  try { fs.rmSync(WORK, { recursive: true, force: true }); } catch (e) { /* nothing to clean */ }
}

function project(name, extra) {
  return Object.assign({
    schemaVersion: 2,
    name: name,
    chosen_archetype: 'editorial',
    design_tokens: { '--brand-color': 'oklch(0.65 0.24 260)' },
    site: { sections: [{ id: 's1', type: 'hero', layout_variant: 'default' }] }
  }, extra || {});
}

(async () => {
  clean();

  // ------------------------------------------------------------------
  section('1. Vault — validation before writing');
  // ------------------------------------------------------------------

  {
    eq('a valid project passes', Vault.validateProject(project('Ok')).ok, true);
    const missing = Vault.validateProject({ schemaVersion: 2, name: 'No sections' });
    eq('a project with no sections collection is refused', missing.ok, false);
    ok('and says which collection is missing', /sections collection/.test(missing.errors.join(' ')), JSON.stringify(missing.errors));
    eq('invalid JSON is refused', Vault.validateProject('{not json').ok, false);
    eq('a non-object is refused', Vault.validateProject('[]').ok, false);
  }

  {
    eq('a traversal id is refused', Vault.safeProjectId('../evil').ok, false);
    eq('a separator in an id is refused', Vault.safeProjectId('a/b').ok, false);
    eq('a dot id is refused', Vault.safeProjectId('..').ok, false);
    eq('a normal id is accepted', Vault.safeProjectId('proj-1').ok, true);
  }

  // ------------------------------------------------------------------
  section('2. Vault — atomic saves');
  // ------------------------------------------------------------------

  {
    const target = path.join(WORK, 'site.pallettai.json');
    const res = Vault.saveProjectAtomic(target, project('First'));
    eq('a save succeeds', res.ok, true);
    ok('bytes were written', res.bytes > 0);
    eq('no temp file is left beside it', fs.existsSync(target + Vault.TMP_SUFFIX), false);
    const read = JSON.parse(fs.readFileSync(target, 'utf8'));
    eq('the file contains the project', read.name, 'First');
    eq('and is formatted JSON, not a minified blob', read.site.sections.length, 1);
  }

  {
    // The important case: a refused save must not damage the file that
    // is already there.
    const target = path.join(WORK, 'guard.pallettai.json');
    Vault.saveProjectAtomic(target, project('Good'));
    const before = fs.readFileSync(target, 'utf8');
    const bad = Vault.saveProjectAtomic(target, { schemaVersion: 2, name: 'Broken' });
    eq('an invalid save is refused', bad.ok, false);
    eq('the existing file is untouched', fs.readFileSync(target, 'utf8'), before);
    eq('and no temp file is left behind', fs.existsSync(target + Vault.TMP_SUFFIX), false);
  }

  {
    // Restoring a refused save must also leave the destination intact.
    const target = path.join(WORK, 'nested', 'deep', 'site.pallettai.json');
    const res = Vault.saveProjectAtomic(target, project('Nested'));
    eq('saving creates missing directories', res.ok, true);
    eq('and the file is readable', fs.existsSync(target), true);
  }

  // ------------------------------------------------------------------
  section('3. Vault — snapshots and rotation');
  // ------------------------------------------------------------------

  {
    const pid = 'rotation-test';
    let last = null;
    let prunedTotal = 0;
    for (let i = 0; i < 12; i++) {
      const res = Vault.createSnapshot(pid, project('Version ' + i), { dir: VAULT, keep: 10 });
      if (!res.ok) { ok('snapshot ' + i + ' failed', false, JSON.stringify(res.errors)); break; }
      prunedTotal += res.pruned.length;
      last = res;
    }
    const list = Vault.listSnapshots(pid, { dir: VAULT });
    eq('the history is capped at 10', list.length, 10);
    // Twelve snapshots, a limit of ten: exactly the two oldest go, one per
    // save once the cap is reached.
    eq('exactly the two oldest were rotated out', prunedTotal, 2);
    ok('the snapshot just written survived its own rotation', list.some((s) => s.id === last.id), last.id);

    const latest = Vault.restoreSnapshot(pid, 'latest', { dir: VAULT });
    eq('latest restores', latest.ok, true);
    eq('and is the newest version', latest.project.name, 'Version 11');
    // Rotation must drop the *oldest*; keeping the newest ten means the
    // oldest survivor is version 2.
    eq('the oldest survivor is the tenth-newest overall',
      Vault.restoreSnapshot(pid, list[list.length - 1].id, { dir: VAULT }).project.name, 'Version 2');
    ok('a restored project is a real project', Array.isArray(latest.project.site.sections));
  }

  {
    // Two snapshots in quick succession must be two files: a snapshot
    // history with overwritten entries is not a history.
    const pid = 'same-instant';
    const a = Vault.createSnapshot(pid, project('A'), { dir: VAULT });
    const b = Vault.createSnapshot(pid, project('B'), { dir: VAULT });
    ok('consecutive snapshots get distinct ids', a.id !== b.id, a.id + ' vs ' + b.id);
    eq('and both exist', Vault.listSnapshots(pid, { dir: VAULT }).length, 2);
  }

  {
    const pid = 'restore-into';
    Vault.createSnapshot(pid, project('Snap one'), { dir: VAULT });
    Vault.createSnapshot(pid, project('Snap two'), { dir: VAULT });
    const target = path.join(WORK, 'restore-target.pallettai.json');
    Vault.saveProjectAtomic(target, project('Current'));
    const res = Vault.restoreInto(target, pid, 'latest', { dir: VAULT });
    eq('restoring into a file succeeds', res.ok, true);
    eq('the destination now holds the snapshot', JSON.parse(fs.readFileSync(target, 'utf8')).name, 'Snap two');
  }

  {
    // A truncated snapshot must be reported, not handed over as a project.
    const pid = 'corrupt';
    const made = Vault.createSnapshot(pid, project('Fine'), { dir: VAULT });
    const entry = Vault.listSnapshots(pid, { dir: VAULT })[0];
    fs.writeFileSync(entry.file, '{"schemaVersion":2,');
    const res = Vault.restoreSnapshot(pid, 'latest', { dir: VAULT });
    eq('a truncated snapshot is refused', res.ok, false);
    ok('with a legible reason', /valid JSON/.test(res.error), res.error);
  }

  {
    const missing = Vault.restoreSnapshot('never-snapshotted', 'latest', { dir: VAULT });
    eq('a project with no history is reported, not crashed', missing.ok, false);
  }

  {
    const info = Vault.vaultInfo(['rotation-test', 'same-instant'], { dir: VAULT });
    eq('the vault reports no orphaned temp files', info.tempLeftBehind.length, 0, JSON.stringify(info.tempLeftBehind));
    ok('and reports its size', info.bytes > 0, JSON.stringify(info));
  }

  // ------------------------------------------------------------------
  section('4. Asset pipeline — SVG');
  // ------------------------------------------------------------------

  {
    const messy = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!-- exported by a design tool -->',
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" viewBox="0 0 24 24" inkscape:version="1.1">',
      '  <metadata>editor junk</metadata>',
      '  <defs><clipPath id="clip"><rect width="4" height="4"/></clipPath></defs>',
      // A hidden element that something actually points at, and one that
      // nothing does. The reference is what decides whether it is safe to
      // delete, so the fixture has to contain a real one.
      '  <g style="display:none" id="hiddenReferenced"><rect width="2" height="2"/></g>',
      '  <g style="display:none"><rect width="9" height="9"/></g>',
      '  <use href="#hiddenReferenced" x="0" y="0"/>',
      '  <path d="M0 0 L10 10" fill="none" data-name="line"/>',
      '  <g clip-path="url(#clip)"><circle cx="2" cy="2" r="2"/></g>',
      '  <text x="0" y="10">  two  spaces  </text>',
      '</svg>'
    ].join('\n');

    const res = Assets.optimizeInlineSVGs(messy);
    eq('the SVG optimiser succeeds', res.ok, true);
    ok('it reduces the size', res.stats.saved > 0, JSON.stringify(res.stats));
    console.log('      SVG: ' + res.stats.before + ' -> ' + res.stats.after + ' bytes (' + res.stats.percent + '% saved)');
    ok('the XML prolog is removed', res.svg.indexOf('<?xml') === -1);
    ok('comments are removed', res.svg.indexOf('design tool') === -1);
    ok('metadata is removed', res.svg.indexOf('metadata') === -1);
    ok('editor attributes are removed', res.svg.indexOf('inkscape:version') === -1 && res.svg.indexOf('data-name') === -1);
    ok('an unused namespace is removed', res.svg.indexOf('xmlns:xlink') === -1);
    ok('viewBox is preserved exactly', res.svg.indexOf('viewBox="0 0 24 24"') !== -1);
    ok('a referenced hidden element is kept, id and contents alike',
      res.svg.indexOf('id="hiddenReferenced"') !== -1 && res.svg.indexOf('width="2"') !== -1, res.svg);
    ok('and the use that points at it survives', res.svg.indexOf('href="#hiddenReferenced"') !== -1);
    ok('an unreferenced hidden element is dropped', res.svg.indexOf('width="9"') === -1);
    eq('the path count is unchanged', (messy.match(/<path\b/g) || []).length, (res.svg.match(/<path\b/g) || []).length);
    ok('defs survive', res.svg.indexOf('<defs>') !== -1);
    ok('clip-path references survive', res.svg.indexOf('url(#clip)') !== -1);
    ok('text whitespace is preserved', res.svg.indexOf('>  two  spaces  <') !== -1, res.svg.slice(-80));
    // A guard against over-eager stripping: the drawing must still parse.
    ok('the result is still well-formed enough to use', /^<svg\b/.test(res.svg) && /<\/svg>$/.test(res.svg), res.svg.slice(0, 40));
  }

  {
    eq('a non-SVG input is refused rather than edited', Assets.optimizeInlineSVGs('<div>not an svg</div>').ok, false);
    eq('an empty input is refused', Assets.optimizeInlineSVGs('').ok, false);
  }

  // ------------------------------------------------------------------
  section('5. Asset pipeline — srcset and fonts');
  // ------------------------------------------------------------------

  {
    const m = Assets.generateSrcsetManifest('/img/hero.jpg', [1440, 640, 1024, 640]);
    eq('the manifest succeeds', m.ok, true);
    eq('widths are sorted and de-duplicated', m.widths, [640, 1024, 1440]);
    ok('descriptors use the w form', m.descriptors.every((d) => /^\d+w$/.test(d.descriptor)));
    ok('a size attribute is produced', typeof m.sizes === 'string' && m.sizes.length > 0);
    ok('and it warns when no URL convention was supplied', m.notes.some((n) => /no URL convention/.test(n)), JSON.stringify(m.notes));

    const t = Assets.generateSrcsetManifest('/img/hero.jpg', [640, 1024], { template: '/cdn/hero-{w}.webp' });
    eq('a template produces real URLs', t.descriptors.map((d) => d.url), ['/cdn/hero-640.webp', '/cdn/hero-1024.webp']);
    eq('and an html attribute', t.html, '/cdn/hero-640.webp 640w, /cdn/hero-1024.webp 1024w');

    const capped = Assets.generateSrcsetManifest('/img/small.jpg', [640, 1024, 1440], { sourceWidth: 900 });
    eq('up-scaling is refused', capped.widths, [640]);
    ok('and the drop is explained', capped.notes.some((n) => /larger than/.test(n)), JSON.stringify(capped.notes));

    const fn = Assets.generateSrcsetManifest('/i.jpg', [640], { urlFor: (w) => '/x-' + w + '.jpg', aspectRatio: 2 });
    eq('urlFor is used', fn.descriptors[0].url, '/x-640.jpg');
    eq('and a height is derived from the aspect ratio', fn.descriptors[0].height, 320);
  }

  {
    const fonts = [
      { family: 'Inlined', url: 'data:font/woff2;base64,AAA' },
      { family: 'Inter', url: 'https://fonts.googleapis.com/css2?family=Inter&display=swap' },
      { family: 'Own', url: '/assets/own.woff2' },
      { family: 'Own again', url: '/assets/own.woff2' },
      { family: 'Blocked', url: 'https://cdn.other.test/x.woff2' },
      { family: 'Not a font', url: '/assets/logo.png' }
    ];
    const res = Assets.generateFontPreloadDirectives(fonts, { fontSrc: "'self' https://fonts.gstatic.com" });
    eq('exactly one tag survives', res.count, 1);
    ok('the tag is a font preload', /rel="preload"/.test(res.html) && /as="font"/.test(res.html));
    ok('it carries crossorigin (fonts are always CORS fetches)', /crossorigin/.test(res.html));
    ok('it declares the type', /type="font\/woff2"/.test(res.html));
    ok('an inlined data URI is skipped as unfetchable', res.skipped.some((s) => /data URI/.test(s.reason)));
    ok('the Google stylesheet is skipped with a reason', res.skipped.some((s) => /user-agent dependent/.test(s.reason)));
    ok('a duplicate is skipped', res.skipped.some((s) => s.reason === 'duplicate'));
    ok('a disallowed origin is skipped', res.skipped.some((s) => /CSP/.test(s.reason)));
    ok('a non-font file is skipped', res.skipped.some((s) => /not a recognised font format/.test(s.reason)));
    ok('no skip happens silently', res.skipped.every((s) => !!s.reason));
  }

  // ------------------------------------------------------------------
  section('6. IPC router — cancellation and cleanup');
  // ------------------------------------------------------------------

  {
    const token = Ipc.createCancellationToken('test');
    let first = 0;
    let second = 0;
    token.onCancel(() => { first++; });
    token.onCancel(() => { throw new Error('this cleanup is broken'); });
    token.onCancel(() => { second++; });
    eq('the token starts uncancelled', token.cancelled, false);
    eq('cancelling reports the transition', token.cancel('user asked'), true);
    eq('cancelling twice is idempotent', token.cancel('again'), false);
    eq('every handler runs, even after one throws', [first, second], [1, 1]);
    eq('the reason is recorded', token.reason, 'user asked');
    ok('throwIfCancelled throws a cancellation, not an error string', (() => {
      try { token.throwIfCancelled(); return false; } catch (e) { return e.cancelled === true; }
    })());
    eq('a handler registered after cancellation still runs', (() => { let n = 0; token.onCancel(() => n++); return n; })(), 1);
  }

  {
    // The claim under test: a cancelled build leaves no temporary files.
    const token = Ipc.createCancellationToken('export');
    const registry = Ipc.createTempRegistry(token);
    const files = ['a.tmp', 'b.tmp', 'c.tmp'].map((n) => {
      const p = path.join(WORK, 'tmp-' + n);
      fs.writeFileSync(p, 'partial');
      return registry.track(p);
    });
    eq('files are tracked', registry.size(), 3);
    ok('and exist on disk before the abort', files.every((f) => fs.existsSync(f)));
    token.cancel('user pressed cancel');
    eq('the abort removed them', registry.size(), 0);
    eq('nothing is left on disk', files.filter((f) => fs.existsSync(f)).length, 0);
  }

  {
    const token = Ipc.createCancellationToken('run');
    const order = [];
    const steps = [1, 2, 3, 4, 5].map((n) => ({
      name: 'step ' + n,
      run: () => { order.push(n); if (n === 3) token.cancel('stop here'); return n * 2; }
    }));
    const progress = Ipc.createProgressReporter();
    const res = await Ipc.runCancellable(steps, token, progress, { cleanup: () => order.push('cleanup') });
    eq('the run reports cancellation', res.cancelled, true);
    eq('it stopped at the boundary after the cancelling step', res.completed, 3);
    eq('later steps never ran', order.filter((x) => typeof x === 'number'), [1, 2, 3]);
    eq('cleanup ran anyway', order[order.length - 1], 'cleanup');
    eq('a cancellation is not an error', res.errors.length, 0);
  }

  {
    const token = Ipc.createCancellationToken('throw');
    const steps = [
      { name: 'one', run: () => 1 },
      { name: 'two', run: () => { token.throwIfCancelled(); } },
      { name: 'three', run: () => 3 }
    ];
    token.cancel('pre-cancelled');
    const res = await Ipc.runCancellable(steps, token, null, {});
    eq('a pre-cancelled run does nothing', res.completed, 0);
    eq('and says so', res.cancelled, true);

    const token2 = Ipc.createCancellationToken('mid');
    const res2 = await Ipc.runCancellable([
      { name: 'ok', run: () => 'fine' },
      { name: 'boom', run: () => { throw new Error('real failure'); } },
      { name: 'never', run: () => 'no' }
    ], token2, null, {});
    eq('a genuine failure is an error, not a cancellation', res2.errors.length, 1);
    eq('and stops the run', res2.completed, 1);
    eq('with the message preserved', res2.errors[0].error, 'real failure');
  }

  {
    const progress = Ipc.createProgressReporter();
    progress.stage('minify');
    progress.step(1, 4);
    progress.step(2, 4);
    // A regressing count must not move the percentage backwards.
    progress.step(1, 4);
    progress.step(4, 4);
    const events = progress.events();
    ok('progress events carry the channel name', events.every((e) => e.channel === 'compile-progress'));
    ok('a stage event names the stage', events[0].kind === 'stage' && events[0].stage === 'minify');
    eq('percentages are monotonically non-decreasing', events.map((e) => e.percent), events.map((e) => e.percent).slice().sort((a, b) => a - b));
    eq('the final percentage is 100', progress.percent(), 100);
    ok('events carry timing', events[0].at > 0 && typeof events[0].elapsedMs === 'number');
  }

  // ------------------------------------------------------------------
  section('7. IPC router — the bridge fails closed');
  // ------------------------------------------------------------------

  {
    const registered = new Map();
    const fakeIpc = {
      handle: (ch, fn) => registered.set(ch, fn),
      on: (ch, fn) => registered.set(ch, fn),
      removeHandler: (ch) => registered.delete(ch),
      removeAllListeners: (ch) => registered.delete(ch)
    };
    const trusted = { id: 'trusted-web-contents' };
    const bridge = Ipc.createIpcBridge(fakeIpc, { allowedWebContents: [trusted] });

    ok('a channel off the allowlist is refused at registration', (() => {
      try { bridge.handle('rm -rf', () => {}); return false; } catch (e) { return /allowlist/.test(e.message); }
    })());
    eq('registering a listed channel works', bridge.handle('compile-start', () => 'built').channel, 'compile-start');
    ok('registering it twice is refused', (() => {
      try { bridge.handle('compile-start', () => {}); return false; } catch (e) { return /already registered/.test(e.message); }
    })());

    const dispatch = registered.get('compile-start');
    const untrusted = await dispatch({ sender: { id: 'someone-else' } });
    eq('an untrusted sender is rejected', untrusted.ok, false);
    eq('and told nothing useful', untrusted.error, 'unauthorised');
    eq('the rejection is recorded for the shell', bridge.rejections().length, 1);

    const good = await dispatch({ sender: trusted });
    eq('a trusted sender is served', good.ok, true);
    eq('with its value', good.value, 'built');

    bridge.handle('fetch-status', () => { throw new Error('upstream down'); });
    const thrown = await registered.get('fetch-status')({ sender: trusted });
    eq('a handler error becomes a structured failure', thrown.ok, false);
    eq('with the message intact', thrown.error, 'upstream down');

    eq('dispose removes everything', bridge.dispose().sort(), ['compile-start', 'fetch-status']);
    eq('and leaves no handlers', bridge.channels().length, 0);
  }

  {
    // The default must be refusal: a bridge with no declared policy is
    // a bridge that cannot check anything.
    const fakeIpc = { handle: () => {}, on: () => {}, removeHandler: () => {}, removeAllListeners: () => {} };
    const bridge = Ipc.createIpcBridge(fakeIpc, {});
    eq('with no sender policy, nothing is trusted', bridge.isTrusted({ sender: {} }), false);
  }

  // ------------------------------------------------------------------
  section('8. Profiler — timing and bottlenecks');
  // ------------------------------------------------------------------

  {
    eq('the clock is the high-resolution one under Node', Profiler.clock(), 'hrtime');

    Profiler.reset();
    Profiler.configure({ enabled: true, thresholdMs: 50 });
    Profiler.startBuild('smoke-build');

    Profiler.timeStage('parse-input', () => { let n = 0; for (let i = 0; i < 1000; i++) n += i; return n; });
    Profiler.timeStage('minify-css', () => { let n = 0; for (let i = 0; i < 5000; i++) n += i; return n; });

    // A stage that genuinely takes too long, so the bottleneck check is
    // exercised rather than assumed.
    const until = Date.now() + 60;
    Profiler.timeStage('transform-slow', () => { while (Date.now() < until) { /* busy */ } });

    const report = Profiler.generateBuildProfileReport();
    eq('the report is healthy', report.ok, true, JSON.stringify(report.findings));
    ok('it has a total', report.totalMs > 0, JSON.stringify(report.totalMs));
    eq('it records every stage', report.stageCount, 3);
    ok('the slow stage is flagged', report.bottlenecks.some((b) => b.stage === 'transform-slow'), JSON.stringify(report.bottlenecks));
    ok('and the fast one is not', !report.bottlenecks.some((b) => b.stage === 'parse-input'), JSON.stringify(report.bottlenecks));
    const slow = report.bottlenecks.find((b) => b.stage === 'transform-slow');
    ok('the overshoot is quantified', slow.overByMs > 0, JSON.stringify(slow));
    ok('and it carries actionable advice', typeof slow.advice === 'string' && slow.advice.length > 10, slow.advice);
    eq('phases are grouped by kind', report.phases.map((p) => p.phase).sort(), ['minification', 'parsing', 'transformation']);
    ok('the summary is one line', typeof Profiler.summary(report) === 'string' && /ms total/.test(Profiler.summary(report)));
  }

  {
    // Nesting: a parent must not look slow because of its children.
    Profiler.reset();
    Profiler.startBuild('nested');
    Profiler.startProfilerStage('build-page');
    const until = Date.now() + 30;
    Profiler.timeStage('minify-html', () => { while (Date.now() < until) { /* busy */ } });
    Profiler.endProfilerStage('build-page');

    const report = Profiler.generateBuildProfileReport();
    const parent = report.stages.find((s) => s.stage === 'build-page');
    const child = report.stages.find((s) => s.stage === 'minify-html');
    ok('the child is recorded', !!child && child.ms > 0, JSON.stringify(child));
    ok('the parent self time excludes the child', parent.selfMs < parent.ms, 'parent ' + parent.selfMs + ' of ' + parent.ms);
    eq('and the child is one level deeper', child.depth > parent.depth, true);
  }

  {
    // Broken instrumentation must be reported, not hidden.
    Profiler.reset();
    Profiler.endProfilerStage('never-started');
    const report = Profiler.generateBuildProfileReport();
    eq('an unmatched end is reported', report.findings.length, 1);
    eq('and the report is not ok', report.ok, false);
    eq('the kind is named', report.findings[0].kind, 'unmatched-end');
  }

  {
    Profiler.reset();
    ok('timeStage closes the stage even when the work throws', (() => {
      try { Profiler.timeStage('explodes', () => { throw new Error('inner'); }); } catch (e) { /* expected */ }
      const report = Profiler.generateBuildProfileReport();
      return report.stageCount === 1 && report.unclosed.length === 0;
    })());
  }

  {
    Profiler.reset();
    eq('classification maps a minify stage', Profiler.classify('minify-js'), 'minification');
    eq('classification maps a write stage', Profiler.classify('write-zip'), 'disk-io');
    eq('classification maps a parse stage', Profiler.classify('parse-project'), 'parsing');
    eq('classification maps a transform stage', Profiler.classify('render-sections'), 'transformation');
    eq('reset clears the report', Profiler.generateBuildProfileReport().stageCount, 0);
  }

  // ------------------------------------------------------------------
  clean();

  console.log('\n' + (failed === 0 ? 'ALL PASSED' : 'FAILED') + ' — ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  clean();
  console.error('\nsuite threw: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
