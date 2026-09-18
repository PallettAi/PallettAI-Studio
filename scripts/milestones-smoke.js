#!/usr/bin/env node
// ============================================================
// PallettAI Studio — named milestones smoke
// ------------------------------------------------------------
// Milestones are the one part of autosave history that is not disposable, and
// the whole feature is that guarantee. So this suite is weighted towards what
// must NEVER be dropped, across the three places that delete history:
//
//   1. the rollover at capture time (data/milestones.js, called by app.js)
//   2. the retention policy behind the Prune button (data/revs-policy.js)
//   3. a library merge with a second machine (data/library-merge.js)
//
// One rule, three implementations. Each is checked where it is enforced rather
// than where it is described, because the failure this suite exists for is a
// name that is quietly gone months later — long after anyone would remember
// which of the three took it.
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const Milestones = require(path.join(ROOT, 'data', 'milestones.js'));
const RevsPolicy = require(path.join(ROOT, 'data', 'revs-policy.js'));
const LibraryMerge = require(path.join(ROOT, 'data', 'library-merge.js'));
const PLANS = require(path.join(ROOT, 'data', 'plans.js'));

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
const mk = (n) => 'x'.repeat(n);
// A named snapshot, built the way the app builds one.
const named = (rev, name, pinAt) => Object.assign({}, rev, { pin: name, pinAt: pinAt || NOW });

console.log('\n== 1. A name is cleaned on the way in, because it is read back ==');
eq(Milestones.cleanName('  Before the redesign  '), 'Before the redesign', 'surrounding whitespace is not stored');
eq(Milestones.cleanName('Client   sign-off'), 'Client sign-off', 'and neither is a run of spaces inside the name');
eq(Milestones.cleanName('a' + String.fromCharCode(10) + 'b'), 'a b', 'a line break becomes a space rather than a second line in the row');
eq(Milestones.cleanName(String.fromCharCode(7) + 'bell'), 'bell', 'a control character is dropped, not kept in the store');
eq(Milestones.cleanName(mk(200)).length, Milestones.NAME_MAX, 'and a very long name is capped at the documented length');
eq(Milestones.cleanName('', 'Fallback'), 'Fallback', 'an empty name falls back when the caller has one to offer');
eq(Milestones.cleanName('', ''), '', 'and stays empty when it does not, so the caller has to decide');
assert(Milestones.isPinned(named({}, 'x')) === true, 'a snapshot carrying a name is a milestone');
assert(Milestones.isPinned({ pin: '   ' }) === false, 'and one carrying only whitespace is not');
assert(Milestones.isPinned(null) === false && Milestones.isPinned({}) === false, 'nor is an empty entry or a bare object');
eq(Milestones.nameOf({ pin: '  Approved  ' }), 'Approved', 'reading the name back cleans it too');
eq(Milestones.pinnedIn({ p1: [named({}, 'a'), {}, named({}, 'b')], p2: [] }), 2, 'milestones are counted across the whole library');
eq(Milestones.pinnedCount('nonsense'), 0, 'and a value that is not a list counts nothing rather than throwing');

console.log('\n== 2. Pinning writes a copy, and a refusal writes nothing ==');
const rev = { t: 1000, snap: 'snapshot-text' };
const made = Milestones.pin(rev, '  Approved   by the client  ', NOW);
assert(made.ok, 'a name pins a snapshot');
eq(made.name, 'Approved by the client', 'with the name cleaned on the way in');
eq(made.rev.pinAt, NOW, 'and stamped with when it was named, so a merge can order two names');
assert(rev.pin === undefined, 'the entry passed in is NOT mutated — a refusal must not leave half a milestone behind');
assert(Milestones.pin(rev, '   ', NOW).ok === false, 'a blank name is refused rather than defaulted');
assert(Milestones.pin(rev, '', NOW).error.length > 20, 'and the refusal explains why a name is required');
assert(Milestones.pin({ t: 1 }, 'x', NOW).ok === false, 'a snapshot with nothing stored in it cannot be named');
assert(Milestones.pin(null, 'x', NOW).ok === false, 'and neither can an entry that is not there at all');
const back = Milestones.unpin(made.rev);
assert(back.ok && back.rev.pin === undefined && back.rev.pinAt === undefined, 'unpinning takes the name and its stamp back off');
eq(back.rev.snap, 'snapshot-text', 'and leaves the snapshot byte-for-byte alone');

