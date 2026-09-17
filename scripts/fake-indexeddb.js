'use strict';
// ============================================================
// A small, deliberately faithful IndexedDB double.
// ------------------------------------------------------------
// modules/store.js is the only thing standing between a creator's
// work and a lost project, and no suite covered it — it could not
// be tested from Node, which has no indexedDB. This module supplies
// enough of the API to run the real store, and it is written to be
// UNKIND in the ways the real implementation is unkind:
//
//   · nothing is ever called back synchronously (real IndexedDB
//     queues every callback), so a store that assumes otherwise
//     fails here rather than on a slow laptop
//   · a written value is NOT visible until its transaction
//     commits, so "resolved" cannot be mistaken for "durable"
//   · an unhandled request error aborts the whole transaction,
//     exactly as the spec requires
//   · failures can be injected per key, and an abort can be forced
//     mid-transaction
//
// What it does not model: indexes, key ranges, durability hints,
// or cross-process locking. Nothing in the studio uses them. Cursors
// ARE modelled, because the library-size report walks the store with
// one and a walk that commits early would measure a partial library.
// ============================================================

function createFakeIndexedDB(options) {
  const opts = options || {};
  const databases = new Map();   // name -> { version, stores: Map(name -> Map) }
  const control = {
    opens: 0,
    puts: 0,
    gets: 0,
    deletes: 0,
    cursors: 0,
    commits: 0,
    aborts: 0,
    // Fail the next write to this key (or all writes when true), like a quota
    // error or a disk that went away. Cleared once it fires.
    failPutOnce: null,
    // Fail EVERY write to this key: a full disk does not recover because you
    // asked again, so a store must not treat the retry as a fix.
    failPutAlways: null,
    // Fail the next read: the store must degrade, not crash.
    failGetOnce: null,
    // Fail the next cursor walk with this error name. A CONNECTION error here
    // gets reconnected and retried by the store (correctly), so a test that
    // wants the failure surfaced uses a non-connection name like DataError.
    failCursorOnce: null,
    // Throw during open() — a private-mode browser or a corrupt profile.
    failOpen: false,
    // Abort the transaction as it commits, so a "successful" write is lost.
    abortNextCommit: false,
    // Delay every callback, to prove the store does not depend on ordering.
    latencyMs: 0
  };

  const schedule = (fn) => setTimeout(fn, control.latencyMs);

  // Open connections per database name, so a version change can reach every one
  // of them the way the browser does.
  const connections = new Map();

  function fakeError(name, message) {
    const e = new Error(message || name);
    e.name = name;
    return e;
  }

  function requestOf() {
    return {
      result: undefined,
      error: null,
      onsuccess: null,
      onerror: null,
      readyState: 'pending'
    };
  }

  class FakeTransaction {
    constructor(database, storeNames, mode) {
      this.db = database;
      this.mode = mode;
      this.error = null;
      this.oncomplete = null;
      this.onabort = null;
      this.onerror = null;
      this._names = storeNames.slice();
      this._overlay = new Map();   // storeName -> Map(key -> value | DELETED)
      this._pending = 0;
      this._settled = false;
      this._failed = null;
      this._names.forEach((n) => this._overlay.set(n, new Map()));
    }

    objectStore(name) {
      if (!this._names.includes(name)) {
        throw fakeError('NotFoundError', 'No object store named ' + name + ' in this transaction');
      }
      if (this._settled) throw fakeError('TransactionInactiveError', 'The transaction has finished');
      return new FakeObjectStore(this, name);
    }

    _begin() {
      if (this._settled) throw fakeError('TransactionInactiveError', 'The transaction has finished');
      this._pending++;
    }

    // A failed request aborts the transaction unless the caller handled it.
    // store.js rejects on request.onerror and never calls preventDefault, so a
    // failed write takes the transaction down with it — as it would for real.
    _end(ok, error) {
      if (!ok && !this._failed) this._failed = error || fakeError('UnknownError');
      this._pending--;
      // The commit lands in its OWN task, not in the same callback as the last
      // request. That gap is real, and it is what makes "my promise resolved"
      // and "the bytes are on disk" two different claims.
      if (this._pending === 0 && !this._settled) schedule(() => { if (!this._settled) this._finish(); });
    }

    _finish() {
      this._settled = true;
      const failed = this._failed;
      if (failed || control.abortNextCommit) {
        control.abortNextCommit = false;
        this.error = failed || fakeError('AbortError', 'Transaction aborted');
        control.aborts++;
        // Discard everything the transaction staged: an aborted transaction
        // leaves the database exactly as it found it.
        if (this.onabort) this.onabort({ target: this });
        return;
      }
      // Commit: only now does the data exist for anyone else.
      this._overlay.forEach((changes, storeName) => {
        const target = this.db._storeData(storeName);
        changes.forEach((value, key) => {
          if (value === DELETED) target.delete(key);
          else target.set(key, value);
        });
      });
      control.commits++;
      if (this.oncomplete) this.oncomplete({ target: this });
    }

    commitNow() {
      if (!this._settled && this._pending === 0) this._finish();
    }

    abort() {
      if (this._settled) return;
      this._failed = this._failed || fakeError('AbortError', 'The transaction was aborted');
      this._settled = true;
      control.aborts++;
      if (this.onabort) this.onabort({ target: this });
    }
  }

  class FakeObjectStore {
    constructor(tx, name) {
      this.transaction = tx;
      this.name = name;
    }

    _read(key) {
      const overlay = this.transaction._overlay.get(this.name);
      if (overlay.has(key)) return overlay.get(key);
      return this.transaction.db._storeData(this.name).get(key);
    }

    put(value, key) {
      const req = requestOf();
      this.transaction._begin();
      const tx = this.transaction;
      const shouldFail = control.failPutAlways === true || control.failPutAlways === key
        || control.failPutOnce === true || control.failPutOnce === key;
      if (shouldFail && (control.failPutOnce === true || control.failPutOnce === key)) control.failPutOnce = null;
      schedule(() => {
        if (shouldFail) {
          req.error = fakeError('QuotaExceededError', 'The quota has been exceeded.');
          if (req.onerror) req.onerror({ target: req });
          tx._end(false, req.error);
          return;
        }
        control.puts++;
        // The value is staged, not stored: it becomes visible only at commit.
        tx._overlay.get(this.name).set(key, value);
        req.result = key;
        if (req.onsuccess) req.onsuccess({ target: req });
        tx._end(true);
      });
      return req;
    }

    get(key) {
      const req = requestOf();
      this.transaction._begin();
      const tx = this.transaction;
      const shouldFail = control.failGetOnce === true || control.failGetOnce === key;
      if (shouldFail) control.failGetOnce = null;
      schedule(() => {
        if (shouldFail) {
          req.error = fakeError('UnknownError', 'The read failed.');
          if (req.onerror) req.onerror({ target: req });
          tx._end(false, req.error);
          return;
        }
        control.gets++;
        req.result = this._read(key);   // undefined for a missing key
        if (req.onsuccess) req.onsuccess({ target: req });
        tx._end(true);
      });
      return req;
    }

    delete(key) {
      const req = requestOf();
      this.transaction._begin();
      const tx = this.transaction;
      schedule(() => {
        control.deletes++;
        tx._overlay.get(this.name).set(key, DELETED);
        if (req.onsuccess) req.onsuccess({ target: req });
        tx._end(true);
      });
      return req;
    }

    /*
      A cursor walk, as close to the real thing as a fake needs to be.

      Two properties matter and both are easy to get wrong: the transaction
      stays OPEN for the whole walk (the cursor holds it, so an implementation
      that ends the transaction per step would commit early), and steps arrive
      in their own tasks with the last one delivering a null cursor.

      Keys are walked in IndexedDB's order (string keys, ascending). The value
      read for each key goes through the same overlay-aware lookup as get(), so
      a readwrite walk sees its own staged writes.
    */
    openCursor() {
      const req = requestOf();
      this.transaction._begin();
      const tx = this.transaction;
      const failName = control.failCursorOnce;
      if (failName) control.failCursorOnce = null;
      const keys = [...this.transaction.db._storeData(this.name).keys()].sort();
      let at = 0;
      const cursor = {
        key: undefined,
        value: undefined,
        continue: () => { step(); }
      };
      const step = () => {
        if (tx._settled || tx._failed) return;
        if (failName) {
          req.error = fakeError(failName, 'The walk could not be completed.');
          if (req.onerror) req.onerror({ target: req });
          tx._end(false, req.error);
          return;
        }
        if (at >= keys.length) {
          control.cursors++;
          req.result = null;
          if (req.onsuccess) req.onsuccess({ target: req });
          tx._end(true);
          return;
        }
        const key = keys[at++];
        cursor.key = key;
        cursor.value = this._read(key);
        req.result = cursor;
        if (req.onsuccess) req.onsuccess({ target: req });
      };
      schedule(step);
      return req;
    }
  }

  const DELETED = Symbol('deleted');

  class FakeDatabase {
    constructor(name, version) {
      this.name = name;
      this.version = version;
      this.onversionchange = null;
      this.onclose = null;
      this._closed = false;
      this._stores = new Set();
      if (!databases.has(name)) databases.set(name, { version, stores: new Map() });
      if (!connections.has(name)) connections.set(name, new Set());
      connections.get(name).add(this);
    }

    _storeData(name) {
      const row = databases.get(this.name) || { stores: new Map() };
      if (!row.stores.has(name)) row.stores.set(name, new Map());
      return row.stores.get(name);
    }

    get objectStoreNames() {
      const row = databases.get(this.name);
      const names = [...(row ? row.stores.keys() : [])];
      return {
        length: names.length,
        contains: (n) => names.includes(n),
        item: (i) => names[i] || null,
        [Symbol.iterator]: () => names[Symbol.iterator]()
      };
    }

    createObjectStore(name) {
      this._storeData(name);
      return { name };
    }

    transaction(storeNames, mode) {
      const names = Array.isArray(storeNames) ? storeNames : [storeNames];
      return new FakeTransaction(this, names, mode);
    }

    // Test-only: pretend another tab or a newer build bumped the version, which
    // must make the store release its handle rather than keep using a dead one.
    _forceVersionChange() {
      if (this.onversionchange) this.onversionchange({ target: this });
    }

    close() {
      this._closed = true;
      const set = connections.get(this.name);
      if (set) set.delete(this);
      if (this.onclose) this.onclose({ target: this });
    }
  }

  const indexedDB = {
    open(name, version) {
      control.opens++;
      const req = requestOf();
      req.onupgradeneeded = null;
      req.onblocked = null;
      schedule(() => {
        if (control.failOpen) {
          req.error = fakeError('InvalidStateError', 'The database could not be opened.');
          if (req.onerror) req.onerror({ target: req });
          return;
        }
        const existing = databases.get(name);
        const upgrading = !existing || (version !== undefined && version > existing.version);
        const db = existing ? new FakeDatabase(name, existing.version) : new FakeDatabase(name, version === undefined ? 1 : version);
        if (version !== undefined) {
          databases.get(name).version = version;
          db.version = version;
        }
        req.result = db;
        if (upgrading && req.onupgradeneeded) req.onupgradeneeded({ target: req, oldVersion: existing ? existing.version : 0 });
        if (req.onsuccess) req.onsuccess({ target: req });
      });
      return req;
    }
  };

  return {
    indexedDB,
    control,
    // Test-only: close and notify every open connection, as a newer version of
    // the database in another window would.
    forceVersionChange(name) {
      const set = [...(connections.get(name) || [])];
      set.forEach((conn) => { if (conn.onversionchange) conn.onversionchange({ target: conn }); });
      return set.length;
    },
    // Test-only inspection of committed data.
    snapshot(name) {
      const row = databases.get(name);
      const out = {};
      if (!row) return out;
      row.stores.forEach((map, storeName) => {
        out[storeName] = new Map(map);
      });
      return out;
    },
    raw(name, storeName) {
      const row = databases.get(name);
      if (!row || !row.stores.has(storeName)) return new Map();
      return row.stores.get(storeName);
    }
  };
}

module.exports = { createFakeIndexedDB };
