// ============================================================
// PallettAI Studio — licence-aware image credits smoke test
// Verifies the BUILDER's exported-site footer honours imageMeta:
//   1. CC-BY/CC-BY-SA photos (Openverse / Wikimedia Commons)
//      render a compact "Photos" attribution block with source
//      links, deduped per image, across sections AND their items.
//   2. HTML is escaped (quote / ampersand in titles, creators).
//   3. CC0/PD photos, uploads and images without meta add nothing.
//   node scripts/image-credits-smoke.js
// ============================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DB = require(path.join(__dirname, '..', 'data', 'db.js'));
const ONLINE = require(path.join(__dirname, '..', 'data', 'online.js'));
const aiCode = fs.readFileSync(path.join(__dirname, '..', 'modules', 'ai.js'), 'utf8');
const builderCode = fs.readFileSync(path.join(__dirname, '..', 'modules', 'builder.js'), 'utf8');

const sandbox = {
  console, URL, setTimeout, clearTimeout, Math, Date, JSON, Set, Promise, process,
  DB, ONLINE,
  Image: function Image() {},
  fetch: async () => { throw new Error('harness: no network expected'); }
};
vm.createContext(sandbox);
vm.runInContext(aiCode + '\n;globalThis.AI = AI;\n', sandbox);
vm.runInContext(builderCode + '\n;globalThis.Builder = Builder;\n', sandbox);

const AI = sandbox.AI;
const Builder = sandbox.Builder;

let pass = 0, fail = 0;
const ok = (cond, label) => {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label); }
};

// Licence-carrying metadata, shaped exactly like ai.js's cleanImageMeta output.
const ovMeta = (over) => Object.assign({
  source: 'Openverse', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Pizza_oven.jpg',
  creator: 'Anna Maria', creatorUrl: '', license: 'CC BY-SA 4.0', licenseId: 'by-sa',
  licenseVersion: '4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
  attribution: 'Wood-fired pizza oven — by Anna Maria — CC BY-SA 4.0',
  requiresAttribution: true, title: 'Wood-fired pizza oven', id: 'img-1'
}, over || {});

const creditsBlock = (html) => {
  const start = html.indexOf('class="foot-credits"');
  if (start === -1) return '';
  const end = html.indexOf('</footer>', start);
  return html.slice(start, end === -1 ? html.length : end);
};

// A clean, tiny base project from the real generator.
const project = AI.generateSite('pizza place');
const hero = project.site.sections.find((s) => s.type === 'hero');
const gal = project.site.sections.find((s) => s.type === 'gallery');
const about = project.site.sections.find((s) => s.type === 'about');
if (!hero) throw new Error('generator produced no hero — cannot test');

// Remove every photo the generator placed so the model is fully clean.
const clearPhotos = () => {
  delete hero.image; delete hero.imageMeta;
  if (about) { delete about.image; delete about.imageMeta; }
  if (gal && Array.isArray(gal.items)) {
    gal.items.forEach((it) => { delete it.image; delete it.imageMeta; });
  }
};

// ---- 1. attribution block appears and is deduped ----
console.log('[1] credits render + dedupe');
clearPhotos();
hero.image = 'https://example.com/hero-pizza.jpg';
hero.imageMeta = ovMeta({});
if (gal && Array.isArray(gal.items)) {
  gal.items.forEach((it, i) => {
    it.image = 'https://example.com/tile-' + i + '.jpg';
    it.imageMeta = ovMeta({ attribution: 'Tile ' + i + ' — by Anna Maria — CC BY-SA 4.0', title: 'Tile ' + i, id: 'tile' + i });
  });
}
let block = creditsBlock(Builder.buildSiteHTML(project));
ok(!!block, 'CC-BY photo → footer gains a Photos credit block');
ok(block.indexOf('Wood-fired pizza oven') !== -1, 'hero credit carries the attribution title/creator/licence');
ok(block.indexOf('href="https://commons.wikimedia.org/wiki/File:Pizza_oven.jpg"') !== -1, 'hero credit links to the source page');
const tiles = (gal && Array.isArray(gal.items) ? gal.items.length : 0);
let tileCredits = 0;
for (let i = 0; i < tiles; i++) if (block.indexOf('Tile ' + i + ' — by Anna Maria') !== -1) tileCredits++;
ok(tileCredits === tiles, 'gallery items are credited too (' + tileCredits + '/' + tiles + ')');
if (about) {
  about.image = hero.image;
  about.imageMeta = ovMeta({});
  const block2 = creditsBlock(Builder.buildSiteHTML(project));
  ok((block2.match(/Wood-fired pizza oven/g) || []).length === 1, 'same image across sections credited once');
}

// ---- 2. HTML escaping ----
console.log('[2] escaping');
clearPhotos();
hero.image = 'https://example.com/hero-pizza.jpg';
hero.imageMeta = ovMeta({ attribution: 'Tricky "quotes" & <angles> — by A&B', sourceUrl: '', licenseUrl: '' });
const htmlEsc = Builder.buildSiteHTML(project);
ok(htmlEsc.indexOf('Tricky &quot;quotes&quot; &amp; &lt;angles&gt; — by A&amp;B') !== -1, 'credit text is HTML-escaped');
ok(htmlEsc.indexOf('Tricky "quotes" & <angles>') === -1, 'no raw markup leaks into the export');
ok(creditsBlock(htmlEsc).indexOf('<a href=') === -1, 'license text without a URL renders as plain text (no dead link)');

// ---- 3. no credit block for clean/absent metadata ----
console.log('[3] clean sources stay clean');
clearPhotos();
const htmlClean = Builder.buildSiteHTML(project);
ok(creditsBlock(htmlClean) === '', 'no meta → no credit block');
hero.image = 'https://example.com/cc0.jpg';
hero.imageMeta = ovMeta({ requiresAttribution: false, license: 'CC0', licenseId: 'cc0', sourceUrl: 'https://example.com/cc0' });
ok(creditsBlock(Builder.buildSiteHTML(project)) === '', 'CC0 / requiresAttribution:false → no credit block');
hero.imageMeta = null;
ok(creditsBlock(Builder.buildSiteHTML(project)) === '', 'explicit null meta → no credit block');

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
