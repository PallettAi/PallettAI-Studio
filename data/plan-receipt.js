'use strict';

const PLAN_NAMES = { free: 'Free', pro: 'Pro', proplus: 'Pro+' };
const SOURCE_NAMES = { stripe: 'Stripe', license: 'License key', trial: 'Trial', registry: 'Registry', review: 'Review gift' };
const FAIL_COPY = {
  failed: 'Payment failed — you are back on Free.',
  canceled: 'Subscription canceled — you are back on Free.',
  past_due: 'Payment past due — you are back on Free.',
  unpaid: 'Invoice unpaid — you are back on Free.',
  paused: 'Subscription paused — you are back on Free.',
  expired: 'Checkout expired — no plan was unlocked.',
  action_required: 'Payment needs another step — you are back on Free.'
};

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

function failureCopy(status) {
  return FAIL_COPY[status] || '';
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function remainingFromUntil(until, nowMs) {
  const end = typeof until === 'number' ? until : Date.parse(until);
  if (!Number.isFinite(end)) return '';
  const left = Math.max(0, end - (Number(nowMs) || Date.now()));
  if (!left) return '';
  return Math.floor(left / 36e5) + 'h ' + Math.floor((left % 36e5) / 6e4) + 'm';
}

function receiptLines(input) {
  const rec = input || {};
  const now = Number(rec.now) || Date.now();
  const remaining = remainingFromUntil(rec.reviewUntil, now);
  const reviewActive = !!remaining;
  const plan = reviewActive ? 'Pro+ Review Trial' : (PLAN_NAMES[rec.plan] || rec.plan || 'Free');
  const source = reviewActive ? (SOURCE_NAMES.review)
    : (rec.trialDays > 0 && rec.source !== 'stripe' && rec.source !== 'license'
      ? 'Trial'
      : (SOURCE_NAMES[rec.source] || (rec.source ? rec.source : 'This device')));
  const lines = [
    { label: 'Plan', value: plan },
    { label: 'Source', value: source }
  ];
  if (rec.expiresAt) lines.push({ label: 'Renews', value: formatDate(rec.expiresAt) });
  if (remaining) lines.push({ label: 'Remaining', value: remaining });
  if (rec.trialDays > 0) lines.push({ label: 'Trial', value: rec.trialDays + ' day' + (rec.trialDays === 1 ? '' : 's') + ' left' });
  if (rec.lastEventType) lines.push({ label: 'Last event', value: rec.lastEventType });
  if (rec.billingStatus && rec.billingStatus !== 'ok') {
    lines.push({ label: 'Status', value: rec.billingStatus.replace(/_/g, ' ') });
  }
  return lines;
}

function isPaidReturn(search) {
  try {
    const q = new URLSearchParams(String(search || '').replace(/^\?/, ''));
    return q.get('paid') === '1';
  } catch (_) {
    return false;
  }
}

function paidReturnUrl(loc) {
  const place = loc || {};
  if (!place.origin || place.protocol === 'file:') return 'https://pallettai.org/?paid=1';
  const path = place.pathname || '/';
  return place.origin + path + (path.indexOf('?') === -1 ? '?paid=1' : '&paid=1');
}

const PlanReceipt = { billingStatusFromEvent, failureCopy, receiptLines, isPaidReturn, paidReturnUrl, formatDate };
if (typeof module !== 'undefined' && module.exports) module.exports = PlanReceipt;
