'use strict';

/*
  ============================================================
  CompilerCache — content-addressed build cache
  ------------------------------------------------------------
  A re-export currently recompiles everything. On a one-page site
  that is invisible; on a 40-page site where three sections changed,
  it is 40 pages of work, 40 stylesheet generations and every media
  file re-encoded, all to ship bytes that are identical to the ones
  already sitting on disk.

  The fix is not a timer, it is an address. Every artefact this app
  produces is a pure function of a project, and this codebase already
  knows how to name content by its bytes: `data/manifest.js` computes
  SHA-256 over every exported file and `verify()` recomputes those
  hashes to report exactly what changed. So the cache is keyed the
  same way, for the same reason — a hash cannot collide with a
  different asset, and it survives renames, reorderings and clock
  changes, none of which are reasons to rebuild.

  Four rules the implementation keeps:

  1. A cached artefact is verified before it is trusted. Reading an
     entry re-hashes the bytes and compares them to the key. A cache
     that can hand back the wrong stylesheet is worse than a cold
     one, so a mismatch is a miss, counted as `corrupt`, and the
     caller rebuilds.

  2. Writes are atomic. Content is written to a temporary name and
     renamed into place, so a build killed mid-write cannot leave a
     half-file that the next build trusts.

  3. The cache never decides what is safe to reuse. It stores and
     returns bytes for a key the caller computed from whatever inputs
     the caller considers relevant. Hashing a project and hashing a
     single file are both valid; that judgement belongs to the
     compiler, not here.

  4. A missing or unwritable cache is not an error. A read-only
     install or a full disk degrades to "no cache" and the build
     proceeds, because a performance feature must never become a
     reason a customer cannot export.
  ============================================================
*/

const path = require('path');
const fs = require('fs');

const CACHE_NAME = '.build-cache';
const MAX_BYTES = 64 * 1024 * 1024;

// Node first: the export path runs under Node, and a synchronous digest
// keeps `computeAssetHash` usable where a caller cannot await. The
// manifest's WebCrypto path is used in the browser (see hashAsync).
let nodeCrypto = null;
try { nodeCrypto = require('crypto'); } catch (e) { nodeCrypto = null; }

// The manifest is this project's existing answer to "what are these
// bytes called". Composing it keeps one hashing implementation in the
// codebase rather than two that can drift.
let Manifest = null;
try { Manifest = require(path.join(__dirname, '..', 'data', 'manifest.js')); } catch (e) { Manifest = null; }

function defaultDir() {
  return path.join(__dirname, '..', CACHE_NAME);
}

/*
  Options are `{ dir }`, but a bare path string is accepted too. That is
  not a convenience: `reset(dir)` with a string used to miss the `opts.dir`
  lookup entirely and fall through to the *default* directory, so a caller
  trying to reset a test cache silently reset the real one instead. The two
  forms now mean the same thing rather than one of them meaning nothing.
*/
function dirOf(opts) {
  if (typeof opts === 'string' && opts) return opts;
  const d = opts && opts.dir;
  return d ? String(d) : defaultDir();
}

function objectPath(hash, opts) {
  return path.join(dirOf(opts), 'objects', String(hash).slice(0, 2), String(hash));
}

function statsPath(opts) {
  return path.join(dirOf(opts), '_stats.json');
}

/*
  An index entry maps a *name* to a content hash. Objects are always
  stored under the hash of their own bytes, because that is the only
  key that can be verified on read; a name that is not itself a content
  hash (a memo key, a project id plus its options) therefore lives
  here, pointing at the bytes rather than pretending to be them.

  Keeping the two apart is what makes the integrity check meaningful:
  if a name were used as the object key, verification would have to be
  skipped for every memoized entry, and a cache that cannot detect a
  corrupt entry is worse than no cache at all.
*/
function indexPath(id, opts) {
  return path.join(dirOf(opts), 'index', String(id).slice(0, 2), String(id));
}

function readIndex(id, opts) {
  try {
    const value = fs.readFileSync(indexPath(id, opts), 'utf8').trim();
    return /^[0-9a-f]{64}$/.test(value) ? value : null;
  } catch (e) {
    return null;
  }
}

function writeIndex(id, contentHash, opts) {
  try {
    const file = indexPath(id, opts);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, contentHash, 'utf8');
    fs.renameSync(tmp, file);
  } catch (e) {
    // A missing index entry costs a rebuild, never correctness.
  }
}

function ensureDirs(opts) {
  fs.mkdirSync(path.join(dirOf(opts), 'objects'), { recursive: true });
}

