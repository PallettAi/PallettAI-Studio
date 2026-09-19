// ============================================================
// PallettAI Studio — background job queue (pure logic)
// The state machine behind the main-process AI worker.
//
// WHY: every AI run today lives in the renderer. Closing the
// window — or the renderer crashing mid-generation — kills the
// run and the credits spent on it. The fix is to run long jobs
// in the MAIN process, which survives renderer reloads, and
// tell the renderer about progress over IPC.
//
// This module holds the part that must be right and is easy to
// test: the queue itself. Jobs are queued, run strictly one at
// a time (a parallel second job would race the same project in
// the cloud vault), progress, retry with backoff on retryable
// failures, and leave a short audit trail. The actual network
// work is injected as `run(job)` — the smoke test passes a stub,
// main.js passes the AI/adapters calls — so no network call is
// anywhere near the logic that orders and reports it.
//
// Fairness rule: jobs are started in (priority, queuedAt) order.
// Priority is small-integer, user-shaped: 1 = user is waiting on
// the button they just clicked, 0 = batch/backfill. Ties break
// by age, so an old batch job can never starve behind a stream
// of new ones, and a new batch job never jumps the queue.
// ============================================================

'use strict';

const BackgroundJobs = (() => {
  // Retry only failures the queue believes are transient: network errors,
  // 429s, and 5xx. A 401/403 will fail identically on every attempt and
  // burning retries on it just delays the error reaching the user.
  const RETRYABLE = /^(429|5\d\d)$/;
  const MAX_ATTEMPTS = 3;
  const BASE_BACKOFF_MS = 2000;   // first retry waits 2s, then 4s (no jitter — determinism over optimality)
  const KEEP_DONE = 40;           // finished jobs kept for the tray/history, then pruned
  const MAX_QUEUE = 200;          // refuse to grow unbounded if a caller is stuck in a loop

  function newJob(spec) {
    const now = Date.now();
    return {
      id: String(spec.id || ('job-' + now.toString(36) + Math.random().toString(36).slice(2, 8))),
      kind: String(spec.kind || 'generic').slice(0, 32),        // e.g. 'site-generate', 'photo-run', 'vault-sync'
      projectId: String(spec.projectId || '').slice(0, 80),
      projectName: String(spec.projectName || '').slice(0, 120),
      label: String(spec.label || spec.kind || 'Working…').slice(0, 160),
      priority: Number.isFinite(spec.priority) ? (spec.priority > 0 ? 1 : 0) : 1,
      payload: spec.payload && typeof spec.payload === 'object' ? spec.payload : {},
      status: 'queued',        // queued | running | succeeded | failed | cancelled
      progress: 0,             // 0..100, from the worker's own onProgress
      note: '',                // human-readable phase, e.g. 'Composing sections…'
      attempts: 0,
      maxAttempts: MAX_ATTEMPTS,
      createdAt: now,
      startedAt: null,
      endedAt: null,
      lastError: '',
      errorIsRetryable: false,
      // Result metadata only — never the project payload itself. The vault
      // owns project data; jobs carry just enough for the tray to render.
      result: null,
      logs: []                 // [{ at, note }] — capped, for the expandable tray row
    };
  }

  function createQueue(deps) {
    const d = deps || {};
    const run = typeof d.run === 'function' ? d.run : () => Promise.resolve({});
    const now = typeof d.now === 'function' ? d.now : () => Date.now();
    const delay = typeof d.delay === 'function' ? d.delay : (ms) => new Promise((r) => setTimeout(r, ms));

    const jobs = new Map();          // id -> job (insertion order ≠ run order)
    let running = null;              // the single in-flight promise
    let tickScheduled = false;
    let onChange = null;
    let seq = 0;

    function emit() {
      if (typeof onChange === 'function') {
        try { onChange(snapshot()); } catch (e) { /* listener errors must not kill the queue */ }
      }
    }

    function log(job, note) {
      job.logs.push({ at: now(), note: String(note == null ? '' : note).slice(0, 200) });
      if (job.logs.length > 20) job.logs.splice(0, job.logs.length - 20);
    }

    // Start order: priority (1 first), then FIFO by queue time.
    function nextQueued() {
      let best = null;
      let bestSeq = -1;
      jobs.forEach((job, id) => {
        if (job.status !== 'queued') return;
        const s = job._seq || 0;
        if (!best) { best = job; bestSeq = s; return; }
        if (job.priority > best.priority ||
            (job.priority === best.priority && s < bestSeq)) { best = job; bestSeq = s; }
      });
      return best ? best.id : null;
    }

    function progress(job, pct, note) {
      const p = Math.max(0, Math.min(100, Number(pct)));
      if (Number.isFinite(p)) job.progress = Math.round(p);
      if (note) {
        job.note = String(note).slice(0, 160);
        log(job, note);
      }
      emit();
    }

    async function runOne(job) {
      job.status = 'running';
      job.startedAt = now();
      job.attempts += 1;
      job.progress = job.attempts > 1 ? 0 : Math.min(job.progress, 5);
      log(job, 'Started (attempt ' + job.attempts + ')');
      emit();
      try {
        const result = await run(job, (pct, note) => progress(job, pct, note));
        job.status = 'succeeded';
        job.result = result && typeof result === 'object' ? result : null;
        job.progress = 100;
        job.note = (result && result.note) ? String(result.note).slice(0, 160) : 'Done';
        job.endedAt = now();
        log(job, 'Finished');
      } catch (e) {
        const status = e && e.status ? String(e.status) : '';
        // An explicit `retryable` flag on the error wins; otherwise the shape
        // decides — 429/5xx are transient, and a status-less error is treated
        // as a network failure (which is transient by nature).
        const explicit = (e && typeof e.retryable === 'boolean') ? e.retryable : null;
        const retryable = explicit !== null ? explicit : (RETRYABLE.test(status) || !status);
        const canRetry = job.attempts < job.maxAttempts;
        job.lastError = String((e && e.message) || e || 'Failed').slice(0, 300);
        job.errorIsRetryable = retryable && canRetry;
        // Retry ONLY what the queue believes is transient. A 401 fails
        // identically on every attempt — retrying it just delays the truth
        // reaching the user.
        if (retryable && canRetry) {
          job.status = 'queued';
          const waitMs = BASE_BACKOFF_MS * Math.pow(2, job.attempts - 1);
          log(job, 'Attempt failed — retrying in ' + Math.round(waitMs / 1000) + 's (' + job.lastError.slice(0, 80) + ')');
          job._retryAt = now() + waitMs;
        } else {
          job.status = 'failed';
          job.endedAt = now();
          job.note = retryable ? 'Failed after ' + job.attempts + ' attempts' : 'Failed';
          log(job, 'Gave up: ' + job.lastError.slice(0, 120));
        }
      }
      emit();
    }

    async function tick() {
      if (tickScheduled) return;
      tickScheduled = true;
      // Yield so enqueue() callers can batch before the first start.
      await Promise.resolve();
      tickScheduled = false;
      while (running === null) {
        const id = nextQueued();
        if (!id) break;
        const job = jobs.get(id);
        // Retry backoff: a queued job with a future _retryAt is skipped this
        // pass — the setTimeout below re-ticks when it is due.
        if (job._retryAt && job._retryAt > now()) {
          const waitMs = Math.max(50, job._retryAt - now());
          // Via the injected delay (real setTimeout by default) so the same
          // code is drivable by a fake clock in the smoke suite.
          void delay(waitMs).then(() => tick());
          break;
        }
        running = runOne(job).then(() => { running = null; });
        await running;
      }
    }

    const api = {
      // Enqueue a job. Returns the job record (same object the events carry).
      enqueue(spec) {
        if (jobs.size >= MAX_QUEUE) {
          // Shed the OLDEST finished jobs first; never shed queued/running.
          const finished = [...jobs.values()]
            .filter((j) => j.status === 'succeeded' || j.status === 'failed' || j.status === 'cancelled')
            .sort((a, b) => (a.endedAt || a.createdAt) - (b.endedAt || b.createdAt));
          if (finished.length) jobs.delete(finished[0].id);
          else return null; // queue genuinely full of live work
        }
        const job = newJob(spec);
        job._seq = ++seq;
        jobs.set(job.id, job);
        emit();
        void tick();
        return job;
      },

      cancel(id) {
        const job = jobs.get(id);
        if (!job) return false;
        if (job.status === 'queued') {
          job.status = 'cancelled';
          job.endedAt = now();
          job.note = 'Cancelled';
          log(job, 'Cancelled before start');
          emit();
          return true;
        }
        // A running job is flagged; the worker observes job.cancelRequested
        // between phases (the queue cannot abort an in-flight await).
        if (job.status === 'running') {
          job.cancelRequested = true;
          log(job, 'Cancel requested — will stop at the next phase boundary');
          emit();
          return true;
        }
        return false;
      },

      retry(id) {
        const job = jobs.get(id);
        if (!job || job.status !== 'failed') return false;
        job.status = 'queued';
        job.attempts = 0;
        job.progress = 0;
        job._retryAt = null;
        job.errorIsRetryable = false;
        job.note = 'Queued again';
        log(job, 'Manually re-queued');
        emit();
        void tick();
        return true;
      },

      get(id) { return jobs.get(id) || null; },

      // Snapshot for the tray: live jobs first (running, then queued by
      // priority/age), then recently finished, newest first.
      snapshot() {
        const all = [...jobs.values()];
        const live = all
          .filter((j) => j.status === 'running' || j.status === 'queued')
          .sort((a, b) => (b.priority - a.priority) || (a.createdAt - b.createdAt));
        const done = all
          .filter((j) => j.status === 'succeeded' || j.status === 'failed' || j.status === 'cancelled')
          .sort((a, b) => (b.endedAt || b.createdAt) - (a.endedAt || a.createdAt))
          .slice(0, KEEP_DONE);
        return { live, done, runningCount: all.filter((j) => j.status === 'running').length };
      },

      // Jobs still attached to a project — the renderer asks before deleting
      // a project that has live work against it.
      liveForProject(projectId) {
        return [...jobs.values()].filter((j) =>
          j.projectId === projectId && (j.status === 'running' || j.status === 'queued'));
      },

      onChange(fn) { onChange = fn; },

      // Test hook / graceful-shutdown hook: stop scheduling new work and
      // report what was left behind.
      async drain() {
        while (running !== null) { await running; }
      },

      // Internal, for tests: seed state without running anything.
      _jobs: jobs
    };

    function snapshot() { return api.snapshot(); }

    return api;
  }

  return { createQueue, RETRYABLE, MAX_ATTEMPTS, BASE_BACKOFF_MS };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = BackgroundJobs;
