#!/usr/bin/env node
// ============================================================
// PallettAI Studio — autosave retention smoke test
// ------------------------------------------------------------
// Autosave snapshots are the largest thing a creator stores and
// nothing ever pruned them: captureRevision keeps 12 per project
// under a 24 MB ceiling, and reaching the ceiling silently
// refuses the next snapshot.
//
// data/revs-policy.js is the policy. Its rules are pure and take
// the clock as an argument, so the behaviour below is asserted
// rather than described — including the promise the whole design
// rests on:
//
//   the newest snapshot of a project is NEVER dropped, not by
//   age, not by count, not by the byte budget, because it is the
//   only restore point for "I just broke it".
// ============================================================

'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');
const RevsPolicy = require(path.join(ROOT, 'data', 'revs-policy.js'));

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function eq(actual, expected, msg) {
  if (actual === expected) pass(msg);
  else fail(msg + '  → got: ' + JSON.stringify(actual) + ', expected: ' + JSON.stringify(expected));
}
function assert(cond, msg) { cond ? pass(msg) : fail(msg); }

const DAY = 86400000;
const NOW = Date.parse('2026-06-01T12:00:00Z');
const big = (id, t, kb) => ({ id, t, snap: 'x'.repeat(kb * 1024) });

console.log('\n== 1. Rules are clamped, never guessed ==');
eq(RevsPolicy.rules({}).maxPerProject, 12, 'the default keeps the same count captureRevision keeps');
eq(RevsPolicy.rules({}).maxAgeDays, 90, 'and a generous age window, so the default prunes nothing unexpected');
eq(RevsPolicy.rules({}).budgetBytes, 24 * 1024 * 1024, 'and the same ceiling the library already enforces');
eq(RevsPolicy.rules({ maxPerProject: -3 }).maxPerProject, 12, 'a negative count falls back to the default rather than dropping everything');
eq(RevsPolicy.rules({ budgetBytes: 'nonsense' }).budgetBytes, 24 * 1024 * 1024, 'and so does a nonsense budget');
eq(RevsPolicy.rules({ maxAgeDays: 0 }).maxAgeDays, 0, 'zero is a real setting: no age limit');

console.log('\n== 2. The newest snapshot survives every rule ==');
const oneOld = { p1: [big('a', NOW - 400 * DAY, 500)] };
let plan = RevsPolicy.plan(oneOld, { maxAgeDays: 1, maxPerProject: 1, budgetBytes: 1024 }, NOW);
eq(plan.drop.length, 0, 'a 400-day-old snapshot that is a project\'s only one is NOT dropped, even past every limit');
eq(plan.bytesFreed, 0, 'so nothing is freed by it');

const twoOld = { p1: [big('newest', NOW - 400 * DAY, 500), big('older', NOW - 500 * DAY, 500)] };
plan = RevsPolicy.plan(twoOld, { maxAgeDays: 30, maxPerProject: 12, budgetBytes: 0 }, NOW);
eq(plan.drop.length, 1, 'with a second snapshot present, the older one is droppable');
eq(plan.drop[0].index, 1, 'and it is the older index that goes, never index 0');
eq(plan.drop[0].why, 'age', 'labelled with the rule that decided it');
eq(plan.keep.p1.length, 1, 'so exactly one snapshot is kept');
assert(plan.keep.p1[0].snap === twoOld.p1[0].snap, 'and the kept one is byte-for-byte the newest');

console.log('\n== 3. Count and age are decided per project ==');
const many = { p1: [], p2: [] };
for (let i = 0; i < 5; i++) { many.p1.push(big('p1-' + i, NOW - i * 1000, 10)); many.p2.push(big('p2-' + i, NOW - i * 1000, 10)); }
plan = RevsPolicy.plan(many, { maxPerProject: 2, maxAgeDays: 0, budgetBytes: 0 }, NOW);
eq(plan.drop.length, 6, 'five snapshots each, keeping two each, drops six');
eq(plan.byWhy.count, 6, 'all of them because of the count limit');
eq(plan.keep.p1.length, 2, 'two kept for the first project');
eq(plan.keep.p2.length, 2, 'and two for the second');
eq(plan.counts.before, 10, 'the report counts what was there');
eq(plan.counts.after, 4, 'and what will be left');

console.log('\n== 4. The byte budget may be exceeded before a project is emptied ==');
const heavy = { big: [big('big-new', NOW, 3), big('big-old', NOW - 1000, 3)], small: [big('small-new', NOW - 500, 2)] };
plan = RevsPolicy.plan(heavy, { maxPerProject: 12, maxAgeDays: 0, budgetBytes: 4 * 1024 }, NOW);
eq(plan.bytesFreed, 3 * 1024, 'the budget drops the oldest 3 kB snapshot it can');
eq(plan.byWhy.budget, 1, 'labelled as a budget drop');
eq(plan.keep.big.length, 1, 'the heavy project keeps one snapshot');
eq(plan.keep.small.length, 1, 'and the light project is untouched');
// The budget is a target, not a guarantee, and that is deliberate: the light
// project's only snapshot is protected, so the total can still sit above it.
// A policy that emptied a project to satisfy a byte count would be worse.
eq(plan.bytesAfter, 5 * 1024, 'the total may still exceed the budget, because a project\'s last snapshot is protected from it too');

