/*
  Wrapped in an IIFE, like modules/store.js: this is a classic script, so a
  top-level `const` here lives in the same global scope as every other script on
  the page. A plain `const KINDS` collided with an existing global and took the
  whole file down with a SyntaxError — the failure mode is a script that never
  runs while everything that needs it reports "no format registered".
*/
(function () {
'use strict';

/*
  ============================================================
  StoreSchema — the local library's format registry
  ------------------------------------------------------------
  Every value in the local store is a JSON string under a key
  that ends in `.v1`. That suffix has never been a version: it
  is a naming accident, and it is the only thing recording the
  shape of what is inside. So a change to the shape of a
  project or an asset has had two honest outcomes — keep the
  old shape forever, or lose what people made.

  This module makes the version real. Each stored key has a
  current version and a forward migration for every version it
  has ever been. Migrations run once, at boot, BEFORE the app
  hydrates, and only ever forward.

  Four rules the implementation keeps:

  1. A migration that throws changes nothing. The stored value
     is left exactly as it was and the version is not advanced,
     so the migration is retried next boot instead of a
     half-converted library being written over the original.
  2. A version is advanced only AFTER the migrated value has
     committed. The reverse order is the bug that loses data:
     a crash between the two would mark a value as converted
     when it is still in the old shape.
  3. On-disk values stay plain JSON strings — no envelope, no
     wrapper. A library written by this build still opens in an
     older one, which is what makes shipping this safe.
  4. Versions live in a sidecar key, never inside the values,
     so a value that fails to parse is still byte-for-byte
     recoverable from a backup.

  The registered keys are asserted against the app's own key
  vocabulary by scripts/schema-smoke.js, so renaming a key
  cannot quietly drop it out of the registry — it fails there.

  API:
    StoreSchema.key                    → the sidecar key
    StoreSchema.registry               → per-key version records
    StoreSchema.plan(key, from)        → what a run would do
    StoreSchema.migrate(key, raw, from) → { ok, raw, applied, error }
    StoreSchema.storedVersion(map, key, hasValue)
    StoreSchema.parseSidecar(raw) / serializeSidecar(map)
    StoreSchema.verify(keyMap)         → registry ↔ key vocabulary diff
    await StoreSchema.runLibrary(io)   → { ok, ran, failed, versions, sidecar }
    StoreSchema.fingerprintOf(asset)   → short stable content fingerprint
  ============================================================ */

// The sidecar. Named like everything else it sits beside, and versioned like
// one of them: if the sidecar's own shape ever changes it gets a migration too.
const SCHEMA_KEY = 'pallettai.schema.v1';

/* ---------------------------------------------------------------------------
   Fingerprints

   Used to answer "do I already have this image?" when an online result is
   pinned into the library, and to find duplicates between two libraries.

   Deliberately sampled rather than a hash of the whole data URL: an asset can
   be a megabyte of base64, there can be a hundred of them, and a full hash of
   every inlined photo is a real cost paid at boot for a duplicate check. Two
   different pictures colliding would need the same byte length, the same first
   2 KB and the same last 2 KB, which is not a thing that happens to photographs.
--------------------------------------------------------------------------- */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ('00000000' + h.toString(16)).slice(-8);
}

function fingerprintOf(item) {
  const a = item || {};
  const data = String(a.dataUrl || a.url || a.thumb || '');
  const head = data.slice(0, 2048);
  const tail = data.length > 2048 ? data.slice(-2048) : '';
  const seed = [a.name, a.type, a.w, a.h, data.length].join('|');
  return fnv1a(seed + '|' + head + '|' + tail);
}

/* ---------------------------------------------------------------------------
   The migrations
--------------------------------------------------------------------------- */

function parseArray(raw, what) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch (e) {
    // Refusing is the safe half of the promise above: a value we cannot read is
    // a value we cannot convert, and the original must survive that.
    throw new Error(what + ' could not be parsed — left untouched');
  }
  if (!Array.isArray(value)) throw new Error(what + ' are not a list — left untouched');
  return value;
}

/*
  Projects 1 → 2.

  Two changes, both of which the loader already performs in memory on every
  boot: coerce `suites` and `site.sections` to arrays, and record the format
  version inside each project.

  Doing it once, on disk, matters because the in-memory repair is never
  written back — so a project from an old file is re-repaired at every launch
  and stays malformed for anyone else who opens it. The stamp matters for a
  different reason: a project also travels alone, as an exported
  `.pallettai.json`, and the sidecar does not travel with it. A version inside
  the project is the only version that survives that trip.
*/
function projectsToV2(raw) {
  return JSON.stringify(parseArray(raw, 'projects').map((p) => {
    if (!p || typeof p !== 'object') return p;
    const out = Object.assign({}, p, { schemaVersion: 2 });
    if (!Array.isArray(out.suites)) out.suites = [];
    if (out.site && typeof out.site === 'object' && !Array.isArray(out.site.sections)) out.site.sections = [];
    return out;
  }));
}

