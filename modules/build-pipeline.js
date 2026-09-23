'use strict';
// ============================================================
// PallettAI Studio — multithreaded parallel build pipeline
// Full-site generation spread across Node.js worker_threads so a
// build saturates every core instead of alternating between DOM
// compilation, CSS minification and asset hashing on one thread.
// ------------------------------------------------------------
//   1. executeParallelBuild(siteSchema, workerCount='auto', options)
//        → {report, results, telemetry}
//      Builds a job queue (page render / css minify / asset hash),
//      splits it round-robin across the pool, runs each bin on its
//      own thread and collects results + per-worker memory.
//      options: {minify=true, cores, freeMem, totalMem,
//                perWorkerBytes, onProgress, executor, timeoutMs}
//      `executor` is the injection seam: the smoke runner replaces
//      the thread pool with an in-process implementation and the
//      scheduler/telemetry code under test stays identical.
//   2. manageWorkerLifecycle(jobQueue, options) → {size, cores,
//      byCores, byMemory, limit, starved, ...} — pool sizing driven
//      by CPU core count AND a memory budget computed as a share of
//      TOTAL memory (see guarantee 3) with a starved floor; explicit
//      overrides make the decision deterministic under test.
//   3. Real-time telemetry: onProgress fires per completed job with
//      {completionRate, pagesPerSec, perWorker:{done,memBytes}} so
//      a host UI can render render-completion, thread memory and
//      throughput live.
//
// ---- what this file guarantees ----------------------------------
// 1. THE WORKER RUNS THE SAME CODE AS THE MAIN THREAD: the task
//    runner is serialized with Function.prototype.toString into an
//    eval-mode worker — one source, no drift, no external worker
//    file to ship or resolve.
// 2. A CRASHING JOB CANNOT KILL THE BUILD: every job runs inside
//    try/catch in the worker (and in the fallback executor);
//    failures land in report.errors and the rest of the site still
//    builds. A wedged worker is terminated at timeoutMs.
// 3. POOL SIZE IS ALWAYS 1..jobs: 'auto' consults cores and a
//    memory budget of DEFAULT_MEM_SHARE (25%) of TOTAL memory at
//    192MB/worker. Free memory is deliberately NOT the cap — an OS
//    that counts file cache as used reports an idle box as nearly
//    full, which would silently shrink a parallel build to one
//    thread. Free memory only decides the starved floor: less free
//    than one worker's budget → run a single thread rather than
//    push the box into swap.
// 4. RESULTS ARE DETERMINISTIC: jobs are pure functions of their
//    input, so two builds of the same schema produce byte-identical
//    output regardless of worker count or completion order.
// 5. THE CSS MINIFIER NEVER TOUCHES STRING CONTENT: a quote-aware
//    scanner strips comments and collapses whitespace, so
//    content:"/* not a comment */" survives verbatim.
// ============================================================

const { Worker } = require('worker_threads');
const os = require('os');
const crypto = require('crypto');

const DEFAULT_PER_WORKER_BYTES = 192 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30000;
// The pool may claim this share of TOTAL memory. See manageWorkerLifecycle
// for why the budget is a share of total rather than of "free".
const DEFAULT_MEM_SHARE = 0.25;

// ============================================================
// Task primitives — serialized verbatim into the worker, so both
// sides reference only each other (no module-scope closure).
// ============================================================

/**
 * minifyCss(css) — quote-aware comment stripping + whitespace
 * collapse. Collapses runs outside strings; drops spaces that
 * touch combinators/punctuation so `color : red ;` → `color:red;`
 */
function minifyCss(css) {
  const src = String(css == null ? '' : css);
  let out = '';
  let i = 0;
  let quote = '';
  const PUNCT = '{};:,>~+';
  while (i < src.length) {
    const c = src[i];
    if (quote) {
      out += c;
      if (c === '\\' && i + 1 < src.length) { out += src[i + 1]; i += 2; continue; }
      if (c === quote) quote = '';
      i++;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; out += c; i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f') {
      while (i < src.length && /\s/.test(src[i])) i++;
      const prev = out[out.length - 1];
      const next = src[i];
      if (prev && next
        && PUNCT.indexOf(prev) === -1 && PUNCT.indexOf(next) === -1) out += ' ';
      continue;
    }
    out += c;
    i++;
  }
  return out.trim();
}

/**
 * runTask(job) — the single unit of build work.
 * job = {id, kind: 'page'|'css'|'asset', data}
 * Kinds:
 *   page  → full static HTML document string
 *   css   → minified stylesheet (scanner above)
 *   asset → {id, bytes, sha256} (utf8 content hashed)
 */
