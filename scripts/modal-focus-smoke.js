#!/usr/bin/env node
// Modal focus trap wrap + selector.
'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function assert(cond, msg) { cond ? pass(msg) : fail(msg); }

let focus;
try {
  focus = require(path.join(ROOT, 'modules', 'modal-focus.js'));
} catch (e) {
  console.error('modal-focus-smoke FAILED — module missing: ' + e.message);
  process.exit(1);
}

console.log('== Focus trap ==');
assert(typeof focus.nextFocusIndex === 'function', 'nextFocusIndex is exported');
assert(focus.nextFocusIndex(0, 3, false) === 1, 'Tab moves to the next control');
assert(focus.nextFocusIndex(2, 3, false) === 0, 'Tab wraps from last to first');
assert(focus.nextFocusIndex(0, 3, true) === 2, 'Shift+Tab wraps from first to last');
assert(focus.nextFocusIndex(0, 0, false) === -1, 'empty trap has no next');
assert(/button|input|select|textarea|a\[href\]/.test(focus.FOCUSABLE || ''), 'selector covers interactive controls');

if (failed) {
  console.error('\nmodal-focus-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nmodal-focus-smoke PASSED');
