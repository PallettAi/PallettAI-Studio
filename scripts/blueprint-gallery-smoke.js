'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
const Catalog = require(path.join(ROOT, 'data', 'ai-template-catalog.js'));

let failed = 0;
function ok(value, message) {
  if (value) console.log('  ✓ ' + message);
  else { failed++; console.error('  ✗ ' + message); }
}

console.log('== Blueprint gallery markup ==');
ok(/id="blueprintGallery"/.test(html), 'gallery is present on the Templates view');
ok(/id="blueprintGrid"/.test(html), 'gallery has a dedicated render target');
ok(/id="blueprintSearch"/.test(html) && /id="blueprintCategory"/.test(html), 'gallery exposes search and category filtering');
ok(/data-blueprint-use/.test(app), 'gallery has an explicit staging action');
ok(/renderBlueprintGallery\(\)/.test(app), 'Templates view renders the gallery');
ok(/blueprintQuery\.toLowerCase\(\)\.trim\(\)/.test(app), 'search uses a normalized query');
ok(/some\(\(value\) => String\(value \|\| ''\)\.toLowerCase\(\)\.includes\(query\)\)/.test(app), 'search compares against safe text metadata');
ok(/esc\(bp\.(id|name|category|blurb|signature)/.test(app), 'catalogue metadata is escaped before insertion');
ok(/selectedBlueprintId = bp\.id/.test(app), 'selection is staged rather than saved immediately');
ok(/AI\.generateSite\(prompt, \{[\s\S]*blueprintId/.test(app), 'generation receives the selected blueprint');
ok(/if \(blueprint\)[\s\S]*applyBlueprintFlavor\(project, blueprint\)/.test(fs.readFileSync(path.join(ROOT, 'modules', 'ai.js'), 'utf8')), 'AI applies blueprint structure through its normal section model');
ok(!/data-blueprint-use[^>]*onclick/.test(html), 'actions are not inline executable HTML');
ok(/blueprint-card/.test(css) && /prefers-reduced-motion:reduce/.test(css), 'gallery has responsive motion-safe styling');

console.log('\n== Catalogue presentation contract ==');
ok(Catalog.BLUEPRINTS.length >= 20, 'gallery has at least twenty directions');
ok(Catalog.BLUEPRINTS.every((bp) => bp.id && bp.look && bp.palette && bp.font), 'every card has a usable visual system');
ok(new Set(Catalog.BLUEPRINTS.map((bp) => bp.category)).size >= 12, 'gallery spans at least twelve categories');
ok(Catalog.BLUEPRINTS.every((bp) => String(bp.id).length <= 80 && String(bp.name).length <= 100), 'metadata remains bounded');

if (failed) process.exit(1);
console.log('\nblueprint-gallery-smoke PASSED');
