/* ============================================================
   AppStore — IndexedDB persistence for PallettAI Studio
   ------------------------------------------------------------
   Projects and autosave revisions outgrew localStorage's ~5 MB
   quota (photos are inlined as data URLs). This module stores
   them in IndexedDB instead — effectively unlimited space — and
   keeps localStorage only for small settings-style keys.

   Design notes:
   - Values are stored as JSON strings under plain keys, so the
     on-disk format is identical to the old localStorage rows and
     a rollback is trivial.
   - Writes are debounced and the JSON is serialized lazily at
     flush time (latest state wins), so bursts of edits cost one
     stringify + one write instead of one per keystroke/save.
   - A write promise resolves when its TRANSACTION COMMITS, not
     when the request callback fires. The difference is a real
     window, and the migration below it deletes the localStorage
     copy on that signal — resolving early is how a crash between
     the two turns one copy of a project into none.
   - A refused write (a full disk, a quota error) keeps its value
     pending and is reported, rather than being dropped. Retrying
     is allowed to fail; losing the edit is not.
   - Only a broken CONNECTION is worth a new one. A refusal would
     fail identically a moment later, and reconnecting on it takes
     the whole session's storage down with it.
   - Everything fails soft: init() returns false if IndexedDB is
     unavailable, and the app falls back to localStorage. A read
     that finds the handle closed by a version change reopens it
     rather than answering "no data", which would read as a wiped
     workspace.

   Global API (plain <script>, like the other modules):

     await AppStore.init()             → boolean ready
     await AppStore.get(key)           → string | null
     await AppStore.put(key, value)    → direct write (migration, flush)
     await AppStore.del(key)
     AppStore.schedule(key, getValue)  → debounced write; getValue is
                                         called once at flush time
     await AppStore.flush()            → { ok, failed: [keys], error }
     AppStore.isReady()                → boolean
     AppStore.hasPending()             → boolean, unsaved edits exist
     AppStore.pendingKeys()            → [keys] waiting to be written
     AppStore.lastError()              → string, '' when nothing failed
     await AppStore.usage()            → { ready, entries:[{key,bytes}], bytes }
     await AppStore.quota()            → { usage, quota } | null
     await AppStore.persistence()      → { supported, persisted }
     await AppStore.requestPersistence()→ { supported, persisted }

   The last four exist so the Database view can describe the library instead
   of only offering to wipe it. usage() walks the store and measures, quota()
   reports the origin's real limit, and persistence()/requestPersistence() are
   how the data opts out of a browser's automatic eviction — the difference
   between "my projects" and "my projects until the disk gets busy".
   ============================================================ */
