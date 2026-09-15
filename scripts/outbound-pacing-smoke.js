#!/usr/bin/env node
// ============================================================
// PallettAI Studio — outbound pacing smoke test
// ------------------------------------------------------------
// Free tiers are spent by the requests a UI makes when nothing
// has changed. The pattern that does it is retrying on failure
// more eagerly than on success: an unreachable registry, a paused
// project or a pulled cable used to make every save fire another
// request, so the harder the service struggled the faster we
// asked.
//
// `ONLINE.dueForRetry` is the pure decision that stops this. It
// takes the clock as an argument, so the behaviour is asserted
// here rather than described in a comment — the assertions below
// are real calls, not source greps.
// ============================================================

'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');
const ONLINE = require(path.join(ROOT, 'data', 'online.js'));

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function eq(actual, expected, msg) {
  if (actual === expected) pass(msg);
  else fail(msg + '  → got: ' + JSON.stringify(actual) + ', expected: ' + JSON.stringify(expected));
}

const T0 = 1_700_000_000_000;
const DEFAULTS = { okTtlMs: 45000, failMs: 15000, failCapMs: 300000 };

console.log('== 1. A known-good read is trusted for its window ==');
eq(ONLINE.dueForRetry({ lastSuccess: T0, failures: 0 }, T0 + 1000), false, 'a read one second old is not due again');
eq(ONLINE.dueForRetry({ lastSuccess: T0, failures: 0 }, T0 + 44000), false, 'still inside the 45s window');
eq(ONLINE.dueForRetry({ lastSuccess: T0, failures: 0 }, T0 + 45000), true, 'due once the window has elapsed');
eq(ONLINE.dueForRetry({ failures: 0 }, T0), true, 'nothing fetched yet is due immediately');
eq(ONLINE.dueForRetry({ lastSuccess: 0, failures: 0 }, T0), true, 'a zero success stamp means never fetched');

console.log('\n== 2. Waiting is not widened by success, only by failure ==');
eq(ONLINE.dueForRetry({ lastSuccess: T0, lastAttempt: T0, failures: 0 }, T0 + 1000), false, 'a success resets to the normal cadence');

console.log('\n== 3. A failure widens the gap instead of retrying on every render ==');
const firstFail = { lastSuccess: 0, lastAttempt: T0, failures: 1 };
eq(ONLINE.dueForRetry(firstFail, T0 + 1000), false, 'one second after a failure: not yet');
eq(ONLINE.dueForRetry(firstFail, T0 + 14000), false, 'fourteen seconds after: still not yet');
eq(ONLINE.dueForRetry(firstFail, T0 + 15000), true, 'fifteen seconds after: due');

const secondFail = { lastSuccess: 0, lastAttempt: T0, failures: 2 };
eq(ONLINE.dueForRetry(secondFail, T0 + 15000), false, 'a second failure waits longer than the first did');
eq(ONLINE.dueForRetry(secondFail, T0 + 30000), true, 'the second failure is due at thirty seconds');

const thirdFail = { lastSuccess: 0, lastAttempt: T0, failures: 3 };
eq(ONLINE.dueForRetry(thirdFail, T0 + 30000), false, 'a third failure waits longer still');
eq(ONLINE.dueForRetry(thirdFail, T0 + 60000), true, 'the third failure is due at a minute');

console.log('\n== 4. The gap is capped, so it never becomes "never" ==');
const manyFailures = { lastSuccess: 0, lastAttempt: T0, failures: 40 };
eq(ONLINE.dueForRetry(manyFailures, T0 + 299000), false, 'still waiting just inside the cap');
eq(ONLINE.dueForRetry(manyFailures, T0 + 300000), true, 'due at the five-minute cap');
eq(ONLINE.dueForRetry(manyFailures, T0 + 86400000), true, 'a day later it is still willing to try');

console.log('\n== 5. A success restores the cadence after a failing spell ==');
const recovered = { lastSuccess: T0 + 600000, lastAttempt: T0 + 600000, failures: 0 };
eq(ONLINE.dueForRetry(recovered, T0 + 600001), false, 'immediately after success: not due');
eq(ONLINE.dueForRetry(recovered, T0 + 645001), true, 'and due again after the normal window');

console.log('\n== 6. Absent or malformed state is safe ==');
eq(ONLINE.dueForRetry(undefined, T0), true, 'no state at all is due');
eq(ONLINE.dueForRetry({}, T0), true, 'an empty state is due');
eq(ONLINE.dueForRetry({ lastSuccess: T0, failures: -5 }, T0 + 1000), false, 'a negative failure count is treated as zero');
eq(ONLINE.dueForRetry({ lastSuccess: T0, failures: 'x' }, T0 + 1000), false, 'a non-numeric failure count is treated as zero');
eq(ONLINE.dueForRetry({ lastSuccess: Date.now(), failures: 0 }, NaN), false, 'a NaN clock falls back to the real one');
eq(ONLINE.dueForRetry({ lastSuccess: Date.now(), failures: 0 }), false, 'called without a clock it uses the real one');

console.log('\n== 7. The overrides the caller passes are honoured ==');
eq(ONLINE.dueForRetry({ lastSuccess: T0, failures: 0, okTtlMs: 1000 }, T0 + 2000), true, 'a shorter success window is respected');
eq(ONLINE.dueForRetry({ lastAttempt: T0, failures: 1, failMs: 100, failCapMs: 500 }, T0 + 100), true, 'a shorter failure gap is respected');
eq(ONLINE.dueForRetry({ lastAttempt: T0, failures: 4, failMs: 10000, failCapMs: 12000 }, T0 + 11500), false, 'the caller\'s cap is respected');
eq(ONLINE.dueForRetry({ lastSuccess: T0, failures: 0, okTtlMs: -5 }, T0 + 1), false, 'a nonsense window falls back to the default');

console.log('\n== 8. The streak widget is wired to it ==');
const fs = require('fs');
const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
if (/ONLINE\.dueForRetry\(\{/.test(app)) pass('the streak hydrate asks the pacer before fetching');
else fail('the streak hydrate does not use the pacer');
if (/STREAK\.flight/.test(app)) pass('the streak fetch is single-flight');
else fail('the streak fetch can run twice at once');
if (/STREAK\.failures\+\+/.test(app)) pass('a failed streak read is counted');
else fail('a failed streak read is not counted');

if (failed) {
  console.error('\noutbound-pacing-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\noutbound-pacing-smoke PASSED');
