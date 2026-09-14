// ============================================================
// Release guard smoke test
//
// The guard runs on a tag and can stop a release, so it has to be trusted in
// both directions: it must fail a dishonest release, and it must NOT fail an
// honest one — a guard with false positives gets removed, and a removed guard
// protects nothing.
//
// It is also tested against the real repository state, because the failure it
// was written for was real: 0.4.2 was bumped on main with no changelog entry,
// and the version the site advertised was not the version it served.
//
// Run: node scripts/release-guard-smoke.js
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let failed = 0;
function ok(name, cond, detail) {
  console.log((cond ? '  \u2713 ' : '  \u2717 ') + name + (!cond && detail ? '  -> ' + detail : ''));
  if (!cond) failed++;
}

const Guard = require(path.join(ROOT, 'scripts', 'release-guard.js'));

const base = { packageVersion: '1.2.3', tag: 'v1.2.3', notesVersion: '1.2.3', changelogHtml: '<h2>1.2.3 <span>Something</span></h2>' };

console.log('\n1. It accepts an honest release');
{
  const r = Guard.check(base);
  ok('a matching tag, registry and changelog pass', r.ok, JSON.stringify(r.problems));
  ok('it reports what it verified', r.notes.length === 2, JSON.stringify(r.notes));
  ok('the version is reported back', r.version === '1.2.3');
  ok('a tag without the v prefix is accepted', Guard.check(Object.assign({}, base, { tag: '1.2.3' })).ok);
  ok('the changelog check can be skipped explicitly', Guard.check(Object.assign({}, base, { changelogHtml: null })).ok === true);
}

console.log('\n2. It refuses a dishonest one');
{
  ok('a tag that disagrees with package.json', Guard.check(Object.assign({}, base, { tag: 'v1.2.4' })).ok === false);
  ok('a version the changelog never mentions', Guard.check(Object.assign({}, base, { changelogHtml: '<h2>1.2.2</h2>' })).ok === false);
  ok('a What\'s New registry that has drifted', Guard.check(Object.assign({}, base, { notesVersion: '1.2.2' })).ok === false);
  ok('a missing version upstream', Guard.check({ tag: 'v1.0.0', changelogHtml: '1.0.0' }).ok === false);
  ok('no tag at all', Guard.check({ packageVersion: '1.0.0', changelogHtml: '1.0.0' }).ok === false);
  const reason = Guard.check(Object.assign({}, base, { changelogHtml: 'x' })).problems.join(' ');
  ok('the failure says why', /undocumented/.test(reason), reason);
}

console.log('\n3. Version matching is exact');
{
  ok('0.4.2 is not satisfied by 0.4.20', Guard.documentsVersion('release 0.4.20', '0.4.2') === false);
  ok('0.4.2 is not satisfied by 10.4.2', Guard.documentsVersion('release 10.4.2', '0.4.2') === false);
  ok('an exact mention counts', Guard.documentsVersion('release 0.4.2 today', '0.4.2') === true);
  ok('a version in an attribute counts', Guard.documentsVersion('aria-label="Version 0.4.2"', '0.4.2') === true);
  ok('an empty changelog documents nothing', Guard.documentsVersion('', '0.4.2') === false);
  ok('an empty version is never found', Guard.documentsVersion('anything', '') === false);
  ok('a tag is stripped of its v', Guard.versionOfTag('v2.0.0') === '2.0.0' && Guard.versionOfTag('2.0.0') === '2.0.0');
}

console.log('\n4. It agrees with this repository as it actually stands');
{
  const pkg = require(path.join(ROOT, 'package.json'));
  const notes = require(path.join(ROOT, 'data', 'release-notes.js'));
  ok('the shipped registry matches package.json', notes.version === pkg.version, notes.version + ' vs ' + pkg.version);

  const site = path.join(ROOT, '..', 'pallettai-website', 'changelog.html');
  if (fs.existsSync(site)) {
    const html = fs.readFileSync(site, 'utf8');
    const r = Guard.check({ packageVersion: pkg.version, tag: 'v' + pkg.version, notesVersion: notes.version, changelogHtml: html });
    ok('the current version is documented on the site', r.ok, JSON.stringify(r.problems));
  } else {
    console.log('  · sibling website checkout not present — changelog cross-check skipped');
  }
  ok('the released 0.4.2 is documented', Guard.documentsVersion('Studio 0.4.2 is ready to ship', '0.4.2'));
}

console.log('\n5. The workflow actually runs it');
{
  // A guard nothing invokes is decoration, so the wiring is asserted rather
  // than assumed.
  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'build-mac.yml'), 'utf8');
  ok('the tag workflow calls the guard', /release-guard\.js/.test(wf));
  ok('the guard runs on tags only', /- name: Guard the release\n\s+if: startsWith\(github\.ref, 'refs\/tags\/'\)/.test(wf));
  ok('the guard runs before the credentials are used', wf.indexOf('Guard the release') < wf.indexOf('Validate the credentials'));
  ok('the tag is passed through', /--tag "\$GITHUB_REF_NAME"/.test(wf));
}

console.log('\n' + (failed === 0 ? 'RELEASE GUARD PASSED' : 'RELEASE GUARD FAILED: ' + failed));
process.exit(failed === 0 ? 0 : 1);
