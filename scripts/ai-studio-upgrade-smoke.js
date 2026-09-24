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
const order = ['data/ai-brief.js', 'data/ai-followup.js', 'data/ai-translate.js', 'data/ai-niches-extra.js', 'data/ai-fingerprint.js', 'data/ai-photos.js', 'data/ai-compose.js', 'data/ai-kernel.js', 'data/ai-critique.js', 'modules/ai.js'];
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
assert(/poweredByLabel\(/.test(app) && /Translation included in your plan/.test(app), 'translate control names the real provider, and says translation is included by default');
assert(/chatLastEdit|rememberEdit/.test(app), 'Copilot remembers the last edit');
assert(/Fix the weak CTA/.test(app), 'quality-gate chip for a weak CTA');
assert(/Add a map for/.test(app), 'quality-gate chip to add a map');
assert(/opts\.brief|brief:/.test(app) && /onePager/.test(app) && /photoGrade/.test(app), 'runAI passes brief, onePager and photoGrade');
assert(/id="aiMore"/.test(app), 'brief lives behind More details');
assert(/photoDropOverlay/.test(app), 'preview has a photo drop overlay');
assert(/seImageFileBtn/.test(app), 'section editor can replace a photo from disk');
assert(!/openPicker:\s*photoMode === 'real'/.test(app), 'generate does not auto-open the picker');
assert(/includedInGenerate/.test(app), 'generate bundles the photo pass');
assert(/photo-drop-overlay/.test(css), 'photo drop overlay styles exist');

console.log('\n== Keys & services copy (included, and no secrets in the client) ==');
assert(/Translation is included/.test(app), 'translate copy says translation is included in the plan');
assert(/MyMemory, which is free and keyless/.test(app), 'translate copy names the keyless fallback');
assert(!/deepl\.com\/pro-api/.test(app), 'the DeepL get-a-key link is gone — that key is ours to hold');
assert(!/id="(aiDeepl|setDeepl|deeplKey|DEEPL_API_KEY)"/.test(app), 'no DeepL key paste field in the client');
assert(/What(?:'|&#39;)s included/.test(app), 'Settings has a What’s included card');
assert(/There is nothing to sign up for and no AI key to enter/.test(app), 'Settings states no AI key is needed');
assert(/AI generation, copy, photos, alt text, logos, vision QA/.test(app), 'Settings names the AI features that are included');
assert(/Netlify tokens/.test(app) && /href="https:\/\/app\.netlify\.com\/user\/applications#personal-access-tokens"/.test(app), 'Netlify link is a real URL, framed as optional');
assert(/href="https:\/\/neocities\.org"/.test(app), 'Neocities signup is a real URL');
assert(/Netlify publish <span class="muted">\(optional\)<\/span>/.test(app) && /Neocities publish <span class="muted">\(optional\)<\/span>/.test(app), 'publish destinations are marked optional');
assert(/Pixabay API key <span class="muted">\(optional\)<\/span>/.test(app) && /href="https:\/\/pixabay\.com\/api\/docs\/"/.test(app), 'Pixabay key is optional and the link is real');
assert(/Companies House API key <span class="muted">\(optional\)<\/span>/.test(app), 'Companies House key is optional');
assert(/keyless|without a key/i.test(app), 'the UI still names a keyless path for users without any keys');
assert(!/DEEPL_API_KEY/.test(app), 'app.js never names the DeepL secret');

if (failed) {
  console.error('\nai-studio-upgrade-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nai-studio-upgrade-smoke PASSED');
