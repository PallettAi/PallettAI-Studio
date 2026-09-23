'use strict';
// ============================================================
// PallettAI Studio — one-click cloud deployment adapters
// Node-side (CommonJS) adapters that publish compiled static
// sites straight from Studio. Zero SDK dependencies: plain
// HTTPS calls via global fetch + Node's crypto/zlib builtins.
// ------------------------------------------------------------
// Adapters:
//   1. deployToCloudflarePages(apiToken, accountId, projectName, zipBuffer)
//    — Cloudflare Pages direct-upload REST flow:
//    ensure project → upload-token → assets/upload →
//    upsert-hashes → multipart deployments.
//   2. deployToNetlify(personalAccessToken, siteId, zipBuffer)
//    — zip upload straight to the Netlify deploys endpoint
//    (same PUT application/zip call Studio already ships;
//    creates the site first when siteId is omitted).
//   3. deployToGitHubPages(githubToken, repo, branch, siteFiles)
//    — GitHub git-data REST sequence (blob/tree → commit → ref),
//    i.e. what Octokit's git.createBlob/createTree/createCommit/
//    updateRef does under the hood, with an orphan-branch
//    fallback when the deploy branch does not exist yet.
//   4. publishSite(provider, credentials, siteData, onProgress?)
//    — unified dispatcher: validates credentials, normalizes
//    site payloads, streams {provider, stage, pct, message}
//    progress events and *never throws* — it resolves to
//    {ok:true, url, durationMs, stages} or
//    {ok:false, code, message, status, stages}.
// ------------------------------------------------------------
// All adapters accept opts {fetch, onProgress, timeoutMs} so
// tests (and air-gapped users) can inject their own transport.
// Tokens are never echoed into error messages or results.
// ============================================================

const zlib = require('zlib');
const crypto = require('crypto');
const { unsafeReason } = require('./zip.js');

const PRODUCTION_BRANCH = 'main';
const DEFAULT_TIMEOUT_MS = 60000;
const USER_AGENT = 'PallettAI-Studio-Deploy';
const CF_API = 'https://api.cloudflare.com/client/v4';
const NETLIFY_API = 'https://api.netlify.com/api/v1';
const GITHUB_API = 'https://api.github.com';

// ZIP input limits — mirrors modules/zip.js writing limits so a
// Studio-produced archive always round-trips through the reader.
const ZIP_LIMITS = { entries: 512, fileBytes: 12 * 1024 * 1024, archiveBytes: 48 * 1024 * 1024 };

// ---------------------------------------------------------- errors

/** Deployment failure with machine-readable context. Tokens excluded. */
class DeployError extends Error {
  constructor(message, info) {
    super(message);
    this.name = 'DeployError';
    info = info || {};
    this.provider = info.provider || '';
    this.code = info.code || 'deploy_failed';
    this.status = Number.isFinite(info.status) ? info.status : 0;
    this.detail = info.detail || '';
  }
}

function isBinaryZipped(x) {
  return Buffer.isBuffer(x) || x instanceof Uint8Array || x instanceof ArrayBuffer;
}

function toBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (data instanceof Uint8Array) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  throw new DeployError('zipBuffer must be a Buffer, Uint8Array, or ArrayBuffer', { code: 'bad_input' });
}

function slug(name) {
  return String(name == null ? '' : name).toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

// Minimal static extension table — no dependency on the builder.
const CTYPES = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject', '.map': 'application/json',
  '.webmanifest': 'application/manifest+json', '.pdf': 'application/pdf'
};
function contentTypeFor(name) {
  const lower = String(name || '').toLowerCase();
  const dot = lower.lastIndexOf('.');
  return CTYPES[dot >= 0 ? lower.slice(dot) : ''] || 'application/octet-stream';
}

// ----------------------------------------------------- transport helpers

/** Pull the Authorization value out of a fetch init for redaction. */
function headerValue(init) {
  const h = init && init.headers;
  if (!h) return '';
  if (typeof Headers !== 'undefined' && h instanceof Headers) return h.get('authorization') || '';
  if (Array.isArray(h)) {
    const hit = h.find(function (kv) { return String(kv && kv[0]).toLowerCase() === 'authorization'; });
    return hit ? String(hit[1]) : '';
  }
  for (const k of Object.keys(h)) {
    if (k.toLowerCase() === 'authorization') return String(h[k]);
  }
  return '';
}

