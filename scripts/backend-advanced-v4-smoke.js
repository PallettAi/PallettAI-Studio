'use strict';

/*
  ============================================================
  backend-advanced-v4-smoke — SRI, deltas, workers, headless build
  ------------------------------------------------------------
  Runs standalone under Node with no test framework:

      node scripts/backend-advanced-v4-smoke.js

  The worker section spawns real threads and the CLI section spawns a
  real subprocess, because those are the parts where a mock would hide
  the failure that matters: a pool that never terminates keeps the app
  from quitting, and a CLI that exits 0 while writing nothing breaks a
  CI job silently.
  ============================================================
*/

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SRI = require(path.join(ROOT, 'modules', 'security-sri.js'));
const Delta = require(path.join(ROOT, 'modules', 'delta-exporter.js'));
const Pool = require(path.join(ROOT, 'modules', 'worker-pool.js'));
const CLI = require(path.join(ROOT, 'modules', 'cli-runner.js'));

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

const WORK = path.join(ROOT, '.v4-smoke');
const clean = () => { try { fs.rmSync(WORK, { recursive: true, force: true }); } catch (e) { /* nothing */ } };

function sampleProject() {
  return {
    schemaVersion: 2,
    name: 'CLI Bench',
    chosen_archetype: 'editorial',
    design_tokens: { '--brand-color': 'oklch(0.65 0.24 260)' },
    site: {
      name: 'CLI Bench',
      palette: 'midnight',
      font: 'sans',
      sections: [
        { id: 's1', type: 'hero', headline: 'Headless build' },
        { id: 's2', type: 'faq' }
      ],
      pages: [{ id: 'home', name: 'Home', sections: [{ id: 's1', type: 'hero', headline: 'Headless build' }, { id: 's2', type: 'faq' }] }]
    }
  };
}

