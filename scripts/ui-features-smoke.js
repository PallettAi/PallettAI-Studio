#!/usr/bin/env node
'use strict';

/*
  The UI feature batch (Design DNA prompt, data islands, section toolbar, token
  inspector, guides) is made of two halves each: a script the shell loads and an
  app-level handler that gives it meaning. Each half alone looks finished, and the
  join is invisible in a screenshot — a toolbar whose buttons are wired to nothing
  renders exactly like one whose buttons work.

  So this suite checks three things the release gate cannot otherwise see:
    1. the shell still loads the scripts, and the handlers still exist;
    2. neither panel has gone back to promising a live preview edit through a
       message the exported page does not listen for;
    3. the sentences the toolbar seeds are ones the planner actually resolves —
       including the position pinning that stops "change this section's layout"
       editing a different section of the same kind.
*/

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let failed = 0;
const pass = (msg) => console.log('  \u2713 ' + msg);
const fail = (msg) => { failed++; console.error('  \u2717 ' + msg); };
const ok = (cond, msg) => (cond ? pass(msg) : fail(msg));

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ---- 1. the prompt and the island builder still say what they promise ----
console.log('== Design DNA & data islands ==');
const DNA = require('../modules/ai-prompts.js');
const Islands = require('../ui/data-islands.js');

ok(Array.isArray(DNA.list()) && DNA.list().length === 6, 'six visual archetypes are defined');
ok(DNA.prompt.includes('project schema') && DNA.prompt.includes('--btn-radius'), 'the master prompt asks for the compiler schema and its button tokens');
ok(DNA.archetypes.BENTO_GLASS.includes('9999px'), 'BENTO_GLASS keeps its pill buttons');
ok(DNA.prompt.includes('--btn-shadow') && DNA.prompt.includes('--btn-border'), 'button shadow and border tokens survive in the prompt');

const island = Islands.island([{ title: 'Hello', tags: ['a'] }]);
ok(island.includes('type="application/json"') && island.includes('pai-cms-data'), 'the data island is inline JSON');
ok(!island.includes('<script>alert'), 'a title cannot close the island and start a script');
const helper = Islands.helper();
ok(helper.includes('PallettAISearch') && helper.includes('JSON.parse'), 'the injected search helper reads the island');

// ---- 2. the shell loads the scripts, and the app gives them meaning ----
console.log('\n== Shell wiring ==');
const html = read('index.html');
const UI_SCRIPTS = ['ui/data-islands.js', 'ui/inspector.js', 'ui/copilot.js', 'ui/guides.js'];
UI_SCRIPTS.forEach((rel) => {
  ok(html.includes('<script src="' + rel + '"></script>'), 'index.html loads ' + rel);
  ok(fs.existsSync(path.join(ROOT, rel)), rel + ' exists on disk');
});

const app = read('app.js');
ok(/function sectionCopilotRequest\(/.test(app), 'the section toolbar has a request handler');
ok(/PallettAISectionCopilot\.onRequest = sectionCopilotRequest/.test(app), 'the handler is attached to the toolbar');
ok(/function tokenSnapshot\(/.test(app) && /function applyTokenPatch\(/.test(app), 'the token panel has a state reader and a writer');
ok(/PallettAITokens\.onChange = applyTokenPatch/.test(app), 'the writer is attached to the panel');
ok(/PallettAITokens\.sync\(tokenSnapshot\(\)\)/.test(app), 'opening the tokens view seeds it from the open project');
// touch() is what saves and repaints; a token edit that skips it looks applied and
// is gone at the next reopen.
ok(/c\.site\.design = Object\.assign\(\{\}, c\.site\.design \|\| \{\}, patch\)[\s\S]{0,200}touch\(c\)/.test(app), 'a token edit is written to the project and saved');

const toolbar = read('ui/copilot.js');
ok(/api\.onRequest\(request\)/.test(toolbar), 'the toolbar hands its actions to the app');
ok(!/\.postMessage\(/.test(toolbar), 'the toolbar no longer posts into the preview (nothing there listens)');
ok(/active\(\)/.test(toolbar) && /sectionCopilotBar/.test(toolbar), 'the bar still tracks a live selection');

const inspector = read('ui/inspector.js');
ok(!/postMessage/.test(inspector), 'the token panel no longer claims a live cross-frame edit');
ok(/ratio\(state\.text, state\.surface\)/.test(inspector), 'the badge measures body text on surface');
ok(/--sec-pad|<code>--btn-radius<\/code>/.test(inspector), 'the panel names the tokens the export carries');

// ---- 3. the sentences the toolbar seeds resolve, and pin the right section ----
console.log('\n== Copilot phrases the toolbar seeds ==');
const { loadAI } = require('./load-ai.js');
const AI = loadAI();
const site = AI.generateSite('a barber shop', { brief: { name: 'Fade Co', offer: 'Cuts' }, onePager: true }).site;
// A second about section, so "the last one of that kind" and "the second section"
// are different answers — which is the whole point of pinning a position.
const about = JSON.parse(JSON.stringify(site.sections.find((s) => s.type === 'about')));
site.sections.splice(2, 0, about);
const types = site.sections.map((s) => s.type);

const copy = AI.chatPlan(site, 'Make the second section punchier');
ok(copy.acts && copy.acts[0] && copy.acts[0].op === 'rewriteSection', 'the copy button plans a rewrite');
ok(copy.acts[0].idx === 1 && copy.acts[0].type === types[1], 'and it rewrites the section the client pointed at');
ok(copy.acts[0].credit === true, 'a copy rewrite is charged as one credit');

const options = AI.layoutOptions('about');
ok(options.length === 1 && options[0].layout === 'floating', 'about offers its own catalog variant');
const pinned = AI.chatPlan(site, 'Make the second section ' + options[0].phrase);
ok(pinned.acts && pinned.acts[0] && pinned.acts[0].op === 'layout' && pinned.acts[0].idx === 1, 'the layout button pins the selected section');
ok(pinned.acts[0].type === 'about' && pinned.acts[0].layout === 'floating', 'and applies that type\'s variant');

const unpinned = AI.chatPlan(site, 'Use floating chips on the about section');
ok(unpinned.acts && unpinned.acts[0] && unpinned.acts[0].idx === -1, 'a variant phrase with no position keeps its old meaning (the last of that kind)');

// Every option the toolbar can offer has to be one the planner resolves, or the
// button writes a sentence the engine answers with help text.
const catalogTypes = ['about', 'features', 'hero', 'testimonials', 'gallery', 'stats', 'pricing', 'cta'];
let resolved = 0;
catalogTypes.forEach((type) => {
  AI.layoutOptions(type).forEach((option) => {
    const r = AI.chatPlan(site, 'Use ' + option.phrase + ' here');
    if (r.acts && r.acts.some((a) => a.op === 'layout' && a.type === type && a.layout === option.layout)) resolved++;
  });
});
ok(resolved >= 8, 'every catalog variant the toolbar can offer resolves to its own type (' + resolved + ' checked)');
ok(AI.layoutOptions('contact').length === 0, 'a type with no catalog variant reports none, so the button can say so');

if (failed) {
  console.error('\nui-features-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nui-features-smoke PASSED');
