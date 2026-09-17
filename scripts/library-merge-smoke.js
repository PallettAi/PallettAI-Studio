#!/usr/bin/env node
// ============================================================
// PallettAI Studio — library backup merge smoke test
// ------------------------------------------------------------
// Restoring a backup used to be one action: overwrite every key,
// reload. The common case for a backup is not disaster recovery
// — it is a second machine — and there, replacing the library
// destroys exactly the work it was meant to preserve.
//
// data/library-merge.js answers three questions without touching
// anything: what is in the file, how it compares to what is
// stored, and what each choice would do. The promise asserted
// here is the one a merge has to keep to be worth offering:
//
//   something that exists only on one side survives, and when
//   both sides have it the newer copy wins. Nothing is dropped.
//
// The counterpart is asserted too: a merge of a library with
// itself must be a no-op, or every merge would rewrite the volume
// and re-save photos for no reason.
// ============================================================

'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');
const LibraryMerge = require(path.join(ROOT, 'data', 'library-merge.js'));

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function eq(actual, expected, msg) {
  if (actual === expected) pass(msg);
  else fail(msg + '  → got: ' + JSON.stringify(actual) + ', expected: ' + JSON.stringify(expected));
}
function assert(cond, msg) { cond ? pass(msg) : fail(msg); }

const P = 'pallettai.projects.v1';
const A = 'pallettai.assets.v1';
const R = 'pallettai.revisions.v1';
const S = 'pallettai.settings.v1';

const proj = (id, name, updatedAt) => ({ id, name, updatedAt, site: { sections: [] } });
const asset = (id, dataUrl, addedAt) => ({ id, dataUrl, addedAt, name: id + '.png' });
const rev = (t, snap) => ({ t, snap });

function backup(values, extra) {
  return JSON.stringify(Object.assign({
    kind: 'pallettai-library-backup',
    version: 1,
    exportedAt: '2026-05-01T09:00:00.000Z',
    studio: '0.9.0',
    values
  }, extra || {}));
}

console.log('\n== 1. It refuses anything that is not a backup ==');
eq(LibraryMerge.inspect('not json at all', {}).ok, false, 'unparseable input is refused');
assert(/valid JSON/.test(LibraryMerge.inspect('not json at all', {}).error), 'and says so in words');
eq(LibraryMerge.inspect(JSON.stringify({ kind: 'pallettai-project', values: {} }), {}).ok, false, 'a project export is not a library backup');
assert(/project/.test(LibraryMerge.inspect(JSON.stringify({ kind: 'pallettai-project', values: {} }), {}).error), 'and the error names what it actually was');
eq(LibraryMerge.inspect(JSON.stringify({ kind: 'pallettai-library-backup' }), {}).ok, false, 'a backup with no values is refused');
eq(LibraryMerge.inspect(JSON.stringify({ kind: 'pallettai-library-backup', values: { [P]: 42 } }), {}).ok, false, 'a backup whose values are not stored strings is refused');
eq(LibraryMerge.inspect(null, {}).ok, false, 'null is refused');

console.log('\n== 2. It describes the file, and compares it with what is here ==');
const mineNow = { [P]: JSON.stringify([proj('p1', 'Mine', 1000)]) };
const check = LibraryMerge.inspect(backup({
  [P]: JSON.stringify([proj('p1', 'Their older', 500), proj('p2', 'Theirs', 500)]),
  [A]: JSON.stringify([asset('a1', 'data:image/png;base64,AAAA', 10)]),
  [S]: JSON.stringify({ theme: 'dark' })
}), mineNow);

eq(check.ok, true, 'a real backup is accepted');
eq(check.summary.keys, 3, 'and its keys are counted');
const projects = check.keys.find((k) => k.key === P);
eq(projects.state, 'differs', 'projects differ from what is stored');
eq(projects.incoming.items, 2, 'the backup holds two projects');
eq(projects.current.items, 1, 'and the library currently holds one');
const assets = check.keys.find((k) => k.key === A);
eq(assets.state, 'new', 'a key the library does not have is reported as new here');
eq(assets.current, null, 'with no current copy to compare against');
const settings = check.keys.find((k) => k.key === S);
eq(settings.state, 'new', 'and so is a settings key that is not stored yet');

const same = LibraryMerge.inspect(JSON.stringify({ kind: 'pallettai-library-backup', values: mineNow }), mineNow);
eq(same.keys[0].state, 'same', 'a value identical to the stored one is reported as identical');
eq(same.summary.same, 1, 'and counted as such');

