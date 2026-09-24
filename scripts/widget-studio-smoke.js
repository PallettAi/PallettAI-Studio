'use strict';

/*
  The real-app Widget Studio smoke.

  Every other widget suite runs in Node, and Node is not the runtime this
  feature ships in. The claim being made to the creator — "prompt for a tool,
  see it running, add it to the project, and it ships in the export" — crosses
  four boundaries Node cannot see: the preload bridge into the main process, the
  compiler there, the sandboxed preview frame, and the custom element mounting
  inside a shadow root on the exported page. Any one of them can be broken while
  every Node suite stays green.

  So this suite boots the actual application and does what a creator does: it
  generates a project, opens the Widget Studio, compiles a wording, previews it,
  adds it, goes and looks at what the Designer will export, and then REMOVES it
  to check the page explains itself instead of showing a hole.

  The model's answer is fixed (see widget-studio-hook.js) so the run is
  hermetic. Everything after the answer is real: the same compiler, sanitiser,
  injector, export settings and browser.

  It is deliberately narrow. One flagship path, driven for real, beats a broad
  suite that mocks the runtime that keeps breaking.
*/

const path = require('path');
const fs = require('fs');
const { launchRealApp, parseResult, ROOT } = require('./smoke-launcher.js');

const HOOK = path.join(__dirname, 'widget-studio-hook.js');
const PAGE = path.join(__dirname, 'widget-studio-page.js');
const FIXTURE = require('./fixtures/widget-model-reply.js');

let passed = 0;
const failures = [];

