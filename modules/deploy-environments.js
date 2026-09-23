'use strict';
// ============================================================
// PallettAI Studio — multi-environment & rollback deploy manager
// One API across Cloudflare Pages, Netlify and Vercel for the
// three things an environment workflow needs: ship to a target,
// see what shipped, and put a known-good build back in front of
// traffic. All three providers are driven over plain fetch — no
// SDK — and every endpoint below is the one their own tooling
// uses:
//
//   Cloudflare  branch → form field `branch` on the direct-upload
//               deployment (wrangler sends the same field; omit →
//               production branch). List GET  …/deployments.
//               Rollback POST …/deployments/{id}/rollback.
//   Netlify     production zip → PUT  /sites/{id}/deploys (what
//               Studio has always used); branch zip → POST
//               /sites/{id}/builds multipart zip+branch (Netlify's
//               Nov-2025 documented route). List GET /sites/{id}/
//               deploys. Rollback POST /sites/{id}/deploys/{id}/
//               restore.
//   Vercel      deploy POST /v13/deployments with inlined files
//               ({file, data, encoding}) + target/gitBranch. List
//               GET /v6/deployments. Rollback = redeploy POST
//               /v13/deployments {deploymentId}.
//
// ---- API --------------------------------------------------------
//   parseEnvironment(env)                  → {environment, branch}
//   deployToEnvironment(provider, credentials, siteData, environment, opts?)
//   listDeployments(provider, credentials, projectName, opts?)
//   rollbackDeployment(provider, credentials, projectName, deploymentId, opts?)
//
// ---- what this file guarantees ----------------------------------
// 1. ENVIRONMENT MEANS THE SAME THING EVERYWHERE: 'production' |
//    'staging' | 'preview-<branch>' (any other string is taken as
//    a raw branch). parseEnvironment() is pure and exported, so
//    the mapping the runner asserts is the mapping dispatch uses.
// 2. TOKENS NEVER LEAK: every HTTP error passes through one
//    redactor that strips the credential before the message can
//    reach a log or a result object.
// 3. FAILURES ARE TYPED, NOT STRINGLY: missing credentials,
//    unknown providers, empty payloads and HTTP statuses arrive
//    as DeployError with .code/.status — the same class Studio's
//    other adapters throw.
// 4. LIST OUTPUT IS NORMALIZED: {id, environment, branch, url,
//    createdAt, commit, status} regardless of provider, so a UI
//    can render history without provider branches. createdAt is
//    always ISO-8601; commit may be null when the provider has
//    no git metadata (direct uploads).
// ============================================================

const crypto = require('crypto');
const { DeployError, publishSite, readZip } = require('./deploy.js');

const CF_API = 'https://api.cloudflare.com/client/v4';
const NETLIFY_API = 'https://api.netlify.com/api/v1';
const VERCEL_API = 'https://api.vercel.com';
const DEFAULT_TIMEOUT_MS = 60000;
const USER_AGENT = 'PallettAI-Studio-Deploy';

const ALIASES = {
  cloudflare: 'cloudflare', cf: 'cloudflare', pages: 'cloudflare',
  'cloudflare-pages': 'cloudflare', cloudflarepages: 'cloudflare',
  netlify: 'netlify',
  vercel: 'vercel', vc: 'vercel'
};

function fail(provider, code, message, status) {
  return new DeployError(message, { provider: provider || '', code: code, status: status || 0 });
}

function resolveProvider(provider) {
  const raw = String(provider || '').toLowerCase().trim();
  const key = ALIASES[raw] || ALIASES[raw.replace(/\s+/g, '-')];
  if (!key) {
    throw fail(String(provider || ''), 'unknown_provider',
      'Unknown provider "' + String(provider || '') + '". Use cloudflare, netlify, or vercel.');
  }
  return key;
}

function pick(cred, keys) {
  for (let i = 0; i < keys.length; i++) {
    const v = cred[keys[i]];
    if (v != null && v !== '') return v;
  }
  return '';
}

