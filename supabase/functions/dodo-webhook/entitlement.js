'use strict';

// ============================================================
// Dodo Payments → entitlement mapping.
//
// This file is the *readable* half: index.ts is the Deno copy that
// actually runs, and this one is what the smoke suite exercises, so the
// decision of "does this event mean the customer has paid" can be tested
// without a network, a signature, or a database.
//
// The separation matters more here than it did under Stripe, because Dodo
// reports subscription state far more often than Stripe did: `updated` fires
// on *any* field change. A reader that treats "an event arrived" as "the plan
// changed" would downgrade people whose billing address was edited.
// ============================================================

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAID_PLANS = { pro: true, proplus: true };

// Every status Dodo can report, and whether it means "this person has access
// right now". Anything not in here is unreadable and gets ignored rather than
// guessed at.
const STATUS_PAID = {
  active: true,
  past_due: true,    // grace period is open — Dodo keeps them working until past_due_ends_at
  pending: false,
  on_hold: false,
  paused: false,
  cancelled: false,
  failed: false,
  expired: false
};

function emptyDb() {
  return { profiles: new Map(), events: new Set() };
}

function obj(value) {
  return value && typeof value === 'object' ? value : {};
}

function str(value) {
  return value == null ? '' : String(value);
}

function idOf(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return str(value.id || value.customer_id);
}

function planFrom(data) {
  const raw = str(obj(data.metadata).plan).toLowerCase();
  return PAID_PLANS[raw] ? raw : '';
}

// The account this purchase belongs to. It is written into the session's
// metadata by dodo-checkout, where the server derived it from the caller's own
// JWT — so unlike a client-supplied reference it cannot be forged.
function accountFrom(data) {
  const id = str(obj(data.metadata).account_id || obj(data.metadata).accountId);
  return UUID.test(id) ? id : '';
}

function customerIdFrom(data) {
  return idOf(obj(data.customer).customer_id || obj(data.customer).id || data.customer_id);
}

function subscriptionIdFrom(data) {
  return str(data.subscription_id || obj(data.subscription).subscription_id);
}

// Dodo sends ISO-8601 date-times, so there is no epoch-seconds conversion to
// get wrong the way there was with Stripe.
function isoOrNull(value) {
  if (!value) return null;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}

/**
 * When a subscription is ending, Dodo still expects you to honour the period
 * already paid for. Two shapes say that:
 *   - cancelled with cancel_at_next_billing_date → they keep access until then
 *   - past_due                                 → grace period, ends at past_due_ends_at
 * Reading either as an immediate revoke would cut off a paying customer, so
 * the expiry is carried through instead of the event being flattened to a boolean.
 */
function expiryFrom(type, data) {
  if (type === 'subscription.past_due') {
    return isoOrNull(data.past_due_ends_at) || isoOrNull(data.next_billing_date);
  }
  if (type === 'subscription.cancelled' && data.cancel_at_next_billing_date === true) {
    return isoOrNull(data.next_billing_date);
  }
  return isoOrNull(data.next_billing_date);
}

/**
 * The whole decision, in one place. Returns null for anything unrecognised, and
 * the caller ignores those rather than defaulting to either answer.
 */
function isPaid(type, data) {
  const t = str(type);

  if (t === 'subscription.active' || t === 'subscription.renewed' || t === 'subscription.unpaused') {
    return true;
  }
  if (t === 'subscription.cancelled' && data.cancel_at_next_billing_date === true) {
    // Paid through the end of the period; revoked by expiry, not by this event.
    return true;
  }
  if (t === 'subscription.plan_changed' || t === 'subscription.updated') {
    // `updated` fires on any field change, so the status is the only honest
    // signal here — not the arrival of the event.
    const status = str(data.status).toLowerCase();
    return Object.prototype.hasOwnProperty.call(STATUS_PAID, status) ? STATUS_PAID[status] : null;
  }
  if (t === 'subscription.past_due' || t === 'subscription.on_hold' || t === 'subscription.paused'
    || t === 'subscription.cancelled' || t === 'subscription.failed' || t === 'subscription.expired') {
    const status = str(data.status).toLowerCase();
    if (Object.prototype.hasOwnProperty.call(STATUS_PAID, status) && status !== 'active') {
      return STATUS_PAID[status];
    }
    return false;
  }

  // One-off payments. Studio sells subscriptions, so a payment only tells us
  // anything when it belongs to one. A bare one-off returns null (ignore) and
  // NOT false: false means "this customer has not paid", which would revoke.
  if (t === 'payment.succeeded') {
    return subscriptionIdFrom(data) ? true : null;
  }
  if (t === 'payment.processing') {
    return null; // not terminal — wait for the terminal event
  }
  if (t === 'payment.failed') {
    // Only meaningful against a subscription we own; Dodo also sends its own
    // subscription.on_hold for a failed renewal, which is the primary signal.
    return subscriptionIdFrom(data) ? false : null;
  }
  if (t === 'payment.cancelled') {
    // An abandoned checkout is not a cancelled plan.
    return null;
  }

  return null;
}

