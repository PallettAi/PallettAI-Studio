'use strict';

// ============================================================
// PallettAI Studio — Dashboard Runtime
// Shared primitives for the v0.6.0 renderer dashboard:
//   • tiny hyperscript DOM builders (no framework, no innerHTML)
//   • the single IPC seam (`pallettaiAPI` / `pallettai` / safe fallback)
//   • a minimal pub/sub event bus
//   • OKLCH design-token helpers
//
// Every module in ui/ talks to the backend through `resolveBridge` so the
// renderer never throws when a channel is missing (browser build, older
// preload, or a backend that has not shipped the method yet).
// ============================================================

(function (root) {
  // ------------------------------------------------------------
  // DOM builders
  // ------------------------------------------------------------

  const SVG_NS = 'http://www.w3.org/2000/svg';

  /**
   * Apply an attribute/property bag to an element.
   * Supports: id/class/for/htmlFor, data-* / aria-*, style objects,
   * `on*` listener shorthand, textContent, boolean and plain attributes.
   */
  function applyAttrs(node, attrs) {
    if (!attrs) return node;

    Object.keys(attrs).forEach((key) => {
      const value = attrs[key];
      if (value === null || value === undefined || value === false) return;

      if (key === 'class' || key === 'className') {
        String(value).split(/\s+/).filter(Boolean).forEach((c) => node.classList.add(c));
        return;
      }

      if (key === 'style' && typeof value === 'object') {
        Object.keys(value).forEach((prop) => {
          const cssProp = prop.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
          if (node.style && typeof node.style.setProperty === 'function') {
            node.style.setProperty(cssProp, String(value[prop]));
          } else {
            node.style = node.style || {};
            node.style[prop] = value[prop];
          }
        });
        return;
      }

      if (key === 'textContent' || key === 'text') {
        node.textContent = String(value);
        return;
      }

      if (key === 'dataset' && typeof value === 'object') {
        Object.keys(value).forEach((d) => node.setAttribute('data-' + d, String(value[d])));
        return;
      }

      // Listener shorthand: onClick, onInput, ...
      if (typeof value === 'function' && /^on[A-Z]/.test(key)) {
        const type = key.slice(2).toLowerCase();
        node.addEventListener(type, value);
        return;
      }

      if (value === true) {
        node.setAttribute(key, '');
        return;
      }

      node.setAttribute(key, String(value));
    });

    return node;
  }

  /** Append a child which may be a node, string, number, array or null. */
  function appendChild(parent, child) {
    if (child === null || child === undefined || child === false) return parent;

    if (Array.isArray(child)) {
      child.forEach((c) => appendChild(parent, c));
      return parent;
    }

    if (typeof child === 'object' && typeof child.nodeType !== 'undefined') {
      parent.appendChild(child);
      return parent;
    }

    // Strings/numbers become text nodes. `createTextNode` keeps the renderer
    // escape-safe: no innerHTML, so user copy can never inject markup.
    const doc = parent.ownerDocument || (parent.ownerDocument = null) || null;
    if (doc && typeof doc.createTextNode === 'function') {
      parent.appendChild(doc.createTextNode(String(child)));
    } else {
      parent.appendChild({ nodeType: 3, textContent: String(child), parentNode: parent });
    }

    return parent;
  }

  /**
   * Create an HTML element: el('div', {class: 'x'}, 'Hello', el('b'))
   */
  function el(tag, attrs, ...children) {
    const doc = resolveDocument();
    const node = doc.createElement(tag);
    applyAttrs(node, attrs);
    children.forEach((c) => appendChild(node, c));
    return node;
  }

  /**
   * Create an SVG element. SVG must be built in the SVG namespace or the
   * browser will silently render nothing.
   */
  function svgEl(tag, attrs, ...children) {
    const doc = resolveDocument();
    const node = typeof doc.createElementNS === 'function'
      ? doc.createElementNS(SVG_NS, tag)
      : doc.createElement(tag);
    applyAttrs(node, attrs);
    children.forEach((c) => appendChild(node, c));
    return node;
  }

  /** Remove every child of a node. */
  function clear(node) {
    if (!node) return node;
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  /** Attach a listener and return an unsubscribe function. */
  function on(node, type, handler, options) {
    if (!node || typeof node.addEventListener !== 'function') return () => {};
    node.addEventListener(type, handler, options);
    return () => {
      if (typeof node.removeEventListener === 'function') {
        node.removeEventListener(type, handler, options);
      }
    };
  }

  /** True when `node` (or an ancestor) matches the selector. */
  function matches(node, selector) {
    if (!node) return false;
    if (typeof node.matches === 'function') return node.matches(selector);
    if (typeof node.webkitMatchesSelector === 'function') return node.webkitMatchesSelector(selector);
    return false;
  }

  // ------------------------------------------------------------
  // Runtime resolution (browser vs Electron vs headless test)
  // ------------------------------------------------------------

  /**
   * Resolve the document to build into. Modules accept an explicit
   * `{ document, window }` host so they can run headlessly under test.
   */
  function resolveDocument() {
    const doc = resolveHost().document;
    if (!doc || typeof doc.createElement !== 'function') {
      throw new Error('PallettAI runtime: no DOM document available.');
    }
    return doc;
  }

  /**
   * Resolve the window/global used for host detection.
   */
  function resolveHost() {
    if (typeof window !== 'undefined' && window && window.document) {
      return { window, document: window.document };
    }
    const g = typeof globalThis !== 'undefined' ? globalThis : root;
    if (g && g.document) return { window: g, document: g.document };
    return { window: g || {}, document: (g && g.document) || null };
  }

  /**
   * Create a host scope bound to a specific document/window pair. Tests pass
   * a stub here; the Electron renderer passes nothing and gets the globals.
   */
  function createHost(options) {
    const opts = options || {};
    const fallback = resolveHost();

    const doc = opts.document || fallback.document;
    const win = opts.window || (doc && doc.defaultView) || fallback.window || {};

    return {
      document: doc,
      window: win,
      el: (tag, attrs, ...children) => buildInto(doc, 'html', tag, attrs, children),
      svg: (tag, attrs, ...children) => buildInto(doc, 'svg', tag, attrs, children)
    };
  }

  function buildInto(doc, kind, tag, attrs, children) {
    if (!doc || typeof doc.createElement !== 'function') {
      throw new Error('PallettAI runtime: host has no document.');
    }

    const node = kind === 'svg' && typeof doc.createElementNS === 'function'
      ? doc.createElementNS(SVG_NS, tag)
      : doc.createElement(tag);

    applyAttrs(node, attrs);
    if (children) children.forEach((c) => appendChild(node, c));
    return node;
  }

  // ------------------------------------------------------------
  // IPC bridge
  // ------------------------------------------------------------

  /**
   * Methods the dashboard may call on the backend. Anything absent is
   * replaced by a safe stub so a missing channel degrades instead of throwing.
   */
  const BRIDGE_METHODS = [
    // Compiler / editor
    'build',
    'buildSite',
    'compileIncremental',
    'onBuildProgress',
    'onWorkerMetrics',
    'onIncrementalPatch',
    // Design tokens
    'generateHarmony',
    'patchTokens',
    'applyHotPatch',
    // Window state
    'windowControl',
    'minimize',
    'maximize',
    'closeWindow'
  ];

  /**
   * Normalise any window-control shape into a single call signature.
   * The preload may expose `windowControl('minimize')`, `minimize()`, or
   * nothing at all (browser build) — all three are handled.
   */
  function makeWindowControl(api, win) {
    return (action) => {
      const name = String(action || '').toLowerCase();

      if (typeof api.windowControl === 'function') {
        return api.windowControl(name);
      }

      const direct = {
        minimize: api.minimize,
        maximize: api.maximize,
        close: api.closeWindow
      }[name];

      if (typeof direct === 'function') return direct.call(api);

      // Browser fallback: the OS window controls do not exist, so these are
      // intentionally inert rather than errors.
      if (name === 'close' && win && typeof win.close === 'function') {
        try { win.close(); } catch (_) { /* blocked by the browser */ }
      }

      return undefined;
    };
  }

  /**
   * Resolve the backend API surface.
   *
   * The task contract names `window.pallettaiAPI`; the shipping preload
   * exposes `window.pallettai`. Both are accepted, in that order, so the
   * dashboard works against the current bridge and the documented one.
   *
   * @returns {Object} normalised API with safe stubs for missing methods
   */
  function resolveBridge(options) {
    const opts = options || {};
    const host = opts.host ? opts.host : resolveHost();
    const win = (host && host.window) || {};

    const candidates = [opts.api, win.pallettaiAPI, win.pallettai, (win.parent && win.parent !== win) ? win.parent.pallettaiAPI : null];

    let source = null;
    for (const candidate of candidates) {
      if (candidate && typeof candidate === 'object') { source = candidate; break; }
    }

    const api = {};
    const missing = [];

    BRIDGE_METHODS.forEach((name) => {
      const fn = source && typeof source[name] === 'function' ? source[name] : null;
      if (fn) {
        api[name] = fn.bind(source);
      } else {
        missing.push(name);
      }
    });

    // Subscriptions must always return an unsubscribe function, otherwise the
    // dashboard leaks listeners in the browser build.
    ['onBuildProgress', 'onWorkerMetrics', 'onIncrementalPatch'].forEach((name) => {
      if (!api[name]) api[name] = () => () => {};
    });

    // Async calls must always resolve, so callers can `await` unconditionally.
    if (!api.build) {
      api.build = () => Promise.resolve({ ok: false, offline: true, reason: 'no-build-channel' });
    }
    if (!api.generateHarmony) {
      api.generateHarmony = () => Promise.resolve({ ok: false, offline: true, reason: 'no-harmony-channel' });
    }
    if (!api.patchTokens) {
      api.patchTokens = () => Promise.resolve({ ok: false, offline: true, reason: 'no-patch-channel' });
    }
    if (!api.compileIncremental) {
      api.compileIncremental = () => Promise.resolve({ ok: false, offline: true, reason: 'no-incremental-channel' });
    }

    api.windowControl = makeWindowControl(source || {}, win);

    // Introspection for the UI (and the smoke runner).
    api.__connected = !!source;
    api.__source = source ? (win.pallettaiAPI ? 'pallettaiAPI' : (win.pallettai ? 'pallettai' : 'injected')) : 'fallback';
    api.__missing = missing;
    api.__platform = (source && source.platform) || (win.pallettai && win.pallettai.platform) || 'web';

    return api;
  }

  // ------------------------------------------------------------
  // Event bus
  // ------------------------------------------------------------

  /** Minimal synchronous pub/sub with unsubscribe. */
  function createEmitter() {
    const listeners = new Map();

    return {
      on(type, handler) {
        if (typeof handler !== 'function') return () => {};
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(handler);
        return () => listeners.get(type).delete(handler);
      },
      off(type, handler) {
        const set = listeners.get(type);
        if (set) set.delete(handler);
      },
      emit(type, payload) {
        const set = listeners.get(type);
        if (!set) return 0;
        let count = 0;
        Array.from(set).forEach((handler) => {
          try { handler(payload); count++; } catch (err) {
            // One broken subscriber must not stop the others.
            if (typeof console !== 'undefined' && console.error) {
              console.error('[pallettai] listener failed for "' + type + '"', err);
            }
          }
        });
        return count;
      },
      removeAll(type) {
        if (type === undefined) listeners.clear();
        else listeners.delete(type);
      },
      count(type) {
        const set = listeners.get(type);
        return set ? set.size : 0;
      }
    };
  }

  // ------------------------------------------------------------
  // OKLCH design tokens
  // ------------------------------------------------------------

  /** Format an OKLCH triple as a CSS colour. */
  function oklch(l, c, h) {
    const lightness = clamp(Number(l), 0, 1);
    const chroma = Math.max(0, Number(c) || 0);
    const hue = ((Number(h) || 0) % 360 + 360) % 360;
    return 'oklch(' + round(lightness, 4) + ' ' + round(chroma, 4) + ' ' + round(hue, 2) + ')';
  }

  function clamp(value, min, max) {
    if (isNaN(value)) return min;
    return Math.min(max, Math.max(min, value));
  }

  function round(value, places) {
    const factor = Math.pow(10, places === undefined ? 3 : places);
    return Math.round(value * factor) / factor;
  }

  /**
   * Build the default GLM Design DNA seed. Values stay in OKLCH so the whole
   * palette is perceptually uniform and can be re-derived from one seed.
   */
  function defaultTokens() {
    return {
      seed: { l: 0.62, c: 0.16, h: 262 },
      harmony: 'analogous',
      radius: 12,
      scale: 1.25,
      archetype: 'bento-glass'
    };
  }

  /**
   * Derive a full token set (surfaces, text, borders, accent ramp) from a seed.
   * Pure function of the seed — no randomness, so builds stay reproducible.
   */
  function deriveTokenSet(tokens) {
    const t = Object.assign(defaultTokens(), tokens || {});
    const seed = t.seed || { l: 0.62, c: 0.16, h: 262 };

    const accent = oklch(seed.l, seed.c, seed.h);
    const accentHover = oklch(clamp(seed.l + 0.06, 0, 1), seed.c, seed.h);
    const accentSoft = oklch(clamp(seed.l + 0.22, 0, 0.98), seed.c * 0.5, seed.h);

    // Neutrals share the seed hue at very low chroma so the greys stay in
    // tune with the accent instead of reading as flat grey.
    const bg = oklch(0.16, 0.012, seed.h);
    const surface = oklch(0.21, 0.016, seed.h);
    const surfaceAlt = oklch(0.26, 0.02, seed.h);
    const border = oklch(0.34, 0.024, seed.h);
    const text = oklch(0.96, 0.006, seed.h);
    const textMuted = oklch(0.74, 0.014, seed.h);

    const status = {
      ok: oklch(0.72, 0.15, 152),
      warn: oklch(0.80, 0.15, 85),
      error: oklch(0.62, 0.19, 25),
      info: oklch(0.72, 0.13, 235)
    };

    return {
      seed,
      harmony: t.harmony,
      radius: t.radius,
      scale: t.scale,
      archetype: t.archetype,
      color: {
        bg, surface, surfaceAlt, border, text, textMuted,
        accent, accentHover, accentSoft, ...status
      },
      css: {
        '--pai-bg': bg,
        '--pai-surface': surface,
        '--pai-surface-alt': surfaceAlt,
        '--pai-border': border,
        '--pai-text': text,
        '--pai-text-muted': textMuted,
        '--pai-accent': accent,
        '--pai-accent-hover': accentHover,
        '--pai-accent-soft': accentSoft,
        '--pai-ok': status.ok,
        '--pai-warn': status.warn,
        '--pai-error': status.error,
        '--pai-info': status.info,
        '--pai-radius': t.radius + 'px',
        '--pai-scale': String(t.scale)
      }
    };
  }

  /**
   * Base stylesheet for the dashboard. Every colour is an OKLCH token so the
   * GLM engine can hot-swap the palette without touching layout rules.
   * No dependency on styles.css — the dashboard owns its own surface.
   */
  function baseStylesheet() {
    return [
      ':root{color-scheme:dark}',
      '*{box-sizing:border-box}',
      '.pai-shell{display:flex;height:100vh;background:var(--pai-bg);color:var(--pai-text);',
      'font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;font-size:14px}',
      '.pai-sidebar{width:232px;flex:0 0 auto;background:var(--pai-surface);',
      'border-right:1px solid var(--pai-border);display:flex;flex-direction:column;transition:width .16s ease}',
      '.pai-shell[data-collapsed="true"] .pai-sidebar{width:56px}',
      '.pai-brand{padding:14px 16px;font-weight:600;letter-spacing:.01em;white-space:nowrap;overflow:hidden}',
      '.pai-nav{display:flex;flex-direction:column;gap:2px;padding:8px}',
      '.pai-nav-item{display:flex;align-items:center;gap:10px;padding:9px 12px;border:0;',
      'background:transparent;color:var(--pai-text-muted);border-radius:calc(var(--pai-radius) * .5);',
      'cursor:pointer;text-align:left;font:inherit;white-space:nowrap;overflow:hidden}',
      '.pai-nav-item:hover{background:var(--pai-surface-alt);color:var(--pai-text)}',
      '.pai-nav-item[aria-current="page"]{background:var(--pai-accent-soft);color:var(--pai-text);',
      'box-shadow:inset 2px 0 0 var(--pai-accent)}',
      '.pai-sidebar-footer{margin-top:auto;padding:8px;border-top:1px solid var(--pai-border)}',
      '.pai-main{flex:1 1 auto;display:flex;flex-direction:column;min-width:0}',
      '.pai-titlebar{display:flex;align-items:center;gap:10px;padding:10px 14px;',
      'background:var(--pai-surface);border-bottom:1px solid var(--pai-border)}',
      '.pai-view-title{font-weight:600;flex:1 1 auto}',
      '.pai-window-controls{display:flex;gap:6px}',
      '.pai-window-controls button{width:28px;height:24px;border:1px solid var(--pai-border);',
      'background:var(--pai-surface-alt);color:var(--pai-text-muted);border-radius:6px;cursor:pointer;font:inherit}',
      '.pai-window-controls button:hover{color:var(--pai-text);border-color:var(--pai-accent)}',
      '.pai-view{flex:1 1 auto;overflow:auto;padding:16px}',
      '.pai-card{background:var(--pai-surface);border:1px solid var(--pai-border);',
      'border-radius:var(--pai-radius);padding:14px;margin-bottom:12px}',
      '.pai-card h3{margin:0 0 10px;font-size:13px;text-transform:uppercase;letter-spacing:.06em;',
      'color:var(--pai-text-muted);font-weight:600}',
      '.pai-grid{display:grid;gap:12px}',
      '.pai-editor{display:grid;grid-template-columns:260px 1fr 1fr;gap:12px;height:100%}',
      '.pai-palette{display:flex;flex-direction:column;gap:6px}',
      '.pai-block{display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px dashed var(--pai-border);',
      'border-radius:calc(var(--pai-radius) * .5);cursor:grab;background:var(--pai-surface-alt);font:inherit;',
      'color:var(--pai-text);text-align:left}',
      '.pai-canvas{min-height:220px;border:1px solid var(--pai-border);border-radius:var(--pai-radius);',
      'padding:8px;display:flex;flex-direction:column;gap:6px;background:var(--pai-bg)}',
      '.pai-canvas[data-dropactive="true"]{border-color:var(--pai-accent);background:var(--pai-accent-soft)}',
      '.pai-canvas-item{display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--pai-surface);',
      'border:1px solid var(--pai-border);border-radius:calc(var(--pai-radius) * .6);cursor:grab}',
      '.pai-canvas-item[data-dragging="true"]{opacity:.5}',
      '.pai-canvas-item-label{flex:1 1 auto}',
      '.pai-preview{width:100%;height:100%;min-height:260px;border:1px solid var(--pai-border);',
      // The preview frame is a light page canvas, so it stays white on purpose —
      // written in OKLCH like every other colour so the stylesheet has exactly
      // one colour space and the GLM engine can retune it from the token block.
      'border-radius:var(--pai-radius);background:oklch(1 0 0)}',
      '.pai-field{display:flex;align-items:center;gap:10px;margin-bottom:10px}',
      '.pai-field label{flex:0 0 92px;color:var(--pai-text-muted)}',
      '.pai-field output{min-width:64px;font-variant-numeric:tabular-nums;color:var(--pai-text)}',
      '.pai-field input[type="range"]{flex:1 1 auto;accent-color:var(--pai-accent)}',
      '.pai-swatch{width:100%;height:52px;border-radius:calc(var(--pai-radius) * .5);',
      'border:1px solid var(--pai-border)}',
      '.pai-btn{border:1px solid var(--pai-border);background:var(--pai-surface-alt);color:var(--pai-text);',
      'border-radius:calc(var(--pai-radius) * .5);padding:7px 12px;cursor:pointer;font:inherit}',
      '.pai-btn:hover{border-color:var(--pai-accent)}',
      '.pai-btn[data-variant="primary"]{background:var(--pai-accent);border-color:var(--pai-accent);color:var(--pai-bg)}',
      '.pai-kpi{display:flex;flex-direction:column;gap:2px}',
      '.pai-kpi .v{font-size:22px;font-variant-numeric:tabular-nums}',
      '.pai-kpi .k{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--pai-text-muted)}',
      '.pai-log{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.55;',
      'background:var(--pai-bg);border:1px solid var(--pai-border);border-radius:calc(var(--pai-radius) * .5);',
      'padding:10px;height:200px;overflow:auto;white-space:pre-wrap}',
      '.pai-log[data-level="error"]{color:var(--pai-error)}',
      '.pai-log[data-level="warn"]{color:var(--pai-warn)}',
      '.pai-log[data-level="ok"]{color:var(--pai-ok)}',
      '.pai-log-row[data-level="error"]{color:var(--pai-error)}',
      '.pai-log-row[data-level="warn"]{color:var(--pai-warn)}',
      '.pai-log-row[data-level="ok"]{color:var(--pai-ok)}',
      '.pai-log-row[data-level="info"]{color:var(--pai-text-muted)}',
      '.pai-status{font-size:12px;color:var(--pai-text-muted)}',
      '.pai-status[data-state="ok"]{color:var(--pai-ok)}',
      '.pai-status[data-state="warn"]{color:var(--pai-warn)}',
      '.pai-chart{width:100%;height:auto;display:block}',
      '.pai-visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}'
    ].join('\n');
  }

  /**
   * Inject (or refresh) the dashboard stylesheet plus the OKLCH token block.
   * Returns the style element so callers can update the tokens in place.
   */
  function installStyles(doc, tokens) {
    const target = doc || resolveDocument();
    const STYLE_ID = 'pai-dashboard-styles';
    const TOKEN_ID = 'pai-dashboard-tokens';

    let tokenBlock = target.getElementById ? target.getElementById(TOKEN_ID) : null;
    if (!tokenBlock) {
      tokenBlock = target.createElement('style');
      tokenBlock.setAttribute('id', TOKEN_ID);
      appendChild(target.head || target.body || target.documentElement, tokenBlock);
    }
    tokenBlock.textContent = tokensToCss(tokens);

    let sheet = target.getElementById ? target.getElementById(STYLE_ID) : null;
    if (!sheet) {
      sheet = target.createElement('style');
      sheet.setAttribute('id', STYLE_ID);
      sheet.textContent = baseStylesheet();
      appendChild(target.head || target.body || target.documentElement, sheet);
    }

    return { sheet, tokenBlock };
  }

  /** Serialise a token set's custom properties into a `:root{}` block. */
  function tokensToCss(tokens) {
    const set = deriveTokenSet(tokens);
    const body = Object.keys(set.css)
      .map((prop) => '  ' + prop + ': ' + set.css[prop] + ';')
      .join('\n');
    return ':root {\n' + body + '\n}';
  }

  // ------------------------------------------------------------
  // Public surface
  // ------------------------------------------------------------

  const runtime = {
    SVG_NS,

    // DOM
    el, svg: svgEl, clear, on, matches, appendChild, applyAttrs, createHost,

    // Bridge
    resolveBridge, createEmitter, BRIDGE_METHODS,

    // Tokens
    oklch, defaultTokens, deriveTokenSet, tokensToCss, baseStylesheet,
    installStyles, clamp, round
  };

  if (root) root.PallettAIDashboardRuntime = runtime;
  if (typeof module !== 'undefined' && module.exports) module.exports = runtime;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null));
