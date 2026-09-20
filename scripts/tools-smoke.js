'use strict';

// Toolkit smoke: the surface is intentionally dependency-free and local-only,
// but its contract still spans the shell, module, and stylesheet.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
let passed = 0;
let failed = 0;
function ok(label, value) {
  if (value) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.error('  ✗ ' + label); }
}

const html = read('index.html');
const app = read('app.js');
const tools = read('data/tools.js');
const css = read('data/tools.css');

console.log('== Toolkit wiring ==');
ok('Toolkit stylesheet is loaded by the shell', html.includes('data/tools.css'));
ok('Toolkit module is loaded before app.js', html.indexOf('data/tools.js') < html.indexOf('app.js'));
ok('Toolkit view exists', /id="view-tools"/.test(html));
ok('Toolkit root exists', /id="toolsRoot"/.test(html));
ok('Toolkit navigation entry exists', /data-view="tools"/.test(html));
ok('Toolkit initialises when selected', /name === 'tools'\s*&&\s*window\.PallettAITools/.test(app));

console.log('\n== Useful surfaces ==');
['Launch runway', 'Campaign link builder', 'Contrast lens', 'Project quote helper', 'Brief distiller', 'Client handoff studio', 'Brand snapshot'].forEach((label) => ok(label + ' is present', tools.includes(label)));
ok('Field Notes guide panel is present', tools.includes('FIELD NOTES') && tools.includes('Guides that save you a mistake'));
ok('guide library has multiple entries', (tools.match(/id:'[^']+'/g) || []).length >= 8);
ok('handoff has a downloadable markdown path', tools.includes("text/markdown;charset=utf-8"));
ok('brand snapshot has a JSON download path', tools.includes("brand-snapshot.json"));
ok('UTM builder requires HTTPS', tools.includes("parsed.protocol !== 'https:'"));

console.log('\n== Local-first and bounded input ==');
ok('tool state uses a namespaced localStorage key', tools.includes("pallettai.toolkit.v1"));
ok('stored fields are length-capped', tools.includes("slice(0, 500)"));
ok('HTML output is escaped', tools.includes("function esc(value)"));
ok('no remote fetch is introduced', !/\b(fetch|XMLHttpRequest)\s*\(/.test(tools));
ok('copy fallback handles unavailable clipboard', tools.includes("document.execCommand('copy')"));

console.log('\n== Responsive safeguards ==');
ok('command grid can collapse to a zero-minimum track', css.includes('grid-template-columns:minmax(0,1fr)'));
ok('command cards cannot force a viewport wider', css.includes('max-width:100%') && css.includes('box-sizing:border-box'));
ok('reduced motion is honoured', css.includes('prefers-reduced-motion:reduce'));
ok('focus styling exists for tool inputs', css.includes('box-shadow:var(--ring)'));

console.log('\nToolkit smoke: ' + (failed ? 'FAILED' : 'PASSED') + ' — ' + passed + ' checks');
if (failed) process.exit(1);