/*
  Assets 1 → 2.

  Adds the two fields that make an asset library defensible for client work:
  `credit` (the licence record an Openverse image arrives with, kept beside the
  image instead of only in the project that used it) and `fp`, the fingerprint
  above, so re-pinning a picture you already own is recognised instead of
  silently duplicating a megabyte.

  `credit` is written as null rather than omitted so "no credit recorded" and
  "predates credits" are the same, visible state rather than an absent key
  nobody can distinguish from an old file.
*/
function assetsToV2(raw) {
  return JSON.stringify(parseArray(raw, 'assets').map((a) => {
    if (!a || typeof a !== 'object') return a;
    const out = Object.assign({}, a);
    if (!out.fp) out.fp = fingerprintOf(out);
    if (!('credit' in out)) out.credit = null;
    return out;
  }));
}

/* ---------------------------------------------------------------------------
   The registry

   `current` is the version this build writes. A key with no migrations has
   still earned its row: the row is what makes the version legible, and what
   the next shape change attaches its migration to.
--------------------------------------------------------------------------- */
const REGISTRY = {
  'pallettai.projects.v1': { label: 'Projects', current: 2, migrations: { 1: projectsToV2 } },
  'pallettai.revisions.v1': { label: 'Autosave history', current: 1 },
  'pallettai.assets.v1': { label: 'Assets', current: 2, migrations: { 1: assetsToV2 } },
  'pallettai.sectionPresets.v1': { label: 'Section presets', current: 1 },
  'pallettai.brandPresets.v1': { label: 'Brand presets', current: 1 },
  'pallettai.briefs.v1': { label: 'Briefs', current: 1 },
  'pallettai.settings.v1': { label: 'Settings', current: 1 },
  // A first-run flag ('1'), written to localStorage only and never to the store.
  // It has no shape and will never need a migration, and it is listed anyway:
  // the registry's job is to be the COMPLETE map of what the app stores, and a
  // key that is missing from it is exactly the drift this file exists to catch
  // (scripts/schema-smoke.js reads the app's own key list and fails on a gap).
  'pallettai.seeded.v1': { label: 'First-run flag', current: 1 }
};

function parseSidecar(raw) {
  if (raw === null || raw === undefined || raw === '') return Object.create(null);
  let value;
  try {
    value = JSON.parse(String(raw));
  } catch (e) {
    // A sidecar we cannot read is rebuilt from what is actually stored, which
    // is the conservative direction: unknown versions look unmigrated.
    return Object.create(null);
  }
  const out = Object.create(null);
  if (value && typeof value === 'object') {
    Object.keys(value).forEach((k) => {
      const n = Number(value[k]);
      if (Number.isFinite(n) && n > 0) out[k] = Math.floor(n);
    });
  }
  return out;
}

function serializeSidecar(map) {
  const out = {};
  Object.keys(map || {}).sort().forEach((k) => { out[k] = map[k]; });
  return JSON.stringify(out);
}

/*
  Which version is this value in?

  - a recorded version is authoritative;
  - a stored value with no recorded version predates the registry, so it is
    version 1 — the oldest shape we know, which is what makes an existing
    library get migrated on the first boot after this ships;
  - nothing stored at all is already current: there is no old shape to convert.
*/
function storedVersion(sidecar, key, hasValue) {
  const map = sidecar || {};
  const recorded = Number(map[key]);
  if (Number.isFinite(recorded) && recorded > 0) return Math.floor(recorded);
  if (!hasValue) return (REGISTRY[key] && REGISTRY[key].current) || 1;
  return 1;
}

function plan(key, from, registry) {
  const entry = (registry || REGISTRY)[key];
  const target = entry ? (entry.current || 1) : 1;
  const start = Number.isFinite(from) && from > 0 ? Math.floor(from) : 1;
  const steps = [];
  for (let v = start; v < target; v++) steps.push(v);
  return { key, from: start, to: target, steps, needs: steps.length > 0, known: !!entry, label: entry ? entry.label : key };
}

