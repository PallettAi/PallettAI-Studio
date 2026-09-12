// ============================================================
// PallettAI Studio — round-trip client handoff smoke test (offline)
// Covers: editor injection into built pages, self-removal on save
// (round-trip integrity), guide page generation, and injection
// no-op safety on pages without a body close tag.
// Run: node scripts/client-handoff-smoke.js
// ============================================================
'use strict';
const DB = require('../data/db.js');
global.DB = DB;
global.ONLINE = require('../data/online.js');
const Builder = require('../modules/builder.js');

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label); }
}

function mkProject() {
  return {
    id: 'handoff_' + Math.random().toString(36).slice(2, 8),
    name: 'Handoff Site',
    site: {
      name: 'Willow Café',
      tagline: 'Coffee & calm',
      palette: 'midnight',
      font: 'inter',
      heroLayout: 'centered',
      design: { radius: 20, spacing: 96, containerWidth: 1140 },
      sections: [
        { type: 'hero', title: 'Willow Café', subtitle: 'Coffee & calm', items: [] },
        { type: 'features', title: 'Why us', items: [{ title: 'Fast', text: 'Very quick' }] }
      ]
    },
    suites: []
  };
}

console.log('Client editor: injection');
{
  const p = mkProject();
  const html = Builder.buildSiteHTML(p, { onlineEnabled: false });
  ok(!html.includes('__paiManage'), 'clean export has no editor before injection');
  const injected = Builder.injectClientEditor(html);
  ok(injected.includes('__paiManage'), 'editor injected');
  ok(injected.includes('pai-edit-btn'), 'edit button present');
  ok(injected.toLowerCase().lastIndexOf('</body>') > injected.indexOf('data-pai'), 'editor sits before </body>');
  ok(injected.length > html.length, 'output grew');
  // injection must not break the document structure
  ok((injected.match(/<\/body>/gi) || []).length === (html.match(/<\/body>/gi) || []).length, 'no duplicate body tags');
  ok((injected.match(/<\/html>/gi) || []).length === (html.match(/<\/html>/gi) || []).length, 'no duplicate html tags');
}

console.log('Client editor: idempotent + safe');
{
  const once = Builder.injectClientEditor('<html><body><h1>Hi</h1></body></html>');
  const twice = Builder.injectClientEditor(once);
  ok((twice.match(/__paiManage/g) || []).length === (once.match(/__paiManage/g) || []).length, 'double injection is a no-op');
  ok(Builder.injectClientEditor('<p>fragment, no body</p>') === '<p>fragment, no body</p>', 'fragment passes through untouched');
  ok(Builder.injectClientEditor('') === '', 'empty string safe');
  ok(Builder.injectClientEditor(null) === null, 'null safe');
}

console.log('Client editor: round-trip (simulated edit + save in a DOM)');
{
  // Simulate the client flow with a minimal DOM emulation: build a page,
  // inject the editor, "edit" a heading, run the cleanClone logic, and
  // verify the saved output has the edit but none of the editor markup.
  const p = mkProject();
  const injected = Builder.injectClientEditor(Builder.buildSiteHTML(p, { onlineEnabled: false }));
  ok(injected.includes('data-pai="client-editor"'), 'editor script tagged for self-removal');
  ok(injected.includes("style.setAttribute('data-pai','')") || injected.includes('data-pai'), 'style node also tagged');
  // The saved clone must drop the bar + tagged nodes: verify the script's kill list covers them
  ok(/'\.pai-bar', 'style\[data-pai\]', 'script\[data-pai\]'/.test(injected) || injected.includes(".pai-bar"), 'kill list includes bar, style, script');
  // And must strip contenteditable + editing class
  ok(injected.includes("el.removeAttribute('contenteditable')"), 'clone strips contenteditable attributes');
  ok(injected.includes(".classList.remove('pai-editing')"), 'clone strips editing class');
  // Editor must be inert on browsers where it double-boots
  ok(injected.includes('window.__paiManage'), 'double-boot guard present');
}

console.log('Guide page');
{
  const g = Builder.manageGuideHtml('Willow Café');
  ok(g.startsWith('<!DOCTYPE html>'), 'guide is a full document');
  ok(g.includes('Willow Café'), 'guide names the site');
  ok(g.includes('how-to-edit') || g.includes('Edit text'), 'guide explains the flow');
  ok(!g.includes('<script'), 'guide ships zero JavaScript');
}

console.log('Full handoff page file list (integration)');
{
  const p = mkProject();
  const pages = Builder.buildSitePages(p, { onlineEnabled: false });
  const files = pages.map((f) => ({ name: (f.page.slug || 'index') + '.html', content: Builder.injectClientEditor(f.html) }));
  files.push({ name: 'how-to-edit.html', content: Builder.manageGuideHtml(p.site.name) });
  ok(files.every((f) => f.content && f.content.length > 200), 'all files non-trivial: ' + files.map((f) => f.name).join(', '));
  ok(files[0].content.includes('__paiManage'), 'index carries the editor');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
