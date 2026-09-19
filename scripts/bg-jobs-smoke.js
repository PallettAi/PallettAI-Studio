#!/usr/bin/env node
// ============================================================
// PallettAI Studio — background job queue smoke
// The queue is the thing between a click and a finished run. Its
// contract has to hold under stress and abuse, because the UI
// will drive it faster than any human: cancelled mid-flight,
// retrying through flaky endpoints, more work arriving than
// there is CPU. The invariants pinned here:
//
//   * strict single-flight: two jobs never overlap, whatever the
//     enqueue rate (a second AI run racing the first would write
//     to the same project)
//   * priority + FIFO start order, and old batch work never
//     starves behind a stream of new work
//   * retries only for retryable failures (429/5xx/network),
//     with backoff, and an honest 'failed' after the last attempt
//   * cancel: a queued job is removed; a running job is flagged
//     and can still finish; a finished job is untouched
//   * the snapshot the tray renders is stable and capped
// ============================================================
'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');
const BackgroundJobs = require(path.join(ROOT, 'data', 'jobs.js'));

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function assert(cond, msg) { cond ? pass(msg) : fail(msg); }
function eq(actual, expected, msg) {
  if (actual === expected) pass(msg);
  else fail(msg + '  → got: ' + JSON.stringify(actual) + ', expected: ' + JSON.stringify(expected));
}

