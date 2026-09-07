#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function assert(cond, msg) { cond ? pass(msg) : fail(msg); }

console.log('== Scripts load before ai.js ==');
const order = ['data/ai-brief.js', 'data/ai-followup.js', 'data/ai-translate.js', 'data/ai-niches-extra.js', 'data/ai-fingerprint.js', 'modules/ai.js'];
let last = -1;
order.forEach((src) => {
  const i = html.indexOf('src="' + src + '"');
  assert(i !== -1, src + ' is loaded');
  assert(i > last, src + ' order is after previous helper');
  last = i;
});

console.log('\n== Brief + translate controls ==');
['aiOffer', 'aiProof1', 'aiProof2', 'aiProof3', 'aiCta', 'aiVoice', 'aiOnePager', 'aiPhotoGrade', 'aiShuffleLook', 'aiComp1', 'aiComp2', 'aiComp3', 'aiLang', 'aiTranslateName', 'btnTranslate'].forEach((id) => {
  assert(app.indexOf('id="' + id + '"') !== -1 || app.indexOf("id='" + id + "'") !== -1 || app.indexOf('#' + id) !== -1, '#' + id + ' is wired');
});
assert(/aiName/.test(app) && /aiArea/.test(app) && /aiPrompt/.test(app), 'existing name/area/prompt stay');
assert(/Regenerate this section/.test(app), 'section editor can regenerate one section');
assert(/Studied/.test(app), 'result card can say Studied N sites');
assert(/Translations powered by/.test(app), 'translate control shows powered-by');
assert(/chatLastEdit|rememberEdit/.test(app), 'Copilot remembers the last edit');
assert(/Fix the weak CTA/.test(app), 'quality-gate chip for a weak CTA');
assert(/Add a map for/.test(app), 'quality-gate chip to add a map');
assert(/opts\.brief|brief:/.test(app) && /onePager/.test(app) && /photoGrade/.test(app), 'runAI passes brief, onePager and photoGrade');
assert(/ai-brief/.test(css) || /ai-proof/.test(css) || /brief-grid/.test(css), 'brief form has layout styles');

console.log('\n== Keys & services copy (no secrets in the client) ==');
assert(/Once a DeepL API key is set on the registry/.test(app), 'translate copy says DeepL starts after the registry key is set');
assert(/Until then, MyMemory runs with no key/.test(app), 'translate copy names MyMemory as the no-key fallback');
assert(/href="https:\/\/www\.deepl\.com\/pro-api"/.test(app), 'DeepL get-a-key link is present');
assert(!/id="(aiDeepl|setDeepl|deeplKey|DEEPL_API_KEY)"/.test(app), 'no DeepL key paste field in the client');
assert(/Keys &amp; services|Keys & services/.test(app), 'Settings has a Keys & services card');
assert(/Get a DeepL API key/.test(app) && /Get a Netlify token/.test(app) && /Create a Neocities site/.test(app) && /Get a Pixabay API key/.test(app), 'Settings lists get-key links for DeepL, Netlify, Neocities and Pixabay');
assert(/href="https:\/\/app\.netlify\.com\/user\/applications#personal-access-tokens"/.test(app), 'Netlify token link is a real URL');
assert(/Once that token is entered/.test(app), 'Netlify copy says publish works once the token is entered');
assert(/href="https:\/\/neocities\.org"/.test(app), 'Neocities signup is a real URL');
assert(/Once you sign in from Publish/.test(app) || /Once signed in/.test(app), 'Neocities copy says publish works once signed in');
assert(/Once your free API key is entered/.test(app) && /href="https:\/\/pixabay\.com\/api\/docs\/"/.test(app), 'Pixabay copy says search works once the key is entered');
assert(!/DEEPL_API_KEY/.test(app), 'app.js never names the DeepL secret');

if (failed) {
  console.error('\nai-studio-upgrade-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nai-studio-upgrade-smoke PASSED');
