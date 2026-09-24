/*
  The in-page half of the real-app widget smoke.

  This code runs INSIDE the Studio renderer. It is a separate file rather than
  an inline template literal so it can use backticks and ${} freely — nesting
  them inside a template in the main process produced a syntax error that was
  invisible until the app refused to boot.

  It touches only what a user would touch: the AI view to get a project, the
  Widget Studio to compile one, and the Designer's own preview to see what the
  export will ship. Nothing is stubbed here. The model's answer is fixed in the
  main process (see widget-studio-hook.js); everything after the answer — the
  compiler, the sanitiser, the injector, the preview — is the real thing.
*/
(async () => {
  const out = { booted: false, bootError: '', consoleErrors: [] };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const errors = [];
  const origError = console.error;
  console.error = function () {
    const parts = [];
    for (const a of arguments) {
      try { parts.push(a && a.stack ? a.stack : String(a)); } catch (e) { parts.push('[unserialisable]'); }
    }
    errors.push(parts.join(' | '));
    return origError.apply(console, arguments);
  };

  const until = async (test, attempts, every) => {
    for (let i = 0; i < attempts; i++) {
      let v = null;
      try { v = test(); } catch (e) { v = null; }
      if (v) return v;
      await sleep(every || 200);
    }
    return null;
  };
  const countOf = (text, needle) => String(text || '').split(needle).length - 1;
  const credits = () => { try { return PLANS.store.creditsLeft(); } catch (e) { return null; } };

  // App is a top-level `const` in app.js, so it is NOT a window property.
  // Referring to the bare identifier is the correct check; window.App would
  // report a perfectly healthy app as broken.
  out.booted = (typeof App !== 'undefined' && typeof App.go === 'function');
  out.bootError = out.booted ? '' : 'App is not initialised — the shell did not start';
  if (!out.booted) { console.error = origError; return out; }

  /* ---------------------------------------------------------------
     1. A project to hang the widget on.

     The widget is stored on a project, so the suite needs one. The AI
     view is the app's own way to make one, and photos are switched off
     so the run does not depend on a CDN being reachable.
     --------------------------------------------------------------- */
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    if (document.querySelector('#aiRoot') && document.querySelector('#aiRun')) break;
  }
  await sleep(400);

  App.go('ai');
  await sleep(500);

  const promptBox = document.querySelector('#aiPrompt');
  const runBtn = document.querySelector('#aiRun');
  out.formFound = !!(promptBox && runBtn);
  if (!out.formFound) { console.error = origError; return out; }

  const photo = document.querySelector('#aiPhoto');
  if (photo) photo.value = 'none';
  const grade = document.querySelector('#aiPhotoGrade');
  if (grade) grade.checked = false;

  promptBox.value = 'a family run roofing company in Leeds';
  const beforeGenerate = errors.length;
  runBtn.click();

  const designer = await until(() => {
    const v = document.querySelector('.view.active');
    return (v && v.id === 'view-designer') ? v : null;
  }, 240, 250);
  out.generated = !!designer;
  out.generatedError = out.generated ? '' : 'the AI view never handed over to the Designer';
  out.generateConsoleError = errors.slice(beforeGenerate)[0] || '';
  if (!out.generated) { console.error = origError; return out; }

  out.creditsAfterGenerate = credits();

  /* ---------------------------------------------------------------
     2. The Widget Studio itself.
     --------------------------------------------------------------- */
  const Studio = window.PallettAIWidgetStudio;
  out.studioLoaded = !!(Studio && typeof Studio.open === 'function' && Studio.state);
  const bridge = window.pallettaiAPI || window.pallettai;
  out.bridgeHasGenerateWidget = !!(bridge && typeof bridge.generateWidget === 'function');
  if (!out.studioLoaded) { console.error = origError; return out; }

  // The view a creator reaches by clicking the nav item.
  App.go('widgets');
  const promptField = await until(() => document.querySelector('#wsPrompt'), 40, 150);
  out.viewOpened = !!promptField;
  out.viewError = out.viewOpened ? '' : 'the Widget Studio view did not render';
  if (!out.viewOpened) { console.error = origError; return out; }

  const WIDGET_PROMPT = 'A roofing quote estimator with roof size, material and pitch';
  // Handed back so the harness can compare it with what the main process was
  // actually asked, rather than restating the wording in two files.
  out.widgetPrompt = WIDGET_PROMPT;
  promptField.value = WIDGET_PROMPT;
  promptField.dispatchEvent(new Event('input', { bubbles: true }));

  const beforeCompile = errors.length;
  const creditsBeforeCompile = credits();
  const generateBtn = document.querySelector('#wsGenerate');
  out.generateOffered = !!generateBtn;
  if (generateBtn) generateBtn.click();

  const draft = await until(() => (Studio.state.draft ? Studio.state.draft : null), 200, 150);
  out.compiled = !!draft;
  out.compileError = out.compiled
    ? ''
    : ((document.querySelector('#wsStatus') || {}).textContent || 'no draft and no status');
  out.compileConsoleError = errors.slice(beforeCompile)[0] || '';
  out.creditsAfterCompile = credits();
  out.compileSpentCredit = (creditsBeforeCompile != null && out.creditsAfterCompile != null)
    ? (creditsBeforeCompile.left - out.creditsAfterCompile.left)
    : -1;
  if (!out.compiled) { console.error = origError; return out; }

  const definition = String(draft.definition || '');
  out.draftId = String(draft.id || '');
  out.draftFallback = !!draft.fallback;
  out.draftWarnings = (draft.warnings || []).slice(0, 3);
  out.statusAfterCompile = (document.querySelector('#wsStatus') || {}).textContent || '';
  out.definitionBytes = definition.length;
  out.definitionHasEngine = definition.indexOf('pallett-engine') !== -1;
  out.definitionHasConfig = definition.indexOf('pallett-config') !== -1;
  out.definitionClassCount = countOf(definition, 'class PallettWidget extends HTMLElement');
  // Painted from the project's palette rather than the neutral default the
  // generator falls back to when it is given nothing: the panel builds its
  // tokens from the project, and the proof is that the primary colour is not
  // the built-in one.
  const primary = (definition.match(/--color-primary:([^;}]+)/) || [])[1] || '';
  const neutralPrimary = (() => {
    try { return WidgetGenerator.resolveColorTokens(null).vars['--color-primary']; } catch (e) { return ''; }
  })();
  out.definitionPrimary = primary;
  out.definitionUsesProjectPalette = !!primary && !!neutralPrimary && primary !== neutralPrimary;

  /* ---------------------------------------------------------------
     3. The live preview — the real component, in a sandboxed frame.
     --------------------------------------------------------------- */
  const preview = await until(() => {
    const f = document.querySelector('#wsPreview');
    const doc = f && f.getAttribute('srcdoc');
    return (doc && doc.length > 500) ? doc : null;
  }, 60, 200);
  out.previewBytes = preview ? preview.length : 0;
  out.previewRendered = !!preview;
  if (preview) {
    out.previewHasPlaceholder = preview.indexOf('<pallet-widget id="' + out.draftId + '"') !== -1;
    out.previewHasConfig = preview.indexOf('data-pallett-widget="' + out.draftId + '"') !== -1;
    out.previewHasEngine = preview.indexOf('data-pallett-widget-runtime') !== -1;
    out.previewHasWidgetMarkup = preview.indexOf('data-pallett-go') !== -1;
    out.previewHasWidgetCss = preview.indexOf('rq-card') !== -1;
    out.previewEngineCount = countOf(preview, 'data-pallett-widget-runtime');
  }

  /* ---------------------------------------------------------------
     4. Adding it to the project — what makes it ship.
     --------------------------------------------------------------- */
  const beforeAdd = errors.length;
  const addBtn = document.querySelector('#wsAdd');
  out.addOffered = !!addBtn && !document.querySelector('#wsPreviewActions').hidden;
  if (addBtn) addBtn.click();
  await sleep(400);

  const item = await until(() => document.querySelector('.ws-item[data-widget="' + out.draftId + '"]'), 40, 150);
  out.libraryHasWidget = !!item;
  out.libraryMeta = item ? (item.querySelector('.ws-item-meta') || {}).textContent || '' : '';
  out.addButtonLabel = (document.querySelector('#wsAdd') || {}).textContent || '';
  out.addConsoleError = errors.slice(beforeAdd)[0] || '';
  out.creditsAfterAdd = credits();

  /* ---------------------------------------------------------------
     5. The export. The Designer's preview frame is built by the same
        function the export uses (Builder.buildSiteHTML with the real
        export settings), so it is the honest artifact to measure —
        and it is what the creator actually looks at.
     --------------------------------------------------------------- */
  App.go('designer');
  const exported = await until(() => {
    const f = document.querySelector('#previewFrame');
    const doc = f && f.getAttribute('srcdoc');
    return (doc && doc.length > 500 && doc.indexOf('pallet-widget') !== -1) ? doc : null;
  }, 100, 200);
  out.exportBytes = exported ? exported.length : 0;
  if (exported) {
    out.exportHasPlaceholder = exported.indexOf('<pallet-widget id="' + out.draftId + '"') !== -1;
    out.exportPlaceholderCount = countOf(exported, '<pallet-widget id="' + out.draftId + '"');
    out.exportConfigCount = countOf(exported, 'data-pallett-widget="' + out.draftId + '"');
    out.exportEngineCount = countOf(exported, 'data-pallett-widget-runtime');
    out.exportClassCount = countOf(exported, 'class PallettWidget extends HTMLElement');
    out.exportHasWidgetMarkup = exported.indexOf('data-pallett-go') !== -1;
    out.exportHasWidgetCss = exported.indexOf('rq-card') !== -1;
    out.exportHtml = exported;
  }

  /* ---------------------------------------------------------------
     6. Removing it again. A widget that is no longer in the project
        must not leave a hole in the client's page.
     --------------------------------------------------------------- */
  App.go('widgets');
  const removeHost = await until(() => document.querySelector('#wsLibrary .ws-item[data-widget="' + out.draftId + '"]'), 40, 150);
  const removeBtn = removeHost ? removeHost.querySelector('[data-ws="remove"]') : null;
  out.removeOffered = !!removeBtn;
  if (removeBtn) {
    const beforeRemove = errors.length;
    removeBtn.click();
    await sleep(400);
    out.removeConsoleError = errors.slice(beforeRemove)[0] || '';
    out.libraryEmptyAfterRemove = !document.querySelector('.ws-item[data-widget="' + out.draftId + '"]');
  }

  App.go('designer');
  const afterRemove = await until(() => {
    const f = document.querySelector('#previewFrame');
    const doc = f && f.getAttribute('srcdoc');
    return (doc && doc.length > 500 && doc.indexOf('pallet-widget') === -1) ? doc : null;
  }, 100, 200);
  if (afterRemove) {
    out.afterRemoveHasPlaceholder = afterRemove.indexOf('<pallet-widget') !== -1;
    out.afterRemoveEngineCount = countOf(afterRemove, 'data-pallett-widget-runtime');
    out.afterRemoveExplains = afterRemove.indexOf('no longer in the project') !== -1;
    out.afterRemoveHtml = afterRemove;
  }

  out.activeView = (document.querySelector('.view.active') || {}).id || '';
  out.consoleErrors = errors.slice(0, 5);
  console.error = origError;
  return out;
})()