const revsCheck = LibraryMerge.inspect(backup({ [R]: JSON.stringify({ p1: [rev(1, 'a'), rev(2, 'b')], p2: [rev(3, 'c')] }) }), {});
eq(revsCheck.keys[0].incoming.items, 3, 'revisions are counted as snapshots, not as projects');
eq(revsCheck.keys[0].incoming.projects, 2, 'and the project count is reported beside it');

const broken = LibraryMerge.inspect(backup({ [P]: '{not json' }), {});
eq(broken.keys[0].incoming.parsed, false, 'an unreadable value is flagged rather than counted as zero items');
assert(broken.keys[0].incoming.error.length > 0, 'with the reason: ' + broken.keys[0].incoming.error);

console.log('\n== 3. Union: nothing that exists only on one side is lost ==');
const mineRaw = JSON.stringify([proj('p1', 'Mine keeps', 3000), proj('onlyMine', 'Only mine', 1000)]);
const theirRaw = JSON.stringify([proj('p1', 'Theirs older', 500), proj('onlyTheirs', 'Only theirs', 1000)]);
const u = LibraryMerge.union(mineRaw, theirRaw, P);
eq(u.ok, true, 'the union succeeds');
const merged = JSON.parse(u.raw);
eq(merged.length, 3, 'three projects come out of two lists of two — nothing is dropped');
eq(u.added, 1, 'one project exists only in the backup and is added');
eq(u.updated, 0, 'nothing is replaced, because the copy here is newer');
const p1 = merged.find((x) => x.id === 'p1');
eq(p1.name, 'Mine keeps', 'the NEWER copy of a shared project wins, whatever side it came from');

const u2 = LibraryMerge.union(JSON.stringify([proj('p1', 'Old here', 100)]), JSON.stringify([proj('p1', 'Newer there', 9000)]), P);
eq(JSON.parse(u2.raw)[0].name, 'Newer there', 'and when the backup copy is newer, it is the one taken');
eq(u2.updated, 1, 'reported as an update rather than an addition');

const u3 = LibraryMerge.union(mineRaw, mineRaw, P);
eq(u3.unchanged, true, 'merging a library with itself changes nothing at all');
eq(u3.raw, mineRaw, 'and produces the identical string, so nothing is rewritten');

const u4 = LibraryMerge.union(null, theirRaw, P);
eq(u4.ok, true, 'merging into an empty key is a plain add');
eq(u4.added, 1, 'counted as one added value');

const u5 = LibraryMerge.union('{broken', theirRaw, P);
eq(u5.ok, true, 'an unreadable copy here does not block the merge');
assert(/could not be read/.test(u5.note), 'but it is said out loud rather than silently overwritten');

const u6 = LibraryMerge.union(mineRaw, '{broken', P);
eq(u6.ok, false, 'an unreadable BACKUP copy does block it');
assert(u6.error.indexOf('could not be read') > 0, 'with the reason a person needs');

console.log('\n== 4. Assets dedupe by identity, snapshots by time ==');
const mineAssets = JSON.stringify([asset('a1', 'data:image/png;base64,AAAA', 10)]);
const theirAssets = JSON.stringify([asset('a1', 'data:image/png;base64,AAAA', 10), asset('a2', 'data:image/png;base64,BBBB', 20)]);
const ua = LibraryMerge.union(mineAssets, theirAssets, A);
eq(JSON.parse(ua.raw).length, 2, 're-pinning an asset already here does not duplicate it');
eq(ua.added, 1, 'only the genuinely new one is added');

const mineRevs = JSON.stringify({ p1: [rev(300, 'new'), rev(200, 'mid')] });
const theirRevs = JSON.stringify({ p1: [rev(200, 'mid'), rev(100, 'old')], p2: [rev(400, 'other')] });
const ur = LibraryMerge.union(mineRevs, theirRevs, R);
const urObj = JSON.parse(ur.raw);
eq(urObj.p1.length, 3, 'snapshots are unioned by time, not duplicated');
eq(urObj.p1[0].t, 300, 'and stay newest-first, the order the restore picker reads');
eq(urObj.p1[2].t, 100, 'so the oldest snapshot ends up last');
eq(urObj.p2.length, 1, 'a project that only the backup has history for gets that history');
eq(ur.added, 2, 'two genuinely new snapshots were added');

const manyRevs = JSON.stringify({ p1: Array.from({ length: 20 }, (_, i) => rev(20 - i, 'x')) });
const urCapped = LibraryMerge.union(JSON.stringify({ p1: [] }), manyRevs, R);
eq(JSON.parse(urCapped.raw).p1.length, LibraryMerge.REV_CAP, 'a merge cannot exceed the per-project snapshot cap the app itself keeps');
assert(/limit/.test(urCapped.note), 'and the cap is disclosed rather than applied in silence');

