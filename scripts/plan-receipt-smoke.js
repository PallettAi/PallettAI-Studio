#!/usr/bin/env node
// Plan receipt, billing failure copy, and paid-return URL helpers.
'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function assert(cond, msg) { cond ? pass(msg) : fail(msg); }

let rec;
try {
  rec = require(path.join(ROOT, 'data', 'plan-receipt.js'));
} catch (e) {
  console.error('plan-receipt-smoke FAILED — module missing: ' + e.message);
  process.exit(1);
}

console.log('== Billing status from a Dodo event ==');
assert(rec.billingStatusFromEvent('subscription.renewed', true) === 'ok', 'a paid event is ok');
assert(rec.billingStatusFromEvent('subscription.failed', false) === 'failed', 'failed is failed');
assert(rec.billingStatusFromEvent('subscription.cancelled', false) === 'cancelled', 'cancelled is cancelled');
assert(rec.billingStatusFromEvent('subscription.paused', false) === 'paused', 'paused is paused');
assert(rec.billingStatusFromEvent('subscription.expired', false) === 'expired', 'expired is expired');
assert(rec.billingStatusFromEvent('subscription.on_hold', false) === 'on_hold', 'on_hold maps');
assert(rec.billingStatusFromEvent('subscription.past_due', false) === 'past_due', 'past_due maps');
// Every event the mapper can decide is unpaid carries one of these words, so
// the fallback is only ever a belt-and-braces default.
assert(rec.billingStatusFromEvent('payment.cancelled', false) === 'cancelled', 'a cancelled one-off maps too');

console.log('\n== Failure copy ==');
assert(rec.failureCopy('failed') === 'Payment failed — you are back on Free.', 'failed copy');
assert(rec.failureCopy('cancelled') === 'Subscription cancelled — you are back on Free.', 'cancelled copy');
assert(rec.failureCopy('past_due') === 'Payment past due — you are back on Free, for now.', 'past_due copy');
assert(rec.failureCopy('on_hold') === 'Subscription on hold after a failed renewal — you are back on Free.', 'on_hold copy');
assert(rec.failureCopy('ok') === '', 'ok has no warning');
assert(rec.failureCopy('') === '', 'empty has no warning');
assert(rec.failureCopy('some-status-from-the-future') === '', 'an unknown status says nothing rather than something wrong');

console.log('\n== Receipt lines ==');
{
  const lines = rec.receiptLines({
    plan: 'pro',
    source: 'dodo',
    expiresAt: '2030-01-15T00:00:00.000Z',
    billingStatus: 'ok',
    lastEventType: 'invoice.paid',
    lastEventAt: '2026-09-07T00:00:00.000Z',
    trialDays: 0
  });
  const by = Object.fromEntries(lines.map((l) => [l.label, l.value]));
  assert(by.Plan === 'Pro', 'receipt names Pro');
  assert(by.Source === 'Dodo Payments', 'receipt source names the provider that actually charges');
  assert(/15/.test(by.Renews || ''), 'receipt includes renewal date');
  assert(by['Last event'] === 'invoice.paid', 'receipt includes the last billing event');
}
{
  const lines = rec.receiptLines({ plan: 'free', source: 'license', trialDays: 5, billingStatus: 'ok' });
  const by = Object.fromEntries(lines.map((l) => [l.label, l.value]));
  assert(by.Source === 'License key', 'license source label');
  assert(/5/.test(by.Trial || ''), 'trial days appear');
}
{
  const now = Date.parse('2026-09-07T12:00:00.000Z');
  const until = new Date(now + (71 * 36e5) + (24 * 6e4)).toISOString();
  const lines = rec.receiptLines({
    plan: 'free',
    source: 'review',
    reviewUntil: until,
    now,
    billingStatus: 'ok'
  });
  const by = Object.fromEntries(lines.map((l) => [l.label, l.value]));
  assert(by.Plan === 'Pro+ Review Trial', 'review gift receipt is not Free');
  assert(by.Source === 'Review gift', 'review source stays Review gift');
  assert(by.Remaining === '71h 24m', 'receipt remaining is hours and minutes');
}

console.log('\n== The portal return helper is gone with the provider ==');
assert(typeof rec.portalReturnUrl === 'undefined', 'portalReturnUrl was Stripe-only and is no longer exported');

console.log('\n== Paid return ==');
assert(rec.isPaidReturn('?paid=1') === true, 'paid=1 is a return');
assert(rec.isPaidReturn('?paid=1&x=2') === true, 'paid=1 with extras is a return');
assert(rec.isPaidReturn('?foo=1') === false, 'other query is not a return');
assert(rec.paidReturnUrl({ origin: 'http://localhost:4173', pathname: '/', protocol: 'http:' }) === 'http://localhost:4173/?paid=1', 'web studio return URL');
assert(rec.paidReturnUrl({ origin: 'file://', pathname: '/app', protocol: 'file:' }) === 'https://pallettai.org/?paid=1', 'file/electron falls back to the site');

if (failed) {
  console.error('\nplan-receipt-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nplan-receipt-smoke PASSED');
