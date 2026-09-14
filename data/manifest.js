'use strict';

// ============================================================
// Export manifest — a receipt for the exact bytes that shipped.
// ------------------------------------------------------------
// The build stamp answers "which revision is this page?". It cannot answer
// "is this the file you sent me?" — a question that comes up whenever a host
// re-uploads a folder, a client edits a page by hand, or a zip is passed
// around a team. So every export now carries a manifest with a SHA-256 for
// every file it contains, plus the audit scores it earned.
//
// Two uses, one file:
//   * `build()` writes it into every export;
//   * `verify()` recomputes the hashes and reports what differs. That is the
//     part with teeth — it turns "I think I sent you the right build" into a
//     command anyone can run.
//
// Hashing is async because the browser only offers SubtleCrypto that way. Node
// uses its own crypto module so the smoke test can verify against independent
// output rather than trusting this file.
// ============================================================

const Manifest = (() => {

  const FILE = 'pallettai-export.json';
  const FORMAT = 1;

  // ---- hashing --------------------------------------------------------------
  function nodeCrypto() {
    try {
      if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
        const c = require('crypto');
        if (c && typeof c.createHash === 'function') return c;
      }
    } catch (e) { /* not Node */ }
    return null;
  }

  const NODE_CRYPTO = nodeCrypto();

  function hashingAvailable() {
    if (NODE_CRYPTO) return true;
    return typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function';
  }

  function method() {
    if (NODE_CRYPTO) return 'node:crypto';
    if (typeof crypto !== 'undefined' && crypto.subtle) return 'SubtleCrypto';
    return 'none';
  }

  async function hashText(text) {
    const s = String(text == null ? '' : text);
    if (NODE_CRYPTO) {
      return NODE_CRYPTO.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');
    }
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const bytes = new TextEncoder().encode(s);
      const buf = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    return null;
  }

  const bytes = (s) => {
    const str = String(s == null ? '' : s);
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str).length;
    return Buffer.byteLength(str, 'utf8');
  };

  // ---- build ----------------------------------------------------------------
  function projectFacts(project) {
    const site = (project && project.site) || {};
    return {
      id: String((project && project.id) || ''),
      name: String(site.name || (project && project.name) || ''),
      url: String(site.url || ''),
      palette: String(site.palette || '')
    };
  }

  // `scores` is whatever the caller measured — perf, keyboard, links, images,
  // readability. Absent audits are simply left out rather than reported as
  // zero, because a zero would read as a failing grade.
  async function build(opts) {
    const o = opts || {};
    const files = (Array.isArray(o.files) ? o.files : []).filter((f) => f && f.name);
    const entries = [];
    for (const f of files) {
      const content = f.content == null ? '' : f.content;
      entries.push({
        name: String(f.name),
        bytes: bytes(content),
        sha256: await hashText(content)
      });
    }
    const scores = {};
    Object.keys(o.scores || {}).forEach((k) => {
      const v = o.scores[k];
      if (v && typeof v === 'object' && (typeof v.score === 'number' || typeof v.letter === 'string')) {
        scores[k] = { score: typeof v.score === 'number' ? v.score : null, letter: v.letter || null };
      }
    });

    const manifest = {
      format: FORMAT,
      generator: 'PallettAi Studio',
      version: String(o.version || ''),
      generatedAt: String(o.generatedAt || ''),
      stamp: String(o.stamp || ''),
      project: projectFacts(o.project),
      hashing: method(),
      files: entries,
      totals: {
        files: entries.length,
        bytes: entries.reduce((n, e) => n + e.bytes, 0)
      },
      scores: scores
    };
    return { manifest: manifest, json: JSON.stringify(manifest, null, 2) + '\n' };
  }

  // ---- verify ---------------------------------------------------------------
  // Compares a manifest against a set of files. Reported in the three ways a
  // mismatch actually happens: a file that changed, one that vanished, and one
  // that was added without being recorded.
  async function verify(manifest, files) {
    const m = typeof manifest === 'string' ? JSON.parse(manifest) : manifest;
    if (!m || !Array.isArray(m.files)) {
      return { ok: false, reason: 'not-a-manifest', changed: [], missing: [], added: [] };
    }
    // The manifest cannot contain its own hash, so it is the one file it does
    // not list. Verifying an export FOLDER — the natural thing to do, and the
    // only thing a client can do — hands the manifest back in as one of the
    // files, which reported it as "added" and failed every honest check.
    const list = (Array.isArray(files) ? files : []).filter((f) => f && f.name && String(f.name) !== FILE);
    const byName = {};
    list.forEach((f) => { byName[String(f.name)] = f.content == null ? '' : f.content; });

    const changed = [];
    const missing = [];
    for (const e of m.files) {
      if (!(e.name in byName)) { missing.push(e.name); continue; }
      const digest = await hashText(byName[e.name]);
      if (digest !== e.sha256) changed.push(e.name);
    }
    const recorded = {};
    m.files.forEach((e) => { recorded[e.name] = true; });
    const added = list.map((f) => String(f.name)).filter((n) => !recorded[n]);

    return {
      ok: changed.length === 0 && missing.length === 0 && added.length === 0,
      changed: changed,
      missing: missing,
      added: added,
      checked: m.files.length,
      summary: (changed.length + missing.length + added.length) === 0
        ? 'All ' + m.files.length + ' files match the manifest exactly.'
        : changed.length + ' changed, ' + missing.length + ' missing, ' + added.length + ' added.'
    };
  }

  const fileOf = (artefact) => ({ name: FILE, content: (artefact && artefact.json) || '' });

  return { FILE, FORMAT, build, verify, hashText, hashingAvailable, method, fileOf, bytes };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Manifest;