console.log('\n== 5. Settings fill gaps and never overrule a deliberate change ==');
const mineSettings = JSON.stringify({ theme: 'light', autosave: false });
const theirSettings = JSON.stringify({ theme: 'dark', fontPair: ['Inter', 'Mono'] });
const us = LibraryMerge.union(mineSettings, theirSettings, S);
const usObj = JSON.parse(us.raw);
eq(usObj.theme, 'light', 'a setting that is present here wins — a merge is not the place to undo a choice');
eq(usObj.autosave, false, 'including a deliberate false, which a truthiness check would have lost');
eq(usObj.fontPair.length, 2, 'and a setting the backup has and this library does not fills the gap');
eq(us.added, 1, 'the filled setting is counted as an addition');

console.log('\n== 6. Plans: merge by default, replace on request ==');
const current = { [P]: JSON.stringify([proj('onlyMine', 'Mine', 1000)]), [S]: JSON.stringify({ theme: 'light' }) };
const values = { [P]: JSON.stringify([proj('onlyTheirs', 'Theirs', 1000), proj('onlyMine', 'Older', 10)]), [S]: JSON.stringify({ theme: 'dark' }) };
const insp = LibraryMerge.inspect(backup(values), current);

const mergePlan = LibraryMerge.planMerge(insp, current, {});
eq(mergePlan.mode, 'merge', 'merging is the default — it is the direction that cannot lose work');
eq(mergePlan.ok, true, 'and the plan is actionable');
eq(mergePlan.added, 1, 'it adds the project only the backup has');
// The settings key is NOT written by a merge, and that is the rule working:
// the local value always wins, so the union comes out identical and is skipped
// rather than rewritten. Only a replace moves settings.
eq(mergePlan.writes.length, 1, 'a merge writes only the keys it actually changes');
eq(mergePlan.skips.length, 1, 'and reports the rest as already identical');
const projWrite = mergePlan.writes.find((w) => w.key === P);
eq(JSON.parse(projWrite.raw).length, 2, 'and the projects key ends up holding both projects');
eq(projWrite.action, 'merge', 'labelled as a merge rather than an add or a replace');
eq(projWrite.grewBy > 0, true, 'with the growth stated as a number the panel can show');

const replacePlan = LibraryMerge.planMerge(insp, current, { mode: 'replace' });
eq(replacePlan.mode, 'replace', 'replace is still available when that is what is wanted');
eq(replacePlan.removedItems, 0, 'and counts what it is about to remove');
const settingWrite = replacePlan.writes.find((w) => w.key === S);
eq(JSON.parse(settingWrite.raw).theme, 'dark', 'a replace really does take the backup value outright');

const partial = LibraryMerge.planMerge(insp, current, { only: [P] });
eq(partial.writes.length, 1, 'per-key selection writes only the keys asked for');
eq(partial.skips.length, 1, 'and reports the others as skipped rather than dropping them silently');
assert(/not selected/.test(partial.skips[0].why), 'with the reason it was skipped');

const unreadable = LibraryMerge.planMerge(LibraryMerge.inspect(backup({ [P]: '{oops' }), {}), {}, {});
eq(unreadable.ok, false, 'a backup holding an unreadable value cannot be merged');
eq(unreadable.blocked.length, 1, 'and the blocked key is named rather than skipped');
assert(unreadable.error.length > 0, 'with something to show the user: ' + unreadable.error);

const nothing = LibraryMerge.planMerge(LibraryMerge.inspect(backup(mineNow), mineNow), mineNow, {});
eq(nothing.ok, false, 'merging a backup that is identical to the library is a no-op');
assert(/nothing/i.test(nothing.error), 'and says so: ' + nothing.error);

console.log('\n== 7. It is wired into the restore path ==');
const fs = require('fs');
const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
assert(html.indexOf('<script src="data/library-merge.js"></script>') > 0, 'the shell loads the module');
assert(app.indexOf('LibraryMerge.inspect(text, current)') > 0, 'the restore path inspects the file before writing anything');
assert(app.indexOf('LibraryMerge.planMerge(check, current') > 0, 'and plans the write through the module rather than hand-rolling it');
assert(app.indexOf('id="modeMerge"') > 0 && app.indexOf('id="modeReplace"') > 0, 'both choices are offered in the dialog');
assert(app.indexOf('data-rkey') > 0, 'and each key can be included or excluded');
assert(app.indexOf('Restore and reload') < 0, 'the old all-or-nothing button is gone');

if (failed) {
  console.error('\nlibrary-merge-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nlibrary-merge-smoke PASSED');
