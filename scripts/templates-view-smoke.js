#!/usr/bin/env node
// Templates live on their own view; the dashboard only keeps a doorway card.
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function assert(cond, msg) { cond ? pass(msg) : fail(msg); }

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

function section(id) {
  const start = html.indexOf('id="' + id + '"');
  if (start < 0) return '';
  const open = html.lastIndexOf('<section', start);
  const end = html.indexOf('</section>', start);
  return end > open ? html.slice(open, end) : '';
}

console.log('== Templates view markup ==');
assert(/data-view="templates"/.test(html), 'sidebar has a Templates nav item');
assert(/id="view-templates"/.test(html), 'templates view exists');
assert(/id="tplGrid"/.test(section('view-templates')), 'template grid lives on the Templates view');
assert(!/id="tplGrid"/.test(section('view-dashboard')), 'dashboard no longer hosts the template grid');
assert(/id="dashTemplates"/.test(section('view-dashboard')), 'dashboard keeps a Start from a template doorway');

console.log('\n== Navigation + start flow ==');
assert(/templates:\s*'Templates'/.test(app), 'switchView titles include Templates');
assert(/if \(name === 'templates'\) renderTemplates\(\)/.test(app), 'opening Templates renders the catalog');
assert(/switchView\('templates'\)/.test(app) && /btnNewProject/.test(app), 'New project opens the Templates view');
assert(/sel:\s*'#dashTemplates'/.test(app) || /sel:\s*'\[data-view="templates"\]'/.test(app), 'tour points at the doorway or Templates nav');

// ============================================================
// The Pro gate is the property worth guarding, because the bug it fixes was
// structural rather than a slip: the tier was checked inside ONE click handler,
// so the second route into a project — the preview modal — had no check at all
// and a Pro template was two clicks away for free. These assert the shape that
// makes that impossible, not the string that happens to implement it today.
// ============================================================

// Return the body of a named function by brace-matching, so an assertion about
// ordering inside a function is about that function and not one that follows it.
function fnBody(name) {
  const at = app.indexOf('function ' + name + '(');
  if (at < 0) return '';
  const open = app.indexOf('{', at);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < app.length; i++) {
    const c = app[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return app.slice(open, i + 1); }
  }
  return '';
}

const create = fnBody('createProject');
const allow = fnBody('templateAllowed');
const capacity = fnBody('ensureProjectCapacity');
const pricing = fnBody('openPricing');

console.log('\n== The Pro gate cannot be walked around ==');

const gated = /templateAllowed\(/.test(create);
assert(create.length > 0 && allow.length > 0, 'both createProject and templateAllowed exist');
assert(gated, 'createProject is gated');
// Each ordering check carries its own existence clause. Without it these pass
// vacuously on the broken code, because indexOf() returns -1 for a gate that
// isn't there and -1 sorts before everything — a passing line that means nothing
// is worse than a failing one, and these two are exactly the assertions the bug
// would have had to get past.
assert(gated && create.indexOf('templateAllowed(') < create.indexOf('projects.unshift'),
  'the gate runs BEFORE a project is stored');
assert(gated && create.indexOf('templateAllowed(') < create.indexOf('ensureProjectCapacity('),
  'tier is checked before capacity, so the reason given is the true one');

assert(/PLANS\.proTemplates/.test(allow), 'the gate reads the Pro tier list');
assert(/openPricing\(/.test(allow), 'a locked template opens the upgrade screen');
assert(/isPro\(\)/.test(allow), 'a Pro account passes the gate');

// The regression itself: no second handler re-implements the tier check.
const gridHandler = app.slice(app.indexOf('#tplGrid [data-use]'), app.indexOf('#tplGrid [data-prev]'));
assert(gridHandler.length > 0, 'the Templates grid has a click handler');
assert(!/proTemplates/.test(gridHandler),
  'the grid handler does NOT re-check the tier — the gate lives in one place');
assert(/createProject\(/.test(gridHandler), 'the grid handler starts a project through createProject');

assert(/createProject\(tpl\)/.test(app), 'the preview modal starts a project through createProject, so it is gated too');

console.log('\n== A blocked click says why ==');
assert(/function openPricing\(reason\)/.test(app), 'openPricing accepts a reason');
assert(/price-reason/.test(app), 'the reason is rendered in the modal');
assert(/price-reason/.test(fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8')), 'the reason is styled');
const explained = /openPricing\(`/.test(capacity);
assert(explained, 'the project limit explains itself rather than opening a bare paywall');
assert(explained && /\$\{projects\.length\}/.test(capacity), 'that explanation names the actual count');

if (failed) {
  console.error('\ntemplates-view-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\ntemplates-view-smoke PASSED');