/** Strip token material from any text (server bodies, error messages). */
function scrub(text, token) {
  let s = String(text == null ? '' : text);
  if (token) s = s.split(String(token)).join('[redacted]');
  s = s.replace(/(authorization["'\s:=]+)(bearer\s+)?[\w.~+/-]{8,}=*/gi, '$1[redacted]');
  return s;
}

function httpError(provider, res, token, bodyText) {
  let detail = String(bodyText || '');
  try {
    const j = JSON.parse(detail);
    if (j && Array.isArray(j.errors) && j.errors.length) {
      detail = j.errors.map(function (e) { return e && e.message ? e.message : JSON.stringify(e); }).join('; ');
    } else if (j && j.error) {
      detail = typeof j.error === 'string' ? j.error : (j.error.message || JSON.stringify(j.error));
    } else if (j && j.message) {
      detail = j.message;
    }
  } catch (_e) { /* keep raw */ }
  detail = scrub(detail, token);
  if (detail.length > 300) detail = detail.slice(0, 300) + '…';
  const label = {
    401: 'invalid or expired token', 403: 'forbidden — check token scopes',
    404: 'not found — check ids/names', 409: 'conflict', 413: 'payload too large',
    422: 'rejected by provider', 429: 'rate limited'
  }[res.status] || 'HTTP ' + res.status;
  return new DeployError(
    provider + ' API failed: ' + label + (detail ? ' — ' + detail : ''),
    { provider, code: 'http', status: res.status, detail }
  );
}

function makeTimeout(ms) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  if (!ctrl) return { signal: undefined, done: function () {} };
  const t = setTimeout(function () { ctrl.abort(); }, Math.max(1000, ms));
  return { signal: ctrl.signal, done: function () { clearTimeout(t); } };
}

/**
 * fetch wrapper with timeout + normalized DeployError.
 * opts: {provider, token, label, raw}
 *   raw → return the Response without reading/throwing (probes).
 */
function makeHttp(fetchImpl, timeoutMs) {
  return async function request(url, init, opts) {
    opts = opts || {};
    const token = opts.token || '';
    const label = opts.label || url;
    const to = makeTimeout(timeoutMs);
    let res;
    try {
      res = await fetchImpl(url, Object.assign({}, init, { signal: to.signal }));
    } catch (e) {
      const msg = e && e.name === 'AbortError'
        ? label + ' timed out after ' + timeoutMs + 'ms'
        : label + ' unreachable — ' + scrub(e && e.message, token);
      throw new DeployError(msg, { provider: opts.provider, code: e && e.name === 'AbortError' ? 'timeout' : 'network' });
    } finally {
      to.done();
    }
    if (opts.raw) return res;
    const bodyText = (await res.text());
    const safeBody = scrub(bodyText, token);
    if (!res.ok) throw httpError(opts.provider || 'HTTP', res, token, safeBody);
    if (!bodyText) return {};
    try { return JSON.parse(safeBody); } catch (_e) { return { raw: safeBody }; }
  };
}

function want(opts) {
  opts = opts || {};
  return {
    fetch: opts.fetch || (typeof fetch === 'function' ? fetch : null),
    onProgress: typeof opts.onProgress === 'function' ? opts.onProgress : null,
    timeoutMs: Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : DEFAULT_TIMEOUT_MS
  };
}

function progress(cb, provider, stages, pct, stage, message) {
  const ev = { provider, stage, pct: Math.min(100, Math.max(0, pct)), message: message || stage };
  stages.push(ev);
  if (cb) { try { cb(ev); } catch (_e) { /* listener errors never break a deploy */ } }
}

// ------------------------------------------------- ZIP reader (input side)

function findEOCD(buf) {
  const min = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

/**
 * Minimal ZIP reader for deploy payloads (store + deflate).
 * Enforces the same safety rules and size limits as the
 * modules/zip.js writing side. Returns [{name, bytes}];
 * directory entries are skipped.
 */
function readZip(zipBuffer) {
  const buf = toBuffer(zipBuffer);
  if (buf.length < 22) throw new DeployError('zipBuffer is too small to be a ZIP archive', { code: 'bad_zip' });
  const eocd = findEOCD(buf);
  if (eocd < 0) throw new DeployError('zipBuffer has no end-of-central-directory record (not a ZIP?)', { code: 'bad_zip' });
  const count = buf.readUInt16LE(eocd + 10);
  if (count === 0xFFFF) throw new DeployError('ZIP64 archives are not supported', { code: 'bad_zip' });
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) {
      throw new DeployError('corrupt ZIP central directory', { code: 'bad_zip' });
    }
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const uncompSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const cmtLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + cmtLen;

    if (name.endsWith('/')) continue; // directory entry
    const reason = unsafeReason(name);
    if (reason) throw new DeployError('unsafe path in zipBuffer: ' + reason, { code: 'unsafe_path' });
    if (out.length >= ZIP_LIMITS.entries) throw new DeployError('zipBuffer exceeds ' + ZIP_LIMITS.entries + ' entries', { code: 'too_big' });
    if (uncompSize > ZIP_LIMITS.fileBytes) throw new DeployError('zipBuffer entry too large: ' + name, { code: 'too_big' });
    total += uncompSize;
    if (total > ZIP_LIMITS.archiveBytes) throw new DeployError('zipBuffer exceeds ' + ZIP_LIMITS.archiveBytes + ' uncompressed bytes', { code: 'too_big' });

    if (localOff + 30 > buf.length || buf.readUInt32LE(localOff) !== 0x04034b50) {
      throw new DeployError('corrupt ZIP local header: ' + name, { code: 'bad_zip' });
    }
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataOff = localOff + 30 + lNameLen + lExtraLen;
    const data = buf.slice(dataOff, dataOff + compSize);
    if (data.length !== compSize) throw new DeployError('truncated ZIP entry: ' + name, { code: 'bad_zip' });

    let bytes;
    if (method === 0) bytes = Buffer.from(data);
    else if (method === 8) {
      try { bytes = zlib.inflateRawSync(data, { maxOutputLength: ZIP_LIMITS.fileBytes }); }
      catch (e) { throw new DeployError('cannot inflate "' + name + '": ' + e.message, { code: 'bad_zip' }); }
    } else {
      throw new DeployError('unsupported ZIP compression method ' + method + ' in "' + name + '"', { code: 'bad_zip' });
    }
    out.push({ name, bytes });
  }
  return out;
}

/** Normalize site payload items ({name|path, content}) to {name, bytes}. */
function normalizeFiles(files) {
  if (!Array.isArray(files)) throw new DeployError('siteData.files must be an array of {path, content}', { code: 'bad_input' });
  if (!files.length) throw new DeployError('siteData.files is empty — nothing to publish', { code: 'bad_input' });
  if (files.length > ZIP_LIMITS.entries) throw new DeployError('too many files (' + files.length + ')', { code: 'too_big' });
  return files.map(function (f) {
    const name = String(f && (f.path || f.name || '')).replace(/^\.\//, '').replace(/^\/+/, '');
    if (!name) throw new DeployError('file entry is missing a path', { code: 'bad_input' });
    const reason = unsafeReason(name);
    if (reason) throw new DeployError('unsafe file path "' + name + '": ' + reason, { code: 'unsafe_path' });
    const content = f.content;
    let bytes;
    if (typeof content === 'string') bytes = Buffer.from(content, 'utf8');
    else if (content != null && (Buffer.isBuffer(content) || content instanceof Uint8Array)) bytes = Buffer.from(content);
    else throw new DeployError('file entry has no content: ' + name, { code: 'bad_input' });
    return { name, bytes };
  });
}

// ------------------------------------------- 1) Cloudflare Pages adapter

const CF = {
  project: function (a) { return CF_API + '/accounts/' + encodeURIComponent(a) + '/pages/projects'; },
  uploadToken: function (a, p) {
    return CF_API + '/accounts/' + encodeURIComponent(a) + '/pages/projects/' + encodeURIComponent(p) + '/upload-token';
  },
  assetsUpload: function (a, p) {
    return CF_API + '/accounts/' + encodeURIComponent(a) + '/pages/projects/' + encodeURIComponent(p) + '/assets/upload';
  },
  upsert: function (a, p) {
    return CF_API + '/accounts/' + encodeURIComponent(a) + '/pages/projects/' + encodeURIComponent(p) + '/assets/upsert-hashes';
  },
  deploy: function (a, p) {
    return CF_API + '/accounts/' + encodeURIComponent(a) + '/pages/projects/' + encodeURIComponent(p) + '/deployments';
  }
};

/** Cloudflare can answer 200 with {success:false} — treat that as failure. */
function cfCheck(http, provider, token, label) {
  return function (url, init) {
    return http(url, init, { provider, token, label }).then(function (j) {
      if (j && j.success === false) {
        const msgs = (j.errors || []).map(function (e) { return e && e.message ? e.message : JSON.stringify(e); }).join('; ');
        throw new DeployError(label + ' rejected: ' + (msgs || 'unknown error'),
          { provider, code: 'provider_error', status: j.status || 0, detail: msgs });
      }
      return j;
    });
  };
}

/** Asset batches of ≤500 (wrangler's batch size): {entries, hashes} in order. */
function cfAssetBatches(files) {
  const batches = [];
  const N = 500;
  for (let i = 0; i < files.length; i += N) {
    const slice = files.slice(i, i + N);
    batches.push({
      entries: slice.map(function (f) {
        return {
          key: f.name,
          value: { size: f.bytes.length, contentType: contentTypeFor(f.name), base64: f.bytes.toString('base64') }
        };
      }),
      hashes: slice.map(function (f) { return sha256(f.bytes); })
    });
  }
  return batches;
}

/** The {path: hash} manifest Cloudflare expects inside the multipart body. */
function cfManifest(files) {
  const m = {};
  for (const f of files) m[f.name] = sha256(f.bytes);
  return m;
}

/**
 * multipart/form-data body for POST .../deployments.
 * One text part per path whose value is that file's hash — byte-for-byte
 * the shape wrangler and Studio's existing publisher use — plus an
 * optional `branch` form field (wrangler sends the same field name);
 * omitting it targets the production branch.
 */
function cfDeployMultipart(manifest, meta, branch) {
  const boundary = '----PAI' + crypto.randomBytes(8).toString('hex');
  const parts = [];
  function part(name, filename, type, value) {
    parts.push('--' + boundary + '\r\n');
    if (filename != null) parts.push('Content-Disposition: form-data; name="' + name + '"; filename="' + filename + '"\r\n');
    else parts.push('Content-Disposition: form-data; name="' + name + '"\r\n');
    parts.push('Content-Type: ' + type + '\r\n\r\n');
    parts.push(value + '\r\n');
  }
  part('manifest.json', null, 'application/json', JSON.stringify(manifest));
  part('_metadata.json', null, 'application/json', JSON.stringify(meta));
  if (branch) part('branch', null, 'text/plain', String(branch));
  for (const p of Object.keys(manifest)) part(p, p.split('/').pop(), contentTypeFor(p), manifest[p]);
  parts.push('--' + boundary + '--\r\n');
  return { boundary, body: parts.join('') };
}

/** Full direct-upload flow over already-unpacked files. */
async function cfUploadFiles(http, apiToken, accountId, project, files, onProgress, stages, branch) {
  const provider = 'cloudflare';
  const auth = { Authorization: 'Bearer ' + apiToken };
  const json = cfCheck(http, provider, apiToken);

  // 1. Ensure the project exists (409 = already there, which is fine).
  try {
    await json(CF.project(accountId), {
      method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, auth),
      body: JSON.stringify({ name: project, production_branch: PRODUCTION_BRANCH })
    }, 'Cloudflare project create');
  } catch (e) {
    if (!(e instanceof DeployError && e.status === 409)) throw e;
  }
  progress(onProgress, provider, stages, 35, 'project', 'Project "' + project + '" ready');

  // 2. Upload token (JWT) — scoped credentials for the assets endpoints.
  const tok = await json(CF.uploadToken(accountId, project), { method: 'GET', headers: auth }, 'Cloudflare upload token');
  const jwt = tok.result || tok.jwt || '';
  if (!jwt) throw new DeployError('Cloudflare returned no upload token', { provider, code: 'bad_response' });
  progress(onProgress, provider, stages, 45, 'token', 'Upload token acquired');
  const upAuth = { Authorization: 'Bearer ' + jwt };

  // 3. Upload asset entries (batched) — hashes already known client-side.
  const batches = cfAssetBatches(files);
  let uploaded = 0;
  for (let i = 0; i < batches.length; i++) {
    await json(CF.assetsUpload(accountId, project), {
      method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, upAuth),
      body: JSON.stringify({ hashes: batches[i].entries })
    }, 'Cloudflare assets upload');
    uploaded += batches[i].entries.length;
    progress(onProgress, provider, stages, 45 + Math.round(35 * (i + 1) / batches.length),
      'upload', 'Uploaded ' + uploaded + '/' + files.length + ' asset(s)');
  }

  // 4. Commit every hash so the deployment can reference them.
  const allHashes = [];
  for (const b of batches) for (const h of b.hashes) allHashes.push(h);
  await json(CF.upsert(accountId, project), {
    method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, upAuth),
    body: JSON.stringify({ hashes: allHashes })
  }, 'Cloudflare upsert-hashes');
  progress(onProgress, provider, stages, 88, 'hashes', 'Asset hashes committed');

  // 5. Create the deployment (multipart: manifest + metadata + hash parts).
  const manifest = cfManifest(files);
  const mp = cfDeployMultipart(manifest, {
    project_type: 'static',
    main_module: 'index.html',
    skip_source_integrity: false
  }, branch);
  const dep = await json(CF.deploy(accountId, project), {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'multipart/form-data; boundary=' + mp.boundary }, auth),
    body: mp.body
  }, 'Cloudflare deployment');
  const d = dep.result || dep;
  progress(onProgress, provider, stages, 100, 'done', 'Deployment created');
  return { ok: true, provider, url: d.url || ('https://' + project + '.pages.dev'), deploymentId: d.id || '', stages };
}

