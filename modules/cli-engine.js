'use strict';
// ============================================================
// PallettAI Studio — headless CLI build engine
// Terminal/CI builds without booting the Electron GUI: parse
// argv, validate the project, run the parallel pipeline, write
// the site plus a machine-readable build-stats.json, and map the
// outcome onto standardized UNIX exit codes.
// ------------------------------------------------------------
//   1. runHeadlessBuild(projectPath, flags, deps) →
//        {code, stats, statsPath, outDir}
//   2. Flags (via parseArgs): --config, --out-dir (alias --out),
//      --minify, --parallel[=N|auto], --verbose, --help.
//      `--flag value` and `--flag=value` both work; boolean flags
//      accept `=false` to negate (matches cli-runner.js).
//   3. Exit codes (EXIT): 0 success · 1 build error ·
//      2 validation failure (bad flags, missing/invalid project).
//      Every terminal state that knows its outDir also writes
//      build-stats.json — CI reads the report either way.
//
// Project discovery: projectPath may be a directory containing
// pai-project.json, or a direct path to a JSON project file
// ({pages: [...], styles?, assets?}). --config points at an
// optional JSON file of build defaults ({outDir, minify,
// parallel}); explicit CLI flags always win over the file.
// deps injection seam: {log, executeBuild} — tests capture log
// output and force the build-error path without sabotaging the
// real pipeline.
//
// ---- what this file guarantees ----------------------------------
// 1. VALIDATION NEVER BUILDS: malformed argv, a missing project
//    file, un-parseable JSON or a schema without a non-empty
//    `pages` array all stop at exit 2 with every problem listed —
//    no partial output directory, no half-written site.
// 2. THE ENGINE NEVER CALLS process.exit(): it RETURNS codes and
//    main() assigns process.exitCode only when run as a script,
//    so CI wrappers and tests can compose it.
// 3. build-stats.json IS WRITTEN ON BUILD FAILURE too (ok:false +
//    the error list), because a CI log without a machine-readable
//    failure record is exactly the report you needed most.
// 4. OUTPUT IS DETERMINISTIC for a given project+flags: same
//    bytes, same counts — page ids are sanitized to a conservative
//    [A-Za-z0-9._-] filename so a hostile id cannot traverse out
//    of outDir.
// ============================================================

const fs = require('fs');
const path = require('path');
const pipeline = require('./build-pipeline.js');

const EXIT = { OK: 0, BUILD_ERROR: 1, VALIDATION: 2 };
const PROJECT_FILENAME = 'pai-project.json';

const FLAG_MAP = {
  '--config': { key: 'config', takesValue: true },
  '--out-dir': { key: 'outDir', takesValue: true },
  '--out': { key: 'outDir', takesValue: true }, // cli-runner alias
  '--minify': { key: 'minify', bool: true },
  '--parallel': { key: 'parallel', takesValue: true },
  '--verbose': { key: 'verbose', bool: true },
  '--help': { key: 'help', bool: true }
};

const USAGE = [
  'Usage: pai-build <projectPath> [flags]',
  '',
  '  --config <file>     JSON build defaults (outDir/minify/parallel)',
  '  --out-dir <dir>     output directory (default: <project>/dist)',
  '  --minify            minify CSS during the build',
  '  --parallel <n|auto> worker thread count (default: auto)',
  '  --verbose           per-job progress logging',
  '  --help              show this help',
  '',
  'Exit codes: 0 success · 1 build error · 2 validation failure'
].join('\n');

function usage() { return USAGE; }

// ============================================================
// parseArgs
// ============================================================

function parseArgs(argv) {
  const list = Array.isArray(argv) ? argv : [];
  const flags = { minify: false, verbose: false, help: false };
  const errors = [];
  const positionals = [];

  for (let i = 0; i < list.length; i++) {
    let arg = String(list[i]);
    let inlineValue = null;
    const eq = arg.indexOf('=');
    if (arg.indexOf('--') === 0 && eq > 2) {
      inlineValue = arg.slice(eq + 1);
      arg = arg.slice(0, eq);
    }
    const spec = FLAG_MAP[arg];
    if (!spec) {
      if (arg.indexOf('--') === 0) errors.push('unknown flag: ' + arg);
      else positionals.push(arg);
      continue;
    }
    if (spec.bool) {
      flags[spec.key] = inlineValue == null
        ? true : !/^(0|false|no|off)$/i.test(inlineValue);
      continue;
    }
    let value = inlineValue;
    if (value == null || value === '') {
      const next = list[i + 1];
      if (next == null || String(next).indexOf('--') === 0) {
        errors.push('missing value for ' + arg);
        continue;
      }
      value = String(list[++i]);
    }
    if (spec.key === 'parallel') {
      if (value !== 'auto' && !/^[0-9]+$/.test(value)) {
        errors.push('--parallel must be "auto" or a positive integer');
        continue;
      }
      flags.parallel = value === 'auto' ? 'auto' : Math.max(1, parseInt(value, 10));
      continue;
    }
    flags[spec.key] = value;
  }

  if (positionals.length > 1) errors.push('unexpected argument: ' + positionals[1]);
  if (positionals.length) flags.projectPath = positionals[0];
  return { flags, errors, positionals };
}

