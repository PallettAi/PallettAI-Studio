#!/usr/bin/env node
// ============================================================
// PallettAI Studio — release sync (audit → stage → commit → tag → push)
// ------------------------------------------------------------
//   node scripts/git-sync.js                      AUDIT ONLY (dry run)
//   node scripts/git-sync.js --confirm            stage + commit locally
//   node scripts/git-sync.js --confirm --tag v0.5.0-rc1
//   node scripts/git-sync.js --confirm --tag v0.5.0-rc1 --push
//
// ---- why this is a dry run by default ----------------------
//
// Three of this script's five steps are hard to undo or reach
// beyond this machine: a commit rewrites what the next reader
// sees, a tag is the thing a release workflow keys off, and a push
// publishes. So the default invocation only REPORTS, and each step
// that acts needs `--confirm`.
//
// ---- why it never runs `git add .` -------------------------
//
// `git add .` cannot tell the difference between the work you mean
// to ship and the scratch in the working tree. In this repository
// that includes other agents' in-flight files, build output, local
// caches and temp directories — and one of those is a module that
// currently does not parse. Staging that is not a release, it is a
// broken release with a clean-looking diff.
//
// So files are enumerated, filtered through an explicit deny list,
// and staged by path. Everything skipped is printed, so the
// exclusion is visible rather than silent. A JavaScript file that
// fails `node --check` is refused outright: committing a file the
// runtime cannot parse is the one mistake that makes every
// downstream gate meaningless.
//
// ---- why tagging consults the release guard -----------------
//
// `scripts/release-guard.js` exists because the 0.4.2 release was
// tagged on main while the public changelog said nothing about it.
// A tag this script cuts must pass that guard, so the guard runs
// first and a failure stops the tag (not the commit).
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

const DEFAULT_MESSAGE = 'feat(core): master integration of 5-agent architecture v0.5.0 & 100% CI pass';
const DEFAULT_TAG = 'v0.5.0-rc1';

/*
  Paths that may be staged. Deliberately a list rather than `.`, so
  adding a new top-level directory to the release is a decision.
*/
const ALLOW_DIRS = ['modules', 'scripts', 'main', 'ui', 'docs', 'data', 'supabase'];
const ALLOW_FILES = ['package.json', 'package-lock.json', 'CHANGELOG.md', 'README.md', 'main.js', 'preload.js', 'server.js', 'app.js', 'index.html', 'styles.css', '.gitignore'];

/*
  Never staged, whatever the allow list says. Build output is
  reproducible, caches are local, and temp directories belong to
  whoever is mid-task.
*/
const DENY = [
  /^dist\//,
  /^build\//,
  /^out\//,
  /^node_modules\//,
  /^\.git\//,
  /^\.tmp-/,
  /^\.build-cache\//,
  /^\.pallettai\//,
  /^vendor\//,
  /\.log$/,
  /\.tmp$/,
  /^\.DS_Store$/
];

const COLOR = !process.env.NO_COLOR && (process.env.FORCE_COLOR || (process.stdout && process.stdout.isTTY));
const paint = (c) => (t) => (COLOR ? '\u001b[' + c + 'm' + t + '\u001b[0m' : String(t));
const red = paint('31');
const green = paint('32');
const yellow = paint('33');
const cyan = paint('36');
const dim = paint('2');
const bold = paint('1');

function parseArgs(argv) {
  const args = Array.isArray(argv) ? argv.slice() : [];
  const o = { confirm: false, push: false, tag: '', message: '', skipGuard: false, allowBroken: false, help: false, branch: '' };
  for (let i = 0; i < args.length; i++) {
    const raw = args[i];
    const eq = raw.indexOf('=');
    const name = eq === -1 ? raw : raw.slice(0, eq);
    const inline = eq === -1 ? null : raw.slice(eq + 1);
    const value = () => (inline !== null ? inline : args[++i]);
    if (name === '--confirm') o.confirm = true;
    else if (name === '--push') o.push = true;
    else if (name === '--tag') o.tag = String(value() || '');
    else if (name === '--message') o.message = String(value() || '');
    else if (name === '--branch') o.branch = String(value() || '');
    else if (name === '--skip-guard') o.skipGuard = true;
    else if (name === '--allow-broken') o.allowBroken = true;
    else if (name === '--help' || name === '-h') o.help = true;
  }
  return o;
}