/**
 * deployToCloudflarePages(apiToken, accountId, projectName, zipBuffer, opts?)
 * → {ok:true, url, deploymentId} (throws DeployError on failure).
 * opts.branch deploys to that preview branch; omit it for production.
 */
async function deployToCloudflarePages(apiToken, accountId, projectName, zipBuffer, opts) {
  const w = want(opts);
  if (!w.fetch) throw new DeployError('fetch is unavailable in this runtime', { provider: 'cloudflare', code: 'no_fetch' });
  if (!apiToken) throw new DeployError('Cloudflare API token is required', { provider: 'cloudflare', code: 'missing_credential' });
  if (!accountId) throw new DeployError('Cloudflare account id is required', { provider: 'cloudflare', code: 'missing_credential' });
  const project = slug(projectName);
  if (!project) throw new DeployError('Cloudflare project name is required', { provider: 'cloudflare', code: 'missing_credential' });
  const stages = [];
  const files = readZip(zipBuffer);
  if (!files.length) throw new DeployError('archive is empty — nothing to publish', { provider: 'cloudflare', code: 'bad_input' });
  progress(w.onProgress, 'cloudflare', stages, 20, 'unpack', 'Unpacked ' + files.length + ' file(s) from archive');
  const http = makeHttp(w.fetch, w.timeoutMs);
  return cfUploadFiles(http, apiToken, accountId, project, files, w.onProgress, stages, (opts && opts.branch) || '');
}