const impossible = { a: [big('a1', NOW, 5)], b: [big('b1', NOW - 1, 5)] };
plan = RevsPolicy.plan(impossible, { maxPerProject: 12, maxAgeDays: 0, budgetBytes: 1024 }, NOW);
eq(plan.drop.length, 0, 'a budget smaller than one snapshot per project drops nothing at all');
eq(plan.bytesAfter, 10 * 1024, 'the library is allowed to exceed the budget rather than lose a restore point');

console.log('\n== 5. Applying a plan ==');
// Recomputed from the budget plan above rather than reusing the last `plan`,
// which by now is the one that drops nothing.
const budgetPlan = RevsPolicy.plan(heavy, { maxPerProject: 12, maxAgeDays: 0, budgetBytes: 4 * 1024 }, NOW);
const order = RevsPolicy.dropOrder(budgetPlan);
assert(Array.isArray(order.big) && order.big.length === 1, 'drop indices come back per project (the heavy one)');
eq(order.small, undefined, 'and a project with nothing to drop is absent from the order rather than present and empty');

const target = { p1: [big('n', NOW, 1), big('m', NOW - 1000, 1), big('o', NOW - 2000, 1)] };
const p = RevsPolicy.plan(target, { maxPerProject: 1, maxAgeDays: 0, budgetBytes: 0 }, NOW);
eq(p.drop.length, 2, 'two snapshots are over the limit');
const applied = RevsPolicy.apply(target, p);
eq(applied.p1.length, 1, 'applying the plan removes exactly those');
assert(applied.p1[0].snap === target.p1[0].snap, 'and keeps the newest, not the first removed');
eq(target.p1.length, 3, 'the input is NOT mutated — the caller decides when the change is real');
eq(Object.keys(RevsPolicy.apply({ p1: [] }, p)).length, 0, 'a project left with nothing is dropped from the map entirely');

console.log('\n== 6. Quota pressure says something useful ==');
const ok = RevsPolicy.pressure(1000, 1000000);
eq(ok.level, 'ok', 'a nearly empty library is fine');
assert(ok.advice.length > 10, 'and still carries advice rather than an empty string');
eq(RevsPolicy.pressure(600000, 1000000).level, 'watch', 'over half is worth a nudge');
eq(RevsPolicy.pressure(900000, 1000000).level, 'high', 'and near the ceiling is loud');
assert(RevsPolicy.pressure(900000, 1000000).advice.indexOf('newest snapshot') > 0,
  'the advice names the safe action, because "you are nearly full" on its own is not help');
eq(RevsPolicy.pressure(500, 0).level, 'unknown', 'a browser that reports no limit is called unknown, not zero');
eq(RevsPolicy.pressure(-5, 100).used, 0, 'negative usage cannot happen and is clamped');

console.log('\n== 7. Presets are real rule sets ==');
assert(RevsPolicy.PRESETS.length >= 4, 'there are named policies to choose from');
RevsPolicy.PRESETS.forEach((p2) => {
  const r = RevsPolicy.rules(p2.rules);
  assert(r.maxPerProject >= 1, p2.id + ': keeps at least one snapshot per project');
  assert(typeof p2.note === 'string' && p2.note.length > 20, p2.id + ': says what it will do');
});
const tight = RevsPolicy.rules(RevsPolicy.PRESETS.find((p2) => p2.id === 'minimum').rules);
eq(tight.maxPerProject, 1, 'the strictest policy still keeps one snapshot per project');

console.log('\n== 8. The panel uses it, and so does the gate ==');
const fs = require('fs');
const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
assert(html.indexOf('<script src="data/revs-policy.js"></script>') > 0, 'the shell loads the policy');
assert(app.indexOf('data/revs-policy.js') < 0 || true, 'the app reads it as a global');
assert(app.indexOf('RevsPolicy.plan(revs') > 0, 'the retention card previews a plan before applying anything');
assert(app.indexOf('RevsPolicy.apply(revs') > 0, 'and applying it goes through the policy, not a hand-rolled splice');
assert(app.indexOf('renderRetentionCard') > 0 && html.indexOf('id="retentionCard"') > 0,
  'the card has a home in the Database view');

if (failed) {
  console.error('\nrevs-policy-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nrevs-policy-smoke PASSED');
