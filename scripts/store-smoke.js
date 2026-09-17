#!/usr/bin/env node
// ============================================================
// PallettAI Studio — local store smoke test
// ------------------------------------------------------------
// modules/store.js is the local database: every project, autosave
// revision, asset, brand preset and brief passes through it, and
// nothing tested it, because Node has no indexedDB. It runs here
// against scripts/fake-indexeddb.js, which is written to be unkind
// in the ways the real implementation is (see that file).
//
// The suite asserts the contract written at the top of store.js,
// and every check is a real call — no source greps:
//
//   init() · get/put/del · schedule (debounce, latest-wins, lazy
//   serialisation) · flush · recovery after a storage failure ·
//   version change · and the two promises that matter most:
//   a resolved write is committed, and a failed write is not lost.
// ============================================================

'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');
const { createFakeIndexedDB } = require(path.join(__dirname, 'fake-indexeddb.js'));

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function eq(actual, expected, msg) {
  if (actual === expected) pass(msg);
  else fail(msg + '  → got: ' + JSON.stringify(actual) + ', expected: ' + JSON.stringify(expected));
}
function assert(cond, msg) { cond ? pass(msg) : fail(msg); }

const DB_NAME = 'pallettai-data';
const STORE = 'kv';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// The store writes to `window.AppStore`, and reads IndexedDB and localStorage
// off the global object, so the sandbox has to look like a browser.
function freshStore(fake) {
  for (const key of Object.keys(require.cache)) {
    if (key.includes(path.join('modules', 'store.js'))) delete require.cache[key];
  }
  global.window = {};
  global.indexedDB = fake.indexedDB;
  global.localStorage = {
    _d: {},
    getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; }
  };
  require(path.join(ROOT, 'modules', 'store.js'));
  return global.window.AppStore;
}

