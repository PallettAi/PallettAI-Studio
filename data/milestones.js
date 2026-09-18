/*
  Wrapped in an IIFE on purpose: this loads as a classic script, so every
  top-level `const` here shares the global scope with every other script on the
  page. A duplicate `const` is a SyntaxError that takes the whole file down, and
  a duplicate `function` silently lets the last file to load win. Neither is
  acceptable, so nothing here leaks out except Milestones.
*/
(function () {
'use strict';

/*
  ============================================================
  Milestones — named restore points in autosave history
  ------------------------------------------------------------
  Autosave history answers "what did this look like a minute
  ago?". It does not answer the question a freelancer actually
  gets asked, which is "can we go back to the version you sent
  me on Tuesday?".

  Two things stop it answering that:

    1. None of the snapshots have names. Twelve timestamped
       rows are a log, not a decision — "17/09 14:02" is not
       something anyone agrees to in writing.
    2. Every snapshot is disposable. The rollover keeps 12 per
       project, the retention policy prunes by age and by byte
       budget, and a merge with a second machine caps again at
       12. Whatever the client signed off on is eventually the
       oldest row, and the oldest row is the one that goes.

  So a milestone is a snapshot with a name, and the whole of
  its value is the second half: a named snapshot is NEVER
  dropped. Not by the rollover, not by the retention policy,
  not by a library merge. That guarantee is what makes pinning
  worth doing, and it is asserted in the suite rather than
  described in this comment.

  Everything here is pure and takes the clock as an argument,
  so the app can preview a decision before it takes one.
  ============================================================ */

// The field that makes a revision a milestone. A plain string — the name — so
// an older build that does not know about milestones still round-trips the
// snapshot, just without the protection.
const FIELD = 'pin';

// How many snapshots the ROLLOVER keeps per project, unpinned. Named here, and
// asserted against app.js's capture cap and LibraryMerge.REV_CAP by the suite:
// a change in one of those places and not the others is how a milestone gets
// quietly deleted by a code path nobody was looking at.
const ROLLOVER = 12;

// Names are read back in a modal and written into exports and diffs, so they
// are cleaned on the way in rather than escaped everywhere on the way out.
const NAME_MAX = 60;

/*
  How many milestones each tier keeps, per project.

  Free gets one. That is a deliberate funnel rather than a stray leak: the one
  thing that sells this feature is having used it once, and a free user who
  pins the version a client signed off on has felt the point of it. The caps
  are per project, not global, because the promise is about one project's
  history — a global budget would mean pinning a new client's sign-off could
  push an old one out, which is precisely the behaviour this replaces.
*/
const LIMITS = { free: 1, pro: 10, proplus: 25 };

// Tier names, for the message that names what a bigger plan would get.
const TIER_NAMES = { free: 'Free', pro: 'Pro', proplus: 'Pro+' };

const bytesOf = (rev) => (rev && typeof rev.snap === 'string' ? rev.snap.length : 0);
const timeOf = (rev) => {
  const t = Number(rev && rev.t);
  return Number.isFinite(t) && t > 0 ? t : 0;
};

// Trim, collapse whitespace, drop control characters, cap the length. An empty
// result is not a name — `fallback` is used when the caller has one, and the
// pin refuses when it does not, rather than inventing a label.
function cleanName(raw, fallback) {
  const cleaned = String(raw === null || raw === undefined ? '' : raw)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
  if (cleaned) return cleaned;
  return fallback ? String(fallback).replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) : '';
}

function isPinned(rev) {
  return !!(rev && typeof rev[FIELD] === 'string' && rev[FIELD].trim());
}

function nameOf(rev) {
  return isPinned(rev) ? cleanName(rev[FIELD], '') : '';
}

function pinnedCount(list) {
  return (Array.isArray(list) ? list : []).filter(isPinned).length;
}

// Milestones across a whole revisions map — what the storage panel reports.
function pinnedIn(revs) {
  if (!revs || typeof revs !== 'object') return 0;
  return Object.keys(revs).reduce((n, id) => n + pinnedCount(revs[id]), 0);
}

// A tier id that this file does not know is treated as Free, never as
// unlimited: an unknown plan is a reason to protect nothing, not everything.
function limitFor(planId) {
  const id = String(planId || 'free').toLowerCase();
  return Object.prototype.hasOwnProperty.call(LIMITS, id) ? LIMITS[id] : LIMITS.free;
}

/*
  Name a snapshot, or refuse and say why.

  Returns a copy rather than mutating: the caller holds the live revisions map,
  and a refused pin that had already been half-written would leave a milestone
  with no name — which is a row that looks protected and is not.
*/
function pin(rev, rawName, nowMs) {
  if (!rev || typeof rev !== 'object') return { ok: false, rev: null, name: '', error: 'That snapshot could not be read.' };
  if (typeof rev.snap !== 'string' || !rev.snap) return { ok: false, rev: null, name: '', error: 'There is nothing stored in that snapshot to keep.' };
  const name = cleanName(rawName, '');
  if (!name) return { ok: false, rev: null, name: '', error: 'Give this milestone a name first — the name is what makes it worth keeping.' };
  const at = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  const next = { ...rev, [FIELD]: name, pinAt: at };
  return { ok: true, rev: next, name, error: '' };
}

// Unpinning is the only way a milestone becomes disposable again, which is why
// the history row offers Unpin where an unpinned row offers Delete.
function unpin(rev) {
  if (!rev || typeof rev !== 'object') return { ok: false, rev: null, error: 'That snapshot could not be read.' };
  const next = { ...rev };
  delete next[FIELD];
  delete next.pinAt;
  return { ok: true, rev: next, error: '' };
}

/*
  May this project take another milestone?

  planId is the tier the account is on. The answer carries the message, not
  just a boolean, because there are two different refusals here — "you are out
  of room on a plan that has this feature" and "this plan does not have this
  feature yet" — and a caller left to write its own copy gets them the wrong
  way round.
*/
function canPin(revs, projectId, planId) {
  const list = revs && Array.isArray(revs[projectId]) ? revs[projectId] : [];
  const used = pinnedCount(list);
  const plan = Object.prototype.hasOwnProperty.call(LIMITS, String(planId || '').toLowerCase())
    ? String(planId).toLowerCase()
    : 'free';
  const limit = LIMITS[plan];
  const ok = used < limit;
  const nextTier = plan === 'free' ? 'pro' : plan === 'pro' ? 'proplus' : '';
  let message = '';
  if (!ok) {
    message = TIER_NAMES[plan] + ' keeps ' + limit + ' milestone' + (limit === 1 ? '' : 's') + ' per project';
    if (plan === 'free') {
      // Both tiers are named, not just the next one up: a free creator deciding
      // whether this is worth paying for needs to see where the ceiling is, and
      // "Pro gives you ten" reads as the end of the road at ten.
      message += ' — Pro keeps ' + LIMITS.pro + ' and Pro+ ' + LIMITS.proplus + '. A milestone is never pruned once it is named.';
    } else if (nextTier) {
      message += ' — ' + TIER_NAMES[nextTier] + ' keeps ' + LIMITS[nextTier] + '.';
    } else {
      message += '. Unpin one to make room for another.';
    }
  }
  return { ok, used, limit, remaining: Math.max(0, limit - used), plan, message };
}

/*
  The capture-time rollover, with the guarantee.

  Newest-first in, newest-first out. Named snapshots are kept before the cap is
  counted at all, so a project with 25 milestones and a fresh autosave holds 26
  rows rather than trading one for the other. The length `limit` is a cap on
  UNPINNED snapshots, which is the only reading under which a milestone is
  actually protected.
*/
function rollover(list, cap) {
  const source = Array.isArray(list) ? list.filter(Boolean) : [];
  const limit = Number.isFinite(Number(cap)) && Number(cap) >= 1 ? Math.floor(Number(cap)) : ROLLOVER;
  const kept = [];
  const dropped = [];
  let seats = 0;
  source.forEach((rev, index) => {
    if (isPinned(rev)) { kept.push(rev); return; }
    if (seats < limit) { seats += 1; kept.push(rev); return; }
    dropped.push({ index, t: timeOf(rev), bytes: bytesOf(rev) });
  });
  return { list: kept, dropped, pinned: kept.length - seats, cap: limit };
}

/*
  The cross-project byte budget, with the same guarantee.

  Two rows survive the budget no matter what it says: a pinned snapshot, and a
  project's newest snapshot. The second rule is the retention policy's own
  ("a policy whose worst case is losing the only restore point is worse than no
  policy") applied at capture time, where it was previously missing — the old
  inline prune could empty a small project's history entirely while keeping a
  large one's, purely because of where the global sort happened to land.

  The budget is therefore a target, not a wall. The count of what was dropped is
  returned so the caller can say so rather than guess.
*/
function trimToBudget(revs, budgetBytes) {
  const budget = Math.max(0, Number(budgetBytes) || 0);
  const unlimited = !budget;
  const source = revs && typeof revs === 'object' ? revs : {};
  const rows = [];
  Object.keys(source).forEach((id) => {
    const list = Array.isArray(source[id]) ? source[id] : [];
    list.forEach((rev, index) => {
      if (!rev || typeof rev !== 'object') return;
      rows.push({ id, rev, index, t: timeOf(rev), bytes: bytesOf(rev) });
    });
  });
  // Newest first across everything, so the budget is spent on the freshest
  // snapshots. Ties keep insertion order, which keeps this deterministic.
  rows.sort((a, b) => b.t - a.t);

  const out = {};
  const dropped = [];
  let total = 0;
  let pinned = 0;
  let bytesFreed = 0;
  rows.forEach((row) => {
    const milestone = isPinned(row.rev);
    const onlyOne = row.index === 0; // newest snapshot of its project
    if (milestone || onlyOne || unlimited || total + row.bytes <= budget) {
      (out[row.id] = out[row.id] || []).push(row.rev);
      total += row.bytes;
      if (milestone) pinned += 1;
      return;
    }
    dropped.push({ id: row.id, index: row.index, t: row.t, bytes: row.bytes });
    bytesFreed += row.bytes;
  });

  return { revs: out, dropped, bytesFreed, total, pinned, over: !unlimited && total > budget, budget };
}

/*
  What the history view needs to say about one project, in one place: how many
  snapshots there are, how many are milestones, and whether the rollover is
  holding unpinned rows back because milestones have taken the room.
*/
function report(revs, projectId, planId) {
  const list = revs && Array.isArray(revs[projectId]) ? revs[projectId].filter(Boolean) : [];
  const promo = canPin(revs, projectId, planId);
  return {
    total: list.length,
    pinned: pinnedCount(list),
    unpinned: list.length - pinnedCount(list),
    limit: promo.limit,
    remaining: promo.remaining,
    atLimit: !promo.ok,
    message: promo.message
  };
}

const Milestones = {
  FIELD, ROLLOVER, NAME_MAX, LIMITS, TIER_NAMES,
  cleanName, isPinned, nameOf, pinnedCount, pinnedIn,
  limitFor, canPin, pin, unpin, rollover, trimToBudget, report, bytesOf, timeOf
};

if (typeof window !== 'undefined') window.Milestones = Milestones;
if (typeof module !== 'undefined' && module.exports) module.exports = Milestones;
})();
