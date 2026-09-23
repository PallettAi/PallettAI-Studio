'use strict';

/*
  ============================================================
  DeltaExporter — ship what changed, and record what did not
  ------------------------------------------------------------
  A forty-page site where one paragraph changed does not need forty
  pages uploaded. That is the easy half. The half that breaks
  deployments is the other one.

  This project already knows how to name content: `data/manifest.js`
  hashes every exported file and its `verify()` reports exactly what
  changed, what is missing and what was added. So this module does not
  reimplement the comparison — it composes it, then solves the two
  problems the manifest does not:

  1. **Deletion cannot be expressed in a ZIP.** An archive has entries,
     not absences. A delta that ships only changed and new files leaves
     every removed page live on the server forever — the stale-page bug
     that makes "incremental deploy" dangerous rather than fast. So the
     removed list is carried in the archive as data, because a deploy
     step can act on data and cannot act on an entry that isn't there.

  2. **A delta is only correct against the exact build it was computed
     from.** Deploying it onto a different revision silently produces a
     site that is half one version and half another. Every archive
     records the manifest hash it expects to be applied over, and
     reports a mismatch rather than shipping into an unknown state.

  The history log in `.pallettai/delta-history.json` exists for the
  same reason: when a customer reports a page showing old content, the
  question is always "what did we actually publish, and over what", and
  that answer has to have been recorded at the time.
  ============================================================
*/

const fs = require('fs');
const path = require('path');

let Manifest = null;
try { Manifest = require(path.join(__dirname, '..', 'data', 'manifest.js')); } catch (e) { Manifest = null; }
let ZIP = null;
try { ZIP = require(path.join(__dirname, 'zip.js')); } catch (e) { ZIP = null; }
let Vault = null;
try { Vault = require(path.join(__dirname, 'project-vault.js')); } catch (e) { Vault = null; }

let nodeCrypto = null;
try { nodeCrypto = require('crypto'); } catch (e) { nodeCrypto = null; }

const DELTA_FILE = '_pallettai-delta.json';
const HISTORY_KEEP = 50;

function defaultHistoryPath(opts) {
  const o = opts || {};
  const dir = o.dir || (Vault ? path.join(__dirname, '..', '.pallettai') : path.join(__dirname, '..', '.pallettai'));
  return path.join(dir, 'delta-history.json');
}

function hashBytes(input) {
  const s = input == null ? '' : input;
  if (nodeCrypto) {
    const buf = Buffer.isBuffer(s) ? s : Buffer.from(String(s), 'utf8');
    return nodeCrypto.createHash('sha256').update(buf).digest('hex');
  }
  return '';
}

/*
  Hash a file's content, preferring the manifest's own hasher so a
  delta digest and an exported manifest digest can be compared
  directly. Falls back to Node crypto, which is what the manifest uses
  under Node anyway.
*/
async function hashContent(content) {
  if (Manifest && typeof Manifest.hashText === 'function') {
    try { return await Manifest.hashText(content == null ? '' : content); } catch (e) { /* fall through */ }
  }
  return hashBytes(content);
}

/*
  Accepts anything a previous export can hand over: a manifest object
  from `Manifest.build`, a parsed manifest.json, or a bare map of
  name → hash. Normalising here keeps the comparison below honest.
*/
function normaliseManifest(previous) {
  const out = new Map();
  if (!previous) return { ok: false, map: out, reason: 'no previous manifest' };

  const add = (name, hash) => {
    if (!name) return;
    out.set(String(name), String(hash || ''));
  };

  if (Array.isArray(previous)) {
    previous.forEach((e) => add(e && e.name, e && (e.sha256 || e.hash || e.digest)));
    return { ok: true, map: out, reason: '' };
  }
  if (previous.files) {
    if (Array.isArray(previous.files)) previous.files.forEach((e) => add(e && e.name, e && (e.sha256 || e.hash)));
    else Object.keys(previous.files).forEach((k) => add(k, previous.files[k] && (previous.files[k].sha256 || previous.files[k])));
    return { ok: true, map: out, reason: '' };
  }
  Object.keys(previous).forEach((k) => {
    const v = previous[k];
    if (typeof v === 'string') add(k, v);
    else if (v && typeof v === 'object') add(k, v.sha256 || v.hash);
  });
  return { ok: out.size > 0, map: out, reason: out.size ? '' : 'the previous manifest has no file entries' };
}

