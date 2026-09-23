#!/usr/bin/env node
// ============================================================
// PallettAI Studio — production deploy
// ------------------------------------------------------------
//   node scripts/production-deploy.js                 PLAN ONLY (dry run)
//   node scripts/production-deploy.js --confirm --target cloudflare
//
// Publishes a built site through `modules/deploy.js` (Cloudflare
// Pages / Netlify / GitHub Pages) and reports the URL, the commit
// SHA and the deployment telemetry.
//
// ---- three things this script refuses to do ----------------
//
// 1. It never pretends to have deployed. A dry run says so, and a
//    missing credential is reported by NAME rather than surfacing as
//    a provider error three layers down — `deploy.js` throws
//    `missing_credential`, which is accurate but tells you nothing
//    about where to paste the token.
//
// 2. It never deploys without `--confirm`. Publishing replaces what
//    visitors see; that is not a step to take because a flag was
//    absent.
//
// 3. It never deploys a directory that is not a site. An empty or
//    missing output directory is a build that did not happen, and
//    deploying it would replace a working site with nothing.
//
// Credentials are read from the environment only, and are never
// written, logged, or echoed — not even when reported missing.
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

const COLOR = !process.env.NO_COLOR && (process.env.FORCE_COLOR || (process.stdout && process.stdout.isTTY));
const paint = (c) => (t) => (COLOR ? '\u001b[' + c + 'm' + t + '\u001b[0m' : String(t));
const red = paint('31');
const green = paint('32');
const yellow = paint('33');
const cyan = paint('36');
const dim = paint('2');
const bold = paint('1');

/*
  What each target needs, by environment variable name. Cloudflare
  and Netlify take an API token; GitHub Pages takes a token with
  repo scope. Reading them by name keeps the failure actionable.
*/
const TARGETS = {
  cloudflare: { label: 'Cloudflare Pages', vars: ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'], project: 'CLOUDFLARE_PROJECT_NAME' },
  netlify: { label: 'Netlify', vars: ['NETLIFY_AUTH_TOKEN'], project: 'NETLIFY_SITE_ID' },
  github: { label: 'GitHub Pages', vars: ['GITHUB_TOKEN'], project: 'GITHUB_PAGES_REPO' }
};

function parseArgs(argv) {
  const args = Array.isArray(argv) ? argv.slice() : [];
  const o = { confirm: false, target: '', out: 'dist', branch: '', message: '', help: false, skipBuild: false };
  for (let i = 0; i < args.length; i++) {
    const raw = args[i];
    const eq = raw.indexOf('=');
    const name = eq === -1 ? raw : raw.slice(0, eq);
    const inline = eq === -1 ? null : raw.slice(eq + 1);
    const value = () => (inline !== null ? inline : args[++i]);
    if (name === '--confirm') o.confirm = true;
    else if (name === '--target') o.target = String(value() || '').toLowerCase();
    else if (name === '--out') o.out = String(value() || 'dist');
    else if (name === '--branch') o.branch = String(value() || '');
    else if (name === '--message') o.message = String(value() || '');
    else if (name === '--skip-build') o.skipBuild = true;
    else if (name === '--help' || name === '-h') o.help = true;
  }
  return o;
}

function usage() {
  return [
    'PallettAI Studio — production deploy',
    '',
    '  node scripts/production-deploy.js --target <target> [--confirm] [flags]',
    '',
    '  --target <name>   cloudflare | netlify | github   (default: the only one configured)',
    '  --out <dir>       directory to publish (default ./dist)',
    '  --branch <name>   provider branch label (default: the current git branch)',
    '  --message <text>  deploy message',
    '  --skip-build      publish the existing --out directory as-is',
    '  --confirm         actually publish (default: plan only)',
    '  --help            this text',
    '',
    '  Credentials are read from the environment:',
    ...Object.keys(TARGETS).map((k) => '    ' + TARGETS[k].label.padEnd(18) + TARGETS[k].vars.join(', ') + '  [' + TARGETS[k].project + ']'),
    '',
    '  Exit codes: 0 deployed, 2 not configured, 1 the deploy failed.'
  ].join('\n');
}

function gitSha() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch (e) {
    return '';
  }
}

function gitBranch() {
  try {
    const b = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
    return b === 'HEAD' ? '' : b;
  } catch (e) {
    return '';
  }
}

function configured() {
  return Object.keys(TARGETS).filter((k) => TARGETS[k].vars.every((v) => String(process.env[v] || '').trim()));
}

/*
  A deploy directory is only a site if it has an index. Checking here
  means a build that silently produced nothing cannot replace a
  working deployment with emptiness.
*/
function inspectOut(dir) {
  const abs = path.resolve(ROOT, dir);
  if (!fs.existsSync(abs)) return { ok: false, abs, reason: 'does not exist' };
  let entries = [];
  try { entries = fs.readdirSync(abs); } catch (e) { return { ok: false, abs, reason: 'unreadable' }; }
  if (!entries.length) return { ok: false, abs, reason: 'is empty' };
  const hasIndex = entries.some((f) => /^index\.html?$/i.test(f));
  if (!hasIndex) return { ok: false, abs, reason: 'has no index.html' };
  let bytes = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else { try { bytes += fs.statSync(f).size; } catch (err) { /* vanished */ } }
    }
  };
  try { walk(abs); } catch (e) { /* report what we have */ }
  return { ok: true, abs, files: entries.length, bytes };
}

