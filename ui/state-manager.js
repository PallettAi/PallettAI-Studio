'use strict';
// ============================================================
// PallettAI Studio — reactive local-first state engine
// A Proxy-based store for the studio shell: workspace schema,
// design tokens and active file paths all mutate through one
// tracked object, so components re-render from subscriptions
// instead of polling. No Redux, no MobX, no dependencies.
// ------------------------------------------------------------
//   1. createStore(initial, options) → store
//        store.state        reactive proxy (nested objects/arrays
//                           wrapped lazily; writes are tracked)
//        store.get(path)    read a nested value by dotted path; objects
//                           come back as LIVE views, so `get('pages')[0]
//                           .title = 'x'` is tracked like any other write
//        store.subscribe(cb) / store.onStateChange(path, cb)
//                           pub/sub; path subscriptions fire for
//                           the exact path AND its descendants
//        store.registerReducer(type, fn) + dispatchAction(type, payload)
//                           decoupled action bus between panels
//        store.batch(fn)    coalesce many mutations into ONE
//                           notification per subscriber
//        store.snapshot()   plain (unproxied) deep clone — what
//                           the autosave writes to disk
//   2. store.attachAutosave(options) → {flush, stop, status}
//        Debounced persistence through the IPC bridge:
//        window.pallettaiAPI.projectVault (falling back to the
//        shipped window.pallettai surface when it appears) —
//        see BRIDGE below for the exact channel contract.
//
// ---- BRIDGE -----------------------------------------------------
// The preload that owns the filesystem is not in this file's lane,
// so nothing here assumes a particular shape. Resolution order:
//   1. window.pallettaiAPI.projectVault
//   2. window.pallettai.projectVault
//   3. window.pallettai.projectVaultWrite / saveProject
// The first function found is used; a missing bridge is a
// supported state (status 'offline'), not an exception.
//
// ---- what this file guarantees ----------------------------------
// 1. NO MUTATION IS INVISIBLE. Every write, delete and array
//    mutation on the proxy notifies subscribers with {path, value,
//    previous}; a same-value write is suppressed so a re-render
//    loop cannot be triggered by assigning what is already there.
//    Array methods are wrapped for exactly this reason: push/splice
//    report a length change, while sort/reverse/fill/copyWithin and
//    an equal-length splice report the array itself — a re-order
//    that changes no length used to mutate the project in silence.
// 2. SUBSCRIBERS NEVER BREAK THE WRITER. Each callback runs in
//    try/catch and every call site iterates a COPY of the
//    subscriber list, so one throwing panel cannot stop the
//    others and cannot corrupt iteration mid-notify.
// 3. AUTOSAVE NEVER WRITES TWICE FOR THE SAME BYTES. The dirty
//    fingerprint is compared before persisting, so a burst of
//    no-op edits ends in zero disk writes, and an in-flight save
//    cannot be re-entered — later changes queue for the next pass.
// 4. OFFLINE IS A STATE, NOT A CRASH. With no bridge the payload
//    is retained and the status reports 'offline'; flush() sends
//    it as soon as a bridge exists. A rejected save keeps the
//    data dirty and surfaces 'error' instead of dropping it.
// 5. NO DOM AT REQUIRE TIME. The store is pure JavaScript; the
//    optional mountStatus() view is the only DOM touchpoint, so
//    the smoke runner can exercise the whole engine headlessly.
// ============================================================