function runTask(job) {
  if (!job || !job.kind) throw new Error('job.kind is required');
  if (job.kind === 'page') {
    const p = job.data || {};
    const esc = (s) => String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    return '<!doctype html>\n<html lang="en">\n<head>\n'
      + '<meta charset="utf-8">\n'
      + '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
      + '<title>' + esc(p.title || p.id) + '</title>\n'
      + (p.head ? String(p.head) + '\n' : '')
      + '</head>\n<body>\n'
      + (p.html == null ? '' : String(p.html))
      + '\n</body>\n</html>\n';
  }
  if (job.kind === 'css') return minifyCss(job.data && job.data.css);
  if (job.kind === 'asset') {
    const nodeCrypto = require('crypto');
    const buf = Buffer.from(job.data && job.data.data != null ? job.data.data : '', 'utf8');
    return {
      id: job.data && job.data.id,
      bytes: buf.length,
      sha256: nodeCrypto.createHash('sha256').update(buf).digest('hex')
    };
  }
  throw new Error('unknown job kind: ' + job.kind);
}

// both primitives, serialized together so runTask can call
// minifyCss inside the worker without a module-scope closure
const TASK_SRC = minifyCss.toString() + '\n' + runTask.toString();

// ============================================================
// Job queue + distribution (pure, exported for tests)
// ============================================================

function asArray(v) { return Array.isArray(v) ? v : []; }

/**
 * buildJobQueue(schema, {minify=true}) → jobs in a stable order:
 * pages, then styles (minify jobs only when enabled), then assets.
 */
function buildJobQueue(schema, options) {
  const o = options || {};
  const s = schema && typeof schema === 'object' ? schema : {};
  const queue = [];
  asArray(s.pages).forEach((p) => {
    queue.push({ id: 'page:' + p.id, kind: 'page', data: p });
  });
  if (o.minify !== false) {
    asArray(s.styles).forEach((st) => {
      queue.push({ id: 'css:' + st.id, kind: 'css', data: st });
    });
  }
  asArray(s.assets).forEach((a) => {
    queue.push({ id: 'asset:' + a.id, kind: 'asset', data: a });
  });
  return queue;
}

/**
 * distributeJobs(queue, n) — round-robin bins. Guarantees: every
 * job in exactly one bin, |bin sizes| ≤ 1, order preserved.
 */
function distributeJobs(queue, n) {
  const bins = [];
  const workers = Math.max(1, Math.floor(Number(n) || 1));
  for (let i = 0; i < workers; i++) bins.push([]);
  queue.forEach((job, i) => { bins[i % workers].push(job); });
  return bins;
}

// ============================================================
// Pool sizing
// ============================================================

/**
 * manageWorkerLifecycle(jobQueue, options) → {size, jobs, cores,
 * byCores, byMemory, limit}
 * limit = 'cores' | 'memory' | 'jobs' | 'idle' — which constraint
 * decided the size (idle: nothing to do).
 */
function manageWorkerLifecycle(jobQueue, options) {
  const o = options || {};
  const jobs = Array.isArray(jobQueue) ? jobQueue.length
    : (jobQueue && typeof jobQueue.length === 'number' ? jobQueue.length : 0);
  const cores = Math.max(1, Number.isFinite(Number(o.cores))
    ? Math.floor(Number(o.cores)) : ((os.cpus() || []).length || 1));
  const totalMem = Number.isFinite(Number(o.totalMem)) ? Number(o.totalMem) : os.totalmem();
  const freeMem = Number.isFinite(Number(o.freeMem)) ? Number(o.freeMem)
    : Math.min(os.freemem(), totalMem);
  const perWorker = Number.isFinite(Number(o.perWorkerBytes)) && Number(o.perWorkerBytes) > 0
    ? Number(o.perWorkerBytes) : DEFAULT_PER_WORKER_BYTES;

  const share = Number.isFinite(Number(o.memShare)) && Number(o.memShare) > 0
    ? Number(o.memShare) : DEFAULT_MEM_SHARE;

  if (jobs === 0) {
    return { size: 0, jobs: 0, cores, byCores: 0, byMemory: 0, limit: 'idle', totalMem, freeMem, perWorker, starved: false };
  }
  const byCores = Math.min(jobs, cores);
  /*
    The budget is a share of TOTAL memory, not of free memory.

    Measuring this on the machine this was written on: a 32 GB box
    reported 657 MB free — two percent — because macOS and Windows count
    reclaimable file cache as used. A cap of `floor(free / perWorker)`
    therefore reads the machine as nearly full when it is idle, and with a
    per-worker budget above the free figure it collapses the pool to a
    single thread: the parallel build silently becomes a serial one, which
    looks like a working build that happens to be slow. Total memory is
    stable and is the honest ceiling on what the pool may claim; free
    memory is kept only as a last-resort floor, below.
  */
  const byMemory = Math.min(jobs, Math.max(1, Math.floor((totalMem * share) / perWorker)));
  let size = Math.min(byCores, byMemory);
  let limit = byCores <= byMemory ? 'cores' : 'memory';
  // The floor case, measured against the per-worker budget rather than a
  // fixed number, so a machine with ample RAM is never throttled on
  // principle: it bites only when there is not even one worker's worth
  // free, which is the one case where a thread can push a box into swap.
  const starved = freeMem > 0 && freeMem < perWorker;
  if (starved && size > 1) { size = 1; limit = 'memory'; }
  return { size, jobs, cores, byCores, byMemory, limit, totalMem, freeMem, perWorker, starved };
}