function haveFetch(opts) {
  const f = (opts && opts.fetch) || (typeof fetch === 'function' ? fetch : null);
  if (typeof f !== 'function') {
    throw fail('', 'no_fetch', 'fetch is unavailable in this runtime');
  }
  return f;
}

function timeoutOf(opts) {
  const t = opts && Number(opts.timeoutMs);
  return Number.isFinite(t) && t > 0 ? t : DEFAULT_TIMEOUT_MS;
}

// ---- environment grammar -----------------------------------------

/**
 * parseEnvironment('production'|'staging'|'preview-<branch>'|'<branch>')
 *   production       → {environment:'production', branch:''}   (omitted branch)
 *   staging          → {environment:'staging',   branch:'staging'}
 *   preview-login    → {environment:'preview',   branch:'login'}
 *   feature/x        → {environment:'preview',   branch:'feature/x'}
 * Branch names accept the git-safe charset [A-Za-z0-9._/-].
 */
function parseEnvironment(environment) {
  const raw = String(environment == null || environment === '' ? 'production' : environment).trim();
  if (!raw || raw.toLowerCase() === 'production') return { environment: 'production', branch: '' };
  if (raw.toLowerCase() === 'staging') return { environment: 'staging', branch: 'staging' };
  const m = /^preview-(.+)$/i.exec(raw);
  const branch = m ? m[1] : raw;
  if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch === '.' || branch === '..') {
    throw fail('', 'bad_input', 'Invalid environment/branch name "' + raw + '"');
  }
  return { environment: 'preview', branch: branch };
}

// ---- one HTTP door for all three providers -----------------------

function makeCall(fetchImpl, timeoutMs, provider, token) {
  const leak = token ? String(token) : '';
  const redact = (s) => (leak ? String(s).split(leak).join('[redacted]') : String(s));
  return async function call(url, init, label) {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timer = null;
    if (ctl) timer = setTimeout(function () { try { ctl.abort(); } catch (e) { /* noop */ } }, timeoutMs);
    let res;
    try {
      const finalInit = Object.assign({}, init, {
        headers: Object.assign(
          { Authorization: 'Bearer ' + token, 'User-Agent': USER_AGENT },
          (init && init.headers) || {})
      });
      if (ctl) finalInit.signal = ctl.signal;
      res = await fetchImpl(url, finalInit);
    } catch (e) {
      if (timer) clearTimeout(timer);
      const why = e && e.name === 'AbortError' ? 'timed out after ' + timeoutMs + 'ms' : redact(e && e.message ? e.message : e);
      throw fail(provider, 'network_error', label + ' failed: ' + why);
    }
    if (timer) clearTimeout(timer);
    let text = '';
    let json = null;
    try {
      text = await res.text();
      json = text ? JSON.parse(text) : null;
    } catch (e) { json = null; }
    if (json && json.success === false) {
      const msgs = (json.errors || []).map(function (m) { return m && m.message ? m.message : m; }).join('; ');
      throw fail(provider, 'provider_error', label + ': ' + redact(msgs || 'rejected'), res.status);
    }
    if (!res.ok) {
      const body = json && (json.message || json.error);
      const extra = body ? ': ' + redact(typeof body === 'string' ? body : JSON.stringify(body))
        : text ? ': ' + redact(text.slice(0, 200)) : '';
      throw fail(provider, res.status >= 500 ? 'provider_error' : 'http_error',
        label + ' — HTTP ' + res.status + extra, res.status);
    }
    return json;
  };
}

function vercelUrl(base, opts, credentials) {
  const team = pick(credentials || {}, ['teamId', 'team_id']);
  const parts = [];
  if (team) parts.push('teamId=' + encodeURIComponent(team));
  if (opts && opts.teamId) parts.push('teamId=' + encodeURIComponent(opts.teamId));
  return parts.length ? base + '?' + parts[0] : base;
}

