#!/usr/bin/env node
// Stripe Customer Portal: restricted key stays on the registry, JWT required.
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function assert(cond, msg) { cond ? pass(msg) : fail(msg); }

const rec = require(path.join(ROOT, 'data', 'plan-receipt.js'));
const fnPath = path.join(ROOT, 'supabase', 'functions', 'billing-portal', 'index.ts');
const src = fs.existsSync(fnPath) ? fs.readFileSync(fnPath, 'utf8') : '';
const cfg = fs.readFileSync(path.join(ROOT, 'supabase', 'config.toml'), 'utf8');
const client = fs.readFileSync(path.join(ROOT, 'modules', 'supabase.js'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

console.log('== Return URL allowlist ==');
assert(typeof rec.portalReturnUrl === 'function', 'portalReturnUrl is exported');
const portalUrl = typeof rec.portalReturnUrl === 'function' ? rec.portalReturnUrl.bind(rec) : () => '';
assert(portalUrl('https://pallettai.org/') === 'https://pallettai.org/?paid=1', 'site origin is allowed');
assert(portalUrl('http://localhost:4173/') === 'http://localhost:4173/?paid=1', 'local Studio is allowed');
assert(portalUrl('https://evil.example/?paid=1') === 'https://pallettai.org/?paid=1', 'foreign host is rejected');
assert(portalUrl('javascript:alert(1)') === 'https://pallettai.org/?paid=1', 'javascript: is rejected');

console.log('\n== Edge Function never returns the key ==');
assert(fs.existsSync(fnPath), 'supabase/functions/billing-portal/index.ts exists');
assert(/billing_portal\/sessions/.test(src), 'function creates a Customer Portal session');
assert(/Deno\.env\.get/.test(src) && /STRIPE_SECRET_KEY/.test(src), 'key is read from secrets');
assert(!/json\([^)]*STRIPE_SECRET_KEY/.test(src) && !/JSON\.stringify\([^)]*STRIPE_SECRET_KEY/.test(src), 'key is not assigned into a JSON body');
assert(!/whsec_/.test(src), 'no Stripe webhook secret in billing-portal');
assert(/stripe_customer_id/.test(src), 'function looks up the signed-in profile customer');
assert(!/body\.customer/.test(src) && !/body\.customerId/.test(src), 'client cannot pick the Stripe customer');
assert(/\[functions\.billing-portal\]/.test(cfg) && /verify_jwt\s*=\s*true/.test(cfg.split('[functions.billing-portal]')[1] || ''), 'billing-portal requires JWT');

console.log('\n== Client ==');
assert(/openBillingPortal/.test(client), 'SUPABASE.openBillingPortal exists');
assert(!/STRIPE_SECRET_KEY/.test(client) && !/rk_(live|test)_/.test(client), 'client never embeds the Stripe secret');
assert(/id="btnBillingPortal"/.test(app), 'Settings has a Manage billing control');
assert(/openBillingPortal/.test(app), 'Manage billing calls the registry');
assert(/entitlement_source === 'stripe'|stripe_customer_id/.test(app), 'portal is only offered for a Stripe customer');

if (failed) {
  console.error('\nbilling-portal-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nbilling-portal-smoke PASSED');
