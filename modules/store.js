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
   - Everything fails soft: init() returns false if IndexedDB is
     unavailable, and the app falls back to localStorage.

   Global API (plain <script>, like the other modules):

     await AppStore.init()             → boolean ready
     await AppStore.get(key)           → string | null
     await AppStore.put(key, value)    → direct write (migration, flush)
     await AppStore.del(key)
     AppStore.schedule(key, getValue)  → debounced write; getValue is
                                         called once at flush time
     await AppStore.flush()            → write everything pending now
     AppStore.isReady()                → boolean
   ============================================================ */
(function () {
  'use strict';

  const DB_NAME = 'pallettai-data';
  const DB_VER = 1;
  const STORE = 'kv';
  const FLUSH_MS = 250;

  const AppStore = (() => {
    let db = null;
    let opened = false;

    function openDB() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VER);
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
        };
        req.onsuccess = () => {
          const openedDb = req.result;
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

    function store(mode) {
      if (!db) throw new Error('AppStore not open');
      return db.transaction(STORE, mode).objectStore(STORE);
    }

    function markBroken() {
      if (db) { try { db.close(); } catch (e) {} }
      db = null;
      opened = false;
    }

    async function retryAfterStoreFailure(operation) {
      try { return await operation(); }
      catch (first) {
        markBroken();
        if (!(await init())) throw first;
        return operation();
      }
    }

    async function put(key, value) {
      return retryAfterStoreFailure(() => {
        if (!db) throw new Error('AppStore not open');
        return new Promise((resolve, reject) => {
          let r;
          try { r = store('readwrite').put(value, key); } catch (e) { reject(e); return; }
          r.onsuccess = () => resolve();
          r.onerror = () => reject(r.error);
          r.onabort = () => reject(r.error || new Error('IndexedDB transaction aborted'));
        });
      });
    }

    async function get(key) {
      if (!db) return null;
      return retryAfterStoreFailure(() => new Promise((resolve, reject) => {
        let r;
        try { r = store('readonly').get(key); } catch (e) { reject(e); return; }
        r.onsuccess = () => resolve(r.result === undefined ? null : r.result);
        r.onerror = () => reject(r.error);
        r.onabort = () => reject(r.error || new Error('IndexedDB transaction aborted'));
      }));
    }

    async function del(key) {
      if (!db) return;
      return retryAfterStoreFailure(() => new Promise((resolve, reject) => {
        let r;
        try { r = store('readwrite').delete(key); } catch (e) { reject(e); return; }
        r.onsuccess = () => resolve();
        r.onerror = () => reject(r.error);
        r.onabort = () => reject(r.error || new Error('IndexedDB transaction aborted'));
      }));
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
      if (!(key in pending)) return;
      const entry = pending[key];
      delete pending[key];
      clearTimeout(timers[key]);
      try {
        let value = entry;
        if (typeof entry === 'function') {
          value = entry();
          if (value === undefined) return; // nothing to write yet
        }
        await put(key, value);
      } catch (e) { /* storage errors are non-fatal — retried next schedule */ }
    }

    async function flush() {
      const keys = Object.keys(pending);
      await Promise.all(keys.map((k) => flushKey(k)));
    }

    function isReady() { return !!db; }

    return { init, get, put, del, schedule, flush, isReady };
  })();

  window.AppStore = AppStore;
})();