function readStats(opts) {
  try {
    const raw = JSON.parse(fs.readFileSync(statsPath(opts), 'utf8'));
    return Object.assign({ hits: 0, misses: 0, corrupt: 0, writes: 0 }, raw);
  } catch (e) {
    return { hits: 0, misses: 0, corrupt: 0, writes: 0 };
  }
}

function writeStats(s, opts) {
  try {
    ensureDirs(opts);
    fs.writeFileSync(statsPath(opts), JSON.stringify(s, null, 2), 'utf8');
  } catch (e) {
    // A cache that cannot record its own hit rate is still a working
    // cache; it just reports zeroes.
  }
}

/*
  SHA-256 of any asset: a string is hashed as UTF-8, a Buffer/typed
  array as raw bytes. Returns lowercase hex, the same shape the export
  manifest already stores, so a cache key and a manifest entry can be
  compared directly.
*/
function computeAssetHash(bufferOrString, opts) {
  const algorithm = (opts && opts.algorithm) || 'sha256';
  const data = bufferOrString == null ? '' : bufferOrString;
  if (nodeCrypto && typeof nodeCrypto.createHash === 'function') {
    const h = nodeCrypto.createHash(algorithm);
    h.update(Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8'));
    return h.digest('hex');
  }
  throw new Error('computeAssetHash needs Node crypto; use hashAsync where WebCrypto is available');
}

/*
  The browser-safe half of the same operation: delegates to the
  manifest's hashing, which picks Node crypto or `crypto.subtle` for
  itself. Kept separate rather than making the sync function return a
  promise nobody expects.
*/
async function hashAsync(text) {
  if (Manifest && typeof Manifest.hashText === 'function') return Manifest.hashText(String(text == null ? '' : text));
  return computeAssetHash(text);
}

/*
  Read an artefact. Returns its bytes, or null on any kind of miss.
  The bytes are re-hashed and compared to the key they were filed
  under, so a truncated or edited entry is reported as corrupt and
  ignored instead of being served.
*/
function getCachedBuildArtifact(assetHash, opts) {
  const stats = readStats(opts);
  const file = objectPath(assetHash, opts);
  let bytes = null;
  try {
    bytes = fs.readFileSync(file);
  } catch (e) {
    stats.misses++;
    writeStats(stats, opts);
    return null;
  }
  let actual = null;
  try {
    actual = computeAssetHash(bytes);
  } catch (e) {
    actual = null;
  }
  if (actual !== String(assetHash)) {
    stats.corrupt++;
    stats.misses++;
    writeStats(stats, opts);
    try { fs.rmSync(file, { force: true }); } catch (e) { /* leave it */ }
    return null;
  }
  stats.hits++;
  writeStats(stats, opts);
  return bytes.toString('utf8');
}

/*
  Same, for binary artefacts (images, fonts) where a UTF-8 round trip
  would corrupt the bytes. Kept as a separate function so a caller
  cannot accidentally get a string where it needs a Buffer.
*/
function getCachedBinary(assetHash, opts) {
  const stats = readStats(opts);
  const file = objectPath(assetHash, opts);
  let bytes = null;
  try {
    bytes = fs.readFileSync(file);
  } catch (e) {
    stats.misses++;
    writeStats(stats, opts);
    return null;
  }
  if (computeAssetHash(bytes) !== String(assetHash)) {
    stats.corrupt++;
    stats.misses++;
    writeStats(stats, opts);
    return null;
  }
  stats.hits++;
  writeStats(stats, opts);
  return bytes;
}

/*
  Store an artefact under the hash of its own content. Returns the key
  actually used, so a caller that does not have a hash yet can store
  first and learn the address afterwards.

  Discovery walks the date, so a bad key is corrected by the store
  rather than becoming an entry that can never be found again.
*/
function putCachedBuildArtifact(assetHash, content, opts) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content == null ? '' : content), 'utf8');
  const contentHash = computeAssetHash(buffer);
  try {
    ensureDirs(opts);
    const file = objectPath(contentHash, opts);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Write beside the target and rename: rename is atomic on the same
    // filesystem, so a reader never sees a partial file. Storing an
    // identical artefact twice is a no-op rather than a second copy.
    if (!fs.existsSync(file)) {
      const tmp = file + '.' + process.pid + '.tmp';
      fs.writeFileSync(tmp, buffer);
      fs.renameSync(tmp, file);
    }
    // A caller-supplied name that is not the content hash becomes an
    // alias, so their lookup works without weakening verification.
    if (assetHash && String(assetHash) !== contentHash) writeIndex(String(assetHash), contentHash, opts);
    const stats = readStats(opts);
    stats.writes++;
    writeStats(stats, opts);
  } catch (e) {
    // Disk full, read-only install, no permission: the build continues
    // uncached rather than failing.
    return contentHash;
  }
  return contentHash;
}