/*
  Run one key's migrations in memory. Returns a result rather than throwing, and
  never returns a partial conversion: either every step applies or the caller
  gets back the original string with the reason.
*/
function migrate(key, raw, from, registry) {
  const entry = (registry || REGISTRY)[key];
  const start = Number.isFinite(from) && from > 0 ? Math.floor(from) : 1;
  const result = { ok: false, raw, from: start, to: start, applied: [], error: '' };
  if (!entry) { result.error = 'no format registered for ' + key; return result; }
  const target = entry.current || 1;
  let current = raw;
  let version = start;
  while (version < target) {
    const step = entry.migrations && entry.migrations[version];
    if (typeof step !== 'function') {
      result.to = version;
      result.error = 'no migration from version ' + version + ' of ' + (entry.label || key);
      return result;
    }
    let next;
    try {
      next = step(current, key);
    } catch (e) {
      result.to = version;
      result.error = (e && e.message) || 'migration from version ' + version + ' failed';
      return result;
    }
    if (typeof next !== 'string') {
      result.error = 'migration from version ' + version + ' of ' + (entry.label || key) + ' produced no value';
      return result;
    }
    current = next;
    version += 1;
    result.applied.push(version);
  }
  result.ok = true;
  result.raw = current;
  result.to = version;
  return result;
}

// Does the registry cover every key the app actually stores? The app passes its
// own key map; anything it stores that has no version row is drift, and a key
// row with no key is a leftover. Both are reported rather than guessed at.
function verify(keyMap, registry) {
  const reg = registry || REGISTRY;
  const stored = Object.keys(keyMap || {}).map((name) => String(keyMap[name]));
  const missing = stored.filter((k) => !reg[k]);
  const unknown = Object.keys(reg).filter((k) => stored.indexOf(k) === -1);
  return { missing, unknown, ok: missing.length === 0 && unknown.length === 0 };
}

/*
  Bring the whole library up to date.

  `io` is anything with get(key)/put(key, value) — AppStore in the app, and the
  fake IndexedDB in tests, which is why this is a function here rather than a
  page of boot code in app.js.

  Values are migrated one key at a time and versions are recorded in a single
  write at the end. A key whose migration fails keeps its old version, so the
  next boot tries again — and the app still starts, because a library in an old
  shape is readable.
*/
async function runLibrary(io, options) {
  const opts = options || {};
  const registry = opts.registry || REGISTRY;
  const store = io;
  const out = { ok: true, ran: [], failed: [], versions: {}, sidecar: null, at: Date.now() };
  if (!store || typeof store.get !== 'function' || typeof store.put !== 'function') {
    out.ok = false;
    out.failed.push({ key: SCHEMA_KEY, error: 'no store to migrate' });
    return out;
  }

  let sidecarRaw = null;
  try { sidecarRaw = await store.get(SCHEMA_KEY); } catch (e) { sidecarRaw = null; }
  const sidecar = parseSidecar(sidecarRaw);
  let dirty = false;

  const keys = Object.keys(registry);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    let raw = null;
    try { raw = await store.get(key); } catch (e) { raw = null; }
    const has = raw !== null && raw !== undefined;
    const from = storedVersion(sidecar, key, has);
    const to = (registry[key] && registry[key].current) || 1;
    out.versions[key] = has ? from : to;

    if (!has) {
      if (sidecar[key] !== to) { sidecar[key] = to; dirty = true; }
      continue;
    }
    if (from >= to) continue;

    const res = migrate(key, raw, from, registry);
    if (!res.ok) {
      out.ok = false;
      out.versions[key] = from;
      out.failed.push({ key, label: registry[key].label || key, from, to, error: res.error });
      continue;
    }
    try {
      await store.put(key, res.raw);
    } catch (e) {
      out.ok = false;
      out.versions[key] = from;
      out.failed.push({ key, label: registry[key].label || key, from, to, error: 'could not write the upgraded value: ' + ((e && e.message) || 'write failed') });
      continue;
    }
    // Advanced only after the write committed.
    sidecar[key] = to;
    dirty = true;
    out.ran.push({
      key,
      label: registry[key].label || key,
      from,
      to,
      steps: res.applied,
      bytesBefore: String(raw).length,
      bytesAfter: String(res.raw).length
    });
  }

  // A row for a key the registry no longer knows would make a future key of the
  // same name look already-migrated when it is not.
  Object.keys(sidecar).forEach((k) => { if (!registry[k]) { delete sidecar[k]; dirty = true; } });

  if (dirty) {
    try {
      await store.put(SCHEMA_KEY, serializeSidecar(sidecar));
    } catch (e) {
      out.warn = 'format versions could not be recorded: ' + ((e && e.message) || 'write failed');
    }
  }
  out.sidecar = sidecar;
  return out;
}

const StoreSchema = {
  key: SCHEMA_KEY,
  registry: REGISTRY,
  plan,
  migrate,
  storedVersion,
  parseSidecar,
  serializeSidecar,
  verify,
  runLibrary,
  fingerprintOf,
  fnv1a
};

if (typeof window !== 'undefined') window.StoreSchema = StoreSchema;
if (typeof module !== 'undefined' && module.exports) module.exports = StoreSchema;
})();