// ============================================================
// Project + config loading (validation phase)
// ============================================================

function readJson(file, label, errors) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    errors.push(label + ' not found: ' + file);
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    errors.push(label + ' is not valid JSON: ' + file + ' (' + e.message + ')');
    return null;
  }
}

function validateProject(project) {
  const errors = [];
  if (!project || typeof project !== 'object' || Array.isArray(project)) {
    return ['project must be a JSON object with a pages array'];
  }
  if (!Array.isArray(project.pages) || project.pages.length === 0) {
    errors.push('project.pages must be a non-empty array');
    return errors;
  }
  const seen = new Set();
  project.pages.forEach((p, i) => {
    if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !p.id.trim()) {
      errors.push('pages[' + i + '] needs a non-empty string id');
      return;
    }
    if (seen.has(p.id)) errors.push('duplicate page id: ' + p.id);
    seen.add(p.id);
  });
  ['styles', 'assets'].forEach((k) => {
    if (project[k] != null && !Array.isArray(project[k])) {
      errors.push('project.' + k + ' must be an array when present');
    }
  });
  if (Array.isArray(project.styles)) {
    project.styles.forEach((s, i) => {
      if (!s || typeof s.id !== 'string' || !s.id.trim()) {
        errors.push('styles[' + i + '] needs a non-empty string id');
      }
    });
  }
  return errors;
}

/**
 * loadProject(projectPath, flags) → {ok, errors, project, config,
 * base, projectFile}. Directories resolve to pai-project.json;
 * files are taken as-is; --config is an optional defaults file.
 */
function loadProject(projectPath, flags) {
  const f = flags || {};
  const errors = [];
  if (typeof projectPath !== 'string' || !projectPath.trim()) {
    return { ok: false, errors: ['projectPath is required'], project: null, config: {}, base: null };
  }
  let projectFile = projectPath;
  let base = null;
  try {
    const st = fs.statSync(projectPath);
    if (st.isDirectory()) {
      base = path.resolve(projectPath);
      projectFile = path.join(base, PROJECT_FILENAME);
    } else {
      projectFile = path.resolve(projectPath);
      base = path.dirname(projectFile);
    }
  } catch (e) {
    return {
      ok: false,
      errors: ['project not found: ' + projectPath],
      project: null, config: {}, base: null
    };
  }

  const project = readJson(projectFile, 'project', errors);
  if (project) errors.push(...validateProject(project));

  let config = {};
  if (f.config) {
    const cfgFile = path.isAbsolute(f.config) ? f.config : path.resolve(base, f.config);
    const parsed = readJson(cfgFile, 'config', errors);
    if (parsed != null) {
      if (typeof parsed !== 'object' || Array.isArray(parsed)) errors.push('config must be a JSON object');
      else config = parsed;
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    project,
    config,
    base,
    projectFile
  };
}

function resolveOptions(flags, config, base) {
  const f = flags || {};
  const c = config || {};
  const outDirRaw = f.outDir || c.outDir || 'dist';
  const outDir = path.isAbsolute(outDirRaw) ? outDirRaw : path.resolve(base, outDirRaw);
  const parallel = f.parallel != null ? f.parallel : (c.parallel != null ? c.parallel : 'auto');
  if (parallel !== 'auto' && !(Number.isInteger(parallel) && parallel >= 1)) {
    return { ok: false, errors: ['parallel must be "auto" or a positive integer'], outDir: null };
  }
  return {
    ok: true,
    errors: [],
    outDir,
    minify: f.minify === true || c.minify === true,
    parallel
  };
}

// ============================================================
// runHeadlessBuild
// ============================================================

const safeName = (id) => String(id).replace(/[^A-Za-z0-9._-]/g, '-');

function writeStats(outDir, stats) {
  try {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'build-stats.json'),
      JSON.stringify(stats, null, 2) + '\n');
    return path.join(outDir, 'build-stats.json');
  } catch (e) {
    return null;
  }
}

