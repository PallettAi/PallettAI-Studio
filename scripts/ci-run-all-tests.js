#!/usr/bin/env node
// ============================================================
// PallettAI Studio — master CI runner
// ------------------------------------------------------------
// Runs every smoke suite in the repository, each in its OWN child
// process, and prints a matrix of domain, timing and outcome.
//
//   node scripts/ci-run-all-tests.js
//   node scripts/ci-run-all-tests.js --jobs 2 --verbose
//   node scripts/ci-run-all-tests.js --only backend
//   node scripts/ci-run-all-tests.js --json ci-report.json
//
// ---- why a child process per suite -------------------------
//
// A suite is not a function call. Several of them install globals
// (`global.DB`, `global.ONLINE`, …) that the builder reads, some read
// and write the same temp roots, and a few spawn worker pools. Running
// them in one process would make the second suite's globals the first
// suite's leftovers and produce a pass/fail that depends on ordering.
// Isolation also means a suite that calls `process.exit` — which most
// of them do — cannot end the run early.
//
// ---- what "domain" means here ------------------------------
//
// This brief names five agent domains with the filename prefixes
// `backend-`, `design-`, `vision-`, `seo-` and `motion-`. Those
// prefixes cover a minority of the suites that actually exist: the
// repository has grown well beyond them. So the matrix is grouped by
// the suite's REAL family (the token before the first dash), with the
// five named domains labelled first when they are present, and an
// explicit `other` row so the arithmetic in the summary always adds
// up. Forcing 127 suites into five buckets would have hidden most of
// the repository from the report.
//
// Exit code: 0 only when every suite passes, 1 when any fails.
// ============================================================
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPTS = path.join(ROOT, 'scripts');

// ---- the five named agent domains, in the brief's order ----
const NAMED_DOMAINS = [
  { key: 'backend', label: 'Core Compiler & Infrastructure', re: /^backend-/ },
  { key: 'design', label: 'Design DNA, Tokens & Layout', re: /^design-/ },
  { key: 'vision', label: 'Vision QA, Accessibility & Media', re: /^vision-/ },
  { key: 'seo', label: 'SEO, Semantic Web & Vectors', re: /^seo-/ },
  { key: 'motion', label: 'E-Commerce, Motion, PWA & Edge', re: /^motion-/ }
];

const COLOR = !process.env.NO_COLOR && (process.env.FORCE_COLOR || (process.stdout && process.stdout.isTTY));
const paint = (code) => (t) => (COLOR ? '\u001b[' + code + 'm' + t + '\u001b[0m' : String(t));
const red = paint('31');
const green = paint('32');
const yellow = paint('33');
const cyan = paint('36');
const dim = paint('2');
const bold = paint('1');

// ---- arguments ------------------------------------------------------------

function parseArgs(argv) {
  const args = Array.isArray(argv) ? argv.slice() : [];
  const opts = { only: '', grep: '', jobs: 0, timeoutMs: 180000, json: '', verbose: false, help: false };
  for (let i = 0; i < args.length; i++) {
    const raw = args[i];
    const eq = raw.indexOf('=');
    const name = eq === -1 ? raw : raw.slice(0, eq);
    const inline = eq === -1 ? null : raw.slice(eq + 1);
    const value = () => (inline !== null ? inline : args[++i]);
    if (name === '--only') opts.only = String(value() || '');
    else if (name === '--grep') opts.grep = String(value() || '');
    else if (name === '--jobs') opts.jobs = Math.max(1, Math.floor(Number(value()) || 1));
    else if (name === '--timeout') opts.timeoutMs = Math.max(1000, Number(value()) || 180000);
    else if (name === '--json') opts.json = String(value() || '');
    else if (name === '--serial') opts.jobs = 1;
    else if (name === '--verbose') opts.verbose = true;
    else if (name === '--help' || name === '-h') opts.help = true;
  }
  return opts;
}

function usage() {
  return [
    'PallettAI Studio — master CI runner',
    '',
    '  node scripts/ci-run-all-tests.js [flags]',
    '',
    '  --only <prefix>     run only suites whose name starts with <prefix>',
    '  --grep <text>       run only suites whose name contains <text>',
    '  --jobs <n>          suites to run at once (default: cores - 1, max 4)',
    '  --serial            shorthand for --jobs 1',
    '  --timeout <ms>      per-suite timeout (default 180000)',
    '  --json <path>       write a machine-readable report',
    '  --verbose           stream each suite\'s output as it runs',
    '  --help              this text',
    '',
    '  Exit codes: 0 every suite passed, 1 something failed.'
  ].join('\n');
}

// ---- discovery ------------------------------------------------------------

