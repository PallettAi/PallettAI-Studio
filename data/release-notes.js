'use strict';

// What's New registry — the top entry drives the once-per-version modal.
// Bump `version` when you ship. Each entry: version, date, tagline, highlights[].
// Keep highlights to 3-4 items, written as user-facing wins (not commit logs).
const RELEASE_NOTES = {
  version: '0.4.5',
  date: 'September 16, 2026',
  tagline: 'The key we issued you now has somewhere to go \u2014 and cannot be quietly taken back',
  highlights: [
    {
      icon: 'lock',
      title: 'Your key has a door of its own',
      desc: 'A licence key could only ever be entered as the last row of the plan grid \u2014 and once an account is on a paid plan, the Upgrade button that opens that grid is hidden. So the one person most likely to be holding a key was the one person with no visible way to type it in. Settings now has Redeem a licence key under Plan & billing, with the referral box beside it, and it is there whatever plan you are on. It is the same verification as before, given its own door.'
    },
    {
      icon: 'clock',
      title: 'A key issued for life can no longer acquire an expiry',
      desc: 'This was the quiet one. A key that never expires was safe from a cancellation but not from a renewal: any paid event from the payment provider copied the subscription\u2019s period end onto the key, so a permanent licence silently picked up a date it had never been given \u2014 and the app, quite correctly, then treated that key as temporary. No expiry is written onto a licence any more, whatever the subscription says.'
    },
    {
      icon: 'shield',
      title: 'And it stays a licence, so it cannot be revoked by one',
      desc: 'The same renewal relabelled the entitlement as a subscription. That mattered later, not immediately: cancelling a subscription is deliberately not allowed to revoke a licence we issued, but once the label said subscription, a cancellation revoked a key that was never revocable at all. A licence keeps its own tier now \u2014 the tier may only move upward, and billing, the customer portal and your receipts are untouched either way.'
    }
  ]
};

if (typeof module !== 'undefined' && module.exports) module.exports = RELEASE_NOTES;