/*
  Memoize a compile step. `key` is anything that identifies the work —
  a project id, a page id, a minifier name and its options. The result
  is stored under a hash of the key so entries stay content-addressed
  and cannot be located by a partial match.
*/
function memoize(key, compile, opts) {
  const id = computeAssetHash('memo\u0000' + String(key == null ? '' : key));
  const known = readIndex(id, opts);
  if (known) {
    const hit = getCachedBuildArtifact(known, opts);
    if (hit !== null) return hit;
  }
  const value = typeof compile === 'function' ? compile() : compile;
  const content = value == null ? '' : value;
  const contentHash = putCachedBuildArtifact(null, content, opts);
  writeIndex(id, contentHash, opts);
  return content;
}

/*
  The statistics an export report should show. `bytes` is measured from
  the filesystem rather than tracked, because a tracked total drifts
  the first time a write is interrupted.
*/
function stats(opts) {
  const s = readStats(opts);
  let bytes = 0;
  let entries = 0;
  try {
    const base = path.join(dirOf(opts), 'objects');
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else {
          entries++;
          try { bytes += fs.statSync(full).size; } catch (e) { /* vanished */ }
        }
      }
    };
    walk(base);
  } catch (e) {
    // No cache yet.
  }
  return { hits: s.hits, misses: s.misses, corrupt: s.corrupt, writes: s.writes, entries, bytes, directory: dirOf(opts) };
}

/*
  Drop the oldest entries until the cache is back under `maxBytes`.
  Ordered by mtime because that is what "recently useful" means for a
  build cache: the pages being edited are the ones just written.
*/
function prune(opts) {
  const limit = (opts && opts.maxBytes) || MAX_BYTES;
  const base = path.join(dirOf(opts), 'objects');
  let files = [];
  try {
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else {
          try { files.push({ file: full, size: fs.statSync(full).size, atime: fs.statSync(full).mtimeMs }); } catch (e) { /* vanished */ }
        }
      }
    };
    walk(base);
  } catch (e) {
    return { removed: 0, bytes: 0 };
  }
  const total = files.reduce((n, f) => n + f.size, 0);
  if (total <= limit) return { removed: 0, bytes: total };
  files.sort((a, b) => a.atime - b.atime);
  let bytes = total;
  let removed = 0;
  for (const f of files) {
    if (bytes <= limit) break;
    try { fs.rmSync(f.file, { force: true }); bytes -= f.size; removed++; } catch (e) { /* keep going */ }
  }
  return { removed, bytes };
}

/*
  Clear the counters. Deliberately does not delete objects: a caller
  that wants a warm cache kept should be able to reset its measurement
  without paying for a full rebuild.
*/
function reset(opts) {
  writeStats({ hits: 0, misses: 0, corrupt: 0, writes: 0 }, opts);
  return true;
}

/*
  The whole point: given the inputs that determine an artefact, reuse
  the previous one or build it once. Returns the bytes and whether the
  work happened, which is what an export report needs in order to say
  "3 of 40 pages rebuilt".
*/
function reuseOrBuild(inputs, compile, opts) {
  const key = Array.isArray(inputs) ? inputs.join('\u0000') : String(inputs == null ? '' : inputs);
  const id = computeAssetHash('artifact\u0000' + key);
  const known = readIndex(id, opts);
  if (known) {
    const hit = getCachedBuildArtifact(known, opts);
    if (hit !== null) return { content: hit, cached: true, hash: known };
  }
  const built = typeof compile === 'function' ? compile() : compile;
  const content = built == null ? '' : built;
  const contentHash = putCachedBuildArtifact(null, content, opts);
  writeIndex(id, contentHash, opts);
  return { content, cached: false, hash: contentHash };
}

const api = {
  CACHE_NAME,
  computeAssetHash,
  hashAsync,
  pathFor: objectPath,
  getCachedBuildArtifact,
  getCachedBinary,
  putCachedBuildArtifact,
  memoize,
  reuseOrBuild,
  stats,
  prune,
  reset,
  hashingAvailable: () => !!(nodeCrypto && nodeCrypto.createHash) || !!(Manifest && Manifest.hashingAvailable && Manifest.hashingAvailable()),
  directory: defaultDir
};

module.exports = api;