async function runHeadlessBuild(projectPath, flags, deps) {
  const d = deps || {};
  const f = flags || {};
  const log = typeof d.log === 'function'
    ? d.log
    : (f.verbose ? (m) => console.log(m) : () => {});
  const started = Date.now();

  const stats = {
    ok: false,
    exitCode: EXIT.BUILD_ERROR,
    startedAt: new Date(started).toISOString(),
    finishedAt: null,
    durationMs: 0,
    projectPath: projectPath == null ? null : String(projectPath),
    outDir: null,
    minify: f.minify === true,
    parallel: f.parallel != null ? f.parallel : 'auto',
    counts: { pages: 0, styles: 0, assets: 0 },
    workers: 0,
    throughput: 0,
    completionRate: 0,
    errors: []
  };
  const finish = (code, extra) => {
    stats.exitCode = code;
    stats.ok = code === EXIT.OK;
    stats.finishedAt = new Date().toISOString();
    stats.durationMs = Date.now() - started;
    if (extra) Object.assign(stats, extra);
    return {
      code,
      stats,
      outDir: stats.outDir,
      statsPath: stats.outDir ? writeStats(stats.outDir, stats) : null
    };
  };

  // ---- validation phase (exit 2 — nothing is built) ----------
  const loaded = loadProject(projectPath, f);
  if (!loaded.ok) {
    stats.errors.push(...loaded.errors);
    log('validation failed: ' + loaded.errors.length + ' problem(s)');
    loaded.errors.forEach((e) => log('  - ' + e));
    return finish(EXIT.VALIDATION);
  }
  const resolved = resolveOptions(f, loaded.config, loaded.base);
  if (!resolved.ok) {
    stats.errors.push(...resolved.errors);
    resolved.errors.forEach((e) => log('  - ' + e));
    return finish(EXIT.VALIDATION);
  }
  stats.outDir = resolved.outDir;
  stats.minify = resolved.minify;
  stats.parallel = resolved.parallel;

  // ---- build phase (exit 1 on failure) -----------------------
  let built;
  try {
    built = typeof d.executeBuild === 'function'
      ? await d.executeBuild(loaded.project, resolved)
      : await pipeline.executeParallelBuild(loaded.project, resolved.parallel, {
        minify: resolved.minify,
        onProgress: f.verbose
          ? (s) => log('[progress] ' + s.done + '/' + s.total
            + ' (' + s.throughput + '/s, ' + s.workers + ' worker(s))')
          : undefined
      });
  } catch (e) {
    const msg = String((e && e.message) || e);
    stats.errors.push(msg);
    log('build failed: ' + msg);
    return finish(EXIT.BUILD_ERROR);
  }

  // ---- write phase ------------------------------------------
  const results = (built && built.results) || {};
  try {
    fs.mkdirSync(resolved.outDir, { recursive: true });
    const pages = results.pages || {};
    Object.keys(pages).forEach((id) => {
      fs.writeFileSync(path.join(resolved.outDir, safeName(id) + '.html'), pages[id]);
      stats.counts.pages++;
    });
    const styles = results.styles || {};
    Object.keys(styles).forEach((id) => {
      fs.writeFileSync(path.join(resolved.outDir, safeName(id) + '.css'), styles[id]);
      stats.counts.styles++;
    });
    (Array.isArray(loaded.project.assets) ? loaded.project.assets : []).forEach((a) => {
      if (!a || a.data == null) return;
      const ext = a.ext ? '.' + String(a.ext).replace(/[^A-Za-z0-9]/g, '') : '.data';
      fs.writeFileSync(path.join(resolved.outDir, safeName(a.id) + ext), String(a.data));
      stats.counts.assets++;
    });
  } catch (e) {
    stats.errors.push('write failed: ' + String((e && e.message) || e));
    return finish(EXIT.BUILD_ERROR);
  }

  const report = (built && (built.report || built.telemetry)) || {};
  stats.workers = report.workers || 0;
  stats.throughput = report.throughput || 0;
  stats.completionRate = Number.isFinite(report.completionRate) ? report.completionRate : 1;
  const jobErrors = (results.errors || []);
  jobErrors.forEach((e) => stats.errors.push(e.id + ': ' + e.error));
  if (stats.errors.length) {
    log('build finished with ' + stats.errors.length + ' error(s)');
    return finish(EXIT.BUILD_ERROR);
  }
  log('build ok — ' + stats.counts.pages + ' page(s) → ' + resolved.outDir);
  return finish(EXIT.OK);
}

// ============================================================
// main — returns codes, never throws, never exits itself
// ============================================================

async function main(argv, deps) {
  const d = deps || {};
  const log = typeof d.log === 'function'
    ? d.log : (m) => console.log(m);
  const parsed = parseArgs(argv);
  if (parsed.flags.help) {
    log(USAGE);
    return EXIT.OK;
  }
  if (parsed.errors.length) {
    parsed.errors.forEach((e) => log('error: ' + e));
    log(USAGE);
    return EXIT.VALIDATION;
  }
  if (!parsed.flags.projectPath) {
    log('error: project path is required');
    log(USAGE);
    return EXIT.VALIDATION;
  }
  let result;
  try {
    result = await runHeadlessBuild(parsed.flags.projectPath, parsed.flags, d);
  } catch (e) {
    log('error: ' + String((e && e.message) || e));
    return EXIT.BUILD_ERROR;
  }
  return result.code;
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((e) => {
      console.error('FAIL ' + (e && e.stack ? e.stack : e));
      process.exitCode = EXIT.BUILD_ERROR;
    });
}

module.exports = {
  EXIT,
  FLAG_MAP,
  PROJECT_FILENAME,
  parseArgs,
  loadProject,
  resolveOptions,
  runHeadlessBuild,
  usage,
  main
};
