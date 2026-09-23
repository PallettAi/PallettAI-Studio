'use strict';

/*
  ============================================================
  CLIRunner — build a site without opening the app
  ------------------------------------------------------------
  Everything needed to produce a static export already exists as
  Node-loadable modules; what was missing was an entry point. This is
  that entry point, and its job is to run the same pipeline the Studio
  runs, in the same order, so a CI build and a hand export cannot
  disagree:

      node modules/cli-runner.js --input project.pallettai --out ./dist

  Two facts about how this app builds shape the implementation.

  The builder is a renderer script. `modules/builder.js` is a classic
  script that reads globals (`DB`, `Images`, `Focus`, `Concierge` …),
  so a headless build has to provide those globals before requiring
  it. That shim is not a workaround bolted on here — it is the same
  one the test suites use, which means a CLI build and a suite build
  exercise the same code path rather than two subtly different ones.

  Ordering is load-bearing, twice over. The CSP is built from hashes of
  the inline scripts *as served*, so minification must happen before
  the policy is computed or the policy describes code that no longer
  exists and blocks the site it was meant to protect. And the manifest
  is computed from the bytes actually written, so it is built last.

  Ordering is load-bearing, twice over. The CSP is built from hashes of
  the inline scripts *as served*, so minification must happen before
  the policy is computed or the policy describes code that no longer
  exists and blocks the site it was meant to protect. And the manifest
  is computed from the bytes actually written, so it is built last.

  Exit codes are three, not two, because a CI job acts differently on
  each:

      0  the build succeeded
      2  the INPUT is unusable — bad flags, a bad config file, a missing
         or unparseable project, or a project that fails validation.
         Fix the input; retrying changes nothing.
      1  the input was fine and the BUILD failed — compilation threw, a
         write failed, the builder could not be loaded. This one may be
         a real defect, so it is kept apart from "your project is wrong".

  A build that cannot produce output must not exit 0 — a CI job that
  "succeeds" while writing nothing is worse than one that fails loudly.

  `--config` reads a JSON file of the same option names; an explicit
  flag always outranks the file, so a CI script can override one value
  without restating twenty. `--parallel` compiles once and minifies the
  pages across worker threads, which is where the seconds are (the
  transform costs ~200x the compilation; see `modules/build-pipeline.js`).
  ============================================================
*/

const fs = require('fs');
const path = require('path');

const Migration = require(path.join(__dirname, 'migration.js'));
const Vault = require(path.join(__dirname, 'project-vault.js'));
const Minifier = require(path.join(__dirname, 'minifier.js'));
const SRI = require(path.join(__dirname, 'security-sri.js'));
const Profiler = require(path.join(__dirname, 'compiler-profiler.js'));
let Cache = null;
try { Cache = require(path.join(__dirname, 'compiler-cache.js')); } catch (e) { Cache = null; }
let Manifest = null;
try { Manifest = require(path.join(__dirname, '..', 'data', 'manifest.js')); } catch (e) { Manifest = null; }
let ZIP = null;
try { ZIP = require(path.join(__dirname, 'zip.js')); } catch (e) { ZIP = null; }
let Pipeline = null;
try { Pipeline = require(path.join(__dirname, 'build-pipeline.js')); } catch (e) { Pipeline = null; }
// The pool whose tasks call the REAL minifier. `build-pipeline.js` is used
// for its sizing judgement, not for page rendering: its `runTask` page kind
// emits a standalone template rather than the real builder's document, so a
// pipeline export driven through it would ship the wrong HTML.
let Pool = null;
try { Pool = require(path.join(__dirname, 'worker-pool.js')); } catch (e) { Pool = null; }

/*
  The exit codes, named. A caller reading `EXIT.INVALID_INPUT` in a test
  cannot mistake it for a status that means "something broke".
*/
const EXIT = { OK: 0, BUILD_FAILED: 1, INVALID_INPUT: 2 };

let APP_VERSION = null;
try { APP_VERSION = require(path.join(__dirname, '..', 'package.json')).version || null; } catch (e) { APP_VERSION = null; }

// ---- console ---------------------------------------------------------

const COLOR = (() => {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return !!(process.stdout && process.stdout.isTTY);
})();

