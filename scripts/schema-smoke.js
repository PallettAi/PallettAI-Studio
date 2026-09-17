#!/usr/bin/env node
// ============================================================
// PallettAI Studio — store format registry smoke test
// ------------------------------------------------------------
// Every value in the local database is a JSON string under a key
// that ends in `.v1` — a naming accident that was the only thing
// recording the SHAPE of what is inside. data/schema.js makes the
// version real and runs forward migrations at boot.
//
// The three promises that make shipping that safe are asserted
// here against a fake store, because each of them fails silently:
//
//   1. a value that cannot be converted is left byte-for-byte
//      as it was, and its version is NOT advanced, so the next
//      boot tries again;
//   2. a version is advanced only AFTER the write commits;
//   3. on-disk values stay plain JSON — no envelope — so an
//      older build can still open the library.
//
// Section 1 is the registry against the app's own key vocabulary:
// renaming a key without adding a version row must fail HERE,
// rather than quietly dropping that key out of the upgrades.
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const Schema = require(path.join(ROOT, 'data', 'schema.js'));

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function eq(actual, expected, msg) {
  if (actual === expected) pass(msg);
  else fail(msg + '  → got: ' + JSON.stringify(actual) + ', expected: ' + JSON.stringify(expected));
}
function assert(cond, msg) { cond ? pass(msg) : fail(msg); }

const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// ------------------------------------------------------------------
console.log('\n== 1. The registry covers the keys the app actually stores ==');

// Pull the LS key map out of app.js rather than restating it: a copy here would
// agree with itself and disagree with the app.
// Sliced rather than regex-matched: the key map is a plain block of lines, and
// reading it by index cannot be tripped by an escape or a nested brace.
const lsStart = app.indexOf('const LS = {');
const lsBlock = lsStart >= 0 ? app.slice(lsStart, app.indexOf('};', lsStart)) : '';
assert(!!lsBlock, 'the app still declares its stored keys in one place');
const stored = lsBlock ? Array.from(new Set((lsBlock.match(/'pallettai[^']+'/g) || []).map((s) => s.replace(/'/g, '')))) : [];
assert(stored.length >= 7, 'the key vocabulary was read (' + stored.length + ' keys)');