console.log('\n== 3. Every tier has an allowance, and an unknown tier gets Free\'s ==');
eq(Object.keys(Milestones.LIMITS).sort().join(','), PLANS.plans.map((p) => p.id).sort().join(','),
  'the allowance table and the plan table list the same tiers, so a new tier cannot arrive with no limit');
eq(Milestones.limitFor('free'), 1, 'Free keeps one per project — a funnel, and the one that sells the feature');
eq(Milestones.limitFor('pro'), 10, 'Pro keeps ten');
eq(Milestones.limitFor('proplus'), 25, 'and Pro+ twenty-five');
eq(Milestones.limitFor('unobtainium'), Milestones.LIMITS.free,
  'a tier this file has never heard of is treated as Free, never as unlimited — an unknown plan must not unlock everything');
eq(Milestones.limitFor(undefined), Milestones.LIMITS.free, 'and so is no tier at all');
PLANS.plans.forEach((p) => {
  const allowance = p.limits && p.limits.milestones;
  eq(allowance, Milestones.LIMITS[p.id], p.id + ': the plan table advertises the allowance this module enforces');
});
const freeFull = Milestones.canPin({ p1: [named({}, 'a')] }, 'p1', 'free');
assert(freeFull.ok === false && freeFull.used === 1 && freeFull.limit === 1, 'Free stops after its one');
assert(freeFull.message.indexOf('Pro+') !== -1, 'and the refusal names the tier above rather than just refusing');
const proRoom = Milestones.canPin({ p1: [] }, 'p1', 'pro');
assert(proRoom.ok && proRoom.remaining === 10, 'an empty Pro project has room for all ten');
assert(Milestones.canPin({ somewhere: [] }, 'p1', 'pro').ok, 'a project with no history at all is empty, not a refusal');
const topFull = Milestones.canPin({ p1: Array.from({ length: 25 }, () => named({}, 'x')) }, 'p1', 'proplus');
assert(topFull.ok === false && topFull.message.indexOf('Unpin') !== -1,
  'at the top tier the advice is to unpin one, because there is nothing left to sell them');
const rep = Milestones.report({ p1: [named({}, 'a')] }, 'p1', 'free');
assert(rep.total === 1 && rep.pinned === 1 && rep.unpinned === 0 && rep.atLimit,
  'the report the history view reads says how many snapshots are named and that the room is gone');

console.log('\n== 4. The rollover keeps a name, however old it is ==');
const fourteen = Array.from({ length: 14 }, (_, i) => ({ t: 14000 - i, snap: 's' + i }));
const rolled = Milestones.rollover(fourteen, 12);
eq(rolled.list.length, 12, 'fourteen unnamed snapshots roll over to twelve');
eq(rolled.dropped.length, 2, 'and exactly two are reported as dropped');
assert(rolled.list[0].snap === 's0' && rolled.list[11].snap === 's11', 'newest first, so it is the oldest two that go');

const namedOldest = fourteen.slice();
namedOldest[13] = named(namedOldest[13], 'First build', NOW);
const rolledNamed = Milestones.rollover(namedOldest, 12);
eq(rolledNamed.list.length, 13, 'a milestone at the very end is kept IN ADDITION to the twelve, not instead of one');
assert(rolledNamed.list[12].pin === 'First build', 'and it is still there, oldest, which is the row the rollover would have taken');
eq(rolledNamed.pinned, 1, 'and the count of protected rows comes back with it');
assert(rolledNamed.dropped.every((d) => d.index !== 13), 'the milestone is never in the dropped list');

