#!/usr/bin/env node
// Dodo checkout sessions, and the customer portal.
//
// Replaces two Stripe-era suites. The property under test is the one that
// changed most: under Stripe the account travelled in a query string the client
// could edit, and this suite pins that it no longer travels through the client
// at all — the function reads it from the verified token, and the request body
// is not consulted for it.
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function assert(cond, msg) { cond ? pass(msg) : fail(msg); }

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const checkout = require(path.join(ROOT, 'supabase', 'functions', 'dodo-checkout', 'checkout.js'));
const PLANS = require(path.join(ROOT, 'data', 'plans.js'));

const fnPath = path.join(ROOT, 'supabase', 'functions', 'dodo-checkout', 'index.ts');
const src = fs.existsSync(fnPath) ? fs.readFileSync(fnPath, 'utf8') : '';
const cfg = fs.readFileSync(path.join(ROOT, 'supabase', 'config.toml'), 'utf8');
const client = fs.readFileSync(path.join(ROOT, 'modules', 'supabase.js'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

console.log('== Plan → product mapping ==');
assert(checkout.normalizePlan('pro') === 'pro', 'pro normalises');
assert(checkout.normalizePlan('ProPlus') === 'proplus', 'proplus normalises regardless of case');
assert(checkout.normalizePlan('free') === '', 'free is not billable');
assert(checkout.normalizePlan('agency') === '', 'the retired agency tier is not billable');
assert(checkout.normalizePlan('') === '', 'an empty plan is not billable');
assert(checkout.productEnvFor('pro') === 'DODO_PRODUCT_PRO', 'pro reads its own secret');
assert(checkout.productEnvFor('proplus') === 'DODO_PRODUCT_PROPLUS', 'proplus reads its own secret');
assert(checkout.productEnvFor('free') === '', 'free resolves no secret');

console.log('\n== The session body ==');
{
  const r = checkout.buildSessionBody({
    planId: 'pro', productId: 'pdt_live_pro', accountId: ACCOUNT,
    email: 'studio-user@pallettai.test', returnUrl: 'https://pallettai.org/'
  });
  assert(r.ok === true, 'a valid request builds a session');
  assert(r.body.product_cart[0].product_id === 'pdt_live_pro', 'the product id comes from the secret, not the client');
  assert(r.body.product_cart[0].quantity === 1, 'one unit');
  assert(r.body.metadata.account_id === ACCOUNT, 'the account id rides in metadata — this is what the webhook finds the profile by');
  assert(r.body.metadata.plan === 'pro', 'and so does the plan');
  assert(r.body.customer.email === 'studio-user@pallettai.test', 'the profile email pre-fills checkout');
  assert(r.body.billing_currency === 'GBP', 'currency is stated rather than guessed from an IP');
  assert(r.body.return_url === 'https://pallettai.org/?paid=1', 'the return url is normalised to the site');
}
{
  const r = checkout.buildSessionBody({ planId: 'pro', productId: 'pdt_1', accountId: 'not-a-uuid' });
  assert(r.ok === false && r.reason === 'bad-account', 'a non-UUID account is refused — it could never match a profile');
}
{
  const r = checkout.buildSessionBody({ planId: 'free', productId: 'pdt_1', accountId: ACCOUNT });
  assert(r.ok === false && r.reason === 'bad-plan', 'a free plan cannot be checked out');
}
{
  const r = checkout.buildSessionBody({ planId: 'pro', productId: '', accountId: ACCOUNT });
  assert(r.ok === false && r.reason === 'not-configured', 'a missing product id is a named failure, not a silent one');
}
{
  const r = checkout.buildSessionBody({ planId: 'pro', productId: 'pdt_1', accountId: ACCOUNT, email: 'not-an-email' });
  assert(r.ok === true, 'a malformed email does not stop the sale');
  assert(!r.body.customer, 'it is simply left off, so checkout asks for one');
}
{
  const r = checkout.buildSessionBody({ planId: 'pro', productId: 'pdt_1', accountId: ACCOUNT });
  assert(r.body.return_url === checkout.FALLBACK_RETURN, 'with no return url we fall back to the site');
}

console.log('\n== Return URL allowlist ==');
assert(checkout.checkoutReturnUrl('https://pallettai.org/') === 'https://pallettai.org/?paid=1', 'the site is allowed');
assert(checkout.checkoutReturnUrl('https://www.pallettai.org/x') === 'https://www.pallettai.org/x?paid=1', 'www is allowed');
assert(checkout.checkoutReturnUrl('http://localhost:4173/') === 'http://localhost:4173/?paid=1', 'local Studio is allowed');
assert(checkout.checkoutReturnUrl('https://evil.example/?paid=1') === checkout.FALLBACK_RETURN, 'a foreign host is replaced, not echoed');
assert(checkout.checkoutReturnUrl('https://pallettai.org.evil.example/') === checkout.FALLBACK_RETURN, 'a suffixed host is rejected');
assert(checkout.checkoutReturnUrl('http://pallettai.org/') === checkout.FALLBACK_RETURN, 'plain http on the real host is rejected');
assert(checkout.checkoutReturnUrl('javascript:alert(1)') === checkout.FALLBACK_RETURN, 'javascript: is rejected');
{
  const withQuery = checkout.checkoutReturnUrl('https://pallettai.org/downloads#buy');
  assert(withQuery === 'https://pallettai.org/downloads?paid=1', 'fragments are dropped and paid=1 is set so the app can spot the return');
}

console.log('\n== The client cannot name the account ==');
assert(/uidFromAuth\(auth\)/.test(src), 'the account is decoded from the caller\'s Authorization header');
assert(!/body\.account_id|body\.accountId|asked\.accountId/.test(src), 'and never read from the request body');
assert(/verify_jwt\s*=\s*true/.test(cfg.split('[functions.dodo-checkout]')[1] || ''), 'dodo-checkout requires a verified JWT — that is what makes the binding trustworthy');
assert(/verify_jwt\s*=\s*false/.test(cfg.split('[functions.dodo-webhook]')[1] || ''), 'dodo-webhook does not (Dodo calls it, and the signature is the auth)');
assert(!/\[functions\.(stripe-webhook|billing-portal)\]/.test(cfg), 'the Stripe functions are gone from the config');

console.log('\n== The Edge Function keeps its secrets ==');
assert(fs.existsSync(fnPath), 'supabase/functions/dodo-checkout/index.ts exists');
assert(/Deno\.env\.get\('DODO_API_KEY'\)/.test(src), 'the API key is read from secrets');
assert(/DODO_PRODUCT_PRO\b/.test(src) && /DODO_PRODUCT_PROPLUS\b/.test(src), 'product ids come from secrets too');
assert(!/json\([^)]*DODO_API_KEY/.test(src) && !/return_url:[^,]*apiKey/.test(src), 'the key is never assigned into a response');
assert(!/whsec_/.test(src), 'no webhook secret appears in the checkout function');
assert(/dodopayments\.com\\\/\//.test(src) || /checkout\\\.dodopayments\\\.com/.test(src), 'the returned URL is checked against a Dodo host before being handed to the client');
assert(!/\brequire\s*\(/.test(src), 'index.ts makes no require() call, so it stays self-contained for the Edge runtime');
assert(/Access-Control-Allow-Origin/.test(src) && !/'Access-Control-Allow-Origin':\s*'\*'/.test(src), 'CORS is an allowlist, not a wildcard');

console.log('\n== The customer portal ==');
assert(typeof PLANS.customerPortalUrl === 'function', 'PLANS.customerPortalUrl is exported');
{
  const backup = PLANS.billing.businessId;
  const mode = PLANS.billing.mode;
  try {
    /* Staged, not assumed. This asserted against the shipped business id, so it
       held only while the app was unconfigured and broke the moment a real id
       was put in — retiring itself at the point it starts to matter. */
    PLANS.billing.businessId = 'REPLACE_WITH_DODO_BUSINESS_ID';
    assert(PLANS.customerPortalUrl() === '', 'the placeholder business id yields no link, so the app hides Manage billing');
    PLANS.billing.businessId = '';
    assert(PLANS.customerPortalUrl() === '', 'an empty business id yields no link either');
    PLANS.billing.businessId = 'bus_abc123456';
    PLANS.billing.mode = 'test';
    assert(PLANS.customerPortalUrl() === 'https://test.customer.dodopayments.com/login/bus_abc123456', 'test mode points at the test portal');
    PLANS.billing.mode = 'live';
    assert(PLANS.customerPortalUrl() === 'https://customer.dodopayments.com/login/bus_abc123456', 'live mode points at the live portal');
    PLANS.billing.businessId = 'has spaces/and#hash';
    assert(PLANS.customerPortalUrl() === '', 'a junk business id is refused rather than turned into a broken link');
  } finally {
    PLANS.billing.businessId = backup;
    PLANS.billing.mode = mode;
  }
}
assert(!/billing\.stripe\.com/.test(app) && !/billing_portal/.test(src), 'no Stripe portal survives');
assert(/openCustomerPortalFlow/.test(app) && /btnBillingPortal/.test(app), 'Settings still offers Manage billing, now via Dodo');
assert(/dodo_customer_id/.test(app), 'and it is only offered to an account that actually has a Dodo customer');
assert(/id="ccPay" href=/.test(app), 'the Pay control is a link the customer clicks, not a tab opened after an await (popup blockers)');
assert(!/STRIPE_SECRET_KEY|rk_(live|test)_/.test(client), 'the client embeds no provider secret');

if (failed) {
  console.error('\ndodo-checkout-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\ndodo-checkout-smoke PASSED');