const verify = Schema.verify(Object.fromEntries(stored.map((k, i) => ['k' + i, k])));
eq(verify.missing.length, 0, 'every stored key has a format row' + (verify.missing.length ? ': missing ' + verify.missing.join(', ') : ''));
const unknownRows = verify.unknown.filter((k) => k !== Schema.key);
eq(unknownRows.length, 0, 'every format row belongs to a key the app stores' + (unknownRows.length ? ': orphan ' + unknownRows.join(', ') : ''));
eq(Schema.key, 'pallettai.schema.v1', 'the version sidecar is itself a versioned key');
assert((lsBlock.match(/'pallettai[^']+'/g) || []).length >= 7, 'the key map was parsed as expected');

console.log('\n== 2. Plans: what a run would do, before it does it ==');
const p1 = Schema.plan('pallettai.projects.v1', 1);
eq(p1.steps.join(','), '1', 'projects at v1 need the 1→2 step');
eq(p1.needs, true, 'and are reported as needing an upgrade');
eq(p1.to, 2, 'landing on the version this build writes');
eq(Schema.plan('pallettai.projects.v1', 2).needs, false, 'already-current values need nothing');
eq(Schema.plan('pallettai.settings.v1', 1).needs, false, 'a key with no migrations is current at 1');
eq(Schema.plan('pallettai.nonsense.v1', 1).known, false, 'an unknown key is reported as unknown');

console.log('\n== 3. Which version is a stored value in? ==');
const sidecar = { 'pallettai.projects.v1': 2 };
eq(Schema.storedVersion(sidecar, 'pallettai.projects.v1', true), 2, 'a recorded version wins');
eq(Schema.storedVersion({}, 'pallettai.projects.v1', true), 1, 'a stored value with no record predates the registry → v1');
eq(Schema.storedVersion({}, 'pallettai.projects.v1', false), 2, 'nothing stored is already current — there is no old shape to convert');
eq(Schema.storedVersion({ 'pallettai.projects.v1': 'nonsense' }, 'pallettai.projects.v1', true), 1, 'a corrupt recorded version falls back to v1, never forward');

console.log('\n== 4. Migrations convert real shapes, and refuse fake ones ==');
const projectsOld = JSON.stringify([{ id: 'a', name: 'Cafe', suites: 'oops' }]);
const proj = Schema.migrate('pallettai.projects.v1', projectsOld, 1);
eq(proj.ok, true, 'a project list converts');
const projList = JSON.parse(proj.raw);
eq(projList[0].schemaVersion, 2, 'each project is stamped with its own format version');
eq(Array.isArray(projList[0].suites), true, 'a non-array suites field is coerced — and written back, unlike the in-memory repair');
eq(projList[0].name, 'Cafe', 'nothing else about the project is touched');

const bad = Schema.migrate('pallettai.projects.v1', '{not json', 1);
eq(bad.ok, false, 'unparseable JSON refuses to convert');
eq(bad.raw, '{not json', 'and the original value comes back untouched');
assert(/could not be parsed/.test(bad.error), 'with a reason a person can act on: ' + bad.error);

const notAList = Schema.migrate('pallettai.projects.v1', '{"a":1}', 1);
eq(notAList.ok, false, 'an object where a list belongs refuses too');
eq(notAList.raw, '{"a":1}', 'and is likewise left alone');

const assetsOld = JSON.stringify([{ id: 'x', dataUrl: 'data:image/png;base64,AAAA' }]);
const assets = Schema.migrate('pallettai.assets.v1', assetsOld, 1);
const asset = JSON.parse(assets.raw)[0];
eq(asset.credit, null, 'assets gain a credit field, written as null so "no credit" is visible');
assert(typeof asset.fp === 'string' && asset.fp.length === 8, 'assets gain a content fingerprint');
eq(Schema.fingerprintOf({ dataUrl: 'data:image/png;base64,AAAA' }), asset.fp, 'the fingerprint is stable for the same content');
assert(Schema.fingerprintOf({ dataUrl: 'data:image/png;base64,BBBB' }) !== asset.fp, 'and differs for different content');
eq(Schema.migrate('pallettai.projects.v1', projectsOld, 2).ok, true, 'a value already at the current version is a no-op that succeeds');
eq(Schema.migrate('pallettai.assets.v1', assetsOld, 2).applied.length, 0, 'with no steps applied');

console.log('\n== 5. The sidecar ==');
const round = Schema.parseSidecar(Schema.serializeSidecar({ 'b.v1': 2, 'a.v1': 1 }));
eq(round['a.v1'], 1, 'a version survives the round trip');
eq(round['b.v1'], 2, 'and so does the next one');
eq(Object.keys(round).join(','), 'a.v1,b.v1', 'keys are written in a stable order, so an unchanged sidecar is byte-identical');
eq(Object.keys(Schema.parseSidecar('rubbish')).length, 0, 'an unreadable sidecar is rebuilt, not trusted');
eq(Schema.parseSidecar('{"a.v1":-3}')['a.v1'], undefined, 'a nonsense version is dropped rather than obeyed');

// ------------------------------------------------------------------
console.log('\n== 6. runLibrary against a real (fake) store ==');
const { createFakeIndexedDB } = require(path.join(__dirname, 'fake-indexeddb.js'));

function makeStore(seed) {
  const rows = Object.assign({}, seed);
  return {
    rows,
    puts: 0,
    failWrites: false,
    async get(key) { return Object.prototype.hasOwnProperty.call(rows, key) ? rows[key] : null; },
    async put(key, value) {
      this.puts++;
      if (this.failWrites) throw new Error('disk full');
      rows[key] = value;
    }
  };
}

(async () => {
  const seed = {
    'pallettai.projects.v1': '{broken',
    'pallettai.assets.v1': JSON.stringify([{ id: 'a1', dataUrl: 'data:image/png;base64,ZZZZ' }]),
    'pallettai.settings.v1': JSON.stringify({ theme: 'dark' }),
    'pallettai.briefs.v1': JSON.stringify([{ id: 'b1' }])
  };
  const store = makeStore(seed);
  const run = await Schema.runLibrary(store);

  eq(run.ok, false, 'a library with a value that cannot be converted reports a failure rather than claiming success');
  eq(run.failed.length, 1, 'exactly the key that could not be converted is listed');
  eq(run.failed[0].key, 'pallettai.projects.v1', 'and it is the projects value');
  eq(store.rows['pallettai.projects.v1'], '{broken', 'which is left byte-for-byte as it was — this is the whole point');
  eq(run.ran.length, 1, 'the one convertible key was converted alongside it');
  eq(JSON.parse(store.rows['pallettai.assets.v1'])[0].credit, null, 'the assets value on disk is now v2');
  eq(run.versions['pallettai.projects.v1'], 1, 'the failed key is still recorded as v1, so the next boot retries it');
  eq(run.versions['pallettai.settings.v1'], 1, 'a key that needed nothing is reported at its current version');

  const recorded = Schema.parseSidecar(store.rows[Schema.key]);
  eq(recorded['pallettai.assets.v1'], 2, 'the version was recorded after the write committed');
  eq(recorded['pallettai.projects.v1'], undefined, 'and the failed key was NOT recorded as converted');

  const putsAfterFirst = store.puts;
  const again = await Schema.runLibrary(store);
  eq(again.ran.length, 0, 'a second run converts nothing — the upgrade is not repeated on every launch');
  eq(again.failed.length, 1, 'the unconvertible value is still reported, because it is still unconvertible');
  assert(store.puts <= putsAfterFirst + 1, 'and the second run writes at most the sidecar');

  // The split of duties, asserted rather than assumed: the upgrade path reads
  // only the values it must convert, because parsing the whole library at every
  // launch would cost a JSON.parse of every inlined photo. Noticing that a value
  // which needed no conversion is nonetheless unreadable is the integrity walk's
  // job (AppStore.audit → store-smoke), and that is where it is tested.
  eq(Schema.storedVersion(recorded, 'pallettai.briefs.v1', true), 1, 'a key with no migrations sits at v1');
  eq(again.versions['pallettai.briefs.v1'], 1, 'and is reported without being parsed');

  console.log('\n== 7. Order matters: the version follows the write ==');
  const failStore = makeStore({ 'pallettai.projects.v1': JSON.stringify([{ id: 'p1' }]) });
  failStore.failWrites = true;
  const failedRun = await Schema.runLibrary(failStore);
  eq(failedRun.ok, false, 'a library that cannot be written to reports failure');
  eq(failedRun.ran.length, 0, 'and claims to have converted nothing');
  eq(JSON.parse(failStore.rows['pallettai.projects.v1'])[0].schemaVersion, undefined, 'the value on disk is untouched');
  const failSidecar = failStore.rows[Schema.key];
  assert(!failSidecar || Schema.parseSidecar(failSidecar)['pallettai.projects.v1'] !== 2,
    'and the version was NOT advanced — a crash in this window would otherwise mark a value converted while it is still old');

  console.log('\n== 8. It is wired into the app, in the right order ==');
  assert(/<script src="data\/schema\.js"><\/script>/.test(html), 'index.html loads data/schema.js');
  const schemaTag = html.indexOf('data/schema.js');
  const appTag = html.indexOf('app.js"');
  assert(schemaTag > 0 && schemaTag < appTag, 'before app.js, or the registry would not exist when boot runs');
  assert(/StoreSchema\.runLibrary\(AppStore\)/.test(app), 'boot runs the library upgrade through AppStore');
  const bootIdx = app.indexOf('StoreSchema.runLibrary(AppStore)');
  const hydrateIdx = app.indexOf('await loadProjects()');
  assert(bootIdx > 0 && hydrateIdx > 0 && bootIdx < hydrateIdx,
    'and it runs BEFORE hydration — hydration is what reads the values, so converting afterwards would leave this session on the old shape');

  if (failed) {
    console.error('\nschema-smoke FAILED — ' + failed + ' failure(s)');
    process.exit(1);
  }
  console.log('\nschema-smoke PASSED');
})();