// ------------------------------------------------- 2) Netlify deploy adapter

const NL = {
  sites: function () { return NETLIFY_API + '/sites'; },
  deploy: function (siteId) { return NETLIFY_API + '/sites/' + encodeURIComponent(siteId) + '/deploys'; },
  builds: function (siteId) { return NETLIFY_API + '/sites/' + encodeURIComponent(siteId) + '/builds'; }
};

/**
 * multipart/form-data body for POST /sites/{id}/builds — the documented
 * zip + branch flow (file part `zip`, text part `branch`). Binary-safe:
 * the archive rides as a Buffer, never through a UTF-8 string.
 */
function netlifyZipMultipart(zip, branch) {
  const boundary = '----PAI' + crypto.randomBytes(8).toString('hex');
  const head = Buffer.from(
    '--' + boundary + '\r\n'
    + 'Content-Disposition: form-data; name="zip"; filename="site.zip"\r\n'
    + 'Content-Type: application/zip\r\n\r\n', 'utf8');
  const mid = Buffer.from(
    '\r\n--' + boundary + '\r\n'
    + 'Content-Disposition: form-data; name="branch"\r\n\r\n'
    + String(branch) + '\r\n', 'utf8');
  const tail = Buffer.from('--' + boundary + '--\r\n', 'utf8');
  return { boundary, body: Buffer.concat([head, Buffer.from(zip), mid, tail]) };
}