const namedSecond = fourteen.slice();
namedSecond[1] = named(namedSecond[1], 'Signed off', NOW);
const rolledMid = Milestones.rollover(namedSecond, 12);
eq(rolledMid.list.length, 13, 'a milestone inside the window does not consume a slot either');
assert(rolledMid.list[1].pin === 'Signed off', 'and keeps its place in the list');

const allNamed = Array.from({ length: 14 }, (_, i) => named({ t: 14000 - i, snap: 's' + i }, 'm' + i, NOW));
eq(Milestones.rollover(allNamed, 12).list.length, 14, 'a project of nothing but milestones is not capped at all');
eq(Milestones.rollover([], 12).list.length, 0, 'and an empty project rolls over to nothing, quietly');

console.log('\n== 5. The byte budget keeps a name, and never empties a project ==');
const heavy = {
  a: [{ t: 3, snap: mk(3 * 1024) }, { t: 2, snap: mk(3 * 1024) }, { t: 1, snap: mk(3 * 1024) }],
  b: [{ t: 2, snap: mk(2 * 1024) }]
};
const trimmed = Milestones.trimToBudget(heavy, 4 * 1024);
eq(trimmed.dropped.length, 2, 'the budget drops what does not fit, newest first');
eq(trimmed.dropped.every((d) => d.index > 0), true, 'and never the newest snapshot of a project, which is never index 0');
eq(trimmed.bytesFreed, 6 * 1024, 'and reports exactly what that frees');
eq(trimmed.revs.b.length, 1, 'a project whose only snapshot does not fit is kept whole');
assert(trimmed.revs.a[0].t === 3, 'and what survives is still newest first inside each project');
assert(trimmed.over === true, 'the library is allowed to sit above the budget rather than lose a restore point');
eq(Milestones.trimToBudget(heavy, 0).dropped.length, 0, 'and a budget of zero means no budget, not "delete everything"');

const withMilestone = { a: [{ t: 3, snap: mk(3 * 1024) }, named({ t: 2, snap: mk(3 * 1024) }, 'Signed off', NOW)] };
const keptMilestone = Milestones.trimToBudget(withMilestone, 1024);
eq(keptMilestone.revs.a.length, 2, 'a milestone is kept even when it alone overshoots the budget');
eq(keptMilestone.pinned, 1, 'and is reported as protected rather than counted as luck');

const smallBig = { big: [{ t: 9, snap: mk(8 * 1024) }], tiny: [{ t: 1, snap: mk(1024) }] };
eq(Milestones.trimToBudget(smallBig, 2 * 1024).revs.tiny.length, 1,
  'a small project is not emptied to make room for a big one — the old inline prune decided on the global sort alone');

console.log('\n== 6. The retention policy keeps a name, and says what it saved ==');
const mixed = {
  p1: [
    { t: NOW, snap: mk(500) },
    named({ t: NOW - 400 * DAY, snap: mk(500) }, 'Client sign-off', NOW),
    { t: NOW - 500 * DAY, snap: mk(500) }
  ]
};
const policy = RevsPolicy.plan(mixed, { maxAgeDays: 1, maxPerProject: 1, budgetBytes: 600 }, NOW);
eq(policy.drop.length, 1, 'only the unnamed old snapshot is over the rules');
eq(policy.drop[0].index, 2, 'and it is the one at the end of the list, not the milestone beside it');
eq(policy.keep.p1.length, 2, 'so the project keeps its newest snapshot and its milestone');
assert(Milestones.isPinned(policy.keep.p1[1]), 'and the milestone is the second of the two that survive');
eq(policy.milestones.kept, 1, 'the plan reports one milestone kept');
eq(policy.milestones.savedByAge, 1, 'and that the age rule would have taken it — 400 days past a 1-day limit');
eq(policy.milestones.savedByBudget, 1, 'and that the byte budget would have taken it as well');
eq(policy.bytesAfter, 1000, 'while the library still sits above the budget, which is the promise being kept');