async function main() {
  // A controllable clock + timer list so backoff can be advanced by hand —
  // no sleeps, no flakiness.
  let NOW = 1000000;
  const timers = [];
  const delay = (ms) => new Promise((resolve) => timers.push({ at: NOW + ms, resolve }));
  function advance(ms) {
    NOW += ms;
    const due = timers.filter((t) => t.at <= NOW);
    for (const t of due) { timers.splice(timers.indexOf(t), 1); t.resolve(); }
  }

  // ---- 1. single flight ------------------------------------------------------
  {
    let running = 0;
    let maxConcurrent = 0;
    const q = BackgroundJobs.createQueue({
      run: async (job, onProgress) => {
        running++;
        maxConcurrent = Math.max(maxConcurrent, running);
        onProgress(50, 'halfway');
        await new Promise((r) => setTimeout(r, 5));
        running--;
        return { note: 'done' };
      },
      now: () => NOW
    });
    const a = q.enqueue({ kind: 'x', label: 'A' });
    const b = q.enqueue({ kind: 'x', label: 'B' });
    const c = q.enqueue({ kind: 'x', label: 'C' });
    assert(a && b && c, 'enqueue returns job records');
    await new Promise((r) => setTimeout(r, 40));
    eq(maxConcurrent, 1, 'strict single flight: jobs never overlap');
    eq(a.status, 'succeeded', 'first job succeeded');
    eq(b.status, 'succeeded', 'second job succeeded');
    eq(c.status, 'succeeded', 'third job succeeded');
    eq(a.progress, 100, 'progress capped at 100 on success');
    const snap = q.snapshot();
    eq(snap.runningCount, 0, 'snapshot shows nothing running after drain');
    eq(snap.done.length, 3, 'finished jobs are kept for the tray');
  }

  // ---- 2. priority + FIFO ----------------------------------------------------
  {
    const started = [];
    const q = BackgroundJobs.createQueue({
      run: async (job) => { started.push(job.label); await new Promise((r) => setTimeout(r, 2)); return {}; },
      now: () => NOW
    });
    q.enqueue({ id: 'j1', label: 'batch-1', priority: 0 });
    q.enqueue({ id: 'j2', label: 'batch-2', priority: 0 });
    q.enqueue({ id: 'j3', label: 'user-click', priority: 1 });
    await new Promise((r) => setTimeout(r, 30));
    eq(started.join(','), 'user-click,batch-1,batch-2', 'user priority first, then FIFO among batches');
  }

  // ---- 3. retries: retryable vs fatal ----------------------------------------
  {
    let attempts = 0;
    const q = BackgroundJobs.createQueue({
      run: async () => {
        attempts++;
        const e = new Error('boom'); e.status = '503'; throw e;
      },
      now: () => NOW, delay
    });
    q.enqueue({ id: 'r1', label: 'flaky' });
    await new Promise((r) => setTimeout(r, 20));
    eq(attempts, 1, 'first attempt runs immediately');
    eq(q.get('r1').status, 'queued', 'a 503 puts the job back in the queue, not failed');
    advance(2100); // first backoff (2s)
    await new Promise((r) => setTimeout(r, 20));
    eq(attempts, 2, 'second attempt after ~2s backoff');
    advance(4100); // second backoff (4s)
    await new Promise((r) => setTimeout(r, 20));
    eq(attempts, 3, 'third attempt after ~4s backoff');
    eq(q.get('r1').status, 'failed', 'gives up honestly after the last attempt');
    assert(q.get('r1').lastError.indexOf('boom') !== -1, 'the failure reason is kept for the tray');
  }
  {
    let attempts = 0;
    const q = BackgroundJobs.createQueue({
      run: async () => { attempts++; const e = new Error('nope'); e.status = '401'; throw e; },
      now: () => NOW, delay
    });
    q.enqueue({ id: 'f1', label: 'auth' });
    await new Promise((r) => setTimeout(r, 20));
    eq(attempts, 1, 'a 401 runs once');
    eq(q.get('f1').status, 'failed', 'and fails immediately — retrying auth errors just delays the truth');
    eq(q.get('f1').errorIsRetryable, false, 'flagged as non-retryable');
  }

  // ---- 4. cancel ---------------------------------------------------------------
  {
    let released = null;
    const gate = new Promise((r) => { released = r; });
    const q = BackgroundJobs.createQueue({
      run: async () => { await gate; return {}; },
      now: () => NOW
    });
    const a = q.enqueue({ id: 'c1', label: 'long' });
    const b = q.enqueue({ id: 'c2', label: 'queued-behind' });
    await new Promise((r) => setTimeout(r, 10));
    eq(a.status, 'running', 'first job is running');
    eq(q.cancel(b.id), true, 'a queued job can be cancelled');
    eq(b.status, 'cancelled', 'cancelled job marked');
    eq(q.cancel(b.id), false, 'cancelling twice is refused');
    eq(q.cancel(a.id), true, 'a running job accepts a cancel REQUEST');
    eq(a.cancelRequested, true, 'the running job is flagged for its next phase boundary');
    released();
    await new Promise((r) => setTimeout(r, 20));
    eq(a.status, 'succeeded', 'an in-flight await still completes (the queue cannot abort a network call)');
    eq(q.cancel(a.id), false, 'a finished job cannot be cancelled');
  }

  // ---- 5. retry button --------------------------------------------------------
  {
    let runs = 0;
    const q = BackgroundJobs.createQueue({
      run: async () => {
        runs++;
        if (runs === 1) { const e = new Error('cold start'); e.retryable = false; throw e; }
        return { note: 'recovered' };
      },
      now: () => NOW
    });
    q.enqueue({ id: 'rr', label: 'needs-a-second-try' });
    await new Promise((r) => setTimeout(r, 20));
    eq(q.get('rr').status, 'failed', 'failed on first run');
    eq(q.retry('rr'), true, 'manual retry is accepted');
    await new Promise((r) => setTimeout(r, 20));
    eq(q.get('rr').status, 'succeeded', 'and succeeds on the manual second run');
    eq(q.get('rr').attempts, 1, 'attempts reset on manual retry');
  }

  // ---- 6. snapshot shape + pruning --------------------------------------------
  {
    const q = BackgroundJobs.createQueue({ run: async () => ({ note: 'ok' }), now: () => NOW });
    for (let i = 0; i < 60; i++) {
      q.enqueue({ id: 'p' + i, label: 'batch ' + i, priority: 0 });
      await new Promise((r) => setTimeout(r, 1));
    }
    await new Promise((r) => setTimeout(r, 80));
    const snap = q.snapshot();
    assert(snap.done.length <= 40, 'done list is capped at KEEP_DONE');
    assert(snap.live.length === 0, 'all batch work drained');
  }

  // ---- 7. liveForProject guards deletes ----------------------------------------
  {
    const gate = new Promise((r) => setTimeout(r, 30));
    const q = BackgroundJobs.createQueue({ run: async () => { await gate; return {}; }, now: () => NOW });
    q.enqueue({ id: 'live1', projectId: 'proj-1', label: 'sync' });
    await new Promise((r) => setTimeout(r, 5));
    eq(q.liveForProject('proj-1').length, 1, 'a live job is reported for its project');
    eq(q.liveForProject('proj-2').length, 0, 'other projects see none');
    await new Promise((r) => setTimeout(r, 40));
    eq(q.liveForProject('proj-1').length, 0, 'finished jobs are not live');
  }
}

main().then(() => {
  if (failed) {
    console.error('\nbg-jobs-smoke FAILED — ' + failed + ' failure(s)');
    process.exit(1);
  }
  console.log('\nbg-jobs-smoke PASSED');
}, (e) => {
  console.error('\nbg-jobs-smoke crashed: ' + (e && e.stack || e));
  process.exit(1);
});
