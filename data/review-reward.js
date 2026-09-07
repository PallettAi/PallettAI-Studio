'use strict';

const DAYS = 3;
const NAME_MIN = 2;
const NAME_MAX = 80;
const QUOTE_MIN = 40;
const QUOTE_MAX = 800;
const PAID = { pro: true, proplus: true };

function normalizeClaim(input) {
  const name = String((input && input.name) || '').trim().replace(/\s+/g, ' ').slice(0, NAME_MAX);
  const quote = String((input && input.quote) || '').trim().replace(/\s+/g, ' ').slice(0, QUOTE_MAX);
  if (name.length < NAME_MIN) return { ok: false, reason: 'name', name, quote };
  if (quote.length < QUOTE_MIN) return { ok: false, reason: 'quote', name, quote };
  return { ok: true, name, quote };
}

function isPaidEntitlement(profile, nowMs) {
  const p = profile || {};
  if (p.entitlement_source !== 'stripe' && p.entitlement_source !== 'license') return false;
  if (!PAID[p.plan]) return false;
  if (!p.plan_expires_at) return true;
  return Date.parse(p.plan_expires_at) > (nowMs || Date.now());
}

function applyReviewClaim(db, input) {
  const accountId = String((input && input.accountId) || '');
  if (!accountId) return { outcome: 'not-signed-in' };
  const clean = normalizeClaim(input || {});
  if (!clean.ok) return { outcome: 'bad-input', reason: clean.reason };
  if (!db || !db.profiles || !db.profiles.has(accountId)) return { outcome: 'no-account' };
  if (db.rewards && db.rewards.has(accountId)) return { outcome: 'already-claimed' };

  const now = Number(input.now) || Date.now();
  const iso = new Date(now).toISOString();
  const profile = db.profiles.get(accountId);
  if (profile.review_claimed_at) return { outcome: 'already-claimed' };

  db.rewards = db.rewards || new Map();
  db.rewards.set(accountId, { owner_id: accountId, display_name: clean.name, quote: clean.quote, created_at: iso });
  profile.review_claimed_at = iso;

  if (isPaidEntitlement(profile, now)) {
    return { outcome: 'already-paid', days: 0 };
  }

  const until = new Date(now + DAYS * 864e5).toISOString();
  profile.review_proplus_until = until;
  return { outcome: 'granted', days: DAYS, until };
}

function remainingClock(untilMs, nowMs) {
  const left = Math.max(0, (Number(untilMs) || 0) - (Number(nowMs) || Date.now()));
  if (!left) return '';
  const hours = Math.floor(left / 36e5);
  const minutes = Math.floor((left % 36e5) / 6e4);
  return hours + 'h ' + minutes + 'm';
}

function reviewPlanLabel(untilMs, nowMs) {
  const clock = remainingClock(untilMs, nowMs);
  if (!clock) return '';
  return 'Pro+ Review Trial · ' + DAYS + ' day · ' + clock;
}

const ReviewReward = { DAYS, normalizeClaim, isPaidEntitlement, applyReviewClaim, remainingClock, reviewPlanLabel };
if (typeof module !== 'undefined' && module.exports) module.exports = ReviewReward;