(function () {
  'use strict';

  const DB_NAME = 'pallettai-data';
  const DB_VER = 1;
  const STORE = 'kv';
  const FLUSH_MS = 250;

  // An error that means "this connection is finished" — worth a new one.
  // Anything else failed for its own reason and will fail again.
  const CONNECTION_ERRORS = ['InvalidStateError', 'AbortError', 'TransactionInactiveError', 'NotFoundError', 'UnknownError'];

  const AppStore = (() => {
    let db = null;
    let opened = false;
    let lastErrorText = '';
    let lastErrorAt = 0;

    function noteError(e) {
      const name = (e && e.name) || '';
      lastErrorText = name === 'QuotaExceededError'
        ? 'The device is out of storage space — free some up and this change will save on the next one.'
        : ((e && e.message) || 'Storage error');
      lastErrorAt = Date.now();
      return lastErrorText;
    }

    function isConnectionError(e) {
      const name = (e && e.name) || '';
      if (CONNECTION_ERRORS.indexOf(name) !== -1) return true;
      return /AppStore not open/i.test((e && e.message) || '');
    }

    function openDB() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VER);
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
        };
        req.onsuccess = () => {
          const openedDb = req.result;
          // A newer version in another window closes this one. Drop the handle
          // so the next operation reopens instead of failing silently.
          openedDb.onversionchange = () => { openedDb.close(); if (db === openedDb) { db = null; opened = false; } };
          resolve(openedDb);
        };
        req.onerror = () => reject(req.error);
      });
    }

    async function init() {
      if (opened) return true;
      if (typeof indexedDB === 'undefined') return false;
      try {
        db = await openDB();
        opened = true;
        return true;
      } catch (e) {
        db = null;
        opened = false;
        return false;
      }
    }

    // Reopen on demand: after a version change (or a broken handle) the store
    // must reconnect rather than report an empty workspace or a no-op delete.
    function ensureReady() {
      return db ? Promise.resolve(true) : init();
    }

    function markBroken() {
      if (db) { try { db.close(); } catch (e) {} }
      db = null;
      opened = false;
    }

    async function retryAfterStoreFailure(operation) {
      try { return await operation(); }
      catch (first) {
        // Only a dead connection is retried. A refusal is returned to the
        // caller with its reason intact, and the connection survives it.
        if (!isConnectionError(first)) throw first;
        markBroken();
        if (!(await init())) throw first;
        return operation();
      }
    }

    /*
      One transaction, resolved when it COMMITS.

      Resolving from the request callback instead looks identical in a fast
      test and differs exactly once: the moment before the transaction commits.
      app.js migrates by writing here and then deleting the localStorage copy,
      so a crash in that window leaves the project in neither store.
    */
    function run(mode, use, resultOf) {
      return new Promise((resolve, reject) => {
        let tx = null;
        let request = null;
        try {
          tx = db.transaction(STORE, mode);
          request = use(tx.objectStore(STORE));
        } catch (e) { reject(e); return; }
        let settled = false;
        const fail = (e) => {
          if (settled) return;
          settled = true;
          reject(e || (request && request.error) || new Error('IndexedDB transaction failed'));
        };
        tx.oncomplete = () => {
          if (settled) return;
          settled = true;
          // resultOf exists for cursors: a cursor request's own result is the
          // final (null) cursor, while the useful answer is what the walk found.
          resolve(resultOf ? resultOf(request) : (request ? request.result : undefined));
        };
        tx.onerror = () => fail(tx.error || (request && request.error));
        tx.onabort = () => fail(tx.error || (request && request.error) || new Error('IndexedDB transaction aborted'));
      });
    }

    async function put(key, value) {
      return retryAfterStoreFailure(async () => {
        if (!db && !(await ensureReady())) throw new Error('AppStore not open');
        return run('readwrite', (os) => os.put(value, key));
      });
    }

    async function get(key) {
      if (!db && !(await ensureReady())) return null;
      return retryAfterStoreFailure(async () => {
        if (!db && !(await ensureReady())) return null;
        const value = await run('readonly', (os) => os.get(key));
        return value === undefined ? null : value;
      });
    }

    async function del(key) {
      if (!db && !(await ensureReady())) return;
      return retryAfterStoreFailure(async () => {
        if (!db && !(await ensureReady())) return;
        return run('readwrite', (os) => os.delete(key));
      });
    }

    /* ---------- debounced, latest-wins writes ---------- */
    const timers = {};
    const pending = {};

    // getValue may be a function evaluated once at flush time, or a value.
    function schedule(key, getValue) {
      pending[key] = getValue;
      clearTimeout(timers[key]);
      timers[key] = setTimeout(() => { flushKey(key); }, FLUSH_MS);
    }

    async function flushKey(key) {
      if (!(key in pending)) return { key, ok: true };
      const entry = pending[key];
      clearTimeout(timers[key]);
      delete timers[key];
      let value = entry;
      if (typeof entry === 'function') {
        try {
          value = entry();
        } catch (e) {
          // A serializer that throws cannot be fixed by asking again, and
          // holding it would wedge every later save behind it.
          delete pending[key];
          noteError(e);
          return { key, ok: false, error: lastErrorText, fatal: true };
        }
        // Nothing to write yet — the caller has no state worth saving.
        if (value === undefined) { delete pending[key]; return { key, ok: true, skipped: true }; }
      }
      try {
        await put(key, value);
        delete pending[key];
        return { key, ok: true };
      } catch (e) {
        // Keep the entry. The edit exists only in memory at this point, and
        // deleting it here is how a creator's last change disappears without
        // anyone being told. The next flush — or the next edit to this key —
        // tries again, and because the getter is retained it writes the
        // NEWEST state rather than the stale one.
        noteError(e);
        return { key, ok: false, error: lastErrorText };
      }
    }

    // Never rejects: this is called from pagehide and from an app-quit IPC
    // handler, where an unhandled rejection is invisible and a thrown error is
    // worse. The result says what could not be saved.
    async function flush() {
      const keys = Object.keys(pending);
      if (!keys.length) return { ok: true, failed: [], error: '' };
      const results = await Promise.all(keys.map((k) => flushKey(k)));
      const failed = results.filter((r) => r && r.ok === false).map((r) => r.key);
      return { ok: failed.length === 0, failed, error: failed.length ? lastErrorText : '' };
    }

    function isReady() { return !!db; }
    function hasPending() { return Object.keys(pending).length > 0; }
    function pendingKeys() { return Object.keys(pending); }
    function lastError() { return lastErrorText; }
    function lastErrorAtMs() { return lastErrorAt; }

    /* ---------- what the library actually weighs ---------- */

    // UTF-8 bytes. IndexedDB has no size API, so the only honest answer to "how
    // big is my library" is to measure what it wrote. base64 photos dominate the
    // total and are pure ASCII, where the string length is already the byte
    // count — but TextEncoder is exact for everything, including project names.
    function byteLength(value) {
      const text = typeof value === 'string' ? value : String(value === undefined || value === null ? '' : value);
      if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length;
      if (typeof Buffer !== 'undefined') return Buffer.byteLength(text, 'utf8');
      return text.length;
    }

    /*
      Every stored key with its size, for the Database view.

      Deliberately not grouped here: this module knows how to store a key, not
      what a key means, so the caller (which owns the key vocabulary) decides
      that projects are not revisions.
    */
    async function usage() {
      const empty = { ready: false, keys: [], entries: [], bytes: 0 };
      if (!db && !(await ensureReady())) return empty;
      const entries = [];
      try {
        await retryAfterStoreFailure(async () => {
          if (!db && !(await ensureReady())) return;
          return run('readonly', (os) => {
            const cursor = os.openCursor();
            cursor.onsuccess = () => {
              const row = cursor.result;
              if (!row) return;
              entries.push({ key: String(row.key), bytes: byteLength(row.value) });
              row.continue();
            };
            return cursor;
          }, () => entries);
        });
      } catch (e) {
        noteError(e);
        return { ...empty, ready: true, error: lastErrorText };
      }
      entries.sort((a, b) => b.bytes - a.bytes);
      return {
        ready: true,
        dbName: DB_NAME,
        dbVersion: DB_VER,
        entries,
        keys: entries.map((e) => e.key),
        bytes: entries.reduce((n, e) => n + e.bytes, 0)
      };
    }

    /*
      Walk the whole library and say whether it can actually be read.

      usage() weighs the store; this checks it. They are different questions and
      only one of them was ever answerable: a value can be sitting there at full
      size and still be unreadable, in which case the app shows an empty projects
      list, the size figure looks completely normal, and nobody can tell the two
      situations apart from the outside. For a local-first studio that is the most
      expensive kind of bug — the bytes are all present and the word is "gone".

      `expected` maps a stored key to the container it should hold ('array' or
      'object'). Keys outside that map are reported as unknown rather than judged,
      because a key this app does not recognise is not a fault — it is how the
      report stays safe to run on a library a newer build wrote.

      When a key fails to parse, the value is NOT touched: an unparseable project
      list may still be recoverable by hand, and the one thing this must never do
      is replace a recoverable value with an empty one. The report says which keys
      are affected so the creator can back up before anything else happens.
    */
    async function audit(expected) {
      const want = expected || {};
      const empty = { ready: false, at: Date.now(), keys: [], entries: [], bytes: 0, problems: [], counts: { ok: 0, unparseable: 0, unexpected: 0, unknown: 0, notText: 0 } };
      if (!db && !(await ensureReady())) return empty;

      const rows = [];
      try {
        await retryAfterStoreFailure(async () => {
          if (!db && !(await ensureReady())) return;
          return run('readonly', (os) => {
            const cursor = os.openCursor();
            cursor.onsuccess = () => {
              const row = cursor.result;
              if (!row) return;
              rows.push({ key: String(row.key), value: row.value });
              row.continue();
            };
            return cursor;
          }, () => rows);
        });
      } catch (e) {
        noteError(e);
        return { ...empty, ready: true, error: lastErrorText, problems: [{ key: '', label: 'the library', verdict: 'unreadable', hint: lastErrorText }] };
      }

      const entries = rows.map((row) => {
        const entry = { key: row.key, bytes: byteLength(row.value), text: typeof row.value === 'string', parsed: false, shape: '', items: 0, error: '', verdict: 'ok', hint: '' };
        if (!entry.text) {
          entry.verdict = 'notText';
          entry.hint = 'stored as ' + (row.value === null ? 'null' : typeof row.value) + ' rather than a text blob';
          return entry;
        }
        let value = null;
        try {
          value = JSON.parse(row.value);
          entry.parsed = true;
        } catch (e) {
          entry.verdict = 'unparseable';
          entry.error = (e && e.message) || 'not valid JSON';
          entry.hint = 'the app cannot read this value, so whatever it holds is invisible in the studio until it is repaired or restored';
          return entry;
        }
        entry.shape = Array.isArray(value) ? 'array' : (value && typeof value === 'object' ? 'object' : 'scalar');
        entry.items = entry.shape === 'array' ? value.length : (entry.shape === 'object' ? Object.keys(value).length : 1);
        const wantShape = want[row.key];
        if (!wantShape) {
          entry.verdict = 'unknown';
          entry.hint = 'no format registered for this key in this build';
        } else if (wantShape !== entry.shape) {
          entry.verdict = 'unexpected';
          entry.hint = 'expected ' + wantShape + ', found ' + entry.shape;
        }
        return entry;
      });

      entries.sort((a, b) => (b.verdict === 'ok' ? 0 : 1) - (a.verdict === 'ok' ? 0 : 1) || b.bytes - a.bytes);
      const counts = { ok: 0, unparseable: 0, unexpected: 0, unknown: 0, notText: 0 };
      const problems = [];
      entries.forEach((e) => {
        counts[e.verdict] = (counts[e.verdict] || 0) + 1;
        if (e.verdict !== 'ok' && e.verdict !== 'unknown') problems.push(e);
      });

      return {
        ready: true,
        at: Date.now(),
        dbName: DB_NAME,
        dbVersion: DB_VER,
        entries,
        keys: entries.map((e) => e.key),
        bytes: entries.reduce((n, e) => n + e.bytes, 0),
        problems,
        counts,
        // The repair advice the panel shows. Kept here with the report so the
        // wording cannot drift away from what was actually found.
        advice: counts.unparseable || counts.notText
          ? 'Back the library up before anything else: those values are still on disk in full, and replacing them is the one action that would lose them for good.'
          : (counts.unexpected ? 'The listed keys hold a different shape than this build expects — export the project, check it, then let the format upgrade run again.' : '')
      };
    }

    // Space the browser is willing to give this origin, and how much is used.
    // null means the browser does not report it — distinct from "no space left",
    // and the panel says so rather than showing a confident zero.
    async function quota() {
      const s = typeof navigator !== 'undefined' ? navigator.storage : null;
      if (!s || typeof s.estimate !== 'function') return null;
      try {
        const e = await s.estimate();
        return { usage: Number(e && e.usage) || 0, quota: Number(e && e.quota) || 0 };
      } catch (e) { return null; }
    }

    /*
      Is this data safe from automatic cleanup?

      Storage is "best effort" by default: a browser under pressure is allowed to
      evict an origin's IndexedDB without asking, which is a creator's whole
      project library. persisted/persist are how an app opts out of that, and the
      studio never asked. None of this is a substitute for a backup, so the panel
      offers both.
    */
    async function persistence() {
      const s = typeof navigator !== 'undefined' ? navigator.storage : null;
      if (!s) return { supported: false, persisted: false };
      try {
        if (typeof s.persisted === 'function' && (await s.persisted())) return { supported: true, persisted: true };
        if (typeof s.persist === 'function') return { supported: true, persisted: false };
        return { supported: false, persisted: false };
      } catch (e) { return { supported: false, persisted: false }; }
    }

    async function requestPersistence() {
      const s = typeof navigator !== 'undefined' ? navigator.storage : null;
      if (!s || typeof s.persist !== 'function') return { supported: false, persisted: false };
      try {
        return { supported: true, persisted: !!(await s.persist()) };
      } catch (e) {
        return { supported: true, persisted: false, error: noteError(e) };
      }
    }

    return {
      init, get, put, del, schedule, flush,
      isReady, hasPending, pendingKeys, lastError, lastErrorAt: lastErrorAtMs,
      usage, audit, quota, persistence, requestPersistence
    };
  })();

  window.AppStore = AppStore;

  if (typeof module !== 'undefined' && module.exports) module.exports = AppStore;
})();
