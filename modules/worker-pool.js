'use strict';

/*
  ============================================================
  WorkerPool — CPU work off the thread that has to stay responsive
  ------------------------------------------------------------
  Minifying forty pages, hashing every asset and cleaning every SVG
  is seconds of solid CPU. On the thread that draws the window, that
  is a frozen app, and no amount of `await` fixes it: the work is
  arithmetic, not I/O.

  The pool is a single file. A worker is started from this module's own
  path with `workerData`, so there is no second script to keep in sync
  and no build step to emit one — and the file is a valid module
  whether it is required or executed as a worker, which is checked
  rather than assumed via `isMainThread`.

  Three rules the implementation keeps:

  1. A task error is not a worker error. A task that throws is a
     deterministic answer — retrying it on another thread returns the
     same exception, twice, more slowly. Only a worker that *dies*
     (segfault, OOM, killed) gets its task retried, because that is the
     failure a different thread can actually survive.

  2. No thread pool is not a failure. `worker_threads` needs Node; a
     renderer does not have it and an older build may not either. When
     it is missing, or when a pool cannot start, work runs inline and
     the result says so, rather than throwing a capability error at a
     user who only wanted a smaller export.

  3. Shutdown is not optional. A build that finishes with workers still
     alive keeps the process from exiting, which in an Electron app
     means the app never quits. Termination resolves in-flight tasks as
     cancelled instead of leaving their promises pending forever.

  The task types registered here are the pure ones this codebase
  already has: hashing, minification and SVG optimisation. The site
  builder is deliberately not among them — it reads renderer globals,
  so moving it into a worker would mean shimming an app's worth of
  context into a thread to save a fraction of a second.
  ============================================================
*/

const path = require('path');

let Worker = null;
let isMainThread = true;
let parentPort = null;
let workerData = null;
try {
  const wt = require('worker_threads');
  Worker = wt.Worker;
  isMainThread = wt.isMainThread;
  parentPort = wt.parentPort;
  workerData = wt.workerData;
} catch (e) {
  Worker = null;
}

let Minifier = null;
let Assets = null;
function loadTasks() {
  if (!Minifier) {
    try { Minifier = require(path.join(__dirname, 'minifier.js')); } catch (e) { Minifier = null; }
  }
  if (!Assets) {
    try { Assets = require(path.join(__dirname, 'asset-pipeline.js')); } catch (e) { Assets = null; }
  }
}

// ---------------------------------------------------------------
// The task registry — the same code runs on both sides, so a task
// cannot behave differently in a worker than it does inline.
// ---------------------------------------------------------------
const TASKS = {
  hash(payload) {
    loadTasks();
    const crypto = require('crypto');
    const algorithm = (payload && payload.algorithm) || 'sha256';
    const input = payload && payload.content != null ? payload.content : '';
    const buffer = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
    return { digest: crypto.createHash(algorithm).update(buffer).digest('hex'), algorithm, bytes: buffer.length };
  },
  'minify-html': (payload) => {
    loadTasks();
    if (!Minifier) throw new Error('the minifier is unavailable');
    const before = String((payload && payload.content) || '');
    const after = Minifier.minifyHTML(before, payload && payload.options);
    return { content: after, stats: Minifier.measure(before, after) };
  },
  'minify-css': (payload) => {
    loadTasks();
    if (!Minifier) throw new Error('the minifier is unavailable');
    const before = String((payload && payload.content) || '');
    const after = Minifier.minifyCSS(before);
    return { content: after, stats: Minifier.measure(before, after) };
  },
  'minify-js': (payload) => {
    loadTasks();
    if (!Minifier) throw new Error('the minifier is unavailable');
    const before = String((payload && payload.content) || '');
    const after = Minifier.minifyJS(before);
    return { content: after, stats: Minifier.measure(before, after) };
  },
  'optimize-svg': (payload) => {
    loadTasks();
    if (!Assets) throw new Error('the asset pipeline is unavailable');
    return Assets.optimizeInlineSVGs(String((payload && payload.content) || ''), payload && payload.options);
  }
};

function taskTypes() {
  return Object.keys(TASKS);
}

// ---------------------------------------------------------------
// Worker side
// ---------------------------------------------------------------
if (!isMainThread && parentPort) {
  parentPort.on('message', async (message) => {
    const { id, taskType, payload } = message || {};
    try {
      const run = TASKS[taskType];
      if (!run) throw new Error('unknown task type "' + taskType + '"');
      const result = run(payload);
      parentPort.postMessage({ id, ok: true, result, taskType });
    } catch (e) {
      parentPort.postMessage({ id, ok: false, error: String(e && e.message ? e.message : e), taskType });
    }
  });
}