/**
 * deployToNetlify(personalAccessToken, siteId, zipBuffer, opts?)
 * Direct zip upload (PUT application/zip — the exact call Studio's
 * publish flow uses). Omit siteId to create one first; name comes
 * from opts.siteName or defaults to 'pallettai-site'. Setting
 * opts.branch switches to POST /sites/{id}/builds (multipart zip +
 * branch) — Netlify's documented branch-deploy route for zip sites.
 */
async function deployToNetlify(personalAccessToken, siteId, zipBuffer, opts) {
  const w = want(opts);
  opts = opts || {};
  if (!w.fetch) throw new DeployError('fetch is unavailable in this runtime', { provider: 'netlify', code: 'no_fetch' });
  if (!personalAccessToken) throw new DeployError('Netlify personal access token is required', { provider: 'netlify', code: 'missing_credential' });
  const zip = toBuffer(zipBuffer);
  if (!zip.length) throw new DeployError('zipBuffer is empty — nothing to publish', { provider: 'netlify', code: 'bad_input' });
  const stages = [];
  const provider = 'netlify';
  const http = makeHttp(w.fetch, w.timeoutMs);
  const auth = { Authorization: 'Bearer ' + personalAccessToken };

  let id = siteId;
  if (!id) {
    const name = slug(opts.siteName || 'pallettai-site') || 'pallettai-site';
    const created = await http(NL.sites(), {
      method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, auth),
      body: JSON.stringify({ name: name })
    }, { provider, token: personalAccessToken, label: 'Netlify site create' });
    id = created.id || created.site_id;
    if (!id) throw new DeployError('Netlify site create returned no site id', { provider, code: 'bad_response' });
    progress(w.onProgress, provider, stages, 30, 'site', 'Site "' + (created.name || id) + '" created');
  }

  progress(w.onProgress, provider, stages, 45, 'upload', 'Uploading ' + zip.length + '-byte archive');
  const branch = opts.branch ? String(opts.branch) : '';
  let deploy;
  if (branch) {
    const mp = netlifyZipMultipart(zip, branch);
    deploy = await http(NL.builds(id), {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'multipart/form-data; boundary=' + mp.boundary }, auth),
      body: mp.body
    }, { provider, token: personalAccessToken, label: 'Netlify branch deploy' });
  } else {
    deploy = await http(NL.deploy(id), {
      method: 'PUT',
      headers: Object.assign({ 'Content-Type': 'application/zip' }, auth),
      body: zip
    }, { provider, token: personalAccessToken, label: 'Netlify zip deploy' });
  }

  const url = deploy.ssl_url || deploy.url || ('https://' + (deploy.name || id) + '.netlify.app');
  progress(w.onProgress, provider, stages, 100, 'done', 'Deploy queued: ' + url);
  return {
    ok: true, provider, url, deployId: deploy.id || '', siteId: id,
    requiredFiles: Array.isArray(deploy.required_files) ? deploy.required_files : [],
    stages
  };
}

