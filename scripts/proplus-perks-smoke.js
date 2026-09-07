#!/usr/bin/env node
// Unbranded exports and brand presets belong to Pro+, not Pro.
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

global.localStorage = {
  _d: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; }
};

const PLANS = require(path.join(ROOT, 'data', 'plans.js'));
const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function assert(cond, msg) { cond ? pass(msg) : fail(msg); }

const pro = PLANS.getPlan('pro').features.join('\n');
const plus = PLANS.getPlan('proplus').features.join('\n');

console.log('== Plan copy ==');
assert(!/Unbranded exports/.test(pro), 'Pro feature list no longer claims unbranded exports');
assert(!/brand presets/i.test(pro), 'Pro feature list no longer claims brand presets');
assert(/Unbranded exports/.test(plus), 'Pro+ feature list includes unbranded exports');
assert(/brand presets/i.test(plus), 'Pro+ feature list includes brand presets');
assert(/Everything in Pro/.test(plus), 'Pro+ still includes everything in Pro');

console.log('\n== Gates in the app ==');
assert(/proExport:\s*isProPlus\(\)/.test(app), 'exported sites drop the studio badge only on Pro+');
assert(/Reusable brand presets are a Pro\+ feature/.test(app), 'brand presets toast names Pro+');
assert(/if\s*\(!isProPlus\(\)\)/.test(app) && /openBrandPresets/.test(app), 'brand presets open is gated on Pro+');

if (failed) {
  console.error('\nproplus-perks-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nproplus-perks-smoke PASSED');