async function main(argv) {
  const o = parseArgs(argv);
  if (o.help) { console.log(usage()); return 0; }

  console.log(bold('PallettAI Studio') + ' — production deploy' + (o.confirm ? red('  (CONFIRMED)') : dim('  (plan only)')));
  console.log('');

  const ready = configured();
  if (!ready.length) {
    console.error(red('  no deployment target is configured.'));
    console.error('');
    console.error('  Set the credentials for one target and run again:');
    Object.keys(TARGETS).forEach((k) => {
      console.error('    ' + cyan(k.padEnd(12)) + TARGETS[k].label.padEnd(18) + dim(TARGETS[k].vars.join(' + ')));
    });
    console.error('');
    console.error(dim('  Nothing was published.'));
    return 2;
  }

  let target = o.target;
  if (!target) {
    if (ready.length > 1) {
      console.error(yellow('  more than one target is configured; pass --target ' + ready.join(' | ')));
      return 2;
    }
    target = ready[0];
    console.log('  targeted ' + cyan(target) + dim(' (the only configured provider)'));
  }
  if (!TARGETS[target]) {
    console.error(red('  unknown target "' + target + '" — expected one of ' + Object.keys(TARGETS).join(', ')));
    return 2;
  }
  const missing = TARGETS[target].vars.filter((v) => !String(process.env[v] || '').trim());
  if (missing.length) {
    console.error(red('  ' + TARGETS[target].label + ' is missing: ' + missing.join(', ')));
    console.error(dim('  (names only — no credential value is read, logged or echoed)'));
    return 2;
  }

  // ---- what we would publish ----
  const out = inspectOut(o.out);
  if (!out.ok) {
    console.error(red('  refusing to deploy: ' + o.out + ' ' + out.reason + '.'));
    console.error(dim('  Publishing that would replace a working site with nothing. Build first.'));
    return 1;
  }
  const sha = gitSha();
  const branch = o.branch || gitBranch() || 'main';
  console.log('  source:  ' + out.abs + dim(' (' + out.files + ' entries at the root, ' + out.bytes + ' bytes)'));
  console.log('  commit:  ' + (sha || dim('(not a git repository)')));
  console.log('  branch:  ' + branch);
  console.log('  provider:' + ' ' + TARGETS[target].label);

  if (!o.confirm) {
    console.log('');
    console.log(dim('  plan only: re-run with --confirm to publish.'));
    return 0;
  }

  // ---- run the adapters ----
  const Deploy = require(path.join(ROOT, 'modules', 'deploy.js'));
  let Environments = null;
  try { Environments = require(path.join(ROOT, 'modules', 'deploy-environments.js')); } catch (e) { Environments = null; }

  const started = Date.now();
  let result = null;
  try {
    if (Environments && typeof Environments.deployToEnvironment === 'function') {
      result = await Environments.deployToEnvironment({
        target,
        outDir: out.abs,
        branch,
        message: o.message || 'release ' + (sha || 'local'),
        env: process.env
      });
    } else if (typeof Deploy.publishSite === 'function') {
      result = await Deploy.publishSite({
        provider: target,
        dir: out.abs,
        branch,
        message: o.message || 'release ' + (sha || 'local'),
        env: process.env
      });
    } else {
      throw new Error('no deployment entry point was found in modules/deploy.js');
    }
  } catch (e) {
    console.error('');
    console.error(red('  deploy FAILED: ') + (e && e.message ? e.message : e));
    if (e && e.code) console.error(dim('  code: ' + e.code));
    return 1;
  }
  const ms = Date.now() - started;

  console.log('');
  console.log(green('  DEPLOYED'));
  console.log('  url:       ' + ((result && (result.url || result.deployUrl)) || dim('(provider returned no URL)')));
  console.log('  commit:    ' + (sha || dim('(unknown)')));
  console.log('  provider:  ' + TARGETS[target].label);
  console.log('  duration:  ' + ms + 'ms');
  if (result && result.id) console.log('  deploy id: ' + result.id);
  if (result && result.files) console.log('  files:     ' + result.files);
  console.log('');
  console.log(dim('  telemetry: ' + JSON.stringify({
    target, sha: sha || null, branch, ms,
    files: out.files, bytes: out.bytes,
    id: (result && result.id) || null,
    url: (result && (result.url || result.deployUrl)) || null
  })));
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((e) => {
      console.error(red('  production-deploy failed: ') + (e && e.stack ? e.stack : e));
      process.exitCode = 1;
    });
}

module.exports = { parseArgs, usage, configured, inspectOut, TARGETS, main };
