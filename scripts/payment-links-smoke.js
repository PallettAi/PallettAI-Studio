#!/usr/bin/env node
// Stripe Payment Links are opened from Upgrade; they never grant Pro locally.
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

const PRO = 'https://buy.stripe.com/fZu3co2pDesB7wyfWL2B20m';
const PROPLUS = 'https://buy.stripe.com/4gM4gsggtfwFcQS11R2B20l';

console.log('== Payment link URLs ==');
assert(typeof PLANS.getCheckoutUrl === 'function', 'getCheckoutUrl is exported');
assert(PLANS.getCheckoutUrl('pro') === PRO, 'Pro opens the Pro Payment Link');
assert(PLANS.getCheckoutUrl('proplus') === PROPLUS, 'Pro+ opens the Pro+ Payment Link');
assert(PLANS.getCheckoutUrl('free') === '', 'Free has no Payment Link');
assert(PLANS.getCheckoutUrl('agency') === PROPLUS, 'retired Agency maps to the Pro+ Payment Link');

console.log('\n== Payment link allowlist ==');
assert(typeof PLANS.isStripePaymentLink === 'function', 'isStripePaymentLink is exported');
assert(PLANS.isStripePaymentLink(PRO) === true, 'live Pro link is accepted');
assert(PLANS.isStripePaymentLink(PROPLUS) === true, 'live Pro+ link is accepted');
assert(PLANS.isStripePaymentLink('https://evil.example/buy.stripe.com/x') === false, 'lookalike host is rejected');
assert(PLANS.isStripePaymentLink('http://buy.stripe.com/fZu3co2pDesB7wyfWL2B20m') === false, 'http Stripe link is rejected');
assert(PLANS.isStripePaymentLink('javascript:alert(1)') === false, 'javascript: is rejected');
assert(PLANS.isStripePaymentLink('https://checkout.stripe.com/c/pay/cs_test') === false, 'non-Payment-Link Stripe host is rejected');

console.log('\n== Checkout does not unlock ==');
{
  const r = PLANS.store.activate('pro', 'checkout');
  assert(PLANS.normalizePlan(r.plan) === 'free', 'opening checkout still cannot activate Pro');
  assert(!PLANS.store.isPro(), 'Payment Link flow does not set isPro');
}

console.log('\n== Upgrade UI opens Stripe ==');
assert(/checkoutUrlForAccount\(/.test(app), 'checkoutFlow asks PLANS for the Payment Link');
assert(/ccPay/.test(app), 'checkout modal has a Pay with Stripe control');
assert(/window\.open\(/.test(app) && /buy\.stripe\.com/.test(app) === false, 'app opens the resolved URL rather than hard-coding Stripe hosts');
assert(!/Card checkout is not live yet/.test(app), 'dead checkout copy is gone');
assert(!/store\.activate\(\s*['"]pro['"]\s*,\s*['"]checkout['"]/.test(app), 'checkoutFlow does not call store.activate');

if (failed) {
  console.error('\npayment-links-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\npayment-links-smoke PASSED');
