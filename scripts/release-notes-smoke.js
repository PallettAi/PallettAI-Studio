// ============================================================
// What's New registry smoke test
//
// The release notes are the only shipped copy a user reads before
// they have used anything, and two ways it can go quietly wrong:
//
//   1. An icon key that is not in the stroke registry renders as a
//      bare "✦" fallback — the modal looks broken, not degraded.
//   2. `RELEASE_NOTES.version` disagreeing with `package.json` means
//      the once-per-version modal either never fires or fires against
//      last release's notes, keyed off a version that was never shown.
//
// Both are silent at runtime, so they are asserted here instead.
//
// Run: node scripts/release-notes-smoke.js
// ============================================================
'use strict';

const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');

const RELEASE_NOTES = require(path.join(ROOT, 'data', 'release-notes.js'));
const ICONS = require(path.join(ROOT, 'data', 'icons.js'));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

let failed = 0;
function ok(name, cond, detail) {
  console.log((cond ? '  \u2713 ' : '  \u2717 ') + name + (!cond && detail ? '  -> ' + String(detail).slice(0, 220) : ''));
  if (!cond) failed++;
}

console.log('== Shape ==');
ok('release-notes.js exports RELEASE_NOTES', !!RELEASE_NOTES && typeof RELEASE_NOTES === 'object');
ok('version is a semver-looking string', /^\d+\.\d+\.\d+$/.test(String(RELEASE_NOTES.version || '')), RELEASE_NOTES.version);
ok('date is present', !!RELEASE_NOTES.date, RELEASE_NOTES.date);
ok('tagline is present', !!RELEASE_NOTES.tagline && RELEASE_NOTES.tagline.length > 10, RELEASE_NOTES.tagline);
ok('highlights is an array', Array.isArray(RELEASE_NOTES.highlights));

const notes = Array.isArray(RELEASE_NOTES.highlights) ? RELEASE_NOTES.highlights : [];
ok('highlights holds 3-4 items', notes.length >= 3 && notes.length <= 4, notes.length);

console.log('\n== Every highlight is renderable ==');
const seenTitles = new Set();
notes.forEach((h, i) => {
  const at = 'highlight ' + i;
  ok(at + ' has a title', !!h.title, h.title);
  ok(at + ' has a desc', !!h.desc && h.desc.length > 20, h.desc);
  // This is the load-bearing one: app.js falls back to "✦" for unknown keys,
  // so a typo here ships as a broken-looking modal rather than an error.
  const iconExists = !!(h.icon && typeof ICONS.has === 'function' && ICONS.has(h.icon));
  ok(at + ' icon "' + h.icon + '" exists in the icon registry', iconExists);
  ok(at + ' title is unique', !seenTitles.has(h.title), h.title);
  seenTitles.add(h.title);
  ok(at + ' has no emoji in the copy', !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test((h.title || '') + (h.desc || '')));
});

console.log('\n== Registry coherence ==');
// The modal keys off RELEASE_NOTES.version. If it lags package.json the notes
// either never show or show last release's copy against the new version.
ok('version matches package.json', RELEASE_NOTES.version === pkg.version,
  RELEASE_NOTES.version + ' vs ' + pkg.version);

const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
ok('app.js reads RELEASE_NOTES for the What\u2019s New modal', /RELEASE_NOTES/.test(app));
ok('the modal has an unknown-icon fallback', /ICONS\.has\(h\.icon\)/.test(app));

console.log('\n' + (failed === 0 ? 'RELEASE NOTES SMOKE PASSED' : 'RELEASE NOTES SMOKE FAILED: ' + failed));
process.exit(failed === 0 ? 0 : 1);
