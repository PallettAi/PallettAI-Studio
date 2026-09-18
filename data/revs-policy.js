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

  Two rules that matter most:

    1. A NAMED revision (a milestone — see Milestones) is never
       dropped, by any rule. Its name is a decision somebody
       made about a version a client may have approved, and a
       retention policy that deletes those is deleting the one
       thing here that cannot be recreated by editing again.
    2. The newest revision of a project is NEVER dropped — not
       by age, not by count, not by the byte budget. It is the
       only restore point for "I just broke it", and a policy
       whose worst case is losing that is worse than no policy.

  Everything else is disposable by design: unnamed snapshots of
  the same project, kept down to whichever limit binds first.

  Both guarantees are why the byte budget can end up exceeded.
  A budget is a target; these two are promises, and this file
  prefers breaking the target.
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

/*
  Named rule sets for the panel. `0` means "no limit of that kind".

  Every note ends by naming the guarantee, including the aggressive ones: this
  is the screen somebody reads before letting the app delete their history, and
  "frees the most space" without "your named milestones are kept" is how a
  creator talks themselves out of a policy that was safe all along.
*/
const KEPT = ' Named milestones are kept.';
const PRESETS = [
  { id: 'default', label: 'Defaults', note: 'Nothing goes until a project passes 12 snapshots, 90 days or 24 MB.' + KEPT, rules: Object.assign({}, DEFAULTS) },
  { id: 'tidy', label: 'Tidy', note: 'A month of history, at most 8 snapshots per project, 8 MB overall.' + KEPT, rules: { maxPerProject: 8, maxAgeDays: 30, budgetBytes: 8 * MB } },
  { id: 'tight', label: 'Keep a week', note: 'The last 7 days and 3 snapshots per project, 2 MB overall.' + KEPT, rules: { maxPerProject: 3, maxAgeDays: 7, budgetBytes: 2 * MB } },
  { id: 'minimum', label: 'Keep one per project', note: 'Only the newest snapshot of each project. Frees the most space; you lose the ability to step back further.' + KEPT, rules: { maxPerProject: 1, maxAgeDays: 0, budgetBytes: 0 } }
];

// The field that makes a revision a milestone. Mirrors Milestones.FIELD.
const FIELD = 'pin';

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
  Is this revision a named milestone?

  The property name is owned by data/milestones.js (Milestones.FIELD), and this
  is a deliberate second reading of it rather than an import: these two files
  load as classic scripts in an order neither controls, and a policy that
  silently stopped honouring the guarantee because a load order changed would be
  the worst possible failure. The suite pins the two together instead, so they
  can only disagree loudly.
*/
function pinnedOf(rev) {
  return !!(rev && typeof rev[FIELD] === 'string' && rev[FIELD].trim());
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
  const projects = [];
  let bytesBefore = 0;
  // What the milestones cost, and what the guarantee actually bought. Reported
  // rather than assumed: "4 milestones kept" is a fact, and "we would have
  // deleted 2 of them" is the fact that makes the feature worth having.
  const milestones = { kept: 0, savedByAge: 0, savedByCount: 0, savedByBudget: 0 };

  // Pass 1 — per project, newest first. Age and count are decided here because
  // both are about one project's own timeline.
  //
  // Rows are kept with their ORIGINAL index, because pass 2 drops by index too
  // and a second pass over a compacted list is how a prune deletes the wrong
  // snapshot: index 1 of what survived is not index 1 of what was stored.
  const keptById = {};
  Object.keys(source).forEach((id) => {
    const list = Array.isArray(source[id]) ? source[id] : [];
    const rows = [];
    let unnamed = 0; // how much of the rolling window is spent on disposable snapshots
    list.forEach((rev, index) => {
      const bytes = bytesOf(rev);
      bytesBefore += bytes;
      if (!rev || typeof rev !== 'object') { drop.push({ id, index, t: 0, bytes, why: 'empty' }); return; }
      const t = timeOf(rev);
      const pinned = pinnedOf(rev);
      const tooOld = !!(index > 0 && cutoff && t && t < cutoff);
      const overCount = unnamed >= r.maxPerProject;
      // A named milestone is not part of the rolling window at all: age and
      // count are rules about snapshots nobody chose to keep.
      const why = pinned ? '' : (tooOld ? 'age' : (overCount ? 'count' : ''));
      if (why) { drop.push({ id, index, t, bytes, why }); return; }
      if (pinned) {
        milestones.kept += 1;
        // Would the rule this row was just exempted from have removed it?
        if (tooOld) milestones.savedByAge += 1;
        // The old count rule measured position in the surviving list, so a
        // pinned row past the cap in its own list is exactly what it took out.
        if (index >= r.maxPerProject) milestones.savedByCount += 1;
      } else unnamed += 1;
      rows.push({ rev, index, t, bytes, pinned });
    });
    if (rows.length) keptById[id] = rows;
    projects.push({ id, before: list.length, after: rows.length });
  });

  // Pass 2 — the global byte budget, newest first across everything. Two kinds
  // of row are skipped rather than dropped: a milestone, and the last snapshot
  // left in its project. The cap may be exceeded before either promise breaks.
  if (r.budgetBytes > 0) {
    const flat = [];
    Object.keys(keptById).forEach((id) => { keptById[id].forEach((row) => flat.push({ id, row })); });
    flat.sort((a, b) => b.row.t - a.row.t);
    let total = 0;
    const gone = new Set();
    flat.forEach(({ id, row }) => {
      const survivors = keptById[id].reduce((n, x) => n + (gone.has(x) ? 0 : 1), 0);
      const overBudget = total + row.bytes > r.budgetBytes && survivors > 1;
      if (overBudget && !row.pinned) {
        gone.add(row);
        drop.push({ id, index: row.index, t: row.t, bytes: row.bytes, why: 'budget' });
        return;
      }
      if (overBudget && row.pinned) milestones.savedByBudget += 1;
      total += row.bytes;
    });
    if (gone.size) {
      Object.keys(keptById).forEach((id) => { keptById[id] = keptById[id].filter((row) => !gone.has(row)); });
    }
  }

  // Materialised once, after both passes, so what the plan says it keeps is
  // exactly what `apply` writes.
  const keep = {};
  Object.keys(keptById).forEach((id) => { if (keptById[id].length) keep[id] = keptById[id].map((row) => row.rev); });

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
    milestones,
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

const RevsPolicy = { DEFAULTS, PRESETS, MB, FIELD, rules, plan, apply, dropOrder, pressure, bytesOf, timeOf, pinnedOf };

if (typeof window !== 'undefined') window.RevsPolicy = RevsPolicy;
if (typeof module !== 'undefined' && module.exports) module.exports = RevsPolicy;
})();