const paint = (code) => (text) => (COLOR ? '\u001b[' + code + 'm' + text + '\u001b[0m' : String(text));
const red = paint('31');
const green = paint('32');
const yellow = paint('33');
const cyan = paint('36');
const dim = paint('2');
const bold = paint('1');

/*
  A logger that can be silenced and captured, so the smoke suite can
  assert what the CLI said without scraping a terminal.
*/
function createLogger(opts) {
  const o = opts || {};
  const lines = [];
  const write = (prefix, text, sink) => {
    const line = prefix + ' ' + text;
    lines.push(line.replace(/\u001b\[\d+m/g, ''));
    if (!o.quiet) (sink || console.log)(line);
  };
  return {
    lines: () => lines.slice(),
    step: (text) => write(cyan('>'), text),
    info: (text) => write(dim('-'), text),
    success: (text) => write(green('OK'), text),
    warn: (text) => write(yellow('WARN'), text),
    error: (text) => write(red('FAIL'), text),
    raw: (text) => write('', text)
  };
}

// ---- argument parsing ------------------------------------------------

const FLAGS = {
  '--input': 'input',
  '--out': 'out',
  '--out-dir': 'out',          // alias: the brief's spelling, same option
  '--config': 'config',
  '--environment': 'environment',
  '--minify': 'minify',
  '--clean-cache': 'cleanCache',
  '--export-zip': 'exportZip',
  '--parallel': 'parallel',
  '--stats': 'stats',
  '--verbose': 'verbose',
  '--quiet': 'quiet',
  '--help': 'help'
};

// Flags that take no value. Kept as a set so adding one is a one-word
// change rather than a third `||` in a condition.
// `parallel` is deliberately absent: it is the one flag that takes an
// OPTIONAL value (`--parallel=4`), so it is handled before this list.
const BOOLEAN_FLAGS = ['minify', 'cleanCache', 'exportZip', 'stats', 'verbose', 'quiet', 'help'];

function parseArgs(argv) {
  const args = Array.isArray(argv) ? argv.slice() : [];
  const opts = {
    input: '', out: 'dist', config: '', environment: 'production',
    minify: true, cleanCache: false, exportZip: false, parallel: false,
    stats: true, verbose: false, quiet: false, help: false,
    workers: undefined, explicit: {}, errors: []
  };

  for (let i = 0; i < args.length; i++) {
    const raw = args[i];
    if (!raw) continue;
    const eq = raw.indexOf('=');
    const name = eq === -1 ? raw : raw.slice(0, eq);
    const inlineValue = eq === -1 ? null : raw.slice(eq + 1);
    const key = FLAGS[name];

    if (!key) { opts.errors.push('unknown flag: ' + name); continue; }
    opts.explicit[key] = true;

    // `--parallel` first, because its value is optional: `--parallel`
    // alone must mean "yes, on the default worker count", not "needs a
    // value". `--parallel=6` picks the count; `--parallel=false` is off.
    if (key === 'parallel') {
      if (inlineValue !== null && /^(0|false|no|off)$/i.test(inlineValue)) { opts.parallel = false; continue; }
      opts.parallel = true;
      if (inlineValue !== null && !/^(1|true|yes|on|auto)$/i.test(inlineValue)) opts.workers = inlineValue;
      continue;
    }
    if (BOOLEAN_FLAGS.indexOf(key) !== -1) {
      opts[key] = inlineValue === null ? true : !/^(0|false|no|off)$/i.test(inlineValue);
      continue;
    }
    const value = inlineValue !== null ? inlineValue : args[++i];
    if (value === undefined || value === null || value === '') { opts.errors.push(name + ' needs a value'); continue; }
    opts[key] = String(value);
  }

  // Production implies minified output; development implies the reverse,
  // but an explicit --minify always wins over the environment default.
  if (opts.explicit.minify !== true) opts.minify = opts.environment !== 'development';
  if (opts.environment !== 'production' && opts.environment !== 'development') {
    opts.errors.push('--environment must be production or development');
  }
  return opts;
}

function usage() {
  return [
    'PallettAI Studio — headless build',
    '',
    '  node modules/cli-runner.js --input project.pallettai --out ./dist [flags]',
    '',
    '  --input <file>         project file to build (required)',
    '  --config <file>        JSON file of these options; an explicit flag wins',
    '  --out <dir>            output directory (default ./dist)',
    '  --out-dir <dir>        alias for --out',
    '  --environment <env>    production | development (default production)',
    '  --minify[=false]       minify HTML, CSS and JS (default: on in production)',
    '  --parallel[=<n>|auto]  minify pages across worker threads (where the time is)',
    '  --clean-cache          clear the incremental build cache before building',
    '  --export-zip           also write a zip of the finished site',
    '  --stats[=false]        write build-stats.json (default: on)',
    '  --verbose              per-stage detail, including the build telemetry',
    '  --quiet                only errors',
    '  --help                 this text',
    '',
    '  Exit codes:',
    '    0  the build succeeded',
    '    2  the input is unusable (bad flags/config, missing or invalid project)',
    '    1  the input was fine and the build failed'
  ].join('\n');
}

/*
  A JSON file of the option names above. Read, never executed: a CI
  config is data, and a build config that can run code is a build
  config that can do anything.
*/
function loadConfig(filePath) {
  const file = String(filePath == null ? '' : filePath);
  if (!file) return { ok: true, config: {}, path: '' };
  let raw = null;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    return { ok: false, config: {}, path: file, error: 'cannot read config ' + file + ': ' + (e && e.message ? e.message : e) };
  }
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, config: {}, path: file, error: 'config ' + file + ' is not valid JSON: ' + (e && e.message ? e.message : e) };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, config: {}, path: file, error: 'config ' + file + ' must be a JSON object' };
  }
  return { ok: true, config: parsed, path: file };
}

