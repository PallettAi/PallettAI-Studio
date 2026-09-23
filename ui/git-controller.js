'use strict';
// ============================================================
// PallettAI Studio — visual git & release manager
// The GUI half of the backend git flow: a staging area that diffs
// the live project against the last commit, a commit timeline, and
// a one-click release modal that drives the git-sync pipeline
// through the IPC bridge and animates on a completed push.
// ------------------------------------------------------------
//   1. diffStaging(baseline, current) → [{path, status, kind}]
//        status: added | modified | deleted, kind: html | css |
//        js | asset | config. Inputs are file maps
//        ({path: hash}) or [{path, hash}] — see hashOf().
//   2. parseGitLog(input) → normalized commits, newest first.
//        Accepts an array, {commits: []} or {log: []}; malformed
//        entries are dropped instead of rendered as blanks.
//   3. buildCommitMessage({type, scope, subject, body, breaking})
//        → {ok, message, warnings} — Conventional Commits with
//        type validation and a subject-length warning.
//      recommendBump(commits) + bumpVersion(semver, bump) turn a
//      history into a release version (major/minor/patch).
//   4. DOM: renderStagingArea, renderTimeline, openReleaseModal.
//
// ---- BRIDGE -----------------------------------------------------
// window.pallettaiAPI.git (falling back to window.pallettai.git).
// The backend owner ships it (scripts/git-sync.js drives the real
// git commands); nothing here shells out or touches the disk.
// Contract:
//   status({root})                 → {files: {path: hash}} | [{path, hash}]
//   log({limit})                   → commit array (see parseGitLog)
//   release({message, files, bump}, onProgress)
//                                  → {ok, pushed, version?, url?, error?}
// Progress stages reported to onProgress:
//   'staging' → 'committing' → 'pushing' → 'done'
// A missing bridge renders the UI in preview mode: staging is
// empty, the release button reports 'bridge-unavailable' instead
// of pretending a push happened.
//
// ---- what this file guarantees ----------------------------------
// 1. STAGING IS DERIVED, NEVER INVENTED. The list comes from a
//    real diff of two file maps, so a file that did not change can
//    never be offered for commit, and a deleted file is reported
//    as such instead of silently vanishing from the diff.
// 2. NO INTERPOLATED HTML. Every node is built with
//    createElement/textContent/setAttribute, so a branch name or
//    commit subject containing <script> is rendered as text — the
//    controller cannot be an XSS vector through git metadata.
// 3. RELEASE IS IDEMPOTENT UNDER DOUBLE-CLICK. submit() takes a
//    single in-flight guard; a second click while the promise is
//    pending returns the same promise, so one modal cannot push
//    twice.
// 4. SUCCESS IS ONLY CLAIMED ON A REAL PUSH. The success animation
//    is added when the bridge resolves {ok: true} (or pushed ===
//    true); a rejection or {ok: false} renders the error state and
//    leaves the modal open so the operator can retry.
// ============================================================

