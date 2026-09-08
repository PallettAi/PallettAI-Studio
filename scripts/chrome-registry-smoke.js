#!/usr/bin/env node
// Color Lab chrome: registry, icons, brand tokens, official copy.
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function assert(cond, msg) { cond ? pass(msg) : fail(msg); }

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

let CHROME;
let ICONS;
try {
  CHROME = require(path.join(ROOT, 'data', 'chrome.js'));
} catch (e) {
  fail('chrome.js loads: ' + e.message);
}
try {
  ICONS = require(path.join(ROOT, 'data', 'icons.js'));
} catch (e) {
  fail('icons.js loads: ' + e.message);
}

const REQUIRED = ['dashboard', 'templates', 'designer', 'ai', 'suites', 'database', 'settings', 'qr'];
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]|＋|✦|🔒|🧭|🎨|🧩|🗄️|💎|🚀|📁|💾|🪄|👁|⬇|🗑|⧉|🌐|🎁|🩺|🛡|📋|⏱|↩|↪/u;

console.log('== Registry ==');
assert(CHROME && Array.isArray(CHROME.views) && CHROME.views.length >= 8, 'CHROME.views lists the studio surfaces');
if (CHROME && Array.isArray(CHROME.views)) {
  const ids = CHROME.views.map((v) => v.id);
  REQUIRED.forEach((id) => assert(ids.includes(id), 'registry has ' + id));
  CHROME.views.forEach((v) => {
    assert(v.id && v.label && v.blurb && v.icon && v.group, v.id + ' has id, label, blurb, icon, group');
    assert(Array.isArray(v.chip) && v.chip.length === 4, v.id + ' has a 4-swatch chip');
    assert(!EMOJI.test(v.label) && !EMOJI.test(v.blurb), v.id + ' copy has no emoji');
    assert(ICONS && typeof ICONS.svg === 'function' && ICONS.svg(v.icon).indexOf('<svg') !== -1, v.id + ' icon exists in ICONS');
  });
  assert(typeof CHROME.view === 'function' && CHROME.view('templates') && CHROME.view('templates').label === 'Templates', 'CHROME.view looks up a surface');
  assert(typeof CHROME.viewTitle === 'function' && CHROME.viewTitle('templates') === 'Templates', 'CHROME.viewTitle returns Templates');
  assert(typeof CHROME.tiles === 'function' && CHROME.tiles().length >= 3, 'CHROME.tiles lists dashboard actions');
}

console.log('\n== Shell wiring ==');
assert(/data\/icons\.js/.test(html) && /data\/chrome\.js/.test(html), 'index.html loads icons.js and chrome.js');
const iconAt = html.indexOf('data/icons.js');
const chromeAt = html.indexOf('data/chrome.js');
const appAt = html.indexOf('app.js');
assert(iconAt > -1 && chromeAt > -1 && appAt > iconAt && appAt > chromeAt, 'registry scripts load before app.js');
REQUIRED.forEach((id) => assert(html.indexOf('data-view="' + id + '"') !== -1, 'sidebar keeps data-view=' + id));
assert(/nav-chip/.test(html) || /nav-chip/.test(app), 'chip rail markup exists');
assert(/IBM Plex Sans/.test(css) && /IBM Plex Mono/.test(css), 'UI type is IBM Plex');
assert(/--radius-ctrl:\s*6px/.test(css) && /--radius-tray:\s*10px/.test(css), 'instrument radii are 6px / 10px');
assert(/--primary:\s*#7c5cff/.test(css) && /--accent:\s*#22d3ee/.test(css), 'brand violet and cyan stay locked');
assert(/\.btn\.primary\{[^}]*background:\s*var\(--primary\)/.test(css.replace(/\s+/g, '')), 'primary buttons are flat violet');
assert(!/CORE TOOLS/.test(app) && !/Everything you need to ship/.test(app), 'generic CORE TOOLS dashboard is gone');
assert(!/Design stunning/.test(html), 'marketing hero line is gone');
assert(/id="dashTemplates"/.test(html) && /id="btnNewProject"/.test(html), 'dashboard keeps Templates doorway and New project');
assert(/CHROME\.viewTitle|chromeViewTitle/.test(app), 'switchView titles read from the registry');

if (failed) {
  console.error('\nchrome-registry-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nchrome-registry-smoke PASSED');