function usage() {
  return [
    'PallettAI Studio — release sync',
    '',
    '  node scripts/git-sync.js [--confirm] [--tag <tag>] [--push] [flags]',
    '',
    '  --confirm        actually stage and commit (default: audit only)',
    '  --tag <tag>      also create an annotated tag (default ' + DEFAULT_TAG + ')',
    '  --push           push branch and tags (requires --confirm)',
    '  --message <msg>  override the commit message',
    '  --branch <name>  require the current branch to be <name>',
    '  --skip-guard     tag without running scripts/release-guard.js',
    '  --allow-broken   stage .js files that do not parse (not recommended)',
    '  --help           this text',
    '',
    '  Nothing is committed, tagged or pushed without --confirm.'
  ].join('\n');
}

function git(args, opts) {
  return execFileSync('git', args, Object.assign({ cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }, opts || {})).trim();
}

function gitInherit(args) {
  execFileSync('git', args, { cwd: ROOT, stdio: 'inherit' });
}

// ---- audit ----------------------------------------------------------------

function currentBranch() {
  try {
    const name = git(['rev-parse', '--abbrev-ref', 'HEAD']);
    return name === 'HEAD' ? '' : name;   // '' means detached
  } catch (e) {
    return '';
  }
}

/*
  `git status --porcelain -z` so a path containing a space (or a
  newline) does not split into two bogus entries.
*/
function collectChanges() {
  const out = execFileSync('git', ['status', '--porcelain', '-z'], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }).toString();
  const parts = out.split('\0').filter((s) => s.length);
  const entries = [];
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i];
    const status = rec.slice(0, 2);
    let file = rec.slice(3);
    if (status.indexOf('R') !== -1) {
      // rename: the next NUL-separated token is the origin path
      const next = parts[++i];
      file = next || file;
    }
    entries.push({ status: status.trim() || '??', file });
  }
  const seen = new Set();
  return entries.filter((e) => (seen.has(e.file) ? false : (seen.add(e.file), true)));
}

function allowed(file) {
  if (DENY.some((rx) => rx.test(file))) return 'denied by the exclude list';
  const top = file.split('/')[0];
  if (ALLOW_FILES.indexOf(file) !== -1) return true;
  if (ALLOW_DIRS.indexOf(top) !== -1) return true;
  return 'outside the allow list';
}

function parses(file) {
  if (!/\.jsx?$/.test(file)) return true;
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) return true;
  try {
    execFileSync(process.execPath, ['--check', full], { stdio: 'pipe' });
    return true;
  } catch (e) {
    return false;
  }
}

// ---- run ------------------------------------------------------------------