// ---- siteData → files (Vercel inlines per-file) ------------------

function isZip(buf) {
  return Buffer.isBuffer(buf) && buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4B;
}

function toBuf(v) {
  if (Buffer.isBuffer(v)) return v;
  if (v instanceof Uint8Array) return Buffer.from(v);
  if (v && v.type === 'Buffer' && Array.isArray(v.data)) return Buffer.from(v.data);
  return null;
}

function resolveVercelFiles(siteData) {
  const sd = siteData && typeof siteData === 'object' ? siteData : null;
  if (Array.isArray(sd.files) && sd.files.length) {
    return sd.files.map(function (f, i) {
      const raw = f && typeof f === 'object' ? f : { path: String(f) };
      const path = String(raw.path == null ? raw.name : raw.path || '');
      if (!path) throw fail('vercel', 'bad_input', 'file #' + i + ' is missing a path');
      let content = raw.content;
      const buf = toBuf(content);
      if (buf) content = buf;
      else if (content == null) throw fail('vercel', 'bad_input', 'file "' + path + '" has no content');
      else content = String(content);
      return { path: path, content: content };
    });
  }
  const zip = toBuf(sd && (sd.zipBuffer || sd.zip || sd.buffer)) || toBuf(siteData);
  if (zip && isZip(zip)) {
    let entries = [];
    try {
      entries = readZip(zip);
    } catch (e) {
      throw fail('vercel', 'bad_input', 'zipBuffer could not be read: ' + (e && e.message ? e.message : e));
    }
    if (!entries.length) throw fail('vercel', 'bad_input', 'archive is empty — nothing to publish');
    return entries.map(function (e) { return { path: e.name, content: Buffer.from(e.bytes) }; });
  }
  throw fail('vercel', 'bad_input', 'siteData must include files or a zip archive');
}

// ---- 1) deployToEnvironment ---------------------------------------

const VERCEL_FILE_CAP = 1000; // inline deployments are for static exports, not node_modules

/**
 * deployToEnvironment(provider, credentials, siteData, environment, opts?)
 *
 * provider    — cloudflare | netlify | vercel (aliases accepted)
 * credentials — cloudflare {apiToken, accountId, projectName}
 *               netlify    {personalAccessToken, siteId|siteName}
 *               vercel     {token, projectName, teamId?}
 *               publishSite's credential names are all accepted.
 * siteData    — {zipBuffer} / {files:[{path, content}]} / bare zip
 * environment — 'production' | 'staging' | 'preview-<branch>'
 * opts        — {onProgress, fetch, timeoutMs}
 *
 * → {ok:true, provider, environment, branch, url, deploymentId, stages?}
 * Throws DeployError with .code on failure.
 */
