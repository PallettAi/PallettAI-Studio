#!/usr/bin/env node
'use strict';

/*
  The export hardening pass is only worth anything if it is real.

  Before this existed, modules/security-csp.js, security-forms.js and
  file-integrity.js existed, were covered by the gate, and were called by
  nothing — the export shipped a commented CSP template and no policy. This
  pins the pass that is wired in its place:

    1. the policy is built from the page AS WRITTEN (hashes of its own inline
       scripts), so it describes the bytes that ship;
    2. script-src carries no 'unsafe-inline' — that is the whole point;
    3. the external origins the page already uses are allow-listed, and the
       contact form's endpoint is allowed to receive the submission;
    4. a document the policy cannot describe is left alone with a reason,
       never half-hardened;
    5. it is opt-in, so an export that nobody opted in is byte-identical.
*/

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRI = require(path.join(ROOT, 'modules', 'security-sri.js'));
const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function check(cond, msg) { cond ? pass(msg) : fail(msg); }

// A page shaped like a real export: inline builder script, inline styles, a
// remote hero image, a YouTube embed and a third-party form endpoint.
const page = [
  '<!doctype html><html><head><meta charset="utf-8"><title>Demo</title>',
  '<style>body{color:#111}</style>',
  '<script>window.__pai={v:1};document.documentElement.dataset.ready="1";</script>',
  '</head><body>',
  '<img src="https://images.example.com/hero.jpg" alt="">',
  '<iframe src="https://www.youtube.com/embed/abc"></iframe>',
  '<form action="https://api.web3forms.com/submit" method="post"></form>',
  '<script>window.addEventListener("load",function(){window.__paiAnalytics&&window.__paiAnalytics();});</script>',
  '</body></html>'
].join('');

