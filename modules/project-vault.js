'use strict';

/*
  ============================================================
  ProjectVault — a project file that is never half-written
  ------------------------------------------------------------
  Every export this app produces is either a download or a file, and a
  project file is the one artefact whose loss a user cannot undo. A
  single `writeFileSync` over an existing `.pallettai.json` is not
  safe: if the process dies, the disk fills, or the machine sleeps
  mid-write, the file is truncated — and the previous good version is
  already gone, because the same handle opened it for writing.

  So a save is never a write to the destination. It is a write to a
  temporary file, then a rename. A rename is atomic within a
  filesystem: the destination either still holds the old bytes or
  holds all of the new ones, and there is no window in which it holds
  neither. `data/schema.js` already states the same principle for the
  store's version sidecar — "a crash between the two would mark a
  value as converted when it is still in the old shape" — and this
  module is the file-system half of that rule.

  Four rules the implementation keeps:

  1. Validate before writing, not after. Malformed state is rejected
     before the destination is touched. A vault that saves a broken
     project *and* rotates out the last good snapshot has destroyed
     work while reporting success.

  2. Flush before rename. Writing and renaming without fsync leaves
     the new name pointing at content the OS has not committed, so a
     power loss can produce a valid name with an empty body. The
     write is flushed, then renamed.

  3. A failed save leaves the old file untouched and the temp file
     removed — never a stray `.pallettai.tmp` beside a project that
     the next run would have to reason about.

  4. Snapshots are rotated by count, and rotation never deletes the
     snapshot that was just written. The default of 10 is small
     enough to be invisible on disk and deep enough to recover from
     an edit made several saves ago.

  Note on validation: `modules/migration.js` already owns "is this a
  valid project" — it was written to read old files, which is the
  strict direction. This module calls it rather than re-deriving the
  rules, so a project that passes import is exactly a project that
  passes save. `modules/importer.js` is the upload-side validator and
  is composed too when it is available.
  ============================================================
*/

const fs = require('fs');
const path = require('path');

let Migration = null;
try { Migration = require(path.join(__dirname, 'migration.js')); } catch (e) { Migration = null; }

let Importer = null;
try { Importer = require(path.join(__dirname, 'importer.js')); } catch (e) { Importer = null; }

const TMP_SUFFIX = '.pallettai.tmp';
const DEFAULT_KEEP = 10;

function vaultRoot(opts) {
  const dir = opts && opts.dir;
  return dir ? String(dir) : path.join(__dirname, '..', '.pallettai');
}

