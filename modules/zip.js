// ============================================================
// PallettAI Studio — minimal ZIP writer (store method, no deps)
// Builds a valid .zip in memory from {name, content} entries.
// Content: string (UTF-8) or Uint8Array. Names should be ASCII.
// Works in the browser (global ZIP) and Node (module.exports).
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

  // ---- assemble the archive ----
  const MAX_ENTRIES = 512;
  const MAX_FILE_BYTES = 12 * 1024 * 1024;
  const MAX_ARCHIVE_BYTES = 48 * 1024 * 1024;

  function zipFiles(entries) {
    const list = Array.isArray(entries) ? entries : [];
    if (list.length > MAX_ENTRIES) throw new Error('Export contains too many files. Remove some pages or assets and try again.');
    const now = dosDateTime(new Date());
    const parts = [];          // all bytes, in order
    const central = [];        // central-directory records (bytes + metadata)
    let offset = 0;
    let projectedTotal = 22;

    for (const entry of list) {
      const name = String(entry.name || 'file').replace(/\\/g, '/');
      if (!name || name.startsWith('/') || name.split('/').includes('..')) throw new Error('Export contains an unsafe file path.');
      const nameBytes = new TextEncoder().encode(name);
      if (nameBytes.length > 255) throw new Error('Export contains a file name that is too long.');
      const data = toBytes(entry.content);
      if (data.length > MAX_FILE_BYTES) throw new Error('Export contains a file larger than 12 MB.');
      projectedTotal += 30 + nameBytes.length + data.length + 46 + nameBytes.length;
      if (projectedTotal > MAX_ARCHIVE_BYTES) throw new Error('Export is larger than 48 MB. Remove some assets and try again.');
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
    let total = cdOffset + cdSize + 22;
    if (total > MAX_ARCHIVE_BYTES) throw new Error('Export is larger than 48 MB. Remove some assets and try again.');
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

  const api = { zipFiles, downloadZip, crc32 };
  root.ZIP = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
