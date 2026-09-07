#!/usr/bin/env node
// Daily streak lives on AI Studio, not the dashboard home screen.
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

console.log('== Streak placement ==');
assert(!/id="streakRoot"/.test(section('view-dashboard')), 'dashboard no longer hosts the streak widget');
assert(/id="streakRoot"/.test(section('view-ai')), 'streak widget lives on AI Studio');
assert(!/sc-streak/.test(app) && !/Daily streak',\s*'🔥'/.test(app), 'dashboard stats no longer include a Daily streak card');

console.log('\n== Streak icon + refresh ==');
assert(/streak-ico">✦</.test(app), 'signed-out streak card uses the studio ✦ mark');
assert(!/streak-ico">🔥</.test(app), 'streak card no longer uses the fire emoji');
assert(/currentView === 'ai'/.test(app) && /renderStreakWidget/.test(app), 'claim unlock refreshes the widget on AI Studio');

if (failed) {
  console.error('\nstreak-placement-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nstreak-placement-smoke PASSED');