function mapDodoEvent(event) {
  const type = str(event && event.type);
  const data = obj(event && event.data);
  if (!type || !event || !event.data) return { ignore: true };

  const paid = isPaid(type, data);
  if (paid == null) return { ignore: true };

  return {
    ignore: false,
    // Standard Webhooks carries the idempotency key in a header; the body
    // fallback keeps a hand-replayed payload testable.
    eventId: str(event.webhook_id || event.id || data.webhook_id || ''),
    eventType: type,
    paid: paid === true,
    accountId: accountFrom(data),
    plan: planFrom(data),
    customerId: customerIdFrom(data),
    subscriptionId: subscriptionIdFrom(data),
    expiresAt: expiryFrom(type, data)
  };
}

function findProfile(db, payload) {
  if (payload.accountId && db.profiles.has(payload.accountId)) return db.profiles.get(payload.accountId);
  if (payload.subscriptionId) {
    for (const profile of db.profiles.values()) {
      if (profile.dodo_subscription_id === payload.subscriptionId) return profile;
    }
  }
  if (payload.customerId) {
    for (const profile of db.profiles.values()) {
      if (profile.dodo_customer_id === payload.customerId) return profile;
    }
  }
  return null;
}

function billingStatusFromEvent(eventType, paid) {
  if (paid) return 'ok';
  const t = str(eventType);
  if (t.indexOf('expired') !== -1) return 'expired';
  if (t.indexOf('on_hold') !== -1) return 'on_hold';
  if (t.indexOf('paused') !== -1) return 'paused';
  if (t.indexOf('cancelled') !== -1 || t.indexOf('canceled') !== -1) return 'cancelled';
  if (t.indexOf('past_due') !== -1) return 'past_due';
  if (t.indexOf('failed') !== -1) return 'failed';
  if (t.indexOf('pending') !== -1) return 'pending';
  return 'failed';
}

function stampBilling(profile, payload, paid) {
  profile.billing_status = billingStatusFromEvent(payload.eventType, paid);
  profile.billing_status_at = new Date().toISOString();
  profile.last_dodo_event_type = payload.eventType || '';
}