// ============================================================
// Telemetry
// ============================================================

/**
 * createTelemetry(total, onProgress) → live counters. snapshot()
 * is pure JSON: completion rate, throughput (jobs/sec), per-worker
 * completion + last reported thread memory.
 */
function createTelemetry(total, onProgress) {
  const started = Date.now();
  const workers = Object.create(null);
  let done = 0;
  let failed = 0;
  const record = (workerId, ok, memBytes) => {
    const w = String(workerId);
    if (!workers[w]) workers[w] = { done: 0, failed: 0, memBytes: 0 };
    if (ok) { done++; workers[w].done++; } else { failed++; workers[w].failed++; }
    if (Number.isFinite(memBytes)) workers[w].memBytes = memBytes;
    if (typeof onProgress === 'function') onProgress(snapshot());
  };
  const snapshot = () => {
    const elapsedMs = Date.now() - started;
    const unit = Math.max(1, elapsedMs);
    const perWorker = {};
    let memTotal = 0;
    Object.keys(workers).forEach((k) => {
      perWorker[k] = {
        done: workers[k].done,
        failed: workers[k].failed,
        memBytes: workers[k].memBytes
      };
      memTotal += workers[k].memBytes;
    });
    return {
      total,
      done,
      failed,
      elapsedMs,
      completionRate: total > 0 ? done / total : 1,
      // jobs per second — throughput metric
      throughput: Math.round(((done + failed) * 1000 / unit) * 100) / 100,
      workers: Object.keys(workers).length,
      memBytes: memTotal,
      perWorker
    };
  };
  return { record, snapshot };
}

// ============================================================
// Worker execution
// ============================================================

function workerSource() {
  return 'const {parentPort, workerData} = require("worker_threads");\n'
    + 'const __out = [];\n'
    + 'try {\n'
    + '  for (const job of workerData) {\n'
    + '    try {\n'
    + '      __out.push({id: job.id, ok: true, value: runTask(job)});\n'
    + '    } catch (e) {\n'
    + '      __out.push({id: job.id, ok: false, error: String((e && e.message) || e)});\n'
    + '    }\n'
    + '  }\n'
    + '  parentPort.postMessage({results: __out, memBytes: process.memoryUsage().heapUsed});\n'
    + '} catch (e) {\n'
    + '  parentPort.postMessage({fatal: String((e && e.message) || e)});\n'
    + '}\n'
    + 'parentPort.close();\n'
    + TASK_SRC;
}

