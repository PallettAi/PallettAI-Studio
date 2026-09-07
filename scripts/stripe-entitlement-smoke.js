#!/usr/bin/env node
// Paid-only Stripe entitlements bind to client_reference_id, never email.
'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');
const fs = require('fs');

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function assert(cond, msg) { cond ? pass(msg) : fail(msg); }

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

function load() {
  return require(path.join(ROOT, 'supabase', 'functions', 'stripe-webhook', 'entitlement.js'));
}

console.log('== Module ==');
let entitlement;
try {
  entitlement = load();
  assert(typeof entitlement.mapStripeEvent === 'function', 'mapStripeEvent is exported');
  assert(typeof entitlement.applyEntitlement === 'function', 'applyEntitlement is exported');
  assert(typeof entitlement.verifyStripeSignature === 'function', 'verifyStripeSignature is exported');
} catch (e) {
  fail('entitlement module loads (' + e.message + ')');
  console.error('\nstripe-entitlement-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}

const { mapStripeEvent, applyEntitlement, verifyStripeSignature, emptyDb } = entitlement;

function sessionEvent(type, extra) {
  return {
    id: 'evt_' + type + '_' + Math.random().toString(36).slice(2, 8),
    type,
    data: {
      object: Object.assign({
        object: 'checkout.session',
        payment_status: 'paid',
        client_reference_id: ACCOUNT,
        metadata: { plan: 'pro' },
        customer: 'cus_1',
        subscription: 'sub_1',
        customer_details: { email: 'card-payer@elsewhere.test' }
      }, extra || {})
    }
  };
}

function dbWith(account) {
  const db = emptyDb();
  db.profiles.set(ACCOUNT, {
    id: ACCOUNT,
    email: 'studio-user@pallettai.test',
    plan: 'free',
    plan_expires_at: null,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    entitlement_source: null
  });
  if (account) Object.assign(db.profiles.get(ACCOUNT), account);
  return db;
}

console.log('\n== Map paid vs not paid ==');
{
  const paid = mapStripeEvent(sessionEvent('checkout.session.completed'));
  assert(paid.paid === true, 'completed + payment_status=paid is paid');
  assert(paid.accountId === ACCOUNT, 'account comes from client_reference_id');
  assert(paid.plan === 'pro', 'plan comes from Payment Link metadata');
  assert(paid.email == null || paid.accountId !== paid.email, 'email is not the account key');
}
{
  const unpaid = mapStripeEvent(sessionEvent('checkout.session.completed', { payment_status: 'unpaid' }));
  assert(unpaid.paid === false, 'completed + unpaid is not paid');
}
{
  const failedPay = mapStripeEvent(sessionEvent('checkout.session.async_payment_failed'));
  assert(failedPay.paid === false, 'async_payment_failed is not paid');
}
{
  const expired = mapStripeEvent(sessionEvent('checkout.session.expired', { payment_status: 'unpaid' }));
  assert(expired.paid === false, 'expired session is not paid');
}
{
  const pastDue = mapStripeEvent({
    id: 'evt_sub_past',
    type: 'customer.subscription.updated',
    data: { object: { id: 'sub_1', object: 'subscription', status: 'past_due', customer: 'cus_1', metadata: { plan: 'pro' } } }
  });
  assert(pastDue.paid === false, 'past_due subscription is not paid');
}
{
  const active = mapStripeEvent({
    id: 'evt_sub_ok',
    type: 'customer.subscription.updated',
    data: { object: { id: 'sub_1', object: 'subscription', status: 'active', customer: 'cus_1', metadata: { plan: 'proplus' }, current_period_end: 2000000000 } }
  });
  assert(active.paid === true && active.plan === 'proplus', 'active subscription is paid');
}

console.log('\n== Apply: correct account, ignore email ==');
{
  const db = dbWith();
  const mapped = mapStripeEvent(sessionEvent('checkout.session.completed', {
    customer_details: { email: 'not-the-studio-user@example.com' }
  }));
  const r = applyEntitlement(db, mapped);
  assert(r.outcome === 'granted', 'paid checkout grants');
  assert(db.profiles.get(ACCOUNT).plan === 'pro', 'signed-in account becomes Pro');
  assert(db.profiles.get(ACCOUNT).entitlement_source === 'stripe', 'source is stripe');
  assert(db.profiles.get(ACCOUNT).billing_status === 'ok', 'paid grant clears billing_status to ok');
  assert(!db.profiles.has(OTHER), 'no second profile is invented from the card email');
}

console.log('\n== Apply: unpaid / failed / canceled do not grant ==');
{
  const db = dbWith();
  const r = applyEntitlement(db, mapStripeEvent(sessionEvent('checkout.session.completed', { payment_status: 'unpaid' })));
  assert(r.outcome !== 'granted', 'unpaid does not grant');
  assert(db.profiles.get(ACCOUNT).plan === 'free', 'unpaid leaves Free');
}
{
  const db = dbWith({ plan: 'pro', entitlement_source: 'stripe', stripe_subscription_id: 'sub_1', stripe_customer_id: 'cus_1' });
  const r = applyEntitlement(db, mapStripeEvent({
    id: 'evt_fail',
    type: 'invoice.payment_failed',
    data: { object: { object: 'invoice', customer: 'cus_1', subscription: 'sub_1', paid: false } }
  }));
  assert(r.outcome === 'revoked', 'failed invoice revokes a Stripe plan');
  assert(db.profiles.get(ACCOUNT).plan === 'free', 'failed invoice returns Free');
  assert(db.profiles.get(ACCOUNT).billing_status === 'failed', 'failed invoice stores billing_status=failed');
}
{
  const db = dbWith({ plan: 'proplus', entitlement_source: 'license', stripe_subscription_id: 'sub_1' });
  applyEntitlement(db, mapStripeEvent({
    id: 'evt_cancel_lic',
    type: 'customer.subscription.deleted',
    data: { object: { id: 'sub_1', object: 'subscription', status: 'canceled', customer: 'cus_1' } }
  }));
  assert(db.profiles.get(ACCOUNT).plan === 'proplus', 'Stripe cancel does not wipe a license key');
}

console.log('\n== Apply: renewals find the stored customer, not email ==');
{
  const db = dbWith({
    plan: 'pro', entitlement_source: 'stripe',
    stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1'
  });
  const r = applyEntitlement(db, mapStripeEvent({
    id: 'evt_invoice_paid',
    type: 'invoice.paid',
    data: { object: { object: 'invoice', customer: 'cus_1', subscription: 'sub_1', paid: true, customer_email: 'new-card@other.test' } }
  }));
  assert(r.outcome === 'granted', 'renewal invoice.paid grants against the stored customer');
  assert(db.profiles.get(ACCOUNT).plan === 'pro', 'renewal stays on the original account');
}

console.log('\n== Signature ==');
{
  const payload = '{"id":"evt_test"}';
  const secret = 'whsec_test_secret';
  const t = Math.floor(Date.now() / 1000);
  const crypto = require('crypto');
  const sig = crypto.createHmac('sha256', secret).update(t + '.' + payload).digest('hex');
  assert(verifyStripeSignature(payload, 't=' + t + ',v1=' + sig, secret, Date.now()) === true, 'valid Stripe signature is accepted');
  assert(verifyStripeSignature(payload, 't=' + t + ',v1=deadbeef', secret, Date.now()) === false, 'bad signature is rejected');
}

console.log('\n== Studio binds the signed-in account ==');
{
  const PLANS = require(path.join(ROOT, 'data', 'plans.js'));
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  assert(typeof PLANS.checkoutUrlForAccount === 'function', 'checkoutUrlForAccount is exported');
  const url = PLANS.checkoutUrlForAccount('pro', ACCOUNT);
  assert(url.includes('client_reference_id=' + ACCOUNT), 'Pay URL carries the auth user id');
  assert(/checkoutUrlForAccount\(/.test(app), 'checkoutFlow uses checkoutUrlForAccount');
  assert(/st\.profile\.plan/.test(app) || /profile\.plan/.test(app), 'syncCloud applies profiles.plan from the registry');
}

if (failed) {
  console.error('\nstripe-entitlement-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nstripe-entitlement-smoke PASSED');