// Keys a config file may set. An allow-list, so a stray key is ignored
// rather than becoming an option nothing reads.
const CONFIG_KEYS = ['input', 'out', 'environment', 'minify', 'cleanCache', 'exportZip', 'parallel', 'stats', 'verbose', 'quiet', 'workers', 'cacheDir'];
const BOOLEAN_KEYS = ['minify', 'cleanCache', 'exportZip', 'parallel', 'stats', 'verbose', 'quiet'];

/*
  Parse the command line, then let a config file fill in whatever was
  not passed as a flag. The order matters and is the whole point: a CI
  script overrides one value for one job without restating the file.
*/
function resolveOptions(argv) {
  const opts = parseArgs(argv);
  if (!opts.config) return opts;

  const loaded = loadConfig(opts.config);
  if (!loaded.ok) { opts.errors.push(loaded.error); return opts; }

  CONFIG_KEYS.forEach((key) => {
    if (opts.explicit[key] === true) return;                       // the flag wins
    if (!Object.prototype.hasOwnProperty.call(loaded.config, key)) return;
    opts[key] = BOOLEAN_KEYS.indexOf(key) !== -1 ? !!loaded.config[key] : loaded.config[key];
  });

  // Re-derive the production default only when NEITHER the flags nor the
  // config mentioned minify, so a config that sets `environment` to
  // development gets development defaults rather than production ones.
  if (opts.explicit.minify !== true && !Object.prototype.hasOwnProperty.call(loaded.config, 'minify')) {
    opts.minify = opts.environment !== 'development';
  }
  if (opts.environment !== 'production' && opts.environment !== 'development') {
    opts.errors.push('environment must be production or development');
  }
  opts.configPath = loaded.path;
  opts.errors = Array.from(new Set(opts.errors));
  return opts;
}

// ---- the headless builder harness ------------------------------------

/*
  The builder's globals. Loaded lazily and defensively: a CLI that
  cannot load the builder should say which piece is missing rather
  than throw a bare MODULE_NOT_FOUND at a CI log.
*/
function loadBuilder(missing) {
  const need = [
    ['DB', 'data/db.js'], ['ONLINE', 'data/online.js'], ['Review', 'data/review.js'],
    ['Images', 'data/images.js'], ['Focus', 'data/focus.js'], ['OgCard', 'data/ogcard.js'],
    ['Concierge', 'data/concierge.js']
  ];
  need.forEach(([name, rel]) => {
    try {
      global[name] = require(path.join(__dirname, '..', rel));
    } catch (e) {
      if (missing) missing.push(rel);
    }
  });
  try {
    return require(path.join(__dirname, 'builder.js'));
  } catch (e) {
    if (missing) missing.push('modules/builder.js (' + (e && e.message) + ')');
    return null;
  }
}

