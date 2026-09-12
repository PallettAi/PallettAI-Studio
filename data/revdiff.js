// ============================================================
// PallettAI Studio — revision diffing (pure logic)
// Powers the ⏱ Autosave history "Diff" button: compares two project
// snapshots into human-readable changes. No DOM.
//
// Project shape (from app.js): { id, name, site:{ name, palette, font,
//   design:{radius,spacing,containerWidth}, heroLayout, sections:[...] },
//   suites:[...] }
// ============================================================

'use strict';

const RevDiff = (() => {
  const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

  // DB is a classic-script global in the browser (script order guarantees it);
  // under Node the smoke test requires it directly.
  const DBREF = (() => {
    try { if (typeof DB !== 'undefined' && DB) return DB; } catch (e) { /* fall through */ }
    try { return (typeof require === 'function') ? require('./db.js') : null; } catch (e) { return null; }
  })();

  const sectionLabel = (s) => {
    const t = (DBREF ? DBREF.sectionTypes[s.type] : null);
    return (t && t.name) || s.type;
  };

  // ---------- flat "facts" extraction ----------
  function facts(project) {
    const p = project || {};
    const site = p.site || {};
    const out = {
      palette: clip(site.palette, 40),
      font: clip(site.font, 40),
      heroLayout: clip(site.heroLayout, 40),
      name: clip(site.name, 80),
      tagline: clip(site.tagline, 120),
      design: {},
      suites: Array.isArray(p.suites) ? p.suites.slice().sort() : [],
      sections: []
    };
    const d = site.design || {};
    ['radius', 'spacing', 'containerWidth'].forEach((k) => { if (d[k] != null) out.design[k] = Number(d[k]); });

    (Array.isArray(site.sections) ? site.sections : []).forEach((s, i) => {
      if (!s || typeof s !== 'object') return;
      out.sections.push({
        type: clip(s.type, 40),
        title: clip(s.title, 120),
        subtitle: clip(s.subtitle, 200),
        layout: clip(s.layout, 40),
        extra: clip(s.extra, 200),
        items: (Array.isArray(s.items) ? s.items : []).map((it) => ({
          title: clip(it && it.title, 120),
          text: clip(it && it.text, 400)
        }))
      });
    });
    return out;
  }

  function paletteName(id) {
    const p = (DBREF ? DBREF.palettes.find((x) => x.id === id) : null);
    return p ? p.name : id || '—';
  }
  function fontName(id) {
    const f = (DBREF ? DBREF.fonts.find((x) => x.id === id) : null);
    return (f && f.name) || id || '—';
  }

  function sectionChanges(aSec, bSec) {
    const ch = [];
    if (aSec.type !== bSec.type) {
      ch.push({ label: 'Type', from: sectionLabel(aSec), to: sectionLabel(bSec) });
      return ch;
    }
    if (aSec.title !== bSec.title) ch.push({ label: 'Title', from: aSec.title || '—', to: bSec.title || '—' });
    if (aSec.subtitle !== bSec.subtitle) ch.push({ label: 'Subtitle', from: aSec.subtitle || '—', to: bSec.subtitle || '—' });
    if (aSec.layout !== bSec.layout) ch.push({ label: 'Layout', from: aSec.layout || 'auto', to: bSec.layout || 'auto' });
    if (aSec.extra !== bSec.extra) ch.push({ label: 'Extra field', from: aSec.extra || '—', to: bSec.extra || '—' });

    // items: index-aligned, summarized as added/removed/edited counts
    const max = Math.max(aSec.items.length, bSec.items.length);
    let edits = 0, added = 0, removed = 0;
    for (let i = 0; i < max; i++) {
      const a = aSec.items[i], b = bSec.items[i];
      if (a && !b) { removed++; continue; }
      if (!a && b) { added++; continue; }
      if (a && b && (a.title !== b.title || a.text !== b.text)) edits++;
    }
    if (added) ch.push({ label: 'Items', from: '', to: '+' + added + ' added' });
    if (removed) ch.push({ label: 'Items', from: '', to: '−' + removed + ' removed' });
    if (edits) ch.push({ label: 'Items', from: '', to: edits + ' edited' });
    return ch;
  }

  // ---------- main ----------
  // Returns { changed, summary:[{label, from, to}], sections:[{index, kind, label, changes}] }
  function diff(prevProject, nextProject) {
    const A = facts(prevProject);
    const B = facts(nextProject);
    const summary = [];

    const push = (label, a, b, fmt) => {
      if (a === b) return;
      const f = fmt || ((x) => x);
      summary.push({ label, from: a ? f(a) : '—', to: b ? f(b) : '—' });
    };
    push('Site name', A.name, B.name);
    push('Tagline', A.tagline, B.tagline);
    push('Palette', A.palette, B.palette, paletteName);
    push('Font', A.font, B.font, fontName);
    push('Hero layout', A.heroLayout, B.heroLayout);
    ['radius', 'spacing', 'containerWidth'].forEach((k) => {
      const av = A.design[k], bv = B.design[k];
      if (av !== bv) summary.push({
        label: ({ radius: 'Corner radius', spacing: 'Section spacing', containerWidth: 'Container width' })[k],
        from: av == null ? '—' : String(av),
        to: bv == null ? '—' : String(bv)
      });
    });
    const as = A.suites.join(', ');
    const bs = B.suites.join(', ');
    if (as !== bs) summary.push({ label: 'Suites', from: as || '—', to: bs || '—' });

    // sections: index-aligned
    const max = Math.max(A.sections.length, B.sections.length);
    const sectionReports = [];
    for (let i = 0; i < max; i++) {
      const a = A.sections[i], b = B.sections[i];
      if (a && !b) { sectionReports.push({ index: i, kind: 'removed', label: sectionLabel(a), changes: [] }); continue; }
      if (!a && b) { sectionReports.push({ index: i, kind: 'added', label: sectionLabel(b), changes: [] }); continue; }
      const ch = sectionChanges(a, b);
      if (ch.length) sectionReports.push({ index: i, kind: 'edited', label: sectionLabel(b), changes: ch });
    }

    return {
      changed: summary.length > 0 || sectionReports.length > 0,
      summary,
      sections: sectionReports
    };
  }

  // Count of individual changes for a compact list badge.
  function changeCount(report) {
    if (!report || !report.changed) return 0;
    let n = report.summary.length;
    report.sections.forEach((s) => { n += (s.kind === 'edited') ? s.changes.length : 1; });
    return n;
  }

  return { facts, diff, changeCount, sectionLabel };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = RevDiff;