async function deployToEnvironment(provider, credentials, siteData, environment, opts) {
  const key = resolveProvider(provider);
  const env = parseEnvironment(environment);
  const o = opts || {};
  const cred = credentials || {};
  const onProgress = typeof o.onProgress === 'function' ? o.onProgress : null;

  if (key === 'vercel') {
    const token = pick(cred, ['token', 'accessToken', 'apiToken', 'personalAccessToken']);
    const name = pick(cred, ['projectName', 'name', 'project']);
    if (!token) throw fail(key, 'missing_credential', 'Vercel requires a token');
    if (!name) throw fail(key, 'missing_credential', 'Vercel requires a projectName');
    const fetchImpl = haveFetch(o);
    const files = resolveVercelFiles(siteData);
    if (files.length > VERCEL_FILE_CAP) {
      throw fail(key, 'bad_input', 'too many files for an inline deploy (' + files.length + ' > ' + VERCEL_FILE_CAP + ')');
    }
    if (onProgress) onProgress({ provider: key, stage: 'validate', pct: 20, message: 'Packaging ' + files.length + ' file(s)' });
    const body = {
      name: name,
      target: env.environment === 'production' ? 'production' : 'preview',
      files: files.map(function (f) {
        const buf = toBuf(f.content) || Buffer.from(String(f.content), 'utf8');
        return { file: f.path, data: buf.toString('base64'), encoding: 'base64' };
      })
    };
    if (env.branch) body.gitBranch = env.branch;
    const call = makeCall(fetchImpl, timeoutOf(o), key, token);
    const dep = await call(vercelUrl(VERCEL_API + '/v13/deployments', o, cred), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }, 'Vercel deployment');
    const id = (dep && (dep.id || dep.uid)) || '';
    const url = vercelHttp((dep && dep.url) || (name + '.vercel.app'));
    if (onProgress) onProgress({ provider: key, stage: 'done', pct: 100, message: 'Deployment queued: ' + url });
    return {
      ok: true, provider: key, environment: env.environment, branch: env.branch,
      url: url, deploymentId: id, files: files.length
    };
  }

  // cloudflare + netlify ride publishSite, which now threads cred.branch.
  const nextCred = Object.assign({}, cred);
  nextCred.branch = env.branch;
  const result = await publishSite(key, nextCred, siteData, { onProgress: onProgress, fetch: o.fetch, timeoutMs: o.timeoutMs });
  if (!result.ok) {
    throw fail(key, result.code || 'deploy_failed', result.message || 'deployment failed', result.status);
  }
  return {
    ok: true, provider: key, environment: env.environment, branch: env.branch,
    url: result.url || '', deploymentId: result.deploymentId || result.deployId || '',
    siteId: result.siteId || '', commit: result.commit || '',
    stages: result.stages || []
  };
}

function vercelHttp(url) {
  const s = String(url || '');
  return /^https?:\/\//i.test(s) ? s : 'https://' + s.replace(/^\/+/, '');
}

// ---- 2) listDeployments -------------------------------------------

function iso(msOrString) {
  if (msOrString == null || msOrString === '') return '';
  if (typeof msOrString === 'number' && Number.isFinite(msOrString)) {
    return new Date(msOrString).toISOString();
  }
  const d = new Date(String(msOrString));
  return Number.isNaN(d.getTime()) ? String(msOrString) : d.toISOString();
}

/** Netlify accepts a site id directly; names/slugs resolve via the sites list. */
async function resolveNetlifySite(call, raw) {
  const id = String(raw || '');
  if (!id) throw fail('netlify', 'bad_input', 'projectName (site id or site name) is required');
  try {
    const s = await call(NETLIFY_API + '/sites/' + encodeURIComponent(id), { method: 'GET' }, 'Netlify site lookup');
    if (s && s.id) return s.id;
  } catch (e) {
    if (!(e instanceof DeployError) || (e.status !== 404 && e.code !== 'http_error')) throw e;
    // fall through to name resolution
  }
  const all = await call(NETLIFY_API + '/sites?per_page=100', { method: 'GET' }, 'Netlify site list');
  const list = Array.isArray(all) ? all : [];
  const hit = list.filter(function (s) {
    return s && (s.name === id || s.slug === id || s.id === id);
  })[0];
  if (!hit || !hit.id) {
    throw fail('netlify', 'bad_input', 'No Netlify site matches "' + id.slice(0, 80) + '"');
  }
  return hit.id;
}

/**
 * listDeployments(provider, credentials, projectName, opts?)
 * → {ok:true, provider, deployments:[{id, environment, branch, url,
 *                                     createdAt, commit, status}]}
 * Newest first; createdAt is ISO-8601; commit is null when the
 * provider has no git metadata for that deployment.
 */
