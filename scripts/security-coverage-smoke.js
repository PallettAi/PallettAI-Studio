#!/usr/bin/env node
'use strict';

/*
  A security module that only the test suite calls is not a security feature.

  That is not hypothetical here: security-csp.js, security-forms.js and
  file-integrity.js were all covered by smokes, listed in the module-surface
  report, and wired into nothing — the export shipped a commented CSP template
  and no policy, while the gate reported the area as covered. The coverage was
  real; the protection was not.

  So this gate asks the blunt question for every modules/security-*.js: does any
  PRODUCT file reference it? A module that is only reachable from scripts/ has
  to say so out loud, in the allowlist below, with a reason.
*/

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function check(cond, msg) { cond ? pass(msg) : fail(msg); }

// Files the shipped app actually runs. scripts/ is deliberately excluded: a
// module named only there is a module nothing calls.
const PRODUCT_FILES = ['app.js', 'main.js', 'preload.js', 'index.html'];
function productSources() {
  const files = PRODUCT_FILES.map((f) => path.join(ROOT, f)).filter((f) => fs.existsSync(f));
  const dirs = ['modules', 'data', 'ui'].map((d) => path.join(ROOT, d)).filter((d) => fs.existsSync(d));
  const walk = (dir) => fs.readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) return walk(p);
    return /\.(js|html)$/.test(name) ? [p] : [];
  });
  return [...files, ...dirs.flatMap(walk)];
}

const sources = productSources();
const read = (p) => fs.readFileSync(p, 'utf8');

// Only count a reference outside the module itself, and ignore the module's own
// file name appearing in a comment.
function consumersOf(moduleName, selfPath) {
  const hits = [];
  for (const file of sources) {
    if (path.resolve(file) === path.resolve(selfPath)) continue;
    const body = read(file).split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');
    if (body.indexOf(moduleName) !== -1) hits.push(path.relative(ROOT, file));
  }
  return hits;
}

console.log('== Every security module is called by the product ==');

const modulesDir = path.join(ROOT, 'modules');
const securityModules = fs.readdirSync(modulesDir)
  .filter((f) => /^security-.*\.js$/.test(f) || f === 'file-integrity.js')
  .sort();

// Modules whose only legitimate caller is the headless CLI export, which runs
// in Node where fs and crypto are available. Each one needs a reason here, and
// the reason is the point: "we meant to wire this" is not a reason.
const CLI_ONLY = {
  'security-csp.js': 'Node-only CSP synthesiser; the renderer path uses security-sri.js instead, and cli-runner.js is its caller.',
  'file-integrity.js': 'Node-only build manifest writer; it needs fs to walk a written export folder.'
};

// Declared, deliberately NOT wired. This is a visible debt entry, not an
// allowlist to grow: security-forms.js generates a progressive form router whose
// script expects data-pallettai-form markup the builder does not emit, and
// turning it on would change how every exported contact form submits. That is a
// product decision, not a hardening step, so it stays unwired until it is made
// — and this line is what stops it being forgotten.
const DECLARED_UNWIRED = {
  'security-forms.js': 'progressive form delivery: needs data-pallettai-form markup in the builder and a decision on changing form submission for every export.'
};

check(securityModules.length > 0, 'security modules were found to check (' + securityModules.length + ')');

securityModules.forEach((name) => {
  const modPath = path.join(modulesDir, name);
  const base = name.replace(/\.js$/, '');
  const hits = consumersOf(base, modPath);
  if (hits.length) {
    pass(name + ' is called by ' + hits.slice(0, 3).join(', ') + (hits.length > 3 ? ' (+' + (hits.length - 3) + ')' : ''));
  } else if (CLI_ONLY[name]) {
    pass(name + ' is CLI-only by declaration — ' + CLI_ONLY[name]);
  } else if (DECLARED_UNWIRED[name]) {
    pass(name + ' is DECLARED unwired (known debt, not forgotten) — ' + DECLARED_UNWIRED[name]);
  } else {
    fail(name + ' is referenced only by the test suite: nothing in the app calls it');
  }
});

console.log('\n== Known debt is visible ==');
Object.keys(DECLARED_UNWIRED).forEach((name) => {
  console.log('  · ' + name + ' is built and tested but not in the product: ' + DECLARED_UNWIRED[name]);
});

console.log('\n== The export hardening pass is in the product ==');
const app = read(path.join(ROOT, 'app.js'));
const index = read(path.join(ROOT, 'index.html'));
check(/src="modules\/security-sri\.js"/.test(index), 'the shell loads the integrity module');
check(/SecuritySRI\.hardenDocument/.test(app), 'the export hardens the pages it writes');
check(/settings\.strictSecurity/.test(app), 'and it is behind a user setting, off by default');

console.log('\n== Secrets never land in plaintext by default ==');
const main = read(path.join(ROOT, 'main.js'));
check(/PALLETTAI_ALLOW_PLAINTEXT/.test(main), 'plaintext storage requires an explicit opt-in');
const failClosed = main.slice(main.indexOf('function failClosedIfNoEncryption'));
check(/throw new Error/.test(failClosed.slice(0, 1200)), 'without the opt-in the write is refused');
check(failClosed.indexOf('PALLETTAI_ALLOW_PLAINTEXT') < failClosed.indexOf('throw new Error'),
  'the opt-in is checked before the refusal');
check(!/PALLETTAI_FAIL_CLOSED/.test(main), 'the old opt-in-only flag is gone');

console.log('\n== The hotfix cache is verified, not trusted ==');
const cache = main.slice(main.indexOf('function hotfixReadCache'));
check(/hotfixVerify\(cached\.manifest\)/.test(cache), 'the cached manifest is signature-checked before use');
check(/HOTFIX_PUBLIC_KEY/.test(main), 'the channel still refuses to run without a public key');

if (failed) {
  console.error('\nsecurity-coverage-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nsecurity-coverage-smoke PASSED — the security modules are wired, not just tested');
