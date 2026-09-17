/*
  Wrapped in an IIFE, and this file is the reason why: it defines `plan` and
  `apply` at what would otherwise be global scope, and both are names other
  data modules already use. Function declarations would silently overwrite each
  other (the last script loaded wins, whichever module asks); a duplicate `const`
  throws and takes the file down entirely. Neither is acceptable in a classic
  script, so nothing here leaks out except RevsPolicy.
*/
(function () {
'use strict';

/*
  ============================================================
  RevsPolicy — retention for autosave history
  ------------------------------------------------------------
  Autosave snapshots are the largest thing most creators ever
  store, and nothing has ever pruned them. captureRevision()
  caps one project at 12 snapshots and the library at 24 MB,
  but that ceiling is a wall rather than a policy: reaching it
  means the next snapshot is silently refused, and nothing
  ever tells the creator that last month's history is most of
  their library.

  These rules are the policy. They are pure and take the clock
  as an argument, so the behaviour below is asserted in tests
  rather than described in a comment.

  The rule that matters most:

    The newest revision of a project is NEVER dropped — not by
    age, not by count, not by the byte budget. It is the only
    restore point for "I just broke it", and a retention policy
    whose worst case is losing that is worse than no policy.

  Everything else is disposable by design: older snapshots of
  the same project, kept down to whichever limit binds first.
  ============================================================ */

const MB = 1024 * 1024;

/*
  Defaults deliberately prune nothing.

  maxPerProject matches what captureRevision already keeps and budgetBytes
  matches the ceiling it already enforces, so an untouched library reports
  "nothing to drop" and the creator chooses to be stricter. A retention default
  that quietly deletes things the moment you open the panel is a trap.
*/
const DEFAULTS = {
  maxPerProject: 12,
  maxAgeDays: 90,
  budgetBytes: 24 * MB
};

// Named rule sets for the panel. `0` means "no limit of that kind".
const PRESETS = [
  { id: 'default', label: 'Defaults', note: 'Nothing goes until a project passes 12 snapshots, 90 days or 24 MB.', rules: Object.assign({}, DEFAULTS) },
  { id: 'tidy', label: 'Tidy', note: 'A month of history, at most 8 snapshots per project, 8 MB overall.', rules: { maxPerProject: 8, maxAgeDays: 30, budgetBytes: 8 * MB } },
  { id: 'tight', label: 'Keep a week', note: 'The last 7 days and 3 snapshots per project, 2 MB overall.', rules: { maxPerProject: 3, maxAgeDays: 7, budgetBytes: 2 * MB } },
  { id: 'minimum', label: 'Keep one per project', note: 'Only the newest snapshot of each project. Frees the most space; you lose the ability to step back further.', rules: { maxPerProject: 1, maxAgeDays: 0, budgetBytes: 0 } }
];

function rules(options) {
  const o = options || {};
  const pick = (name) => (Number.isFinite(Number(o[name])) && Number(o[name]) >= 0 ? Math.floor(Number(o[name])) : DEFAULTS[name]);
  return {
    maxPerProject: pick('maxPerProject'),
    maxAgeDays: pick('maxAgeDays'),
    budgetBytes: pick('budgetBytes')
  };
}

function bytesOf(rev) {
  return rev && typeof rev.snap === 'string' ? rev.snap.length : 0;
}

function timeOf(rev) {
  const t = Number(rev && rev.t);
  return Number.isFinite(t) && t > 0 ? t : 0;
}

/*
  What would be dropped, and what would stay.

  Returns the plan rather than performing it: the panel shows the numbers and
  the creator confirms, so "prune my history" is never a blind action.
*/
function plan(revs, options, now) {
  const r = rules(options);
  const at = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const cutoff = r.maxAgeDays > 0 ? at - r.maxAgeDays * 86400000 : 0;
  const source = revs && typeof revs === 'object' ? revs : {};

  const drop = [];
  const keep = {};
  const projects = [];
  let bytesBefore = 0;

  // Pass 1 — per project, newest first. Age and count are decided here because
  // both are about one project's own timeline.
  Object.keys(source).forEach((id) => {
    const list = Array.isArray(source[id]) ? source[id] : [];
    const kept = [];
    list.forEach((rev, index) => {
      const bytes = bytesOf(rev);
      bytesBefore += bytes;
      if (!rev || typeof rev !== 'object') { drop.push({ id, index, t: 0, bytes, why: 'empty' }); return; }
      const t = timeOf(rev);
      const why = (index > 0 && cutoff && t && t < cutoff) ? 'age'
        : (kept.length >= r.maxPerProject ? 'count' : '');
      if (why) drop.push({ id, index, t, bytes, why });
      else kept.push({ rev, index, t, bytes });
    });
    if (kept.length) keep[id] = kept.map((k) => k.rev);
    projects.push({ id, before: list.length, after: kept.length });
  });

  // Pass 2 — the global byte budget, newest first across everything. A snapshot
  // that is the last one left in its project is skipped rather than dropped:
  // the cap may be exceeded before the guarantee is broken.
  if (r.budgetBytes > 0) {
    const flat = [];
    Object.keys(keep).forEach((id) => { keep[id].forEach((rev, i) => flat.push({ id, rev, i })); });
    flat.sort((a, b) => timeOf(b.rev) - timeOf(a.rev));
    let total = 0;
    const dropped = Object.create(null);
    flat.forEach((row) => {
      const bytes = bytesOf(row.rev);
      const survivors = keep[row.id].length - (dropped[row.id] || 0);
      if (total + bytes > r.budgetBytes && survivors > 1) {
        dropped[row.id] = (dropped[row.id] || 0) + 1;
        drop.push({ id: row.id, index: row.i, t: timeOf(row.rev), bytes, why: 'budget' });
        return;
      }
      total += bytes;
    });
    if (Object.keys(dropped).length) {
      Object.keys(keep).forEach((id) => {
        const gone = dropped[id] || 0;
        if (gone) keep[id] = keep[id].slice(0, Math.max(1, keep[id].length - gone));
      });
    }
  }

  const byWhy = { age: 0, count: 0, budget: 0, empty: 0 };
  let bytesFreed = 0;
  drop.forEach((d) => { bytesFreed += d.bytes; if (byWhy[d.why] !== undefined) byWhy[d.why] += 1; });
  const counts = projects.reduce((acc, p) => { acc.before += p.before; acc.after += p.after; return acc; }, { before: 0, after: 0 });
  projects.forEach((p) => {
    const list = Array.isArray(source[p.id]) ? source[p.id] : [];
    p.bytesBefore = list.reduce((n, rev) => n + bytesOf(rev), 0);
    p.bytesAfter = (keep[p.id] || []).reduce((n, rev) => n + bytesOf(rev), 0);
  });

  return {
    at,
    rules: r,
    drop,
    keep,
    projects,
    byWhy,
    counts,
    bytesBefore,
    bytesAfter: Math.max(0, bytesBefore - bytesFreed),
    bytesFreed
  };
}

// Drop indices, largest first, per project — the order a caller must splice in
// so that removing one snapshot does not shift the ones after it.
function dropOrder(result) {
  const byId = {};
  (result && result.drop ? result.drop : []).forEach((d) => { (byId[d.id] = byId[d.id] || []).push(d.index); });
  Object.keys(byId).forEach((id) => byId[id].sort((a, b) => b - a));
  return byId;
}

// Apply a plan to a revisions map without mutating the input.
function apply(revs, result) {
  const order = dropOrder(result);
  const out = {};
  Object.keys(revs || {}).forEach((id) => {
    const list = Array.isArray(revs[id]) ? revs[id].slice() : [];
    const indices = order[id] || [];
    indices.forEach((i) => { if (i >= 0 && i < list.length) delete list[i]; });
    const compact = list.filter((rev, i) => indices.indexOf(i) === -1);
    if (compact.length) out[id] = compact;
  });
  return out;
}

/*
  How close is the local library to the wall?

  Level, not just a percentage: the panel needs to say something useful, and
  "82%" on its own does not tell a creator whether to act. The advice strings
  are here so the wording is tested rather than improvised in the view.
*/
function pressure(usageBytes, quotaBytes) {
  const used = Math.max(0, Number(usageBytes) || 0);
  const quota = Math.max(0, Number(quotaBytes) || 0);
  if (!quota) {
    return { used, quota: 0, pct: 0, level: 'unknown', advice: 'The browser does not report a storage limit here — keep a backup.' };
  }
  const pct = Math.min(100, Math.round((used / quota) * 1000) / 10);
  if (pct >= 80) return { used, quota, pct, level: 'high', advice: 'The library is nearly at the space this app is allowed. Pruning autosave history is the safest way to make room — the newest snapshot of each project is kept.' };
  if (pct >= 50) return { used, quota, pct, level: 'watch', advice: 'The library is over half of the space this app is allowed. Worth a backup, or a prune of older autosave snapshots.' };
  return { used, quota, pct, level: 'ok', advice: 'There is plenty of room left.' };
}

const RevsPolicy = { DEFAULTS, PRESETS, MB, rules, plan, apply, dropOrder, pressure, bytesOf, timeOf };

if (typeof window !== 'undefined') window.RevsPolicy = RevsPolicy;
if (typeof module !== 'undefined' && module.exports) module.exports = RevsPolicy;
})();
