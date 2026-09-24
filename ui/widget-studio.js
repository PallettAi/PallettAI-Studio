'use strict';
// ============================================================
// PallettAI Studio — Widget Studio view
// ------------------------------------------------------------
// The surface for the Dynamic Widget Engine. Three things, in the
// order a creator needs them:
//
//   1. PROMPT  — describe the lead-generation tool ("a roofing quote
//      estimator"). Compilation happens in the main process
//      (ipcRenderer 'widget:generate'), because a model call needs
//      Node; this file never talks to a model itself.
//   2. PREVIEW — the compiled component is run for real, in a
//      sandboxed iframe, by pushing it through the SAME injector the
//      export uses. A preview built by a second code path would be a
//      second thing to keep in sync, and the first place a bug hides.
//   3. ADD     — the widget is stored on the project and a `widget`
//      section is placed on the page. The section carries only the
//      placeholder; the builder injects the definition once before
//      </body>, so a widget reused across pages is one class.
//
// Electron-only by nature: without the preload bridge there is no
// compiler, so the view says so instead of pretending to work. The
// browser build can still LIST and PREVIEW widgets already stored in
// a project — the injector is loaded in both.
// ============================================================

(function () {
  'use strict';

  var app = null;
  var state = { prompt: '', busy: false, status: '', statusOk: true, draft: null, activeId: '' };

  var EXAMPLES = [
    'A roofing quote estimator with roof size, material and pitch, showing an indicative price range',
    'A 3-step mortgage calculator: deposit, term and rate, showing the monthly payment',
    'A solar savings calculator: roof area and annual electricity spend, showing estimated savings',
    'A moving-cost estimator: bedrooms, distance and whether packing is included'
  ];

  function $(sel, root) { return (root || document).querySelector(sel); }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  // ----------------------------------------------------------
  // The app contract. Everything privileged lives behind this, so the
  // view never reaches into app.js internals.
  // ----------------------------------------------------------
  function project() {
    try { return (app && app.currentProject) ? app.currentProject() : null; } catch (e) { return null; }
  }
  function notify(message, ok) {
    if (app && typeof app.notify === 'function') { try { app.notify(message, ok !== false); return; } catch (e) { /* silent */ } }
  }
  function storedWidgets() {
    var c = project();
    return (c && Array.isArray(c.widgets)) ? c.widgets : [];
  }
  /** The site's own palette, so a widget is born matching its client. */
  function siteTokens() {
    try { return (app && app.tokens) ? app.tokens() : null; } catch (e) { return null; }
  }
  function bridge() {
    var api = window.pallettaiAPI || window.pallettai;
    return (api && typeof api.generateWidget === 'function') ? api : null;
  }

  // ----------------------------------------------------------
  // Preview — the real component, mounted the real way
  // ----------------------------------------------------------
  function previewDoc(widget) {
    var skeleton = '<!doctype html><html lang="en"><head><meta charset="utf-8">'
      + '<title>' + esc(widget.title || widget.id) + '</title>'
      + '<style>html,body{margin:0}body{padding:18px;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f6f8fb;color:#111}</style>'
      + '</head><body><pallet-widget id="' + esc(widget.id) + '"></pallet-widget></body></html>';
    try {
      var Injector = window.WidgetInjector;
      if (Injector && typeof Injector.injectWidgetsIntoAST === 'function') {
        var registry = {};
        registry[widget.id] = widget.definition;
        var out = Injector.injectWidgetsIntoAST(skeleton, registry);
        if (out && out.ok && typeof out.html === 'string') return out.html;
      }
    } catch (e) { /* the skeleton below still explains itself */ }
    return skeleton;
  }

  // ----------------------------------------------------------
  // Rendering
  // ----------------------------------------------------------
  function shellHtml() {
    return ''
      + '<div class="ws-shell">'
      + '  <div class="ws-card ws-builder">'
      + '    <label class="ws-label" for="wsPrompt">What should this tool do?</label>'
      + '    <textarea id="wsPrompt" class="ws-input" rows="3" placeholder="e.g. A roofing quote estimator with roof size, material and pitch"></textarea>'
      + '    <div class="ws-examples" id="wsExamples"></div>'
      + '    <div class="ws-actions">'
      + '      <button class="btn primary" type="button" data-ws="generate" id="wsGenerate">Compile widget</button>'
      + '      <button class="btn ghost" type="button" data-ws="clear" id="wsClear">Clear</button>'
      + '      <span class="ws-status" id="wsStatus" role="status" aria-live="polite"></span>'
      + '    </div>'
      + '  </div>'
      + '  <div class="ws-card ws-preview">'
      + '    <div class="ws-preview-head"><strong id="wsPreviewTitle">Preview</strong>'
      + '      <small id="wsPreviewHint">Compile a widget to run it — this is the real component, not a mock-up.</small></div>'
      + '    <div class="ws-empty" id="wsPreviewEmpty">Nothing compiled yet.</div>'
      + '    <iframe id="wsPreview" class="ws-frame" sandbox="allow-scripts" title="Widget preview" hidden></iframe>'
      + '    <div class="ws-actions" id="wsPreviewActions" hidden>'
      + '      <button class="btn primary" type="button" data-ws="add" id="wsAdd">Add to project</button>'
      + '      <span class="ws-hint" id="wsAddHint"></span>'
      + '    </div>'
      + '  </div>'
      + '</div>'
      + '<div class="ws-library" id="wsLibrary"></div>';
  }

  function paintExamples() {
    var host = $('#wsExamples');
    if (!host) return;
    host.innerHTML = EXAMPLES.map(function (ex) {
      return '<button class="ws-chip" type="button" data-ws="example" data-example="' + esc(ex) + '">' + esc(ex.length > 62 ? ex.slice(0, 60) + '…' : ex) + '</button>';
    }).join('');
  }

  function setStatus(message, ok) {
    state.status = String(message || '');
    state.statusOk = ok !== false;
    var el = $('#wsStatus');
    if (!el) return;
    el.textContent = state.status;
    el.className = 'ws-status' + (state.status ? (state.statusOk ? ' is-ok' : ' is-bad') : '');
  }

  function paintPreview() {
    var frame = $('#wsPreview');
    var empty = $('#wsPreviewEmpty');
    var actions = $('#wsPreviewActions');
    var hint = $('#wsPreviewHint');
    var title = $('#wsPreviewTitle');
    if (!frame) return;
    if (!state.draft) {
      frame.hidden = true;
      frame.removeAttribute('srcdoc');
      if (empty) empty.hidden = false;
      if (actions) actions.hidden = true;
      if (title) title.textContent = 'Preview';
      if (hint) hint.textContent = 'Compile a widget to run it — this is the real component, not a mock-up.';
      return;
    }
    var draft = state.draft;
    if (title) title.textContent = draft.title || draft.id;
    frame.hidden = false;
    if (empty) empty.hidden = true;
    frame.srcdoc = previewDoc(draft);
    if (actions) actions.hidden = false;
    var already = storedWidgets().some(function (w) { return w && w.id === draft.id; });
    if (hint) hint.textContent = already ? 'Already in this project.' : 'This is what the export ships.';
    var add = $('#wsAdd');
    if (add) add.textContent = already ? 'Place on this page' : 'Add to project';
    if (draft.fallback && draft.warnings && draft.warnings.length) {
      setStatus('A fallback widget was compiled — ' + draft.warnings[0], false);
    }
  }

  function paintLibrary() {
    var host = $('#wsLibrary');
    if (!host) return;
    var list = storedWidgets();
    var c = project();
    if (!c) {
      host.innerHTML = '<h3 class="view-h">Your widgets</h3><p class="ws-empty-note">Open or create a project to keep widgets. You can still compile and preview them.</p>';
      return;
    }
    if (!list.length) {
      host.innerHTML = '<h3 class="view-h">Your widgets</h3><p class="ws-empty-note">No widgets yet. Compile one above and add it to <strong>' + esc(c.name || 'this project') + '</strong>.</p>';
      return;
    }
    host.innerHTML = '<h3 class="view-h">Your widgets <span class="pill">' + list.length + '</span></h3>'
      + '<div class="ws-grid">' + list.map(function (w) {
        var used = 0;
        var pages = (typeof Builder !== 'undefined' && Builder.pages) ? Builder.pages(c) : [];
        pages.forEach(function (pg) {
          (pg.sections || []).forEach(function (s) { if (s.type === 'widget' && String(s.extra || '') === w.id) used += 1; });
        });
        return '<article class="ws-item' + (w.id === state.activeId ? ' is-active' : '') + '" data-widget="' + esc(w.id) + '">'
          + '<div class="ws-item-head"><strong>' + esc(w.title || w.id) + '</strong>'
          + '<span class="ws-item-meta">' + (used ? 'on ' + used + ' page' + (used === 1 ? '' : 's') : 'not placed') + '</span></div>'
          + '<p class="ws-item-prompt">' + esc(w.prompt || '') + '</p>'
          + '<div class="ws-item-actions">'
          + '<button class="btn ghost small" type="button" data-ws="view" data-widget="' + esc(w.id) + '">Preview</button>'
          + '<button class="btn ghost small" type="button" data-ws="place" data-widget="' + esc(w.id) + '">Place on page</button>'
          + '<button class="btn ghost small" type="button" data-ws="remove" data-widget="' + esc(w.id) + '">Remove</button>'
          + '</div></article>';
      }).join('') + '</div>';
  }

  function paintAll() {
    var prompt = $('#wsPrompt');
    if (prompt && prompt.value !== state.prompt) prompt.value = state.prompt;
    var generate = $('#wsGenerate');
    if (generate) {
      generate.disabled = state.busy;
      generate.textContent = state.busy ? 'Compiling…' : 'Compile widget';
    }
    paintPreview();
    paintLibrary();
  }

  function render() {
    var root = $('#widgetStudioRoot');
    if (!root) return;
    if (!$('#wsPrompt', root)) {
      root.innerHTML = shellHtml();
      paintExamples();
    }
    // The compiled draft deliberately survives a trip to another view: a
    // creator who checks the Designer and comes back should not have to
    // recompile (and re-spend) the widget they were looking at.
    state.activeId = state.draft ? state.draft.id : '';
    setStatus('');
    paintAll();
  }

  // ----------------------------------------------------------
  // Actions
  // ----------------------------------------------------------
  function generate() {
    if (state.busy) return;
    var prompt = String(state.prompt || '').trim();
    if (!prompt) { setStatus('Describe the tool you need first.', false); var f = $('#wsPrompt'); if (f) f.focus(); return; }
    var api = bridge();
    if (!api) {
      setStatus('Compiling needs the desktop app — the widget engine runs in the main process.', false);
      return;
    }
    state.busy = true;
    setStatus('Compiling…');
    paintAll();
    Promise.resolve(api.generateWidget(prompt, siteTokens()))
      .then(function (result) {
        var res = result || {};
        if (!res.ok || !res.definition) {
          state.busy = false;
          setStatus(res.error || 'The widget could not be compiled.', false);
          paintAll();
          return;
        }
        state.busy = false;
        state.draft = {
          id: res.id,
          title: prompt.length > 64 ? prompt.slice(0, 61) + '\u2026' : prompt,
          prompt: prompt,
          definition: res.definition,
          fallback: !!res.fallback,
          warnings: Array.isArray(res.warnings) ? res.warnings : []
        };
        state.activeId = res.id;
        setStatus(res.fallback ? 'Compiled, but as a fallback — see the note below.' : 'Compiled from your palette — preview on the right.', !res.fallback);
        paintAll();
      })
      .catch(function (error) {
        state.busy = false;
        setStatus('The widget could not be compiled: ' + (error && error.message ? error.message : error), false);
        paintAll();
      });
  }

  function add() {
    var draft = state.draft;
    if (!draft) return;
    if (!app || typeof app.addWidget !== 'function') { notify('Adding widgets needs the desktop app.', false); return; }
    var result = app.addWidget(draft);
    if (result && result.ok === false) { setStatus(result.error || 'The widget could not be added.', false); return; }
    setStatus('Added — the widget section is on your page and ships with the export.', true);
    paintAll();
  }

  function viewStored(id) {
    var w = storedWidgets().filter(function (x) { return x && x.id === id; })[0];
    if (!w) return;
    state.draft = { id: w.id, title: w.title || w.id, prompt: w.prompt || '', definition: w.definition, fallback: false, warnings: [] };
    state.activeId = id;
    setStatus('Previewing “' + (w.title || w.id) + '”.', true);
    paintAll();
  }

  function place(id) {
    if (!app || typeof app.placeWidget !== 'function') { notify('Adding widgets needs the desktop app.', false); return; }
    var result = app.placeWidget(id);
    if (result && result.ok === false) { setStatus(result.error || 'The widget could not be placed.', false); return; }
    setStatus('Section added — find it in the Designer.', true);
    paintAll();
  }

  function remove(id) {
    if (!app || typeof app.removeWidget !== 'function') { notify('Removing widgets needs the desktop app.', false); return; }
    var result = app.removeWidget(id);
    if (result && result.ok === false) { setStatus(result.error || 'The widget could not be removed.', false); return; }
    if (state.draft && state.draft.id === id) { state.draft = null; state.activeId = ''; }
    setStatus('Widget removed. Any placeholder sections for it now show a note instead of the tool.', true);
    paintAll();
  }

  document.addEventListener('click', function (event) {
    var hit = event.target.closest ? event.target.closest('[data-ws]') : null;
    if (!hit) return;
    var action = hit.getAttribute('data-ws');
    if (action === 'generate') generate();
    else if (action === 'clear') { state.prompt = ''; var f = $('#wsPrompt'); if (f) f.value = ''; state.draft = null; state.activeId = ''; setStatus(''); paintAll(); }
    else if (action === 'example') { state.prompt = hit.getAttribute('data-example') || ''; var t = $('#wsPrompt'); if (t) { t.value = state.prompt; t.focus(); } }
    else if (action === 'add') add();
    else if (action === 'view') viewStored(hit.getAttribute('data-widget'));
    else if (action === 'place') place(hit.getAttribute('data-widget'));
    else if (action === 'remove') remove(hit.getAttribute('data-widget'));
  });

  document.addEventListener('input', function (event) {
    if (event.target && event.target.id === 'wsPrompt') state.prompt = event.target.value;
  });

  // Ctrl/⌘+Enter compiles without leaving the keyboard.
  document.addEventListener('keydown', function (event) {
    if (!event.target || event.target.id !== 'wsPrompt') return;
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); generate(); }
  });

  window.PallettAIWidgetStudio = {
    /** app.js installs the project/persistence callbacks here. */
    connect: function (api) { app = api || null; return !!app; },
    open: render,
    /** Test hooks — the preview and the state, without a DOM harness. */
    previewDoc: previewDoc,
    state: state,
    examples: EXAMPLES
  };
})();