// ------------------------------------------------ 3) GitHub Pages adapter

function assertRepo(repo) {
  const s = String(repo || '');
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(s)) {
    throw new DeployError('repo must be "owner/name" (got "' + s.slice(0, 80) + '")', { provider: 'github', code: 'bad_input' });
  }
  return s;
}

function ghHeaders(token) {
  return {
    Authorization: 'Bearer ' + token,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': USER_AGENT,
    'Content-Type': 'application/json'
  };
}

// Binary payloads go through base64 blobs; text rides inline on the tree.
const BINARY_EXT = /\.(png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|eot|pdf|zip|gz|mp4|webm|wasm)$/i;
function needsBlob(file) {
  return BINARY_EXT.test(file.name) || file.bytes.indexOf(0) >= 0;
}

/**
 * deployToGitHubPages(githubToken, repo, branch, siteFiles, opts?)
 * Commits compiled assets to `branch` (default gh-pages) via the
 * git-data REST endpoints. siteFiles: [{path|name, content}] with
 * string or byte content. Throws DeployError.
 */
async function deployToGitHubPages(githubToken, repo, branch, siteFiles, opts) {
  const w = want(opts);
  if (!w.fetch) throw new DeployError('fetch is unavailable in this runtime', { provider: 'github', code: 'no_fetch' });
  if (!githubToken) throw new DeployError('GitHub token is required', { provider: 'github', code: 'missing_credential' });
  const fullRepo = assertRepo(repo);
  const ref = String(branch || 'gh-pages');
  if (!/^[A-Za-z0-9._/-]+$/.test(ref)) throw new DeployError('invalid branch name', { provider: 'github', code: 'bad_input' });
  const files = normalizeFiles(siteFiles);
  const stages = [];
  const provider = 'github';
  const http = makeHttp(w.fetch, w.timeoutMs);
  const json = function (u, init, label, raw) {
    return http(u, Object.assign({ headers: ghHeaders(githubToken) }, init || {}),
      { provider, token: githubToken, label: label || u, raw: !!raw });
  };
  const api = GITHUB_API + '/repos/' + fullRepo;

  // 0. Repo must exist (404 here = wrong owner/name or no access).
  await json(api, { method: 'GET' }, 'GitHub get repo');
  progress(w.onProgress, provider, stages, 15, 'resolve', 'Repository ' + fullRepo + ' verified');

  // 1. Deploy branch may not exist yet → orphan branch fallback.
  //    GitHub is inconsistent here: GET takes singular /git/ref/, the
  //    PATCH update below takes plural /git/refs/.
  const getRefUrl = api + '/git/ref/heads/' + encodeURIComponent(ref);
  const refResp = await json(getRefUrl, { method: 'GET' }, 'GitHub get ref', true);
  let parentCommit = null;
  if (refResp.ok) {
    const refJson = await refResp.json();
    parentCommit = refJson && refJson.object ? refJson.object.sha : null;
  } else if (refResp.status !== 404) {
    const txt = scrub(await refResp.text(), githubToken);
    throw httpError(provider, refResp, githubToken, txt);
  }

  // 2. Build the tree: text inline, binaries as pre-created blobs.
  const tree = [];
  for (const f of files) {
    if (needsBlob(f)) {
      const blob = await json(api + '/git/blobs', {
        method: 'POST',
        body: JSON.stringify({ content: f.bytes.toString('base64'), encoding: 'base64' })
      }, 'GitHub create blob');
      if (!blob.sha) throw new DeployError('GitHub returned no blob sha for ' + f.name, { provider, code: 'bad_response' });
      tree.push({ path: f.name, mode: '100644', type: 'blob', sha: blob.sha });
    } else {
      tree.push({ path: f.name, mode: '100644', type: 'blob', content: f.bytes.toString('utf8') });
    }
  }
  progress(w.onProgress, provider, stages, 45, 'tree', 'Tree staged: ' + tree.length + ' path(s)');

  // 3. Base tree keeps unrelated branch assets (CNAME, .nojekyll) intact.
  let baseTree;
  if (parentCommit) {
    const commit = await json(api + '/git/commits/' + parentCommit, { method: 'GET' }, 'GitHub get commit');
    baseTree = commit.tree && commit.tree.sha;
  }
  const newTree = await json(api + '/git/trees', {
    method: 'POST',
    body: JSON.stringify(Object.assign({ tree: tree }, baseTree ? { base_tree: baseTree } : {}))
  }, 'GitHub create tree');
  if (!newTree.sha) throw new DeployError('GitHub returned no tree sha', { provider, code: 'bad_response' });

  // 4. Commit on top of the branch head (or rootless for a new branch).
  const newCommit = await json(api + '/git/commits', {
    method: 'POST',
    body: JSON.stringify({
      message: 'Publish site from PallettAI Studio (' + files.length + ' files)',
      tree: newTree.sha,
      parents: parentCommit ? [parentCommit] : []
    })
  }, 'GitHub create commit');
  if (!newCommit.sha) throw new DeployError('GitHub returned no commit sha', { provider, code: 'bad_response' });
  progress(w.onProgress, provider, stages, 70, 'commit', 'Commit ' + String(newCommit.sha).slice(0, 7) + ' created');

  // 5. Move (or create) the branch ref; concurrent deploys → force retry.
  const refUrl = api + '/git/refs/heads/' + encodeURIComponent(ref);
  if (parentCommit) {
    try {
      await json(refUrl, {
        method: 'PATCH',
        body: JSON.stringify({ sha: newCommit.sha, force: false })
      }, 'GitHub update ref');
    } catch (e) {
      if (!(e instanceof DeployError && (e.status === 422 || e.status === 409))) throw e;
      await json(refUrl, {
        method: 'PATCH',
        body: JSON.stringify({ sha: newCommit.sha, force: true })
      }, 'GitHub update ref (forced)');
    }
  } else {
    await json(api + '/git/refs', {
      method: 'POST',
      body: JSON.stringify({ ref: 'refs/heads/' + ref, sha: newCommit.sha })
    }, 'GitHub create ref');
  }

  const [owner, name] = fullRepo.split('/');
  const pagesUrl = ref === 'main' || ref === 'master'
    ? 'https://' + owner.toLowerCase() + '.github.io/'
    : 'https://' + owner.toLowerCase() + '.github.io/' + name + '/';
  progress(w.onProgress, provider, stages, 100, 'done', 'Branch "' + ref + '" updated');
  return {
    ok: true, provider, url: pagesUrl, branch: ref, commit: newCommit.sha,
    tree: newTree.sha, files: files.length, stages
  };
}

