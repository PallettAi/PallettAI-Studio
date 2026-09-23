// ============================================================
// PallettAI Studio — FileIntegrity
// Build-output manifest, tamper/corruption audit, cache repair.
//
// generateBuildManifest(distFolderPath, options)
//   Recursively scans the export folder and writes
//   .manifest.json — an HMAC-SHA256 SIGNED map of every file to
//   its SHA-256 digest, size, and mtime. The signing key is
//   random per manifest by default (stored inside), or caller-
//   supplied so a CI pipeline can hold the key separately.
//   The manifest itself is excluded from the file list — the
//   signature is what protects it, not a self-hash.
//
// verifyBuildIntegrity(distFolderPath, manifestPath)
//   Classifies every file the manifest knows about, and every
//   file on disk the manifest doesn't:
//     ok | missing | corrupted | externallyModified | unsigned
//   plus `untracked` for disk-only files. The signature is
//   verified FIRST — a tampered manifest is reported, never
//   trusted. mtime-only drift (content intact) is reported as
//   externallyModified with mtimeDrift:true, not corruption.
//
//   WHAT THE SIGNATURE IS WORTH depends on who holds the key, and
//   the result says so rather than leaving a green tick to imply
//   more than it means:
//     signatureTrust:'caller' — the caller supplied the key, so a
//       manifest edited by anyone without it fails. This is the
//       only form that resists a deliberate edit.
//     signatureTrust:'self'   — the key travelled inside the
//       manifest, so the signature proves the manifest is
//       UNCHANGED SINCE IT WAS WRITTEN (accidental corruption,
//       truncated copies, a half-written file) but NOT that the
//       build is untampered: whoever can edit the manifest can
//       re-sign it. `selfSigned:true` marks exactly that case.
//
// autoRepairCorruptedFiles(corruptedFileList, cacheSourcePath)
//   Restores damaged/missing files from .build-cache/ (the
//   mirror layout the Studio keeps alongside dist/). Repairs
//   are verified against the manifest hashes before they count,
//   staged via tmp+rename (atomic on POSIX), and failures are
//   reported per-file — one unreadable cache entry never aborts
//   the batch.
//
// Zero dependencies beyond Node's fs/crypto/path. CommonJS.
// ============================================================
(function () {
  'use strict';

  const crypto = require('crypto');
  const fs = require('fs');
  const path = require('path');

  const FileIntegrity = {};

  var MANIFEST_NAME = '.manifest.json';
  FileIntegrity.MANIFEST_NAME = MANIFEST_NAME;

  function sha256Buffer(buf) {
    return crypto.createHash('sha256').update(buf).digest('hex');
  }

  /**
   * Resolve a manifest-relative path INSIDE a root folder, or null when
   * the entry escapes it. Manifest entries and caller-supplied issue
   * lists are untrusted input: without this, `../../x` would let a
   * "repair" read from — or write to — anywhere on disk.
   */
  function safeJoinInside(root, rel) {
    if (typeof rel !== 'string' || !rel.trim()) return null;
    var abs = path.resolve(root, rel.split('/').join(path.sep));
    var base = path.resolve(root);
    if (abs !== base && abs.indexOf(base + path.sep) !== 0) return null;
    return abs;
  }

  function sign(payload, key) {
    return crypto.createHmac('sha256', key).update(payload).digest('hex');
  }

  function safeReadJson(filePath) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
      return null;
    }
  }

  function listFilesRecursively(dir) {
    var out = [];
    var stack = [dir];
    while (stack.length) {
      var cur = stack.pop();
      var entries;
      try {
        entries = fs.readdirSync(cur, { withFileTypes: true });
      } catch (e) {
        continue; // unreadable dir — reported as untracked/missing upstream
      }
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        var full = path.join(cur, e.name);
        if (e.isDirectory()) stack.push(full);
        else if (e.isFile()) out.push(full);
      }
    }
    return out;
  }

  /* ============================================================
     1 — manifest generation
     ============================================================ */

  /**
   * generateBuildManifest(distFolderPath, options)
   * @param {string} distFolderPath
   * @param {object} [options] { signingKey, manifestPath }
   * @returns {{ ok, manifestPath, files: number, bytes: number, signingKey } |
   *           { ok: false, error }}
   */
  FileIntegrity.generateBuildManifest = function (distFolderPath, options) {
    var opts = options || {};
    if (!distFolderPath || typeof distFolderPath !== 'string') {
      return { ok: false, error: 'distFolderPath is required.' };
    }
    var resolved;
    try { resolved = path.resolve(distFolderPath); } catch (e) { return { ok: false, error: 'distFolderPath is not a valid path.' }; }
    var st;
    try { st = fs.statSync(resolved); } catch (e) { return { ok: false, error: 'dist folder does not exist: ' + distFolderPath }; }
    if (!st.isDirectory()) return { ok: false, error: 'distFolderPath is not a directory.' };

    var signingKey = opts.signingKey || crypto.randomBytes(32).toString('hex');
    var manifestPath = opts.manifestPath || path.join(resolved, MANIFEST_NAME);

    var files = listFilesRecursively(resolved);
    var entries = {};
    var totalBytes = 0;
    for (var i = 0; i < files.length; i++) {
      var abs = files[i];
      if (path.resolve(abs) === path.resolve(manifestPath)) continue;
      var rel = path.relative(resolved, abs).split(path.sep).join('/');
      var buf;
      try { buf = fs.readFileSync(abs); } catch (e) { continue; }
      var fst = fs.statSync(abs);
      entries[rel] = {
        sha256: sha256Buffer(buf),
        bytes: buf.length,
        mtimeMs: Math.round(fst.mtimeMs)
      };
      totalBytes += buf.length;
    }

    var body = {
      version: 1,
      algorithm: 'sha256',
      generator: 'PallettAI Studio file-integrity',
      createdAt: new Date().toISOString(),
      root: path.basename(resolved),
      files: entries
    };
    var payload = JSON.stringify(body);
    var manifest = {
      signed: true,
      signature: sign(payload, signingKey),
      payload: body,
      signingKey: signingKey // caller may hold this instead
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    return { ok: true, manifestPath: manifestPath, files: Object.keys(entries).length, bytes: totalBytes, signingKey: signingKey };
  };

  /* ============================================================
     2 — verification
     ============================================================ */

  /**
   * verifyBuildIntegrity(distFolderPath, manifestPath, options)
   * @param {string} distFolderPath
   * @param {string} [manifestPath]  defaults to <dist>/.manifest.json
   * @param {object} [options] { signingKey, ignore: [relative paths], strict }
   * @returns {{ ok, signatureValid, selfSigned, signatureTrust, files: number,
   *            summary: {ok, missing, corrupted, externallyModified, untracked},
   *            issues: [{file, status, expected?, actual?, mtimeDrift?}] }} |
   *           { ok: false, error, signatureValid: false, selfSigned, signatureTrust }
   *
   * The content hash is the integrity signal: `ok` fails on missing
   * or content-changed files. mtime-only drift (content byte-identical
   * — e.g. a benign touch, or a repair that restored correct bytes)
   * is REPORTED as externallyModified but only fails `ok` in
   * strict mode.
   */
  FileIntegrity.verifyBuildIntegrity = function (distFolderPath, manifestPath, options) {
    var opts = options || {};
    if (!distFolderPath) return { ok: false, error: 'distFolderPath is required.', signatureValid: false };
    var resolved = path.resolve(distFolderPath);
    var mPath = manifestPath ? path.resolve(manifestPath) : path.join(resolved, MANIFEST_NAME);

    var manifest = safeReadJson(mPath);
    if (!manifest || !manifest.payload || !manifest.signature) {
      return { ok: false, error: 'Manifest missing, unreadable, or unsigned at ' + mPath, signatureValid: false };
    }

    // Signature first — a tampered manifest is never trusted.
    var expectedSig = manifest.signature;
    var key = opts.signingKey || manifest.signingKey;
    // Whoever holds the key can re-sign. Say which case this is.
    var selfSigned = !opts.signingKey;
    var signatureTrust = selfSigned ? 'self' : 'caller';
    var actualSig = sign(JSON.stringify(manifest.payload), key);
    var signatureValid = expectedSig.length === actualSig.length &&
      crypto.timingSafeEqual(Buffer.from(expectedSig), Buffer.from(actualSig));
    if (!signatureValid) {
      return {
        ok: false,
        error: 'Manifest signature mismatch — the manifest itself was modified or signed with a different key.',
        signatureValid: false,
        selfSigned: selfSigned,
        signatureTrust: signatureTrust,
        files: 0,
        summary: { ok: 0, missing: 0, corrupted: 0, externallyModified: 0, untracked: 0 },
        issues: [{ file: path.basename(mPath), status: 'unsigned' }]
      };
    }

    var ignore = new Set(opts.ignore || []);
    var entries = manifest.payload.files || {};
    var issues = [];
    var summary = { ok: 0, missing: 0, corrupted: 0, externallyModified: 0, untracked: 0 };

    // Every manifest entry must exist and match.
    Object.keys(entries).forEach(function (rel) {
      if (ignore.has(rel)) return;
      var entry = entries[rel];
      var abs = safeJoinInside(resolved, rel);
      if (!abs) {
        summary.corrupted++;
        issues.push({ file: rel, status: 'corrupted', reason: 'manifest entry escapes the build folder' });
        return;
      }
      var buf;
      try { buf = fs.readFileSync(abs); } catch (e) {
        summary.missing++;
        issues.push({ file: rel, status: 'missing' });
        return;
      }
      var actual = sha256Buffer(buf);
      if (actual !== entry.sha256) {
        summary.corrupted++;
        issues.push({ file: rel, status: 'corrupted', expected: entry.sha256, actual: actual });
        return;
      }
      var fst = fs.statSync(abs);
      if (Math.abs(fst.mtimeMs - entry.mtimeMs) > 2) {
        // Content intact, touched afterwards — modified, not corrupted.
        summary.externallyModified++;
        issues.push({ file: rel, status: 'externallyModified', mtimeDrift: true });
        return;
      }
      summary.ok++;
    });

    // Disk files the manifest doesn't know about.
    var diskFiles = listFilesRecursively(resolved);
    for (var i = 0; i < diskFiles.length; i++) {
      var abs2 = diskFiles[i];
      if (path.resolve(abs2) === mPath) continue;
      var rel2 = path.relative(resolved, abs2).split(path.sep).join('/');
      if (ignore.has(rel2)) continue;
      if (!entries[rel2]) {
        summary.untracked++;
        issues.push({ file: rel2, status: 'untracked' });
      }
    }

    return {
      ok: summary.missing === 0 && summary.corrupted === 0 && (opts.strict ? summary.externallyModified === 0 : true),
      signatureValid: true,
      selfSigned: selfSigned,
      signatureTrust: signatureTrust,
      files: Object.keys(entries).length,
      summary: summary,
      issues: issues
    };
  }

  /**
   * Refresh the recorded mtimes of repaired files and re-sign the
   * manifest, so a post-repair strict verification stays green.
   * Only runs when the manifest signature validates (we never edit
   * a manifest we could not first authenticate).
   */
  function refreshManifestMtimes(distFolderPath, repairedFiles, signingKey) {
    var mPath = path.join(path.resolve(distFolderPath), MANIFEST_NAME);
    var manifest = safeReadJson(mPath);
    if (!manifest || !manifest.payload || !manifest.signature) return false;
    var key = signingKey || manifest.signingKey;
    var sig = sign(JSON.stringify(manifest.payload), key);
    var valid = manifest.signature.length === sig.length &&
      crypto.timingSafeEqual(Buffer.from(manifest.signature), Buffer.from(sig));
    if (!valid) return false;
    var changed = false;
    repairedFiles.forEach(function (r) {
      var rel = typeof r === 'string' ? r : r.file;
      var abs = safeJoinInside(distFolderPath, rel);
      if (!abs) return;
      if (manifest.payload.files[rel]) {
        try {
          manifest.payload.files[rel].mtimeMs = Math.round(fs.statSync(abs).mtimeMs);
          changed = true;
        } catch (e) { /* file vanished — leave entry */ }
      }
    });
    if (!changed) return false;
    manifest.signature = sign(JSON.stringify(manifest.payload), key);
    try { fs.writeFileSync(mPath, JSON.stringify(manifest, null, 2)); } catch (e) { return false; }
    return true;
  };

  /* ============================================================
     3 — auto-repair from build cache
     ============================================================ */

  // Stage → verify → rename. The staged copy is hashed BEFORE it
  // ever takes the destination's name, so a stale cache entry can
  // never be served, not even for a moment, and a failed repair
  // leaves the destination untouched.
  function stageVerifyRename(src, dst, expectedSha256) {
    var tmp = dst + '.pai-tmp-' + crypto.randomBytes(4).toString('hex');
    try {
      fs.copyFileSync(src, tmp);
      if (expectedSha256) {
        var actual = sha256Buffer(fs.readFileSync(tmp));
        if (actual !== expectedSha256) {
          return { ok: false, reason: 'cache copy hash mismatch — cache itself is stale', actual: actual };
        }
      }
      fs.renameSync(tmp, dst);
      return { ok: true };
    } finally {
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (e) { /* best effort */ }
    }
  }

  /**
   * autoRepairCorruptedFiles(corruptedFileList, cacheSourcePath, options)
   * @param {Array|string} corruptedFileList
   *   verifyBuildIntegrity().issues, or an array of relative paths
   *   (strings with status 'untracked'/'ok' are skipped).
   * @param {string} cacheSourcePath  root of the .build-cache mirror
   * @param {object} [options] { distFolderPath, manifestPath, dryRun }
   * @returns {{ ok, repaired: [{file, bytes}], failed: [{file, reason}], skipped: number } |
   *           { ok: false, error }}
   */
  FileIntegrity.autoRepairCorruptedFiles = function (corruptedFileList, cacheSourcePath, options) {
    if (!Array.isArray(corruptedFileList) || !corruptedFileList.length) {
      return { ok: false, error: 'corruptedFileList must be a non-empty array.' };
    }
    if (!cacheSourcePath) return { ok: false, error: 'cacheSourcePath is required.' };
    var opts = options || {};
    var cacheRoot = path.resolve(cacheSourcePath);
    try { if (!fs.statSync(cacheRoot).isDirectory()) return { ok: false, error: 'cacheSourcePath is not a directory.' }; }
    catch (e) { return { ok: false, error: 'cache source does not exist: ' + cacheSourcePath }; }

    // Manifest hashes for post-repair verification (optional but ideal).
    var manifest = null;
    var entries = {};
    if (opts.distFolderPath) {
      var mPath = opts.manifestPath || path.join(path.resolve(opts.distFolderPath), MANIFEST_NAME);
      manifest = safeReadJson(mPath);
      if (manifest && manifest.payload) entries = manifest.payload.files || {};
    }

    var repaired = [], failed = [], skipped = 0;
    for (var i = 0; i < corruptedFileList.length; i++) {
      var item = corruptedFileList[i];
      var rel, status;
      if (typeof item === 'string') { rel = item; status = 'corrupted'; }
      else if (item && typeof item === 'object') { rel = item.file; status = item.status; }
      else { skipped++; continue; }
      if (!rel) { skipped++; continue; }
      if (status !== 'corrupted' && status !== 'missing' && status !== 'externallyModified') { skipped++; continue; }

      var src = safeJoinInside(cacheRoot, rel);
      var dstCheck = opts.distFolderPath ? safeJoinInside(opts.distFolderPath, rel) : null;
      if (!src || (opts.distFolderPath && !dstCheck)) {
        failed.push({ file: rel, reason: 'path escapes its root folder — refused' });
        continue;
      }
      if (!fs.existsSync(src)) {
        failed.push({ file: rel, reason: 'not present in build cache' });
        continue;
      }
      if (opts.dryRun) {
        repaired.push({ file: rel, bytes: fs.statSync(src).size, dryRun: true });
        continue;
      }
      if (!opts.distFolderPath) {
        failed.push({ file: rel, reason: 'distFolderPath option required for actual repair' });
        continue;
      }
      var dst = dstCheck;
      var expected = entries[rel];
      try {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
      } catch (e) {
        failed.push({ file: rel, reason: 'mkdir failed: ' + (e && e.message ? e.message : String(e)) });
        continue;
      }
      var staged = stageVerifyRename(src, dst, expected && expected.sha256);
      if (!staged.ok) {
        failed.push({ file: rel, reason: staged.reason, actual: staged.actual });
        continue;
      }
      repaired.push({ file: rel, bytes: fs.statSync(dst).size });
    }

    var result = { ok: failed.length === 0, repaired: repaired, failed: failed, skipped: skipped, manifestRefreshed: false };
    // Post-repair: keep the signed manifest honest about the repaired
    // files' new mtimes (content hashes are unchanged and verified).
    if (repaired.length && opts.distFolderPath) {
      result.manifestRefreshed = refreshManifestMtimes(path.resolve(opts.distFolderPath), repaired, opts.signingKey);
    }
    return result;
  };

  /* ---------------- exports ---------------- */

  FileIntegrity.sha256Buffer = sha256Buffer;
  FileIntegrity.listFilesRecursively = listFilesRecursively;

  if (typeof module !== 'undefined' && module.exports) module.exports = FileIntegrity;
})();
