// ============================================================
// PallettAI Studio — publish to the client's own account
//
// Netlify and Neocities were already wired up. This adds the two providers
// agencies actually ask for when a client wants their own domain, and it keeps
// every request body in one pure, testable place rather than scattered through
// async UI code — because request shaping is exactly the part that fails
// silently and the part a test can actually pin down.
//
//   Vercel — one documented JSON call. Files travel base64-encoded inside the
//   deployment body and the response carries the live URL.
//
//   Cloudflare Pages — the same five-step protocol Wrangler uses, which is not
//   in the Pages docs (only the CLI and dashboard upload are) but is stable:
//     GET  …/pages/projects/{p}/upload-token      -> short-lived upload JWT
//     POST …/pages/assets/upload                  -> file bytes, keyed by hash
//     POST …/pages/assets/upsert-hashes           -> declare that upload done
//     POST …/accounts/{a}/pages/projects/{p}/deployments  -> manifest, multipart
//   The manifest step is the fragile one: Cloudflare returns 500 if the multipart
//   boundaries and part headers are not exact, so that body is built here and
//   asserted in the smoke test instead of being assembled inline at the call
//   site, where a mistake would only show up against a live account.
//
// The content hash is computed in pure JavaScript rather than via SubtleCrypto.
// `crypto.subtle` is unavailable outside a secure context, and a deploy that
// cannot hash is a deploy that cannot happen — so it is implemented here and
// checked against the published SHA-256 test vectors. Cloudflare treats the hash
// as an opaque key (Wrangler sends blake3, MD5 has been observed working), so
// what matters is that it is strong and consistent, not which algorithm it is.
//
// No network calls live here. No DOM, no storage.
// ============================================================

'use strict';

