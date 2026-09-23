'use strict';

/*
  ============================================================
  CompilerProfiler — where the build time actually goes
  ------------------------------------------------------------
  This product's headline claim is a fast export, and until now the
  only way to check it was to watch the app. A timing report turns
  "feels quick" into numbers, and numbers are the only way to tell a
  genuine bottleneck from a slow machine.

  Stage timing uses `process.hrtime.bigint()` rather than Date.now(),
  and that is not a detail. Date.now() has millisecond granularity and
  is subject to clock adjustments, so a minify stage that takes 0.4ms
  reads as 0ms or as 1ms depending on where the tick lands — exactly
  the noise that makes a profile useless. hrtime is monotic and
  nanosecond-resolution, so a stage is measured rather than rounded.

  Three rules the implementation keeps:

  1. An unmatched end is reported, never invented. Ending a stage that
     was never started records a finding instead of silently producing
     a zero-length stage, because a profile that hides broken
     instrumentation is worse than no profile.

  2. Nesting is allowed and accounted for. Stages can wrap other
     stages (a build wraps its page loop, a page wraps minification),
     so each stage records its own elapsed time, its depth, and the
     time spent in children — which is what stops a parent from
     looking like the bottleneck when its children are.

  3. A bottleneck is a budget, not an opinion. The threshold defaults
     to 50ms per stage, which follows from the export budget this
     project already targets: four transformation stages inside a
     sub-200ms export leaves 50ms each. It is configurable, because a
     threshold that cannot move gets ignored.
  ============================================================
*/

const DEFAULT_THRESHOLD_MS = 50;

// process.hrtime is Node-only. In a renderer, performance.now() is the
// equivalent monotonic clock, so the module degrades rather than throws.
const nowNs = (() => {
  if (typeof process !== 'undefined' && process.hrtime && process.hrtime.bigint) {
    const b = process.hrtime.bigint();
    if (typeof b === 'bigint') return () => Number(process.hrtime.bigint() - b) / 1e6; // ms
  }
  if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') {
    return () => performance.now();
  }
  return () => Date.now();
})();

const CLOCK = (typeof process !== 'undefined' && process.hrtime && process.hrtime.bigint)
  ? 'hrtime' : (typeof performance !== 'undefined' && performance && performance.now ? 'performance.now' : 'Date.now');

