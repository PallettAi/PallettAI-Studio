// ============================================================
// PallettAI Studio — GitHub repo publish handoff (pure logic)
// Request/payload shaping behind Export ▸ "Hand off to GitHub".
//
// WHY: agencies asked for the white-label ZIP to land in a repo
// they own, not a folder they re-upload by hand. This is the
// third leg of publish (Netlify/Vercel/Cloudflare/Neocities →
// GitHub) using the documented REST API:
//
//   POST /user/repos            → create the repo (or 422 if it exists)
//   GET  /repos/:o/:r/git/ref   → resolve the branch head (empty repo → 409/404)
//   POST /repos/:o/:r/git/trees → write the whole export as one tree
//   POST /repos/:o/:r/git/commits → commit the tree onto the parent
//   POST /repos/:o/:r/git/refs  → create the branch on an empty repo
//   PATCH /repos/:o/:r/git/refs/heads/:branch → fast-forward an existing branch
//   PATCH /user/repos/:o/:r     → homepage/description/social metadata
//
// Tokens are FINE-GRAINED PATs: "Contents: read+write" on the
// target repo only, "Administration: write" only when the token
// also creates the repo. The token lives in safeStorage next to
// the other publish secrets — never in localStorage, never sent
// anywhere but api.github.com.
//
// No network calls live here (ONLINE.request drives it from
// app.js), no DOM, no storage — request shaping is the part
// that fails silently and the part a test can pin.
// ============================================================

'use strict';

const GithubPublish = (() => {
  const API = 'https://api.github.com';

  // A fine-grained PAT is `github_pat_…` (classic tokens are `ghp_…`). Both
  // are accepted; the UI text steers toward fine-grained because its
  // permissions are scoped per-repo.
  function validTokenShape(t) {
    const s = String(t || '').trim();
    return /^(github_pat_[A-Za-z0-9_]{20,}|ghp_[A-Za-z0-9]{20,})$/.test(s);
  }

  // Repo name rules (GitHub): ASCII letters, digits, '.', '-', '_'.
  function validRepoName(name) {
    return /^[A-Za-z0-9._-]{1,100}$/.test(String(name || ''));
  }

  // Slugify a project name into a legal default repo name.
  function repoNameFor(projectName) {
    const s = String(projectName || '').trim().toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 100);
    return s || 'pallettai-site';
  }

  function validOwner(o) { return /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(String(o || '')); }

  // ---- payloads -------------------------------------------------------------
  function createRepoBody({ name, description, homepage, private: priv }) {
    const body = {
      name: String(name || '').slice(0, 100),
      private: priv !== false,
      auto_init: false,
      has_issues: false,
      has_wiki: false,
      has_projects: false,
      has_discussions: false,
      allow_squash_merge: true,
      has_downloads: false
    };
    if (description) body.description = String(description).slice(0, 350);
    if (homepage) body.homepage = String(homepage).slice(0, 350);
    return body;
  }

  // The commit tree. Every file of the export becomes a blob entry; the
  // commit message names the tool so the agency's history stays readable.
  function treeFromFiles(files, opts) {
    const o = opts || {};
    const list = (Array.isArray(files) ? files : [])
      .filter((f) => f && typeof f.path === 'string' && f.path.length > 0)
      .map((f) => ({
        path: f.path.replace(/^\/+/, ''),
        mode: '100644',
        type: 'blob',
        content: typeof f.content === 'string' ? f.content : String(f.content == null ? '' : f.content)
      }));
    const tree = { tree: list };
    if (o.parentTreeSha) tree.base_tree = o.parentTreeSha; // carry over unchanged blobs
    return tree;
  }

  function commitBody({ message, tree, parentSha }) {
    return {
      message: String(message || 'Site update').slice(0, 600),
      tree: String(tree || ''),
      parents: parentSha ? [String(parentSha)] : []
    };
  }

  function updateRepoBody({ description, homepage }) {
    const body = {};
    if (description != null) body.description = String(description).slice(0, 350);
    if (homepage != null) body.homepage = String(homepage).slice(0, 350);
    return body;
  }

  // ---- endpoints ------------------------------------------------------------
  function endpoint(path) { return API + String(path || ''); }

  function headers(token, extras) {
    const h = Object.assign({
      'Accept': 'application/vnd.github+json',
      'Authorization': 'Bearer ' + String(token || ''),
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json'
    }, extras || {});
    return h;
  }

  // ---- response interpretation ---------------------------------------------
  // classifyError turns a fetch failure into the message the UI shows. The
  // 422-already-exists case is the common one: the handoff then switches to
  // "push to the existing repo" instead of failing.
  function classifyError(status, body) {
    const b = body || {};
    if (status === 401) return { kind: 'auth', message: 'GitHub rejected the token. Generate a new one at github.com/settings/personal-access-tokens.' };
    if (status === 403) return { kind: 'forbidden', message: 'The token lacks permission for this repository. Fine-grained tokens need Contents: read and write.' };
    if (status === 404) return { kind: 'not-found', message: 'Repository not found for this token. Check the owner and repo names.' };
    if (status === 422) {
      const already = (b.errors || []).some((e) => e && String(e.message || '').toLowerCase().includes('already exists'));
      if (already || /already exists/i.test(String(b.message || ''))) {
        return { kind: 'exists', message: 'That repository already exists — pushing to it instead.' };
      }
      return { kind: 'invalid', message: String(b.message || 'GitHub rejected the request.') };
    }
    if (status === 409) return { kind: 'empty-repo', message: 'The repository exists but is empty — creating the first commit.' };
    return { kind: 'http', message: String(b.message || ('GitHub error ' + status)) };
  }

  return {
    API, validTokenShape, validRepoName, validOwner, repoNameFor,
    createRepoBody, treeFromFiles, commitBody, updateRepoBody,
    endpoint, headers, classifyError
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = GithubPublish;
