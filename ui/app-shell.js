'use strict';

// ============================================================
// PallettAI Studio — Dashboard App Shell & Router
// Primary layout for the v0.6.0 renderer dashboard:
//   • collapsible sidebar + main content region
//   • lightweight client-side router over the 4 main views
//   • native window state control via the IPC bridge
//
// Views are registered by id, so feature modules (visual editor, token panel,
// telemetry) plug in without the shell depending on them. Unknown ids fall back
// to a built-in placeholder, which keeps the router total: any of the four
// routes can always mount.
// ============================================================

(function (root) {
  const RUNTIME = (typeof require === 'function' && typeof module !== 'undefined')
    ? require('./runtime.js')
    : (root && root.PallettAIDashboardRuntime);

  // The four main views required by the dashboard contract.
  const DEFAULT_VIEWS = [
    { id: 'workspace', label: 'Workspace', icon: '\u25A6' },
    { id: 'design-tokens', label: 'Design Tokens', icon: '\u25D1' },
    { id: 'seo-content', label: 'SEO / Content', icon: '\u25CE' },
    { id: 'telemetry', label: 'Build Telemetry', icon: '\u25E9' }
  ];

  const WINDOW_ACTIONS = [
    { action: 'minimize', label: 'Minimize', glyph: '\u2013' },
    { action: 'maximize', label: 'Maximize', glyph: '\u25A1' },
    { action: 'close', label: 'Close', glyph: '\u2715' }
  ];

  /**
   * Create (but do not mount) the dashboard shell.
   *
   * @param {Object} options
   *   host      - { document, window } override for headless tests
   *   api       - IPC bridge; resolved automatically when omitted
   *   tokens    - OKLCH token seed for the initial palette
   *   views     - view definitions [{ id, label, icon, mount(container, ctx) }]
   *   collapse  - start with the sidebar collapsed
   *   syncHash  - mirror the active view into window.location.hash
   * @returns {Object} shell instance
   */
  function createAppShell(options) {
    const opts = options || {};
    const host = RUNTIME.createHost(opts.host || {});
    const doc = host.document;

    const api = opts.api || RUNTIME.resolveBridge({ host: opts.host });
    const emitter = RUNTIME.createEmitter();

    const views = new Map();
    DEFAULT_VIEWS.forEach((view) => views.set(view.id, Object.assign({}, view)));

    // Merge caller-supplied definitions (including custom routes).
    (opts.views || []).forEach((view) => {
      if (!view || !view.id) return;
      views.set(view.id, Object.assign({}, views.get(view.id) || {}, view));
    });

    const state = {
      active: null,
      collapsed: !!opts.collapse,
      mounted: false,
      mounts: 0
    };

    const refs = {
      root: null,
      shell: null,
      sidebar: null,
      nav: null,
      view: null,
      title: null,
      status: null,
      controls: null,
      toggle: null
    };

    const cleanups = [];

    // ----------------------------------------------------------
    // Layout construction
    // ----------------------------------------------------------

    function buildNavButton(view) {
      const button = host.el('button', {
        type: 'button',
        class: 'pai-nav-item',
        'data-view': view.id,
        title: view.label,
        onClick: () => navigate(view.id)
      });
      button.appendChild(host.el('span', { class: 'pai-nav-icon', 'aria-hidden': 'true', textContent: view.icon || '\u25AA' }));
      button.appendChild(host.el('span', { class: 'pai-nav-label', textContent: view.label }));
      return button;
    }

    function buildWindowControls() {
      const wrap = host.el('div', { class: 'pai-window-controls', role: 'group', 'aria-label': 'Window controls' });

      WINDOW_ACTIONS.forEach((item) => {
        const button = host.el('button', {
          type: 'button',
          'data-window-action': item.action,
          'aria-label': item.label,
          title: item.label,
          textContent: item.glyph,
          // Every control routes through the single IPC seam so the renderer
          // degrades to a no-op in the browser build instead of throwing.
          onClick: () => requestWindowAction(item.action)
        });
        wrap.appendChild(button);
      });

      return wrap;
    }

    /**
     * Ask the main process to change window state.
     * Emits 'window' so tests and host chrome can observe the request.
     */
    function requestWindowAction(action) {
      const name = String(action || '').toLowerCase();
      emitter.emit('window', { action: name });

      try {
        api.windowControl(name);
      } catch (err) {
        emitter.emit('error', { scope: 'window', action: name, error: err });
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[pallettai] window control "' + name + '" failed', err);
        }
      }

      return name;
    }

    function buildShell() {
      const shell = host.el('div', {
        class: 'pai-shell',
        'data-collapsed': state.collapsed ? 'true' : 'false'
      });

      // ---- sidebar ----
      const sidebar = host.el('aside', { class: 'pai-sidebar', 'aria-label': 'Primary navigation' });
      sidebar.appendChild(host.el('div', { class: 'pai-brand', textContent: 'PallettAI Studio' }));

      const nav = host.el('nav', { class: 'pai-nav', role: 'navigation' });
      Array.from(views.values()).forEach((view) => nav.appendChild(buildNavButton(view)));
      sidebar.appendChild(nav);

      const footer = host.el('div', { class: 'pai-sidebar-footer' });
      const toggle = host.el('button', {
        type: 'button',
        class: 'pai-nav-item',
        'data-action': 'toggle-sidebar',
        'aria-expanded': state.collapsed ? 'false' : 'true',
        'aria-label': 'Toggle sidebar',
        title: 'Toggle sidebar',
        onClick: () => setCollapsed(!state.collapsed)
      });
      toggle.appendChild(host.el('span', { class: 'pai-nav-icon', 'aria-hidden': 'true', textContent: '\u21C4' }));
      toggle.appendChild(host.el('span', { class: 'pai-nav-label', textContent: 'Collapse' }));
      footer.appendChild(toggle);

      const status = host.el('div', { class: 'pai-status', 'data-role': 'bridge-status' });
      footer.appendChild(status);
      sidebar.appendChild(footer);

      // ---- main ----
      const main = host.el('main', { class: 'pai-main' });
      const titlebar = host.el('header', { class: 'pai-titlebar' });
      const title = host.el('h1', { class: 'pai-view-title', 'data-role': 'view-title', textContent: '' });

      titlebar.appendChild(title);
      titlebar.appendChild(buildWindowControls());
      main.appendChild(titlebar);

      const view = host.el('section', { class: 'pai-view', 'data-role': 'view-host', tabindex: '-1' });
      main.appendChild(view);

      shell.appendChild(sidebar);
      shell.appendChild(main);

      Object.assign(refs, {
        shell, sidebar, nav, view, title, status,
        controls: titlebar,
        toggle
      });

      renderBridgeStatus();
      return shell;
    }

    /** Surface which bridge we bound to — useful when a channel is missing. */
    function renderBridgeStatus() {
      if (!refs.status) return;
      const connected = api.__connected;
      const source = api.__source || 'fallback';
      const text = connected
        ? 'Bridge: ' + source + (api.__missing && api.__missing.length ? ' (' + api.__missing.length + ' optional missing)' : '')
        : 'Bridge: offline (local fallbacks)';

      refs.status.textContent = text;
      refs.status.setAttribute('data-state', connected ? 'ok' : 'warn');
      refs.status.setAttribute('data-bridge', source);
    }

    // ----------------------------------------------------------
    // Router
    // ----------------------------------------------------------

    function resolveViewName(name) {
      const wanted = String(name || '').trim();
      if (views.has(wanted)) return wanted;

      // Accept common aliases so deep links from the native menu still work.
      const normalised = wanted.toLowerCase().replace(/[_\s]+/g, '-');
      const alias = {
        editor: 'workspace',
        builder: 'workspace',
        canvas: 'workspace',
        tokens: 'design-tokens',
        design: 'design-tokens',
        'design-tokens': 'design-tokens',
        seo: 'seo-content',
        content: 'seo-content',
        'seo-content': 'seo-content',
        telemetry: 'telemetry',
        build: 'telemetry',
        metrics: 'telemetry'
      }[normalised];

      return alias && views.has(alias) ? alias : null;
    }

    function highlightNav(activeId) {
      if (!refs.nav) return;
      const buttons = refs.nav.querySelectorAll('.pai-nav-item');
      Array.prototype.forEach.call(buttons, (button) => {
        const isActive = button.getAttribute('data-view') === activeId;
        if (isActive) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
      });
    }

    /**
     * Internal render. `force` re-mounts the active view even when unchanged,
     * which the smoke runner and the native menu both rely on.
     */
    function renderView(name, force) {
      const target = views.get(name);
      if (!target || !refs.view) return false;

      if (state.active === name && !force) return true;

      // Tear down the previous view before mounting the next one.
      if (state.active && state.active !== name) teardownActiveView();

      RUNTIME.clear(refs.view);

      state.active = name;
      state.mounts++;

      if (refs.title) refs.title.textContent = target.label;
      refs.view.setAttribute('data-view', name);
      highlightNav(name);

      try {
        if (typeof target.mount === 'function') {
          const result = target.mount(refs.view, context());
          if (typeof result === 'function') cleanups.push(result);
        } else {
          refs.view.appendChild(placeholderFor(target));
        }
      } catch (err) {
        // A broken view must not take the whole dashboard down.
        refs.view.appendChild(errorPanel(target, err));
        emitter.emit('error', { scope: 'view', view: name, error: err });
      }

      emitter.emit('navigate', { view: name, forced: !!force });
      syncHash(name);
      return true;
    }

    function placeholderFor(view) {
      return host.el('div', { class: 'pai-card', 'data-placeholder': view.id },
        host.el('h3', { textContent: view.label }),
        host.el('p', { class: 'pai-status', textContent: 'No module is registered for this view yet.' })
      );
    }

    function errorPanel(view, err) {
      return host.el('div', { class: 'pai-card', 'data-view-error': view.id },
        host.el('h3', { textContent: view.label + ' failed to mount' }),
        host.el('pre', { class: 'pai-log', 'data-level': 'error', textContent: String(err && err.message ? err.message : err) })
      );
    }

    function teardownActiveView() {
      while (cleanups.length) {
        const fn = cleanups.pop();
        try { fn(); } catch (_) { /* teardown must never block navigation */ }
      }
      const current = views.get(state.active);
      if (current && typeof current.unmount === 'function') {
        try { current.unmount(); } catch (_) { /* ignore */ }
      }
    }

    /** Shared context handed to every view's mount(). */
    function context() {
      return {
        api,
        tokens: opts.tokens || RUNTIME.defaultTokens(),
        document: doc,
        window: host.window,
        el: host.el,
        svg: host.svg,
        shell,
        emitter,
        navigate
      };
    }

    // ----------------------------------------------------------
    // Hash sync
    // ----------------------------------------------------------

    function syncHash(name) {
      if (!opts.syncHash) return;
      const win = host.window;
      if (!win || !win.location) return;
      try {
        const next = '#' + name;
        if (win.location.hash !== next) win.location.hash = next;
      } catch (_) { /* sandboxed documents may reject hash writes */ }
    }

    function readHash() {
      const win = host.window;
      if (!win || !win.location) return null;
      const raw = String(win.location.hash || '').replace(/^#\/?/, '');
      return raw || null;
    }

    function onHashChange() {
      const name = resolveViewName(readHash());
      if (name) renderView(name, false);
    }

    // ----------------------------------------------------------
    // Public API
    // ----------------------------------------------------------

    /** Mount the shell into a root element. Idempotent. */
    function mount(target) {
      const container = target || doc.body;
      if (!container) throw new Error('AppShell.mount: no container element.');

      if (state.mounted && refs.shell) return shell;

      RUNTIME.installStyles(doc, opts.tokens);

      refs.root = container;
      const built = buildShell();
      container.appendChild(built);

      if (opts.syncHash) {
        const win = host.window;
        if (win && typeof win.addEventListener === 'function') {
          win.addEventListener('hashchange', onHashChange);
          cleanups.push(() => win.removeEventListener('hashchange', onHashChange));
        }
      }

      state.mounted = true;

      const initial = resolveViewName(opts.initial || readHash()) || DEFAULT_VIEWS[0].id;
      renderView(initial, true);

      return built;
    }

    /** Navigate to a view id (or alias). Returns true when it mounted. */
    function navigate(name, force) {
      const resolved = resolveViewName(name);
      if (!resolved) {
        emitter.emit('error', { scope: 'router', reason: 'unknown-view', view: name });
        return false;
      }
      return renderView(resolved, force);
    }

    /** Register or replace a view definition. */
    function registerView(definition) {
      if (!definition || !definition.id) return false;
      const id = definition.id;
      const existing = views.get(id) || { id, label: id, icon: '\u25AA' };
      views.set(id, Object.assign({}, existing, definition));

      if (refs.nav) {
        const button = refs.nav.querySelector('[data-view="' + id + '"]');
        if (!button) refs.nav.appendChild(buildNavButton(views.get(id)));
      }

      // Re-render in place when the active view was redefined.
      if (state.active === id) renderView(id, true);
      return true;
    }

    function unregisterView(id) {
      if (!views.has(id)) return false;
      if (state.active === id) teardownActiveView();
      views.delete(id);
      if (refs.nav) {
        const button = refs.nav.querySelector('[data-view="' + id + '"]');
        if (button && button.parentNode) button.parentNode.removeChild(button);
      }
      return true;
    }

    function setCollapsed(collapsed) {
      state.collapsed = !!collapsed;
      if (refs.shell) refs.shell.setAttribute('data-collapsed', state.collapsed ? 'true' : 'false');
      if (refs.toggle) refs.toggle.setAttribute('aria-expanded', state.collapsed ? 'false' : 'true');
      emitter.emit('collapse', { collapsed: state.collapsed });
      return state.collapsed;
    }

    function destroy() {
      teardownActiveView();
      if (refs.shell && refs.shell.parentNode) refs.shell.parentNode.removeChild(refs.shell);
      state.mounted = false;
      emitter.removeAll();
    }

    const shell = {
      // lifecycle
      mount, destroy, registerView, unregisterView,
      // routing
      navigate, getActiveView: () => state.active,
      listViews: () => Array.from(views.keys()),
      // chrome
      setCollapsed, isCollapsed: () => state.collapsed,
      requestWindowAction,
      // introspection
      getApi: () => api,
      getElement: () => refs.shell,
      getViewHost: () => refs.view,
      isMounted: () => state.mounted,
      getMountCount: () => state.mounts,
      // events
      on: emitter.on, off: emitter.off, emit: emitter.emit,
      // testing seam
      _internals: { refs, state, views, context, resolveViewName }
    };

    return shell;
  }

  const appShell = { createAppShell, DEFAULT_VIEWS, WINDOW_ACTIONS };

  if (root) root.PallettAIDashboardShell = appShell;
  if (typeof module !== 'undefined' && module.exports) module.exports = appShell;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null));
