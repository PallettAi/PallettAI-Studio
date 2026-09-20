#!/usr/bin/env node
'use strict';

// ============================================================
// school-preview — render one real site per design system.
//
// WHY THIS EXISTS. Numbers can prove the button, card, label, grid and nav all
// differ between schools, and numbers cannot tell you whether the page looks
// good. Both jobs are needed: the probe and the smoke suite hold the promises,
// and this writes the artefacts a person can actually open and judge. Eight
// files, one per school, all from the SAME brief and the same palette, so the
// only thing that changes between them is the design language itself.
//
// It is also the fastest way to spot the failure a suite cannot express: a
// school that is technically distinct and simply ugly.
//
//   node scripts/school-preview.js                     → .preview/schools/
//   node scripts/school-preview.js --brief "a tattoo studio in Leeds"
//   node scripts/school-preview.js --out /tmp/pai      → somewhere else
//   node scripts/school-preview.js --palette paper     → force one palette
//
// Output is complete, self-contained HTML (the same file the client exports),
// plus an index that puts all eight side by side in iframes.
// ============================================================

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

global.DB = require(path.join(ROOT, 'data', 'db.js'));
global.ONLINE = require(path.join(ROOT, 'data', 'online.js'));
global.Signature = require(path.join(ROOT, 'data', 'signature.js'));
const Sys = require(path.join(ROOT, 'data', 'ai-system.js'));
const Builder = require(path.join(ROOT, 'modules', 'builder.js'));
const { loadAI } = require(path.join(__dirname, 'load-ai.js'));
const AI = loadAI();

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const BRIEF = arg('brief', 'a family run café in Derby');
const OUT = path.resolve(arg('out', path.join(ROOT, '.preview', 'schools')));
const FORCED_PALETTE = arg('palette', '');
const ONLY = arg('only', '');

/* One palette for every school, so the comparison is about the design language
   and not about colour. A school's ground is respected when the palette is
   forced to something it cannot use — the tool says so rather than lying. */
const paletteFor = (id, seed) => {
  if (!FORCED_PALETTE) return { palette: FORCED_PALETTE, note: '' };
  const pal = DB.getPalette(FORCED_PALETTE);
  if (!pal) return { palette: FORCED_PALETTE, note: '(unknown palette)' };
  const spec = Sys.spec(id);
  const wantInk = spec && spec.ground === 'ink';
  if (wantInk && !pal.dark) return { palette: FORCED_PALETTE, note: '(a light palette on an ink-ground school — not what it ships with)' };
  if (!wantInk && pal.dark) return { palette: FORCED_PALETTE, note: '(a dark palette on a paper-ground school — not what it ships with)' };
  return { palette: FORCED_PALETTE, note: '' };
};

const ids = Sys.IDS.filter((id) => !ONLY || id === ONLY);
if (!ids.length) {
  console.error('No schools matched' + (ONLY ? ' --only ' + ONLY : '') + '.');
  process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });

const rows = [];
ids.forEach((id, i) => {
  // A fixed salt per school keeps the run reproducible: the same brief and the
  // same school always produce the same page, which is what makes a before/after
  // comparison of the generator meaningful at all.
  const seed = (i * 2654435761) >>> 0;
  const p = AI.generateSite(BRIEF, { salt: seed, layouts: 'auto', tier: 'pro' });
  const spec = Sys.spec(id);
  p.site.system = id;
  p.site.design = Object.assign({}, p.site.design, Sys.geometry(id, seed));
  const forced = paletteFor(id, seed);
  if (forced.palette) p.site.palette = forced.palette;
  let html = '';
  try { html = Builder.buildSiteHTML(p, { tier: 'pro' }) || ''; } catch (e) { html = '<p>build failed: ' + e.message + '</p>'; }
  const file = id + '.html';
  fs.writeFileSync(path.join(OUT, file), html, 'utf8');
  rows.push({
    id,
    label: spec ? spec.name : id,
    blurb: spec ? spec.blurb : '',
    file,
    bytes: html.length,
    palette: p.site.palette,
    system: id,
    note: forced.note,
    sections: (p.site.sections || []).length,
    radius: p.site.design.radius,
    spacing: p.site.design.spacing,
    tagline: p.site.tagline || '',
    heading: ((p.site.sections || []).find((s) => s.type === 'hero') || {}).title || ''
  });
  console.log('  ' + id.padEnd(11) + String(html.length).padStart(7) + ' bytes  ' + (spec ? spec.name : ''));
});

/* The index compares them the only way a design language can be compared: side
   by side, at a real width, with the words identical so only the language shows. */
const index = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<title>Design systems — ${BRIEF.replace(/[<>&]/g, '')}</title>
<style>
  :root{color-scheme:dark}
  body{margin:0;background:#0b0d12;color:#e8eaf2;font:15px/1.6 ui-sans-serif,system-ui,sans-serif}
  header{padding:28px 24px 18px;border-bottom:1px solid #232838}
  h1{margin:0 0 6px;font-size:20px;letter-spacing:-.01em}
  p.sub{margin:0;color:#98a0b8}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(460px,1fr));gap:22px;padding:24px}
  .cell{background:#12151d;border:1px solid #232838;border-radius:14px;overflow:hidden}
  .meta{padding:14px 16px;display:flex;flex-wrap:wrap;gap:6px 14px;align-items:baseline}
  .name{font-weight:700}
  .id{font:12px ui-monospace,monospace;color:#7f8aa8}
  .blurb{color:#98a0b8;font-size:13px;flex:1 1 100%}
  .facts{font:12px ui-monospace,monospace;color:#7f8aa8}
  .note{color:#e0a33a;font-size:12px;flex:1 1 100%}
  iframe{width:100%;height:520px;border:0;border-top:1px solid #232838;background:#fff;display:block}
  a.open{color:#8ab4ff;font-size:13px;text-decoration:none}
</style></head><body>
<header>
  <h1>Eight design systems, one brief</h1>
  <p class="sub">${BRIEF.replace(/[<>&]/g, '')} — the same words, the same sections, the same palette family. Only the design language changes.</p>
</header>
<div class="grid">
${rows.map((r) => `  <div class="cell">
    <div class="meta">
      <span class="name">${r.label}</span><span class="id">${r.id}</span>
      <a class="open" href="${r.file}" target="_blank">open full page →</a>
      <span class="blurb">${r.blurb}</span>
      <span class="facts">${r.sections} sections · radius ${r.radius} · ${r.spacing}px air · ${r.palette}</span>
      ${r.note ? `<span class="note">${r.note}</span>` : ''}
    </div>
    <iframe src="${r.file}" loading="lazy" title="${r.label}"></iframe>
  </div>`).join('\n')}
</div></body></html>
`;
fs.writeFileSync(path.join(OUT, 'index.html'), index, 'utf8');

console.log('\n  index → ' + path.join(OUT, 'index.html'));
