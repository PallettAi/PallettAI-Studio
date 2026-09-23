// ============================================================
// PallettAI Studio — minimal ZIP writer (store method, no deps)
// Builds a valid .zip in memory from {name, content} entries.
// Content: string (UTF-8) or Uint8Array. Names should be ASCII.
// Works in the browser (global ZIP) and Node (module.exports).
//
// ---- what this file guarantees ----------------------------------
// 1. NOTHING IS EVER TRUNCATED SILENTLY. Every limit here throws a
//    ZipBuildError that names the file and states the numbers, because the
//    failure this replaced was a message a customer could not act on.
// 2. A NAME CANNOT ESCAPE THE FOLDER IT IS EXTRACTED INTO. Rejection, never
//    rewriting: silently stripping a ".." would fold two requested names into
//    one file, and the caller would never learn which asset it had lost.
// 3. THE ARCHIVE IS BUILT IN ONE ALLOCATION of the exact final size. The parts
//    are accumulated first and measured, then written — so the entry count is
//    bounded by memory and by the ZIP format, not by an arbitrary number.
//
// The entry ceiling is deliberately left where it is. See ENTRY_LIMIT.
// ============================================================

(function (root) {
  'use strict';

  // ---- CRC-32 (IEEE, standard zip polynomial) ----
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function toBytes(content) {
    if (content instanceof Uint8Array) return content;
    return new TextEncoder().encode(String(content));
  }

  function dosDateTime(d) {
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
    return { date, time };
  }

  // ---- the error -----------------------------------------------------------
  // A caller has to be able to tell these apart without matching on prose, and
  // the person looking at the toast needs the numbers. Both live on the error,
  // so app.js can keep showing `e.message` unchanged and anything else can
  // branch on `e.code` or read `e.metrics` without re-deriving them.
  class ZipBuildError extends Error {
    constructor(code, message, metrics) {
      super(message);
      this.name = 'ZipBuildError';
      this.code = code;
      this.metrics = metrics || {};
    }
  }

  const mb = (bytes) => (Math.round((bytes / (1024 * 1024)) * 10) / 10) + ' MB';

  // ---- limits --------------------------------------------------------------
  // ENTRY_LIMIT is the policy ceiling, not a format limit, and it is a
  // deliberate product decision rather than an accident: release-check.js
  // asserts that entry 513 is refused. It bounds how much a single export can
  // put in memory in a browser tab, which is the resource that actually runs
  // out. Raising it is a one-line change here, but it also means changing that
  // assertion, so it is stated rather than quietly moved.
  const ENTRY_LIMIT = 512;
  // The format itself cannot describe more than this: the end-of-central-
  // directory record stores the entry count in a 16-bit field. Past 65,535 the
  // count wraps and the archive silently claims the wrong number of files, so
  // it is refused rather than written wrong.
  const ENTRY_LIMIT_FORMAT = 65535;
  const MAX_FILE_BYTES = 12 * 1024 * 1024;
  const MAX_ARCHIVE_BYTES = 48 * 1024 * 1024;
  const MAX_NAME_BYTES = 255;   // fixed-width field in both zip headers

  // ---- path sanitising -----------------------------------------------------
  // A name in a zip is a path, and every extractor resolves it against a
  // destination folder. These are the shapes that resolve outside it, plus the
  // ones that two different names collapse into on Windows.
  //
  // Returned normalised (backslashes to forward, "./" and doubled separators
  // removed) so the archive has one spelling per file, then rejected if any
  // rule below still applies. Segments are checked AFTER normalising, so
  // "a\\..\\b" cannot slip through as one innocuous-looking segment.
  function unsafeReason(name) {
    if (!name) return 'it is empty';
    // Control characters (including NUL) end a name in some extractors and are
    // stripped by others — either way the file lands somewhere unexpected.
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(name)) return 'it contains a control character';
    if (name.charAt(0) === '/') return 'it is an absolute path';
    if (/^[a-zA-Z]:/.test(name)) return 'it is an absolute Windows path';
    const parts = name.split('/');
    if (parts.indexOf('..') !== -1) return 'it tries to leave the export folder';
    // Windows drops a trailing dot or space from a name, so "notes. " and
    // "notes" become the same file on extraction — one would overwrite the other.
    if (parts.some((p) => /[. ]$/.test(p))) return 'a segment ends with a dot or a space, which Windows strips';
    return '';
  }

  function safePath(raw) {
    let name = String(raw == null ? '' : raw).replace(/\\/g, '/');
    name = name.replace(/^(?:\.\/)+/, '').replace(/\/{2,}/g, '/');
    const reason = unsafeReason(name);
    if (reason) {
      throw new ZipBuildError(
        'unsafe-path',
        'Export contains an unsafe file path (' + (String(raw) || '(empty)') + '): ' + reason + '.',
        { name: String(raw == null ? '' : raw) }
      );
    }
    return name;
  }

  // ---- assemble the archive ------------------------------------------------
  // Two passes on purpose. The first validates every entry and totals the exact
  // byte count; the second writes into one buffer of precisely that size. A
  // single growable buffer would either reallocate repeatedly or, worse, be
  // pre-sized on a guess and drop the tail.
  function zipFiles(entries) {
    const list = Array.isArray(entries) ? entries : [];
    if (list.length > ENTRY_LIMIT_FORMAT) {
      throw new ZipBuildError(
        'entry-count-unrepresentable',
        'Export contains too many files to describe: ' + list.length + ' exceeds the ' + ENTRY_LIMIT_FORMAT + ' an archive can record.',
        { entries: list.length, limit: ENTRY_LIMIT_FORMAT }
      );
    }
    if (list.length > ENTRY_LIMIT) {
      throw new ZipBuildError(
        'too-many-entries',
        'Export contains too many files: ' + list.length + ' of a ' + ENTRY_LIMIT + ' limit. Remove some pages or assets and try again.',
        { entries: list.length, limit: ENTRY_LIMIT }
      );
    }

    const now = dosDateTime(new Date());
    const parts = [];          // all bytes, in order
    const central = [];        // central-directory records (bytes + metadata)
    let offset = 0;
    let projectedTotal = 22;   // the end-of-central-directory record
    let largest = { name: '', bytes: 0 };

    for (const entry of list) {
      const name = safePath(entry.name);
      const nameBytes = new TextEncoder().encode(name);
      if (nameBytes.length > MAX_NAME_BYTES) {
        throw new ZipBuildError(
          'name-too-long',
          'Export contains a file name that is too long (' + nameBytes.length + ' bytes, limit ' + MAX_NAME_BYTES + '): ' + name,
          { name, bytes: nameBytes.length, limit: MAX_NAME_BYTES }
        );
      }
      const data = toBytes(entry.content);
      if (data.length > MAX_FILE_BYTES) {
        throw new ZipBuildError(
          'file-too-large',
          'Export contains a file larger than 12 MB (' + name + ' is ' + mb(data.length) + ').',
          { name, bytes: data.length, limit: MAX_FILE_BYTES }
        );
      }
      if (data.length > largest.bytes) largest = { name, bytes: data.length };

      projectedTotal += 30 + nameBytes.length + data.length + 46 + nameBytes.length;
      if (projectedTotal > MAX_ARCHIVE_BYTES) {
        throw new ZipBuildError(
          'archive-too-large',
          'Export is larger than 48 MB. Remove some assets and try again.',
          {
            entries: list.length,
            projectedBytes: projectedTotal,
            limit: MAX_ARCHIVE_BYTES,
            largestName: largest.name,
            largestBytes: largest.bytes
          }
        );
      }

      const crc = crc32(data);
      const size = data.length;
      const header = new DataView(new ArrayBuffer(30));
      header.setUint32(0, 0x04034b50, true);        // local file header signature
      header.setUint16(4, 20, true);                // version needed
      header.setUint16(6, 0, true);                 // flags
      header.setUint16(8, 0, true);                 // method: store
      header.setUint16(10, now.time, true);
      header.setUint16(12, now.date, true);
      header.setUint32(14, crc, true);
      header.setUint32(18, size, true);
      header.setUint32(22, size, true);
      header.setUint16(26, nameBytes.length, true);
      header.setUint16(28, 0, true);                // extra length
      parts.push(new Uint8Array(header.buffer), nameBytes, data);

      const rec = new DataView(new ArrayBuffer(46));
      rec.setUint32(0, 0x02014b50, true);           // central directory signature
      rec.setUint16(4, 20, true);                   // version made by
      rec.setUint16(6, 20, true);                   // version needed
      rec.setUint16(8, 0, true);
      rec.setUint16(10, 0, true);
      rec.setUint16(12, now.time, true);
      rec.setUint16(14, now.date, true);
      rec.setUint32(16, crc, true);
      rec.setUint32(20, size, true);
      rec.setUint32(24, size, true);
      rec.setUint16(28, nameBytes.length, true);
      rec.setUint16(30, 0, true);                   // extra
      rec.setUint16(32, 0, true);                   // comment
      rec.setUint16(34, 0, true);                   // disk start
      rec.setUint16(36, 0, true);                   // internal attrs
      rec.setUint32(38, 0, true);                   // external attrs
      rec.setUint32(42, offset, true);              // local header offset
      central.push({ bytes: new Uint8Array(rec.buffer), name: nameBytes });
      offset += 30 + nameBytes.length + size;
    }

    const cdOffset = offset;
    let cdSize = 0;
    central.forEach((c) => { cdSize += c.bytes.length + c.name.length; });

    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);             // end of central directory
    end.setUint16(4, 0, true);
    end.setUint16(6, 0, true);
    end.setUint16(8, list.length, true);
    end.setUint16(10, list.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, cdOffset, true);
    end.setUint16(20, 0, true);

    // total length = local parts + central records + end record
    const total = cdOffset + cdSize + 22;
    if (total > MAX_ARCHIVE_BYTES) {
      throw new ZipBuildError(
        'archive-too-large',
        'Export is larger than 48 MB (' + mb(total) + '). Remove some assets and try again.',
        { entries: list.length, projectedBytes: total, limit: MAX_ARCHIVE_BYTES, largestName: largest.name, largestBytes: largest.bytes }
      );
    }
    const out = new Uint8Array(total);
    let pos = 0;
    for (const p of parts) { out.set(p, pos); pos += p.length; }
    for (const c of central) { out.set(c.bytes, pos); pos += c.bytes.length; out.set(c.name, pos); pos += c.name.length; }
    out.set(new Uint8Array(end.buffer), pos);
    return out;
  }

  // ---- browser download helper ----
  function downloadZip(filename, entries) {
    const blob = new Blob([zipFiles(entries)], { type: 'application/zip' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return filename;
  }

  const api = {
    zipFiles, downloadZip, crc32,
    ZipBuildError, safePath, unsafeReason,
    limits: { entries: ENTRY_LIMIT, formatEntries: ENTRY_LIMIT_FORMAT, fileBytes: MAX_FILE_BYTES, archiveBytes: MAX_ARCHIVE_BYTES, nameBytes: MAX_NAME_BYTES }
  };
  root.ZIP = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