// ---------------------------------------------------------------
// Main side
// ---------------------------------------------------------------
const pool = {
  workers: [],
  idle: [],
  queue: [],
  inFlight: new Map(),
  seq: 0,
  taskCount: 0,
  completed: 0,
  failed: 0,
  retried: 0,
  retiredWorkers: 0,
  startedAt: 0,
  active: false,
  size: 0
};

function spawnWorker() {
  const w = new Worker(__filename, { workerData: { mode: 'worker' } });
  w.__busy = null;
  w.on('message', (msg) => onWorkerMessage(w, msg));
  w.on('error', (err) => onWorkerDeath(w, err && err.message ? err.message : String(err)));
  w.on('exit', (code) => {
    if (code !== 0 && pool.workers.indexOf(w) !== -1) onWorkerDeath(w, 'worker exited with code ' + code);
    else removeWorker(w);
  });
  return w;
}

function removeWorker(w) {
  const i = pool.workers.indexOf(w);
  if (i !== -1) pool.workers.splice(i, 1);
  const j = pool.idle.indexOf(w);
  if (j !== -1) pool.idle.splice(j, 1);
}

/*
  A worker died holding a task. That is the one failure worth retrying:
  the task itself may be perfectly fine, and a fresh thread may survive
  whatever killed the last one.
*/
function onWorkerDeath(w, reason) {
  const held = w.__busy;
  w.__busy = null;
  removeWorker(w);
  pool.retiredWorkers++;
  if (held) {
    const entry = pool.inFlight.get(held.id);
    if (entry && entry.attempts <= entry.maxAttempts) {
      pool.retried++;
      entry.attempts++;
      pool.queue.unshift({ id: held.id, taskType: held.taskType, payload: held.payload, attempts: entry.attempts, maxAttempts: entry.maxAttempts, resolve: entry.resolve, reject: entry.reject });
      pump();
      return;
    }
    if (entry) {
      pool.inFlight.delete(held.id);
      pool.failed++;
      entry.reject(new Error('the worker died: ' + reason));
    }
  }
  // Keep the pool at its requested size while it is meant to be running.
  if (pool.active && pool.workers.length < pool.size) pool.workers.push(spawnWorker());
  pump();
}

function onWorkerMessage(w, msg) {
  const id = msg && msg.id;
  const entry = pool.inFlight.get(id);
  if (entry) {
    pool.inFlight.delete(id);
    if (msg.ok) {
      pool.completed++;
      entry.resolve({ ok: true, result: msg.result, taskType: msg.taskType, worker: w.threadId });
    } else {
      // A task-level error: deterministic, so it is returned, not retried.
      pool.failed++;
      entry.resolve({ ok: false, error: msg.error, taskType: msg.taskType, worker: w.threadId });
    }
  }
  const held = w.__busy;
  w.__busy = null;
  if (!held && pool.idle.indexOf(w) === -1 && pool.workers.indexOf(w) !== -1) pool.idle.push(w);
  pump();
}

function pump() {
  while (pool.queue.length) {
    let w = pool.idle.pop();
    if (!w) {
      // A dead worker may have been replaced without joining the idle list.
      w = pool.workers.find((x) => !x.__busy && pool.idle.indexOf(x) === -1);
    }
    if (!w) return;
    const task = pool.queue.shift();
    w.__busy = task;
    pool.inFlight.set(task.id, task);
    pool.taskCount++;
    try {
      w.postMessage({ id: task.id, taskType: task.taskType, payload: task.payload });
    } catch (e) {
      onWorkerDeath(w, String(e && e.message ? e.message : e));
    }
  }
}

/*
  Start the pool. `workerCount` defaults to one fewer than the cores
  available, because saturating every core makes the machine unusable
  for the person watching the progress bar.
*/
function initWorkerPool(workerCount, opts) {
  const o = opts || {};
  const cores = (() => {
    try { return require('os').cpus().length; } catch (e) { return 2; }
  })();
  const size = Math.max(1, Math.floor(Number(workerCount) || Math.max(1, cores - 1)));

  if (!Worker || typeof Worker !== 'function') {
    return { ok: false, inline: true, size: 0, reason: 'worker_threads is unavailable in this runtime — tasks will run inline', cores };
  }
  if (pool.active) return { ok: true, inline: false, size: pool.workers.length, reused: true, cores };

  pool.size = size;
  pool.active = true;
  pool.startedAt = Date.now();
  for (let i = 0; i < size; i++) {
    const w = spawnWorker();
    pool.workers.push(w);
    pool.idle.push(w);
  }
  if (o.onReady) o.onReady({ size, cores });
  return { ok: true, inline: false, size, cores, taskTypes: taskTypes() };
}