const CompilerProfiler = (() => {

  // stageName -> stack of {start, depth, children}
  const open = new Map();
  let stages = [];
  let findings = [];
  let order = 0;
  let enabled = true;
  let threshold = DEFAULT_THRESHOLD_MS;
  let buildStartedAt = null;
  let buildLabel = '';

  function depthNow() {
    let max = 0;
    open.forEach((stack) => { if (stack.length > max) max = stack.length; });
    return max;
  }

  function reset() {
    open.clear();
    stages = [];
    findings = [];
    order = 0;
    buildStartedAt = null;
    buildLabel = '';
    return true;
  }

  function configure(opts) {
    const o = opts || {};
    if (typeof o.thresholdMs === 'number' && o.thresholdMs > 0) threshold = o.thresholdMs;
    if (typeof o.enabled === 'boolean') enabled = o.enabled;
    return { thresholdMs: threshold, enabled, clock: CLOCK };
  }

  /*
    Begin a build. Optional, but it is what makes "total build time"
    mean the whole run rather than the sum of the stages someone
    remembered to instrument.
  */
  function startBuild(label) {
    if (!enabled) return null;
    buildStartedAt = nowNs();
    buildLabel = String(label == null ? '' : label);
    return buildStartedAt;
  }

  function startProfilerStage(stageName, meta) {
    if (!enabled) return null;
    const name = String(stageName == null ? '' : stageName) || 'unnamed';
    if (!open.has(name)) open.set(name, []);
    const frame = { start: nowNs(), depth: depthNow(), children: 0, meta: meta || null, seq: order++ };
    open.get(name).push(frame);
    return frame;
  }

  function endProfilerStage(stageName, extra) {
    if (!enabled) return null;
    const name = String(stageName == null ? '' : stageName) || 'unnamed';
    const stack = open.get(name);
    if (!stack || !stack.length) {
      // Reported, not fabricated: a stage that ends without a start is
      // broken instrumentation and should be visible.
      findings.push({ kind: 'unmatched-end', stage: name, detail: 'endProfilerStage was called with no matching start' });
      return null;
    }
    const frame = stack.pop();
    const elapsed = nowNs() - frame.start;
    const record = {
      stage: name,
      ms: Math.round(elapsed * 1000) / 1000,
      selfMs: Math.round((elapsed - frame.children) * 1000) / 1000,
      depth: frame.depth,
      seq: frame.seq,
      meta: frame.meta
    };
    if (extra && typeof extra === 'object') record.meta = Object.assign({}, frame.meta || {}, extra);
    stages.push(record);
    // Charge the elapsed time to every open ancestor, so a parent's
    // self time excludes what its children already accounted for.
    open.forEach((s) => { s.forEach((f) => { f.children += elapsed; }); });
    return record;
  }

  /*
    Time a synchronous function. Convenience for the common case, and
    it guarantees the stage closes even if the function throws — the
    finally is the point.
  */
  function timeStage(stageName, fn, meta) {
    startProfilerStage(stageName, meta);
    try {
      return fn();
    } finally {
      endProfilerStage(stageName);
    }
  }

  /*
    The same for an async step. A separate function rather than one
    clever helper: if `timeStage` returned whatever `fn` returned, an
    async caller would silently record the time taken to *create* the
    promise and report every parallel build as instantly fast.
  */
  async function timeStageAsync(stageName, fn, meta) {
    startProfilerStage(stageName, meta);
    try {
      return await fn();
    } finally {
      endProfilerStage(stageName);
    }
  }

  function classify(stage) {
    const s = String(stage || '').toLowerCase();
    if (/parse|read|load|import|decode/.test(s)) return 'parsing';
    if (/transform|build|render|compile|generate|schema|migrat/.test(s)) return 'transformation';
    if (/minif|optimi|compress|subset|encode/.test(s)) return 'minification';
    if (/write|save|disk|io|zip|export|flush|fsync/.test(s)) return 'disk-io';
    return 'other';
  }

  /*
    The report. Stages are grouped into this project's four phases,
    because "minify took 61ms" is actionable while "pageBuild took
    148ms" is only a name.
  */
  function generateBuildProfileReport(opts) {
    const o = opts || {};
    const limit = typeof o.thresholdMs === 'number' ? o.thresholdMs : threshold;
    const totalMs = buildStartedAt == null ? stages.reduce((n, s) => n + s.ms, 0) : (nowNs() - buildStartedAt);

    const byPhase = {};
    stages.forEach((s) => {
      const phase = classify(s.stage);
      if (!byPhase[phase]) byPhase[phase] = { phase, ms: 0, stages: 0 };
      byPhase[phase].ms += s.selfMs;
      byPhase[phase].stages++;
    });

    const slowest = stages.slice().sort((a, b) => b.selfMs - a.selfMs)[0] || null;
    const bottlenecks = stages
      .filter((s) => s.selfMs > limit)
      .sort((a, b) => b.selfMs - a.selfMs)
      .map((s) => ({
        stage: s.stage,
        selfMs: s.selfMs,
        budgetMs: limit,
        overByMs: Math.round((s.selfMs - limit) * 1000) / 1000,
        advice: adviceFor(s.stage)
      }));

    const openNow = [];
    open.forEach((stack, name) => { if (stack.length) openNow.push(name); });

    return {
      ok: findings.length === 0 && openNow.length === 0,
      label: buildLabel,
      clock: CLOCK,
      thresholdMs: limit,
      totalMs: Math.round(totalMs * 1000) / 1000,
      instrumentedMs: Math.round(stages.reduce((n, s) => n + s.ms, 0) * 1000) / 1000,
      stageCount: stages.length,
      phases: Object.keys(byPhase).map((k) => ({
        phase: byPhase[k].phase,
        ms: Math.round(byPhase[k].ms * 1000) / 1000,
        stages: byPhase[k].stages
      })).sort((a, b) => b.ms - a.ms),
      stages: stages.slice().sort((a, b) => a.seq - b.seq),
      slowest: slowest ? { stage: slowest.stage, ms: slowest.selfMs } : null,
      bottlenecks,
      // Findings are the instrumentation's own health, kept separate from
      // performance so a broken timer is never mistaken for a slow stage.
      findings: findings.slice(),
      unclosed: openNow
    };
  }

  /*
    Advice is attached to the specific stage name, so the report says
    what to do rather than only what was slow.
  */
  function adviceFor(stage) {
    const s = String(stage || '').toLowerCase();
    if (/minif/.test(s)) return 'Minification is pure and cached — reuse a build-cache entry instead of re-running it.';
    if (/read|parse|load/.test(s)) return 'Reading is usually waiting, not working — reuse the in-memory value, or read once per build.';
    if (/svg|subset|optimi/.test(s)) return 'Asset transforms are content-addressed — skip the transform when the input hash has not changed.';
    if (/zip|write|export|disk|io/.test(s)) return 'Disk work is dominated by the number of writes — batch files into one archive rather than many small writes.';
    if (/render|build|generate/.test(s)) return 'Check whether unchanged pages are being rebuilt: the cache should make an untouched page nearly free.';
    return 'Measure the stage again with more granular timers before optimising it.';
  }

  // One-line summary for a log or an export report.
  function summary(report) {
    const r = report || generateBuildProfileReport();
    const parts = r.phases.map((p) => p.phase + ' ' + p.ms + 'ms');
    return r.totalMs + 'ms total' + (parts.length ? ' (' + parts.join(', ') + ')' : '') +
      (r.bottlenecks.length ? ' — ' + r.bottlenecks.length + ' over budget' : '');
  }

  return {
    DEFAULT_THRESHOLD_MS,
    clock: () => CLOCK,
    configure,
    reset,
    startBuild,
    startProfilerStage,
    endProfilerStage,
    timeStage,
    timeStageAsync,
    generateBuildProfileReport,
    summary,
    classify,
    get stages() { return stages.slice(); }
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = CompilerProfiler;