function pageFileName(page, index, Builder) {
  const name = String((page && (page.name || page.id || page.slug)) || '').trim();
  const slug = Builder && typeof Builder.slugify === 'function' ? Builder.slugify(name) : name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  if (!slug || index === 0 || slug === 'home' || slug === 'index') return index === 0 ? 'index.html' : (slug || 'page-' + (index + 1)) + '.html';
  return slug + '.html';
}

/*
  Fan the page minification across worker threads.

  Sizing composes `build-pipeline.js`'s `manageWorkerLifecycle` — the
  judgement (cores bounded by a memory budget) is the part worth reusing —
  while the work itself runs on `worker-pool.js`, whose `minify-html` task
  calls the real minifier. Keeping the two apart is deliberate: the pipeline
  module renders its own standalone page template, so an export driven
  through it would ship different HTML than the Studio produces.

  The pool is shut down in a `finally`, including when a task throws: a
  build that leaves threads alive keeps the process from exiting.
*/
async function minifyPagesParallel(built, opts) {
  const o = opts || {};
  const pages = Array.isArray(built) ? built : [];
  const jobs = pages.map((entry) => ({
    taskType: 'minify-html',
    payload: { content: String((entry && entry.html) || ''), options: { inline: true } }
  }));

  let plan = null;
  try {
    if (Pipeline && typeof Pipeline.manageWorkerLifecycle === 'function') {
      plan = Pipeline.manageWorkerLifecycle(jobs, o.perWorkerBytes ? { perWorkerBytes: o.perWorkerBytes } : {});
    }
  } catch (e) { plan = null; }

  const requested = o.workers
    ? Math.max(1, Math.floor(Number(o.workers) || 1))
    : (plan && plan.size ? plan.size : undefined);

  const t0 = process.hrtime.bigint();
  const pool = await Pool.initWorkerPool(requested);
  let batch = null;
  try {
    batch = await Pool.dispatchBatch(jobs, { concurrency: (pool && pool.size) || requested || 1 });
  } finally {
    await Pool.terminateWorkerPool({ reason: 'headless build finished' });
  }
  const ms = Math.round(Number(process.hrtime.bigint() - t0) / 1e6 * 100) / 100;
  return { batch, plan, pool, stats: Pool.poolStats(), ms };
}

// ---- the build -------------------------------------------------------