function ok(name, condition, detail) {
  if (condition) { passed++; console.log('  ✓ ' + name); }
  else { failures.push(name + (detail ? ' — ' + detail : '')); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
function eq(name, actual, expected) {
  const same = actual === expected;
  ok(name, same, same ? '' : 'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}
function contains(name, haystack, needle) {
  ok(name, String(haystack || '').indexOf(needle) !== -1, 'missing ' + JSON.stringify(needle));
}
function section(title) { console.log('\n== ' + title + ' =='); }
function describeMount(m) {
  const mount = m || {};
  return 'found=' + mount.found + ' shadow=' + mount.shadow + ' body='
    + JSON.stringify(String(mount.bodyText || '').slice(0, 140));
}

/*
  A receipt, so "the smoke ran" is a fact rather than an assumption.

  A gate that passes because it silently tested nothing is worse than no gate:
  it manufactures confidence. This suite can only be believed if it proves it
  booted the app and drove the panel, so the receipt records that and the
  release check treats its absence as a failure.
*/
const RECEIPT = path.join(ROOT, '.widget-studio-receipt.json');
function writeReceipt(payload) {
  try { fs.writeFileSync(RECEIPT, JSON.stringify(payload, null, 2) + '\n'); } catch (e) { /* best effort */ }
}

(async () => {
  console.log('== Real-app widget smoke (boots Electron, drives the Widget Studio) ==\n');

  const { out, timedOut, error } = await launchRealApp({
    hook: HOOK,
    page: PAGE,
    entryName: '.widget-studio-entry.js',
    timeoutMs: 180000
  });

  if (error) {
    console.log('  ✗ ' + error);
    writeReceipt({ ran: false, passed: 0, failed: 1, reason: error });
    console.log('\nwidget-studio-smoke FAILED: the real app could not be launched');
    process.exit(1);
  }
  if (timedOut) {
    console.log('\n  ✗ the app did not finish within 180s — it hung or the renderer never painted');
    failures.push('widget studio smoke timed out');
  }

  const r = parseResult(out);
  if (!r) {
    console.log('\n  ✗ the app produced no result block — it almost certainly crashed on load');
    console.log('    (this is itself a release blocker: the app must boot)');
    writeReceipt({ ran: false, passed: 0, failed: 1, reason: 'no result block' });
    console.log('\nwidget-studio-smoke FAILED: the real app did not boot cleanly');
    process.exit(1);
  }

  section('the app, the project and the panel');
  eq('the app boots and the driver reaches the end', r.driverRan === true && r.booted === true, true);
  eq('the AI view is there to make a project with', r.formFound === true, true);
  eq('a project is generated to hang the widget on', r.generated === true, true);
  eq('the Widget Studio module is loaded', r.studioLoaded === true, true);
  eq('the preload bridge exposes generateWidget', r.bridgeHasGenerateWidget === true, true);
  eq('the Widget Studio opens from the nav', r.viewOpened === true, true);
  eq('compiling is offered', r.generateOffered === true, true);

  section('the model seam (main process)');
  const asks = Array.isArray(r.asks) ? r.asks : [];
  eq('the model was asked exactly once', asks.length, 1);
  const ask = asks[0] || {};
  eq('it was asked with the creator\'s own prompt', ask.prompt, r.widgetPrompt);
  eq('it was given the widget contract as the system prompt', ask.systemIsWidgetContract === true, true);

  section('compiling');
  eq('the widget compiled', r.compiled === true, true);
  eq('it arrived with the id the model chose', r.draftId, FIXTURE.id);
  eq('it did not fall back to the unavailable card', r.draftFallback === false, true);
  eq('the definition carries the shared engine', r.definitionHasEngine === true, true);
  eq('the definition carries the config block', r.definitionHasConfig === true, true);
  eq('the element class is defined exactly once', r.definitionClassCount, 1);
  eq('it was painted from the project\'s palette, not the neutral default', r.definitionUsesProjectPalette === true, true);
  eq('the project\'s palette was in the system prompt too', ask.systemPrimary, r.definitionPrimary);
  eq('compiling spent no credit', r.compileSpentCredit, 0);
  contains('the panel said what happened', r.statusAfterCompile, 'Compiled');

  section('the live preview');
  ok('the panel previews the widget', r.previewRendered === true, r.previewBytes + ' bytes');
  eq('the preview holds the placeholder', r.previewHasPlaceholder === true, true);
  eq('the preview carries the definition', r.previewHasConfig === true, true);
  eq('the preview carries the engine exactly once', r.previewEngineCount, 1);
  eq('the preview runs the widget\'s own markup', r.previewHasWidgetMarkup === true, true);
  eq('and the widget\'s own stylesheet', r.previewHasWidgetCss === true, true);

  section('adding it to the project');
  eq('"Add to project" is offered', r.addOffered === true, true);
  eq('the widget is stored on the project', r.libraryHasWidget === true, true);
  contains('it was placed on the page', r.libraryMeta, 'on 1 page');
  contains('and the button now offers the other action', r.addButtonLabel, 'Place on this page');
  ok('adding spent no credit either',
    r.creditsAfterAdd && r.creditsAfterCompile && r.creditsAfterAdd.left === r.creditsAfterCompile.left,
    'compile: ' + JSON.stringify(r.creditsAfterCompile) + ' add: ' + JSON.stringify(r.creditsAfterAdd));

  section('the export (what the Designer will ship)');
  ok('the Designer renders the project with the widget on it',
    r.exportBytes > 500 && r.exportHasPlaceholder === true, r.exportBytes + ' bytes');
  eq('the export contains the placeholder exactly once', r.exportPlaceholderCount, 1);
  eq('with one definition block', r.exportConfigCount, 1);
  eq('one engine for the page', r.exportEngineCount, 1);
  eq('and one class definition shared by it', r.exportClassCount, 1);
  eq('the export ships the widget\'s markup', r.exportHasWidgetMarkup === true, true);
  eq('and its stylesheet', r.exportHasWidgetCss === true, true);

  section('the exported page, in a real browser');
  const mount = r.mount || null;
  if (!mount) {
    ok('the exported page could be opened', false, 'no browser probe ran');
  } else {
    const csp = (mount.consoleErrors || []).filter((m) => /Refused|Content Security Policy/i.test(m));
    eq('no policy refused the widget\'s script', csp.length, 0);
    eq('the placeholder is in the page', mount.found === true, true);
    eq('the custom element is defined', mount.elementDefined === true, true);
    eq('the product spelling is registered as well', mount.aliasDefined === true, true);
    eq('the widget rendered into a shadow root', mount.shadow === true, true);
    eq('its markup is inside that shadow root', mount.rootRendered === true && mount.widgetMarkup === true, true);
    eq('every control rendered', (mount.controls || []).join(',') === 'true,true,true', true);
    eq('no fallback card was shown', mount.fallback === false, true);
    eq('the site\'s palette reached the widget in the browser', mount.tokenPrimary, r.definitionPrimary);
    ok('the page\'s styles were applied to the widget',
      /rgb|oklch|#/.test(String(mount.buttonBackground || '')),
      'button background: ' + JSON.stringify(mount.buttonBackground));
    ok('the widget is visible on the page', mount.visible === true, describeMount(mount));
    eq('exactly one definition block in the page', mount.configScripts, 1);
    eq('exactly one engine in the page', mount.engineScripts, 1);

    // The claim a creator actually cares about: a visitor can use it.
    eq('a visitor can set the fields', mount.probeSet === true, true);
    eq('and press the tool\'s own button', mount.pressed === true, true);
    ok('the number it shows changes', mount.changed === true,
      JSON.stringify(mount.before) + ' -> ' + JSON.stringify(mount.after));
    ok('it quotes a price range', mount.showsMoney === true, JSON.stringify(mount.after));
  }

  section('removing it again');
  eq('removing is offered', r.removeOffered === true, true);
  eq('the widget leaves the project', r.libraryEmptyAfterRemove === true, true);
  eq('the export stops carrying the engine', r.afterRemoveEngineCount, 0);
  eq('the export stops shipping a placeholder', r.afterRemoveHasPlaceholder === false, true);
  eq('and explains itself instead of leaving a hole', r.afterRemoveExplains === true, true);
  const after = r.afterRemove || null;
  if (after) {
    eq('the page in the browser has no widget element', after.found === false, true);
    eq('and reads as a note', after.bodyHasNote === true, true);
    ok('the note is real text on the page, not just markup',
      after.bodyHasNote === true, describeMount(after));
  }

  section('the run itself');
  ok('the app logged no errors on the widget path',
    (r.consoleErrors || []).length === 0,
    (r.consoleErrors || [])[0] || '');
  ok('every stage actually ran',
    r.generated === true && r.compiled === true && r.libraryHasWidget === true && !!mount && r.removeOffered === true,
    'a stage was skipped, so a pass would be hollow');

  console.log('');
  if (failures.length) {
    console.log('widget-studio-smoke FAILED: ' + failures.length + ' check(s) did not hold');
    failures.forEach((f) => console.log('  · ' + f));
    writeReceipt({ ran: r.driverRan === true, passed, failed: failures.length, failures });
    process.exit(1);
  }

  writeReceipt({
    ran: true,
    passed,
    failed: 0,
    widgetId: r.draftId || '',
    exportBytes: r.exportBytes || 0,
    previewBytes: r.previewBytes || 0,
    mounted: !!(r.mount && r.mount.rootRendered),
    quoted: !!(r.mount && r.mount.showsMoney)
  });
  console.log('widget-studio-smoke PASSED: ' + passed + ' checks against the real app');
})().catch((e) => {
  // Without this the async body rejects silently and Node exits 0, which is the
  // worst possible outcome for a gate: green, having tested nothing.
  console.log('widget-studio-smoke FAILED: the harness itself threw');
  console.log('  ' + ((e && e.stack) || String(e)));
  writeReceipt({ ran: false, passed: 0, failed: 1, reason: String((e && e.message) || e) });
  process.exit(1);
});