console.log('== The pass is wired into the export ==');
check(/src="modules\/security-sri\.js"/.test(html), 'the integrity module is loaded by the shell');
check(/function strictSecurityPage\(/.test(app), 'a per-page hardening function exists');
check(/SecuritySRI\.hardenDocument\(/.test(app), 'the export calls hardenDocument');
check(/SecuritySRI\.injectCSPMeta\(/.test(app), 'the policy is carried by a meta tag');
check(/settings\.strictSecurity/.test(app), 'the pass is behind a setting');
check(/setStrictSecurity/.test(app), 'the setting has a control in Settings ▸ Export');
check(/id="setStrictSecurity"/.test(app), 'the control is rendered as a switch');

console.log('\n== It runs after minification, not before ==');
const exportFn = app.slice(app.indexOf('function exportFileList'));
check(/sitePageFiles\(c\)/.test(exportFn.slice(0, 2000)), 'the export builds its pages first');
check(/strictSecurityPages\(c, notes\)/.test(exportFn), 'the export routes its pages through the hardening pass');
const pagesFn = app.slice(app.indexOf('function strictSecurityPages'), app.indexOf('function exportFileList'));
check(/sitePageFiles\(c\)\.map/.test(pagesFn) && /strictSecurityPage\(f\.html/.test(pagesFn),
  'hardening is applied to the BUILT page, not to the source model');
// The builder minifies inside its own page build, so anything that touches the
// html string in app.js is already looking at the bytes that will ship.
const builderMinifies = fs.readFileSync(path.join(ROOT, 'modules', 'builder.js'), 'utf8');
check(/if \(settings\.minify\)/.test(builderMinifies), 'minification happens inside the builder, before the export sees the html');

console.log('\n== The policy is real ==');
const sources = {
  script: ['https://www.googletagmanager.com'],
  connect: ['https://www.googletagmanager.com', 'https://api.web3forms.com'],
  frame: ['https://www.youtube.com'],
  img: ['https://images.example.com'],
  media: ['https://images.example.com'],
  formAction: ['https://api.web3forms.com']
};
const res = SRI.hardenDocument(page, {}, { inlineAlgorithm: 'sha256', allowedSources: sources });
check(res.ok === true, 'the page hardens' + (res.ok ? '' : ' — ' + JSON.stringify(res.errors)));
check(res.inlineScripts === 2, 'both inline scripts are hashed (' + res.inlineScripts + ')');
check(/sha256-[A-Za-z0-9+/=]+/.test(res.csp), 'the policy carries sha256 hashes');
check(res.csp.indexOf("script-src 'unsafe-inline'") === -1, "script-src has no 'unsafe-inline'");
check(res.csp.indexOf("default-src 'none'") !== -1, "the policy starts from default-src 'none'");
check(res.csp.indexOf('https://www.googletagmanager.com') !== -1, 'the analytics origin is allowed to serve script');
check(res.csp.indexOf('https://api.web3forms.com') !== -1, 'the form endpoint is allowed');
check(/form-action[^;]*https:\/\/api\.web3forms\.com/.test(res.csp), 'form-action names the endpoint, so the contact form still submits');
check(res.csp.indexOf('https://images.example.com') !== -1, 'the hero image origin is allowed');
check(res.csp.indexOf('https://www.youtube.com') !== -1, 'the embed is allowed in frame-src');

console.log('\n== The hash really matches the shipped bytes ==');
const crypto = require('crypto');
const firstScript = (res.html.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || '';
const digest = crypto.createHash('sha256').update(firstScript, 'utf8').digest('base64');
check(res.csp.indexOf("'sha256-" + digest + "'") !== -1,
  'the policy hash is the hash of the script as written in the exported file');

console.log('\n== A page that cannot be described is left alone ==');
// A page carrying an inline on* handler cannot be given a hash-based policy —
// hashing covers <script> bodies, not event-handler attributes. The carrier has
// to refuse rather than ship a policy that silently breaks the button.
const handlerPage = page.replace('<form action=', '<button onclick=\'go()\'>x</button><form action=');
const handlerRes = SRI.hardenDocument(handlerPage, {}, { inlineAlgorithm: 'sha256', allowedSources: sources });
const handler = SRI.injectCSPMeta(handlerPage, handlerRes.csp, {});
check(handler.ok === false, 'an inline on* handler makes the policy refuse rather than break the page');
check(/inline handler/.test(String(handler.reason || '')), 'the refusal says why (' + handler.reason + ')');
check(handler.html === handlerPage, 'the refused document is returned untouched');
const forced = SRI.injectCSPMeta(handlerPage, handlerRes.csp, { force: true });
check(forced.ok === true, 'the force path exists for a page that has been reviewed');

console.log('\n== The page-side hasher is real, not a placeholder ==');
// The export pass runs in the renderer, where Node's crypto does not exist. If
// the portable path is wrong, the policy hashes nothing and either blocks every
// script or admits everything — either way the feature is worse than off. So
// the portable implementation is checked against Node's own digest, in a global
// that has no require and no Buffer, exactly as the page sees it.
const vm = require('vm');
const nodeCrypto = require('crypto');
const sriSrc = fs.readFileSync(path.join(ROOT, 'modules', 'security-sri.js'), 'utf8');
const cases = ['', 'a', 'abc', 'window.__pai={v:1};', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(63),
  'x'.repeat(64), 'x'.repeat(65), 'x'.repeat(4096), '<script>alert(1)</script>', 'héllo wörld ✓'];
const sandbox = {
  console, TextEncoder, Uint8Array, Uint32Array, DataView, ArrayBuffer, Math, JSON, Object, Array, String, Number,
  btoa: (s) => Buffer.from(s, 'binary').toString('base64')
};
vm.createContext(sandbox);
vm.runInContext(sriSrc + '\n;globalThis.__SRI = SecuritySRI;', sandbox);
const PageSRI = sandbox.__SRI;
check(!!PageSRI && typeof PageSRI.generateSRIHash === 'function', 'the module loads in a global with no require');
let mismatches = 0;
cases.forEach((input) => {
  const got = PageSRI.generateSRIHash(input, 'sha256');
  const want = 'sha256-' + nodeCrypto.createHash('sha256').update(Buffer.from(input, 'utf8')).digest('base64');
  if (!got.ok || got.digest !== want) mismatches++;
});
check(mismatches === 0, 'all ' + cases.length + ' portable sha256 digests match Node crypto');
const refused = PageSRI.generateSRIHash('x', 'sha384');
check(refused.ok === false && /needs Node crypto/.test(String(refused.error || '')),
  'sha384 is refused in the page rather than answered with a wrong digest');
check(SRI.generateSRIHash('abc', 'sha512').ok === true, 'Node still gets the full algorithm set');

console.log('\n== Opt-in means opt-in ==');
const guarded = app.slice(app.indexOf('function exportFileList'), app.indexOf('function appVersion'));
check(/settings\.strictSecurity \? strictSecurityPages\(c, notes\) : sitePageFiles\(c\)\.map/
  .test(guarded.replace(/\s+/g, ' ')), 'with the setting off the pages are returned untouched');
check(/if \(settings\.strictSecurity && notes\.length\)/.test(guarded), 'hardening notes are surfaced when it runs');

if (failed) {
  console.error('\nstrict-export-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nstrict-export-smoke PASSED — exports can carry a real policy');