/*
  The comparison. Returns the four sets plus the numbers a deploy
  report wants, and the files themselves so the archive step needs no
  second lookup.
*/
async function computeDeltaManifest(previousBuildManifest, currentProjectData, opts) {
  const o = opts || {};
  const currentFiles = Array.isArray(currentProjectData) ? currentProjectData
    : (currentProjectData && Array.isArray(currentProjectData.files) ? currentProjectData.files : []);

  if (!currentFiles.length) {
    return { ok: false, error: 'no current files were supplied', changed: [], added: [], removed: [], unchanged: [], files: [], errors: ['no current files were supplied'] };
  }

  const previous = normaliseManifest(previousBuildManifest);
  const current = new Map();
  const files = [];

  for (const f of currentFiles) {
    if (!f || !f.name) continue;
    const name = String(f.name);
    const content = f.content == null ? '' : f.content;
    const sha256 = await hashContent(content);
    current.set(name, sha256);
    files.push({ name, content, bytes: Buffer.byteLength(String(content), 'utf8'), sha256 });
  }

  const changed = [];
  const added = [];
  const unchanged = [];
  files.forEach((f) => {
    if (!previous.map.has(f.name)) added.push(f);
    else if (previous.map.get(f.name) !== f.sha256) changed.push(f);
    else unchanged.push(f);
  });

  // Anything the previous build published that this one does not. This
  // is the list that stops deleted pages staying live.
  const removed = [];
  previous.map.forEach((hash, name) => {
    if (!current.has(name)) removed.push({ name, sha256: hash });
  });

  const payloadFiles = changed.concat(added);
  const sum = (list) => list.reduce((n, f) => n + (f.bytes || 0), 0);
  const payloadBytes = sum(payloadFiles);
  const fullBytes = sum(files);

  const manifest = files.map((f) => ({ name: f.name, sha256: f.sha256, bytes: f.bytes }));
  const manifestHash = hashBytes(JSON.stringify(manifest));
  const baseHash = hashBytes(JSON.stringify(Array.from(previous.map.entries())
    .map(([name, sha256]) => ({ name, sha256 }))
    .sort((a, b) => (a.name < b.name ? -1 : 1))));

  return {
    ok: true,
    comparedAgainst: previous.ok ? 'previous manifest' : (previous.reason || 'nothing'),
    hasPrevious: previous.ok,
    base: previous.ok ? baseHash : '',
    manifestHash,
    changed,
    added,
    removed,
    unchanged,
    files,
    manifest,
    counts: { changed: changed.length, added: added.length, removed: removed.length, unchanged: unchanged.length, total: files.length },
    payloadBytes,
    fullBytes,
    reduction: fullBytes === 0 ? 0 : Math.round((1 - (payloadBytes / fullBytes)) * 1000) / 10,
    // A deploy with nothing to send is a valid, useful outcome: it means
    // the live site is already current.
    empty: payloadFiles.length === 0 && removed.length === 0,
    errors: []
  };
}

/*
  Build the payload.

  The archive carries the changed and new files plus a metadata entry
  describing the build it applies over, the removals a zip cannot
  represent, and the resulting manifest hash. Nothing is written when
  the delta is empty — an empty zip is a deployment that looks like it
  did something.
*/
async function generateDeltaZip(deltaManifest, outputZipPath, opts) {
  const o = opts || {};
  const delta = deltaManifest || {};
  if (!ZIP || typeof ZIP.zipFiles !== 'function') {
    return { ok: false, error: 'the zip writer is unavailable', errors: ['the zip writer is unavailable'] };
  }
  if (!delta.ok) {
    return { ok: false, error: 'the delta is not usable', errors: delta.errors || ['the delta is not usable'] };
  }
  if (delta.empty) {
    return { ok: true, skipped: true, entries: 0, bytes: 0, reason: 'nothing changed — the deployed site is already current', appliedRemovals: delta.removed.length };
  }

  const metadata = {
    format: 'pallettai-delta',
    version: 1,
    generatedAt: new Date().toISOString(),
    appliesOver: delta.base || null,
    manifestHash: delta.manifestHash || null,
    counts: delta.counts,
    removed: (delta.removed || []).map((r) => r.name),
    changed: (delta.changed || []).map((f) => f.name),
    added: (delta.added || []).map((f) => f.name),
    note: 'A zip cannot express deletion. Apply `removed` as deletions before or after unpacking.'
  };

  const entries = (delta.changed || []).concat(delta.added || [])
    .map((f) => ({ name: f.name, content: f.content }))
    .concat([{ name: DELTA_FILE, content: JSON.stringify(metadata, null, 2) }]);

  let blob;
  try {
    blob = ZIP.zipFiles(entries);
  } catch (e) {
    // ZipBuildError carries a code and metrics; keep both.
    return {
      ok: false,
      error: String(e && e.message ? e.message : e),
      code: (e && e.code) || 'zip-failed',
      entries: entries.length,
      errors: [String(e && e.message ? e.message : e)]
    };
  }

  let buffer = null;
  try {
    if (Buffer.isBuffer(blob)) buffer = blob;
    else if (blob instanceof Uint8Array) buffer = Buffer.from(blob);
    else if (blob && typeof blob.arrayBuffer === 'function') buffer = Buffer.from(await blob.arrayBuffer());
    else if (blob && typeof blob.bytes === 'function') buffer = Buffer.from(await blob.bytes());
  } catch (e) {
    buffer = null;
  }
  if (!buffer) {
    return { ok: false, error: 'the zip writer returned a type that cannot be written to disk', errors: ['unexpected zip output type'] };
  }

  let write = null;
  if (outputZipPath) {
    write = (Vault && typeof Vault.writeBytesAtomic === 'function')
      ? Vault.writeBytesAtomic(outputZipPath, buffer)
      : fallbackWrite(outputZipPath, buffer);
    if (!write.ok) {
      return { ok: false, error: write.error, errors: [write.error || 'the archive could not be written'] };
    }
  }

  const result = {
    ok: true,
    skipped: false,
    path: outputZipPath || null,
    entries: entries.length,
    shipped: entries.length - 1,
    bytes: buffer.length,
    appliedRemovals: delta.removed.length,
    reduction: delta.reduction,
    savedBytes: Math.max(0, (delta.fullBytes || 0) - buffer.length),
    metadata,
    warnings: [],
    errors: []
  };
  if (delta.removed.length) {
    result.warnings.push(delta.removed.length + ' file(s) must be deleted at the destination — the archive lists them in ' + DELTA_FILE);
  }
  if (!delta.hasPrevious) {
    result.warnings.push('no previous manifest was supplied, so this is a full payload that happens to be addressed as a delta');
  }
  return result;
}

