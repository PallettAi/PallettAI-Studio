'use strict';

// ============================================================
// PallettAI Studio — Visual Block Editor Canvas
// The Workspace view: stack layout schemas by drag-and-drop, turn the canvas
// order into a JSON payload for the DeepSeek AST compiler, and keep a live
// preview iframe in sync through the incremental-compiler hooks.
//
// Drag-and-drop uses native HTML5 DnD, but every mutation is also reachable
// through the public API (addBlock/moveBlock/reorder) so the editor stays
// keyboard- and test-drivable without synthesising drag events.
// ============================================================

(function (root) {
  const RUNTIME = (typeof require === 'function' && typeof module !== 'undefined')
    ? require('./runtime.js')
    : (root && root.PallettAIDashboardRuntime);

  /** Layout archetypes the canvas can stack, in palette order. */
  const BLOCK_LIBRARY = [
    { type: 'nav', label: 'Navigation', group: 'Chrome', props: { brand: 'Studio', links: ['Work', 'Services', 'Contact'] } },
    { type: 'hero', label: 'Hero', group: 'Sections', props: { heading: 'Design once. Ship everywhere.', subheading: 'Static sites generated from a schema.', cta: 'Start building' } },
    { type: 'features', label: 'Features', group: 'Sections', props: { heading: 'Why teams choose us', items: 3 } },
    { type: 'gallery', label: 'Gallery', group: 'Sections', props: { heading: 'Recent work', columns: 3 } },
    { type: 'pricing', label: 'Pricing', group: 'Commerce', props: { heading: 'Simple pricing', plans: 3, currency: 'USD' } },
    { type: 'testimonials', label: 'Testimonials', group: 'Sections', props: { heading: 'What clients say', quotes: 2 } },
    { type: 'faq', label: 'FAQ', group: 'Sections', props: { heading: 'Questions', items: 4 } },
    { type: 'cta', label: 'Call to action', group: 'Sections', props: { heading: 'Ready to publish?', action: 'Create a project' } },
    { type: 'footer', label: 'Footer', group: 'Chrome', props: { note: '\u00A9 PallettAI Studio' } }
  ];

  /** Preview transport channel, shared with ui/copilot.js. */
  const PREVIEW_CHANNEL = 'pai-preview';

  let seq = 0;
  function nextId(type) {
    seq += 1;
    return type + '-' + seq.toString(36) + '-' + Date.now().toString(36).slice(-4);
  }

  function libraryEntry(type) {
    return BLOCK_LIBRARY.find((entry) => entry.type === type) || null;
  }

  /**
   * Create the visual editor.
   *
   * @param {Object} options
   *   host   - { document, window } override for headless tests
   *   api    - IPC bridge (resolved automatically when omitted)
   *   tokens - OKLCH token seed forwarded to the compiler payload
   *   blocks - initial canvas contents
   * @returns {Object} editor instance
   */
  function createVisualEditor(options) {
    const opts = options || {};
    const host = RUNTIME.createHost(opts.host || {});
    const api = opts.api || RUNTIME.resolveBridge({ host: opts.host });
    const emitter = RUNTIME.createEmitter();

    /** @type {Array<{id:string,type:string,props:Object}>} */
    let blocks = [];
    let mounted = false;
    const cleanups = [];
    const refs = { root: null, canvas: null, preview: null, previewFrame: null, status: null, empty: null };
    let previewHtml = '';
    let lastPatch = null;

    // ----------------------------------------------------------
    // Canvas model
    // ----------------------------------------------------------

    function makeBlock(type, props) {
      const entry = libraryEntry(type);
      const defaults = entry ? JSON.parse(JSON.stringify(entry.props || {})) : {};
      return {
        id: nextId(type),
        type: entry ? type : 'custom',
        props: Object.assign(defaults, props || {})
      };
    }

    function indexOfBlock(id) {
      return blocks.findIndex((block) => block.id === id);
    }

    function addBlock(type, props, atIndex) {
      const block = makeBlock(type, props);
      const index = (typeof atIndex === 'number' && atIndex >= 0 && atIndex <= blocks.length)
        ? atIndex
        : blocks.length;
      blocks.splice(index, 0, block);
      afterChange('add', block);
      return block;
    }

    function removeBlock(id) {
      const index = indexOfBlock(id);
      if (index === -1) return false;
      const [removed] = blocks.splice(index, 1);
      afterChange('remove', removed);
      return true;
    }

    /** Reorder by moving `id` to an absolute index. */
    function reorder(id, toIndex) {
      const from = indexOfBlock(id);
      if (from === -1) return false;

      let target = Math.max(0, Math.min(blocks.length - 1, Number(toIndex)));
      if (target === from) return false;

      const [block] = blocks.splice(from, 1);
      blocks.splice(target, 0, block);
      afterChange('reorder', block);
      return true;
    }

    function moveBlock(id, delta) {
      const from = indexOfBlock(id);
      if (from === -1) return false;
      return reorder(id, from + Number(delta || 0));
    }

    function setProps(id, props) {
      const index = indexOfBlock(id);
      if (index === -1) return false;
      blocks[index].props = Object.assign({}, blocks[index].props, props || {});
      afterChange('props', blocks[index]);
      return true;
    }

    function clearBlocks() {
      blocks = [];
      afterChange('clear', null);
      return true;
    }

    function getBlocks() {
      // Defensive copy: callers must not mutate canvas state behind our back.
      return blocks.map((block) => ({ id: block.id, type: block.type, props: Object.assign({}, block.props) }));
    }

    /**
     * Serialise the canvas order into the compiler schema.
     * Returns a plain JSON-safe array in visual order.
     */
    function toSchema() {
      return blocks.map((block, index) => ({
        id: block.id,
        type: block.type,
        order: index,
        props: JSON.parse(JSON.stringify(block.props))
      }));
    }

    /** Full payload handed to the AST compiler. */
    function toPayload() {
      return {
        version: '0.6.0',
        target: 'deepseek-ast',
        schema: toSchema(),
        tokens: RUNTIME.deriveTokenSet(opts.tokens).css,
        meta: { blocks: blocks.length, generatedAt: new Date(0).toISOString() }
      };
    }

    function afterChange(reason, block) {
      renderCanvas();
      updateLocalPreview();
      emitter.emit('change', { reason, block, blocks: getBlocks() });
    }

    // ----------------------------------------------------------
    // Preview
    // ----------------------------------------------------------

    /** Offline preview document, used until the compiler returns something. */
    function renderLocalPreview() {
      const body = blocks.map((block) => {
        const p = block.props || {};
        switch (block.type) {
          case 'nav':
            return '<header class="pv-nav"><strong>' + esc(p.brand) + '</strong><nav>' +
              (p.links || []).map((l) => '<a>' + esc(l) + '</a>').join('') + '</nav></header>';
          case 'hero':
            return '<section class="pv-hero"><h1>' + esc(p.heading) + '</h1><p>' + esc(p.subheading) +
              '</p><button>' + esc(p.cta) + '</button></section>';
          case 'features':
            return '<section><h2>' + esc(p.heading) + '</h2><div class="pv-row">' +
              repeat('<div class="pv-card"><h3>Feature</h3><p>Describe the benefit.</p></div>', p.items) + '</div></section>';
          case 'gallery':
            return '<section><h2>' + esc(p.heading) + '</h2><div class="pv-row">' +
              repeat('<div class="pv-thumb"></div>', p.columns) + '</div></section>';
          case 'pricing':
            return '<section><h2>' + esc(p.heading) + '</h2><div class="pv-row">' +
              repeat('<div class="pv-card"><h3>' + esc(p.currency) + ' 49</h3><p>Per month</p></div>', p.plans) + '</div></section>';
          case 'testimonials':
            return '<section><h2>' + esc(p.heading) + '</h2><div class="pv-row">' +
              repeat('<blockquote class="pv-card">\u201CGreat work.\u201D</blockquote>', p.quotes) + '</div></section>';
          case 'faq':
            return '<section><h2>' + esc(p.heading) + '</h2>' +
              repeat('<details class="pv-card"><summary>Question</summary><p>Answer.</p></details>', p.items) + '</section>';
          case 'cta':
            return '<section class="pv-cta"><h2>' + esc(p.heading) + '</h2><button>' + esc(p.action) + '</button></section>';
          case 'footer':
            return '<footer class="pv-footer">' + esc(p.note) + '</footer>';
          default:
            return '<section data-type="' + esc(block.type) + '"><h2>' + esc(block.type) + '</h2></section>';
        }
      }).join('\n');

      return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' + previewStyles() +
        '</style></head><body>' + (body || '<p class="pv-empty">Drag a block onto the canvas to begin.</p>') +
        '</body></html>';
    }

    function previewStyles() {
      const tokens = RUNTIME.deriveTokenSet(opts.tokens).color;
      return [
        'body{margin:0;font-family:ui-sans-serif,system-ui,sans-serif;background:' + tokens.bg + ';color:' + tokens.text + '}',
        'section,header,footer{padding:28px 24px;border-bottom:1px solid ' + tokens.border + '}',
        'h1{margin:0 0 8px;font-size:30px}h2{margin:0 0 12px;font-size:20px}h3{margin:0 0 6px;font-size:14px}',
        'p{margin:0;color:' + tokens.textMuted + '}',
        'button{margin-top:12px;padding:9px 16px;border:0;border-radius:8px;background:' + tokens.accent + ';color:' + tokens.bg + ';font:inherit}',
        '.pv-row{display:flex;gap:12px;flex-wrap:wrap}',
        '.pv-card{flex:1 1 140px;padding:14px;border:1px solid ' + tokens.border + ';border-radius:12px;background:' + tokens.surface + '}',
        '.pv-thumb{flex:1 1 90px;height:84px;border-radius:10px;background:' + tokens.surfaceAlt + '}',
        '.pv-nav{display:flex;justify-content:space-between;align-items:center}',
        '.pv-nav a{margin-left:14px;color:' + tokens.textMuted + ';text-decoration:none}',
        '.pv-cta{text-align:center;background:' + tokens.accentSoft + '}',
        '.pv-footer{color:' + tokens.textMuted + ';font-size:12px}',
        '.pv-empty{color:' + tokens.textMuted + '}'
      ].join('\n');
    }

    function esc(value) {
      return String(value === null || value === undefined ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function repeat(markup, times) {
      const count = Math.max(0, Math.min(12, Number(times) || 0));
      return new Array(count).fill(markup).join('');
    }

    function updateLocalPreview(patch) {
      previewHtml = patch && typeof patch.html === 'string' ? patch.html : renderLocalPreview();
      if (refs.previewFrame) {
        try { refs.previewFrame.setAttribute('srcdoc', previewHtml); } catch (_) { /* stub frames */ }
        if (refs.previewFrame.srcdoc !== undefined) {
          try { refs.previewFrame.srcdoc = previewHtml; } catch (_) { /* ignore */ }
        }
      }
      emitter.emit('preview', { html: previewHtml, blocks: blocks.length });
      return previewHtml;
    }

    /**
     * Apply an incremental-compiler patch to the preview without a full reload.
     * Accepts:
     *   { type: 'html', html }            - replace the preview document
     *   { type: 'sections', sections }    - forward to the live frame
     *   { type: 'tokens', tokens }        - forward to the live frame
     */
    function applyIncrementalPatch(patch) {
      if (!patch || typeof patch !== 'object') return false;
      lastPatch = patch;

      if (patch.type === 'html' && typeof patch.html === 'string') {
        updateLocalPreview(patch);
        return true;
      }

      // Forward to the rendered frame so it can hot-swap its own DOM.
      const frame = refs.previewFrame;
      const win = host.window;
      if (frame && win && typeof win.postMessage === 'function' && frame.contentWindow) {
        try {
          win.postMessage({ channel: PREVIEW_CHANNEL, source: 'visual-editor', patch }, '*');
        } catch (_) { /* cross-origin frames are non-fatal */ }
      }

      emitter.emit('patch', patch);
      return true;
    }

    /** Subscribe to incremental-compiler events from the backend. */
    function subscribeIncremental() {
      if (typeof api.onIncrementalPatch !== 'function') return () => {};
      const off = api.onIncrementalPatch((patch) => applyIncrementalPatch(patch));
      return typeof off === 'function' ? off : () => {};
    }

    /**
     * Compile the current canvas through the AST compiler bridge.
     * Always resolves: the bridge substitutes an offline result when the
     * channel is unavailable, so the UI can report status instead of crashing.
     */
    function build() {
      const payload = toPayload();

      if (refs.status) {
        refs.status.textContent = 'Compiling ' + blocks.length + ' block' + (blocks.length === 1 ? '' : 's') + '\u2026';
        refs.status.setAttribute('data-state', 'pending');
      }

      emitter.emit('build:start', payload);

      let result;
      try {
        result = api.build(payload);
      } catch (err) {
        // Synchronous throw from a broken channel.
        result = Promise.reject(err);
      }

      return Promise.resolve(result).then((response) => {
        const res = response || {};

        if (typeof res.html === 'string') applyIncrementalPatch({ type: 'html', html: res.html });

        if (refs.status) {
          const ok = res.ok !== false && !res.offline;
          refs.status.textContent = ok
            ? 'Compiled ' + blocks.length + ' block' + (blocks.length === 1 ? '' : 's')
            : 'Compiler channel unavailable \u2014 showing local preview';
          refs.status.setAttribute('data-state', ok ? 'ok' : 'warn');
        }

        emitter.emit('build:done', res);
        return res;
      }).catch((err) => {
        if (refs.status) {
          refs.status.textContent = 'Build failed: ' + (err && err.message ? err.message : err);
          refs.status.setAttribute('data-state', 'error');
        }
        emitter.emit('error', { scope: 'build', error: err });
        return { ok: false, error: String(err && err.message ? err.message : err) };
      });
    }

    // ----------------------------------------------------------
    // Rendering
    // ----------------------------------------------------------

    function renderCanvas() {
      if (!refs.canvas) return;
      RUNTIME.clear(refs.canvas);
      refs.canvas.setAttribute('data-count', String(blocks.length));

      if (blocks.length === 0) {
        refs.canvas.appendChild(host.el('p', {
          class: 'pai-status',
          'data-role': 'canvas-empty',
          textContent: 'Canvas is empty. Drag a block here or press Add.'
        }));
        return;
      }

      blocks.forEach((block, index) => {
        refs.canvas.appendChild(renderCanvasItem(block, index));
      });
    }

    function renderCanvasItem(block, index) {
      const entry = libraryEntry(block.type);
      const item = host.el('div', {
        class: 'pai-canvas-item',
        draggable: 'true',
        'data-block-id': block.id,
        'data-block-type': block.type,
        'data-index': String(index)
      });

      item.appendChild(host.el('span', {
        class: 'pai-canvas-item-label',
        textContent: (index + 1) + '. ' + (entry ? entry.label : block.type)
      }));

      const controls = host.el('div', { class: 'pai-canvas-item-controls' });
      controls.appendChild(navButton('\u2191', 'Move up', 'move-up', block.id, () => moveBlock(block.id, -1)));
      controls.appendChild(navButton('\u2193', 'Move down', 'move-down', block.id, () => moveBlock(block.id, 1)));
      controls.appendChild(navButton('\u2715', 'Remove block', 'remove', block.id, () => removeBlock(block.id)));
      item.appendChild(controls);

      // ---- drag source ----
      RUNTIME.on(item, 'dragstart', (event) => {
        item.setAttribute('data-dragging', 'true');
        setDragPayload(event, { kind: 'existing', id: block.id, index });
      });
      RUNTIME.on(item, 'dragend', () => item.removeAttribute('data-dragging'));

      return item;
    }

    function navButton(glyph, label, action, blockId, handler) {
      return host.el('button', {
        type: 'button',
        class: 'pai-btn',
        'data-action': action,
        'data-block-id': blockId,
        'aria-label': label,
        title: label,
        textContent: glyph,
        onClick: handler
      });
    }

    /** Write a drag payload, tolerating hosts without a real DataTransfer. */
    function setDragPayload(event, payload) {
      dragState = payload;
      if (event && event.dataTransfer && typeof event.dataTransfer.setData === 'function') {
        try { event.dataTransfer.setData('application/json', JSON.stringify(payload)); } catch (_) { /* ignore */ }
        try { event.dataTransfer.setData('text/plain', payload.id || payload.type || ''); } catch (_) { /* ignore */ }
      }
      return payload;
    }

    let dragState = null;

    function readDragPayload(event) {
      if (event && event.dataTransfer && typeof event.dataTransfer.getData === 'function') {
        try {
          const raw = event.dataTransfer.getData('application/json');
          if (raw) return JSON.parse(raw);
        } catch (_) { /* fall through to in-memory state */ }
      }
      return dragState;
    }

    function buildPalette() {
      const palette = host.el('div', { class: 'pai-palette', 'data-role': 'palette' });

      BLOCK_LIBRARY.forEach((entry) => {
        const button = host.el('button', {
          type: 'button',
          class: 'pai-block',
          draggable: 'true',
          'data-block-type': entry.type,
          title: 'Drag or click to add ' + entry.label,
          onClick: () => addBlock(entry.type)
        });
        button.appendChild(host.el('span', { class: 'pai-block-glyph', 'aria-hidden': 'true', textContent: '\u2B1A' }));
        button.appendChild(host.el('span', { class: 'pai-block-label', textContent: entry.label }));

        RUNTIME.on(button, 'dragstart', (event) => {
          setDragPayload(event, { kind: 'library', type: entry.type });
        });

        palette.appendChild(button);
      });

      return palette;
    }

    /**
     * Resolve a drop into a canvas mutation.
     * Exposed for tests, which cannot synthesise native drag events.
     */
    function handleDrop(payload, insertIndex) {
      if (!payload) return null;

      if (payload.kind === 'library') {
        return addBlock(payload.type, null, insertIndex);
      }

      if (payload.kind === 'existing') {
        const target = typeof insertIndex === 'number' ? insertIndex : blocks.length - 1;
        reorder(payload.id, target);
        return blocks.find((b) => b.id === payload.id) || null;
      }

      return null;
    }

    function onCanvasDrop(event) {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      if (refs.canvas) refs.canvas.setAttribute('data-dropactive', 'false');

      const payload = readDragPayload(event);
      if (!payload) return null;

      // Dropping onto a canvas item inserts before it; dropping on empty
      // canvas space appends to the end.
      const target = event && event.target;
      const item = target && typeof target.closest === 'function'
        ? target.closest('[data-index]')
        : null;
      const insertIndex = item ? Number(item.getAttribute('data-index')) : blocks.length;

      const result = handleDrop(payload, insertIndex);
      dragState = null;
      return result;
    }

    // ----------------------------------------------------------
    // Mount
    // ----------------------------------------------------------

    function toolbar() {
      const bar = host.el('div', { class: 'pai-card' });
      bar.appendChild(host.el('h3', { textContent: 'Canvas' }));

      const row = host.el('div', { class: 'pai-field' });
      row.appendChild(host.el('button', {
        type: 'button', class: 'pai-btn', 'data-variant': 'primary',
        'data-action': 'build', textContent: 'Compile & preview',
        onClick: () => { build(); }
      }));
      row.appendChild(host.el('button', {
        type: 'button', class: 'pai-btn', 'data-action': 'add-default',
        textContent: 'Add Hero', onClick: () => addBlock('hero')
      }));
      row.appendChild(host.el('button', {
        type: 'button', class: 'pai-btn', 'data-action': 'clear',
        textContent: 'Clear', onClick: () => clearBlocks()
      }));
      bar.appendChild(row);

      refs.status = host.el('p', { class: 'pai-status', 'data-role': 'build-status', textContent: 'Idle' });
      bar.appendChild(refs.status);
      return bar;
    }

    function mount(container) {
      const target = container || (opts.host && opts.host.document && opts.host.document.body) || host.document.body;
      if (!target) throw new Error('VisualEditor.mount: no container element.');

      const layout = host.el('div', { class: 'pai-editor', 'data-role': 'visual-editor' });

      // Column 1 — block palette
      const paletteCol = host.el('div', { class: 'pai-card' });
      paletteCol.appendChild(host.el('h3', { textContent: 'Blocks' }));
      paletteCol.appendChild(buildPalette());

      // Column 2 — canvas + toolbar
      const canvasCol = host.el('div', {});
      canvasCol.appendChild(toolbar());

      const canvasCard = host.el('div', { class: 'pai-card' });
      canvasCard.appendChild(host.el('h3', { textContent: 'Layout order' }));

      refs.canvas = host.el('div', {
        class: 'pai-canvas',
        'data-role': 'canvas',
        'data-dropactive': 'false',
        role: 'list',
        'aria-label': 'Layout blocks'
      });

      RUNTIME.on(refs.canvas, 'dragover', (event) => {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        refs.canvas.setAttribute('data-dropactive', 'true');
      });
      RUNTIME.on(refs.canvas, 'dragleave', () => refs.canvas.setAttribute('data-dropactive', 'false'));
      RUNTIME.on(refs.canvas, 'drop', onCanvasDrop);

      canvasCard.appendChild(refs.canvas);
      canvasCol.appendChild(canvasCard);

      // Column 3 — live preview
      const previewCol = host.el('div', { class: 'pai-card' });
      previewCol.appendChild(host.el('h3', { textContent: 'Live preview' }));

      const frame = host.el('iframe', {
        class: 'pai-preview',
        'data-role': 'preview-frame',
        title: 'Incremental build preview',
        sandbox: 'allow-same-origin'
      });
      refs.previewFrame = frame;
      previewCol.appendChild(frame);

      layout.appendChild(paletteCol);
      layout.appendChild(canvasCol);
      layout.appendChild(previewCol);
      target.appendChild(layout);

      refs.root = target;

      // Seed from options (or start empty) and paint the first frame.
      (opts.blocks || []).forEach((entry) => {
        if (entry && entry.type) addBlockSilently(entry.type, entry.props);
      });

      renderCanvas();
      updateLocalPreview();

      cleanups.push(subscribeIncremental());
      const offChange = emitter.on('change', () => {});
      cleanups.push(offChange);

      mounted = true;
      emitter.emit('mount', { blocks: getBlocks() });
      return layout;
    }

    /** Add without triggering a render pass (used while seeding). */
    function addBlockSilently(type, props) {
      blocks.push(makeBlock(type, props));
    }

    function destroy() {
      while (cleanups.length) {
        const fn = cleanups.pop();
        try { fn(); } catch (_) { /* ignore */ }
      }
      if (refs.root && refs.root.parentNode) refs.root.parentNode.removeChild(refs.root);
      mounted = false;
      emitter.removeAll();
    }

    const editor = {
      // lifecycle
      mount, destroy,
      // model
      addBlock, removeBlock, reorder, moveBlock, setProps, clearBlocks,
      getBlocks, toSchema, toPayload,
      // preview + compile
      build, applyIncrementalPatch, subscribeIncremental,
      getPreviewHtml: () => previewHtml,
      getLastPatch: () => lastPatch,
      renderLocalPreview,
      // drag helpers (also used by the smoke runner)
      handleDrop, getDragPayload: () => dragState,
      // chrome
      getStatus: () => (refs.status ? refs.status.textContent : null),
      getElement: () => refs.root,
      getCanvas: () => refs.canvas,
      getPreviewFrame: () => refs.previewFrame,
      isMounted: () => mounted,
      // events
      on: emitter.on, off: emitter.off, emit: emitter.emit,
      // testing seam
      _internals: { refs, getRefs: () => refs, setDragPayload, readDragPayload }
    };

    return editor;
  }

  const visualEditor = { createVisualEditor, BLOCK_LIBRARY, PREVIEW_CHANNEL };

  if (root) root.PallettAIVisualEditor = visualEditor;
  if (typeof module !== 'undefined' && module.exports) module.exports = visualEditor;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null));