// Note what this deliberately does NOT do: it never decides that a grant has
// lapsed. Expiry is carried as a date and enforced where it is read (the app's
// isPro(), creditPayload, claim_review_reward), so `cancelled at the end of the
// period` and a grace period both keep working without a webhook to remind us.
function applyEntitlement(db, payload) {
  if (!payload || payload.ignore) return { outcome: 'ignored' };
  const eventId = str(payload.eventId).trim();
  // Dodo retries until acknowledged, so the same event WILL arrive twice.
  if (eventId.length < 4) return { outcome: 'bad-event' };
  if (db.events.has(eventId)) return { outcome: 'duplicate' };
  db.events.add(eventId);

  const profile = findProfile(db, payload);
  if (!profile) return { outcome: 'no-account' };

  if (payload.paid) {
    // A grant with no readable plan is refused rather than defaulting to Pro:
    // an unmapped product id must fail loudly, not hand out the flagship tier.
    const plan = PAID_PLANS[payload.plan] ? payload.plan
      : (PAID_PLANS[profile.plan] ? profile.plan : '');
    if (!plan) return { outcome: 'bad-plan' };
    profile.plan = plan;
    profile.plan_expires_at = payload.expiresAt || profile.plan_expires_at || null;
    if (payload.customerId) profile.dodo_customer_id = payload.customerId;
    if (payload.subscriptionId) profile.dodo_subscription_id = payload.subscriptionId;
    profile.entitlement_source = 'dodo';
    stampBilling(profile, payload, true);
    return { outcome: 'granted', plan: profile.plan, accountId: profile.id };
  }

  // A license key the studio handed out outranks a lapsed card.
  if (profile.entitlement_source === 'license') {
    return { outcome: 'kept-license', accountId: profile.id };
  }

  const ours = profile.entitlement_source === 'dodo'
    || (payload.subscriptionId && profile.dodo_subscription_id === payload.subscriptionId);

  // Legacy Stripe rows are deliberately left untouched: the code is cut over,
  // but silently stripping Pro from someone still paying on the old provider
  // would be a decision to make by hand, not by a webhook.
  if (ours) {
    profile.plan = 'free';
    profile.plan_expires_at = null;
    profile.dodo_subscription_id = null;
    profile.entitlement_source = null;
    stampBilling(profile, payload, false);
    return { outcome: 'revoked', accountId: profile.id };
  }

  return { outcome: 'ignored', accountId: profile.id };
}

/* ── Standard Webhooks verification ──────────────────────────────────── */

function parseSignatureHeader(header) {
  // "v1,<b64> v1,<b64>" — several signatures during key rotation.
  return str(header).trim().split(/\s+/).map((part) => {
    const i = part.indexOf(',');
    if (i < 0) return null;
    return { version: part.slice(0, i).trim(), value: part.slice(i + 1).trim() };
  }).filter(Boolean);
}

function decodeSecret(secret) {
  const raw = str(secret);
  const body = raw.startsWith('whsec_') ? raw.slice(6) : raw;
  try {
    const buf = Buffer.from(body, 'base64');
    // A non-base64 secret (some test harnesses pass a literal) still works.
    return buf.length ? buf : Buffer.from(raw, 'utf8');
  } catch (_) {
    return Buffer.from(raw, 'utf8');
  }
}

/**
 * Dodo follows the Standard Webhooks spec, which is not Stripe's scheme:
 * the signed content is `id.timestamp.body` (not `timestamp.body`), the secret
 * is base64 behind a `whsec_` prefix, and the signature is base64 (not hex).
 * Getting any one of those wrong rejects every genuine webhook.
 */
function verifyStandardWebhook(payload, headers, secret, nowMs, toleranceMs) {
  if (!payload || !secret) return false;
  const h = obj(headers);
  const id = str(h['webhook-id'] || h['svix-id']).trim();
  const timestamp = str(h['webhook-timestamp'] || h['svix-timestamp']).trim();
  const signature = str(h['webhook-signature'] || h['svix-signature']).trim();
  if (!id || !timestamp || !signature) return false;

  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) return false;
  const age = Math.abs((Number(nowMs) || Date.now()) - seconds * 1000);
  if (age > (Number(toleranceMs) || 5 * 60 * 1000)) return false;

  const crypto = require('crypto');
  const expected = crypto.createHmac('sha256', decodeSecret(secret))
    .update(id + '.' + timestamp + '.' + payload)
    .digest();

  return parseSignatureHeader(signature).some((sig) => {
    if (sig.version && sig.version !== 'v1') return false;
    let got;
    try { got = Buffer.from(sig.value, 'base64'); } catch (_) { return false; }
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  });
}

// The Deno build cannot require('crypto'), so index.ts reimplements this with
// Web Crypto against the same rules. This export exists so the suite can prove
// the two agree.
function signStandardWebhook(payload, id, timestamp, secret) {
  const crypto = require('crypto');
  const sig = crypto.createHmac('sha256', decodeSecret(secret))
    .update(id + '.' + timestamp + '.' + payload)
    .digest('base64');
  return 'v1,' + sig;
}

const api = {
  emptyDb,
  mapDodoEvent,
  applyEntitlement,
  verifyStandardWebhook,
  signStandardWebhook,
  billingStatusFromEvent,
  isPaid,
  STATUS_PAID
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