/*
  A suite is a script that runs standalone and reports its own result.
  `*-smoke.js` is the brief's pattern; `*-check.js` (the release gate)
  is included because leaving the one script that certifies a release
  out of the CI run would be a strange definition of "all tests".

  Scripts that need arguments are deliberately NOT matched: release-guard
  takes a tag and would fail by design here.
*/
function discoverSuites(dir, opts) {
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch (e) {
    return [];
  }
  return names
    .filter((n) => /-(smoke|check)\.js$/.test(n))
    .filter((n) => (opts.only ? n.indexOf(opts.only) === 0 : true))
    .filter((n) => (opts.grep ? n.indexOf(opts.grep) !== -1 : true))
    .sort()
    .map((n) => path.join(dir, n));
}

/*
  The family a suite belongs to: the token before the first dash. So
  `ai-diversity-smoke.js` → `ai`, `backend-advanced-v6-smoke.js` →
  `backend`. Named domains are checked first so the brief's five rows
  keep their labels.
*/
function domainOf(file) {
  const base = path.basename(file);
  const named = NAMED_DOMAINS.find((d) => d.re.test(base));
  if (named) return named;
  const token = (base.split('-')[0] || 'other').replace(/\.js$/, '');
  return { key: token, label: token, re: null };
}

// ---- execution ------------------------------------------------------------

/*
  Run one suite in a child process. `stdio: 'pipe'` for both streams and
  the two merged, because a suite that fails on stderr and prints its
  summary on stdout would otherwise be reported with half the evidence.

  A timeout kills the child rather than waiting on it: a hung suite in
  CI is a failed suite, and one that never returns is worse than one
  that fails, because nothing after it ever runs.
*/
function runSuite(file, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    let out = '';
    let child;
    try {
      child = spawn(process.execPath, [file], {
        cwd: ROOT,
        env: Object.assign({}, process.env, { NO_COLOR: '1', FORCE_COLOR: '0' }),
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (e) {
      resolve({ file, ok: false, ms: 0, code: -1, timedOut: false, output: 'spawn failed: ' + (e && e.message) });
      return;
    }

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch (e) { /* already gone */ }
    }, timeoutMs);

    const cap = (chunk) => {
      out += chunk.toString();
      // Keep the tail: the summary is printed last, and an unbounded
      // string from a verbose suite would be hundreds of kilobytes.
      if (out.length > 120000) out = out.slice(-60000);
    };
    child.stdout.on('data', cap);
    child.stderr.on('data', cap);

    const finish = (code) => {
      clearTimeout(timer);
      resolve({ file, ok: code === 0 && !timedOut, ms: Date.now() - started, code, timedOut, output: out });
    };
    child.on('error', (e) => { out += '\nspawn error: ' + (e && e.message); finish(-1); });
    child.on('close', (code) => finish(code == null ? -1 : code));
  });
}

/*
  Bounded concurrency with a stable result order. Several suites are
  CPU-bound (they minify and spawn worker threads), so the default is
  deliberately below the core count: saturating every core makes total
  wall-clock WORSE and can push a timeout that would otherwise pass.
*/
async function runPool(files, opts) {
  const cores = (() => { try { return os.cpus().length; } catch (e) { return 2; } })();
  const jobs = opts.jobs > 0 ? opts.jobs : Math.max(1, Math.min(4, cores - 1));
  const results = new Array(files.length);
  let next = 0;
  let done = 0;
  const width = String(files.length).length;

  const tick = (r) => {
    done++;
    const mark = r.ok ? green('PASS') : red('FAIL');
    const name = path.basename(r.file).padEnd(42);
    const ms = (r.ms + 'ms').padStart(8);
    const line = '  ' + mark + ' ' + name + ms + (r.timedOut ? red('  TIMEOUT') : '');
    if (opts.verbose || !r.ok) process.stdout.write(line + '\n');
    else process.stdout.write('\r' + dim('  ' + String(done).padStart(width) + '/' + files.length) + '  ' + dim(name.trim()));
  };

  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= files.length) return;
      const r = await runSuite(files[i], opts.timeoutMs);
      results[i] = r;
      tick(r);
    }
  }

  const runners = [];
  for (let i = 0; i < Math.min(jobs, files.length || 1); i++) runners.push(worker());
  await Promise.all(runners);
  if (!opts.verbose) process.stdout.write('\r' + ' '.repeat(78) + '\r');
  return { results, jobs };
}

// ---- reporting ------------------------------------------------------------

function tail(text, lines) {
  const parts = String(text || '').split('\n').filter((l) => l.trim());
  return parts.slice(-lines).join('\n');
}