const noMilestones = RevsPolicy.plan({ p1: mixed.p1.map((r, i) => (i === 1 ? { t: r.t, snap: r.snap } : r)) },
  { maxAgeDays: 1, maxPerProject: 1, budgetBytes: 600 }, NOW);
eq(noMilestones.milestones.kept, 0, 'the same library without the name protects nothing extra');
assert(noMilestones.milestones.savedByAge === 0 && noMilestones.milestones.savedByBudget === 0,
  'and claims no credit for a snapshot nobody named');

console.log('\n== 7. The plan and the apply agree about which snapshot goes ==');
const stale = {
  p1: [
    { t: NOW, snap: mk(1000) },
    { t: NOW - 40 * DAY, snap: mk(1000) },
    { t: NOW - 10 * DAY, snap: mk(1000) }
  ]
};
const twoRules = RevsPolicy.plan(stale, { maxPerProject: 12, maxAgeDays: 30, budgetBytes: 1500 }, NOW);
eq(twoRules.drop.length, 2, 'one snapshot goes for being too old and one for the budget');
eq(twoRules.drop.map((d) => d.index).join(','), '1,2',
  'and both drop indices address the STORED list, not the list left over after the first pass');
const applied = RevsPolicy.apply(stale, twoRules);
eq(applied.p1.map((r) => r.snap).join('|'), twoRules.keep.p1.map((r) => r.snap).join('|'),
  'applying the plan removes exactly the snapshots the plan said it would — the preview and the prune are the same decision');
eq(applied.p1.length, 1, 'leaving the newest snapshot of the project');
assert(stale.p1.length === 3, 'and the input is still untouched');

console.log('\n== 8. A merge keeps a name, and a name wins a collision ==');
// The store key, not the short kind: union() reads its per-key rules from the
// KINDS table, and a key it does not recognise takes the generic blob path.
const REVS_KEY = 'pallettai.revisions.v1';
const twelve = { p1: Array.from({ length: 12 }, (_, i) => ({ t: 12000 - i * 1000, snap: 's' + i })) };
const theirsMilestone = { p1: [named({ t: 500, snap: 'old-build' }, 'Client sign-off', NOW)] };
const merged = LibraryMerge.union(JSON.stringify(twelve), JSON.stringify(theirsMilestone), REVS_KEY);
const mergedRows = JSON.parse(merged.raw).p1;
assert(mergedRows.some((r) => r.pin === 'Client sign-off'), 'a milestone older than every snapshot on this machine survives the merge');
eq(mergedRows.length, 13, 'and it does not push one of the twelve out — the cap counts unnamed snapshots only');
eq(merged.capped, 0, 'so nothing was capped for it');
eq(merged.milestones, 1, 'and the merge reports the milestone it carried across');
assert(merged.note.indexOf('milestone') !== -1, 'in the note the restore dialog shows: ' + merged.note);

const plainCopy = { p1: [{ t: 900, snap: 'same' }] };
const namedCopy = { p1: [named({ t: 900, snap: 'same' }, 'Approved v2', NOW)] };
const nameWinsIn = LibraryMerge.union(JSON.stringify(plainCopy), JSON.stringify(namedCopy), REVS_KEY);
eq(JSON.parse(nameWinsIn.raw).p1[0].pin, 'Approved v2',
  'a name arriving from the other machine beats the unnamed copy of the same snapshot');
const nameWinsOut = LibraryMerge.union(JSON.stringify(namedCopy), JSON.stringify(plainCopy), REVS_KEY);
eq(JSON.parse(nameWinsOut.raw).p1[0].pin, 'Approved v2',
  'and the same the other way round, so a merge is order-independent about it');