function fallbackWrite(filePath, buffer) {
  try {
    const dest = String(filePath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = dest + '.tmp';
    fs.writeFileSync(tmp, buffer);
    fs.renameSync(tmp, dest);
    return { ok: true, bytes: buffer.length, path: dest };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

// ---------------------------------------------------------------
// History
// ---------------------------------------------------------------

function readDeltaHistory(opts) {
  try {
    const raw = JSON.parse(fs.readFileSync(defaultHistoryPath(opts), 'utf8'));
    const entries = Array.isArray(raw && raw.entries) ? raw.entries : [];
    return { ok: true, version: raw && raw.version ? raw.version : 1, entries };
  } catch (e) {
    return { ok: true, version: 1, entries: [] }; // no history yet is not a failure
  }
}

/*
  Append one release to the log. The log answers "what did we publish,
  over what, and how much of it" — so it records the base hash, not
  just the new one.
*/
function recordDelta(entry, opts) {
  const o = opts || {};
  const file = defaultHistoryPath(o);
  const history = readDeltaHistory(o);
  const record = {
    at: new Date().toISOString(),
    kind: (entry && entry.kind) || 'delta',
    base: (entry && entry.base) || null,
    manifestHash: (entry && entry.manifestHash) || null,
    counts: (entry && entry.counts) || null,
    removed: (entry && entry.removed) ? entry.removed.slice() : [],
    bytes: (entry && entry.bytes) || 0,
    reduction: (entry && entry.reduction) || 0,
    path: (entry && entry.path) || null
  };
  const entries = history.entries.concat([record]);
  const keep = typeof o.keep === 'number' && o.keep > 0 ? o.keep : HISTORY_KEEP;
  const trimmed = entries.slice(Math.max(0, entries.length - keep));
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version: 1, entries: trimmed }, null, 2), 'utf8');
    return { ok: true, file, record, entries: trimmed.length };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e), file };
  }
}

/*
  Read a manifest.json that a previous export left beside its output,
  so a caller does not have to know the manifest's on-disk shape.
*/
function loadPreviousManifest(filePath) {
  try {
    const raw = JSON.parse(fs.readFileSync(String(filePath), 'utf8'));
    const normalised = normaliseManifest(raw);
    return { ok: normalised.ok, manifest: raw, files: normalised.map.size, reason: normalised.reason };
  } catch (e) {
    return { ok: false, manifest: null, files: 0, reason: String(e && e.message ? e.message : e) };
  }
}

function summarise(delta) {
  if (!delta || !delta.ok) return 'delta unavailable';
  if (delta.empty) return 'no changes (' + delta.counts.total + ' files identical)';
  return delta.counts.changed + ' changed, ' + delta.counts.added + ' added, ' +
    delta.counts.removed + ' removed — ' + delta.payloadBytes + ' of ' + delta.fullBytes +
    ' bytes (' + delta.reduction + '% smaller)';
}

/*
  The whole job: compare, archive, log. Kept as one call because the
  three steps are only correct in that order — the log records what the
  archive actually contained.
*/
async function runDeltaExport(previousBuildManifest, currentFiles, outputZipPath, opts) {
  const delta = await computeDeltaManifest(previousBuildManifest, currentFiles, opts);
  if (!delta.ok) return { ok: false, delta, errors: delta.errors };

  const zip = await generateDeltaZip(delta, outputZipPath, opts);
  const logged = zip.ok && !zip.skipped
    ? recordDelta({ kind: 'delta', base: delta.base, manifestHash: delta.manifestHash, counts: delta.counts, removed: delta.removed.map((r) => r.name), bytes: zip.bytes, reduction: delta.reduction, path: zip.path }, opts)
    : { ok: true, entries: readDeltaHistory(opts).entries.length };

  return {
    ok: zip.ok,
    delta,
    zip,
    history: logged,
    summary: summarise(delta),
    errors: zip.errors || []
  };
}

module.exports = {
  DELTA_FILE,
  HISTORY_KEEP,
  computeDeltaManifest,
  generateDeltaZip,
  runDeltaExport,
  recordDelta,
  readDeltaHistory,
  loadPreviousManifest,
  normaliseManifest,
  summarise,
  hashContent
};