async function runHeadlessBuild(projectFilePath, options) {
  const o = Object.assign({ out: 'dist', environment: 'production', minify: true }, options || {});
  const log = o.logger || createLogger({ quiet: !!o.quiet });
  const result = {
    ok: false, exitCode: 1, out: o.out, files: [], pages: 0,
    validation: null, migration: null, security: null, zip: null,
    profile: null, errors: [], warnings: [], logs: []
  };

  /*
    Two failure kinds, kept apart because a CI job acts differently on
    each. `fail` is "the build broke" (exit 1); `invalid` is "the input
    is wrong" (exit 2), where retrying cannot possibly help.
  */
  const fail = (message, code) => {
    log.error(message);
    result.errors.push(message);
    result.exitCode = code || EXIT.BUILD_FAILED;
    return result;
  };
  const invalid = (message) => fail(message, EXIT.INVALID_INPUT);

  // ---- read ----
  let raw = '';
  try {
    raw = fs.readFileSync(String(projectFilePath), 'utf8');
  } catch (e) {
    return invalid('cannot read ' + projectFilePath + ': ' + (e && e.message ? e.message : e));
  }

  Profiler.reset();
  Profiler.startBuild('headless:' + path.basename(String(projectFilePath)));

  // ---- validate and migrate ----
  log.step('Validating ' + path.basename(String(projectFilePath)));
  const migration = Profiler.timeStage('parse-and-migrate', () => Migration.migrateProjectSchema(raw));
  result.migration = { ok: migration.ok, from: migration.from, to: migration.to, applied: migration.applied, report: migration.report };
  if (!migration.ok) return invalid('the project is not usable: ' + migration.errors.join('; '));
  migration.report.forEach((line) => log.info(line));

  const validation = Vault.validateProject(migration.raw);
  result.validation = { ok: validation.ok, errors: validation.errors, warnings: validation.warnings };
  if (!validation.ok) return invalid('the project failed validation: ' + validation.errors.join('; '));
  validation.warnings.forEach((w) => log.warn(w));
  const project = JSON.parse(migration.raw);
  log.success('project valid (schema ' + migration.to + ')');

  // ---- cache ----
  if (o.cleanCache && Cache) {
    // Both calls take the same directory. Passing it to only one of them
    // cleared the cache the caller asked for and pruned the default one,
    // which is an option that silently does nothing.
    const cacheOpts = o.cacheDir ? { dir: o.cacheDir } : {};
    const removed = Cache.prune(Object.assign({ maxBytes: 0 }, cacheOpts));
    Cache.reset(cacheOpts);
    log.info('build cache cleared (' + (removed && removed.removed ? removed.removed + ' entries' : 'no entries') + ')');
  }

  // ---- build ----
  const missing = [];
  const Builder = loadBuilder(missing);
  if (!Builder || typeof Builder.buildSitePages !== 'function') {
    return fail('the site builder could not be loaded' + (missing.length ? ' (missing: ' + missing.join(', ') + ')' : ''));
  }

  /*
    Compile, then transform. `--parallel` compiles once and fans the
    *minification* across worker threads — deliberately NOT the page
    rendering: a page is rendered against the whole page list (nav links,
    sitemap), so splitting it would change the output, and the transform is
    the stage that actually costs seconds (measured at roughly two hundred
    times the compilation).
  */
  const settings = { minify: !!o.minify, environment: o.environment };
  const entries = [];
  let savedBytes = 0;
  let buildTelemetry = null;

  if (o.parallel && Pool && typeof Pool.dispatchBatch === 'function') {
    log.step('Compiling pages');
    let built = [];
    try {
      built = Profiler.timeStage('build-pages', () => Builder.buildSitePages(project, settings));
    } catch (e) {
      return fail('compilation failed: ' + (e && e.message ? e.message : e));
    }
    if (!Array.isArray(built) || !built.length) return fail('the builder produced no pages');
    result.pages = built.length;
    log.success(built.length + ' page(s) compiled');

    if (o.minify) {
      const run = await Profiler.timeStageAsync('minify-pages-parallel', () => minifyPagesParallel(built, { workers: o.workers }));
      const results = (run.batch && run.batch.results) || [];
      let okCount = 0;
      built.forEach((entry, index) => {
        const html = String((entry && entry.html) || '');
        const res = results[index];
        const output = (res && res.ok && res.result && typeof res.result.content === 'string') ? res.result.content : html;
        if (res && res.ok) okCount++;
        else result.warnings.push('page ' + index + ' could not be minified; its unminified source was kept');
        savedBytes += Math.max(0, html.length - output.length);
        entries.push({ name: pageFileName(entry && entry.page, index, Builder), content: output, page: entry && entry.page });
      });
      buildTelemetry = {
        workers: (run.plan && run.plan.size) || 0,
        inline: !!(run.pool && run.pool.inline),
        jobs: built.length,
        completed: okCount,
        failed: built.length - okCount,
        completionRate: built.length ? Math.round((okCount / built.length) * 100) : 100,
        queueMs: run.ms,
        throughputPerSec: run.ms > 0 ? Math.round((okCount / run.ms) * 1000 * 100) / 100 : null,
        dispatched: run.stats ? run.stats.dispatched : built.length,
        savedBytes,
        sizing: run.plan ? { size: run.plan.size, limit: run.plan.limit, cores: run.plan.cores } : null
      };
      log.success('minified in parallel across ' + buildTelemetry.workers + ' worker(s) — ' + savedBytes + ' bytes saved across ' + entries.length + ' page(s)');
      if (o.verbose) log.info('pool: ' + JSON.stringify(buildTelemetry.sizing) + ' dispatched ' + buildTelemetry.dispatched);
    } else {
      built.forEach((entry, index) => entries.push({
        name: pageFileName(entry && entry.page, index, Builder),
        content: String((entry && entry.html) || ''),
        page: entry && entry.page
      }));
    }
  } else {
    if (o.parallel) result.warnings.push('--parallel was requested but a worker pool is unavailable; building sequentially');
    log.step('Compiling pages');
    let built = [];
    try {
      built = Profiler.timeStage('build-pages', () => Builder.buildSitePages(project, settings));
    } catch (e) {
      return fail('compilation failed: ' + (e && e.message ? e.message : e));
    }
    if (!Array.isArray(built) || !built.length) return fail('the builder produced no pages');
    result.pages = built.length;
    log.success(built.length + ' page(s) compiled');

    built.forEach((entry, index) => {
      const html = String(entry && entry.html ? entry.html : '');
      const name = pageFileName(entry && entry.page, index, Builder);
      let output = html;
      if (o.minify) {
        // `inline: true` because these pages are self-contained: their CSS and
        // JS are inline, so minifying only the markup would leave most of the
        // bytes untouched.
        output = Profiler.timeStage('minify-pages', () => Minifier.minifyHTML(html, { inline: true }));
        const stats = Minifier.measure(html, output);
        savedBytes += Math.max(0, stats.saved);
      }
      entries.push({ name, content: output, page: entry && entry.page });
    });
    if (o.minify) log.success('minified — ' + savedBytes + ' bytes saved across ' + entries.length + ' page(s)');
  }

  // ---- security (after minification, deliberately) ----
  const inlineHashes = [];
  let hardened = 0;
  entries.forEach((entry) => {
    const res = Profiler.timeStage('harden', () => SRI.hardenDocument(entry.content, {}, {
      allowedSources: { script: [], style: ['https://fonts.googleapis.com'] }
    }));
    if (res && res.ok) {
      entry.content = res.html;
      inlineHashes.push.apply(inlineHashes, [res.inlineScripts]);
      hardened++;
      res.warnings.forEach((w) => result.warnings.push(w));
    }
  });
  result.security = {
    hardened,
    inlineScripts: inlineHashes.reduce((n, v) => n + (v || 0), 0),
    note: 'inline script hashes are computed from the minified output, which is the text that will actually be served'
  };
  log.success('content-security policy computed over ' + result.security.inlineScripts + ' inline script(s)');

  // ---- SEO extras (robots, sitemap) ----
  if (typeof Builder.seoExtras === 'function') {
    try {
      const extras = Profiler.timeStage('seo-extras', () => Builder.seoExtras(project, settings));
      if (extras && typeof extras === 'object') {
        Object.keys(extras).forEach((key) => {
          const value = extras[key];
          if (typeof value === 'string' && value.trim()) {
            const fileName = /xml/i.test(key) ? 'sitemap.xml' : (/robot/i.test(key) ? 'robots.txt' : key + '.txt');
            entries.push({ name: fileName, content: value });
          }
        });
      }
    } catch (e) {
      result.warnings.push('SEO extras were skipped: ' + (e && e.message ? e.message : e));
    }
  }

  // ---- write ----
  log.step('Writing to ' + o.out);
  const outDir = path.resolve(String(o.out));
  const written = [];
  for (const entry of entries) {
    const dest = path.join(outDir, entry.name);
    const res = Profiler.timeStage('write-files', () => Vault.writeFileAtomic(dest, entry.content));
    if (!res.ok) return fail('could not write ' + entry.name + ': ' + res.error);
    written.push({ name: entry.name, bytes: res.bytes, path: dest });
  }
  result.files = written.map((f) => f.name);

  // ---- manifest, computed from the bytes actually written ----
  if (Manifest && typeof Manifest.build === 'function') {
    try {
      const artifact = await Profiler.timeStageAsync('manifest', () => Manifest.build({ files: entries.map((e) => ({ name: e.name, content: e.content })) }));
      const json = (artifact && artifact.json) || JSON.stringify(artifact, null, 2);
      const res = Vault.writeFileAtomic(path.join(outDir, 'manifest.json'), json);
      if (res.ok) {
        written.push({ name: 'manifest.json', bytes: res.bytes });
        result.files.push('manifest.json');
      }
    } catch (e) {
      result.warnings.push('the manifest could not be written: ' + (e && e.message ? e.message : e));
    }
  }

  // ---- optional zip ----
  if (o.exportZip && ZIP) {
    try {
      const blob = Profiler.timeStage('zip', () => ZIP.zipFiles(entries.map((e) => ({ name: e.name, content: e.content }))));
      let buffer = null;
      if (Buffer.isBuffer(blob)) buffer = blob;
      else if (blob instanceof Uint8Array) buffer = Buffer.from(blob);
      else if (blob && typeof blob.arrayBuffer === 'function') buffer = Buffer.from(await blob.arrayBuffer());
      if (!buffer) throw new Error('the zip writer returned an unexpected type');
      const zipPath = path.join(outDir, 'site.zip');
      const res = Vault.writeBytesAtomic(zipPath, buffer);
      if (!res.ok) throw new Error(res.error);
      result.zip = { path: zipPath, bytes: res.bytes };
      log.success('zip written (' + res.bytes + ' bytes)');
    } catch (e) {
      result.warnings.push('the zip was not written: ' + (e && e.message ? e.message : e));
    }
  }

  result.profile = Profiler.generateBuildProfileReport();
  result.telemetry = buildTelemetry;

  /*
    The machine-readable report. Written AFTER the manifest on purpose:
    this describes the build, it is not a site asset, so it is not added
    to the integrity manifest — otherwise a rebuilt report would look
    like a modified page and every deploy would ship a "changed" file
    that carries no site content.
  */
  if (o.stats !== false) {
    const report = {
      tool: 'pallettai-studio',
      version: APP_VERSION,
      ok: true,
      exitCode: EXIT.OK,
      environment: o.environment,
      parallel: !!o.parallel,
      pages: result.pages,
      files: written.map((f) => ({ name: f.name, bytes: f.bytes || 0 })),
      bytesWritten: written.reduce((n, f) => n + (f.bytes || 0), 0),
      minify: { enabled: !!o.minify, savedBytes },
      security: result.security,
      telemetry: buildTelemetry,
      profile: result.profile,
      warnings: result.warnings,
      errors: [],
      generatedAt: new Date().toISOString()
    };
    const statsPath = path.join(outDir, 'build-stats.json');
    try {
      const res = Vault.writeFileAtomic(statsPath, JSON.stringify(report, null, 2));
      if (res.ok) {
        result.stats = { path: statsPath, bytes: res.bytes };
        if (o.verbose) log.info('build report written to build-stats.json (' + res.bytes + ' bytes)');
      } else {
        result.warnings.push('the build report could not be written: ' + res.error);
      }
    } catch (e) {
      result.warnings.push('the build report could not be written: ' + (e && e.message ? e.message : e));
    }
  }

  result.logs = log.lines();
  result.ok = true;
  result.exitCode = EXIT.OK;
  log.success('build finished — ' + written.length + ' file(s) in ' + Profiler.summary(result.profile));
  return result;
}