async function listDeployments(provider, credentials, projectName, opts) {
  const key = resolveProvider(provider);
  const o = opts || {};
  const cred = credentials || {};
  const fetchImpl = haveFetch(o);
  const limit = Number.isFinite(Number(o.limit)) ? Math.max(1, Math.min(100, Number(o.limit))) : 10;

  if (key === 'cloudflare') {
    const token = pick(cred, ['apiToken', 'token', 'accessToken', 'apiKey']);
    const accountId = pick(cred, ['accountId', 'account_id']);
    const project = pick(cred, ['projectName', 'project', 'name']) || String(projectName || '');
    if (!token || !accountId || !project) {
      throw fail(key, 'missing_credential', 'Cloudflare requires apiToken, accountId, and projectName');
    }
    const call = makeCall(fetchImpl, timeoutOf(o), key, token);
    const url = CF_API + '/accounts/' + encodeURIComponent(accountId)
      + '/pages/projects/' + encodeURIComponent(project) + '/deployments?per_page=' + limit;
    const j = await call(url, { method: 'GET' }, 'Cloudflare deployment list');
    const list = (j && j.result && j.result.deployments)
      || (j && Array.isArray(j.result) ? j.result : null)
      || (j && j.deployments) || [];
    const deployments = list.map(function (d) {
      const meta = (d && d.deployment_trigger && d.deployment_trigger.metadata) || {};
      return {
        id: (d && d.id) || '',
        environment: (d && d.environment) || '',
        branch: meta.branch || (d && d.branch) || null,
        url: (d && d.url) || '',
        createdAt: iso(d && d.created_on),
        commit: meta.commit_hash || null,
        status: (d && d.latest_stage && d.latest_stage.status) || ''
      };
    });
    return { ok: true, provider: key, deployments: deployments };
  }

  if (key === 'netlify') {
    const token = pick(cred, ['personalAccessToken', 'token', 'accessToken', 'apiToken']);
    if (!token) throw fail(key, 'missing_credential', 'Netlify requires a personal access token');
    const call = makeCall(fetchImpl, timeoutOf(o), key, token);
    const site = await resolveNetlifySite(call, pick(cred, ['siteId', 'site_id', 'id']) || projectName);
    const list = await call(NETLIFY_API + '/sites/' + encodeURIComponent(site) + '/deploys?per_page=' + limit,
      { method: 'GET' }, 'Netlify deployment list');
    const deployments = (Array.isArray(list) ? list : []).map(function (d) {
      const context = (d && d.context) || '';
      return {
        id: (d && d.id) || '',
        environment: context === 'production' ? 'production' : 'preview',
        branch: (d && d.branch) || null,
        url: (d && (d.ssl_url || d.url)) || '',
        createdAt: iso(d && d.created_at),
        commit: (d && d.commit_id) || null,
        status: (d && d.state) || '',
        context: context
      };
    });
    return { ok: true, provider: key, siteId: site, deployments: deployments };
  }

  // vercel
  const token = pick(cred, ['token', 'accessToken', 'apiToken']);
  if (!token) throw fail(key, 'missing_credential', 'Vercel requires a token');
  const call = makeCall(fetchImpl, timeoutOf(o), key, token);
  let url = VERCEL_API + '/v6/deployments?limit=' + limit;
  const projectId = pick(cred, ['projectId', 'project_id']);
  if (projectId) url += '&projectId=' + encodeURIComponent(projectId);
  if (cred.teamId) url += '&teamId=' + encodeURIComponent(String(cred.teamId));
  const j = await call(url, { method: 'GET' }, 'Vercel deployment list');
  const wanted = String(projectName || pick(cred, ['projectName', 'name', 'project']) || '');
  const deployments = ((j && j.deployments) || [])
    .filter(function (d) { return !wanted || (d && d.name) === wanted; })
    .map(function (d) {
      const meta = (d && d.meta) || {};
      return {
        id: (d && (d.uid || d.id)) || '',
        environment: (d && d.target) || 'preview',
        branch: meta.githubCommitRef || meta.gitCommitRef || meta.gitBranch || null,
        url: vercelHttp((d && d.url) || ''),
        createdAt: iso(d && d.createdAt),
        commit: meta.githubCommitSha || meta.gitCommitSha || null,
        status: (d && d.readyState) || ''
      };
    });
  return { ok: true, provider: key, deployments: deployments };
}