(function (root) {
  const TYPES = ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert', 'design', 'a11y'];
  const STAGES = ['staging', 'committing', 'pushing', 'done'];

  const KIND_BY_EXT = {
    html: 'html', htm: 'html', css: 'css', js: 'js', mjs: 'js', cjs: 'js',
    json: 'config', toml: 'config', yml: 'config', yaml: 'config', md: 'config',
    png: 'asset', jpg: 'asset', jpeg: 'asset', gif: 'asset', webp: 'asset',
    avif: 'asset', svg: 'asset', ico: 'asset', mp4: 'asset', webm: 'asset',
    woff: 'asset', woff2: 'asset', ttf: 'asset', otf: 'asset'
  };

  function extOf(p) {
    const clean = String(p == null ? '' : p).split('?')[0];
    const i = clean.lastIndexOf('.');
    return i > -1 ? clean.slice(i + 1).toLowerCase() : '';
  }

  function classifyPath(p) {
    return KIND_BY_EXT[extOf(p)] || 'other';
  }

  function shortHash(h) {
    return String(h == null ? '' : h).slice(0, 7);
  }

  // FNV-1a over the string — a stable, dependency-free identity for
  // file content when the caller has no hash of its own.
  function hashOf(value) {
    const s = String(value == null ? '' : value);
    if (/^[0-9a-f]{7,64}$/i.test(s)) return s.toLowerCase();
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
  }

  function toFileMap(input) {
    const out = {};
    if (Array.isArray(input)) {
      input.forEach((f) => {
        if (f && typeof f.path === 'string') out[f.path] = hashOf(f.hash != null ? f.hash : f.content);
      });
      return out;
    }
    if (input && typeof input === 'object') {
      Object.keys(input).forEach((k) => { out[k] = hashOf(input[k]); });
    }
    return out;
  }

  /**
   * diffStaging(baseline, current) — what a commit would contain.
   * Sorted by path so the same pair always renders identically.
   */
  function diffStaging(baseline, current) {
    const before = toFileMap(baseline);
    const after = toFileMap(current);
    const paths = Object.keys(Object.assign({}, before, after)).sort();
    const changes = [];
    paths.forEach((p) => {
      const inBefore = Object.prototype.hasOwnProperty.call(before, p);
      const inAfter = Object.prototype.hasOwnProperty.call(after, p);
      if (inBefore && !inAfter) changes.push({ path: p, status: 'deleted', kind: classifyPath(p), before: before[p], after: null });
      else if (!inBefore && inAfter) changes.push({ path: p, status: 'added', kind: classifyPath(p), before: null, after: after[p] });
      else if (before[p] !== after[p]) changes.push({ path: p, status: 'modified', kind: classifyPath(p), before: before[p], after: after[p] });
    });
    return changes;
  }

  function summarize(changes) {
    const list = Array.isArray(changes) ? changes : [];
    const byKind = {};
    const counts = { added: 0, modified: 0, deleted: 0, total: list.length };
    list.forEach((c) => {
      if (counts[c && c.status] != null) counts[c.status]++;
      const kind = (c && c.kind) || 'other';
      byKind[kind] = (byKind[kind] || 0) + 1;
    });
    return Object.assign(counts, { byKind });
  }

  function toIso(value) {
    if (value == null) return '';
    if (value instanceof Date) return value.toISOString();
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString();
  }

  /**
   * parseGitLog(input) → [{hash, short, subject, body, author,
   * email, iso, tags}] newest first. Tolerates arrays, {commits}
   * and {log}, plus ISO/epoch/Date dates and missing fields.
   */
  function parseGitLog(input, options) {
    const o = options || {};
    const raw = Array.isArray(input) ? input
      : (input && Array.isArray(input.commits) ? input.commits
        : (input && Array.isArray(input.log) ? input.log : []));
    const commits = [];
    raw.forEach((c) => {
      if (!c || typeof c !== 'object') return;
      const hash = String(c.hash || c.sha || c.id || c.commit || '').trim();
      const subject = String(c.subject || c.message || c.title || c.summary || '').split('\n')[0].trim();
      if (!hash && !subject) return; // nothing renderable
      // `git log --format=%B` hands over ONE string holding subject and
      // body. Split it here when the caller did not already, so the body
      // is not silently lost when the release notes need it.
      const fullMessage = String(c.message == null ? '' : c.message).trim();
      const bodyFromMessage = fullMessage.indexOf('\n') > -1
        ? fullMessage.slice(fullMessage.indexOf('\n') + 1).trim()
        : '';
      const body = String(c.body || '').trim() || bodyFromMessage;
      commits.push({
        hash,
        short: shortHash(hash),
        subject: subject || '(no subject)',
        body,
        author: String(c.author || c.authorName || c.committer || '').trim(),
        email: String(c.email || c.authorEmail || '').trim(),
        iso: toIso(c.iso || c.date || c.committerDate || c.authorDate || c.timestamp),
        tags: Array.isArray(c.tags) ? c.tags.map(String) : []
      });
    });
    commits.sort((a, b) => {
      const ta = a.iso ? Date.parse(a.iso) : 0;
      const tb = b.iso ? Date.parse(b.iso) : 0;
      return tb - ta;
    });
    const limit = Number.isFinite(o.limit) ? Math.max(0, Math.floor(o.limit)) : commits.length;
    return commits.slice(0, limit);
  }

  function relativeTime(iso, nowMs) {
    if (!iso) return '';
    const then = Date.parse(iso);
    if (Number.isNaN(then)) return '';
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    const secs = Math.round((now - then) / 1000);
    const abs = Math.abs(secs);
    const units = [['y', 31536000], ['mo', 2592000], ['d', 86400], ['h', 3600], ['m', 60]];
    for (let i = 0; i < units.length; i++) {
      if (abs >= units[i][1]) {
        const n = Math.floor(abs / units[i][1]);
        return secs >= 0 ? n + units[i][0] + ' ago' : 'in ' + n + units[i][0];
      }
    }
    return 'just now';
  }

  // ============================================================
  // Commit message + version
  // ============================================================

  function buildCommitMessage(input) {
    const i = input || {};
    const type = String(i.type || 'chore').toLowerCase().trim();
    const warnings = [];
    if (TYPES.indexOf(type) === -1) {
      warnings.push('unknown commit type "' + type + '" — commit anyway?');
    }
    const subject = String(i.subject == null ? '' : i.subject).replace(/\s+/g, ' ').trim();
    if (!subject) {
      return { ok: false, message: '', warnings: warnings.concat(['a subject is required']) };
    }
    if (subject.length > 72) warnings.push('subject is ' + subject.length + ' chars (aim for ≤ 72)');
    if (/\.$/.test(subject)) warnings.push('subject ends with a period');
    // "ui dashboard" → "ui-dashboard": whitespace becomes a hyphen
    // rather than being deleted, so the scope stays readable
    const scope = String(i.scope == null ? '' : i.scope)
      .replace(/[^A-Za-z0-9._/-]+/g, '-').replace(/^-+|-+$/g, '');
    const header = type + (scope ? '(' + scope + ')' : '') + (i.breaking ? '!' : '') + ': ' + subject;
    const body = String(i.body == null ? '' : i.body).trim();
    const parts = [header];
    if (body) parts.push('', body);
    if (i.breaking) parts.push('', 'BREAKING CHANGE: ' + (String(i.breakingText || '').trim() || subject));
    return { ok: true, message: parts.join('\n'), header, warnings };
  }

  function commitBump(commit) {
    const subject = String((commit && (commit.subject || commit.message)) || '');
    if (/^[a-z]+(\([^)]*\))?!:/.test(subject) || /BREAKING[ -]CHANGE/.test(String((commit && commit.body) || '')) || /BREAKING[ -]CHANGE/.test(subject)) {
      return 'major';
    }
    if (/^feat(\([^)]*\))?:/.test(subject)) return 'minor';
    return 'patch';
  }

  function recommendBump(commits) {
    const list = Array.isArray(commits) ? commits : [];
    let bump = null;
    list.forEach((c) => {
      const b = commitBump(c);
      if (b === 'major') bump = 'major';
      else if (b === 'minor' && bump !== 'major') bump = 'minor';
      else if (!bump) bump = 'patch';
    });
    return bump || 'patch';
  }

  function bumpVersion(current, bump) {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(current == null ? '' : current).trim());
    if (!m) {
      const e = new Error('bumpVersion needs a semver string like 1.4.2');
      e.code = 'bad_input';
      throw e;
    }
    let major = Number(m[1]);
    let minor = Number(m[2]);
    let patch = Number(m[3]);
    if (bump === 'major') { major++; minor = 0; patch = 0; }
    else if (bump === 'minor') { minor++; patch = 0; }
    else patch++;
    return major + '.' + minor + '.' + patch;
  }

  // ============================================================
  // Bridge + DOM
  // ============================================================

  function resolveGitBridge(explicit) {
    if (explicit) return explicit;
    if (typeof window === 'undefined' || !window) return null;
    const api = window.pallettaiAPI || window.pallettai;
    if (!api) return null;
    if (api.git && typeof api.git === 'object') return api.git;
    if (typeof api.gitRelease === 'function') return { release: api.gitRelease };
    return null;
  }

  function el(doc, tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  /**
   * renderStagingArea(rootEl, {changes, doc, onToggle, onStageAll})
   * Every file gets a checkbox; all start staged (that is what a
   * "release what changed" flow means) unless `stagedExclude`.
   */
  function renderStagingArea(rootEl, options) {
    const o = options || {};
    const doc = o.doc || (typeof document !== 'undefined' ? document : null);
    if (!rootEl || !doc) return null;
    const changes = Array.isArray(o.changes) ? o.changes : [];
    const excluded = new Set(o.stagedExclude || []);
    const selected = new Set();

    const wrap = el(doc, 'section', 'pai-git-staging');
    wrap.setAttribute('data-pai-git', 'staging');
    const head = el(doc, 'header', 'pai-git-staging__head');
    const title = el(doc, 'h3', 'pai-git-staging__title', 'Staging area');
    const counts = el(doc, 'span', 'pai-git-staging__counts');
    counts.setAttribute('data-pai-git-counts', '1');
    head.appendChild(title);
    head.appendChild(counts);
    wrap.appendChild(head);

    const list = el(doc, 'ul', 'pai-git-staging__list');
    list.setAttribute('role', 'list');
    wrap.appendChild(list);
    const empty = el(doc, 'p', 'pai-git-staging__empty', 'Nothing to release — the working tree matches the last commit.');
    empty.setAttribute('data-pai-git-empty', '1');

    const controls = el(doc, 'div', 'pai-git-staging__controls');
    const allLabel = el(doc, 'label', 'pai-git-staging__all');
    const allBox = doc.createElement('input');
    allBox.type = 'checkbox';
    allBox.setAttribute('data-pai-git-stage-all', '1');
    const allText = el(doc, 'span', null, 'Select all');
    allLabel.appendChild(allBox);
    allLabel.appendChild(allText);
    controls.appendChild(allLabel);
    wrap.appendChild(controls);

    function stagedPaths() {
      return Array.from(selected).sort();
    }

    function paintCounts() {
      const s = summarize(changes);
      counts.textContent = s.total
        ? s.total + ' change' + (s.total === 1 ? '' : 's') + ' · ' + selected.size + ' staged'
        : 'clean';
      allBox.checked = changes.length > 0 && selected.size === changes.length;
      allBox.disabled = changes.length === 0;
      controls.style.display = changes.length ? '' : 'none';
    }

    list.textContent = '';
    changes.forEach((c) => {
      const status = c.status || 'modified';
      const row = el(doc, 'li', 'pai-git-file');
      row.setAttribute('data-pai-git-file', c.path);
      row.setAttribute('data-status', status);
      row.setAttribute('data-kind', c.kind || 'other');
      const label = el(doc, 'label', 'pai-git-file__label');
      const box = doc.createElement('input');
      box.type = 'checkbox';
      box.checked = !excluded.has(c.path);
      if (box.checked) selected.add(c.path);
      box.setAttribute('data-pai-git-path', c.path);
      box.setAttribute('aria-label', status + ' ' + c.path);
      box.addEventListener('change', () => {
        if (box.checked) selected.add(c.path); else selected.delete(c.path);
        row.setAttribute('data-staged', box.checked ? '1' : '0');
        paintCounts();
        if (typeof o.onToggle === 'function') o.onToggle(c.path, box.checked, stagedPaths());
      });
      row.setAttribute('data-staged', box.checked ? '1' : '0');
      const badge = el(doc, 'span', 'pai-git-file__status', status.charAt(0).toUpperCase());
      badge.setAttribute('data-pai-git-status', status);
      const path = el(doc, 'code', 'pai-git-file__path', c.path);
      const kind = el(doc, 'span', 'pai-git-file__kind', c.kind || 'other');
      label.appendChild(box);
      label.appendChild(badge);
      label.appendChild(path);
      label.appendChild(kind);
      row.appendChild(label);
      list.appendChild(row);
    });

    if (!changes.length) wrap.appendChild(empty);

    allBox.addEventListener('change', () => {
      const on = !!allBox.checked;
      selected.clear();
      if (on) changes.forEach((c) => selected.add(c.path));
      Array.from(list.children || []).forEach((row) => {
        const box = row.querySelector('[data-pai-git-path]');
        if (!box) return;
        box.checked = on;
        row.setAttribute('data-staged', on ? '1' : '0');
        if (!on) selected.delete(box.getAttribute('data-pai-git-path'));
      });
      paintCounts();
      if (typeof o.onStageAll === 'function') o.onStageAll(on, stagedPaths());
    });

    paintCounts();
    rootEl.appendChild(wrap);
    return {
      el: wrap,
      stagedPaths,
      counts: () => summarize(changes),
      setChanges: (next) => renderStagingArea(rootEl, Object.assign({}, o, { changes: next })),
      destroy: () => { if (wrap.remove) wrap.remove(); }
    };
  }

  /**
   * renderTimeline(rootEl, {commits, doc, limit, now})
   * Newest first, HEAD marked, one node per commit
   * ([data-pai-commit] with hash/short/date attributes).
   */
  function renderTimeline(rootEl, options) {
    const o = options || {};
    const doc = o.doc || (typeof document !== 'undefined' ? document : null);
    if (!rootEl || !doc) return null;
    const commits = parseGitLog(o.commits, { limit: o.limit });
    const wrap = el(doc, 'section', 'pai-git-timeline');
    wrap.setAttribute('data-pai-git', 'timeline');
    const head = el(doc, 'header', 'pai-git-timeline__head');
    head.appendChild(el(doc, 'h3', 'pai-git-timeline__title', 'History'));
    head.appendChild(el(doc, 'span', 'pai-git-timeline__count', commits.length + ' commit' + (commits.length === 1 ? '' : 's')));
    wrap.appendChild(head);

    const track = el(doc, 'ol', 'pai-git-timeline__track');
    track.setAttribute('role', 'list');
    wrap.appendChild(track);

    commits.forEach((c, i) => {
      const item = el(doc, 'li', 'pai-git-commit');
      item.setAttribute('data-pai-commit', c.hash || 'c' + i);
      item.setAttribute('data-hash', c.short);
      if (c.iso) item.setAttribute('data-date', c.iso);
      if (i === 0) item.setAttribute('data-head', '1');
      const dot = el(doc, 'span', 'pai-git-commit__dot');
      dot.setAttribute('aria-hidden', 'true');
      const body = el(doc, 'div', 'pai-git-commit__body');
      const subject = el(doc, 'p', 'pai-git-commit__subject', c.subject);
      const meta = el(doc, 'p', 'pai-git-commit__meta');
      const hash = el(doc, 'code', 'pai-git-commit__hash', c.short || '—');
      const when = el(doc, 'span', 'pai-git-commit__when', relativeTime(c.iso, o.now));
      meta.appendChild(hash);
      if (c.author) meta.appendChild(el(doc, 'span', 'pai-git-commit__author', c.author));
      if (when.textContent) meta.appendChild(when);
      if (i === 0) meta.appendChild(el(doc, 'span', 'pai-git-commit__head', 'HEAD'));
      c.tags.forEach((t) => meta.appendChild(el(doc, 'span', 'pai-git-commit__tag', t)));
      body.appendChild(subject);
      body.appendChild(meta);
      item.appendChild(dot);
      item.appendChild(body);
      track.appendChild(item);
    });

    if (!commits.length) {
      const empty = el(doc, 'p', 'pai-git-timeline__empty', 'No commits yet — this project has no history.');
      empty.setAttribute('data-pai-git-empty', '1');
      wrap.appendChild(empty);
    }
    rootEl.appendChild(wrap);
    return {
      el: wrap,
      commits,
      nodes: () => Array.from(track.children || []),
      destroy: () => { if (wrap.remove) wrap.remove(); }
    };
  }

  // ============================================================
  // One-click release modal
  // ============================================================

  const STAGE_LABEL = {
    staging: 'Staging files', committing: 'Committing',
    pushing: 'Pushing to GitHub', done: 'Released'
  };

  function openReleaseModal(options) {
    const o = options || {};
    const doc = o.doc || (typeof document !== 'undefined' ? document : null);
    if (!doc) return null;
    const parent = o.root || doc.body || doc.documentElement;
    const files = Array.isArray(o.files) ? o.files.slice() : [];
    const bridge = resolveGitBridge(o.bridge);
    const commits = parseGitLog(o.commits || [], {});
    const fromVersion = o.version || '0.0.0';
    let bump = o.bump || recommendBump(commits);
    let nextVersion = fromVersion;
    try { nextVersion = bumpVersion(fromVersion, bump); } catch (e) { nextVersion = fromVersion; }

    const backdrop = el(doc, 'div', 'pai-release');
    backdrop.setAttribute('data-pai-release', '1');
    const dialog = el(doc, 'div', 'pai-release__dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'Release to GitHub');

    dialog.appendChild(el(doc, 'h3', 'pai-release__title', 'One-click release'));
    dialog.appendChild(el(doc, 'p', 'pai-release__sub', files.length + ' staged file' + (files.length === 1 ? '' : 's') + ' · ' + bump + ' bump → v' + nextVersion));

    const form = el(doc, 'form', 'pai-release__form');
    const typeSelect = doc.createElement('select');
    typeSelect.setAttribute('data-pai-release-type', '1');
    typeSelect.setAttribute('aria-label', 'Commit type');
    TYPES.forEach((t) => {
      const opt = doc.createElement('option');
      opt.value = t;
      opt.textContent = t;
      if (t === (bump === 'major' ? 'feat' : bump === 'minor' ? 'feat' : 'chore')) opt.selected = true;
      typeSelect.appendChild(opt);
    });
    const subjectInput = doc.createElement('input');
    subjectInput.type = 'text';
    subjectInput.setAttribute('data-pai-release-subject', '1');
    subjectInput.setAttribute('placeholder', 'Add the hero section');
    subjectInput.setAttribute('aria-label', 'Commit subject');
    subjectInput.value = o.subject || '';
    form.appendChild(typeSelect);
    form.appendChild(subjectInput);
    dialog.appendChild(form);

    const steps = el(doc, 'ol', 'pai-release__steps');
    STAGES.forEach((s) => {
      const li = el(doc, 'li', 'pai-release__step', STAGE_LABEL[s]);
      li.setAttribute('data-stage', s);
      steps.appendChild(li);
    });
    dialog.appendChild(steps);

    const alert = el(doc, 'p', 'pai-release__alert');
    alert.setAttribute('role', 'alert');
    alert.hidden = true;
    dialog.appendChild(alert);

    const actions = el(doc, 'div', 'pai-release__actions');
    const cancel = el(doc, 'button', 'pai-release__cancel', 'Cancel');
    cancel.type = 'button';
    cancel.setAttribute('data-pai-release-cancel', '1');
    const submit = el(doc, 'button', 'pai-release__submit', 'Commit & push');
    submit.type = 'submit';
    submit.setAttribute('data-pai-release-submit', '1');
    actions.appendChild(cancel);
    actions.appendChild(submit);
    dialog.appendChild(actions);
    backdrop.appendChild(dialog);

    let inflight = null;
    let progressIndex = -1;

    // `final` closes the run out: a shipped release must not leave its
    // last step forever reading "in progress".
    function paintProgress(stage, final) {
      const idx = STAGES.indexOf(stage);
      if (idx < progressIndex && !final) return;
      progressIndex = Math.max(progressIndex, idx);
      Array.from(steps.children || []).forEach((li, i) => {
        if (final || i < idx) li.setAttribute('data-state', 'done');
        else if (i === idx) li.setAttribute('data-state', 'active');
      });
      if (typeof o.onProgress === 'function') o.onProgress({ stage, index: idx, total: STAGES.length, final: !!final });
    }

    function fail(message) {
      alert.textContent = String(message || 'release failed');
      alert.hidden = false;
      backdrop.setAttribute('data-state', 'error');
      backdrop.classList.add('pai-release--err');
      submit.disabled = false;
      submit.textContent = 'Retry release';
    }

    function doRelease() {
      if (inflight) return inflight; // one push per modal
      const built = buildCommitMessage({
        type: typeSelect.value,
        subject: subjectInput.value,
        breaking: bump === 'major'
      });
      if (!built.ok) {
        fail(built.warnings[0] || 'a commit subject is required');
        return Promise.resolve({ ok: false, reason: 'message' });
      }
      if (!bridge || typeof bridge.release !== 'function') {
        fail('Git bridge unavailable in this build — staging stays local.');
        return Promise.resolve({ ok: false, reason: 'bridge-unavailable' });
      }
      backdrop.setAttribute('data-state', 'releasing');
      submit.disabled = true;
      submit.textContent = 'Releasing…';
      paintProgress('staging');
      inflight = Promise.resolve()
        .then(() => bridge.release({
          message: built.message,
          files: files.slice(),
          bump,
          version: nextVersion
        }, (event) => paintProgress((event && event.stage) || 'staging')))
        .then((result) => {
          const ok = !!result && (result.ok === true || result.pushed === true);
          if (!ok) {
            inflight = null;
            fail((result && (result.error || result.reason)) || 'the push did not complete');
            return { ok: false, result };
          }
          paintProgress('done', true);
          backdrop.setAttribute('data-state', 'released');
          backdrop.classList.add('pai-release--ok');
          const success = el(doc, 'div', 'pai-release__success');
          success.setAttribute('data-pai-release-success', '1');
          success.textContent = 'Pushed to GitHub · v' + (result.version || nextVersion);
          dialog.appendChild(success);
          submit.textContent = 'Released';
          if (typeof o.onReleased === 'function') o.onReleased(result);
          return { ok: true, result };
        })
        .catch((err) => {
          inflight = null;
          fail(String((err && err.message) || err));
          return { ok: false, error: String((err && err.message) || err) };
        });
      return inflight;
    }

    function close() {
      if (typeof onKey === 'function' && doc.removeEventListener) doc.removeEventListener('keydown', onKey);
      if (backdrop.remove) backdrop.remove();
    }
    function onKey(e) {
      if (e && (e.key === 'Escape' || e.key === 'Esc')) close();
    }
    cancel.addEventListener('click', close);
    form.addEventListener('submit', (e) => { if (e && e.preventDefault) e.preventDefault(); doRelease(); });
    if (doc.addEventListener) doc.addEventListener('keydown', onKey);

    if (o.message) subjectInput.value = o.message;
    parent.appendChild(backdrop);
    return {
      el: backdrop,
      close,
      submit: doRelease,
      setBump: (next) => { bump = next; },
      state: () => backdrop.getAttribute('data-state') || 'open',
      version: () => nextVersion,
      message: () => buildCommitMessage({ type: typeSelect.value, subject: subjectInput.value, breaking: bump === 'major' })
    };
  }

  // Staging area, timeline and release modal styles. Colours come from
  // the studio's OKLCH token set (ui/runtime.js injects --pai-*), with
  // inline OKLCH fallbacks so the panels read correctly standalone.
  const CSS = [
    '.pai-git-staging,.pai-git-timeline{display:flex;flex-direction:column;gap:10px;',
    'color:var(--pai-text,oklch(.95 .01 260))}',
    '.pai-git-staging__head,.pai-git-timeline__head{display:flex;align-items:baseline;gap:8px}',
    '.pai-git-staging__title,.pai-git-timeline__title{margin:0;font:600 14px/1.3 var(--font,system-ui)}',
    '.pai-git-staging__counts,.pai-git-timeline__count{font:500 11px/1 var(--font,system-ui);',
    'color:var(--pai-text-muted,oklch(.72 .02 260))}',
    '.pai-git-staging__list,.pai-git-timeline__track{margin:0;padding:0;list-style:none;',
    'display:flex;flex-direction:column;gap:4px}',
    '.pai-git-file{display:flex;align-items:center;gap:8px;padding:6px 8px;',
    'border:1px solid var(--pai-border,oklch(.42 .02 260));border-radius:calc(var(--pai-radius,10px) * .5);',
    'background:var(--pai-surface,oklch(.21 .016 260))}',
    '.pai-git-file__label{display:flex;align-items:center;gap:8px;width:100%;cursor:pointer}',
    '.pai-git-file__path{flex:1;font:500 12px/1.3 var(--font-mono,ui-monospace)}',
    '.pai-git-file[data-status=added] .pai-git-file__status{color:var(--pai-ok,oklch(.72 .17 150))}',
    '.pai-git-file[data-status=modified] .pai-git-file__status{color:var(--pai-warn,oklch(.78 .15 85))}',
    '.pai-git-file[data-status=deleted] .pai-git-file__status{color:var(--pai-error,oklch(.65 .2 25))}',
    '.pai-git-file[data-staged="1"]{border-color:var(--pai-accent,oklch(.7 .19 265))}',
    '.pai-git-file__kind{font:500 10px/1 var(--font,system-ui);',
    'color:var(--pai-text-muted,oklch(.72 .02 260))}',
    '.pai-git-staging__empty,.pai-git-timeline__empty{color:var(--pai-text-muted,oklch(.72 .02 260))}',
    '.pai-git-commit{position:relative;display:flex;gap:10px;padding:8px 0 8px 18px}',
    '.pai-git-commit__dot{position:absolute;left:3px;top:14px;width:8px;height:8px;border-radius:50%;',
    'background:var(--pai-border,oklch(.42 .02 260))}',
    '.pai-git-commit[data-head] .pai-git-commit__dot{background:var(--pai-accent,oklch(.7 .19 265))}',
    '.pai-git-commit__subject{margin:0;font:500 13px/1.35 var(--font,system-ui)}',
    '.pai-git-commit__meta{display:flex;flex-wrap:wrap;gap:8px;margin:3px 0 0;font:400 11px/1.3 var(--font,system-ui);',
    'color:var(--pai-text-muted,oklch(.72 .02 260))}',
    '.pai-git-commit__hash{font:500 11px/1 var(--font-mono,ui-monospace)}',
    '.pai-git-commit__head{color:var(--pai-accent,oklch(.7 .19 265))}',
    '.pai-git-commit__tag{padding:1px 6px;border-radius:999px;',
    'background:var(--pai-accent-soft,oklch(.45 .1 265));color:var(--pai-accent,oklch(.7 .19 265))}',
    '.pai-release{position:fixed;inset:0;display:grid;place-items:center;z-index:60;',
    'background:oklch(.16 .012 260 / .72)}',
    '.pai-release__dialog{width:min(420px,92vw);display:flex;flex-direction:column;gap:12px;padding:20px;',
    'background:var(--pai-surface,oklch(.21 .016 260));border:1px solid var(--pai-border,oklch(.42 .02 260));',
    'border-radius:var(--pai-radius,10px)}',
    '.pai-release--ok .pai-release__dialog{border-color:var(--pai-ok,oklch(.72 .17 150))}',
    '.pai-release--err .pai-release__dialog{border-color:var(--pai-error,oklch(.65 .2 25))}',
    '.pai-release__title{margin:0;font:600 15px/1.3 var(--font,system-ui)}',
    '.pai-release__sub{margin:0;font:400 12px/1.4 var(--font,system-ui);',
    'color:var(--pai-text-muted,oklch(.72 .02 260))}',
    '.pai-release__form{display:flex;gap:8px}',
    '.pai-release__form input{flex:1;min-width:0;padding:7px 9px;color:inherit;font:400 13px/1.3 var(--font,system-ui);',
    'background:var(--pai-surface-alt,oklch(.26 .02 260));border:1px solid var(--pai-border,oklch(.42 .02 260));',
    'border-radius:calc(var(--pai-radius,10px) * .5)}',
    '.pai-release__steps{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:4px;',
    'font:400 12px/1.4 var(--font,system-ui);color:var(--pai-text-muted,oklch(.72 .02 260))}',
    '.pai-release__step[data-state=active]{color:var(--pai-accent,oklch(.7 .19 265))}',
    '.pai-release__step[data-state=done]{color:var(--pai-ok,oklch(.72 .17 150))}',
    '.pai-release__alert{margin:0;font:500 12px/1.4 var(--font,system-ui);color:var(--pai-error,oklch(.65 .2 25))}',
    '.pai-release__actions{display:flex;justify-content:flex-end;gap:8px}',
    '.pai-release__submit{padding:8px 14px;border:0;cursor:pointer;font:600 13px/1 var(--font,system-ui);',
    'color:var(--pai-bg,oklch(.16 .012 260));background:var(--pai-accent,oklch(.7 .19 265));',
    'border-radius:calc(var(--pai-radius,10px) * .6)}',
    '.pai-release__submit[disabled]{opacity:.6;cursor:progress}',
    '.pai-release__success{font:600 12px/1.4 var(--font,system-ui);color:var(--pai-ok,oklch(.72 .17 150))}'
  ].join('');

  const api = {
    CSS,
    TYPES,
    STAGES,
    classifyPath,
    hashOf,
    diffStaging,
    summarize,
    parseGitLog,
    relativeTime,
    buildCommitMessage,
    recommendBump,
    bumpVersion,
    resolveGitBridge,
    renderStagingArea,
    renderTimeline,
    openReleaseModal
  };

  if (root) root.PallettAIGit = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null));
