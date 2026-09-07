'use strict';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAID_PLANS = { pro: true, proplus: true };

function emptyDb() {
  return { profiles: new Map(), events: new Set() };
}

function idOf(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return String(value.id || '');
}

function planFrom(obj) {
  const meta = (obj && obj.metadata) || {};
  const nested = (obj && obj.subscription_details && obj.subscription_details.metadata) || {};
  const raw = String(meta.plan || nested.plan || '').toLowerCase();
  return PAID_PLANS[raw] ? raw : '';
}

function accountFrom(obj) {
  const id = String((obj && obj.client_reference_id) || (obj && obj.metadata && obj.metadata.account_id) || '');
  return UUID.test(id) ? id : '';
}

function subscriptionId(obj) {
  if (!obj) return '';
  if (obj.object === 'subscription') return idOf(obj.id);
  return idOf(obj.subscription);
}

function expiresFrom(obj) {
  if (!obj) return null;
  let end = obj.current_period_end;
  if (!end && obj.items && Array.isArray(obj.items.data) && obj.items.data[0]) {
    end = obj.items.data[0].current_period_end;
  }
  if (!end) return null;
  const ms = Number(end) * 1000;
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}

function isPaid(type, obj) {
  if (type === 'checkout.session.completed' || type === 'checkout.session.async_payment_succeeded') {
    return obj && obj.payment_status === 'paid';
  }
  if (type === 'checkout.session.async_payment_failed' || type === 'checkout.session.expired') return false;
  if (type === 'invoice.paid') return true;
  if (type === 'invoice.payment_failed' || type === 'invoice.payment_action_required') return false;
  if (type === 'customer.subscription.updated') return obj && obj.status === 'active';
  if (type === 'customer.subscription.deleted' || type === 'customer.subscription.paused') return false;
  return null;
}

function mapStripeEvent(event) {
  const type = event && event.type;
  const obj = event && event.data && event.data.object;
  if (!type || !obj) return { ignore: true };
  const paid = isPaid(type, obj);
  if (paid == null) return { ignore: true };
  return {
    ignore: false,
    eventId: String(event.id || ''),
    eventType: type,
    paid: paid === true,
    accountId: accountFrom(obj),
    plan: planFrom(obj),
    customerId: idOf(obj.customer),
    subscriptionId: subscriptionId(obj),
    expiresAt: expiresFrom(obj)
  };
}

function findProfile(db, payload) {
  if (payload.accountId && db.profiles.has(payload.accountId)) return db.profiles.get(payload.accountId);
  if (payload.subscriptionId) {
    for (const profile of db.profiles.values()) {
      if (profile.stripe_subscription_id === payload.subscriptionId) return profile;
    }
  }
  if (payload.customerId) {
    for (const profile of db.profiles.values()) {
      if (profile.stripe_customer_id === payload.customerId) return profile;
    }
  }
  return null;
}

function billingStatusFromEvent(eventType, paid) {
  if (paid) return 'ok';
  const t = String(eventType || '');
  if (t.indexOf('expired') !== -1) return 'expired';
  if (t.indexOf('paused') !== -1) return 'paused';
  if (t.indexOf('deleted') !== -1 || t.indexOf('canceled') !== -1) return 'canceled';
  if (t.indexOf('action_required') !== -1) return 'action_required';
  if (t.indexOf('failed') !== -1) return 'failed';
  if (t.indexOf('unpaid') !== -1) return 'unpaid';
  return 'past_due';
}

function stampBilling(profile, payload, paid) {
  profile.billing_status = billingStatusFromEvent(payload.eventType, paid);
  profile.billing_status_at = new Date().toISOString();
  profile.last_stripe_event_type = payload.eventType || '';
}

function applyEntitlement(db, payload) {
  if (!payload || payload.ignore) return { outcome: 'ignored' };
  const eventId = String(payload.eventId || '').trim();
  if (eventId.length < 4) return { outcome: 'bad-event' };
  if (db.events.has(eventId)) return { outcome: 'duplicate' };
  db.events.add(eventId);

  const profile = findProfile(db, payload);
  if (!profile) return { outcome: 'no-account' };

  if (payload.paid) {
    const plan = PAID_PLANS[payload.plan] ? payload.plan
      : (PAID_PLANS[profile.plan] ? profile.plan : '');
    if (!plan) return { outcome: 'bad-plan' };
    profile.plan = plan;
    profile.plan_expires_at = payload.expiresAt || profile.plan_expires_at || null;
    if (payload.customerId) profile.stripe_customer_id = payload.customerId;
    if (payload.subscriptionId) profile.stripe_subscription_id = payload.subscriptionId;
    profile.entitlement_source = 'stripe';
    stampBilling(profile, payload, true);
    return { outcome: 'granted', plan: profile.plan, accountId: profile.id };
  }

  if (profile.entitlement_source === 'license') {
    return { outcome: 'kept-license', accountId: profile.id };
  }

  if (profile.entitlement_source === 'stripe'
    || (payload.subscriptionId && profile.stripe_subscription_id === payload.subscriptionId)) {
    profile.plan = 'free';
    profile.plan_expires_at = null;
    profile.stripe_subscription_id = null;
    profile.entitlement_source = null;
    stampBilling(profile, payload, false);
    return { outcome: 'revoked', accountId: profile.id };
  }

  return { outcome: 'ignored', accountId: profile.id };
}

function verifyStripeSignature(payload, header, secret, nowMs) {
  if (!payload || !header || !secret) return false;
  const crypto = require('crypto');
  let timestamp = '';
  const signatures = [];
  String(header).split(',').forEach((part) => {
    const i = part.indexOf('=');
    if (i < 0) return;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (key === 't') timestamp = value;
    if (key === 'v1') signatures.push(value);
  });
  if (!timestamp || !signatures.length) return false;
  const age = Math.abs((nowMs || Date.now()) - Number(timestamp) * 1000);
  if (!Number.isFinite(age) || age > 5 * 60 * 1000) return false;
  const expected = crypto.createHmac('sha256', secret).update(timestamp + '.' + payload).digest('hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  return signatures.some((sig) => {
    try {
      const got = Buffer.from(sig, 'hex');
      return got.length === expectedBuf.length && crypto.timingSafeEqual(got, expectedBuf);
    } catch (_) {
      return false;
    }
  });
}

const api = { emptyDb, mapStripeEvent, applyEntitlement, verifyStripeSignature, billingStatusFromEvent };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