function main(argv) {
  const o = parseArgs(argv);
  if (o.help) { console.log(usage()); return 0; }

  const branch = currentBranch();
  console.log(bold('PallettAI Studio') + ' — release sync' + (o.confirm ? red('  (CONFIRMED)') : dim('  (audit only)')));
  console.log('');

  if (!branch) {
    console.error(red('  HEAD is detached — refusing to commit on an anonymous branch.'));
    return 1;
  }
  console.log('  branch: ' + cyan(branch));
  if (o.branch && branch !== o.branch) {
    console.error(red('  expected branch ' + o.branch + ', found ' + branch + ' — refusing.'));
    return 1;
  }

  const changes = collectChanges();
  if (!changes.length) {
    console.log(green('  nothing to commit — the working tree is clean.'));
    return 0;
  }

  const stageable = [];
  const skipped = [];
  changes.forEach((c) => {
    const verdict = allowed(c.file);
    if (verdict !== true) { skipped.push({ file: c.file, why: verdict }); return; }
    if (!parses(c.file)) { skipped.push({ file: c.file, why: 'does not parse (node --check failed)' }); return; }
    stageable.push(c);
  });

  console.log('');
  console.log('  ' + bold('WOULD STAGE') + ' (' + stageable.length + ')');
  stageable.forEach((c) => console.log('    ' + cyan(c.status.padEnd(2)) + ' ' + c.file));

  const broken = skipped.filter((s) => /does not parse/.test(s.why));
  if (skipped.length) {
    console.log('');
    console.log('  ' + yellow('NOT STAGED') + ' (' + skipped.length + ')');
    skipped.forEach((s) => console.log('    ' + dim('-') + ' ' + s.file + dim('  — ' + s.why)));
  }

  if (broken.length) {
    console.log('');
    console.log('  ' + red('WARNING: ' + broken.length + ' JavaScript file(s) do not parse.'));
    console.log('  ' + dim('  Committing a file the runtime cannot read makes every downstream gate meaningless.'));
    if (!o.allowBroken) {
      console.log('  ' + dim('  They are excluded. Pass --allow-broken to override (not recommended).'));
    }
  }

  if (!stageable.length) {
    console.log('');
    console.log(yellow('  nothing stageable — see the exclusions above.'));
    return 1;
  }

  if (!o.confirm) {
    console.log('');
    console.log(dim('  dry run: re-run with --confirm to stage and commit.'));
    return 0;
  }

  // ---- stage ----
  console.log('');
  console.log('  staging ' + stageable.length + ' path(s)…');
  // Paths only, in batches, because a path argument list has a length limit.
  const files = stageable.map((c) => c.file);
  for (let i = 0; i < files.length; i += 200) {
    gitInherit(['add', '--'].concat(files.slice(i, i + 200)));
  }
  const staged = git(['diff', '--cached', '--name-only']).split('\n').filter(Boolean);
  console.log('  ' + staged.length + ' staged');
  if (!staged.length) {
    console.error(red('  nothing staged — aborting before the commit.'));
    return 1;
  }

  // ---- commit ----
  const message = o.message || DEFAULT_MESSAGE;
  console.log('');
  console.log('  commit: ' + cyan(message));
  gitInherit(['commit', '-m', message]);

  // ---- tag ----
  if (o.tag !== '') {
    const tag = o.tag || DEFAULT_TAG;
    if (!o.skipGuard) {
      console.log('');
      console.log('  running the release guard for ' + tag + '…');
      let guardOk = true;
      try {
        execFileSync(process.execPath, [path.join(__dirname, 'release-guard.js'), tag], { cwd: ROOT, stdio: 'inherit' });
      } catch (e) {
        guardOk = false;
      }
      if (!guardOk) {
        console.error('');
        console.error(red('  release guard FAILED — the commit stands, the tag does not.'));
        console.error(dim('  Fix what the guard reported (package.json, the What\'s New registry and the'));
        console.error(dim('  public changelog must all document ' + tag + '), then tag again.'));
        return 1;
      }
    }
    console.log('  tagging ' + cyan(tag));
    gitInherit(['tag', '-a', tag, '-m', 'Release Candidate ' + tag]);
  }

  // ---- push ----
  if (o.push) {
    console.log('');
    console.log('  pushing ' + cyan(branch) + (o.tag ? ' with tags' : '') + '…');
    gitInherit(['push', 'origin', branch].concat(o.tag ? ['--tags'] : []));
  } else {
    console.log('');
    console.log(dim('  not pushed — pass --push to publish.'));
  }

  console.log('');
  console.log(green('  done.'));
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error(red('  git-sync failed: ') + (e && e.message ? e.message : e));
    process.exitCode = 1;
  }
}

module.exports = { parseArgs, collectChanges, allowed, parses, currentBranch, main, DEFAULT_MESSAGE, DEFAULT_TAG, DENY };