const Publish = (() => {
  // ---- SHA-256 (pure, dependency-free) -----------------------------------
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function utf8Bytes(str) {
    const s = String(str == null ? '' : str);
    const out = [];
    for (let i = 0; i < s.length; i++) {
      let c = s.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c >= 0xd800 && c <= 0xdbff) {
        const next = s.charCodeAt(++i);
        c = 0x10000 + ((c & 0x3ff) << 10) + (next & 0x3ff);
        out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }

  const rotr = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0;

  function sha256Hex(input) {
    const bytes = utf8Bytes(input);
    const bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    // length as a 64-bit big-endian value; JS is safe here well past any export
    const hi = Math.floor(bitLen / 4294967296);
    const lo = bitLen >>> 0;
    bytes.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255);
    bytes.push((lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);

    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    const w = new Array(64);

    for (let off = 0; off < bytes.length; off += 64) {
      for (let i = 0; i < 16; i++) {
        const j = off + i * 4;
        w[i] = ((bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3]) >>> 0;
      }
      for (let i = 16; i < 64; i++) {
        const s0 = (rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0;
        const s1 = (rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0;
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      for (let i = 0; i < 64; i++) {
        const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
        const ch = ((e & f) ^ (~e & g)) >>> 0;
        const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
        const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
        const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
        const t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0;
        d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
    }
    return [h0, h1, h2, h3, h4, h5, h6, h7].map((x) => x.toString(16).padStart(8, '0')).join('');
  }

  // ---- base64 ------------------------------------------------------------
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

  function toBase64(str) {
    const bytes = utf8Bytes(str);
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
      out += B64[b0 >> 2];
      out += B64[((b0 & 3) << 4) | ((b1 === undefined ? 0 : b1) >> 4)];
      out += b1 === undefined ? '=' : B64[((b1 & 15) << 2) | ((b2 === undefined ? 0 : b2) >> 6)];
      out += b2 === undefined ? '=' : B64[b2 & 63];
    }
    return out;
  }

  // ---- file preparation --------------------------------------------------
  const TYPES = {
    html: 'text/html; charset=utf-8',
    htm: 'text/html; charset=utf-8',
    css: 'text/css; charset=utf-8',
    js: 'text/javascript; charset=utf-8',
    json: 'application/json; charset=utf-8',
    txt: 'text/plain; charset=utf-8',
    xml: 'application/xml; charset=utf-8',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    woff2: 'font/woff2'
  };

  function contentType(path) {
    const ext = String(path || '').split('.').pop().toLowerCase();
    return TYPES[ext] || 'application/octet-stream';
  }

  // Paths must be exactly what the browser will request: Cloudflare resolves a
  // deployment's manifest by pathname, so "index.html" (not "/index.html") is
  // what a static host serves at "/".
  function normalizePath(name) {
    return String(name == null ? '' : name).replace(/^\/+/, '').replace(/\\/g, '/').trim();
  }

  function entries(files) {
    const seen = new Set();
    const out = [];
    (Array.isArray(files) ? files : []).forEach((f) => {
      const path = normalizePath(f && f.name);
      if (!path || seen.has(path)) return;    // first one wins; a duplicate path would silently overwrite
      seen.add(path);
      const content = String((f && f.content) != null ? f.content : '');
      out.push({
        path: path,
        contentType: contentType(path),
        content: content,
        length: utf8Bytes(content).length,
        base64: toBase64(content),
        hash: sha256Hex(content)
      });
    });
    return out;
  }

  // ---- Vercel ------------------------------------------------------------
  // POST https://api.vercel.com/v13/deployments
  // Diacritics are folded rather than dropped: without this, “Café Ltd” slugs to
  // `caf-ltd` and the client's project name loses a letter.
  function slug(name) {
    return String(name || 'site')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '').slice(0, 52) || 'site';
  }

  function vercelBody(name, projectName, fileList) {
    return {
      name: slug(projectName || name),
      target: 'production',
      files: entries(fileList).map((e) => ({ file: e.path, data: e.base64 })),
      projectSettings: { framework: null }
    };
  }

  function vercelUrl(payload) {
    const u = payload && (payload.url || (payload.alias && payload.alias[0]));
    if (!u) return '';
    return /^https?:\/\//.test(u) ? u : 'https://' + u;
  }

  function vercelReady(payload) {
    const s = String((payload && payload.readyState) || '').toUpperCase();
    return s === 'READY';
  }

  function vercelFailed(payload) {
    const s = String((payload && payload.readyState) || '').toUpperCase();
    return s === 'ERROR' || s === 'CANCELED';
  }

  // ---- Cloudflare Pages --------------------------------------------------
  const CF_API = 'https://api.cloudflare.com/client/v4';

  function cfUploadTokenUrl(accountId, projectName) {
    return CF_API + '/accounts/' + encodeURIComponent(accountId) + '/pages/projects/' + encodeURIComponent(projectName) + '/upload-token';
  }
  function cfAssetsUrl() { return CF_API + '/pages/assets/upload'; }
  function cfUpsertUrl() { return CF_API + '/pages/assets/upsert-hashes'; }
  function cfDeployUrl(accountId, projectName) {
    return CF_API + '/accounts/' + encodeURIComponent(accountId) + '/pages/projects/' + encodeURIComponent(projectName) + '/deployments';
  }
  function cfProjectUrl(accountId, projectName) {
    return CF_API + '/accounts/' + encodeURIComponent(accountId) + '/pages/projects' + (projectName ? '/' + encodeURIComponent(projectName) : '');
  }

  // The asset upload body: key is the content hash, value the raw base64.
  function cfAssetsBody(fileList) {
    return entries(fileList).map((e) => ({
      key: e.hash,
      value: e.base64,
      metadata: { contentType: e.contentType },
      base64: true
    }));
  }

  // path -> hash, which is how Cloudflare resolves the deployment.
  function cfManifest(fileList) {
    const manifest = {};
    entries(fileList).forEach((e) => { manifest[e.path] = e.hash; });
    return manifest;
  }

  // The fragile step, so it gets built in one place and asserted rather than
  // assembled at the call site. Each top-level manifest *key* becomes its own
  // part (Cloudflare expects one part per path, not a single JSON blob).
  // RFC 7578 escaping for a part name. A path containing a quote or a CRLF would
  // otherwise break out of the header and inject further parts, so the three
  // characters that can terminate a name are percent-encoded.
  const partName = (p) => String(p == null ? '' : p)
    .replace(/\r/g, '%0D').replace(/\n/g, '%0A').replace(/"/g, '%22');

  function cfManifestMultipart(manifest, boundaryIn) {
    const boundary = boundaryIn || ('----pallettai' + Math.random().toString(36).slice(2, 14));
    const keys = Object.keys(manifest || {}).sort();
    let head = '';
    keys.forEach((path) => {
      head += '--' + boundary + '\r\n'
        + 'Content-Disposition: form-data; name="' + partName(path) + '"\r\n'
        + 'Content-Type: application/json\r\n\r\n'
        + JSON.stringify(manifest[path]) + '\r\n';
    });
    head += '--' + boundary + '--\r\n';
    const bytes = utf8Bytes(head);
    return { body: bytesToBlob(bytes, 'multipart/form-data; boundary=' + boundary), boundary: boundary, bytes: bytes };
  }

  function bytesToBlob(bytes, type) {
    const view = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) view[i] = bytes[i] & 255;
    if (typeof Blob !== 'undefined') return new Blob([view], { type: type });
    return view;
  }

  function cfProjectBody(name, productionBranch) {
    return { name: slug(name), production_branch: productionBranch || 'main' };
  }

  // Cloudflare wraps every response in { success, errors, result }.
  function cfUrl(payload, projectName) {
    const r = (payload && payload.result) || {};
    return r.url || ('https://' + slug(projectName) + '.pages.dev');
  }

  function cfError(payload, status) {
    const errs = (payload && Array.isArray(payload.errors) ? payload.errors : [])
      .map((e) => (e && (e.message || e.code)) || '')
      .filter(Boolean);
    if (errs.length) return errs.join('; ');
    return 'Cloudflare rejected the request (' + (status || '?') + ')';
  }

  // ---- shared ------------------------------------------------------------
  function deployFileName(siteName) {
    return slug(siteName) + '-deploy.zip';
  }

  function cfDashboardUrl() {
    return 'https://dash.cloudflare.com/?to=/:account/workers-and-pages';
  }

  return {
    sha256Hex, toBase64, utf8Bytes, contentType, normalizePath, entries, slug, partName,
    vercelBody, vercelUrl, vercelReady, vercelFailed,
    CF_API, cfUploadTokenUrl, cfAssetsUrl, cfUpsertUrl, cfDeployUrl, cfProjectUrl,
    cfAssetsBody, cfManifest, cfManifestMultipart, cfProjectBody, cfUrl, cfError,
    deployFileName, cfDashboardUrl
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Publish;