(async () => {
  // ----------------------------------------------------------
  console.log('== 1. With no IndexedDB at all, nothing throws ==');
  {
    const fake = createFakeIndexedDB();
    const AppStore = freshStore(fake);
    delete global.indexedDB;
    eq(await AppStore.init(), false, 'init() reports false rather than throwing');
    eq(AppStore.isReady(), false, 'isReady() is false');
    eq(await AppStore.get('pallettai.projects.v1'), null, 'a read returns null, not undefined');
    await AppStore.del('missing').then(() => pass('del() is a no-op'), (e) => fail('del() threw: ' + e.message));
    await AppStore.put('k', 'v').then(
      () => fail('put() silently "succeeded" with no database'),
      () => pass('put() rejects, so a caller cannot believe it was saved')
    );
    // schedule() is the fire-and-forget path and must never throw at the caller.
    AppStore.schedule('k', () => 'v');
    await AppStore.flush().then(() => pass('flush() resolves with nothing to write'), (e) => fail('flush() rejected: ' + e.message));
  }

  // ----------------------------------------------------------
  console.log('\n== 2. Round trip, and the on-disk format ==');
  {
    const fake = createFakeIndexedDB();
    const AppStore = freshStore(fake);
    eq(await AppStore.init(), true, 'init() reports true when IndexedDB is available');
    eq(AppStore.isReady(), true, 'isReady() is true');

    await AppStore.put('pallettai.projects.v1', '[{"id":"p1"}]');
    eq(await AppStore.get('pallettai.projects.v1'), '[{"id":"p1"}]', 'a value comes back byte-for-byte as the string that was written');
    eq(typeof fake.raw(DB_NAME, STORE).get('pallettai.projects.v1'), 'string', 'the row is stored as a string, so the format matches the old localStorage rows');
    eq(await AppStore.get('never.written'), null, 'a missing key reads as null');

    await AppStore.del('pallettai.projects.v1');
    eq(await AppStore.get('pallettai.projects.v1'), null, 'del() removes the key');
    eq(fake.raw(DB_NAME, STORE).has('pallettai.projects.v1'), false, 'and the row is gone from the database');
  }

  // ----------------------------------------------------------
  // The migration in app.js reads: await AppStore.put(key, raw); then
  // localStorage.removeItem(key). If put() resolves before the transaction
  // commits, a crash in that window destroys the only copy of every project.
  console.log('\n== 3. A resolved write is a committed write ==');
  {
    const fake = createFakeIndexedDB();
    const AppStore = freshStore(fake);
    await AppStore.init();
    fake.control.latencyMs = 2;   // a slow disk, so the window is visible
    await AppStore.put('pallettai.projects.v1', 'payload');
    eq(fake.raw(DB_NAME, STORE).get('pallettai.projects.v1'), 'payload', 'the bytes are committed by the time put() resolves');
    eq(fake.control.commits >= 1, true, 'the transaction committed');
    await AppStore.del('pallettai.projects.v1');
    eq(fake.raw(DB_NAME, STORE).has('pallettai.projects.v1'), false, 'a resolved delete is a committed delete');
    fake.control.latencyMs = 0;
  }

  // ----------------------------------------------------------
  console.log('\n== 4. schedule() debounces, and the last value wins ==');
  {
    const fake = createFakeIndexedDB();
    const AppStore = freshStore(fake);
    await AppStore.init();
    const before = fake.control.puts;
    for (let i = 0; i < 25; i++) AppStore.schedule('pallettai.projects.v1', () => 'v' + i);
    await wait(120);
    eq(fake.control.puts - before, 0, 'a burst of edits has not touched the disk yet');
    await AppStore.flush();
    eq(fake.control.puts - before, 1, 'a burst of 25 edits costs exactly one write');
    eq(await AppStore.get('pallettai.projects.v1'), 'v24', 'the last value wins');

    // The serialiser is the expensive part, so it must run at flush time.
    let called = 0;
    AppStore.schedule('pallettai.assets.v1', () => { called++; return 'A' + called; });
    eq(called, 0, 'the value function is not called when the edit is scheduled');
    await AppStore.flush();
    eq(called, 1, 'and is called exactly once, at flush time');
    eq(await AppStore.get('pallettai.assets.v1'), 'A1', 'the serialised value is what lands');

    // A getter that returns undefined means "nothing to write yet".
    const putsBefore = fake.control.puts;
    AppStore.schedule('pallettai.briefs.v1', () => undefined);
    await AppStore.flush();
    eq(fake.control.puts, putsBefore, 'an undefined value writes nothing');
    eq(await AppStore.get('pallettai.briefs.v1'), null, 'and stores nothing');
  }

  // ----------------------------------------------------------
  console.log('\n== 5. Distinct keys do not collide, and debounce on their own clocks ==');
  {
    const fake = createFakeIndexedDB();
    const AppStore = freshStore(fake);
    await AppStore.init();
    AppStore.schedule('pallettai.projects.v1', () => 'P');
    AppStore.schedule('pallettai.revisions.v1', () => 'R');
    AppStore.schedule('pallettai.assets.v1', () => 'A');
    AppStore.schedule('pallettai.projects.v1', () => 'P2');
    await AppStore.flush();
    eq(await AppStore.get('pallettai.projects.v1'), 'P2', 'each key keeps its own latest value');
    eq(await AppStore.get('pallettai.revisions.v1'), 'R', 'a second key is written too');
    eq(await AppStore.get('pallettai.assets.v1'), 'A', 'a third key is written too');
    eq(fake.control.puts, 3, 'three keys cost three writes, not four');
  }

  // ----------------------------------------------------------
  // The comment on flushKey says a failed write is "retried next schedule".
  // It is not: the entry is removed from `pending` before the write is issued,
  // so a quota error or a full disk loses that edit silently. This is the
  // failure a creator would meet as "my last change vanished".
  console.log('\n== 6. A refused write is retained and reported, not lost ==');
  {
    const fake = createFakeIndexedDB();
    const AppStore = freshStore(fake);
    await AppStore.init();
    // A full disk refuses EVERY attempt at this key, so a retry that "succeeds"
    // would be a lie — and a refusal must not cost us the connection either.
    AppStore.schedule('pallettai.projects.v1', () => 'important');
    fake.control.failPutAlways = 'pallettai.projects.v1';
    const res = await AppStore.flush();
    eq(await AppStore.get('pallettai.projects.v1'), null, 'the refused write did not land (as expected)');
    assert(res && res.ok === false && Array.isArray(res.failed) && res.failed.includes('pallettai.projects.v1'),
      'flush() names the key it could not save instead of resolving silently');
    assert(typeof AppStore.lastError() === 'string' && AppStore.lastError().length > 0,
      'lastError() explains the failure for a UI to show');
    eq(AppStore.hasPending(), true, 'the edit is still pending, so the work is not lost');
    eq(AppStore.isReady(), true, 'a refused write keeps the connection — a full disk is not a broken connection');

    // Disk recovers (the creator clears space): the retained edit is written.
    fake.control.failPutAlways = null;
    const second = await AppStore.flush();
    eq(second.ok, true, 'the next flush succeeds');
    eq(await AppStore.get('pallettai.projects.v1'), 'important', 'and the retained edit is saved rather than dropped');
    eq(AppStore.hasPending(), false, 'nothing is left pending');
  }

  // A serializer that throws cannot be fixed by trying again, so it must be
  // reported once and let go — retrying it on every later flush would wedge
  // every subsequent save behind it.
  console.log('\n== 6b. A serializer that throws fails once and is let go ==');
  {
    const fake = createFakeIndexedDB();
    const AppStore = freshStore(fake);
    await AppStore.init();
    AppStore.schedule('pallettai.assets.v1', () => { throw new Error('circular structure'); });
    const res = await AppStore.flush();
    assert(res && res.ok === false, 'the failure is reported');
    eq(AppStore.hasPending(), false, 'it is not retried forever');
    eq(await AppStore.get('pallettai.assets.v1'), null, 'nothing is written');
    // And the store still works afterwards.
    await AppStore.put('pallettai.assets.v1', 'later');
    eq(await AppStore.get('pallettai.assets.v1'), 'later', 'a later save is unaffected');
  }

  // ----------------------------------------------------------
  console.log('\n== 7. A storage failure mid-read heals instead of losing the session ==');
  {
    const fake = createFakeIndexedDB();
    const AppStore = freshStore(fake);
    await AppStore.init();
    await AppStore.put('pallettai.projects.v1', 'payload');
    fake.control.failGetOnce = true;
    eq(await AppStore.get('pallettai.projects.v1'), 'payload', 'the read is retried on a fresh connection and succeeds');
    eq(AppStore.isReady(), true, 'the store is usable again');
  }

  // ----------------------------------------------------------
  // A version change (another window of the app, or a newer build) closes the
  // connection. If reads then answer null, the studio shows an empty workspace
  // and the creator is told their projects are gone.
  // A version change (a second window of the app, or a newer build) closes the
  // connection. If reads then answer null, the studio paints an empty workspace
  // and the creator is told their projects are gone.
  console.log('\n== 8. After a version change the store reopens on demand ==');
  {
    const fake = createFakeIndexedDB();
    const AppStore = freshStore(fake);
    await AppStore.init();
    await AppStore.put('pallettai.projects.v1', 'payload');
    eq(fake.forceVersionChange(DB_NAME) >= 1, true, 'the version change reached the open connection');
    eq(AppStore.isReady(), false, 'the store knows its handle is gone');
    eq(await AppStore.get('pallettai.projects.v1'), 'payload', 'a read still returns the data rather than an empty workspace');
    eq(AppStore.isReady(), true, 'and the connection is usable again');

    fake.forceVersionChange(DB_NAME);
    await AppStore.put('pallettai.projects.v1', 'payload2');
    eq(await AppStore.get('pallettai.projects.v1'), 'payload2', 'a write reopens the connection as well');

    // The debounced path must recover too, or an autosave after a version
    // change would silently stop saving.
    fake.forceVersionChange(DB_NAME);
    AppStore.schedule('pallettai.revisions.v1', () => 'rev');
    const res = await AppStore.flush();
    eq(res.ok, true, 'a debounced write after a version change is saved');
    eq(await AppStore.get('pallettai.revisions.v1'), 'rev', 'and the revision is really there');
  }

  // ----------------------------------------------------------
  console.log('\n== 9. Where there is no database, the caller still has a copy ==');
  {
    // This is the app's fallback shape: bootStoreOK false means the caller keeps
    // using localStorage. The store must never claim success in that mode.
    const fake = createFakeIndexedDB();
    fake.control.failOpen = true;
    const AppStore = freshStore(fake);
    eq(await AppStore.init(), false, 'a database that will not open reports false');
    eq(AppStore.isReady(), false, 'and isReady() stays false');
    await AppStore.put('k', 'v').then(
      () => fail('put() claimed success with no database open'),
      () => pass('put() rejects so the fallback path is taken')
    );
  }

  // ----------------------------------------------------------
  console.log('\n== 10. The library can report what it weighs ==');
  {
    const fake = createFakeIndexedDB();
    const AppStore = freshStore(fake);
    await AppStore.init();

    const empty = await AppStore.usage();
    eq(empty.ready, true, 'usage() reports the store as open');
    eq(empty.bytes, 0, 'an empty library weighs nothing');
    eq(empty.entries.length, 0, 'and lists no keys');

    await AppStore.put('pallettai.projects.v1', 'x'.repeat(1000));
    await AppStore.put('pallettai.revisions.v1', 'y'.repeat(100));
    await AppStore.put('pallettai.settings.v1', '{}');
    fake.control.cursors = 0;
    const used = await AppStore.usage();
    assert(fake.control.cursors === 1, 'the size comes from one walk, not one read per key');
    eq(used.bytes, 1102, 'bytes are measured from what was written (1000 + 100 + 2)');
    eq(used.entries[0].key, 'pallettai.projects.v1', 'the largest key is listed first');
    eq(used.entries.length, 3, 'every stored key is listed');
    assert(used.entries.every((e) => e.bytes > 0), 'no key is reported as zero bytes');

    // A key that is deleted must stop counting, or the panel would report space
    // that deleting a project already gave back.
    await AppStore.del('pallettai.projects.v1');
    const after = await AppStore.usage();
    eq(after.bytes, 102, 'a deleted key is no longer counted');
    eq(after.keys.indexOf('pallettai.projects.v1'), -1, 'and is gone from the key list');

    // Unsaved edits are not in the walk yet, so the panel can warn instead of
    // showing a confident total that excludes them.
    AppStore.schedule('pallettai.assets.v1', () => 'z'.repeat(50));
    eq(AppStore.hasPending(), true, 'a scheduled write is visible as pending');
    const during = await AppStore.usage();
    eq(during.bytes, 102, 'pending bytes are not counted before they are written');
    await AppStore.flush();
    const settled = await AppStore.usage();
    eq(settled.bytes, 152, 'and are counted once flushed');

    // A failing walk must not read as an empty library — "0 bytes" and "could
    // not measure" are opposite claims, and the panel words them differently.
    // DataError rather than UnknownError on purpose: a connection error would
    // (rightly) be reconnected and retried, and the retry would succeed.
    fake.control.failCursorOnce = 'DataError';
    const broken = await AppStore.usage();
    eq(broken.ready, true, 'a failed walk still reports the store as open');
    assert(!!broken.error, 'and carries the reason instead of a confident zero');
  }

  // ----------------------------------------------------------
  // usage() weighs the store; audit() checks it. The failure this exists for is
  // the one that looks healthy from every other angle: a value sitting there at
  // full size that no longer parses, so the app shows an empty project list and
  // the byte count looks perfectly normal.
  console.log('\n== 10b. The library can say whether it can be READ ==');
  {
    const fake = createFakeIndexedDB();
    const AppStore = freshStore(fake);
    eq(await AppStore.init(), true, 'the store opens');

    await AppStore.put('pallettai.projects.v1', JSON.stringify([{ id: 'p1' }, { id: 'p2' }]));
    await AppStore.put('pallettai.settings.v1', JSON.stringify({ theme: 'dark' }));
    await AppStore.put('pallettai.revisions.v1', '{ this one is corrupt');
    await AppStore.put('pallettai.assets.v1', JSON.stringify('a string where a list belongs'));
    await AppStore.put('pallettai.unknown.v1', JSON.stringify({ a: 1 }));

    const report = await AppStore.audit({
      'pallettai.projects.v1': 'array',
      'pallettai.settings.v1': 'object',
      'pallettai.revisions.v1': 'object',
      'pallettai.assets.v1': 'array'
    });

    eq(report.ready, true, 'the report comes back from a walk of the real store');
    eq(report.entries.length, 5, 'every stored key is walked, not just the known ones');
    eq(report.counts.ok, 2, 'two values read back as the shape this build expects');
    eq(report.counts.unparseable, 1, 'one value cannot be parsed at all');
    eq(report.counts.unexpected, 1, 'and one is the wrong container');
    eq(report.counts.unknown, 1, 'a key with no registered format is reported separately, not as a fault');
    eq(report.problems.length, 2, 'the two real problems are collected together for the panel');

    const corrupt = report.entries.find((e) => e.key === 'pallettai.revisions.v1');
    eq(corrupt.verdict, 'unparseable', 'the corrupt value is named as unparseable');
    assert(!!corrupt.hint, 'with a hint that says what it means for the user');
    eq(corrupt.bytes, '{ this one is corrupt'.length, 'and its full size is still reported — the bytes are there, the meaning is not');
    const wrongShape = report.entries.find((e) => e.key === 'pallettai.assets.v1');
    eq(wrongShape.verdict, 'unexpected', 'a list-shaped key holding a scalar is flagged');
    assert(/expected array/.test(wrongShape.hint), 'and the hint names both shapes: ' + wrongShape.hint);
    const items = report.entries.find((e) => e.key === 'pallettai.projects.v1');
    eq(items.items, 2, 'a healthy value reports how many items it holds, so the report is useful as well as green');

    // The recovery advice only appears when there is something to recover, and
    // it names backing up first — replacing those values is the one action that
    // would lose them for good.
    assert(/back the library up/i.test(report.advice), 'the advice says to back up before touching anything');
    eq(await AppStore.get('pallettai.revisions.v1'), '{ this one is corrupt', 'and the audit did NOT touch the value it could not read');

    const clean = await AppStore.audit(undefined);
    eq(clean.counts.unknown, 4, 'with no expectations supplied, nothing is judged — a key this build does not know is not a fault');
    eq(clean.counts.ok, 0, 'so nothing is called healthy either, only unknown');
    eq(clean.problems.length, 1, 'only the genuinely unreadable value is a problem');
    eq(clean.advice.length > 0, true, 'and the advice still stands for it');
  }

  // ----------------------------------------------------------
  console.log('\n== 11. Eviction protection is asked for, and its answer reported ==');
  {
    // Storage is best-effort by default: a browser under pressure may drop an
    // origin's whole library without asking. The store must be able to report
    // whether that protection is in place, and must not claim it when the
    // browser has no such API.
    const fake = createFakeIndexedDB();
    const AppStore = freshStore(fake);
    await AppStore.init();

    eq(await AppStore.quota(), null, 'no storage API reports null, not zero');
    eq((await AppStore.persistence()).supported, false, 'and persistence is honestly unsupported');

    let persisted = false;
    let asked = 0;
    // Node's own `navigator` is a getter on globalThis, so it has to be
    // redefined rather than assigned.
    Object.defineProperty(global, 'navigator', {
      configurable: true,
      value: {
        storage: {
          async estimate() { return { usage: 4_000_000, quota: 120_000_000 }; },
          async persisted() { return persisted; },
          async persist() { asked++; persisted = true; return true; }
        }
      }
    });
    const q = await AppStore.quota();
    eq(q.quota, 120_000_000, 'a reporting browser gives the real quota');
    eq(q.usage, 4_000_000, 'and the real usage, even though it is not ours alone');
    eq((await AppStore.persistence()).persisted, false, 'before asking, the data is evictable');
    const asked1 = await AppStore.requestPersistence();
    eq(asked, 1, 'the request reaches the browser exactly once');
    eq(asked1.persisted, true, 'and its answer is reported as given');
    eq((await AppStore.persistence()).persisted, true, 'so the panel can stop asking');

    // A browser that says no is not an error, and must not be reported as a yes.
    global.navigator.storage.persist = async () => false;
    const denied = await AppStore.requestPersistence();
    eq(denied.persisted, false, 'a refusal is reported as a refusal');
  }

  if (failed) {
    console.error('\nstore-smoke FAILED — ' + failed + ' failure(s)');
    process.exit(1);
  }
  console.log('\nstore-smoke PASSED');
})().catch((e) => {
  console.error('\nstore-smoke crashed:', e && e.stack || e);
  process.exit(1);
});