function renderMatrix(results) {
  // Group by domain in discovery order, keeping the five named domains
  // first and everything else after, alphabetically.
  const byDomain = new Map();
  results.forEach((r) => {
    const d = domainOf(r.file);
    if (!byDomain.has(d.key)) byDomain.set(d.key, { domain: d, rows: [] });
    byDomain.get(d.key).rows.push(r);
  });
  const namedOrder = NAMED_DOMAINS.map((d) => d.key);
  const keys = Array.from(byDomain.keys()).sort((a, b) => {
    const ai = namedOrder.indexOf(a);
    const bi = namedOrder.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });

  const label = (k) => {
    const named = NAMED_DOMAINS.find((d) => d.key === k);
    return named ? named.label : k;
  };

  console.log('');
  console.log(bold('  DOMAIN MATRIX'));
  console.log('  ' + '-'.repeat(72));
  console.log('  ' + 'domain'.padEnd(34) + 'suites'.padStart(7) + 'passed'.padStart(8) + 'failed'.padStart(8) + 'time'.padStart(10));
  console.log('  ' + '-'.repeat(72));

  let totalSuites = 0;
  let totalPassed = 0;
  let totalFailed = 0;
  let totalMs = 0;
  const slowest = [];

  keys.forEach((k) => {
    const rows = byDomain.get(k).rows;
    const passed = rows.filter((r) => r.ok).length;
    const failed = rows.length - passed;
    const ms = rows.reduce((n, r) => n + r.ms, 0);
    totalSuites += rows.length;
    totalPassed += passed;
    totalFailed += failed;
    totalMs += ms;
    rows.forEach((r) => slowest.push(r));
    const name = label(k).slice(0, 33);
    console.log('  ' + name.padEnd(34) + String(rows.length).padStart(7)
      + green(String(passed).padStart(8))
      + (failed ? red(String(failed).padStart(8)) : dim(String(failed).padStart(8)))
      + (ms + 'ms').padStart(10));
  });

  console.log('  ' + '-'.repeat(72));
  console.log('  ' + bold('TOTAL'.padEnd(34)) + String(totalSuites).padStart(7)
    + String(totalPassed).padStart(8) + String(totalFailed).padStart(8) + (totalMs + 'ms').padStart(10));
  console.log('');

  slowest.sort((a, b) => b.ms - a.ms);
  console.log('  ' + dim('slowest suites: ' + slowest.slice(0, 5).map((r) => path.basename(r.file, '.js') + ' ' + r.ms + 'ms').join('  ')));

  return { totalSuites, totalPassed, totalFailed, totalMs, byDomain, keys, label };
}

async function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) { console.log(usage()); return 0; }

  const files = discoverSuites(SCRIPTS, opts);
  if (!files.length) {
    console.error(red('no suites matched') + (opts.only ? ' --only ' + opts.only : '') + (opts.grep ? ' --grep ' + opts.grep : ''));
    return 1;
  }

  console.log(bold('PallettAI Studio') + ' — master CI runner');
  console.log(dim('  ' + files.length + ' suite(s) from ' + path.relative(ROOT, SCRIPTS) + '/, isolated child processes'));

  const started = Date.now();
  const { results, jobs } = await runPool(files, opts);
  const elapsed = Date.now() - started;

  const summary = renderMatrix(results);
  console.log('  ' + dim('concurrency: ' + jobs + '   wall clock: ' + elapsed + 'ms'));

  const failures = results.filter((r) => !r.ok);
  if (failures.length) {
    console.log('');
    console.log(red('  FAILURES (' + failures.length + ')'));
    failures.forEach((r) => {
      console.log('');
      console.log('  ' + red('x') + ' ' + path.basename(r.file) + dim('  exit ' + r.code + (r.timedOut ? ' (timed out)' : '') + '  ' + r.ms + 'ms'));
      console.log(dim(tail(r.output, 6).split('\n').map((l) => '      ' + l).join('\n')));
    });
  }

  if (opts.json) {
    try {
      const report = {
        generatedAt: new Date().toISOString(),
        wallClockMs: elapsed,
        concurrency: jobs,
        totals: { suites: summary.totalSuites, passed: summary.totalPassed, failed: summary.totalFailed },
        domains: summary.keys.map((k) => {
          const rows = summary.byDomain.get(k).rows;
          return {
            key: k,
            label: summary.label(k),
            suites: rows.length,
            passed: rows.filter((r) => r.ok).length,
            failed: rows.filter((r) => !r.ok).length,
            ms: rows.reduce((n, r) => n + r.ms, 0)
          };
        }),
        suites: results.map((r) => ({
          name: path.basename(r.file),
          domain: domainOf(r.file).key,
          ok: r.ok,
          exitCode: r.code,
          timedOut: r.timedOut,
          ms: r.ms
        }))
      };
      fs.writeFileSync(path.resolve(opts.json), JSON.stringify(report, null, 2), 'utf8');
      console.log(dim('\n  report written to ' + opts.json));
    } catch (e) {
      console.error(yellow('  could not write the JSON report: ' + (e && e.message)));
    }
  }

  console.log('');
  if (failures.length) {
    console.log(red('  CI FAILED') + ' — ' + summary.totalPassed + '/' + summary.totalSuites + ' suites passed');
    return 1;
  }
  console.log(green('  CI PASSED') + ' — ' + summary.totalSuites + '/' + summary.totalSuites + ' suites passed');
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((e) => {
      console.error(red('  runner crashed: ') + (e && e.stack ? e.stack : e));
      process.exitCode = 1;
    });
}

module.exports = { parseArgs, discoverSuites, domainOf, runSuite, runPool, main, NAMED_DOMAINS, usage };
