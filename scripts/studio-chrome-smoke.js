#!/usr/bin/env node
// 0.3.8 chrome: leftovers gone, system theme, SVG nav, export note, auth, palette.
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const supabase = fs.readFileSync(path.join(ROOT, 'modules', 'supabase.js'), 'utf8');

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function assert(cond, msg) { cond ? pass(msg) : fail(msg); }

console.log('== Launch leftovers ==');
assert(!/btnSimRef/.test(app), 'Simulate a friend redeeming is gone');
assert(!/✦ Upgrade/.test(app), 'sparkle Upgrade label is gone');
assert(!/Paid billing still needs a payments provider/.test(readme), 'README no longer says billing is unwired');
assert(/Stripe/.test(readme) && /Payment Link/.test(readme), 'README names Stripe Payment Links');

console.log('\n== Billing failure + receipt ==');
assert(/billing_status/.test(app), 'Settings/sync reads billing_status');
assert(/failureCopy|are back on Free/.test(app), 'failed payment copy is shown');
assert(/receiptLines|Plan receipt|Renews/.test(app), 'account card shows a plan receipt');
assert(!/btnDowngrade/.test(app) || !/Switch to Free/.test(app.split('Plan & billing')[1] || ''), 'Settings billing has no local Switch to Free');

console.log('\n== Password ==');
assert(/resetPassword/.test(supabase), 'client can send a reset email');
assert(/updatePassword/.test(supabase), 'client can change password');
assert(/Forgot password|forgot password/.test(app), 'sign-in form has Forgot password');
assert(/Change password|New password/.test(app), 'signed-in card can change password');

console.log('\n== Paid return ==');
assert(/paidReturnUrl|isPaidReturn|\?paid=1/.test(app), 'Studio handles a paid=1 return');
assert(/Waiting for Stripe|waiting for payment|Unlocking/.test(app), 'checkout shows a waiting-for-payment state');

console.log('\n== Export note ==');
assert(/sites are files|plain HTML/.test(app) && /not tenants|you own it/.test(app), 'export says the site is files the client owns');

console.log('\n== Settings billing restyle ==');
assert(/plan-bill|bill-rail/.test(app) && /plan-bill|bill-rail/.test(css), 'Plan & billing uses the rail language');
assert(!/pb-ico/.test(app), 'sparkle plan badge is gone from Settings');

console.log('\n== Command palette ==');
assert(/cmdPalette|command-palette/.test(html), 'palette markup is in the shell');
assert(/metaKey|ctrlKey/.test(app) && /[kK]/.test(app) && /cmdPalette|openPalette|openCmd/.test(app), '⌘K / Ctrl+K opens the palette');

console.log('\n== System theme ==');
assert(/value="system"/.test(app), 'theme select includes System');
assert(/prefers-color-scheme/.test(app), 'system theme follows the OS');

console.log('\n== SVG nav ==');
assert(!/>🏠</.test(html), 'Dashboard emoji icon is gone');
assert(/nav-ico[\s\S]*<svg/.test(html), 'nav uses inline SVG icons');
assert(/currentColor/.test(html), 'nav icons inherit color');

console.log('\n== Settings tab icons ==');
assert(!/👤 Account & billing/.test(app), 'Account tab no longer uses the person emoji');
assert(!/🎨 Appearance/.test(app), 'Appearance tab no longer uses the palette emoji');
assert(!/⚙️ Studio/.test(app) && !/ℹ️ About/.test(app), 'Studio and About tabs no longer use emoji');
assert(/set-ico/.test(app) && /<svg/.test(app) && /data-set-tab/.test(app), 'Settings tabs render inline SVG icons');
assert(/set-ico/.test(css), 'Settings tab icons have a size rule');
assert(/Account & billing/.test(app) && /Project defaults/.test(app) && /Online data/.test(app), 'Settings tab labels remain');

console.log('\n== Modal focus ==');
assert(/modal-focus|nextFocusIndex|FOCUSABLE/.test(app), 'modals use the focus-trap helper');

if (failed) {
  console.error('\nstudio-chrome-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nstudio-chrome-smoke PASSED');
