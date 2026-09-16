#!/usr/bin/env node
// Dodo Payments → entitlements. Two things are being checked, and the second
// matters more than the first:
//
//   1. a paid subscription grants, and a lapsed one revokes
//   2. the reader never *guesses*. Dodo fires `subscription.updated` on any
//      field change — a new billing address, a renamed customer — so a reader
//      that treats "an event arrived" as "the plan changed" would downgrade
//      people who had merely edited their address. Most of this file is the
//      events it must REFUSE to act on.
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
const SECRET = 'whsec_' + Buffer.from('a-test-signing-key').toString('base64');

function load() {
  return require(path.join(ROOT, 'supabase', 'functions', 'dodo-webhook', 'entitlement.js'));
}

console.log('== Module ==');
let entitlement;
try {
  entitlement = load();
  assert(typeof entitlement.mapDodoEvent === 'function', 'mapDodoEvent is exported');
  assert(typeof entitlement.applyEntitlement === 'function', 'applyEntitlement is exported');
  assert(typeof entitlement.verifyStandardWebhook === 'function', 'verifyStandardWebhook is exported');
  assert(typeof entitlement.signStandardWebhook === 'function', 'signStandardWebhook is exported (so signatures can be proven, not assumed)');
} catch (e) {
  fail('entitlement module loads (' + e.message + ')');
  console.error('\ndodo-entitlement-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}

const { mapDodoEvent, applyEntitlement, verifyStandardWebhook, signStandardWebhook, emptyDb } = entitlement;

function subEvent(type, extra) {
  return {
    type: type,
    webhook_id: 'wh_' + type + '_' + Math.random().toString(36).slice(2, 8),
    data: Object.assign({
      subscription_id: 'sub_1',
      status: 'active',
      metadata: { account_id: ACCOUNT, plan: 'pro' },
      customer: { customer_id: 'cus_1', email: 'card-payer@elsewhere.test' },
      next_billing_date: '2027-01-01T00:00:00Z'
    }, extra || {})
  };
}

function dbWith(account) {
  const db = emptyDb();
  db.profiles.set(ACCOUNT, {
    id: ACCOUNT,
    email: 'studio-user@pallettai.test',
    plan: 'free',
    plan_expires_at: null,
    dodo_customer_id: null,
    dodo_subscription_id: null,
    entitlement_source: null
  });
  if (account) Object.assign(db.profiles.get(ACCOUNT), account);
  return db;
}

console.log('\n== Lifecycle: paid vs not paid ==');
{
  const active = mapDodoEvent(subEvent('subscription.active'));
  assert(active.paid === true, 'subscription.active is paid');
  assert(active.accountId === ACCOUNT, 'account comes from metadata.account_id');
  assert(active.plan === 'pro', 'plan comes from metadata.plan');
  assert(active.customerId === 'cus_1', 'customer id is read from the nested customer');
  assert(active.expiresAt === '2027-01-01T00:00:00.000Z', 'the period end is carried as an ISO date');
}
{
  const renewed = mapDodoEvent(subEvent('subscription.renewed'));
  assert(renewed.paid === true, 'subscription.renewed is paid');
}
{
  const unpaused = mapDodoEvent(subEvent('subscription.unpaused'));
  assert(unpaused.paid === true, 'subscription.unpaused is paid');
}
{
  // Dodo keeps a past-due customer working until the grace period closes, so
  // revoking here would cut off somebody whose card is merely being retried.
  const pastDue = mapDodoEvent(subEvent('subscription.past_due', { status: 'past_due', past_due_ends_at: '2026-10-01T00:00:00Z' }));
  assert(pastDue.paid === true, 'past_due still grants — the grace period is open');
  assert(pastDue.expiresAt === '2026-10-01T00:00:00.000Z', 'and it expires when the grace period does');
}
{
  // Cancel at period end: they paid for the rest of the month.
  const atPeriodEnd = mapDodoEvent(subEvent('subscription.cancelled', { status: 'cancelled', cancel_at_next_billing_date: true }));
  assert(atPeriodEnd.paid === true, 'cancelling at the next billing date keeps access to the period they paid for');
  assert(atPeriodEnd.expiresAt === '2027-01-01T00:00:00.000Z', 'with the period end as the expiry');
}
{
  const now = mapDodoEvent(subEvent('subscription.cancelled', { status: 'cancelled', cancel_at_next_billing_date: false }));
  assert(now.paid === false, 'an immediate cancellation revokes');
}
{
  const onHold = mapDodoEvent(subEvent('subscription.on_hold', { status: 'on_hold' }));
  assert(onHold.paid === false, 'subscription.on_hold revokes');
}
{
  const paused = mapDodoEvent(subEvent('subscription.paused', { status: 'paused' }));
  assert(paused.paid === false, 'subscription.paused revokes');
}
{
  const expired = mapDodoEvent(subEvent('subscription.expired', { status: 'expired' }));
  assert(expired.paid === false, 'subscription.expired revokes');
}
{
  const failed = mapDodoEvent(subEvent('subscription.failed', { status: 'failed' }));
  assert(failed.paid === false, 'subscription.failed revokes');
}

console.log('\n== The events it must refuse to act on ==');
{
  // THE important one. `updated` fires on any field change, so the status is
  // the only honest signal — a rename must not be read as a cancellation.
  const rename = mapDodoEvent(subEvent('subscription.updated', { status: 'active', customer: { customer_id: 'cus_1', email: 'new-address@elsewhere.test' } }));
  assert(rename.paid === true, 'subscription.updated with status=active keeps the plan');

  const unchanged = mapDodoEvent(subEvent('subscription.updated', { status: 'paused' }));
  assert(unchanged.paid === false, 'subscription.updated actually reporting a pause does revoke');

  const nonsense = mapDodoEvent(subEvent('subscription.updated', { status: 'something_dodo_added_later' }));
  assert(nonsense.ignore === true, 'an unrecognised status is ignored, not treated as unpaid');
}
{
  const unrelated = mapDodoEvent({ type: 'customer.updated', webhook_id: 'wh_x', data: { customer_id: 'cus_1' } });
  assert(unrelated.ignore === true, 'an event type we do not handle is ignored');
}
{
  const barePayment = mapDodoEvent({
    type: 'payment.succeeded',
    webhook_id: 'wh_pay',
    data: { payment_id: 'pay_1', metadata: { account_id: ACCOUNT, plan: 'pro' } }
  });
  assert(barePayment.ignore === true, 'a one-off payment with no subscription is ignored (Studio sells subscriptions)');
}
{
  const subPayment = mapDodoEvent({
    type: 'payment.succeeded',
    webhook_id: 'wh_pay2',
    data: { subscription_id: 'sub_1', metadata: { account_id: ACCOUNT, plan: 'pro' } }
  });
  assert(subPayment.paid === true, 'a payment belonging to a subscription does grant');
}
{
  const emailOnly = mapDodoEvent(subEvent('subscription.active', { metadata: { plan: 'pro' } }));
  assert(emailOnly.accountId === '', 'a payload with no account_id has no account — the card email is never the key');
}

console.log('\n== Apply: grants land on the signed-in account ==');
{
  const db = dbWith();
  const r = applyEntitlement(db, mapDodoEvent(subEvent('subscription.active', {
    customer: { customer_id: 'cus_1', email: 'not-the-studio-user@example.com' }
  })));
  assert(r.outcome === 'granted', 'a paid subscription grants');
  assert(db.profiles.get(ACCOUNT).plan === 'pro', 'the signed-in account becomes Pro');
  assert(db.profiles.get(ACCOUNT).entitlement_source === 'dodo', 'source is dodo');
  assert(db.profiles.get(ACCOUNT).billing_status === 'ok', 'a paid grant sets billing_status to ok');
  assert(db.profiles.get(ACCOUNT).dodo_subscription_id === 'sub_1', 'the subscription id is stored for later renewals');
  assert(!db.profiles.has(OTHER), 'no second profile is invented from the card email');
}
{
  const db = dbWith();
  const r = applyEntitlement(db, { ignore: false, eventId: 'ab', eventType: 'subscription.active', paid: true, accountId: ACCOUNT, plan: 'pro' });
  assert(r.outcome === 'bad-event', 'an unidentifiable event is refused');
}
{
  const db = dbWith();
  const e = mapDodoEvent(subEvent('subscription.active'));
  assert(applyEntitlement(db, e).outcome === 'granted', 'first delivery grants');
  assert(applyEntitlement(db, e).outcome === 'duplicate', 'the retry is not applied twice');
}
{
  const db = dbWith();
  const r = applyEntitlement(db, mapDodoEvent(subEvent('subscription.active', { metadata: { account_id: OTHER, plan: 'pro' } })));
  assert(r.outcome === 'no-account', 'an account we do not have is reported, not created');
}
{
  const db = dbWith();
  const r = applyEntitlement(db, mapDodoEvent(subEvent('subscription.active', { metadata: { account_id: ACCOUNT } })));
  assert(r.outcome === 'bad-plan', 'a grant with no readable plan is refused');
  assert(db.profiles.get(ACCOUNT).plan === 'free', 'and it does not default to Pro');
}
{
  // An unmapped product must fail loudly rather than hand out the flagship tier.
  const db = dbWith({ plan: 'pro', entitlement_source: 'dodo' });
  const r = applyEntitlement(db, mapDodoEvent(subEvent('subscription.active', { metadata: { account_id: ACCOUNT } })));
  assert(r.outcome === 'granted' && db.profiles.get(ACCOUNT).plan === 'pro', 'an existing paid profile keeps its own plan when the product is unmapped');
}

console.log('\n== Apply: a license outranks a subscription, on renewals too ==');
{
  // The failure this guards. A lifetime key activated on an account that also
  // has a live subscription used to survive a cancellation but not a renewal:
  // the paid branch relabelled the entitlement 'dodo' and stamped the
  // subscription's period end onto it, so a permanent key quietly became an
  // expiring subscription one.
  const db = dbWith({ plan: 'proplus', entitlement_source: 'license' });
  const r = applyEntitlement(db, mapDodoEvent(subEvent('subscription.renewed')));
  const p = db.profiles.get(ACCOUNT);
  assert(r.outcome === 'kept-license', 'a renewal on a licensed account is kept, not granted');
  assert(p.plan === 'proplus', 'the license keeps its Pro+ tier');
  assert(p.entitlement_source === 'license', 'the source stays license, so a later cancellation cannot revoke it');
  assert(p.plan_expires_at == null, 'no subscription period end is stamped onto a lifetime key');
}
{
  // Billing is still recorded: a license changes who owns the entitlement, not
  // whether Dodo knows about the card.
  const db = dbWith({ plan: 'proplus', entitlement_source: 'license' });
  applyEntitlement(db, mapDodoEvent(subEvent('subscription.renewed', { customer: { customer_id: 'cus_9', email: 'x@y.test' } })));
  const p = db.profiles.get(ACCOUNT);
  assert(p.dodo_customer_id === 'cus_9', 'the customer id is still stored, so Manage billing keeps working');
  assert(!!p.billing_status, 'and billing_status is still stamped');
}
{
  // A better subscription still lifts a licence. Refusing that would make the
  // licence punish the payer for buying more than they already had.
  const db = dbWith({ plan: 'pro', entitlement_source: 'license' });
  applyEntitlement(db, mapDodoEvent(subEvent('subscription.renewed', { metadata: { account_id: ACCOUNT, plan: 'proplus' } })));
  assert(db.profiles.get(ACCOUNT).plan === 'proplus', 'a Pro+ subscription lifts a Pro license');
}
{
  // The other direction never happens: a Pro subscription cannot pull Pro+ down.
  const db = dbWith({ plan: 'proplus', entitlement_source: 'license' });
  applyEntitlement(db, mapDodoEvent(subEvent('subscription.renewed', { metadata: { account_id: ACCOUNT, plan: 'pro' } })));
  assert(db.profiles.get(ACCOUNT).plan === 'proplus', 'a Pro subscription never downgrades a Pro+ license');
}

console.log('\n== Apply: revokes, and the two it must never revoke ==');
{
  const db = dbWith({ plan: 'pro', entitlement_source: 'dodo', dodo_subscription_id: 'sub_1', dodo_customer_id: 'cus_1' });
  const r = applyEntitlement(db, mapDodoEvent(subEvent('subscription.on_hold', { status: 'on_hold' })));
  assert(r.outcome === 'revoked', 'on_hold revokes a Dodo plan');
  assert(db.profiles.get(ACCOUNT).plan === 'free', 'and returns the account to Free');
  assert(db.profiles.get(ACCOUNT).billing_status === 'on_hold', 'storing billing_status=on_hold');
}
{
  const db = dbWith({ plan: 'proplus', entitlement_source: 'license', dodo_subscription_id: 'sub_1' });
  applyEntitlement(db, mapDodoEvent(subEvent('subscription.cancelled', { status: 'cancelled', cancel_at_next_billing_date: false })));
  assert(db.profiles.get(ACCOUNT).plan === 'proplus', 'a cancelled card does not wipe a license key');
}
{
  // Hard cutover, stated in one assertion: the code is switched over, but a
  // webhook is not allowed to decide that somebody still paying on the old
  // provider should lose Pro. That is a call to make by hand.
  const db = dbWith({ plan: 'pro', entitlement_source: 'stripe', stripe_subscription_id: 'sub_1' });
  const r = applyEntitlement(db, mapDodoEvent(subEvent('subscription.cancelled', { status: 'cancelled', cancel_at_next_billing_date: false })));
  assert(r.outcome === 'ignored', 'a legacy Stripe profile is untouched by a Dodo event');
  assert(db.profiles.get(ACCOUNT).plan === 'pro', 'and keeps the plan it had');
}
{
  // Renewals find the profile by stored ids when metadata is missing, which is
  // what a subscription created outside the app would look like.
  const db = dbWith({ plan: 'pro', entitlement_source: 'dodo', dodo_customer_id: 'cus_1', dodo_subscription_id: 'sub_1' });
  const r = applyEntitlement(db, mapDodoEvent(subEvent('subscription.renewed', { metadata: {} })));
  assert(r.outcome === 'granted', 'a renewal with no metadata still finds the account by subscription id');
  assert(db.profiles.get(ACCOUNT).plan === 'pro', 'and stays on the original account');
}

console.log('\n== Standard Webhooks signature ==');
{
  const payload = '{"type":"subscription.active"}';
  const t = Math.floor(Date.now() / 1000);
  const good = signStandardWebhook(payload, 'wh_1', String(t), SECRET);
  const headers = (sig, id, ts) => ({
    'webhook-id': id === undefined ? 'wh_1' : id,
    'webhook-timestamp': ts === undefined ? String(t) : ts,
    'webhook-signature': sig === undefined ? good : sig
  });

  assert(verifyStandardWebhook(payload, headers(), SECRET, Date.now()) === true, 'a valid signature is accepted');
  assert(verifyStandardWebhook(payload, headers('v1,AAAA'), SECRET, Date.now()) === false, 'a wrong signature is rejected');
  assert(verifyStandardWebhook(payload, headers(undefined, undefined, String(t - 4000)), SECRET, Date.now()) === false, 'a 67-minute-old timestamp is rejected (replay)');
  assert(verifyStandardWebhook(payload, headers(), SECRET, Date.now() + 4000 * 1000) === false, 'a stale timestamp is rejected in the other direction too');
  assert(verifyStandardWebhook(payload, headers(), 'whsec_' + Buffer.from('a-different-key').toString('base64'), Date.now()) === false, 'a signature from another secret is rejected');
  assert(verifyStandardWebhook(payload, headers(), SECRET, Date.now()) === true, 'the accepted case really did pass the same checks');
  assert(verifyStandardWebhook(payload + ' ', headers(), SECRET, Date.now()) === false, 'a tampered body is rejected');
  assert(verifyStandardWebhook(payload, headers(undefined, 'a-different-event'), SECRET, Date.now()) === false, 'a swapped event id is rejected — the id is inside the signature');
  assert(verifyStandardWebhook(payload, { 'webhook-signature': good }, SECRET, Date.now()) === false, 'missing signature headers are rejected');
  assert(verifyStandardWebhook(payload, { 'webhook-id': 'wh_1', 'webhook-timestamp': 'not-a-number', 'webhook-signature': good }, SECRET, Date.now()) === false, 'a non-numeric timestamp is rejected rather than coerced');
  assert(verifyStandardWebhook(payload, headers(), '', Date.now()) === false, 'an unset secret cannot validate anything');
  // The scheme is not Stripe's: `timestamp.body` with hex would accept nothing,
  // so pin the shape rather than trusting the reader to remember.
  const stripeStyle = require('crypto').createHmac('sha256', SECRET).update(t + '.' + payload).digest('hex');
  assert(verifyStandardWebhook(payload, headers('t=' + t + ',v1=' + stripeStyle), SECRET, Date.now()) === false, 'the Stripe scheme does not verify (id.timestamp.body + base64)');
}

console.log('\n== The Deno copy agrees with the tested one ==');
{
  const ts = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', 'dodo-webhook', 'index.ts'), 'utf8');
  const eventNames = [
    'subscription.active', 'subscription.renewed', 'subscription.unpaused',
    'subscription.updated', 'subscription.plan_changed', 'subscription.past_due',
    'subscription.on_hold', 'subscription.paused', 'subscription.cancelled',
    'subscription.failed', 'subscription.expired',
    'payment.succeeded', 'payment.processing', 'payment.failed', 'payment.cancelled'
  ];
  const missing = eventNames.filter((e) => ts.indexOf(e) === -1);
  assert(missing.length === 0, 'every event the tested module handles is handled in index.ts' + (missing.length ? ' (missing: ' + missing.join(', ') + ')' : ''));
  assert(/apply_dodo_entitlement/.test(ts), 'index.ts calls apply_dodo_entitlement');
  assert(/webhook-id/.test(ts) && /webhook-timestamp/.test(ts) && /webhook-signature/.test(ts), 'and reads the Standard Webhooks headers');
  assert(!/\brequire\s*\(/.test(ts), 'index.ts makes no require() call — the Edge runtime crashes on createRequire');
}

console.log('\n== The app is actually cut over ==');
{
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const client = fs.readFileSync(path.join(ROOT, 'modules', 'supabase.js'), 'utf8');
  const PLANS = require(path.join(ROOT, 'data', 'plans.js'));
  const schema = fs.readFileSync(path.join(ROOT, 'supabase', 'schema.sql'), 'utf8');

  assert(/startCheckout\(/.test(app), 'checkoutFlow asks the registry for a session');
  assert(!/buy\.stripe\.com/.test(app), 'no Stripe payment link survives in the app');
  assert(!/stripe_customer_id|stripe_subscription_id|last_stripe_event_type/.test(app), 'the app reads no Stripe columns');
  assert(/PLANS\.isDodoCheckoutUrl\(/.test(app), 'the URL from the registry is still allowlisted before it becomes a link');
  assert(/customerPortalUrl\(/.test(app), 'Manage billing opens the Dodo portal');

  // The licence field existed ONLY as the last row of the pricing modal, and the
  // Upgrade button that opens that modal is hidden once an account is on a paid
  // plan — so the one person most likely to hold a key was the one person with no
  // visible way in. Settings must keep its own door to it.
  assert(/id="btnRedeemKey"/.test(app), 'Settings offers a “Redeem a licence key” entry point');
  assert(/'#btnRedeemKey'[\s\S]{0,80}openRedeemKey/.test(app), 'and the button opens the redeem screen');
  {
    const redeem = (app.match(/function openRedeemKey\(\)[\s\S]*?\n  \}/) || [''])[0];
    assert(redeem.length > 0, 'the redeem screen is defined');
    assert(/id="licKey"/.test(redeem), 'it renders its own key field');
    assert(/activateLicense\(key\.value\)/.test(redeem), 'and calls the same activateLicense the plan grid calls, so verification is unchanged');
  }
  assert(!/openBillingPortal/.test(client), 'the old portal call is gone from the client');
  assert(/dodo-checkout/.test(client), 'the client calls the dodo-checkout function');

  assert(typeof PLANS.isDodoCheckoutUrl === 'function', 'isDodoCheckoutUrl is exported');
  assert(PLANS.isDodoCheckoutUrl('https://checkout.dodopayments.com/buy/pdt_abc123') === true, 'a live Dodo checkout URL is accepted');
  assert(PLANS.isDodoCheckoutUrl('https://test.checkout.dodopayments.com/buy/pdt_abc123') === true, 'a test-mode Dodo checkout URL is accepted');
  assert(PLANS.isDodoCheckoutUrl('https://checkout.dodopayments.com/session/cks_9f2/complete') === true, 'a created session URL is accepted too');
  // A traversal-shaped URL is resolved by the URL parser before we see it, so
  // it cannot leave the host — and the host is the check that matters.
  assert(PLANS.isDodoCheckoutUrl('https://checkout.dodopayments.com/buy/../../evil') === true, 'a traversal-shaped URL resolves back onto the same host');
  assert(new URL('https://checkout.dodopayments.com/buy/../../evil').hostname === 'checkout.dodopayments.com', 'and cannot be made to point somewhere else');
  assert(PLANS.isDodoCheckoutUrl('https://evil.example/checkout.dodopayments.com/x') === false, 'a lookalike host is rejected');
  assert(PLANS.isDodoCheckoutUrl('https://checkout.dodopayments.com.evil.example/buy/pdt_1') === false, 'a suffixed host is rejected');
  assert(PLANS.isDodoCheckoutUrl('http://checkout.dodopayments.com/buy/pdt_1') === false, 'plain http is rejected');
  assert(PLANS.isDodoCheckoutUrl('javascript:alert(1)') === false, 'javascript: is rejected');
  assert(PLANS.isDodoCheckoutUrl('') === false, 'an empty URL is rejected');
  assert(PLANS.isBillablePlan('pro') && PLANS.isBillablePlan('proplus') && !PLANS.isBillablePlan('free'), 'only the paid tiers are billable');

  assert(!/apply_stripe_entitlement/.test(schema.replace(/drop function if exists[^;]*;/g, '')), 'no live Stripe RPC remains in the schema');
  assert(/drop function if exists public\.apply_stripe_entitlement/.test(schema), 'and the old one is explicitly dropped rather than left executable');
  assert(/apply_dodo_entitlement/.test(schema), 'the Dodo RPC is defined');

  // The registry decision lives in two places on purpose: the SQL function that
  // actually runs, and the JS mirror this file exercises. Keeping them in step
  // by hand is the exact thing that let a lifetime licence lose to a renewal —
  // the mirror was fixed and the database was not, or vice versa. So pin the
  // SHAPE of the SQL rather than trusting the pair to agree; the outcome text
  // alone would pass even if the branch sat in the wrong place.
  const fnStart = schema.indexOf('create or replace function public.apply_dodo_entitlement');
  assert(fnStart > -1, 'the SQL function body is found in schema.sql');
  const fnBody = schema.slice(fnStart, schema.indexOf('end $$;', fnStart));

  const paidStart = fnBody.indexOf('if p_paid then');
  const licStart = fnBody.indexOf("if v_prof.entitlement_source = 'license' then", paidStart);
  assert(paidStart > -1 && licStart > paidStart, 'the paid branch checks for a licence, and does it before resolving any plan');

  const licEnd = fnBody.indexOf('end if;', licStart);
  const licBranch = fnBody.slice(licStart, licEnd);
  assert(/entitlement_source = 'license'/.test(licBranch), 'and it keeps the source as license, so a later cancellation cannot revoke it');
  assert(licBranch.indexOf('plan_expires_at') === -1, 'and never writes plan_expires_at, so a lifetime key gains no expiry it was not issued with');
  assert(fnBody.indexOf('plan_expires_at = coalesce(p_expires_at, plan_expires_at)') > licEnd, 'the subscription period end is only stamped on the non-licence path');
  assert(!PLANS.isDodoCheckoutUrl(PLANS.customerPortalUrl()), 'the portal link is not mistaken for a checkout link');
}

if (failed) {
  console.error('\ndodo-entitlement-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\ndodo-entitlement-smoke PASSED');