eq(JSON.parse(nameWinsOut.raw).p1.length, 1, 'and the two copies are one row, not two');
eq(nameWinsOut.updated, 0, 'nothing is reported as replaced when the copy that survives is the one already here');
const earlier = { p1: [named({ t: 700, snap: 'x' }, 'Draft', NOW - 5000)] };
const later = { p1: [named({ t: 700, snap: 'x' }, 'Signed off', NOW)] };
const renamed = LibraryMerge.union(JSON.stringify(earlier), JSON.stringify(later), REVS_KEY);
eq(JSON.parse(renamed.raw).p1[0].pin, 'Signed off',
  'when both machines named it, the later name wins — the most recent decision is the one somebody made');
eq(LibraryMerge.keepNamed([{ t: 1, snap: 'a' }, named({ t: 2, snap: 'b' }, 'm', NOW), { t: 3, snap: 'c' }], 1).length, 2,
  'and the cap helper itself keeps every named row plus the cap');

console.log('\n== 9. Three files, one field name ==');
eq(RevsPolicy.FIELD, Milestones.FIELD, 'the retention policy reads the same field the module writes');
eq(LibraryMerge.PIN_FIELD, Milestones.FIELD, 'and so does the merge');
eq(Milestones.ROLLOVER, LibraryMerge.REV_CAP, 'the rollover and the merge cap are the same number');
eq(RevsPolicy.pinnedOf(named({}, 'x')), Milestones.isPinned(named({}, 'x')),
  'both readers agree that a named snapshot is named');
eq(RevsPolicy.pinnedOf({ pin: '   ' }), Milestones.isPinned({ pin: '   ' }),
  'and that a blank name is not one');

console.log('\n== 10. It is wired into the app and the shell ==');
const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
assert(html.indexOf('src="data/milestones.js"') !== -1, 'the shell loads data/milestones.js');
assert(html.indexOf('src="data/milestones.js"') < html.indexOf('src="app.js"'), 'before app.js, so the app reads it as a global');
assert(app.indexOf('Mile.rollover(') !== -1, 'capture rolls over through the module');
assert(app.indexOf('Mile.trimToBudget(') !== -1, 'and trims the global budget through it too');
assert(app.indexOf('list.length = 12') === -1, 'the hand-rolled twelve-item trim is gone from captureRevision');
assert(app.indexOf('Mile.canPin(') !== -1, 'the Pin button asks the module before it writes anything');
assert(app.indexOf('function milestoneTier()') !== -1, 'and the allowance is read from the effective tier, not the stored plan id');
assert(app.indexOf('data-rev-pinsave') !== -1 && app.indexOf('data-rev-unpin') !== -1,
  'naming a milestone and unpinning one are both wired to real buttons');
assert(app.indexOf("named ? '' :") !== -1, 'Delete is offered only on a snapshot that is not named — removal is two deliberate steps');
assert(app.indexOf('openRevisionDiff(prev, c, Mile ? Mile.nameOf(rev) : ') !== -1,
  'and the diff of a milestone says which milestone it is');
assert(app.indexOf('never dropped') !== -1 && app.indexOf('named milestone') !== -1,
  'the storage panel says the same thing the policy does');
assert(app.indexOf('milestone') !== -1 && app.indexOf('never pruned') !== -1, 'and the history picker does too');
['.rev-mark', '.rev-acts', '.rev-note', '.rev-named', '.rev-foot'].forEach((sel) => {
  assert(css.indexOf(sel) !== -1, 'styles.css has ' + sel);
});
// The marketing copy and the enforced limit are the same number, on every tier,
// because a feature list that promises more than the module allows is a refund.
PLANS.plans.forEach((p) => {
  assert(p.features.some((f) => f.toLowerCase().indexOf('milestone') !== -1),
    p.id + ': the plan page mentions milestones, which is the only reason to put a Pin button in front of a Free user');
});

if (failed) {
  console.error('\nmilestones-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nmilestones-smoke PASSED');
