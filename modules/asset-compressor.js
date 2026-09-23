// ============================================================
// PallettAI Studio — AssetCompressor
// Pre-compression pipeline for exported static bundles.
//
// precompressStaticAssets(distFolderPath, options)
//   Walks the export folder and writes `.br` (Brotli, RFC 7932)
//   and `.gz` (Gzip, RFC 1952) sidecars beside every text asset:
//   HTML, CSS, JS, SVG, JSON, XML, TXT, MD. Edge servers
//   (Cloudflare, NGINX `gzip_static`/`brotli_static`, Caddy
//   `file_server precompressed`) then serve the sidecars
//   directly — zero CPU spent on compression at request time.
//
//   · Brotli quality is configurable and maxes at 11 (the
//     BROTLI_PARAM_QUALITY constant, exported for callers); the
//     default production setting is 11 with lgwin 22.
//   · Files below minBytes (default 512) are skipped — the
//     sidecar would be larger than the payload.
//   · A sidecar that would not actually shrink the asset is
//     skipped too (incompressible content).
//   · Every sidecar is round-trip verified (decompressed must be
//     byte-identical) BEFORE it is written — a truncated sidecar
//     can never reach the edge.
//
// verifySidecars(distFolderPath)  — audit pass: decompress every
//   sidecar, compare to its source file. Detects stale sidecars
//   (source changed after compression) and corrupt ones.
//
// cleanupSidecars(distFolderPath) — removes sidecars whose source
//   file no longer exists (post-rebuild hygiene).
//
// Zero dependencies beyond Node's zlib. CommonJS.
// ============================================================
(function () {
  'use strict';

  const zlib = require('zlib');
  const fs = require('fs');
  const path = require('path');

  const AssetCompressor = {};

  var DEFAULT_EXTENSIONS = ['.html', '.css', '.js', '.mjs', '.svg', '.json', '.xml', '.txt', '.md'];
  var SIDECAR_EXTENSIONS = ['.br', '.gz'];
  var MIN_BYTES_DEFAULT = 512;

  AssetCompressor.DEFAULT_EXTENSIONS = DEFAULT_EXTENSIONS;
  // Export the real constant so callers configure with the same
  // vocabulary zlib uses.
  AssetCompressor.BROTLI_PARAM_QUALITY = zlib.constants.BROTLI_PARAM_QUALITY;
  AssetCompressor.BROTLI_MAX_QUALITY = 11;
  AssetCompressor.BROTLI_PARAM_LGWIN = zlib.constants.BROTLI_PARAM_LGWIN;

  function listFilesRecursively(dir) {
    var out = [];
    var stack = [dir];
    while (stack.length) {
      var cur = stack.pop();
      var entries;
      try { entries = fs.readdirSync(cur, { withFileTypes: true }); }
      catch (e) { continue; }
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        var full = path.join(cur, e.name);
        if (e.isDirectory()) stack.push(full);
        else if (e.isFile()) out.push(full);
      }
    }
    return out;
  }
  AssetCompressor.listFilesRecursively = listFilesRecursively;

  function toBrotliOptions(quality, lgwin) {
    var params = {};
    params[zlib.constants.BROTLI_PARAM_QUALITY] = quality;
    params[zlib.constants.BROTLI_PARAM_LGWIN] = lgwin;
    params[zlib.constants.BROTLI_PARAM_SIZE_HINT] = 0;
    return { params: params };
  }

  /**
   * precompressStaticAssets(distFolderPath, options)
   * @param {string} distFolderPath
   * @param {object} [options] {
   *   brotliQuality (default 11, max 11), brotliLgwin (default 22),
   *   gzipLevel (default 9), extensions, minBytes (default 512),
   *   skipExisting (default false — recompress), verbose
   * }
   * @returns {{ ok, compressed: [{file, br, gz}], skipped: [{file, reason}],
   *            totals: { files, originalBytes, brBytes, gzBytes, brSavedPct, gzSavedPct },
   *            settings } |
   *           { ok: false, error }}
   */
  AssetCompressor.precompressStaticAssets = function (distFolderPath, options) {
    var opts = options || {};
    if (!distFolderPath || typeof distFolderPath !== 'string') {
      return { ok: false, error: 'distFolderPath is required.' };
    }
    var resolved;
    try { resolved = path.resolve(distFolderPath); } catch (e) { return { ok: false, error: 'distFolderPath is not a valid path.' }; }
    try { if (!fs.statSync(resolved).isDirectory()) return { ok: false, error: 'distFolderPath is not a directory.' }; }
    catch (e) { return { ok: false, error: 'dist folder does not exist: ' + distFolderPath }; }

    var quality = Math.max(0, Math.min(11, Number(opts.brotliQuality != null ? opts.brotliQuality : 11)));
    var lgwin = Math.max(10, Math.min(24, Number(opts.brotliLgwin != null ? opts.brotliLgwin : 22)));
    var gzipLevel = Math.max(1, Math.min(9, Number(opts.gzipLevel != null ? opts.gzipLevel : 9)));
    var exts = Array.isArray(opts.extensions) && opts.extensions.length ? opts.extensions : DEFAULT_EXTENSIONS;
    var minBytes = Math.max(0, Number(opts.minBytes != null ? opts.minBytes : MIN_BYTES_DEFAULT));

    var compressed = [];
    var skipped = [];
    var originalBytes = 0, brBytes = 0, gzBytes = 0, filesHandled = 0;

    var files = listFilesRecursively(resolved);
    for (var i = 0; i < files.length; i++) {
      var abs = files[i];
      var rel = path.relative(resolved, abs).split(path.sep).join('/');
      var ext = path.extname(abs).toLowerCase();

      if (SIDECAR_EXTENSIONS.indexOf(ext) !== -1) continue; // never re-compress sidecars
      if (exts.indexOf(ext) === -1) { skipped.push({ file: rel, reason: 'extension not in compressible set' }); continue; }

      var buf;
      try { buf = fs.readFileSync(abs); }
      catch (e) { skipped.push({ file: rel, reason: 'unreadable' }); continue; }

      if (buf.length < minBytes) { skipped.push({ file: rel, reason: 'below minBytes (' + buf.length + ' < ' + minBytes + ')' }); continue; }

      // Compression — with round-trip verification before write.
      var br = null, gz = null;
      try {
        var brBuf = zlib.brotliCompressSync(buf, toBrotliOptions(quality, lgwin));
        if (zlib.brotliDecompressSync(brBuf).equals(buf)) br = brBuf;
        else skipped.push({ file: rel, reason: 'brotli round-trip mismatch — sidecar not written' });
      } catch (e) {
        skipped.push({ file: rel, reason: 'brotli failed: ' + (e && e.message ? e.message : String(e)) });
      }
      try {
        var gzBuf = zlib.gzipSync(buf, { level: gzipLevel });
        if (zlib.gunzipSync(gzBuf).equals(buf)) gz = gzBuf;
        else skipped.push({ file: rel, reason: 'gzip round-trip mismatch — sidecar not written' });
      } catch (e) {
        skipped.push({ file: rel, reason: 'gzip failed: ' + (e && e.message ? e.message : String(e)) });
      }

      // Incompressible content: a sidecar that doesn't shrink the
      // payload is a waste of edge bytes — skip the write.
      var brWritten = false, gzWritten = false;
      if (br && br.length < buf.length) {
        try { fs.writeFileSync(abs + '.br', br); brWritten = true; brBytes += br.length; }
        catch (e) { skipped.push({ file: rel, reason: 'br write failed' }); }
      } else if (br) {
        skipped.push({ file: rel, reason: 'brotli sidecar would not shrink asset' });
      }
      if (gz && gz.length < buf.length) {
        try { fs.writeFileSync(abs + '.gz', gz); gzWritten = true; gzBytes += gz.length; }
        catch (e) { skipped.push({ file: rel, reason: 'gz write failed' }); }
      } else if (gz) {
        skipped.push({ file: rel, reason: 'gzip sidecar would not shrink asset' });
      }

      if (brWritten || gzWritten) {
        filesHandled++;
        originalBytes += buf.length;
        compressed.push({
          file: rel,
          br: brWritten ? { bytes: br.length, savedPct: Math.round((1 - br.length / buf.length) * 10000) / 100 } : null,
          gz: gzWritten ? { bytes: gz.length, savedPct: Math.round((1 - gz.length / buf.length) * 10000) / 100 } : null
        });
      }
    }

    return {
      ok: true,
      compressed: compressed,
      skipped: skipped,
      totals: {
        files: filesHandled,
        originalBytes: originalBytes,
        brBytes: brBytes,
        gzBytes: gzBytes,
        brSavedPct: originalBytes ? Math.round((1 - brBytes / originalBytes) * 10000) / 100 : 0,
        gzSavedPct: originalBytes ? Math.round((1 - gzBytes / originalBytes) * 10000) / 100 : 0
      },
      settings: { brotliQuality: quality, brotliLgwin: lgwin, gzipLevel: gzipLevel, minBytes: minBytes }
    };
  };

  /**
   * verifySidecars(distFolderPath, options)
   * Decompresses every .br/.gz sidecar and compares it to the
   * current source file. Catches stale sidecars (source changed
   * after compression) and corrupt ones.
   * @returns {{ ok, checked, issues: [{file, sidecar, status}] } |
   *           { ok: false, error }}
   */
  AssetCompressor.verifySidecars = function (distFolderPath) {
    if (!distFolderPath) return { ok: false, error: 'distFolderPath is required.' };
    var resolved = path.resolve(distFolderPath);
    var files = listFilesRecursively(resolved);
    var checked = 0;
    var issues = [];
    for (var i = 0; i < files.length; i++) {
      var abs = files[i];
      var ext = path.extname(abs).toLowerCase();
      if (SIDECAR_EXTENSIONS.indexOf(ext) === -1) continue;
      var rel = path.relative(resolved, abs).split(path.sep).join('/');
      var sourceAbs = abs.slice(0, -ext.length);
      var decompressed = null;
      try {
        var raw = fs.readFileSync(abs);
        decompressed = ext === '.br' ? zlib.brotliDecompressSync(raw) : zlib.gunzipSync(raw);
      } catch (e) {
        issues.push({ file: rel, sidecar: ext, status: 'corrupt' });
        continue;
      }
      var src;
      try { src = fs.readFileSync(sourceAbs); }
      catch (e) {
        issues.push({ file: rel, sidecar: ext, status: 'stale-source-missing' });
        continue;
      }
      if (!decompressed.equals(src)) {
        issues.push({ file: rel, sidecar: ext, status: 'stale — source changed after compression' });
        continue;
      }
      checked++;
    }
    return { ok: issues.length === 0, checked: checked, issues: issues };
  };

  /**
   * cleanupSidecars(distFolderPath)
   * Removes .br/.gz sidecars whose source file is gone.
   * @returns {{ ok, removed: string[] }} | { ok: false, error }
   */
  AssetCompressor.cleanupSidecars = function (distFolderPath) {
    if (!distFolderPath) return { ok: false, error: 'distFolderPath is required.' };
    var resolved = path.resolve(distFolderPath);
    var files = listFilesRecursively(resolved);
    var removed = [];
    for (var i = 0; i < files.length; i++) {
      var abs = files[i];
      var ext = path.extname(abs).toLowerCase();
      if (SIDECAR_EXTENSIONS.indexOf(ext) === -1) continue;
      if (!fs.existsSync(abs.slice(0, -ext.length))) {
        try { fs.unlinkSync(abs); removed.push(path.relative(resolved, abs).split(path.sep).join('/')); }
        catch (e) { /* best effort */ }
      }
    }
    return { ok: true, removed: removed };
  };

  /**
   * edgeServerConfig(server, distFolderPath)
   * Convenience: the exact server block / config that serves the
   * sidecars, so the Studio can hand users a copy-paste snippet.
   * @param {'nginx'|'caddy'|'cloudflare'} server
   */
  AssetCompressor.edgeServerConfig = function (server) {
    switch (String(server || '').toLowerCase()) {
      case 'nginx':
        return [
          '# Serve pre-compressed sidecars — zero runtime CPU',
          'gzip_static on;',
          'brotli_static on;',
          '# Requires ngx_brotli; both fall back to on-the-fly when a sidecar is missing.'
        ].join('\n');
      case 'caddy':
        return [
          '# Caddy v2: serve .br/.gz sidecars when present',
          'file_server {',
          '  precompressed br gzip',
          '}'
        ].join('\n');
      case 'cloudflare':
        return [
          '# Cloudflare picks up pre-compressed assets automatically for',
          '# Workers/Pages assets; for proxied origins ensure:',
          '#   - brotli: on   (default)',
          '#   - origin serving .br with Content-Encoding: br'
        ].join('\n');
      default:
        return null;
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = AssetCompressor;
})();
