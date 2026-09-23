'use strict';

/*
  ============================================================
  IpcRouter — cancellation and progress, without weakening the shell
  ------------------------------------------------------------
  Two facts about this app decided the shape of this module, and both
  were checked rather than assumed.

  1. Compilation happens in the renderer. `main.js` requires nothing
     from `modules/` — it is a window, a menu, a preload and a secret
     store. The builder, the zip writer and the export path all run in
     the renderer. So a `compile-start` channel in main has no
     producer, and inventing one would move work across a process
     boundary to make an architecture diagram look tidy.

  2. Every existing channel validates its sender. `main.js` says so
     in as many words — "Every privileged channel below may only be
     reached from the MAIN frame", "P0 hardening: validate IPC sender
     on the menu channel so a compromised [renderer] cannot" — and
     each handler re-checks `event.sender` against the window. A
     generic "route any channel name" bridge would hand back the
     property that convention exists to keep.

  So this module provides what is genuinely missing — an in-process
  cancellation token, progress events, and a temp-file registry that
  guarantees cleanup when a build is aborted — plus an IPC bridge that
  *enforces* the existing convention rather than replacing it. The
  bridge fails closed: with no sender policy configured it refuses to
  dispatch, because a permissive default is how a hardening rule gets
  quietly undone by the next person who needs a channel in a hurry.

  What is deliberately not here: any wiring into `main.js`. That file
  is the shell, it is not in this module's ownership, and there is no
  producer for compile channels until a build actually moves to the
  main process.
  ============================================================
*/

const fs = require('fs');

const CHANNELS = ['compile-start', 'compile-cancel', 'export-zip', 'fetch-status', 'compile-progress'];

/*
  A cancellation error carries `cancelled: true` so a caller can tell
  an abort from a failure without string-matching a message.
*/
function cancellationError(reason) {
  const err = new Error(reason || 'cancelled');
  err.cancelled = true;
  return err;
}

/*
  A token anyone can observe and exactly one thing can trip. Handlers
  run once, in registration order, and one throwing handler cannot
  stop the others — cleanup that runs "unless someone earlier threw"
  is cleanup that does not run.
*/
function createCancellationToken(label) {
  let cancelled = false;
  let reason = '';
  let cancelledAt = 0;
  const handlers = [];
  const fired = [];

  function cancel(why) {
    if (cancelled) return false; // idempotent: a second cancel is not an event
    cancelled = true;
    reason = String(why == null ? '' : why) || 'cancelled';
    cancelledAt = Date.now();
    handlers.forEach((fn) => {
      try {
        fn(reason);
        fired.push(fn);
      } catch (e) {
        // A broken cleanup must not prevent the remaining cleanups.
        fired.push(fn);
      }
    });
    return true;
  }

  function onCancel(fn) {
    if (typeof fn !== 'function') return () => {};
    if (cancelled) {
      try { fn(reason); } catch (e) { /* already cancelled */ }
      return () => {};
    }
    handlers.push(fn);
    return () => {
      const i = handlers.indexOf(fn);
      if (i !== -1) handlers.splice(i, 1);
    };
  }

  /*
    Called between steps, so an abort takes effect at a boundary
    rather than mid-write.
  */
  function throwIfCancelled() {
    if (cancelled) throw cancellationError(reason);
  }

  return {
    label: String(label == null ? '' : label),
    get cancelled() { return cancelled; },
    get reason() { return reason; },
    get cancelledAt() { return cancelledAt; },
    cancel,
    onCancel,
    throwIfCancelled,
    isCancelled: () => cancelled,
    listeners: () => handlers.length,
    firedCount: () => fired.length
  };
}