// -------------------------------------------- 4) unified publishSite()

const PROVIDERS = {
  cloudflare: 'cloudflare', 'cloudflare-pages': 'cloudflare', cf: 'cloudflare', pages: 'cloudflare',
  netlify: 'netlify',
  github: 'github', 'github-pages': 'github', gh: 'github', 'gh-pages': 'github'
};

function pick(cred, keys) {
  for (const k of keys) if (cred && cred[k]) return cred[k];
  return '';
}

function resolveZip(siteData) {
  if (siteData == null) return null;
  if (isBinaryZipped(siteData)) return toBuffer(siteData);
  if (isBinaryZipped(siteData.zipBuffer)) return toBuffer(siteData.zipBuffer);
  if (isBinaryZipped(siteData.zip)) return toBuffer(siteData.zip);
  if (isBinaryZipped(siteData.buffer)) return toBuffer(siteData.buffer);
  return null;
}

function hasBinaryContent(files) {
  return files.some(function (f) {
    const c = f && f.content;
    return c != null && typeof c !== 'string';
  });
}

/** Text-only packaging through modules/zip.js (its writer is UTF-8). */
function packageFiles(files) {
  if (hasBinaryContent(files)) {
    throw new DeployError('binary files must travel inside siteData.zipBuffer (zip.js packages text only)',
      { code: 'bad_input' });
  }
  const zipped = require('./zip.js').zipFiles(files.map(function (f) {
    return { name: String(f.path || f.name), content: f.content };
  }));
  return Buffer.from(zipped);
}

/**
 * publishSite(provider, credentials, siteData, onProgress?, opts?)
 *
 * provider    — 'cloudflare' | 'netlify' | 'github' (aliases accepted)
 * credentials — {token|apiToken|personalAccessToken|githubToken,
 *                accountId, projectName, siteId, repo, branch, siteName}
 * siteData    — {zipBuffer} and/or {files:[{path, content}]},
 *               or a bare Buffer/Uint8Array zip
 * onProgress  — ({provider, stage, pct, message}) => void, or an
 *               options object {onProgress, fetch, timeoutMs}
 * opts        — optional {fetch, timeoutMs} when onProgress is a fn
 *
 * Never throws: resolves {ok:true, provider, url, durationMs, stages}
 * or {ok:false, provider, code, message, status, stages}.
 */
