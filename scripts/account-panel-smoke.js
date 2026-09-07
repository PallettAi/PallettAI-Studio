#!/usr/bin/env node
// Signed-in Settings shows a subscription-account state, not the sign-in form.
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function assert(cond, msg) { cond ? pass(msg) : fail(msg); }

console.log('== Signed-in account panel ==');
assert(/acc-signed/.test(app), 'signed-in markup uses a distinct acc-signed panel');
assert(/Subscription account/.test(app), 'panel is named Subscription account');
assert(/manag(e|es) your (PallettAI Studio )?plan/.test(app), 'copy says the account manages the plan');
assert(/not (used on|shown on) (exported )?client sites/.test(app) || /does not appear on sites you export/.test(app), 'copy says it is not for client sites');
assert(/acc-signed/.test(app) && /btnAccSubmit/.test(app), 'signed-in panel and sign-in form are separate branches');
assert(!/Cloud registry · verified/.test(app), 'old signed-in badge copy is gone');

if (failed) {
  console.error('\naccount-panel-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\naccount-panel-smoke PASSED');
