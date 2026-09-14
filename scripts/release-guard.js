#!/usr/bin/env node
// ============================================================
// PallettAI Studio — release guard
// ------------------------------------------------------------
// Runs on a tag, before the signed build spends ten minutes of CI time and
// publishes an auto-update to every installed copy.
//
// The workflow already checks that the tag matches package.json. That is not
// enough to make a release honest. The 0.4.2 release is the case in point:
// the version was bumped on main, and the site's changelog was left with no
// entry for it, so the one page a customer reads to find out what changed
// said nothing — while the download page silently served the new build.
//
// So this checks three things that must agree before anything is published:
//
//   1. the tag matches package.json               (already checked upstream)
//   2. the What's New registry matches the package (the modal would otherwise
//      announce the wrong version)
//   3. the website's changelog actually documents the version
//
// (3) is the one that was missing. It reads the public changelog, so a local
// run with --offline and a --changelog path is supported and is how the smoke
// test exercises it.
//
// Usage:
//   node scripts/release-guard.js v0.4.3
//   node scripts/release-guard.js --tag v0.4.3 --changelog ../pallettai-website/changelog.html
//   node scripts/release-guard.js --offline          (skip the changelog check)
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CHANGELOG_URL = 'https://raw.githubusercontent.com/PallettAi/pallettai-website/main/changelog.html';

// ---- pure checks ----------------------------------------------------------
// Kept separate from I/O so the smoke test can drive them with fixtures.

// Is this exact version documented in the changelog HTML? Matched on the
// version as a whole word so `0.4.2` is not satisfied by `0.4.20`.
function documentsVersion(html, version) {
  const v = String(version || '').trim();
  if (!v) return false;
  const escaped = v.replace(/\./g, '\\.');
  return new RegExp('(^|[^0-9.])' + escaped + '([^0-9.]|$)').test(String(html || ''));
}

function versionOfTag(tag) {
  return String(tag || '').trim().replace(/^v/i, '');
}

function check(opts) {
  const o = opts || {};
  const problems = [];
  const notes = [];

  const pkgVersion = o.packageVersion;
  const tagVersion = versionOfTag(o.tag);

  if (!pkgVersion) problems.push('package.json has no version');
  if (!tagVersion) problems.push('no tag was given (pass v1.2.3 or set GITHUB_REF_NAME)');

  if (pkgVersion && tagVersion && pkgVersion !== tagVersion) {
    problems.push('tag ' + tagVersion + ' does not match package.json ' + pkgVersion);
  }

  if (o.notesVersion && pkgVersion && o.notesVersion !== pkgVersion) {
    problems.push('What\'s New registry says ' + o.notesVersion + ' but package.json says ' + pkgVersion + ' — the update modal would announce the wrong version');
  }
  if (o.notesVersion && pkgVersion && o.notesVersion === pkgVersion) {
    notes.push('What\'s New registry matches ' + pkgVersion);
  }

  const version = tagVersion || pkgVersion;
  if (o.changelogHtml == null) {
    notes.push('changelog check skipped (offline)');
  } else if (!version) {
    problems.push('cannot check the changelog without a version');
  } else if (!documentsVersion(o.changelogHtml, version)) {
    problems.push('the website changelog has no entry for ' + version + ' — the release would ship undocumented');
  } else {
    notes.push('the website changelog documents ' + version);
  }

  return { ok: problems.length === 0, problems: problems, notes: notes, version: version };
}

// ---- I/O ------------------------------------------------------------------
async function loadChangelog(o) {
  if (o.offline) return null;
  if (o.changelogPath) {
    return fs.readFileSync(o.changelogPath, 'utf8');
  }
  // A sibling checkout is the fastest local path and needs no network.
  const sibling = path.join(ROOT, '..', 'pallettai-website', 'changelog.html');
  if (fs.existsSync(sibling)) return fs.readFileSync(sibling, 'utf8');
  if (typeof fetch === 'function') {
    const res = await fetch(CHANGELOG_URL, { redirect: 'follow' });
    if (!res.ok) throw new Error('could not read the changelog (HTTP ' + res.status + ')');
    return await res.text();
  }
  throw new Error('no changelog source available and fetch() is missing');
}

function parseArgs(argv) {
  const out = { tag: '', changelogPath: '', offline: false, selfTest: false, json: false };
  const args = Array.isArray(argv) ? argv.slice() : [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--tag') out.tag = args[++i] || '';
    else if (a === '--changelog') out.changelogPath = args[++i] || '';
    else if (a === '--offline') out.offline = true;
    else if (a === '--self-test') out.selfTest = true;
    else if (a === '--json') out.json = true;
    else if (!a.startsWith('--')) out.tag = a;
  }
  if (!out.tag && process.env.GITHUB_REF_NAME) out.tag = process.env.GITHUB_REF_NAME;
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.selfTest) {
    const results = [
      ['a matching tag passes', check({ packageVersion: '1.2.3', tag: 'v1.2.3', notesVersion: '1.2.3', changelogHtml: 'Studio 1.2.3 is ready' }).ok === true],
      ['a mismatched tag fails', check({ packageVersion: '1.2.3', tag: 'v1.2.4', changelogHtml: 'x' }).ok === false],
      ['an undocumented version fails', check({ packageVersion: '1.2.3', tag: 'v1.2.3', notesVersion: '1.2.3', changelogHtml: 'Studio 1.2.2 only' }).ok === false],
      ['a drifted registry fails', check({ packageVersion: '1.2.3', tag: 'v1.2.3', notesVersion: '1.2.2', changelogHtml: '1.2.3' }).ok === false],
      ['0.4.2 is not satisfied by 0.4.20', documentsVersion('version 0.4.20 here', '0.4.2') === false],
      ['an exact version is found', documentsVersion('version 0.4.2 here', '0.4.2') === true]
    ];
    let bad = 0;
    results.forEach(([name, pass]) => { console.log((pass ? '  ✓ ' : '  ✗ ') + name); if (!pass) bad++; });
    process.exit(bad === 0 ? 0 : 1);
  }

  let pkgVersion = '';
  try { pkgVersion = require(path.join(ROOT, 'package.json')).version; } catch (e) { pkgVersion = ''; }
  let notesVersion = '';
  try { notesVersion = require(path.join(ROOT, 'data', 'release-notes.js')).version; } catch (e) { notesVersion = ''; }

  let changelogHtml = null;
  let changelogError = '';
  try {
    changelogHtml = await loadChangelog(args);
  } catch (e) {
    changelogError = (e && e.message) || String(e);
    if (!args.offline) {
      // A guard that cannot see the changelog must not claim the release is
      // documented. It fails, and says exactly why.
      console.error('::error::The release guard could not read the website changelog: ' + changelogError);
      process.exit(1);
    }
    changelogHtml = null;
  }

  const result = check({ packageVersion: pkgVersion, tag: args.tag, notesVersion: notesVersion, changelogHtml: changelogHtml });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  }

  console.log('Release guard — ' + (result.version || 'unknown version'));
  result.notes.forEach((n) => console.log('  ✓ ' + n));
  result.problems.forEach((p) => console.log('  ✗ ' + p));
  if (!result.ok) {
    result.problems.forEach((p) => console.log('::error::' + p));
    console.log('\nRELEASE GUARD FAILED — nothing was published.');
    process.exit(1);
  }
  console.log('\nRELEASE GUARD PASSED.');
}

if (require.main === module) {
  main().catch((e) => {
    console.error('::error::Release guard crashed: ' + ((e && e.message) || e));
    process.exit(1);
  });
}

module.exports = { check, documentsVersion, versionOfTag, parseArgs };
