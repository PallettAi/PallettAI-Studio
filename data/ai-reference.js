'use strict';

function words(value) {
  return new Set(String(value == null ? '' : value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter((x) => x.length > 3));
}
function overlap(a, b) {
  const aa = words(a), bb = words(b);
  if (!aa.size || !bb.size) return 0;
  let hit = 0; aa.forEach((x) => { if (bb.has(x)) hit++; });
  return hit / Math.max(aa.size, bb.size);
}
function projectText(project) {
  const s = (project && project.site) || {};
  const parts = [s.tagline, s.description];
  (s.sections || []).forEach((sec) => {
    parts.push(sec && sec.title, sec && sec.subtitle, sec && sec.text);
    (sec && sec.items || []).forEach((it) => parts.push(it && it.title, it && it.text));
  });
  return parts.filter(Boolean).join(' ');
}
function assess(project, refs) {
  const list = Array.isArray(refs) ? refs.slice(0, 3) : [];
  const candidate = projectText(project);
  const matches = list.map((ref, i) => ({
    index: i, url: String((ref && ref.url) || ''),
    overlap: Math.round(overlap(candidate, [ref && ref.text, ref && ref.tagline, (ref && ref.services || []).map((x) => typeof x === 'string' ? x : x && x.title).join(' ')].join(' ')) * 100)
  }));
  const highest = matches.reduce((m, x) => Math.max(m, x.overlap), 0);
  return { version: 1, threshold: 55, highestOverlap: highest, distance: 100 - highest, matches, safe: highest < 55, policy: 'reference sites inform direction; their copy is never a claim source' };
}
function protect(project, refs) {
  const report = assess(project, refs);
  // This pass intentionally does not rewrite client copy. It records the
  // distance check so the UI and later critique pass can ask for a new direction
  // instead of silently presenting a clone as an original design.
  if (project && project.site) project.site.referenceGuard = report;
  return report;
}
const AiReference = { words, overlap, projectText, assess, protect };
if (typeof module !== 'undefined' && module.exports) module.exports = AiReference;
