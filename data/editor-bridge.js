/* PallettAI Studio — unified visual editor bridge
   GrapesJS is the editing surface; VvvebJS supplies a compatible component
   vocabulary. Neither library is allowed to own the project model or export path. */
(function (root) {
  'use strict';

  var active = null;
  var MAX_SNAPSHOT = 900000;
  var esc = function (value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c];
    });
  };
  var safeText = function (value, fallback) {
    var s = String(value == null ? '' : value).replace(/[\r\n]+/g, ' ').trim();
    return (s || fallback || '').slice(0, 140);
  };

  function bodyFromHtml(html) {
    var source = String(html || '');
    var match = source.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    return match ? match[1] : source;
  }
  function styleFromHtml(html) {
    var match = String(html || '').match(/<style[^>]*>([\s\S]*?)<\/style>/ig) || [];
    return match.map(function (tag) { return tag.replace(/^<style[^>]*>/i, '').replace(/<\/style>$/i, ''); }).join('\n');
  }
  function snapshot(editor, source) {
    if (!editor) return null;
    var html = '', css = '';
    try { html = editor.getHtml({ cleanId: true }); } catch (e) {}
    try { css = editor.getCss({ avoidProtected: false }); } catch (e) {}
    var data = { version: 1, source: source || 'grapesjs', html: String(html || ''), css: String(css || ''), savedAt: Date.now() };
    return JSON.stringify(data).length <= MAX_SNAPSHOT ? data : null;
  }
  function currentExport(project) {
    try {
      if (root.Builder && root.Builder.buildSiteHTML) return root.Builder.buildSiteHTML(project, { preview: true });
    } catch (e) {}
    return '<main><h1>' + esc((project && project.site && project.site.name) || 'Your site') + '</h1></main>';
  }
  function destroy() {
    if (active && active.editor && active.editor.destroy) {
      try { active.editor.destroy(); } catch (e) {}
    }
    active = null;
    var rootEl = document.getElementById('grapesCanvas');
    if (rootEl) rootEl.innerHTML = '';
  }
  function catalog() {
    var names = ['Hero', 'Features', 'About', 'Gallery', 'Testimonials', 'FAQ', 'Pricing', 'Contact'];
    try {
      if (root.Vvveb && root.Vvveb.Components) {
        names = names.concat(['Vvveb component library', 'Responsive spacing controls', 'Component hierarchy']);
      }
    } catch (e) {}
    return names.filter(function (x, i, a) { return a.indexOf(x) === i; });
  }
  function renderCatalog() {
    var el = document.getElementById('editorCatalog');
    if (!el) return;
    el.innerHTML = catalog().map(function (name, i) {
      return '<button type="button" class="editor-catalog-item" data-editor-block="' + i + '"><span>' + esc(name.slice(0, 1)) + '</span><b>' + esc(name) + '</b><small>Insertable building block</small></button>';
    }).join('');
  }
  function insertBlock(editor, index) {
    if (!editor) return;
    var blocks = [
      '<section class="pallettai-block"><div class="container"><p class="eyebrow">A clear beginning</p><h2>Make the next step obvious.</h2><p>Replace this with the proof your audience needs before they act.</p></div></section>',
      '<section class="pallettai-block"><div class="container"><h2>Why choose us</h2><div class="grid3"><article><h3>Focused</h3><p>One useful promise, clearly made.</p></article><article><h3>Thoughtful</h3><p>Details that make the experience feel considered.</p></article><article><h3>Ready</h3><p>A simple route from interest to action.</p></article></div></div></section>',
      '<section class="pallettai-block"><div class="container"><div class="about-grid"><div><h2>Built with intent</h2><p>Tell the story behind the work and the people it serves.</p></div><div><p class="eyebrow">The detail</p><p>Use this space for a credible, specific fact.</p></div></div></div></section>',
      '<section class="pallettai-block"><div class="container"><h2>Selected work</h2><div class="grid3"><figure><div class="photo-hole">Project one</div><figcaption>Project one</figcaption></figure><figure><div class="photo-hole">Project two</div><figcaption>Project two</figcaption></figure><figure><div class="photo-hole">Project three</div><figcaption>Project three</figcaption></figure></div></div></section>',
      '<section class="pallettai-block"><div class="container"><blockquote>“The part that made the difference was how clearly the site explained the value.”</blockquote><p>— Client name, role</p></div></section>',
      '<section class="pallettai-block"><div class="container"><details open><summary>What should visitors know?</summary><p>Answer the question directly and keep the language human.</p></details></div></section>',
      '<section class="pallettai-block"><div class="container"><h2>Choose your route</h2><div class="grid3"><article><h3>Starter</h3><strong>£—</strong><p>A clear first option.</p></article><article><h3>Signature</h3><strong>£—</strong><p>The most complete route.</p></article><article><h3>Custom</h3><strong>Let’s talk</strong><p>For a tailored brief.</p></article></div></div></section>',
      '<section class="pallettai-block"><div class="container"><h2>Let’s talk</h2><p>Give visitors one easy way to ask the next question.</p><a class="btn solid" href="#contact">Start a conversation</a></div></section>'
    ];
    try { editor.addComponents(blocks[index] || blocks[0]); } catch (e) {}
  }
  var runtimePromise = null;
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-pallettai-editor="' + src + '"]');
      if (existing) {
        if (existing.dataset.loaded === '1') return resolve();
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
      }
      var script = document.createElement('script');
      script.src = src;
      script.dataset.pallettaiEditor = src;
      script.addEventListener('load', function () { script.dataset.loaded = '1'; resolve(); }, { once: true });
      script.addEventListener('error', function () { reject(new Error('Could not load ' + src)); }, { once: true });
      document.head.appendChild(script);
    });
  }
  function loadStyle(href) {
    if (document.querySelector('link[data-pallettai-editor="' + href + '"]')) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.pallettaiEditor = href;
    document.head.appendChild(link);
  }
  function ensureRuntime() {
    if (runtimePromise) return runtimePromise;
    loadStyle('node_modules/grapesjs/dist/css/grapes.min.css');
    loadStyle('node_modules/vvvebjs/css/editor.css');
    runtimePromise = loadScript('node_modules/grapesjs/dist/grapes.min.js')
      .then(function () { return loadScript('node_modules/vvvebjs/libs/builder/builder.js'); })
      .then(function () { return loadScript('node_modules/vvvebjs/libs/builder/undo.js'); })
      .then(function () { return loadScript('node_modules/vvvebjs/libs/builder/inputs.js'); })
      .then(function () { return loadScript('node_modules/vvvebjs/libs/builder/components-common.js'); })
      .then(function () { return loadScript('node_modules/vvvebjs/libs/builder/components-html.js'); })
      .then(function () { return loadScript('node_modules/vvvebjs/libs/builder/components-elements.js'); })
      .then(function () { return loadScript('node_modules/vvvebjs/libs/builder/components-bootstrap5.js'); });
    return runtimePromise;
  }

  function initGrapes(project) {
    var host = document.getElementById('grapesCanvas');
    if (!host || !root.grapesjs) return null;
    var html = currentExport(project);
    var editor = root.grapesjs.init({
      container: host,
      fromElement: false,
      components: bodyFromHtml(html),
      style: styleFromHtml(html),
      storageManager: false,
      telemetry: false,
      cssIcons: false,
      avoidInlineStyle: false,
      noticeOnUnload: false,
      height: '680px',
      width: 'auto',
      panels: { defaults: [] },
      blockManager: { appendTo: '#editorCatalog', blocks: [] },
      selectorManager: { componentFirst: true },
      deviceManager: { devices: [
        { id: 'desktop', name: 'Desktop', width: '' },
        { id: 'tablet', name: 'Tablet', width: '768px', widthMedia: '992px' },
        { id: 'mobile', name: 'Mobile', width: '390px', widthMedia: '480px' }
      ] }
    });
    editor.on('update', function () {
      var state = snapshot(editor, 'grapesjs');
      var status = document.getElementById('editorSaveStatus');
      if (status) status.textContent = state ? 'Unsaved canvas changes' : 'Canvas is too large to save';
    });
    return editor;
  }
  function open(project, onSave) {
    if (!project) return Promise.resolve(false);
    destroy();
    var modal = document.getElementById('editorLabModal');
    if (!modal) return Promise.resolve(false);
    modal.hidden = false;
    var name = safeText(project.site && project.site.name, 'Untitled site');
    var title = document.getElementById('editorLabTitle');
    var status = document.getElementById('editorSaveStatus');
    if (title) title.textContent = 'Advanced canvas · ' + name;
    if (status) status.textContent = 'Loading the visual canvas…';
    renderCatalog();
    return ensureRuntime().then(function () {
      var editor = initGrapes(project);
      if (!editor) throw new Error('The visual canvas could not initialise');
      active = { editor: editor, project: project, onSave: onSave };
      var catalogEl = document.getElementById('editorCatalog');
      if (catalogEl) catalogEl.onclick = function (event) {
        var button = event.target.closest('[data-editor-block]');
        if (button) insertBlock(editor, Number(button.dataset.editorBlock));
      };
      var save = document.getElementById('editorLabSave');
      if (save) save.onclick = function () {
        var state = snapshot(editor, 'grapesjs');
        if (!state) return;
        project.editorCanvas = state;
        if (typeof onSave === 'function') onSave(project, state);
        if (status) status.textContent = 'Canvas snapshot saved to this project';
      };
      if (status) status.textContent = 'Canvas ready';
      return true;
    }).catch(function (error) {
      if (status) status.textContent = 'Canvas unavailable';
      if (modal) modal.hidden = true;
      destroy();
      try { if (root.toast) root.toast(error && error.message ? error.message : 'The visual canvas could not load', false); } catch (e) {}
      return false;
    });
  }
  function close() {
    var modal = document.getElementById('editorLabModal');
    if (modal) modal.hidden = true;
    destroy();
  }
  root.PallettAIEditors = {
    open: open,
    close: close,
    destroy: destroy,
    hasGrapes: function () { return !!root.grapesjs; },
    hasVvveb: function () { return !!root.Vvveb; },
    catalog: catalog,
    snapshot: function () { return active ? snapshot(active.editor, 'grapesjs') : null; },
    versions: { grapesjs: '0.23.6', vvvebjs: '2.0.9' }
  };
}(window));
