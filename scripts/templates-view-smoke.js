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

if (failed) {
  console.error('\ntemplates-view-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\ntemplates-view-smoke PASSED');