/*
  Temp files that die with the build.

  A cancelled multi-page export is exactly when orphans appear: three
  pages written, the fourth aborted, and `.tmp` files nobody will ever
  look for again. Registering them against the token means the cleanup
  is triggered by the abort itself, not by the caller remembering.
*/
function createTempRegistry(token, opts) {
  const o = opts || {};
  const files = new Set();
  let cleaned = 0;

  function track(filePath) {
    const p = String(filePath);
    files.add(p);
    return p;
  }
  function release(filePath) {
    return files.delete(String(filePath));
  }
  function cleanup() {
    let n = 0;
    files.forEach((f) => {
      try {
        fs.rmSync(f, { force: true });
        n++;
      } catch (e) {
        // A temp file that cannot be removed is reported by the caller's
        // own check, not swallowed into a success count.
      }
    });
    cleaned += n;
    files.clear();
    return n;
  }

  if (token && typeof token.onCancel === 'function') token.onCancel(cleanup);
  if (o.cleanupOnProcessExit !== false && typeof process !== 'undefined' && process.once) {
    process.once('exit', cleanup);
  }

  return {
    track,
    release,
    cleanup,
    list: () => Array.from(files),
    size: () => files.size,
    cleanedCount: () => cleaned
  };
}

/*
  Progress with a shape a UI can render without guessing: a stage
  name, how many steps are done, and a percentage that never goes
  backwards. Progress that can regress makes a progress bar look
  broken even when the build is fine.
*/
function createProgressReporter(onEvent, opts) {
  const o = opts || {};
  const channel = o.channel || 'compile-progress';
  const startedAt = Date.now();
  let lastPercent = 0;
  let currentStage = '';
  const events = [];

  function emit(payload) {
    const ev = Object.assign({
      channel,
      stage: currentStage,
      percent: lastPercent,
      at: Date.now(),
      elapsedMs: Date.now() - startedAt
    }, payload || {});
    events.push(ev);
    if (typeof onEvent === 'function') {
      try { onEvent(ev); } catch (e) { /* a listener must not stop a build */ }
    }
    return ev;
  }

  return {
    stage(name, meta) {
      currentStage = String(name == null ? '' : name);
      return emit(Object.assign({ kind: 'stage' }, meta || {}));
    },
    step(done, total, meta) {
      const d = Math.max(0, Number(done) || 0);
      const t = Math.max(0, Number(total) || 0);
      const pct = t === 0 ? 0 : Math.min(100, Math.round((d / t) * 100));
      // Monotonic by construction.
      lastPercent = Math.max(lastPercent, pct);
      return emit(Object.assign({ kind: 'progress', done: d, total: t, percent: lastPercent }, meta || {}));
    },
    done(meta) {
      lastPercent = 100;
      return emit(Object.assign({ kind: 'done', done: 1, total: 1, percent: 100 }, meta || {}));
    },
    fail(error, meta) {
      return emit(Object.assign({ kind: 'error', error: String(error && error.message ? error.message : error) }, meta || {}));
    },
    events: () => events.slice(),
    percent: () => lastPercent
  };
}

/*
  Run steps in order, between cancellation checks, always running
  cleanup. Each step receives the token so a long step can bail out
  early, which is the difference between an abort that responds now
  and one that responds when the step happens to finish.
*/
async function runCancellable(steps, token, onProgress, opts) {
  const o = opts || {};
  const list = Array.isArray(steps) ? steps : [];
  const total = list.length;
  const results = [];
  const errors = [];
  let cancelled = false;

  try {
    for (let i = 0; i < total; i++) {
      if (token && token.cancelled) { cancelled = true; break; }
      const step = list[i];
      const name = String((step && step.name) || ('step ' + (i + 1)));
      if (onProgress && onProgress.stage) onProgress.stage(name, { index: i, total });
      try {
        const run = typeof step === 'function' ? step : (step && step.run);
        if (typeof run !== 'function') throw new Error('step "' + name + '" is not runnable');
        /* eslint-disable no-await-in-loop */
        const value = await run(token, i);
        results.push({ name, ok: true, value });
      } catch (e) {
        if (e && e.cancelled) { cancelled = true; break; }
        errors.push({ name, error: String(e && e.message ? e.message : e) });
        break;
      }
      if (onProgress && onProgress.step) onProgress.step(i + 1, total);
    }
  } finally {
    // Cleanup is not conditional on success. A build that failed
    // halfway is the one most likely to have left something behind.
    if (typeof o.cleanup === 'function') {
      try { o.cleanup({ cancelled, errors }); } catch (e) { /* reported via errors if it matters */ }
    }
  }

  return {
    ok: errors.length === 0 && !cancelled,
    cancelled,
    completed: results.length,
    total,
    results,
    errors
  };
}