/*
  A project id becomes a directory name, which makes it a path
  traversal sink if it is taken on trust. The same reasoning as the
  zip writer's path sanitiser: `..`, separators, control characters
  and a leading dot are refused rather than cleaned, because a
  silently-rewritten id is a snapshot filed under the wrong project.
*/
function safeProjectId(projectId) {
  const id = String(projectId == null ? '' : projectId).trim();
  if (!id) return { ok: false, reason: 'empty' };
  if (id.length > 80) return { ok: false, reason: 'too long' };
  if (id === '.' || id === '..') return { ok: false, reason: 'reserved' };
  if (/[/\\]/.test(id)) return { ok: false, reason: 'separator' };
  if (/[\u0000-\u001f\u007f]/.test(id)) return { ok: false, reason: 'control characters' };
  if (/^\./.test(id)) return { ok: false, reason: 'leading dot' };
  if (/[:*?"<>|]/.test(id)) return { ok: false, reason: 'characters not allowed in a filename' };
  return { ok: true, id };
}

// ---------------------------------------------------------------
// Validation
// ---------------------------------------------------------------

/*
  Structural integrity. Prefers the migration layer's validator, which
  is strict about the current shape, and additionally runs the
  importer's checks when that module is present. Returns errors, not a
  boolean, so a caller can say *why* a save was refused.
*/
function validateProject(projectData) {
  const errors = [];
  const warnings = [];
  let value = projectData;

  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch (e) {
      return { ok: false, errors: ['the project is not valid JSON: ' + (e && e.message ? e.message : e)], warnings };
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, errors: ['the project must be an object'], warnings };
  }

  // A partial state tree is the specific failure this module exists to
  // stop, so the two collections that make a project loadable are
  // required, not merely validated if present.
  const sections = (value.site && Array.isArray(value.site.sections)) ? value.site.sections
    : (Array.isArray(value.sections) ? value.sections
      : (Array.isArray(value.pages) ? [].concat.apply([], value.pages.map((p) => (p && Array.isArray(p.sections) ? p.sections : []))) : null));
  if (sections === null) errors.push('the project has no sections collection (site.sections, sections or pages[].sections)');

  if (Migration && typeof Migration.validateProjectSchema === 'function') {
    try {
      const res = Migration.validateProjectSchema(value);
      if (res && Array.isArray(res.errors)) errors.push.apply(errors, res.errors);
      if (res && Array.isArray(res.warnings)) warnings.push.apply(warnings, res.warnings);
    } catch (e) {
      warnings.push('the schema validator could not run: ' + (e && e.message ? e.message : e));
    }
  }

  if (Importer && typeof Importer.validateProject === 'function') {
    try {
      const res = Importer.validateProject(value);
      if (res && Array.isArray(res.errors)) errors.push.apply(errors, res.errors);
    } catch (e) {
      // The importer validates uploads, which is a different entry point;
      // its failure must not block a save that the schema validator allowed.
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

// ---------------------------------------------------------------
// Atomic write
// ---------------------------------------------------------------

/*
  Write text to a path so that either the old content or the new
  content exists, never a mixture. Returns the byte count written.

  The sequence is: open the temp file, write, flush with fsync, close,
  rename. Renaming over an existing file replaces it atomically on
  POSIX and on Windows (MoveFileEx with replace), so no explicit unlink
  is needed — and an unlink-then-rename would reintroduce exactly the
  window this avoids.
*/
/*
  The shared sequence for both payload kinds. Binary callers get their
  own entry point rather than a flag, because a zip cannot survive a
  round trip through a JS string — decoding it as UTF-8 destroys the
  archive — and a flag is easy to pass wrongly.
*/
function atomicWrite(filePath, buffer) {
  const dest = String(filePath);
  const dir = path.dirname(dest);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = dest + TMP_SUFFIX;
  let handle = null;
  try {
    handle = fs.openSync(tmp, 'w');
    fs.writeSync(handle, buffer, 0, buffer.length, 0);
    fs.fsyncSync(handle);
    fs.closeSync(handle);
    handle = null;
    fs.renameSync(tmp, dest);
    return { ok: true, bytes: buffer.length, path: dest };
  } catch (err) {
    if (handle !== null) {
      try { fs.closeSync(handle); } catch (e) { /* already closing */ }
    }
    // Rule 3: a failed save must not leave a temp file behind, and must
    // not have touched the destination.
    try { fs.rmSync(tmp, { force: true }); } catch (e) { /* nothing to remove */ }
    return { ok: false, error: String(err && err.message ? err.message : err), path: dest, bytes: 0 };
  }
}

function writeFileAtomic(filePath, text) {
  return atomicWrite(filePath, Buffer.from(String(text == null ? '' : text), 'utf8'));
}

function writeBytesAtomic(filePath, bytes) {
  return atomicWrite(filePath, Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || ''));
}

/*
  Save a project. Validation runs first, so a malformed tree is refused
  before the destination file is opened.
*/
function saveProjectAtomic(filePath, projectData, opts) {
  const check = opts && opts.skipValidation ? { ok: true, errors: [] } : validateProject(projectData);
  if (!check.ok) {
    return { ok: false, errors: check.errors, warnings: check.warnings, path: String(filePath), bytes: 0 };
  }
  const value = typeof projectData === 'string' ? JSON.parse(projectData) : projectData;
  const text = JSON.stringify(value, null, 2);
  const res = writeFileAtomic(filePath, text);
  return Object.assign({ errors: [], warnings: check.warnings || [] }, res);
}

// ---------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------

function projectDir(projectId, opts) {
  const safe = safeProjectId(projectId);
  if (!safe.ok) return { ok: false, reason: safe.reason };
  const dir = path.join(vaultRoot(opts), 'snapshots', safe.id);
  return { ok: true, dir, id: safe.id };
}

function stamp() {
  // Colons are legal on POSIX and illegal on Windows, and this runs on
  // both, so the timestamp is written in a filename-safe form.
  return new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, 'Z');
}

/*
  Write one snapshot and rotate. The new snapshot is never a rotation
  candidate, whatever `keep` is set to — losing the copy you just made
  would be the worst possible rotation order.
*/
function createSnapshot(projectId, projectData, opts) {
  const o = opts || {};
  const target = projectDir(projectId, o);
  if (!target.ok) return { ok: false, error: 'invalid project id: ' + target.reason, errors: ['invalid project id: ' + target.reason] };

  const check = o.skipValidation ? { ok: true, errors: [] } : validateProject(projectData);
  if (!check.ok) return { ok: false, errors: check.errors, warnings: check.warnings };

  const value = typeof projectData === 'string' ? JSON.parse(projectData) : projectData;
  const text = JSON.stringify(value, null, 2);

  fs.mkdirSync(target.dir, { recursive: true });

  // A second snapshot inside the same millisecond gets a suffix rather
  // than overwriting the first: a snapshot history with holes is not a
  // history.
  let id = stamp();
  let n = 1;
  while (fs.existsSync(path.join(target.dir, id + '.json'))) {
    id = stamp() + '-' + (++n);
  }

  const res = writeFileAtomic(path.join(target.dir, id + '.json'), text);
  if (!res.ok) return { ok: false, error: res.error, errors: [res.error] };

  const kept = listSnapshots(projectId, o);
  const limit = typeof o.keep === 'number' && o.keep > 0 ? Math.floor(o.keep) : DEFAULT_KEEP;
  const pruned = [];
  // Newest first, so anything past the limit is a candidate.
  kept.slice(limit).forEach((s) => {
    if (s.id === id) return; // rule: never rotate out what we just wrote
    try {
      fs.rmSync(path.join(target.dir, s.id + '.json'), { force: true });
      pruned.push(s.id);
    } catch (e) { /* rotation is best-effort; the snapshot is still on disk */ }
  });

  return {
    ok: true,
    id,
    bytes: res.bytes,
    path: res.path,
    count: kept.length - pruned.length,
    pruned,
    errors: []
  };
}

/*
  Snapshots for a project, newest first. Reads the directory rather
  than an index, because an index can disagree with the disk and the
  disk is what a restore actually reads.
*/
function listSnapshots(projectId, opts) {
  const target = projectDir(projectId, opts);
  if (!target.ok) return [];
  let names = [];
  try {
    names = fs.readdirSync(target.dir);
  } catch (e) {
    return [];
  }
  return names
    .filter((n) => n.endsWith('.json') && !n.endsWith(TMP_SUFFIX))
    .map((n) => {
      const full = path.join(target.dir, n);
      let bytes = 0;
      let at = 0;
      try {
        const st = fs.statSync(full);
        bytes = st.size;
        at = st.mtimeMs;
      } catch (e) { /* vanished between listing and reading */ }
      return { id: n.replace(/\.json$/, ''), file: full, bytes, at };
    })
    .sort((a, b) => (b.at - a.at) || (b.id < a.id ? -1 : 1));
}

/*
  Read a snapshot back. `snapshotId` may be an exact id or 'latest';
  either way the content is validated before it is handed over, so a
  truncated snapshot is reported instead of returned as a project that
  will fail somewhere further downstream.
*/
function restoreSnapshot(projectId, snapshotId, opts) {
  const o = opts || {};
  const list = listSnapshots(projectId, o);
  if (!list.length) return { ok: false, error: 'no snapshots for this project', errors: ['no snapshots for this project'] };

  let entry = null;
  const want = String(snapshotId == null ? 'latest' : snapshotId);
  if (want === 'latest' || want === '') entry = list[0];
  else entry = list.find((s) => s.id === want) || null;
  if (!entry) return { ok: false, error: 'no snapshot named ' + want, errors: ['no snapshot named ' + want] };

  let raw = '';
  try {
    raw = fs.readFileSync(entry.file, 'utf8');
  } catch (e) {
    return { ok: false, error: 'could not read the snapshot: ' + (e && e.message ? e.message : e), errors: [] };
  }

  let project = null;
  try {
    project = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: 'the snapshot is not valid JSON', errors: ['the snapshot is not valid JSON'], id: entry.id };
  }

  const check = validateProject(project);
  if (!check.ok && o.requireValid !== false) {
    return { ok: false, error: 'the snapshot is not a valid project', errors: check.errors, id: entry.id, raw };
  }

  return { ok: true, id: entry.id, at: entry.at, bytes: entry.bytes, project, raw, warnings: check.warnings, errors: [] };
}

/*
  Restore into the destination file, through the same atomic path a
  save uses — a restore that can itself be interrupted is not a
  recovery.
*/
function restoreInto(filePath, projectId, snapshotId, opts) {
  const res = restoreSnapshot(projectId, snapshotId, opts);
  if (!res.ok) return res;
  const saved = saveProjectAtomic(filePath, res.project, Object.assign({}, opts, { skipValidation: true }));
  return Object.assign({}, res, { ok: saved.ok, written: saved.ok, path: saved.path, bytes: saved.bytes });
}

// ---------------------------------------------------------------
// Housekeeping
// ---------------------------------------------------------------

function vaultInfo(projectIds, opts) {
  const ids = Array.isArray(projectIds) ? projectIds : [];
  const projects = ids.map((id) => ({ id, snapshots: listSnapshots(id, opts).length }));
  let bytes = 0;
  ids.forEach((id) => {
    listSnapshots(id, opts).forEach((s) => { bytes += s.bytes; });
  });
  return { root: vaultRoot(opts), projects, bytes, tempLeftBehind: findTempFiles(opts) };
}

/*
  A temp file in the vault means a write did not complete. It is
  reported rather than cleaned automatically: it is the only remaining
  copy of whatever was being written, and deleting it would be the
  wrong instinct.
*/
function findTempFiles(opts) {
  const out = [];
  const base = path.join(vaultRoot(opts), 'snapshots');
  const walk = (dir) => {
    let names = [];
    try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    names.forEach((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(TMP_SUFFIX)) out.push(full);
    });
  };
  walk(base);
  return out;
}

module.exports = {
  TMP_SUFFIX,
  DEFAULT_KEEP,
  vaultRoot,
  safeProjectId,
  validateProject,
  writeFileAtomic,
  writeBytesAtomic,
  atomicWrite,
  saveProjectAtomic,
  createSnapshot,
  listSnapshots,
  restoreSnapshot,
  restoreInto,
  vaultInfo,
  findTempFiles
};