(async () => {
  clean();

  // ------------------------------------------------------------------
  section('1. SRI — digests');
  // ------------------------------------------------------------------

  {
    const body = 'console.log("x");';
    const res = SRI.generateSRIHash(body, 'sha384');
    eq('hashing succeeds', res.ok, true);
    eq('the algorithm is reported', res.algorithm, 'sha384');
    ok('the digest is prefixed', res.digest.indexOf('sha384-') === 0, res.digest);
    // Independent recomputation: the attribute format is what the browser
    // checks, so it is verified against Node directly rather than trusted.
    const expected = 'sha384-' + crypto.createHash('sha384').update(Buffer.from(body, 'utf8')).digest('base64');
    eq('the digest matches Node crypto', res.digest, expected);
    eq('sha256 is available', SRI.generateSRIHash('a', 'sha256').algorithm, 'sha256');
    eq('512 is available', SRI.generateSRIHash('a', 'sha512').algorithm, 'sha512');
    eq('an unknown algorithm is refused', SRI.generateSRIHash('a', 'md5').ok, false);
    ok('with a reason', /unsupported algorithm/.test(SRI.generateSRIHash('a', 'md5').error));

    // Hashing bytes, not text: a multi-byte character would differ.
    const unicode = '— em dash';
    const viaBuffer = SRI.generateSRIHash(Buffer.from(unicode, 'utf8'));
    const viaString = SRI.generateSRIHash(unicode);
    eq('a Buffer and its string hash identically', viaBuffer.digest, viaString.digest);
    eq('byte length is reported, not character count', viaBuffer.bytes, Buffer.byteLength(unicode, 'utf8'));
    ok('and it is more than the character count', viaBuffer.bytes > unicode.length, viaBuffer.bytes + ' vs ' + unicode.length);
  }

  // ------------------------------------------------------------------
  section('2. SRI — tag injection');
  // ------------------------------------------------------------------

  {
    const html = [
      '<html><head>',
      '<link rel="stylesheet" href="/styles.css">',
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">',
      '<link rel="stylesheet" href="/unhashed.css">',
      '</head><body>',
      '<script src="/app.js"></script>',
      '<script>var inline = 1;</script>',
      '</body></html>'
    ].join('\n');

    const map = {
      '/styles.css': SRI.generateSRIHash('body{}', 'sha384').digest,
      '/app.js': SRI.generateSRIHash('var a = 1;', 'sha384').digest
    };

    const res = SRI.injectSRIAttributes(html, map);
    eq('two tags are injected', res.injected.length, 2);
    // Checked by presence, not by attribute order: the writer appends
    // crossorigin before integrity, and asserting the order I imagined
    // rather than the order it produces is how this test failed first time.
    const linkTag = (res.html.match(/<link[^>]*styles\.css[^>]*>/) || [''])[0];
    ok('the stylesheet gains an integrity attribute', /integrity="sha384-/.test(linkTag), linkTag);
    ok('and crossorigin, without which SRI does not apply', /crossorigin="anonymous"/.test(linkTag), linkTag);
    const scriptTag = (res.html.match(/<script[^>]*app\.js[^>]*>/) || [''])[0];
    ok('the script tag gains both too', /integrity="sha384-/.test(scriptTag) && /crossorigin="anonymous"/.test(scriptTag), scriptTag);
    ok('the Google Fonts stylesheet is left alone', !/fonts\.googleapis[^>]*integrity/.test(res.html));
    ok('and the skip is explained', res.skipped.some((s) => /user agent/.test(s.reason)), JSON.stringify(res.skipped));
    ok('a tag with no hash is left alone, never given a wrong one', !/unhashed\.css" integrity/.test(res.html));
    ok('and that skip is explained too', res.skipped.some((s) => s.url === '/unhashed.css' && /no hash supplied/.test(s.reason)));
    ok('the inline script is untouched by injection', /<script>var inline = 1;<\/script>/.test(res.html));
  }

  {
    // An existing integrity that disagrees is evidence, not an obstacle.
    const html = '<script src="/app.js" integrity="sha384-OLDDIGEST"></script>';
    const map = { '/app.js': SRI.generateSRIHash('new content').digest };
    const res = SRI.injectSRIAttributes(html, map);
    eq('a mismatch is reported', res.mismatched.length, 1);
    eq('with the value that was found', res.mismatched[0].found, 'sha384-OLDDIGEST');
    ok('and the existing attribute is not silently overwritten', res.html.indexOf('sha384-OLDDIGEST') !== -1, res.html);
  }

  {
    const html = [
      '<script>var a = 1;</script>',
      '<script type="application/ld+json">{"@type":"WebSite"}</script>',
      '<button onclick="doThing()">go</button>'
    ].join('');
    const inline = SRI.hashInlineScripts(html, 'sha256');
    eq('only executable inline scripts are hashed', inline.count, 1);
    ok('the JSON-LD island is not hashed as script', inline.scripts.some((s) => /ld\+json/.test(s.type) && s.hashed === false), JSON.stringify(inline.scripts));
    ok('the hash is a real digest', /^sha256-[A-Za-z0-9+/=]+$/.test(inline.hashes[0]), inline.hashes[0]);
    eq('an inline handler is counted', inline.unhashable.handlers, 1);
    ok('and warned about, because a hash cannot cover it', /cannot be covered by a hash/.test(inline.unhashable.note));
  }

  // ------------------------------------------------------------------
  section('3. SRI — strict CSP');
  // ------------------------------------------------------------------

  {
    const inline = SRI.hashInlineScripts('<script>var a=1;</script><script>var b=2;</script>', 'sha256');
    const res = SRI.buildStrictCSPHeader(inline.hashes, { script: [], style: ['https://fonts.googleapis.com'] }, { inlineScripts: true });
    ok('the policy is a single header value', typeof res.policy === 'string' && res.policy.indexOf('; ') !== -1);
    ok('it defaults to deny', /default-src 'none'/.test(res.policy), res.policy);
    ok('every inline script hash is present', inline.hashes.every((h) => res.policy.indexOf("'" + h + "'") !== -1), res.policy);
    const scriptSrc = res.policy.match(/script-src ([^;]*)/)[1];
    ok('script-src does not allow unsafe-inline', scriptSrc.indexOf("'unsafe-inline'") === -1, scriptSrc);
    const styleSrc = res.policy.match(/style-src ([^;]*)/)[1];
    ok('style-src does keep unsafe-inline, because the pages inline their CSS', styleSrc.indexOf("'unsafe-inline'") !== -1, styleSrc);
    ok('object-src is locked down', /object-src 'none'/.test(res.policy));
    ok('frame-ancestors is locked down', /frame-ancestors 'none'/.test(res.policy));
    eq('no warnings for a fully hashed document', res.warnings.length, 0, JSON.stringify(res.warnings));
  }

  {
    const res = SRI.buildStrictCSPHeader([], {}, { inlineScripts: true, unhashable: { handlers: 2, javascriptUrls: 0, note: 'n' } });
    ok('an unhashed inline script produces a warning', res.warnings.some((w) => /blocks those scripts/.test(w)), JSON.stringify(res.warnings));
    ok('and inline handlers produce one', res.warnings.some((w) => w === 'n'), JSON.stringify(res.warnings));
  }

  // ------------------------------------------------------------------
  section('4. Delta — comparison');
  // ------------------------------------------------------------------

  const base = [
    { name: 'index.html', content: '<html>A</html>' },
    { name: 'about.html', content: '<html>B</html>' },
    { name: 'styles.css', content: 'body{color:red}' }
  ];

  {
    const delta = await Delta.computeDeltaManifest(null, base);
    eq('with no previous manifest, the delta succeeds', delta.ok, true);
    eq('every file is new', delta.counts.added, 3);
    eq('nothing is changed', delta.counts.changed, 0);
    eq('nothing is removed', delta.counts.removed, 0);
    eq('it is a full payload', delta.payloadBytes, delta.fullBytes);
    eq('reduction is zero', delta.reduction, 0);
    ok('and the report says there was nothing to compare against', delta.hasPrevious === false);
  }

  {
    const previous = await Delta.computeDeltaManifest(null, base);
    const current = [
      { name: 'index.html', content: '<html>A edited</html>' },   // changed
      { name: 'styles.css', content: 'body{color:red}' },        // unchanged
      { name: 'contact.html', content: '<html>C</html>' }        // added, 'about.html' removed
    ];
    const delta = await Delta.computeDeltaManifest(previous, current);
    eq('one file is changed', delta.counts.changed, 1);
    eq('and it is the edited page', delta.changed[0].name, 'index.html');
    eq('one file is added', delta.counts.added, 1);
    eq('one is unchanged', delta.counts.unchanged, 1);
    // The stale-page guard: a delta that forgets removals leaves dead pages live.
    eq('the removed page is reported', delta.counts.removed, 1);
    eq('and named', delta.removed[0].name, 'about.html');
    ok('the payload is far smaller than the site', delta.payloadBytes < delta.fullBytes, JSON.stringify({ p: delta.payloadBytes, f: delta.fullBytes }));
    ok('the reduction is a percentage', delta.reduction > 0, delta.reduction);
    ok('the summary reads as a sentence', /changed, 1 added, 1 removed/.test(Delta.summarise(delta)), Delta.summarise(delta));
  }

  {
    const previous = await Delta.computeDeltaManifest(null, base);
    const delta = await Delta.computeDeltaManifest(previous, base);
    eq('an unchanged site produces an empty delta', delta.empty, true);
    eq('with nothing to ship', delta.payloadBytes, 0);
    eq('and no removals', delta.counts.removed, 0);
  }

  {
    // A caller may hand over a compiled manifest rather than a delta.
    const previous = await Delta.computeDeltaManifest(null, base);
    const delta = await Delta.computeDeltaManifest({ files: previous.manifest }, [
      { name: 'index.html', content: '<html>A</html>' },
      { name: 'about.html', content: '<html>B edited</html>' },
      { name: 'styles.css', content: 'body{color:red}' }
    ]);
    eq('a manifest-shaped previous build is understood', delta.hasPrevious, true);
    eq('and only the edited file is changed', delta.counts.changed, 1);
    eq('the changed file is identified', delta.changed[0].name, 'about.html');
  }

  // ------------------------------------------------------------------
  section('5. Delta — archive and history');
  // ------------------------------------------------------------------

  {
    const previous = await Delta.computeDeltaManifest(null, base);
    const delta = await Delta.computeDeltaManifest(previous, [
      { name: 'index.html', content: '<html>A edited</html>' },
      { name: 'styles.css', content: 'body{color:red}' },
      { name: 'contact.html', content: '<html>C</html>' }
    ]);

    const zipPath = path.join(WORK, 'delta.zip');
    const res = await Delta.generateDeltaZip(delta, zipPath);
    eq('the archive is written', res.ok, true);
    ok('to disk', fs.existsSync(zipPath), zipPath);
    const bytes = fs.readFileSync(zipPath);
    ok('it is a real zip', bytes.slice(0, 2).toString() === 'PK', bytes.slice(0, 4).toString('hex'));
    eq('it carries only the payload plus metadata', res.shipped, 2);
    ok('the payload files are in it', bytes.includes('index.html') && bytes.includes('contact.html'));
    // The unchanged file's *content* must not be shipped. Its name does appear,
    // in the removal list — which is the point: an archive cannot delete
    // anything, so the deletions travel as data.
    ok('the unchanged file is not in it', !bytes.includes('<html>B</html>'), 'the unchanged page content was shipped');
    ok('while its name appears only as a removal to apply', bytes.includes('about.html'));
    // A zip cannot express deletion, so the removals have to travel as data.
    ok('the metadata entry is present', bytes.includes(Delta.DELTA_FILE));
    ok('the metadata names the file to delete', bytes.includes('"about.html"'));
    ok('the metadata records what it applies over', /"appliesOver"/.test(res.metadata && JSON.stringify(res.metadata)));
    ok('and warns the deployer about the deletions', res.warnings.some((w) => /must be deleted/.test(w)), JSON.stringify(res.warnings));
    ok('it reports how much was saved', res.savedBytes >= 0 && typeof res.savedBytes === 'number');

    const history = Delta.readDeltaHistory({ dir: WORK });
    eq('nothing is logged yet', history.entries.length, 0);

    const logged = Delta.recordDelta({ kind: 'delta', base: delta.base, manifestHash: delta.manifestHash, counts: delta.counts, removed: delta.removed.map((r) => r.name), bytes: res.bytes, reduction: delta.reduction, path: zipPath }, { dir: WORK });
    eq('the release is logged', logged.ok, true);
    const after = Delta.readDeltaHistory({ dir: WORK });
    eq('the history has one entry', after.entries.length, 1);
    eq('and it records what was removed', after.entries[0].removed, ['about.html']);
    ok('and the manifest it applies over', !!after.entries[0].base, after.entries[0].base);
  }

  {
    const previous = await Delta.computeDeltaManifest(null, base);
    const delta = await Delta.computeDeltaManifest(previous, base);
    const res = await Delta.generateDeltaZip(delta, path.join(WORK, 'empty.zip'));
    eq('an empty delta is not written as an archive', res.skipped, true);
    eq('and nothing is created', fs.existsSync(path.join(WORK, 'empty.zip')), false);
    ok('with a reason', /already current/.test(res.reason), res.reason);
  }

  {
    const run = await Delta.runDeltaExport(null, base, path.join(WORK, 'full.zip'), { dir: WORK });
    eq('the one-call export works', run.ok, true);
    eq('it is a full payload when there is no history', run.delta.counts.added, 3);
    ok('and it is logged', run.history.ok === true && Delta.readDeltaHistory({ dir: WORK }).entries.length >= 1);
  }

  // ------------------------------------------------------------------
  section('6. Worker pool');
  // ------------------------------------------------------------------

  {
    const info = Pool.initWorkerPool(2);
    eq('the pool starts', info.ok, true, JSON.stringify(info));
    eq('with the requested size', info.size, 2);
    ok('and it reports the task types it can run', info.taskTypes.length >= 4, JSON.stringify(info.taskTypes));

    const hashed = await Pool.dispatchTask('hash', { content: 'hello', algorithm: 'sha256' });
    eq('a hash task succeeds', hashed.ok, true, JSON.stringify(hashed));
    eq('and agrees with Node crypto', hashed.result.digest, crypto.createHash('sha256').update('hello').digest('hex'));

    const css = await Pool.dispatchTask('minify-css', { content: 'body {\n  color: red;\n}\n' });
    eq('a minify task succeeds', css.ok, true, JSON.stringify(css));
    ok('and returns smaller content', css.result.content.length < 20, css.result.content);
    ok('with the saving reported', css.result.stats.saved > 0, JSON.stringify(css.result.stats));

    const unknown = await Pool.dispatchTask('no-such-task', {});
    eq('an unknown task type is refused', unknown.ok, false);
    ok('and the available types are listed', Array.isArray(unknown.available) && unknown.available.length > 0, JSON.stringify(unknown.available));

    // A task that fails is an answer, not a broken pool. The distinction
    // that matters: `ok` describes the dispatch, and the task's own verdict
    // travels in its result — so a caller can tell "the pool broke" from
    // "the input was wrong" without parsing a message.
    const bad = await Pool.dispatchTask('optimize-svg', { content: 'not an svg' });
    eq('the dispatch itself succeeds', bad.ok, true, JSON.stringify(bad));
    eq('and carries the task outcome', bad.result.ok, false);
    ok('with the failure explained', /not an SVG/.test(bad.result.error), bad.result.error);

    const batch = await Pool.dispatchBatch([
      { taskType: 'hash', payload: { content: 'a' } },
      { taskType: 'hash', payload: { content: 'b' } },
      { taskType: 'minify-js', payload: { content: '// c\nvar x = 1;\n' } },
      { taskType: 'hash', payload: { content: 'd' } }
    ], { concurrency: 2 });
    eq('the batch reports success', batch.ok, true);
    eq('every job returns', batch.count, 4);
    // Order matters: shuffled results would silently reorder page sections.
    eq('results keep their input order', batch.results[1].result.digest, crypto.createHash('sha256').update('b').digest('hex'));
    ok('and the minify job ran too', batch.results[2].result.content.length > 0);

    const stats = Pool.poolStats();
    ok('the pool reports its work', stats.completed >= 6, JSON.stringify(stats));
    eq('it is marked active', stats.active, true);
    ok('with threads alive', stats.live === 2, JSON.stringify({ live: stats.live }));

    const down = await Pool.terminateWorkerPool();
    eq('the pool terminates', down.ok, true);
    eq('and says how many threads it stopped', down.terminated, 2);
    eq('leaving none alive', Pool.poolStats().live, 0);
    eq('and inactive', Pool.poolStats().active, false);

    // With no pool, work still happens and the result says it was inline.
    const inline = await Pool.dispatchTask('hash', { content: 'z' });
    eq('a task after shutdown still completes', inline.ok, true);
    eq('and is marked inline', inline.inline, true);
    eq('with the same answer', inline.result.digest, crypto.createHash('sha256').update('z').digest('hex'));

    const refused = await Pool.dispatchTask('hash', { content: 'z' }, { inlineFallback: false });
    eq('a caller can demand a real worker', refused.ok, false);
  }

  // ------------------------------------------------------------------
  section('7. CLI — flags');
  // ------------------------------------------------------------------

  {
    const args = CLI.parseArgs(['--input', 'p.pallettai', '--out', './dist', '--environment', 'development']);
    eq('input is parsed', args.input, 'p.pallettai');
    eq('out is parsed', args.out, './dist');
    eq('the environment is parsed', args.environment, 'development');
    eq('development turns minification off by default', args.minify, false);
    eq('and reports no errors', args.errors.length, 0);

    const prod = CLI.parseArgs(['--input', 'p.pallettai']);
    eq('production minifies by default', prod.minify, true);
    eq('and defaults the output dir', prod.out, 'dist');

    const explicit = CLI.parseArgs(['--input', 'p', '--environment', 'development', '--minify']);
    eq('an explicit --minify beats the environment default', explicit.minify, true);

    const off = CLI.parseArgs(['--input', 'p', '--minify=false']);
    eq('--minify=false is honoured', off.minify, false);

    eq('--export-zip is a flag', CLI.parseArgs(['--input', 'p', '--export-zip']).exportZip, true);
    eq('--clean-cache is a flag', CLI.parseArgs(['--input', 'p', '--clean-cache']).cleanCache, true);
    eq('--input=value form works', CLI.parseArgs(['--input=x.pallettai']).input, 'x.pallettai');
    eq('a missing value is an error', CLI.parseArgs(['--input']).errors.length > 0, true);
    eq('an unknown flag is an error', CLI.parseArgs(['--nope']).errors.length > 0, true);
    eq('a bad environment is an error', CLI.parseArgs(['--input', 'p', '--environment', 'staging']).errors.length > 0, true);
    ok('usage mentions the flags', /--export-zip/.test(CLI.usage()));
  }

  // ------------------------------------------------------------------
  section('8. CLI — a real headless build');
  // ------------------------------------------------------------------

  {
    const projectFile = path.join(WORK, 'project.pallettai.json');
    fs.mkdirSync(WORK, { recursive: true });
    fs.writeFileSync(projectFile, JSON.stringify(sampleProject(), null, 2));
    const outDir = path.join(WORK, 'dist');
    const quiet = CLI.createLogger({ quiet: true });

    const res = await CLI.runHeadlessBuild(projectFile, { out: outDir, minify: true, logger: quiet });
    eq('the build succeeds', res.ok, true, JSON.stringify(res.errors));
    eq('and exits zero', res.exitCode, 0);
    eq('a project was validated', res.validation.ok, true);
    ok('pages were compiled', res.pages >= 1, String(res.pages));
    ok('index.html was written', fs.existsSync(path.join(outDir, 'index.html')));
    const html = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
    ok('and is not empty', html.length > 200, String(html.length));
    ok('it is real markup', /<html/i.test(html) && /<\/html>/i.test(html));
    ok('it is minified', html.indexOf('\n<!--') === -1);
    ok('a manifest was written', fs.existsSync(path.join(outDir, 'manifest.json')));
    ok('the manifest lists files', Object.keys(JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8')).files || {}).length >= 1);
    ok('the security posture was computed after minification', res.security && res.security.hardened >= 1, JSON.stringify(res.security));
    ok('a profile was produced', res.profile && res.profile.totalMs > 0, JSON.stringify(res.profile && res.profile.totalMs));
    ok('the log is captured for CI', Array.isArray(res.logs) && res.logs.length > 0, String(res.logs && res.logs.length));
    eq('no errors were recorded', res.errors.length, 0, JSON.stringify(res.errors));
  }

  {
    const projectFile = path.join(WORK, 'project-zip.pallettai.json');
    fs.writeFileSync(projectFile, JSON.stringify(sampleProject(), null, 2));
    const outDir = path.join(WORK, 'dist-zip');
    // An explicit cache dir, so clearing the cache in a test never touches
    // the app's own `.build-cache` — the default belongs to real builds.
    const res = await CLI.runHeadlessBuild(projectFile, { out: outDir, exportZip: true, cleanCache: true, cacheDir: path.join(WORK, 'cache'), minify: true, logger: CLI.createLogger({ quiet: true }) });
    eq('a zipped build succeeds', res.ok, true, JSON.stringify(res.errors));
    ok('a zip was written', res.zip && fs.existsSync(res.zip.path), JSON.stringify(res.zip));
    ok('and it is a real archive', fs.readFileSync(res.zip.path).slice(0, 2).toString() === 'PK');
  }

  {
    const outDir = path.join(WORK, 'dist-dev');
    const res = await CLI.runHeadlessBuild(path.join(WORK, 'project.pallettai.json'), { out: outDir, minify: false, environment: 'development', logger: CLI.createLogger({ quiet: true }) });
    eq('a development build succeeds', res.ok, true);
    const html = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
    // Unminified output is left alone — the flag has to actually do something.
    const minified = fs.readFileSync(path.join(WORK, 'dist', 'index.html'), 'utf8');
    ok('an unminified build is larger than the minified one', html.length > minified.length, html.length + ' vs ' + minified.length);
  }

  {
    // Failure paths must fail, and must not leave output behind.
    const badFile = path.join(WORK, 'bad.pallettai.json');
    fs.writeFileSync(badFile, JSON.stringify({ schemaVersion: 2, name: 'No sections' }));
    const res = await CLI.runHeadlessBuild(badFile, { out: path.join(WORK, 'dist-bad'), logger: CLI.createLogger({ quiet: true }) });
    eq('an invalid project fails', res.ok, false);
    // Exit 2, not 1: the input is unusable, so a CI job should fix the
    // project rather than retry the build. Exit 1 is reserved for a build
    // that broke with valid input. See `EXIT` in modules/cli-runner.js.
    eq('with exit code 2 — the input is wrong, not the build', res.exitCode, 2);
    eq('and that code is named, not a magic number', CLI.EXIT.INVALID_INPUT, 2);
    ok('and explains why', res.errors.length > 0 && /sections|valid/.test(res.errors.join(' ')), JSON.stringify(res.errors));

    const missing = await CLI.runHeadlessBuild(path.join(WORK, 'nope.json'), { out: path.join(WORK, 'dist-none'), logger: CLI.createLogger({ quiet: true }) });
    eq('a missing input file fails', missing.ok, false);
    eq('with exit code 2 as well — nothing was attempted', missing.exitCode, 2);

    const garbage = path.join(WORK, 'garbage.pallettai.json');
    fs.writeFileSync(garbage, '{not json');
    const bad = await CLI.runHeadlessBuild(garbage, { out: path.join(WORK, 'dist-garbage'), logger: CLI.createLogger({ quiet: true }) });
    eq('unparseable input fails', bad.ok, false);
    eq('with exit code 2', bad.exitCode, 2);
    ok('naming the problem', /JSON/.test(bad.errors.join(' ')), JSON.stringify(bad.errors));
  }

  {
    // The entry point itself: the exit code a CI job actually reads.
    const script = path.join(ROOT, 'modules', 'cli-runner.js');
    let status = 0;
    let output = '';
    try {
      output = execFileSync(process.execPath, [script, '--input', path.join(WORK, 'project.pallettai.json'), '--out', path.join(WORK, 'dist-cli'), '--export-zip'], { encoding: 'utf8', env: Object.assign({}, process.env, { NO_COLOR: '1' }) });
    } catch (e) {
      status = e.status || 1;
      output = String(e.stdout || '') + String(e.stderr || '');
    }
    eq('the CLI process exits 0 on success', status, 0, output.slice(-400));
    ok('and prints a success line', /build finished/.test(output), output.slice(-300));
    ok('and its output exists', fs.existsSync(path.join(WORK, 'dist-cli', 'index.html')));

    let failStatus = 0;
    try {
      execFileSync(process.execPath, [script, '--input', path.join(WORK, 'bad.pallettai.json'), '--out', path.join(WORK, 'x')], { encoding: 'utf8', env: Object.assign({}, process.env, { NO_COLOR: '1' }) });
    } catch (e) {
      failStatus = e.status || 1;
    }
    // Exit 2, not 1: an unusable INPUT is a different outcome from a build
    // that broke with valid input, so a CI job can tell them apart. See EXIT
    // in modules/cli-runner.js.
    eq('the CLI process exits 2 on a bad project (unusable input)', failStatus, 2);

    let helpStatus = 0;
    let helpOut = '';
    try {
      helpOut = execFileSync(process.execPath, [script, '--help'], { encoding: 'utf8', env: Object.assign({}, process.env, { NO_COLOR: '1' }) });
    } catch (e) {
      helpStatus = e.status || 1;
    }
    eq('--help exits 0', helpStatus, 0);
    ok('and prints usage', /headless build/.test(helpOut), helpOut.slice(0, 120));
  }

  clean();

  console.log('\n' + (failed === 0 ? 'ALL PASSED' : 'FAILED') + ' — ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed === 0 ? 0 : 1);
})().catch(async (e) => {
  try { await Pool.terminateWorkerPool(); } catch (err) { /* already down */ }
  clean();
  console.error('\nsuite threw: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