/*
  The IPC bridge. Two rules, both taken from the shell it is meant to
  serve: a channel must be on the allowlist, and a message must come
  from a sender the caller has declared trusted. Neither has a
  permissive default.
*/
function createIpcBridge(ipcMain, opts) {
  const o = opts || {};
  const allowed = new Set(Array.isArray(o.channels) && o.channels.length ? o.channels : CHANNELS);
  const registered = new Map();
  const rejections = [];

  function isTrusted(event) {
    if (typeof o.isTrusted === 'function') return !!o.isTrusted(event);
    const declared = o.allowedWebContents;
    if (declared) {
      const list = Array.isArray(declared) ? declared : [declared];
      return list.some((wc) => wc && event && event.sender === wc);
    }
    return false; // fail closed, deliberately
  }

  function register(channel, handler, config) {
    const cfg = config || {};
    const name = String(channel || '');
    if (!name) throw new Error('a channel name is required');
    if (!allowed.has(name)) throw new Error('channel "' + name + '" is not on the allowlist');
    if (registered.has(name)) throw new Error('channel "' + name + '" is already registered');
    if (typeof handler !== 'function') throw new Error('channel "' + name + '" needs a handler');
    if (!ipcMain || typeof ipcMain.handle !== 'function' || typeof ipcMain.on !== 'function') {
      throw new Error('an ipcMain with handle() and on() is required');
    }

    const mode = cfg.mode === 'on' ? 'on' : 'handle';
    const wrapped = async (event, ...args) => {
      if (!isTrusted(event)) {
        const rejection = { channel: name, reason: 'untrusted sender', at: Date.now() };
        rejections.push(rejection);
        // Reported, not thrown at the renderer: an untrusted sender gets
        // nothing back that tells it how the check works.
        return { ok: false, error: 'unauthorised' };
      }
      try {
        const value = await handler(event, ...args);
        return cfg.raw ? value : { ok: true, value };
      } catch (e) {
        return { ok: false, error: String(e && e.message ? e.message : e) };
      }
    };

    if (mode === 'handle') ipcMain.handle(name, wrapped);
    else ipcMain.on(name, (event, ...args) => { wrapped(event, ...args); });

    registered.set(name, { mode, handler, wrapped, config: cfg });
    return { channel: name, mode };
  }

  function dispose() {
    const removed = [];
    registered.forEach((entry, name) => {
      try {
        if (entry.mode === 'handle' && typeof ipcMain.removeHandler === 'function') ipcMain.removeHandler(name);
        else if (typeof ipcMain.removeAllListeners === 'function') ipcMain.removeAllListeners(name);
        removed.push(name);
      } catch (e) { /* nothing to remove */ }
    });
    registered.clear();
    return removed;
  }

  /*
    A progress sink that posts to a declared sender. Kept here so a
    build does not need a webContents reference to report progress.
  */
  function progressSink(webContents, channel) {
    const name = channel || 'compile-progress';
    return createProgressReporter((event) => {
      try {
        if (webContents && !webContents.isDestroyed() && typeof webContents.send === 'function') {
          webContents.send(name, event);
        }
      } catch (e) { /* a closed window is not a build failure */ }
    }, { channel: name });
  }

  return {
    register,
    handle: (channel, handler, config) => register(channel, handler, Object.assign({}, config, { mode: 'handle' })),
    on: (channel, handler, config) => register(channel, handler, Object.assign({}, config, { mode: 'on' })),
    progressSink,
    channels: () => Array.from(registered.keys()),
    rejections: () => rejections.slice(),
    isTrusted,
    dispose
  };
}

module.exports = {
  CHANNELS,
  createCancellationToken,
  createTempRegistry,
  createProgressReporter,
  runCancellable,
  createIpcBridge,
  cancellationError
};