(function (root) {
  const POINTER_SEP = '.';

  function isPlainObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v)
      && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
  }

  function clonePlain(value) {
    return cloneInner(value, new Set());
  }

  const joinPath = (base, key) => (base ? base + POINTER_SEP + key : String(key));

  // Array methods that change contents in place. `sort`/`reverse`/`fill`
  // and an equal-length `splice` leave length untouched, so a length
  // check alone would let them rewrite the project with nobody told.
  const MUTATING_METHODS = ['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin'];
  // Non-mutating methods that can hand back references into the store.
  // Their object results are re-proxied so an edit through the result
  // still notifies (filter()[0].title = … used to be a silent bypass).
  const WRAPPABLE_METHODS = ['map', 'filter', 'slice', 'concat', 'flat', 'flatMap', 'find', 'findLast', 'at'];
  // Methods that take a visitor callback. Handing that callback RAW
  // elements made `pages.forEach(p => { p.title = … })` an invisible
  // write, so the visitor is re-wrapped to receive live elements.
  const VISITOR_METHODS = ['forEach', 'map', 'filter', 'find', 'findLast', 'findIndex', 'flatMap', 'every', 'some', 'reduce', 'reduceRight', 'sort'];

  /** ancestor-aware deep clone: true cycles become '[circular]', shared refs do not */
  function cloneInner(value, ancestors) {
    if (value == null || typeof value !== 'object') return value;
    if (ancestors.has(value)) return '[circular]';
    if (value instanceof Date) return value.toISOString();
    ancestors.add(value);
    let out;
    if (Array.isArray(value)) {
      out = value.map((v) => cloneInner(v, ancestors));
    } else if (isPlainObject(value)) {
      out = {};
      Object.keys(value).forEach((k) => { out[k] = cloneInner(value[k], ancestors); });
    } else {
      out = String(value);
    }
    // Pop on the way out: only an ANCESTOR is a cycle. A value shared by
    // two keys (or the same object written into two slots) is copied per
    // occurrence, exactly as JSON.stringify would — the old global seen-set
    // labelled every repeat '[circular]' and wrote that string to disk.
    ancestors.delete(value);
    return out;
  }

  function createStore(initial, options) {
    const opts = options || {};
    if (!isPlainObject(initial)) {
      const e = new Error('createStore needs a plain object to seed the state');
      e.code = 'bad_input';
      throw e;
    }
    const raw = initial;
    const proxies = new WeakMap(); // target → proxy
    const targets = new WeakMap(); // proxy → target
    const subscribers = [];        // {match, cb, once}
    const listeners = {};          // event name → [cb]
    const reducers = {};
    let batchDepth = 0;
    let queued = [];
    let stats = { notifications: 0, mutations: 0, suppressed: 0, batches: 0 };

    const reportError = typeof opts.onError === 'function' ? opts.onError : () => {};
    const safeCall = (fn, arg) => {
      try { return fn(arg); } catch (e) { reportError(e); return undefined; }
    };

    function notify(change) {
      stats.notifications++;
      if (batchDepth > 0) { queued.push(change); return; }
      flushQueue([change]);
    }

    function flushQueue(queue) {
      subscribers.slice().forEach((sub) => {
        const hit = queue.filter((c) => sub.match === '*'
          || c.path === sub.match
          || c.path.indexOf(sub.match + POINTER_SEP) === 0);
        if (!hit.length) return;
        safeCall(sub.cb, { changes: hit, change: hit[hit.length - 1], state: proxyOf(raw) });
        if (sub.once) removeSubscriber(sub);
      });
    }

    function removeSubscriber(sub) {
      const i = subscribers.indexOf(sub);
      if (i > -1) subscribers.splice(i, 1);
    }

    // Re-proxy whatever an array method handed back (a mapped array, a
    // found element, a popped element) so references escaping the store
    // stay wired to it.
    function wrapReference(value, path, hint) {
      if (!value || typeof value !== 'object') return value;
      if (targets.has(value)) return value;
      if (Array.isArray(value)) {
        return value.map((item, i) => wrapReference(item, path, hint + '#' + i));
      }
      return proxyOf(value, joinPath(path, hint));
    }

    function proxyOf(target, path) {
      if (!target || typeof target !== 'object') return target;
      if (proxies.has(target)) return proxies.get(target);
      const proxy = new Proxy(target, {
        get(t, key, receiver) {
          if (key === '__raw') return t;
          if (key === '__path') return path || '';
          if (key === 'constructor') return Reflect.get(t, key, receiver);
          if (Array.isArray(t) && (key === Symbol.iterator || key === 'values')) {
            // Iteration must not leak raw elements either.
            return function* iterate() {
              for (let i = 0; i < t.length; i++) yield wrapReference(t[i], path, 'each');
            };
          }
          if (Array.isArray(t) && key === 'entries') {
            return function* entries() {
              for (let i = 0; i < t.length; i++) yield [i, wrapReference(t[i], path, 'each')];
            };
          }
          const value = Reflect.get(t, key, receiver);
          if (typeof key === 'symbol') return value;
          // methods keep returning real functions; objects wrap lazily.
          // A value that is ALREADY a proxy must be returned as-is: re-wrapping
          // it broke identity (`state.a.b === state.a.b` was false) and made a
          // self-referencing node recurse forever inside snapshot().
          if (value && typeof value === 'object') {
            if (targets.has(value)) return value;
            return proxyOf(value, joinPath(path, key));
          }
          if (typeof value === 'function' && Array.isArray(t)) {
            const mutates = MUTATING_METHODS.indexOf(key) > -1;
            const visitor = VISITOR_METHODS.indexOf(key) > -1;
            if (!mutates && !visitor && WRAPPABLE_METHODS.indexOf(key) === -1) return value;
            return function (...args) {
              const before = t.length;
              const proxied = visitor
                ? args.map((arg, i) => (i === 0 ? proxyVisitor(arg, path, key) : arg))
                : args;
              const out = value.apply(t, proxied);
              const after = t.length;
              if (mutates) {
                if (after !== before) {
                  notify({ type: 'set', path: joinPath(path, 'length'), value: after, previous: before });
                } else {
                  // Same length, different contents: sort/reverse/fill/
                  // copyWithin or an equal-length splice. Report the array.
                  notify({ type: 'splice', path: path || '', value: undefined, previous: undefined });
                }
              }
              // `fill`/`sort`/`reverse`/`copyWithin` return the array itself:
              // hand back the proxy so chaining stays inside the store.
              if (out === t && targets.has(receiver)) return receiver;
              return wrapReference(out, path, key);
            };
          }
          return value;
        },
        set(t, key, value, receiver) {
          const previous = t[key];
          if (Object.is(previous, value)) {
            stats.suppressed++;
            return true;
          }
          stats.mutations++;
          const ok = Reflect.set(t, key, value, receiver);
          notify({
            type: 'set',
            path: joinPath(path, key),
            value: (value && typeof value === 'object') ? undefined : value,
            previous: (previous && typeof previous === 'object') ? undefined : previous
          });
          return ok;
        },
        deleteProperty(t, key) {
          if (!(key in t)) return true;
          const previous = t[key];
          stats.mutations++;
          const ok = Reflect.deleteProperty(t, key);
          notify({ type: 'delete', path: joinPath(path, key), value: undefined, previous });
          return ok;
        }
      });
      proxies.set(target, proxy);
      targets.set(proxy, target);
      return proxy;
    }

    const state = proxyOf(raw, '');

    // Proxy the element a visitor receives, keeping the path it really
    // lives at ('pages.0'), so a write inside forEach notifies the same
    // path a direct assignment would.
    function elementProxy(value, path, indexHint, source) {
      if (!value || typeof value !== 'object') return value;
      if (targets.has(value)) return value;
      const host = Array.isArray(source) ? source : null;
      let index = -1;
      if (host) {
        if (Number.isInteger(indexHint) && host[indexHint] === value) index = indexHint;
        else index = host.indexOf(value);
      }
      return proxyOf(value, index > -1 ? joinPath(path, index) : joinPath(path, 'each'));
    }

    function proxyVisitor(fn, path, method) {
      if (typeof fn !== 'function') return fn;
      if (method === 'reduce' || method === 'reduceRight') {
        return (acc, value, index, source) => fn(acc, elementProxy(value, path, index, source), index, source);
      }
      return function visitor(value, index, source) {
        // `this` and the third argument stay the caller's business; only
        // the element is re-proxied.
        return fn.call(this, elementProxy(value, path, index, source), index, source);
      };
    }

    function readPath(path) {
      const parts = String(path == null ? '' : path).split(POINTER_SEP).filter(Boolean);
      let cur = raw;
      for (let i = 0; i < parts.length; i++) {
        if (cur == null || typeof cur !== 'object') return undefined;
        cur = cur[parts[i]];
      }
      // get() hands back a live view: mutating an object read this way
      // must still notify, otherwise get() was an invisible write path.
      if (cur && typeof cur === 'object' && !targets.has(cur)) {
        return proxyOf(cur, String(path == null ? '' : path));
      }
      return cur;
    }

    function subscribe(cb) {
      if (typeof cb !== 'function') {
        const e = new Error('subscribe needs a callback');
        e.code = 'bad_input';
        throw e;
      }
      const sub = { match: '*', cb, once: false };
      subscribers.push(sub);
      return () => removeSubscriber(sub);
    }

    function onStateChange(pathOrCb, maybeCb) {
      const cb = typeof pathOrCb === 'function' ? pathOrCb : maybeCb;
      const match = typeof pathOrCb === 'function' ? '*' : String(pathOrCb == null ? '' : pathOrCb);
      if (typeof cb !== 'function') {
        const e = new Error('onStateChange needs a callback');
        e.code = 'bad_input';
        throw e;
      }
      const sub = { match, cb, once: false };
      subscribers.push(sub);
      return () => removeSubscriber(sub);
    }

    function on(event, cb) {
      if (typeof cb !== 'function') {
        const e = new Error('on needs a callback');
        e.code = 'bad_input';
        throw e;
      }
      (listeners[event] = listeners[event] || []).push(cb);
      return () => {
        const list = listeners[event] || [];
        const i = list.indexOf(cb);
        if (i > -1) list.splice(i, 1);
      };
    }

    function emit(event, payload) {
      (listeners[event] || []).slice().forEach((cb) => safeCall(cb, payload));
    }

    function batch(fn) {
      if (typeof fn !== 'function') {
        const e = new Error('batch needs a function');
        e.code = 'bad_input';
        throw e;
      }
      batchDepth++;
      stats.batches++;
      try {
        return fn();
      } finally {
        batchDepth--;
        if (batchDepth === 0 && queued.length) {
          const q = queued;
          queued = [];
          flushQueue(q);
        }
      }
    }

    function registerReducer(type, fn) {
      if (typeof type !== 'string' || !type || typeof fn !== 'function') {
        const e = new Error('registerReducer(type, fn) needs a non-empty type and a function');
        e.code = 'bad_input';
        throw e;
      }
      reducers[type] = fn;
      return () => { if (reducers[type] === fn) delete reducers[type]; };
    }

    function dispatchAction(type, payload) {
      if (typeof type !== 'string' || !type) {
        const e = new Error('dispatchAction needs a non-empty action type');
        e.code = 'bad_input';
        throw e;
      }
      const fn = reducers[type];
      if (fn) safeCall(() => fn(state, payload == null ? {} : payload));
      emit('action', { type, payload });
      emit('action:' + type, payload);
      return { type, handled: !!fn, payload: payload == null ? {} : payload };
    }

    function snapshot() { return clonePlain(raw); }

    return {
      state,
      get: readPath,
      subscribe,
      onStateChange,
      on,
      emit,
      batch,
      registerReducer,
      dispatchAction,
      snapshot,
      stats: () => Object.assign({}, stats),
      subscribers: () => subscribers.length
    };
  }

  // ============================================================
  // Autosave — debounced persistence through the IPC bridge
  // ============================================================

  function resolveBridge(explicit) {
    if (explicit) return explicit;
    if (typeof window === 'undefined' || !window) return null;
    const api = window.pallettaiAPI || window.pallettai;
    return api || null;
  }

  function resolveVault(bridge) {
    if (!bridge) return null;
    if (bridge.projectVault && typeof bridge.projectVault === 'object') return bridge.projectVault;
    if (typeof bridge.projectVaultWrite === 'function') return { write: bridge.projectVaultWrite };
    if (typeof bridge.saveProject === 'function') return { write: bridge.saveProject };
    return null;
  }

  const defaultSave = (bridge, payload) => {
    const vault = resolveVault(bridge);
    if (!vault) return Promise.resolve({ ok: false, reason: 'no-bridge' });
    if (typeof vault.saveState === 'function') return Promise.resolve(vault.saveState(payload));
    if (typeof vault.write === 'function') return Promise.resolve(vault.write(payload));
    if (typeof vault.save === 'function') return Promise.resolve(vault.save(payload));
    return Promise.resolve({ ok: false, reason: 'no-method' });
  };

  function attachAutosave(store, options) {
    const o = options || {};
    const debounceMs = Number.isFinite(o.debounceMs) ? Math.max(0, o.debounceMs) : 800;
    const path = o.path == null ? 'workspace' : String(o.path);
    const save = typeof o.save === 'function' ? o.save : defaultSave;
    // Re-resolved on every save so a preload that lands AFTER the
    // editor attached (or a web fallback) can pick up a queued
    // payload instead of leaving it stranded offline forever.
    let activeBridge = resolveBridge(o.bridge);
    const schedule = typeof o.setTimeout === 'function' ? o.setTimeout : setTimeout;
    const cancel = typeof o.clearTimeout === 'function' ? o.clearTimeout : clearTimeout;
    const statuses = { idle: 'idle', pending: 'pending', saving: 'saving', saved: 'saved', error: 'error', offline: 'offline' };

    let timer = null;
    let inFlight = false;
    let dirtyPayload = null;
    let status = activeBridge ? statuses.idle : statuses.offline;
    let lastFingerprint = '';
    const history = [];
    const statusListeners = [];

    function payloadNow() {
      const snap = store.snapshot();
      const slice = path ? (function dig(obj) {
        const parts = path.split(POINTER_SEP).filter(Boolean);
        let cur = obj;
        for (let i = 0; i < parts.length; i++) {
          if (cur == null || typeof cur !== 'object') return undefined;
          cur = cur[parts[i]];
        }
        return cur;
      })(snap) : snap;
      return { path, savedAt: new Date().toISOString(), data: slice == null ? snap : slice };
    }

    function setStatus(next, detail) {
      status = next;
      history.push(next);
      const event = { status: next, detail: detail || null };
      store.emit('autosave', event);
      statusListeners.slice().forEach((cb) => {
        try { cb(next, detail || null); } catch (e) { /* status reporting never throws */ }
      });
      if (typeof o.onStatus === 'function') {
        try { o.onStatus(next, detail || null); } catch (e) { /* same */ }
      }
    }

    function run() {
      timer = null;
      if (inFlight) return Promise.resolve({ ok: false, reason: 'in-flight' });
      const payload = dirtyPayload || payloadNow();
      const fingerprint = JSON.stringify(payload.data);
      if (fingerprint === lastFingerprint) {
        dirtyPayload = null;
        setStatus(statuses.saved, { skipped: true });
        return Promise.resolve({ ok: true, skipped: true });
      }
      const live = resolveBridge(activeBridge);
      if (!live || !resolveVault(live)) {
        // keep the delta — flush()/setBridge() sends it once a
        // bridge exists
        dirtyPayload = payload;
        setStatus(statuses.offline, { queued: true });
        return Promise.resolve({ ok: false, reason: 'offline' });
      }
      inFlight = true;
      setStatus(statuses.saving, { bytes: fingerprint.length });
      return Promise.resolve()
        .then(() => save(live, payload))
        .then((result) => {
          inFlight = false;
          const ok = !result || result.ok !== false;
          if (ok) {
            lastFingerprint = fingerprint;
            dirtyPayload = null;
            setStatus(statuses.saved, { result });
            store.emit('autosave:saved', { payload, result });
          } else {
            dirtyPayload = payload;
            setStatus(statuses.error, { result });
          }
          return { ok, result };
        })
        .catch((err) => {
          inFlight = false;
          dirtyPayload = payload;
          setStatus(statuses.error, { error: String((err && err.message) || err) });
          return { ok: false, error: String((err && err.message) || err) };
        });
    }

    function scheduleRun() {
      dirtyPayload = payloadNow();
      setStatus(activeBridge ? statuses.pending : statuses.offline, { debounceMs });
      if (timer) cancel(timer);
      timer = schedule(() => { run(); }, debounceMs);
    }

    const off = store.onStateChange(path, () => { scheduleRun(); });

    return {
      status: () => status,
      history: () => history.slice(),
      pending: () => !!timer || inFlight || !!dirtyPayload,
      flush: () => { if (timer) { cancel(timer); timer = null; } return run(); },
      stop: () => { if (timer) { cancel(timer); timer = null; } off(); return status; },
      saveNow: () => run(),
      // late bridge binding: adopt a bridge that appeared after
      // attach and immediately drain anything queued
      setBridge: (next) => {
        activeBridge = next || null;
        if (activeBridge && dirtyPayload) return run();
        return Promise.resolve({ ok: false, reason: dirtyPayload ? 'no-bridge' : 'no-payload' });
      },
      hasBridge: () => !!resolveBridge(activeBridge),
      // status subscription for views (the pill below uses it)
      onStatus: (cb) => {
        if (typeof cb !== 'function') {
          const e = new Error('onStatus needs a callback');
          e.code = 'bad_input';
          throw e;
        }
        statusListeners.push(cb);
        return () => {
          const i = statusListeners.indexOf(cb);
          if (i > -1) statusListeners.splice(i, 1);
        };
      }
    };
  }

  // ============================================================
  // Optional status pill (the only DOM touchpoint in this file)
  // ============================================================

  const STATUS_LABEL = {
    idle: 'Ready', pending: 'Unsaved changes', saving: 'Saving…',
    saved: 'Saved', error: 'Save failed', offline: 'Offline — queued'
  };

  function mountStatus(rootEl, autosave, doc) {
    const d = doc || (typeof document !== 'undefined' ? document : null);
    if (!rootEl || !d) return null;
    const pill = d.createElement('span');
    pill.className = 'pai-autosave';
    pill.setAttribute('data-pai-autosave', '1');
    pill.setAttribute('role', 'status');
    pill.setAttribute('aria-live', 'polite');
    const dot = d.createElement('i');
    dot.className = 'pai-autosave__dot';
    const label = d.createElement('span');
    label.className = 'pai-autosave__label';
    pill.appendChild(dot);
    pill.appendChild(label);
    rootEl.appendChild(pill);
    const paint = (status) => {
      pill.setAttribute('data-status', status);
      pill.classList.toggle('is-error', status === 'error');
      pill.classList.toggle('is-offline', status === 'offline');
      label.textContent = STATUS_LABEL[status] || status;
    };
    paint(autosave.status());
    const unsub = typeof autosave.onStatus === 'function'
      ? autosave.onStatus((status) => paint(status))
      : () => {};
    return {
      el: pill,
      paint,
      update: () => paint(autosave.status()),
      destroy: () => { unsub(); if (pill.remove) pill.remove(); }
    };
  }

  // Autosave status pill styles. Every colour comes from the studio's
  // OKLCH token set (ui/runtime.js injects --pai-*), with an OKLCH
  // fallback inline so the pill is legible even before the runtime
  // palette lands. No hex, no rgb() — tokens only.
  const CSS = [
    '.pai-autosave{display:inline-flex;align-items:center;gap:6px;',
    'font:500 12px/1.2 var(--font,system-ui);color:var(--pai-text-muted,oklch(.72 .02 260))}',
    '.pai-autosave__dot{width:7px;height:7px;border-radius:50%;',
    'background:var(--pai-text-muted,oklch(.72 .02 260))}',
    '.pai-autosave[data-status=pending] .pai-autosave__dot,',
    '.pai-autosave[data-status=saving] .pai-autosave__dot{background:var(--pai-warn,oklch(.78 .15 85))}',
    '.pai-autosave[data-status=saved] .pai-autosave__dot{background:var(--pai-ok,oklch(.72 .17 150))}',
    '.pai-autosave[data-status=error] .pai-autosave__dot,',
    '.pai-autosave.is-error .pai-autosave__dot{background:var(--pai-error,oklch(.65 .2 25))}',
    '.pai-autosave[data-status=offline] .pai-autosave__dot,',
    '.pai-autosave.is-offline .pai-autosave__dot{background:var(--pai-border,oklch(.42 .02 260))}'
  ].join('');

  const api = {
    CSS,
    createStore,
    attachAutosave,
    mountStatus,
    resolveBridge,
    resolveVault,
    defaultSave,
    clonePlain
  };

  if (root) root.PallettAIState = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null));