/*
  Queue a task. Resolves with `{ok, result}` for a task-level outcome —
  including a task that threw, because that is an answer — and rejects
  only when the work could not be attempted at all.
*/
async function dispatchTask(taskType, payload, opts) {
  const o = opts || {};
  const type = String(taskType || '');
  if (!TASKS[type]) {
    return { ok: false, error: 'unknown task type "' + type + '"', available: taskTypes() };
  }

  if (!pool.active) {
    // No pool: do it here, and say that is what happened.
    if (o.inlineFallback === false) return { ok: false, error: 'the worker pool is not running' };
    try {
      const result = TASKS[type](payload);
      return { ok: true, result, taskType: type, inline: true };
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e), taskType: type, inline: true };
    }
  }

  const id = ++pool.seq;
  const maxAttempts = Math.max(1, Number(o.retries) || 2);
  return new Promise((resolve, reject) => {
    const entry = { id, taskType: type, payload, attempts: 1, maxAttempts, resolve, reject };
    pool.inFlight.set(id, entry);
    pool.queue.push(entry);
    pump();
  });
}

/*
  Run many tasks with bounded concurrency and a stable result order.
  Order matters to a caller assembling pages: a shuffled array would
  silently reorder sections.
*/
async function dispatchBatch(jobs, opts) {
  const o = opts || {};
  const list = Array.isArray(jobs) ? jobs : [];
  const limit = Math.max(1, Math.floor(Number(o.concurrency) || pool.size || 1));
  const results = new Array(list.length);
  let next = 0;

  async function runner() {
    for (;;) {
      const i = next++;
      if (i >= list.length) return;
      const job = list[i];
      if (o.token && o.token.cancelled) { results[i] = { ok: false, cancelled: true }; continue; }
      /* eslint-disable no-await-in-loop */
      results[i] = await dispatchTask(job.taskType, job.payload, o);
      if (o.onEach) o.onEach(i, results[i], list.length);
    }
  }

  const runners = [];
  for (let i = 0; i < Math.min(limit, list.length || 1); i++) runners.push(runner());
  await Promise.all(runners);
  return { ok: results.every((r) => r && r.ok), results, count: list.length };
}

/*
  Shut down. In-flight promises are resolved as cancelled rather than
  left pending — a promise that never settles is a build that never
  finishes, and the app that never quits that follows from it.
*/
async function terminateWorkerPool(opts) {
  const o = opts || {};
  const workers = pool.workers.slice();
  const pending = Array.from(pool.inFlight.values());

  pool.inFlight.clear();
  pool.queue.length = 0;
  pool.idle.length = 0;
  pool.workers.length = 0;
  pool.active = false;

  pending.forEach((entry) => {
    try { entry.resolve({ ok: false, cancelled: true, error: o.reason || 'the pool was shut down' }); } catch (e) { /* already settled */ }
  });

  await Promise.all(workers.map((w) => new Promise((resolve) => {
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(); } };
    w.once('exit', done);
    try {
      w.terminate().then(done).catch(done);
    } catch (e) {
      done();
    }
    // A worker that will not exit must not hold the process open.
    setTimeout(done, 2000).unref && setTimeout(done, 2000).unref();
  })));

  return { ok: true, terminated: workers.length, cancelled: pending.length };
}

function poolStats() {
  return {
    active: pool.active,
    size: pool.size,
    live: pool.workers.length,
    idle: pool.idle.length,
    queued: pool.queue.length,
    inFlight: pool.inFlight.size,
    dispatched: pool.taskCount,
    completed: pool.completed,
    failed: pool.failed,
    retried: pool.retried,
    retiredWorkers: pool.retiredWorkers,
    uptimeMs: pool.startedAt ? Date.now() - pool.startedAt : 0,
    taskTypes: taskTypes()
  };
}

module.exports = {
  isMainThread,
  taskTypes,
  TASKS,
  initWorkerPool,
  dispatchTask,
  dispatchBatch,
  terminateWorkerPool,
  poolStats
};
