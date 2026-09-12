// ============================================================
// PallettAI Studio — revision diff smoke test (offline, pure)
// Run: node scripts/revdiff-smoke.js
// ============================================================
'use strict';
const DB = require('../data/db.js');
const RevDiff = require('../data/revdiff.js');

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label); }
}

function mkProject(over) {
  return Object.assign({
    id: 'p1',
    name: 'Willow Site',
    suites: [],
    site: {
      name: 'Willow Café',
      tagline: 'Coffee & calm',
      palette: 'midnight',
      font: 'inter',
      heroLayout: 'centered',
      design: { radius: 20, spacing: 96, containerWidth: 1140 },
      sections: [
        { type: 'hero', title: 'Willow Café', subtitle: 'Coffee & calm', items: [] },
        { type: 'features', title: 'Why us', items: [
          { title: 'Fast', text: 'Quick service' },
          { title: 'Fresh', text: 'Roasted daily' }
        ] },
        { type: 'faq', title: 'Questions', items: [{ title: 'Q1?', text: 'A1' }] }
      ]
    }
  }, over);
}

console.log('RevDiff: identical snapshots');
{
  const p = mkProject();
  const r = RevDiff.diff(p, JSON.parse(JSON.stringify(p)));
  ok(r.changed === false, 'no changes detected');
  ok(r.summary.length === 0 && r.sections.length === 0, 'empty report');
  ok(RevDiff.changeCount(r) === 0, 'change count 0');
}

console.log('RevDiff: palette / font / design changes');
{
  const a = mkProject();
  const b = mkProject();
  b.site.palette = 'aurora';
  b.site.font = 'playfair';
  b.site.design.radius = 8;
  const r = RevDiff.diff(a, b);
  ok(r.changed, 'changed detected');
  const labels = r.summary.map((s) => s.label);
  ok(labels.includes('Palette'), 'palette change reported');
  ok(labels.includes('Font'), 'font change reported');
  ok(labels.includes('Corner radius'), 'radius change reported');
  const pal = r.summary.find((s) => s.label === 'Palette');
  ok(pal.from === 'Midnight Violet' && pal.to === 'Aurora Sky', 'palette names resolved: ' + pal.from + ' → ' + pal.to);
}

console.log('RevDiff: section add / remove / edit');
{
  const a = mkProject();
  const b = mkProject();
  b.site.sections[1].items[0].text = 'Changed copy';
  b.site.sections[1].items.push({ title: 'New', text: 'New item' });
  b.site.sections.splice(2, 1); // remove faq
  b.site.sections.push({ type: 'gallery', title: 'Gallery' });
  const r = RevDiff.diff(a, b);
  const kinds = r.sections.map((s) => s.kind);
  ok(kinds.filter((k) => k === 'edited').length === 2, 'two edited sections (items + swapped type)');
  const swapped = r.sections.find((s) => s.changes.some((c) => c.label === 'Type'));
  ok(swapped && swapped.changes.find((c) => c.label === 'Type').from === 'FAQ'
    && swapped.changes.find((c) => c.label === 'Type').to === 'Gallery', 'FAQ → Gallery swap reported');
  // clean remove: a trailing section disappears (indexes stay aligned)
  const a2 = mkProject(); a2.site.sections.push({ type: 'cta', title: 'Join us', items: [] });
  const b2 = mkProject();
  const r2 = RevDiff.diff(a2, b2);
  ok(r2.sections.some((s) => s.kind === 'removed' && s.label === 'CTA Banner'), 'removed section detected');
  // clean add: a trailing section appears
  const b3 = mkProject(); b3.site.sections.push({ type: 'gallery', title: 'Gallery', items: [] });
  const r3 = RevDiff.diff(mkProject(), b3);
  ok(r3.sections.some((s) => s.kind === 'added' && s.label === 'Gallery'), 'added section detected');
  const edited = r.sections.find((s) => s.kind === 'edited');
  const tos = edited.changes.map((c) => c.to);
  ok(tos.some((t) => /1 edited/.test(t)), 'item edit counted');
  ok(tos.some((t) => /\+1 added/.test(t)), 'item add counted');
  ok(RevDiff.changeCount(r) >= 3, 'change count sums sections');
}

console.log('RevDiff: title/subtitle/layout/extra');
{
  const a = mkProject();
  const b = mkProject();
  b.site.sections[1].title = 'New heading';
  b.site.sections[1].layout = 'columns';
  b.site.sections[2].extra = 'something';
  const r = RevDiff.diff(a, b);
  const all = r.sections.flatMap((s) => s.changes.map((c) => c.label));
  ok(all.includes('Title') && all.includes('Layout') && all.includes('Extra field'), 'labels present: ' + all.join(', '));
}

console.log('RevDiff: suites + hero + tagline');
{
  const a = mkProject();
  const b = mkProject({ suites: ['blog', 'shop'] });
  b.site.heroLayout = 'split';
  b.site.tagline = 'New tagline';
  const r = RevDiff.diff(a, b);
  const labels = r.summary.map((s) => s.label);
  ok(labels.includes('Suites') && labels.includes('Hero layout') && labels.includes('Tagline'), 'labels: ' + labels.join(', '));
}

console.log('RevDiff: robust to junk');
{
  ok(RevDiff.diff(null, null).changed === false, 'null inputs');
  const r = RevDiff.diff({ site: { sections: 'nope' } }, mkProject());
  ok(r.changed === true, 'junk → added sections only');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
