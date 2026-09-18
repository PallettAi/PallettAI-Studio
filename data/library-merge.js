/*
  Wrapped in an IIFE on purpose: this loads as a classic script, so every
  top-level `const` here shares the global scope with every other script on the
  page. A name as ordinary as KINDS already belongs to another module, and a
  duplicate `const` is a SyntaxError that kills the whole file — leaving the
  module undefined and its callers reporting an empty format registry.
*/
(function () {
'use strict';

/*
  ============================================================
  LibraryMerge — what a backup file holds, and what to do with it
  ------------------------------------------------------------
  Restoring a backup used to be a single all-or-nothing action:
  every key in the file is written over every key in the library,
  then the page reloads. That is the correct meaning of
  "restore", and it is a terrible thing to offer as the only
  choice, because the common case is not disaster recovery —
  it is "I have my laptop and my desktop, and I want the
  projects from the other one here".

  Faced with that, replacing the library loses precisely the
  work you were trying to keep. So this module answers three
  questions in order, each without touching anything:

    1. WHAT IS IN THIS FILE?  Kind, date, studio version, and
       per-key detail — including how many projects/assets/
       snapshots, read from the backup's own values.
    2. HOW DOES IT COMPARE TO WHAT I HAVE?  Per key: identical,
       missing locally, or different — with both sizes and, for
       lists, both counts. "Different" alone is useless when the
       difference is 7 projects versus 4.
    3. WHAT WOULD EACH CHOICE DO?  Either replace (the old
       behaviour, stated plainly with what it costs) or merge:
       add what is missing, keep the newer copy of anything both
       sides have, and never drop something that exists only
       here. Merging is the safe direction, so it is the default.

  Everything above is pure: it takes the current library's raw
  strings as an argument and returns a plan. The caller does the
  writing, which is what makes all of this testable.
  ============================================================ */

const BACKUP_KIND = 'pallettai-library-backup';

// The app's own capture cap (captureRevision keeps 12 UNNAMED snapshots per
// project). Named here so a change there is a visible change in this file too.
const REV_CAP = 12;

// The field that makes a snapshot a named milestone. Mirrors Milestones.FIELD
// and RevsPolicy.FIELD; the suite pins all three together rather than trusting
// a comment. A merge that dropped one while the app called it protected would
// be the worst place for the two files to disagree.
const PIN_FIELD = 'pin';

function pinnedOf(rev) {
  return !!(rev && typeof rev[PIN_FIELD] === 'string' && rev[PIN_FIELD].trim());
}

/*
  Two copies of one snapshot, from two machines.

  Identity here is the timestamp, which is how this file has always matched
  revisions up — and it is not enough any more, because the two copies can
  differ in whether they are named. Pinning on the laptop and merging on the
  desktop used to mean whichever side happened to be read first won, so a
  milestone could arrive and be silently discarded. A name is a decision, so it
  outranks the unnamed copy; between two names, the later deliberate one wins.
*/
function betterCopy(mine, theirs) {
  if (!pinnedOf(theirs)) return mine;
  if (!pinnedOf(mine)) return theirs;
  return (Number(theirs.pinAt) || 0) > (Number(mine.pinAt) || 0) ? theirs : mine;
}

// Newest-first list, capped at `cap` UNNAMED snapshots — every milestone is
// kept whatever the cap says, which is the guarantee the app makes.
function keepNamed(list, cap) {
  const out = [];
  let seats = 0;
  (Array.isArray(list) ? list : []).forEach((rev) => {
    if (pinnedOf(rev)) { out.push(rev); return; }
    if (seats < cap) { seats += 1; out.push(rev); }
  });
  return out;
}

// What each stored key holds, so the report can count things instead of only
// weighing them. Keys the app does not know are reported, not guessed at.
const KINDS = {
  'pallettai.projects.v1': { kind: 'list', label: 'Projects', item: 'project' },
  'pallettai.assets.v1': { kind: 'list', label: 'Assets', item: 'asset' },
  'pallettai.sectionPresets.v1': { kind: 'list', label: 'Section presets', item: 'preset' },
  'pallettai.brandPresets.v1': { kind: 'list', label: 'Brand presets', item: 'brand preset' },
  'pallettai.briefs.v1': { kind: 'list', label: 'Briefs', item: 'brief' },
  'pallettai.revisions.v1': { kind: 'revisions', label: 'Autosave history', item: 'snapshot' },
  'pallettai.settings.v1': { kind: 'settings', label: 'Settings', item: 'setting' },
  'pallettai.schema.v1': { kind: 'settings', label: 'Format versions', item: 'version' }
};

// Which field says when an item was last touched. Different keys use different
// names because they were written by different features at different times,
// and inventing a single field now would mean dropping the real one.
const STAMPS = ['updatedAt', 'savedAt', 'addedAt', 'createdAt', 't'];

function bytes(text) {
  const s = typeof text === 'string' ? text : String(text === undefined || text === null ? '' : text);
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length;
  if (typeof Buffer !== 'undefined') return Buffer.byteLength(s, 'utf8');
  return s.length;
}

function parse(raw) {
  if (typeof raw !== 'string') return { ok: false, value: null, error: 'not stored as text' };
  try {
    return { ok: true, value: JSON.parse(raw), error: '' };
  } catch (e) {
    return { ok: false, value: null, error: 'could not be read as JSON' };
  }
}

function stampOf(item, kind) {
  if (!item || typeof item !== 'object') return 0;
  for (const field of STAMPS) {
    const t = Date.parse(item[field]);
    if (Number.isFinite(t)) return t;
    const n = Number(item[field]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  if (kind === 'revisions') return 0;
  return 0;
}

// Stable identity for an item that may have no id of its own (older presets
// were saved by name). Falling back to the name is not a guess: two presets
// with the same name and different contents are already indistinguishable in
// the picker, so merging them is the same decision the user made when saving.
function keyOf(item, index) {
  if (!item || typeof item !== 'object') return '#' + index;
  return String(item.id || item.slug || item.name || item.label || '#' + index);
}

/*
  What is in one raw value? Counts, ids and stamps only — never the contents,
  because the point is to describe a file the user is about to trust.
*/
function summarise(raw, key) {
  const meta = KINDS[key] || { kind: 'raw', label: key, item: 'item' };
  const out = { key, label: meta.label, kind: meta.kind, items: 0, unit: meta.item, ids: [], stamps: {}, parsed: false, error: '' };
  const got = parse(raw);
  if (!got.ok) { out.error = got.error; return out; }
  out.parsed = true;
  const value = got.value;
  if (meta.kind === 'list') {
    const list = Array.isArray(value) ? value : [];
    out.items = list.length;
    list.forEach((item, i) => { const k = keyOf(item, i); out.ids.push(k); out.stamps[k] = stampOf(item, meta.kind); });
    return out;
  }
  if (meta.kind === 'revisions') {
    const map = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const ids = Object.keys(map);
    let count = 0;
    ids.forEach((id) => {
      const list = Array.isArray(map[id]) ? map[id] : [];
      count += list.length;
      list.forEach((rev, i) => {
        const k = id + ':' + (rev && rev.t ? rev.t : '#' + i);
        out.stamps[k] = stampOf(rev, 'revisions');
      });
    });
    out.items = count;
    out.ids = ids;
    out.projects = ids.length;
    return out;
  }
  // settings and anything unrecognised: count the fields, no deeper meaning.
  const obj = value && typeof value === 'object' ? value : {};
  out.items = Array.isArray(obj) ? obj.length : Object.keys(obj).length;
  out.ids = Object.keys(obj);
  return out;
}

/*
  Read a backup file. Returns a result rather than throwing, because this runs
  on whatever the user dropped into the file picker.
*/
function inspect(raw, current) {
  let data = raw;
  if (typeof raw === 'string') {
    const got = parse(raw);
    if (!got.ok) return { ok: false, error: 'That file is not valid JSON.' };
    data = got.value;
  }
  if (!data || typeof data !== 'object') return { ok: false, error: 'That file is not a PallettAI backup.' };
  if (data.kind !== BACKUP_KIND) {
    return { ok: false, error: data.kind ? 'That is a "' + String(data.kind) + '" file, not a studio library backup.' : 'That file has no library signature.' };
  }
  const values = data.values && typeof data.values === 'object' ? data.values : null;
  if (!values) return { ok: false, error: 'That backup holds no library keys.' };

  const here = current || {};
  const keys = Object.keys(values).filter((k) => typeof values[k] === 'string');
  if (!keys.length) return { ok: false, error: 'That backup holds no library keys.' };

  const entries = keys.map((key) => {
    const incoming = values[key];
    const has = Object.prototype.hasOwnProperty.call(here, key) && typeof here[key] === 'string';
    const mine = has ? here[key] : '';
    const entry = {
      key,
      label: (KINDS[key] || {}).label || key,
      bytes: bytes(incoming),
      currentBytes: has ? bytes(mine) : 0,
      state: !has ? 'new' : (mine === incoming ? 'same' : 'differs')
    };
    const inSum = summarise(incoming, key);
    const mySum = has ? summarise(mine, key) : null;
    entry.incoming = { items: inSum.items, unit: inSum.unit, parsed: inSum.parsed, error: inSum.error, projects: inSum.projects };
    entry.current = mySum ? { items: mySum.items, unit: mySum.unit, parsed: mySum.parsed, error: mySum.error, projects: mySum.projects } : null;
    return entry;
  });

  const totIn = entries.reduce((n, e) => n + e.bytes, 0);
  const totNow = entries.reduce((n, e) => n + e.currentBytes, 0);
  return {
    ok: true,
    exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : '',
    studio: typeof data.studio === 'string' ? data.studio : '',
    declaredBytes: Number(data.bytes) || 0,
    version: Number(data.version) || 1,
    keys: entries,
    summary: {
      keys: entries.length,
      added: entries.filter((e) => e.state === 'new').length,
      same: entries.filter((e) => e.state === 'same').length,
      differs: entries.filter((e) => e.state === 'differs').length,
      bytes: totIn,
      currentBytes: totNow
    },
    values
  };
}

/*
  Union two stored values.

  The rule for every kind: something that exists only on one side survives, and
  when both sides have it the newer copy wins. Nothing is ever dropped, which is
  the whole difference between this and replacing — a merge that can lose work is
  a replace with extra steps.

  Returns counts so the UI can say what actually happened rather than "merged".
*/
function union(currentRaw, incomingRaw, key) {
  const meta = KINDS[key] || { kind: 'raw', label: key, item: 'item' };
  const out = { ok: false, raw: incomingRaw, added: 0, updated: 0, keptOlder: 0, keptMine: 0, error: '', unchanged: false, capped: 0, milestones: 0, note: '' };
  const mine = parse(currentRaw);
  const theirs = parse(incomingRaw);
  if (!theirs.ok) { out.error = 'the backup copy of ' + meta.label + ' ' + theirs.error; return out; }
  if (!mine.ok) {
    // Nothing readable to merge with: the backup copy is strictly more than we
    // have, so it wins. Reported as "added" rather than silently written.
    out.ok = true;
    out.raw = incomingRaw;
    out.added = 1;
    out.note = currentRaw ? 'the copy already here could not be read, so the backup copy is used' : '';
    return out;
  }

  if (meta.kind === 'list') {
    const a = Array.isArray(mine.value) ? mine.value : [];
    const b = Array.isArray(theirs.value) ? theirs.value : [];
    const byKey = new Map();
    a.forEach((item, i) => byKey.set(keyOf(item, i), { item, from: 'mine' }));
    b.forEach((item, i) => {
      const k = keyOf(item, i);
      const had = byKey.get(k);
      if (!had) { byKey.set(k, { item, from: 'theirs' }); out.added += 1; return; }
      const tMine = stampOf(had.item, meta.kind);
      const tTheirs = stampOf(item, meta.kind);
      // A tie goes to what is already here: the merge must be a no-op when the
      // two sides are the same library, or every merge would rewrite the volume.
      if (tTheirs > tMine) { byKey.set(k, { item, from: 'theirs' }); out.updated += 1; }
      else { out.keptMine += 1; if (tTheirs && tMine) out.keptOlder += 1; }
    });
    const merged = Array.from(byKey.values()).map((x) => x.item);
    const raw = JSON.stringify(merged);
    out.ok = true;
    out.raw = raw;
    out.unchanged = raw === currentRaw;
    out.total = merged.length;
    return out;
  }

  if (meta.kind === 'revisions') {
    const a = mine.value && typeof mine.value === 'object' && !Array.isArray(mine.value) ? mine.value : {};
    const b = theirs.value && typeof theirs.value === 'object' && !Array.isArray(theirs.value) ? theirs.value : {};
    const merged = {};
    const ids = Object.keys(a);
    Object.keys(b).forEach((id) => { if (ids.indexOf(id) === -1) ids.push(id); });
    ids.forEach((id) => {
      const mineList = Array.isArray(a[id]) ? a[id].filter((rev) => rev && typeof rev === 'object') : [];
      const theirsList = Array.isArray(b[id]) ? b[id].filter((rev) => rev && typeof rev === 'object') : [];
      const byTime = new Map();
      mineList.forEach((rev) => { byTime.set(String(rev.t || ''), rev); });
      theirsList.forEach((rev) => {
        const key2 = String(rev.t || '');
        const had = byTime.get(key2);
        if (!had) { byTime.set(key2, rev); out.added += 1; return; }
        const winner = betterCopy(had, rev);
        if (winner !== had) { byTime.set(key2, winner); out.updated += 1; }
      });
      // Newest first, then the same cap the app applies when capturing — an
      // unbounded union would breach the library's own size ceiling. The cap
      // counts unnamed snapshots only.
      const list = Array.from(byTime.values()).sort((x, y) => (Number(y && y.t) || 0) - (Number(x && x.t) || 0));
      const kept = keepNamed(list, REV_CAP);
      out.capped += list.length - kept.length;
      out.milestones += kept.filter(pinnedOf).length;
      merged[id] = kept;
    });
    const raw = JSON.stringify(merged);
    out.ok = true;
    out.raw = raw;
    out.unchanged = raw === currentRaw;
    out.total = Object.keys(merged).reduce((n, id) => n + merged[id].length, 0);
    if (out.capped) out.note = out.capped + ' older unnamed ' + (out.capped === 1 ? 'snapshot was' : 'snapshots were') + ' dropped past the ' + REV_CAP + '-per-project limit';
    if (out.milestones) {
      out.note = (out.note ? out.note + ' ' : '') + out.milestones + ' named milestone'
        + (out.milestones === 1 ? ' is' : 's are') + ' kept, and never counted against that limit.';
    }
    return out;
  }

  // Settings and unknown blobs: fill gaps only. A setting that is present now
  // is a deliberate change since the backup, and a merge is not the place to
  // silently undo it.
  const a = mine.value && typeof mine.value === 'object' && !Array.isArray(mine.value) ? mine.value : {};
  const b = theirs.value && typeof theirs.value === 'object' && !Array.isArray(theirs.value) ? theirs.value : {};
  const merged = Object.assign({}, b);
  Object.keys(a).forEach((k) => { if (a[k] !== null && a[k] !== undefined) merged[k] = a[k]; });
  Object.keys(b).forEach((k) => { if (!(k in a)) out.added += 1; else out.keptMine += 1; });
  const raw = JSON.stringify(merged);
  out.ok = true;
  out.raw = raw;
  out.unchanged = raw === currentRaw;
  out.total = Object.keys(merged).length;
  return out;
}

/*
  Plan the whole operation.

  mode: 'merge' (default, additive) or 'replace' (the file wins outright).
  only: optional array of keys — the per-key checkboxes.

  Every entry ends as 'write', 'skip' or 'blocked', and a replace plan states
  what it is about to remove, because the old flow said "replaces the studio's
  local database" without ever saying with how much.
*/
function planMerge(inspection, current, options) {
  const opts = options || {};
  const mode = opts.mode === 'replace' ? 'replace' : 'merge';
  const only = Array.isArray(opts.only) && opts.only.length ? opts.only : null;
  const here = current || {};
  const out = { ok: false, mode, writes: [], skips: [], blocked: [], added: 0, updated: 0, bytes: 0, removedItems: 0, error: '', warnings: [] };
  if (!inspection || !inspection.ok) { out.error = (inspection && inspection.error) || 'No backup was read.'; return out; }

  inspection.keys.forEach((entry) => {
    if (only && only.indexOf(entry.key) === -1) { out.skips.push({ key: entry.key, label: entry.label, why: 'not selected' }); return; }
    if (mode === 'replace') {
      const lost = entry.current && entry.incoming && entry.current.items > entry.incoming.items ? entry.current.items - entry.incoming.items : 0;
      if (lost) out.removedItems += lost;
      out.writes.push({ key: entry.key, label: entry.label, raw: inspection.values[entry.key], action: entry.state === 'same' ? 'rewrite' : 'replace', added: entry.incoming ? entry.incoming.items : 0 });
      out.bytes += entry.bytes;
      return;
    }
    const result = union(here[entry.key], inspection.values[entry.key], entry.key);
    if (!result.ok) { out.blocked.push({ key: entry.key, label: entry.label, why: result.error }); return; }
    if (result.unchanged) { out.skips.push({ key: entry.key, label: entry.label, why: 'already identical' }); return; }
    out.writes.push({
      key: entry.key,
      label: entry.label,
      raw: result.raw,
      action: entry.state === 'new' ? 'add' : (result.added ? 'merge' : 'keep yours'),
      added: result.added,
      updated: result.updated,
      total: result.total,
      note: result.note,
      grewBy: bytes(result.raw) - (typeof here[entry.key] === 'string' ? bytes(here[entry.key]) : 0)
    });
    out.added += result.added;
    out.updated += result.updated;
    out.bytes += bytes(result.raw);
    if (result.note) out.warnings.push(result.label + ': ' + result.note);
  });

  out.ok = out.writes.length > 0;
  if (!out.ok && !out.error) out.error = out.blocked.length ? 'Nothing could be merged from that backup.' : 'There is nothing in that backup to merge.';
  return out;
}

const LibraryMerge = { BACKUP_KIND, KINDS, REV_CAP, PIN_FIELD, pinnedOf, keepNamed, betterCopy, inspect, summarise, union, planMerge, bytes, stampOf, keyOf };

if (typeof window !== 'undefined') window.LibraryMerge = LibraryMerge;
if (typeof module !== 'undefined' && module.exports) module.exports = LibraryMerge;
})();
