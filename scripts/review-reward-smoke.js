#!/usr/bin/env node
// One testimonial claim → 3 days of Pro+. A second claim grants nothing.
'use strict';

const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function assert(cond, msg) { cond ? pass(msg) : fail(msg); }

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const QUOTE = 'PallettAI Studio let me ship a client site in an afternoon without locking them into a host.';

let reward;
try {
  reward = require(path.join(ROOT, 'data', 'review-reward.js'));
} catch (e) {
  console.error('review-reward-smoke FAILED — module missing: ' + e.message);
  process.exit(1);
}

function empty() {
  return {
    profiles: new Map([[ACCOUNT, {
      id: ACCOUNT, plan: 'free', plan_expires_at: null,
      entitlement_source: null, review_proplus_until: null, review_claimed_at: null
    }]]),
    rewards: new Map()
  };
}

const now = Date.parse('2026-09-07T12:00:00.000Z');

console.log('== Validate ==');
assert(reward.normalizeClaim({ name: 'A', quote: QUOTE }).ok === false, 'name that is too short is rejected');
assert(reward.normalizeClaim({ name: 'Corey', quote: 'Nice app' }).ok === false, 'short quote is rejected');
assert(reward.normalizeClaim({ name: 'Corey', quote: QUOTE }).ok === true, 'a real name and quote pass');

console.log('\n== First claim grants 3 days of Pro+ ==');
{
  const db = empty();
  const r = reward.applyReviewClaim(db, { accountId: ACCOUNT, name: 'Corey', quote: QUOTE, now });
  assert(r.outcome === 'granted', 'first claim is granted');
  assert(r.days === 3, 'grant is 3 days');
  const p = db.profiles.get(ACCOUNT);
  assert(p.review_claimed_at === new Date(now).toISOString(), 'claimed_at is stamped');
  assert(Date.parse(p.review_proplus_until) === now + 3 * 864e5, 'Pro+ window is now + 3 days');
  assert(db.rewards.has(ACCOUNT), 'testimonial is stored');
}

console.log('\n== Second claim is blocked ==');
{
  const db = empty();
  reward.applyReviewClaim(db, { accountId: ACCOUNT, name: 'Corey', quote: QUOTE, now });
  const until = db.profiles.get(ACCOUNT).review_proplus_until;
  const r = reward.applyReviewClaim(db, { accountId: ACCOUNT, name: 'Corey', quote: QUOTE + ' again', now: now + 1000 });
  assert(r.outcome === 'already-claimed', 'repeat claim is already-claimed');
  assert(db.profiles.get(ACCOUNT).review_proplus_until === until, 'window is not extended');
  assert(db.rewards.size === 1, 'only one testimonial row exists');
}

console.log('\n== Paid Pro+ consumes the claim without extra days ==');
{
  const db = empty();
  Object.assign(db.profiles.get(ACCOUNT), {
    plan: 'proplus', entitlement_source: 'stripe', plan_expires_at: null
  });
  const r = reward.applyReviewClaim(db, { accountId: ACCOUNT, name: 'Corey', quote: QUOTE, now });
  assert(r.outcome === 'already-paid', 'paid Pro+ is already-paid');
  assert(!db.profiles.get(ACCOUNT).review_proplus_until, 'no gift window is added');
  assert(db.rewards.has(ACCOUNT), 'testimonial is still stored so they cannot claim later');
}

console.log('\n== Unsigned claim is refused ==');
{
  const r = reward.applyReviewClaim(empty(), { accountId: '', name: 'Corey', quote: QUOTE, now });
  assert(r.outcome === 'not-signed-in', 'no account id is not-signed-in');
}

console.log('\n== Plan & billing label uses remaining hours and minutes ==');
{
  const until = now + (71 * 36e5) + (24 * 6e4) + 30e3;
  assert(reward.remainingClock(until, now) === '71h 24m', '71h 24m 30s floors to 71h 24m');
  assert(reward.remainingClock(now + 72 * 36e5, now) === '72h 0m', 'exactly 3 days is 72h 0m');
  assert(reward.remainingClock(now + 45 * 6e4, now) === '0h 45m', 'under one hour still shows hours');
  assert(reward.remainingClock(now - 1000, now) === '', 'expired window has no clock');
  assert(
    reward.reviewPlanLabel(until, now) === 'Pro+ Review Trial · 3 day · 71h 24m',
    'billing label is Pro+ Review Trial with 3 day gift and remaining clock'
  );
  assert(reward.reviewPlanLabel(now - 1000, now) === '', 'expired gift has no billing label');
}

console.log('\n== Studio wires the claim ==');
{
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const client = fs.readFileSync(path.join(ROOT, 'modules', 'supabase.js'), 'utf8');
  const schema = fs.readFileSync(path.join(ROOT, 'supabase', 'schema.sql'), 'utf8');
  assert(/claimReviewReward|claim_review_reward/.test(client), 'client calls claim_review_reward');
  assert(/Leave a review|testimonial/.test(app), 'Settings has the review form');
  assert(/reviewProPlusUntil|applyReviewProPlus|isProPlus/.test(app + fs.readFileSync(path.join(ROOT, 'data', 'plans.js'), 'utf8')), 'store can hold a review Pro+ window');
  assert(/reviewPlanLabel/.test(app), 'Plan & billing uses the review trial label');
  assert(/claim_review_reward/.test(schema), 'schema has the one-claim RPC');
  assert(/review_rewards/.test(schema) && /owner_id/.test(schema), 'testimonials are unique per account');
}

if (failed) {
  console.error('\nreview-reward-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nreview-reward-smoke PASSED');