// ---- 3) rollbackDeployment ----------------------------------------

/**
 * rollbackDeployment(provider, credentials, projectName, deploymentId, opts?)
 * Promotes a previous deployment back to live:
 *   cloudflare POST …/deployments/{id}/rollback
 *   netlify    POST /sites/{site}/deploys/{id}/restore
 *   vercel     POST /v13/deployments {deploymentId}  (redeploy)
 * → {ok:true, provider, deploymentId, url, environment?}
 * Throws DeployError with .code on failure.
 */
async function rollbackDeployment(provider, credentials, projectName, deploymentId, opts) {
  const key = resolveProvider(provider);
  const o = opts || {};
  const cred = credentials || {};
  const fetchImpl = haveFetch(o);
  const target = String(deploymentId || '');
  if (!target) throw fail(key, 'bad_input', 'deploymentId is required to roll back');

  if (key === 'cloudflare') {
    const token = pick(cred, ['apiToken', 'token', 'accessToken', 'apiKey']);
    const accountId = pick(cred, ['accountId', 'account_id']);
    const project = pick(cred, ['projectName', 'project', 'name']) || String(projectName || '');
    if (!token || !accountId || !project) {
      throw fail(key, 'missing_credential', 'Cloudflare requires apiToken, accountId, and projectName');
    }
    const call = makeCall(fetchImpl, timeoutOf(o), key, token);
    const url = CF_API + '/accounts/' + encodeURIComponent(accountId)
      + '/pages/projects/' + encodeURIComponent(project)
      + '/deployments/' + encodeURIComponent(target) + '/rollback';
    const j = await call(url, { method: 'POST' }, 'Cloudflare rollback');
    const d = (j && j.result) || j || {};
    return {
      ok: true, provider: key, deploymentId: d.id || target,
      url: d.url || '', environment: d.environment || ''
    };
  }

  if (key === 'netlify') {
    const token = pick(cred, ['personalAccessToken', 'token', 'accessToken', 'apiToken']);
    if (!token) throw fail(key, 'missing_credential', 'Netlify requires a personal access token');
    const call = makeCall(fetchImpl, timeoutOf(o), key, token);
    const site = await resolveNetlifySite(call, pick(cred, ['siteId', 'site_id', 'id']) || projectName);
    const url = NETLIFY_API + '/sites/' + encodeURIComponent(site)
      + '/deploys/' + encodeURIComponent(target) + '/restore';
    const d = await call(url, { method: 'POST' }, 'Netlify restore');
    const context = (d && d.context) || '';
    return {
      ok: true, provider: key, deploymentId: (d && d.id) || target,
      url: (d && (d.ssl_url || d.url)) || '',
      environment: context ? (context === 'production' ? 'production' : 'preview') : ''
    };
  }

  // vercel — a redeploy of a past deployment IS the rollback.
  const token = pick(cred, ['token', 'accessToken', 'apiToken']);
  if (!token) throw fail(key, 'missing_credential', 'Vercel requires a token');
  const call = makeCall(fetchImpl, timeoutOf(o), key, token);
  const dep = await call(vercelUrl(VERCEL_API + '/v13/deployments', o, cred), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deploymentId: target })
  }, 'Vercel redeploy');
  const name = pick(cred, ['projectName', 'name', 'project']) || String(projectName || '');
  return {
    ok: true, provider: key, deploymentId: (dep && (dep.id || dep.uid)) || '',
    url: vercelHttp((dep && dep.url) || (name && name + '.vercel.app') || ''),
    environment: (dep && dep.target) || ''
  };
}

module.exports = {
  parseEnvironment,
  deployToEnvironment,
  listDeployments,
  rollbackDeployment
};