async function publishSite(provider, credentials, siteData, onProgress, opts) {
  const raw = String(provider || '').toLowerCase().trim();
  const key = PROVIDERS[raw] || PROVIDERS[raw.replace(/\s+/g, '-')];
  const stages = [];
  const t0 = Date.now();
  let cb = null;
  let o = opts || {};
  if (typeof onProgress === 'function') cb = onProgress;
  else if (onProgress && typeof onProgress === 'object') { o = onProgress; cb = typeof o.onProgress === 'function' ? o.onProgress : null; }
  const fetchImpl = o.fetch || (typeof fetch === 'function' ? fetch : null);
  const timeoutMs = Number.isFinite(o.timeoutMs) ? o.timeoutMs : DEFAULT_TIMEOUT_MS;
  const finish = function (r) { r.stages = stages; r.durationMs = Date.now() - t0; return r; };

  if (!key) {
    return finish({
      ok: false, provider: String(provider || ''), code: 'unknown_provider',
      message: 'Unknown provider "' + String(provider || '') + '". Use cloudflare, netlify, or github.'
    });
  }
  progress(cb, key, stages, 5, 'validate', 'Validating credentials');

  const cred = credentials || {};
  try {
    if (key === 'cloudflare') {
      const token = pick(cred, ['apiToken', 'token', 'accessToken', 'apiKey']);
      const accountId = pick(cred, ['accountId', 'account_id']);
      const project = pick(cred, ['projectName', 'project', 'name']);
      if (!fetchImpl) throw new DeployError('fetch is unavailable in this runtime', { provider: key, code: 'no_fetch' });
      if (!token || !accountId || !project) {
        throw new DeployError('Cloudflare requires apiToken, accountId, and projectName', { provider: key, code: 'missing_credential' });
      }
      const http = makeHttp(fetchImpl, timeoutMs);
      let files;
      const zip = resolveZip(siteData);
      if (zip) {
        progress(cb, key, stages, 12, 'unpack', 'Unpacking archive');
        files = readZip(zip);
      } else if (siteData && Array.isArray(siteData.files)) {
        files = normalizeFiles(siteData.files);
      } else {
        throw new DeployError('siteData must include zipBuffer or files', { provider: key, code: 'bad_input' });
      }
      if (!files.length) throw new DeployError('nothing to publish — site payload is empty', { provider: key, code: 'bad_input' });
      const r = await cfUploadFiles(http, token, accountId, slug(project), files, cb, stages, cred.branch || '');
      return finish({ ok: true, provider: key, url: r.url, deploymentId: r.deploymentId });
    }

    if (key === 'netlify') {
      const token = pick(cred, ['personalAccessToken', 'token', 'accessToken', 'apiToken', 'apiKey']);
      const siteId = pick(cred, ['siteId', 'site_id', 'id']);
      if (!token) throw new DeployError('Netlify requires a personal access token', { provider: key, code: 'missing_credential' });
      let zip = resolveZip(siteData);
      if (!zip && siteData && Array.isArray(siteData.files)) {
        progress(cb, key, stages, 12, 'package', 'Packaging ' + siteData.files.length + ' file(s)');
        zip = packageFiles(siteData.files);
      }
      if (!zip) throw new DeployError('siteData must include zipBuffer or files', { provider: key, code: 'bad_input' });
      const r = await deployToNetlify(token, siteId || null, zip, {
        fetch: fetchImpl, onProgress: cb, timeoutMs,
        siteName: cred.siteName || (siteData && siteData.name) || '',
        branch: cred.branch || ''
      });
      return finish({ ok: true, provider: key, url: r.url, deployId: r.deployId, siteId: r.siteId });
    }

    // github
    const token = pick(cred, ['githubToken', 'token', 'accessToken', 'pat']);
    const repo = pick(cred, ['repo', 'repository', 'slug']);
    const branch = cred.branch || 'gh-pages';
    if (!token) throw new DeployError('GitHub requires a token', { provider: key, code: 'missing_credential' });
    let files = siteData && Array.isArray(siteData.files) ? siteData.files : null;
    if (!files) {
      const zip = resolveZip(siteData);
      if (!zip) throw new DeployError('siteData must include files or zipBuffer', { provider: key, code: 'bad_input' });
      progress(cb, key, stages, 12, 'unpack', 'Unpacking archive');
      files = readZip(zip).map(function (f) { return { path: f.name, content: f.bytes }; });
    }
    const r = await deployToGitHubPages(token, repo, branch, files, { fetch: fetchImpl, onProgress: cb, timeoutMs });
    return finish({ ok: true, provider: key, url: r.url, branch: r.branch, commit: r.commit, files: r.files });
  } catch (e) {
    const leaked = pick(credentials || {}, ['token', 'apiToken', 'personalAccessToken', 'githubToken', 'accessToken']);
    const err = e instanceof DeployError
      ? e
      : new DeployError(scrub(e && e.message ? e.message : String(e), leaked), { provider: key, code: 'deploy_failed' });
    progress(cb, key, stages, 100, 'error', err.message);
    return finish({ ok: false, provider: key, code: err.code, message: scrub(err.message, leaked), status: err.status });
  }
}

module.exports = {
  DeployError,
  deployToCloudflarePages,
  deployToNetlify,
  deployToGitHubPages,
  publishSite,
  // exported for the smoke runner / advanced callers
  readZip,
  normalizeFiles,
  cfAssetBatches,
  cfManifest,
  cfDeployMultipart,
  contentTypeFor,
  slug,
  sha256,
  PROVIDERS
};