// ---- entry point -----------------------------------------------------

async function main(argv) {
  const opts = resolveOptions(argv);
  const log = createLogger({ quiet: opts.quiet });

  if (opts.help) {
    if (!opts.quiet) console.log(usage());
    return EXIT.OK;
  }
  // Bad flags and an unreadable config are input problems, not build
  // failures: nothing was attempted, so 2 is the honest code.
  if (opts.errors.length) {
    opts.errors.forEach((e) => log.error(e));
    log.raw(usage());
    return EXIT.INVALID_INPUT;
  }
  if (!opts.input) {
    log.error('--input is required');
    log.raw(usage());
    return EXIT.INVALID_INPUT;
  }

  if (!opts.quiet) {
    log.raw(bold('PallettAI Studio') + ' — headless build (' + opts.environment + ')' +
      (opts.parallel ? dim(' parallel') : ''));
  }
  const result = await runHeadlessBuild(opts.input, Object.assign({}, opts, { logger: log }));
  if (!result.ok) {
    log.error('build failed');
    return result.exitCode || EXIT.BUILD_FAILED;
  }
  return EXIT.OK;
}

module.exports = {
  parseArgs,
  resolveOptions,
  loadConfig,
  usage,
  createLogger,
  loadBuilder,
  minifyPagesParallel,
  runHeadlessBuild,
  main,
  FLAGS,
  BOOLEAN_FLAGS,
  CONFIG_KEYS,
  EXIT
};

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((e) => {
      console.error(red('FAIL') + ' ' + (e && e.stack ? e.stack : e));
      process.exitCode = 1;
    });
}