/** Run one bin on its own thread. Resolves {results, memBytes}. */
function runBinOnThread(bin, timeoutMs) {
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(workerSource(), { eval: true, workerData: bin });
    } catch (e) { reject(e); return; }
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      worker.terminate();
      reject(new Error('worker timeout after ' + timeoutMs + 'ms'));
    }, timeoutMs);
    worker.once('message', (msg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      if (msg && msg.fatal) reject(new Error(msg.fatal));
      else resolve(msg || { results: [] });
    });
    worker.once('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

// ============================================================
// executeParallelBuild
// ============================================================

/** In-process executor — same contract as the thread pool, for
 *  single-threaded runs and tests (exported for reuse). */
function localExecutor(bin) {
  return Promise.resolve({
    results: bin.map((job) => {
      try { return { id: job.id, ok: true, value: runTask(job) }; }
      catch (e) { return { id: job.id, ok: false, error: String((e && e.message) || e) }; }
    }),
    memBytes: process.memoryUsage().heapUsed
  });
}

async function executeParallelBuild(siteSchema, workerCount, options) {
  const opts = options || {};
  const wc = workerCount == null ? 'auto' : workerCount;
  if (!siteSchema || typeof siteSchema !== 'object' || !Array.isArray(siteSchema.pages)) {
    const e = new Error('siteSchema.pages must be an array');
    e.code = 'bad_input';
    throw e;
  }
  const minify = opts.minify !== false;
  const queue = buildJobQueue(siteSchema, { minify });

  let size;
  if (wc === 'auto') {
    size = manageWorkerLifecycle(queue, opts).size;
  } else {
    const n = Math.floor(Number(wc));
    if (!Number.isFinite(n) || n < 1) {
      const e = new Error('workerCount must be "auto" or a positive integer');
      e.code = 'bad_input';
      throw e;
    }
    size = Math.max(1, Math.min(n, Math.max(1, queue.length)));
  }
  if (queue.length === 0) size = 0;

  const telemetry = createTelemetry(queue.length, opts.onProgress);
  const bins = distributeJobs(queue, size || 1);
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
  // true seam: an injected executor is CALLED (bin, workerId) and
  // must resolve {results, memBytes}; null → real worker threads
  const executor = typeof opts.executor === 'function' ? opts.executor : null;

  const byId = {};
  queue.forEach((j) => { byId[j.id] = j; });
  const results = { pages: {}, styles: {}, assets: {}, errors: [] };

  const ingest = (workerId, bin, raw) => {
    const list = (raw && raw.results) || [];
    const mem = raw && Number.isFinite(raw.memBytes) ? raw.memBytes : 0;
    const seen = new Set();
    list.forEach((r) => {
      seen.add(r.id);
      const job = byId[r.id];
      const ok = r.ok === true;
      // telemetry counts every reported job exactly once (done OR
      // failed — never both)
      telemetry.record(workerId, ok, mem);
      if (!job) return;
      if (ok) {
        if (job.kind === 'page') results.pages[job.data.id] = r.value;
        else if (job.kind === 'css') results.styles[job.data.id] = r.value;
        else if (job.kind === 'asset') results.assets[job.data.id] = r.value;
      } else {
        results.errors.push({ id: r.id, error: r.error || 'unknown error' });
      }
    });
    // invariant: every queued job ends counted exactly once — a
    // fatal/empty/partial worker response can never make the
    // report claim work it did not do
    const why = (raw && raw.fatal) || 'missing result from worker';
    bin.forEach((j) => {
      if (seen.has(j.id)) return;
      results.errors.push({ id: j.id, error: why });
      telemetry.record(workerId, false, 0);
    });
  };

  const active = bins
    .map((bin, i) => ({ bin, workerId: 'w' + i }))
    .filter((b) => b.bin.length > 0);

  await Promise.all(active.map(async ({ bin, workerId }) => {
    try {
      const raw = executor
        ? await executor(bin, workerId)
        : await runBinOnThread(bin, timeoutMs);
      ingest(workerId, bin, raw);
    } catch (e) {
      bin.forEach((j) => {
        results.errors.push({ id: j.id, error: String((e && e.message) || e) });
        telemetry.record(workerId, false, 0);
      });
    }
  }));

  /*
    Rebuild the result buckets in QUEUE order.

    Results arrive as each worker finishes, so the insertion order of these
    objects tracked completion order rather than build order: a four-worker
    run of the same schema produced keys a,d,c,b where a one-worker run
    produced a,b,c,d. The values were identical, but the serialized output
    was not — and this module's own guarantee is byte-identical output
    regardless of worker count or completion order. Writing the site by
    iterating these keys would have ordered files by whichever thread won,
    which is a race in a build that claims to be deterministic.
  */
  const reorder = (bucket, kind) => {
    const out = {};
    queue.forEach((job) => {
      if (job.kind !== kind) return;
      const id = job.data && job.data.id;
      if (Object.prototype.hasOwnProperty.call(bucket, id)) out[id] = bucket[id];
    });
    return out;
  };
  results.pages = reorder(results.pages, 'page');
  results.styles = reorder(results.styles, 'css');
  results.assets = reorder(results.assets, 'asset');

  const snap = telemetry.snapshot();
  return {
    report: Object.assign({}, snap, {
      workers: active.length,
      minify,
      ok: results.errors.length === 0
    }),
    results,
    telemetry: snap
  };
}

module.exports = {
  DEFAULT_PER_WORKER_BYTES,
  minifyCss,
  runTask,
  buildJobQueue,
  distributeJobs,
  manageWorkerLifecycle,
  createTelemetry,
  localExecutor,
  executeParallelBuild
};
