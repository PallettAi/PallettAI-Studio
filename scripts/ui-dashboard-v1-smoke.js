#!/usr/bin/env node
// ============================================================
// Dashboard UI v1 smoke test — the renderer half of v0.6.0.
//
// The four `ui/` modules need two things the repo does not ship: a DOM and
// `window.pallettaiAPI`. Both are faked here, because the failure modes that
// matter are invisible to a static read of the source:
//
//   1. The router can be wired in one file and unreachable from another. All
//      four views must actually mount, and the shell has to survive a view
//      whose mount() throws.
//   2. Every bridge method is a place the UI can die on `undefined is not a
//      function`. The same interactions are exercised twice — once against a
//      full mock IPC bridge, once against a bridge that has no methods at
//      all — and both must complete without throwing.
//   3. Schema generation is a data contract with the AST compiler. It is
//      asserted as JSON, not as a string.
//
// Run: node scripts/ui-dashboard-v1-smoke.js
// ============================================================

'use strict';

const path = require('path');

const ROOT = path.join(__dirname, '..');

let failed = 0;
let passed = 0;

function pass(name) { passed++; console.log('  \u2713 ' + name); }
function fail(name, detail) {
  failed++;
  console.error('  \u2717 ' + name + (detail ? '  -> ' + detail : ''));
}
function ok(name, cond, detail) { cond ? pass(name) : fail(name, detail); }
function assert(cond, name) { ok(name, !!cond); }

function group(title) { console.log('\n== ' + title + ' =='); }

function section(title) { console.log('\n-- ' + title + ' --'); }

// ============================================================
// 1. Headless DOM
//
// Deliberately hand-rolled rather than pulling in jsdom: the repo ships no
// DOM dependency and every other smoke test here is dependency-free. It is
// only as large as the four modules actually need, but the parts it does
// implement (class/attribute selectors, closest, events, style properties)
// behave like the real thing so a passing test means something.
// ============================================================

function createStyle() {
  return (function () {
    const props = {};
    return {
      setProperty(name, value) { props[name] = String(value); },
      getPropertyValue(name) { return props[name] === undefined ? '' : props[name]; },
      removeProperty(name) { delete props[name]; },
      get cssText() {
        return Object.keys(props).map((k) => k + ':' + props[k]).join(';');
      },
      _props: props
    };
  })();
}

/** Simple selector parser: tag, .class, #id, [attr], [attr="v"], and chains. */
function parseSelector(selector) {
  return String(selector).trim().split(/\s+/).filter(Boolean).map((part) => {
    const out = { tag: null, classes: [], id: null, attrs: [] };
    const re = /([a-zA-Z][\w-]*)|\.([\w-]+)|#([\w-]+)|\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/g;
    let match;
    while ((match = re.exec(part)) !== null) {
      if (match[1]) out.tag = match[1].toUpperCase();
      else if (match[2]) out.classes.push(match[2]);
      else if (match[3]) out.id = match[3];
      else if (match[4]) {
        out.attrs.push({
          name: match[4],
          value: match[5] !== undefined ? match[5]
            : (match[6] !== undefined ? match[6]
              : (match[7] !== undefined ? match[7] : null))
        });
      }
    }
    return out;
  });
}

function matchesSimple(node, part) {
  if (!node || node.nodeType !== 1) return false;
  if (part.tag && node.tagName !== part.tag) return false;
  if (part.id && node.getAttribute('id') !== part.id) return false;
  for (let i = 0; i < part.classes.length; i++) {
    if (node._classes.indexOf(part.classes[i]) === -1) return false;
  }
  for (let i = 0; i < part.attrs.length; i++) {
    const attr = part.attrs[i];
    if (!node.hasAttribute(attr.name)) return false;
    if (attr.value !== null && node.getAttribute(attr.name) !== attr.value) return false;
  }
  return true;
}

function matchesSelector(node, selector) {
  const parts = parseSelector(selector);
  if (!parts.length) return false;

  let index = parts.length - 1;
  if (!matchesSimple(node, parts[index])) return false;
  index--;

  let current = node;
  while (index >= 0) {
    let ancestor = current.parentNode;
    let found = null;
    while (ancestor && ancestor.nodeType === 1) {
      if (matchesSimple(ancestor, parts[index])) { found = ancestor; break; }
      ancestor = ancestor.parentNode;
    }
    if (!found) return false;
    current = found;
    index--;
  }
  return true;
}

function collectDescendants(node, out) {
  const kids = node.childNodes || [];
  for (let i = 0; i < kids.length; i++) {
    if (kids[i].nodeType === 1) {
      out.push(kids[i]);
      collectDescendants(kids[i], out);
    }
  }
  return out;
}

function createDom() {
  const win = {};

  function makeText(value) {
    return {
      nodeType: 3,
      _parent: null,
      get parentNode() { return this._parent; },
      textContent: String(value),
      get nodeValue() { return this.textContent; },
      remove() {
        if (this._parent) this._parent.removeChild(this);
      }
    };
  }

  function makeElement(tagName, namespace) {
    const node = {
      nodeType: 1,
      tagName: String(tagName).toUpperCase(),
      localName: String(tagName).toLowerCase(),
      namespaceURI: namespace || null,
      ownerDocument: doc,
      childNodes: [],
      _attributes: {},
      _classes: [],
      _listeners: {},
      _parent: null,
      _value: undefined,
      scrollTop: 0,
      scrollHeight: 0,
      style: createStyle()
    };

    Object.defineProperty(node, 'parentNode', { enumerable: true, get: () => node._parent });
    Object.defineProperty(node, 'firstChild', {
      enumerable: true,
      get: () => (node.childNodes.length ? node.childNodes[0] : null)
    });
    Object.defineProperty(node, 'lastChild', {
      enumerable: true,
      get: () => (node.childNodes.length ? node.childNodes[node.childNodes.length - 1] : null)
    });
    Object.defineProperty(node, 'children', {
      enumerable: true,
      get: () => collectDescendants({ childNodes: node.childNodes }, [])
    });

    Object.defineProperty(node, 'classList', {
      enumerable: true,
      get: () => ({
        add(...names) {
          names.forEach((n) => { if (node._classes.indexOf(n) === -1) node._classes.push(n); });
        },
        remove(...names) {
          node._classes = node._classes.filter((c) => names.indexOf(c) === -1);
        },
        contains(name) { return node._classes.indexOf(name) !== -1; },
        toggle(name) {
          if (node._classes.indexOf(name) === -1) node._classes.push(name);
          else node._classes = node._classes.filter((c) => c !== name);
        }
      })
    });

    Object.defineProperty(node, 'className', {
      enumerable: true,
      get: () => node._classes.join(' '),
      set: (value) => { node._classes = String(value).split(/\s+/).filter(Boolean); }
    });

    Object.defineProperty(node, 'textContent', {
      enumerable: true,
      get: () => node.childNodes.map((c) => c.textContent).join(''),
      set: (value) => {
        node.childNodes.forEach((c) => { c._parent = null; });
        node.childNodes = [];
        const text = makeText(value);
        text._parent = node;
        node.childNodes.push(text);
      }
    });

    Object.defineProperty(node, 'innerHTML', {
      enumerable: true,
      get: () => node.childNodes.map((c) => c.textContent).join('')
    });

    node.setAttribute = (name, value) => {
      const key = String(name);
      node._attributes[key] = String(value);
      if (key === 'class') node._classes = String(value).split(/\s+/).filter(Boolean);
    };
    node.getAttribute = (name) => (node._attributes[String(name)] === undefined ? null : node._attributes[String(name)]);
    node.hasAttribute = (name) => Object.prototype.hasOwnProperty.call(node._attributes, String(name));
    node.removeAttribute = (name) => {
      delete node._attributes[String(name)];
      if (String(name) === 'class') node._classes = [];
    };

    node.appendChild = (child) => {
      if (child._parent) child._parent.removeChild(child);
      child._parent = node;
      node.childNodes.push(child);
      return child;
    };
    node.insertBefore = (child, reference) => {
      const at = node.childNodes.indexOf(reference);
      if (child._parent) child._parent.removeChild(child);
      child._parent = node;
      if (at === -1) node.childNodes.push(child);
      else node.childNodes.splice(at, 0, child);
      return child;
    };
    node.removeChild = (child) => {
      const at = node.childNodes.indexOf(child);
      if (at === -1) return child;
      node.childNodes.splice(at, 1);
      child._parent = null;
      return child;
    };
    node.remove = () => { if (node._parent) node._parent.removeChild(node); };

    node.addEventListener = (type, handler) => {
      if (!node._listeners[type]) node._listeners[type] = [];
      node._listeners[type].push(handler);
    };
    node.removeEventListener = (type, handler) => {
      const list = node._listeners[type];
      if (!list) return;
      node._listeners[type] = list.filter((h) => h !== handler);
    };
    node.dispatchEvent = (event) => {
      const list = node._listeners[event && event.type ? event.type : event] || [];
      list.slice().forEach((handler) => handler(event));
      return true;
    };

    node.matches = (selector) => matchesSelector(node, selector);
    node.closest = (selector) => {
      let current = node;
      while (current && current.nodeType === 1) {
        if (matchesSelector(current, selector)) return current;
        current = current.parentNode;
      }
      return null;
    };
    node.querySelector = (selector) => node.querySelectorAll(selector)[0] || null;
    node.querySelectorAll = (selector) => collectDescendants(node, []).filter((el) => matchesSelector(el, selector));

    // `value` mirrors the attribute the way an input does, and a <select>
    // reports the option carrying `selected`.
    Object.defineProperty(node, 'value', {
      get() {
        if (node._value !== undefined) return node._value;
        if (node.tagName === 'SELECT') {
          const opts = collectDescendants(node, []).filter((el) => el.tagName === 'OPTION');
          const chosen = opts.filter((el) => el.hasAttribute('selected'))[0];
          if (chosen) return chosen.getAttribute('value');
          return opts.length ? opts[0].getAttribute('value') : '';
        }
        const attr = node.getAttribute('value');
        return attr === null ? '' : attr;
      },
      set(v) { node._value = String(v); }
    });

    // iframes are inert here; the editor only needs srcdoc + contentWindow.
    if (node.tagName === 'IFRAME') {
      node.contentWindow = { postMessage() {} };
    }

    return node;
  }

  const doc = {
    nodeType: 9,
    defaultView: win,
    _listeners: {}
  };

  const html = makeElement('html');
  const head = makeElement('head');
  const body = makeElement('body');
  html._parent = doc;
  head._parent = html;
  body._parent = html;
  html.childNodes.push(head, body);

  doc.documentElement = html;
  doc.head = head;
  doc.body = body;

  doc.createElement = (tag) => makeElement(tag);
  doc.createElementNS = (ns, tag) => makeElement(tag, ns);
  doc.createTextNode = (value) => makeText(value);
  doc.createDocumentFragment = () => {
    const fragment = makeElement('#fragment');
    return fragment;
  };
  doc.getElementById = (id) => collectDescendants(html, []).filter((el) => el.getAttribute('id') === id)[0] || null;
  doc.querySelector = (selector) => doc.querySelectorAll(selector)[0] || null;
  doc.querySelectorAll = (selector) => collectDescendants(html, []).filter((el) => matchesSelector(el, selector));
  doc.addEventListener = (type, handler) => {
    if (!doc._listeners[type]) doc._listeners[type] = [];
    doc._listeners[type].push(handler);
  };
  doc.removeEventListener = (type, handler) => {
    const list = doc._listeners[type];
    if (list) doc._listeners[type] = list.filter((h) => h !== handler);
  };

  win.document = doc;
  win.location = { hash: '' };
  win._listeners = {};
  win.addEventListener = (type, handler) => {
    if (!win._listeners[type]) win._listeners[type] = [];
    win._listeners[type].push(handler);
  };
  win.removeEventListener = (type, handler) => {
    const list = win._listeners[type];
    if (list) win._listeners[type] = list.filter((h) => h !== handler);
  };
  win.dispatchEvent = (event) => {
    const list = win._listeners[event.type] || [];
    list.slice().forEach((handler) => handler(event));
    return true;
  };
  win.postMessage = (message) => { win._lastMessage = message; };
  win.close = () => { win._closed = true; };

  return { document: doc, window: win };
}

/** Let pending promise chains settle (mount() loads harmony asynchronously). */
function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Fire a DOM event at a node with a `target` already attached. */
function fire(node, type, extra) {
  const event = Object.assign({
    type,
    target: node,
    preventDefault() {},
    stopPropagation() {}
  }, extra || {});
  node.dispatchEvent(event);
  return event;
}

// ============================================================
// 2. Mock IPC bridge
// ============================================================

/** A full mock of the v0.5.0-rc1 bridge that records every call. */
function createMockBridge(overrides) {
  const calls = { build: [], generateHarmony: [], patchTokens: [], windowControl: [] };
  const offs = { buildProgress: [], workerMetrics: [], incremental: [] };

  const bridge = {
    calls,
    subscriptions: offs,

    build(payload) {
      calls.build.push(payload);
      return Promise.resolve({ ok: true, ms: 37, html: '<h1>compiled by mock</h1>' });
    },
    generateHarmony(seed, scheme, count) {
      calls.generateHarmony.push({ seed, scheme, count });
      return Promise.resolve({
        ok: true,
        scheme,
        swatches: [
          { role: 'primary', hex: '#5b6cff', l: 0.62, c: 0.16, h: 262 },
          { role: 'swatch-1', hex: '#ff6b8b', l: 0.62, c: 0.16, h: 82 }
        ]
      });
    },
    patchTokens(payload) {
      calls.patchTokens.push(payload);
      return Promise.resolve({ ok: true, ms: 4 });
    },
    compileIncremental(payload) {
      return Promise.resolve({ ok: true, patch: { type: 'html', html: '<p>inc</p>' } });
    },
    windowControl(action) {
      calls.windowControl.push(action);
      return { ok: true, action };
    },
    onBuildProgress(handler) {
      offs.buildProgress.push(handler);
      return () => { offs.buildProgress = offs.buildProgress.filter((h) => h !== handler); };
    },
    onWorkerMetrics(handler) {
      offs.workerMetrics.push(handler);
      return () => { offs.workerMetrics = offs.workerMetrics.filter((h) => h !== handler); };
    },
    onIncrementalPatch(handler) {
      offs.incremental.push(handler);
      return () => { offs.incremental = offs.incremental.filter((h) => h !== handler); };
    },

    /** Simulate the backend pushing an event over IPC. */
    emitBuildProgress(payload) { offs.buildProgress.forEach((h) => h(payload)); },
    emitWorkerMetrics(payload) { offs.workerMetrics.forEach((h) => h(payload)); },
    emitIncrementalPatch(patch) { offs.incremental.forEach((h) => h(patch)); }
  };

  return Object.assign(bridge, overrides || {});
}

// ============================================================
// 3. Load the modules under test
// ============================================================

const runtime = require(path.join(ROOT, 'ui', 'runtime.js'));
const appShell = require(path.join(ROOT, 'ui', 'app-shell.js'));
const visualEditor = require(path.join(ROOT, 'ui', 'visual-editor.js'));
const tokenPanel = require(path.join(ROOT, 'ui', 'token-panel.js'));
const telemetry = require(path.join(ROOT, 'ui', 'telemetry-dashboard.js'));

// ============================================================
// Runner
// ============================================================

async function main() {
  // ----------------------------------------------------------
  group('Task 1 — runtime primitives');
  // ----------------------------------------------------------

  {
    const dom = createDom();
    const host = runtime.createHost(dom);
    const div = host.el('div', { class: 'pai-card', 'data-x': '1' }, 'hello');
    ok('createHost builds elements', div.tagName === 'DIV');
    ok('class attribute populates classList', div.classList.contains('pai-card'));
    ok('data attributes are set', div.getAttribute('data-x') === '1');
    ok('children become text content', div.textContent === 'hello');

    const svg = host.svg('svg', { viewBox: '0 0 10 10' });
    ok('svg builds in the SVG namespace', svg.namespaceURI === runtime.SVG_NS);

    ok('oklch() formats a colour', runtime.oklch(0.62, 0.16, 262) === 'oklch(0.62 0.16 262)');
    ok('oklch() wraps the hue', /oklch\([\d.]+ [\d.]+ 10\)/.test(runtime.oklch(0.5, 0.1, 370)));
    ok('clamp() bounds values', runtime.clamp(5, 0, 1) === 1);

    const derived = runtime.deriveTokenSet({ seed: { l: 0.6, c: 0.2, h: 30 } });
    const colourProps = Object.keys(derived.css).filter((k) => !/radius|scale/.test(k));
    ok('deriveTokenSet emits colour tokens', colourProps.length >= 10);
    ok('every colour token is OKLCH', colourProps.every((k) => /^oklch\(/.test(derived.css[k])),
      colourProps.filter((k) => !/^oklch\(/.test(derived.css[k])).join(','));
    ok('deriveTokenSet is deterministic',
      runtime.deriveTokenSet({ seed: { l: 0.6, c: 0.2, h: 30 } }).css['--pai-accent'] === derived.css['--pai-accent']);
    ok('different seeds give different accents',
      runtime.deriveTokenSet({ seed: { l: 0.6, c: 0.2, h: 200 } }).css['--pai-accent'] !== derived.css['--pai-accent']);
    ok('tokensToCss wraps a :root block', /^:root \{[\s\S]*\}$/.test(runtime.tokensToCss()));

    const sheet = runtime.baseStylesheet();
    ok('stylesheet declares OKLCH colour-scheme', /color-scheme:dark/.test(sheet));
    ok('stylesheet has no hard-coded hex colours', !/#[0-9a-fA-F]{3,8}\b/.test(sheet));
    ok('stylesheet has no rgb()/hsl() colours', !/\b(rgba?|hsla?)\(/.test(sheet));
    ok('stylesheet colours come from tokens', /var\(--pai-accent\)/.test(sheet) && /var\(--pai-bg\)/.test(sheet));
  }

  {
    // Offline resolution: no bridge on the window at all.
    const dom = createDom();
    const api = runtime.resolveBridge({ host: { document: dom.document, window: dom.window } });
    ok('missing bridge is reported as disconnected', api.__connected === false);
    ok('missing bridge reports a fallback source', api.__source === 'fallback');
    ok('bridge lists the methods it could not find', Array.isArray(api.__missing) && api.__missing.length > 0);
    ok('build() still resolves offline', typeof api.build === 'function');

    const offline = await api.build({ schema: [] });
    ok('offline build resolves instead of rejecting', offline.ok === false && offline.offline === true);
    const off = api.onBuildProgress(() => {});
    ok('event subscriptions always return an unsubscribe function', typeof off === 'function');
    ok('windowControl exists offline', typeof api.windowControl === 'function');
    api.windowControl('minimize'); // must not throw
    pass('windowControl is inert without a bridge');

    const harmony = await api.generateHarmony({ l: 0.5, c: 0.1, h: 10 }, 'triadic', 5);
    ok('offline harmony resolves with an offline flag', harmony.offline === true);
  }

  {
    const dom = createDom();
    dom.window.pallettaiAPI = createMockBridge();
    const api = runtime.resolveBridge({ host: { document: dom.document, window: dom.window } });
    ok('mock bridge is detected', api.__connected === true);
    ok('bridge source is named pallettaiAPI', api.__source === 'pallettaiAPI');
  }

  {
    const bus = runtime.createEmitter();
    let seen = null;
    const off = bus.on('ping', (payload) => { seen = payload; });
    ok('emitter delivers payloads', bus.emit('ping', 42) === 1 && seen === 42);
    off();
    ok('unsubscribe stops delivery', bus.emit('ping', 7) === 0);
    bus.on('boom', () => { throw new Error('bad listener'); });
    ok('a throwing listener does not break emit', typeof bus.emit('boom') === 'number');
  }

  // ----------------------------------------------------------
  group('Task 2 — app shell, router and window controls');
  // ----------------------------------------------------------

  {
    const dom = createDom();
    dom.window.pallettaiAPI = createMockBridge();
    const mountedViews = [];

    const shell = appShell.createAppShell({
      host: { document: dom.document, window: dom.window },
      syncHash: true,
      views: [
        { id: 'workspace', mount: (c) => { mountedViews.push('workspace'); c.appendChild(dom.document.createElement('p')); } },
        { id: 'design-tokens', mount: (c) => { mountedViews.push('design-tokens'); c.appendChild(dom.document.createElement('p')); } },
        { id: 'seo-content', mount: (c) => { mountedViews.push('seo-content'); c.appendChild(dom.document.createElement('p')); } },
        { id: 'telemetry', mount: (c) => { mountedViews.push('telemetry'); c.appendChild(dom.document.createElement('p')); } }
      ]
    });

    const element = shell.mount(dom.document.body);
    ok('shell renders .pai-shell', element.classList.contains('pai-shell'));
    ok('sidebar renders', !!element.querySelector('.pai-sidebar'));
    ok('main region renders', !!element.querySelector('.pai-main'));

    const views = shell.listViews();
    ok('all four primary views are registered', views.length === 4, views.join(','));
    ['workspace', 'design-tokens', 'seo-content', 'telemetry'].forEach((id) => {
      ok('view "' + id + '" is registered', views.indexOf(id) !== -1);
    });
    ok('the router mounts a view at startup', shell.getActiveView() === 'workspace');

    // --- the 4 routes actually mount ---
    const order = ['workspace', 'design-tokens', 'seo-content', 'telemetry'];
    order.forEach((id) => {
      const navigated = shell.navigate(id);
      ok('navigate("' + id + '") succeeds', navigated === true);
      ok('"' + id + '" becomes the active view', shell.getActiveView() === id);
      ok('the view host is tagged for "' + id + '"', shell.getViewHost().getAttribute('data-view') === id);
      ok('the title bar names "' + id + '"',
        shell.getElement().querySelector('[data-role="view-title"]').textContent ===
          appShell.DEFAULT_VIEWS.filter((v) => v.id === id)[0].label);
    });
    ok('every view mount() was invoked', order.every((id) => mountedViews.indexOf(id) !== -1),
      mountedViews.join(','));

    // --- nav highlighting ---
    const activeNav = shell.getElement().querySelectorAll('.pai-nav-item')
      .filter((b) => b.getAttribute('aria-current') === 'page');
    ok('exactly one nav item is current', activeNav.length === 1, String(activeNav.length));
    ok('the current nav item is the active view', activeNav[0].getAttribute('data-view') === 'telemetry');

    // --- aliases, so native-menu deep links keep working ---
    [
      ['tokens', 'design-tokens'], ['design', 'design-tokens'],
      ['seo', 'seo-content'], ['content', 'seo-content'],
      ['metrics', 'telemetry'], ['build', 'telemetry'],
      ['editor', 'workspace'], ['canvas', 'workspace']
    ].forEach(([alias, target]) => {
      shell.navigate(alias);
      ok('alias "' + alias + '" routes to ' + target, shell.getActiveView() === target, shell.getActiveView());
    });
    ok('an unknown view is rejected', shell.navigate('does-not-exist') === false);

    // --- collapse ---
    shell.setCollapsed(true);
    ok('collapse sets data-collapsed', shell.getElement().getAttribute('data-collapsed') === 'true');
    ok('collapse updates aria-expanded',
      shell.getElement().querySelector('[data-action="toggle-sidebar"]').getAttribute('aria-expanded') === 'false');
    shell.setCollapsed(false);
    ok('expand restores data-collapsed', shell.getElement().getAttribute('data-collapsed') === 'false');

    // --- window state via IPC ---
    const shellEl = shell.getElement();
    ['minimize', 'maximize', 'close'].forEach((action) => {
      const button = shellEl.querySelector('[data-window-action="' + action + '"]');
      ok('title bar has a ' + action + ' control', !!button);
      fire(button, 'click');
    });
    ok('each window control reached the IPC bridge',
      dom.window.pallettaiAPI.calls.windowControl.join(',') === 'minimize,maximize,close',
      dom.window.pallettaiAPI.calls.windowControl.join(','));
    ok('shell reports the mock bridge as connected', shell.getApi().__connected === true);
    ok('bridge status text names the source',
      /pallettaiAPI/.test(shell.getElement().querySelector('[data-role="bridge-status"]').textContent));

    // --- hash sync ---
    ok('active view is mirrored to the location hash', dom.window.location.hash === '#workspace');

    // --- a view host is replaced, not stacked ---
    ok('the view host holds exactly one child', shell.getViewHost().childNodes.length === 1);

    shell.destroy();
    ok('destroy detaches the shell', shell.isMounted() === false);
  }

  {
    // A view that throws must not take the dashboard down.
    const dom = createDom();
    const shell = appShell.createAppShell({
      host: { document: dom.document, window: dom.window },
      views: [{ id: 'seo-content', mount: () => { throw new Error('view exploded'); } }]
    });
    shell.mount(dom.document.body);
    const reached = shell.navigate('seo-content');
    ok('a throwing view still navigates', reached === true);
    ok('the shell renders an error panel instead of crashing',
      !!shell.getViewHost().querySelector('[data-view-error="seo-content"]'));
    ok('the error panel carries the message',
      /view exploded/.test(shell.getViewHost().textContent));

    // A view with no module registered must still render something.
    shell.navigate('telemetry');
    ok('a view without a module falls back to a placeholder',
      !!shell.getViewHost().querySelector('[data-placeholder="telemetry"]'));
    ok('the shell is still functional after a failed view', shell.getActiveView() === 'telemetry');
  }

  {
    // Runtime view registration + teardown.
    const dom = createDom();
    let tornDown = false;
    const shell = appShell.createAppShell({ host: { document: dom.document, window: dom.window } });
    shell.mount(dom.document.body);

    shell.registerView({ id: 'custom', label: 'Custom', mount(c) { c.appendChild(dom.document.createElement('i')); return () => { tornDown = true; }; } });
    ok('registerView adds the route', shell.listViews().indexOf('custom') !== -1);
    ok('registerView adds a nav button', !!shell.getElement().querySelector('[data-view="custom"]'));
    shell.navigate('custom');
    ok('a runtime-registered view mounts', shell.getActiveView() === 'custom');
    shell.navigate('workspace');
    ok('navigating away runs the view cleanup function', tornDown === true);
    ok('unregisterView removes the route', shell.unregisterView('custom') === true);
    ok('the nav button is removed too', !shell.getElement().querySelector('[data-view="custom"]'));

    const imported = [
      require(path.join(ROOT, 'ui', 'runtime.js')),
      require(path.join(ROOT, 'ui', 'app-shell.js')),
      require(path.join(ROOT, 'ui', 'visual-editor.js')),
      require(path.join(ROOT, 'ui', 'token-panel.js')),
      require(path.join(ROOT, 'ui', 'telemetry-dashboard.js'))
    ];
    ok('every ui module exports an object', imported.every((m) => m && typeof m === 'object'));
    shell.destroy();
  }

  // ----------------------------------------------------------
  group('Task 3 — visual block editor');
  // ----------------------------------------------------------

  {
    const dom = createDom();
    dom.window.pallettaiAPI = createMockBridge();
    const editor = visualEditor.createVisualEditor({
      host: { document: dom.document, window: dom.window }
    });

    const layout = editor.mount(dom.document.body);
    ok('editor renders its layout', layout.getAttribute('data-role') === 'visual-editor');
    ok('palette renders every library block',
      editor.getElement().querySelectorAll('.pai-block').length === visualEditor.BLOCK_LIBRARY.length);
    ok('canvas starts empty', editor.getCanvas().getAttribute('data-count') === '0');
    ok('an empty canvas explains itself', !!editor.getCanvas().querySelector('[data-role="canvas-empty"]'));

    // --- schema generation ---
    editor.addBlock('hero');
    editor.addBlock('features');
    editor.addBlock('footer');

    let schema = editor.toSchema();
    ok('toSchema() returns an array', Array.isArray(schema));
    ok('toSchema() has one entry per canvas block', schema.length === 3);
    ok('schema entries carry id/type/order/props',
      schema.every((b) => typeof b.id === 'string' && typeof b.type === 'string' &&
        typeof b.order === 'number' && b.props && typeof b.props === 'object'));
    ok('schema order is sequential', schema.map((b) => b.order).join(',') === '0,1,2');
    ok('schema order matches visual order',
      schema.map((b) => b.type).join(',') === 'hero,features,footer');
    ok('schema strings survive JSON round-trip',
      JSON.stringify(JSON.parse(JSON.stringify(schema))) === JSON.stringify(schema));
    ok('schema is JSON-serialisable without undefined', !JSON.stringify(schema).includes('undefined'));
    ok('each block gets a unique id', new Set(schema.map((b) => b.id)).size === 3);

    ok('canvas reflects the block count', editor.getCanvas().getAttribute('data-count') === '3');
    ok('canvas renders one item per block', editor.getCanvas().querySelectorAll('.pai-canvas-item').length === 3);

    // --- payload for the AST compiler ---
    const payload = editor.toPayload();
    ok('payload is JSON-serialisable', JSON.stringify(payload).length > 0);
    ok('payload targets the DeepSeek AST compiler', payload.target === 'deepseek-ast');
    ok('payload carries the schema array', Array.isArray(payload.schema) && payload.schema.length === 3);
    ok('payload carries OKLCH design tokens', /^oklch\(/.test(payload.tokens['--pai-accent']));
    ok('payload reports the block count', payload.meta.blocks === 3);

    // --- reorder / move ---
    const heroId = schema[0].id;
    ok('moveBlock() moves a block', editor.moveBlock(heroId, 2) === true);
    ok('the block landed at the end',
      editor.toSchema().map((b) => b.type).join(',') === 'features,footer,hero');
    ok('order is renumbered after a move',
      editor.toSchema().map((b) => b.order).join(',') === '0,1,2');
    ok('reorder() to the same index is a no-op', editor.reorder(heroId, 2) === false);
    const firstId = editor.toSchema()[0].id;
    ok('reorder() clamps out-of-range indexes',
      editor.reorder(firstId, 99) === true && editor.toSchema().slice(-1)[0].id === firstId);
    ok('a clamped reorder lands on the last slot',
      editor.toSchema().map((b) => b.type).join(',') === 'footer,hero,features',
      editor.toSchema().map((b) => b.type).join(','));
    ok('moveBlock() on an unknown id is safe', editor.moveBlock('nope', 1) === false);

    // --- props ---
    const featuresId = editor.toSchema().filter((b) => b.type === 'features')[0].id;
    ok('setProps() merges into existing props', editor.setProps(featuresId, { heading: 'Merged heading' }) === true);
    const merged = editor.toSchema().filter((b) => b.type === 'features')[0];
    ok('the override is applied', merged.props.heading === 'Merged heading');
    ok('untouched defaults survive the merge', merged.props.items === 3);
    ok('setProps() on an unknown id is safe', editor.setProps('nope', {}) === false);
    ok('getBlocks() returns a defensive copy', editor.getBlocks()[0] !== editor.getBlocks()[0]);

    // --- library drops ---
    const dropped = editor.handleDrop({ kind: 'library', type: 'pricing' }, 0);
    ok('a library drop creates a block', !!dropped && dropped.type === 'pricing');
    ok('a library drop inserts at the requested index', editor.toSchema()[0].type === 'pricing');
    ok('handleDrop() ignores an empty payload', editor.handleDrop(null, 0) === null);

    // --- a real drop through the canvas, with a DataTransfer ---
    const canvas = editor.getCanvas();
    fire(canvas, 'dragover');
    ok('dragover marks the canvas as a drop target', canvas.getAttribute('data-dropactive') === 'true');
    fire(canvas, 'dragleave');
    ok('dragleave clears the drop target', canvas.getAttribute('data-dropactive') === 'false');

    const before = editor.toSchema().length;
    fire(canvas, 'drop', {
      target: canvas,
      dataTransfer: {
        getData: () => JSON.stringify({ kind: 'library', type: 'testimonials' }),
        setData: () => {}
      }
    });
    ok('a native drop event adds a block through the real handler',
      editor.toSchema().length === before + 1);
    ok('the dropped block is the dragged type',
      editor.toSchema().slice(-1)[0].type === 'testimonials');

    // --- palette drag start ---
    const galleryButton = editor.getElement()
      .querySelectorAll('.pai-block')
      .filter((b) => b.getAttribute('data-block-type') === 'gallery')[0];
    const stored = {};
    fire(galleryButton, 'dragstart', {
      dataTransfer: { setData: (k, v) => { stored[k] = v; } }
    });
    ok('palette dragstart records a library payload',
      JSON.parse(stored['application/json'] || '{}').type === 'gallery');
    ok('the drag payload is also held in memory',
      editor.getDragPayload() && editor.getDragPayload().type === 'gallery');

    // --- preview ---
    const preview = editor.getPreviewHtml();
    ok('a preview document is generated', /^<!DOCTYPE html>/.test(preview));
    ok('the preview includes the blocks', /pv-hero|pv-nav|pv-row|pv-card/.test(preview));
    ok('the preview frame receives srcdoc',
      typeof editor.getPreviewFrame().getAttribute('srcdoc') === 'string' ||
      typeof editor.getPreviewFrame().srcdoc === 'string');
    ok('the preview is coloured by OKLCH tokens', /oklch\(/.test(preview));

    editor.setProps(editor.toSchema()[0].id, { heading: '<script>alert(1)</script>' });
    ok('preview escapes markup in block props',
      !/<script>/.test(editor.getPreviewHtml()) && /&lt;script&gt;/.test(editor.getPreviewHtml()));

    // --- incremental patches ---
    ok('an html patch replaces the preview',
      editor.applyIncrementalPatch({ type: 'html', html: '<h1>patched</h1>' }) === true &&
      editor.getPreviewHtml() === '<h1>patched</h1>');
    editor.applyIncrementalPatch({ type: 'sections', sections: [] });
    ok('a non-html patch is recorded', editor.getLastPatch().type === 'sections');
    ok('a malformed patch is rejected', editor.applyIncrementalPatch(null) === false);

    // --- compile through the bridge ---
    const result = await editor.build();
    ok('build() reaches the IPC bridge', dom.window.pallettaiAPI.calls.build.length === 1);
    ok('build() sends the compiler payload',
      dom.window.pallettaiAPI.calls.build[0].target === 'deepseek-ast' &&
      Array.isArray(dom.window.pallettaiAPI.calls.build[0].schema));
    ok('a successful compile resolves ok', result.ok === true);
    ok('a returned document is applied to the preview', editor.getPreviewHtml() === '<h1>compiled by mock</h1>');
    ok('the build status reports success', /Compiled/.test(editor.getStatus()), editor.getStatus());

    // --- incremental patch subscription ---
    dom.window.pallettaiAPI.emitIncrementalPatch({ type: 'html', html: '<p>from ipc</p>' });
    ok('an IPC incremental patch updates the preview', editor.getPreviewHtml() === '<p>from ipc</p>');

    ok('clearBlocks() empties the canvas', editor.clearBlocks() === true && editor.toSchema().length === 0);
    ok('getBlocks() is empty after clear', editor.getBlocks().length === 0);
    ok('removeBlock() on an unknown id is safe', editor.removeBlock('nope') === false);

    editor.destroy();
    ok('destroy() unmounts the editor', editor.isMounted() === false);
  }

  {
    // The same edit path against a bridge with no methods at all.
    const dom = createDom();
    const editor = visualEditor.createVisualEditor({ host: { document: dom.document, window: dom.window } });
    editor.mount(dom.document.body);
    editor.addBlock('hero');

    let threw = null;
    let offlineResult = null;
    try {
      offlineResult = await editor.build();
    } catch (err) {
      threw = err;
    }
    ok('an absent compiler channel does not throw', threw === null, threw && threw.message);
    ok('the offline build resolves with a flag', offlineResult && offlineResult.offline === true);
    ok('the status explains the offline fallback',
      /unavailable/i.test(editor.getStatus()), editor.getStatus());
    ok('the preview still renders locally', /pv-hero/.test(editor.getPreviewHtml()));
    editor.destroy();
  }

  {
    // Seed blocks supplied by the host must not trigger a render storm.
    const dom = createDom();
    const editor = visualEditor.createVisualEditor({
      host: { document: dom.document, window: dom.window },
      blocks: [{ type: 'nav' }, { type: 'hero' }, { type: 'cta' }]
    });
    editor.mount(dom.document.body);
    ok('seeded blocks populate the canvas', editor.toSchema().length === 3);
    ok('seeded blocks keep their order',
      editor.toSchema().map((b) => b.type).join(',') === 'nav,hero,cta');
    editor.destroy();
  }

  // ----------------------------------------------------------
  group('Task 4 — design system control panel');
  // ----------------------------------------------------------

  {
    const dom = createDom();
    dom.window.pallettaiAPI = createMockBridge();
    const previewTarget = dom.document.createElement('div');
    dom.document.body.appendChild(previewTarget);

    const panel = tokenPanel.createTokenPanel({
      host: { document: dom.document, window: dom.window },
      preview: previewTarget
    });

    panel.mount(dom.document.body);
    await flush();
    ok('panel renders', !!panel.getElement().querySelector('[data-role="token-panel"]'));
    ok('mounting publishes the initial CSS variables',
      /oklch\(/.test(panel.getPatchedCss()));
    ok('every derived colour gets a swatch',
      panel.getSwatches().querySelectorAll('.pai-swatch').length >= 10,
      String(panel.getSwatches().querySelectorAll('.pai-swatch').length));
    ok('harmony swatches are rendered alongside',
      panel.getSwatches().querySelectorAll('[data-harmony]').length === 2);
    ok('swatches are painted with OKLCH values',
      /^oklch\(/.test(panel.getSwatches().querySelector('[data-swatch="accent"]').getAttribute('data-oklch')));

    const defaults = panel.getTokens();
    ok('panel starts from the default OKLCH seed',
      defaults.seed && typeof defaults.seed.l === 'number' && typeof defaults.seed.h === 'number');

    // --- sliders mutate the seed ---
    const lightness = panel.getElement().querySelector('#pai-l');
    ok('a lightness slider is rendered', !!lightness);
    lightness.value = '0.8';
    fire(lightness, 'input');
    ok('the lightness slider updates the seed', panel.getTokens().seed.l === 0.8, String(panel.getTokens().seed.l));
    ok('the slider output tracks the value',
      Math.abs(Number(panel.getElement().querySelector('[data-output="l"]').textContent) - 0.8) < 0.001,
      panel.getElement().querySelector('[data-output="l"]').textContent);

    const hue = panel.getElement().querySelector('#pai-h');
    hue.value = '140';
    fire(hue, 'input');
    ok('the hue slider updates the seed', panel.getTokens().seed.h === 140);

    const chroma = panel.getElement().querySelector('#pai-c');
    chroma.value = '0.22';
    fire(chroma, 'input');
    ok('the chroma slider updates the seed', panel.getTokens().seed.c === 0.22);

    const derived = panel.getDerived();
    ok('derived tokens follow the seed hue', derived.css['--pai-accent'] === runtime.oklch(0.8, 0.22, 140));
    ok('the geometry slider is separate from the seed',
      panel.getElement().querySelector('#pai-radius') !== null);

    // --- hot patching without a reload ---
    ok('hot patch writes CSS variables to the live document',
      previewTarget.style.getPropertyValue('--pai-accent') === derived.css['--pai-accent']);
    ok('the radius token is patched too',
      /px$/.test(previewTarget.style.getPropertyValue('--pai-radius')));
    const patchedCss = panel.getPatchedCss();
    ok('the patched CSS block is a :root block', /^:root \{/.test(patchedCss));
    ok('the patched CSS carries OKLCH values', /oklch\(/.test(patchedCss));
    ok('the patched CSS covers every token used by the shell',
      ['--pai-bg', '--pai-surface', '--pai-text', '--pai-accent'].every((p) => patchedCss.indexOf(p) !== -1));

    // --- the patch channel ---
    const patchResult = await panel.patchPreview('smoke');
    ok('patchPreview reaches the GLM hot patcher', dom.window.pallettaiAPI.calls.patchTokens.length === 1);
    const patchPayload = dom.window.pallettaiAPI.calls.patchTokens[0];
    ok('the patch payload is scoped to tokens', patchPayload.scope === 'tokens');
    ok('the patch payload carries the CSS block', /^:root \{/.test(patchPayload.css));
    ok('the patch payload carries the token set', !!patchPayload.tokens.seed);
    ok('a successful patch resolves ok', patchResult.ok === true);
    ok('the patch status reports success', /Hot patch applied/.test(panel.getStatus()), panel.getStatus());

    // --- colour picker ---
    const picker = panel.getElement().querySelector('#pai-seed-color');
    ok('a colour picker is rendered with a hex value', /^#[0-9a-f]{6}$/.test(picker.getAttribute('value')));
    picker.value = '#ff0000';
    fire(picker, 'input');
    const red = panel.getTokens().seed;
    ok('the picker converts hex to an OKLCH seed', Math.abs(red.h - 29) < 8, String(red.h));
    ok('the converted lightness is sane', red.l > 0.5 && red.l < 0.8, String(red.l));

    // --- harmony from the bridge ---
    const harmony = await panel.loadHarmony('complementary', 5);
    ok('loadHarmony() reaches the GLM engine', dom.window.pallettaiAPI.calls.generateHarmony.length >= 1);
    ok('the harmony request carries the seed',
      !!dom.window.pallettaiAPI.calls.generateHarmony[0].seed);
    ok('a bridge palette is preferred over the local one', harmony.source === 'bridge', harmony.source);
    ok('the bridge palette is rendered',
      panel.getSwatches().querySelectorAll('[data-harmony]').length === 2);
    ok('the harmony source is reported to the user',
      /GLM harmony engine/.test(panel.getElement().querySelector('[data-role="harmony-source"]').textContent));

    // --- harmony scheme select ---
    const select = panel.getElement().querySelector('#pai-harmony');
    ok('the harmony select lists every scheme',
      panel.getElement().querySelectorAll('#pai-harmony option').length === tokenPanel.HARMONY_SCHEMES.length);
    select.value = 'triadic';
    fire(select, 'change');
    ok('changing the scheme updates the tokens', panel.getTokens().harmony === 'triadic');

    // --- reset ---
    panel.reset();
    ok('reset restores the default seed', panel.getTokens().seed.l === runtime.defaultTokens().seed.l);
    ok('reset restores the default harmony', panel.getTokens().harmony === runtime.defaultTokens().harmony);

    panel.destroy();
  }

  {
    // Colour maths, tested directly.
    ok('parseHex accepts #rgb', !!tokenPanel.parseHex('#abc'));
    ok('parseHex accepts #rrggbb', !!tokenPanel.parseHex('#aabbcc'));
    ok('parseHex rejects malformed input', tokenPanel.parseHex('nope') === null && tokenPanel.parseHex('#12345') === null);
    ok('parseHex rejects non-strings', tokenPanel.parseHex(42) === null);

    const roundTrip = tokenPanel.hexToOklch('#5b6cff');
    ok('hexToOklch returns l/c/h', roundTrip && typeof roundTrip.l === 'number' && typeof roundTrip.c === 'number');
    ok('hexToOklch normalises the hue into 0..360', roundTrip.h >= 0 && roundTrip.h < 360);
    ok('oklchToHex round-trips a colour',
      tokenPanel.oklchToHex(roundTrip.l, roundTrip.c, roundTrip.h).toLowerCase() === '#5b6cff',
      tokenPanel.oklchToHex(roundTrip.l, roundTrip.c, roundTrip.h));
    ok('oklchToHex clamps neutral black', tokenPanel.oklchToHex(0, 0, 0) === '#000000');
    ok('oklchToHex clamps neutral white', tokenPanel.oklchToHex(1, 0, 0) === '#ffffff');
    ok('oklchToHex survives out-of-gamut chroma', /^#[0-9a-f]{6}$/.test(tokenPanel.oklchToHex(0.6, 0.5, 200)));

    tokenPanel.HARMONY_SCHEMES.forEach((scheme) => {
      const local = tokenPanel.generateHarmonyLocal({ l: 0.6, c: 0.15, h: 240 }, scheme.id, 5);
      ok('local harmony "' + scheme.id + '" returns swatches', local.ok === true && local.swatches.length === 5);
      ok('local harmony "' + scheme.id + '" returns valid hex',
        local.swatches.every((s) => /^#[0-9a-f]{6}$/.test(s.hex)));
      ok('local harmony "' + scheme.id + '" is flagged as local', local.source === 'local');
    });
    ok('an unknown harmony scheme falls back safely',
      tokenPanel.generateHarmonyLocal({ l: 0.6, c: 0.15, h: 240 }, 'nonsense', 3).swatches.length === 3);
  }

  {
    // No harmony channel: the panel must fall back instead of showing nothing.
    const dom = createDom();
    const panel = tokenPanel.createTokenPanel({ host: { document: dom.document, window: dom.window } });
    panel.mount(dom.document.body);
    await flush();
    const harmony = await panel.loadHarmony();
    ok('a missing harmony channel falls back locally', harmony.source === 'local');
    ok('the fallback palette still renders', panel.getSwatches().querySelectorAll('[data-harmony]').length > 0);
    ok('the fallback is disclosed to the user',
      /locally/.test(panel.getElement().querySelector('[data-role="harmony-source"]').textContent));

    const patched = await panel.patchPreview();
    ok('a missing patch channel resolves offline', patched.offline === true);
    ok('the panel still applies the patch locally',
      /oklch\(/.test(panel.getPatchedCss()));
    ok('the patch status explains the local fallback', /locally/.test(panel.getStatus()), panel.getStatus());
    panel.destroy();
  }

  // ----------------------------------------------------------
  group('Task 5 — telemetry dashboard');
  // ----------------------------------------------------------

  {
    const dom = createDom();
    dom.window.pallettaiAPI = createMockBridge();
    const dash = telemetry.createTelemetryDashboard({ host: { document: dom.document, window: dom.window } });
    const layout = dash.mount(dom.document.body);

    ok('dashboard renders', layout.getAttribute('data-role') === 'telemetry-dashboard');
    ok('charts render before any data arrives', layout.querySelectorAll('svg').length >= 4,
      String(layout.querySelectorAll('svg').length));
    ok('an empty chart says so', /No build samples yet/.test(layout.textContent));
    ok('a log region is rendered', !!layout.querySelector('[data-role="build-log"]'));
    ok('the dashboard subscribed to build progress',
      dom.window.pallettaiAPI.subscriptions.buildProgress.length === 1);
    ok('the dashboard subscribed to worker metrics',
      dom.window.pallettaiAPI.subscriptions.workerMetrics.length === 1);

    // --- real IPC events ---
    dom.window.pallettaiAPI.emitBuildProgress({ phase: 'parse', progress: 0.25, compileMs: 120, message: 'parsing schema' });
    dom.window.pallettaiAPI.emitBuildProgress({ phase: 'tree-shake', progress: 0.6, compileMs: 240, astNodesPruned: 812, cssBytesBefore: 100000, cssBytesAfter: 42000, message: 'pruned unused rules', level: 'ok' });
    dom.window.pallettaiAPI.emitBuildProgress({ phase: 'emit', progress: 100, compileMs: 310, astNodesPruned: 940, message: 'wrote 12 files' });

    ok('build events update the event counter', dash.getEventCount() === 3, String(dash.getEventCount()));
    ok('compile times accumulate into a series', dash.getCompileSeries().length === 3);
    ok('the compile series keeps values in order',
      dash.getCompileSeries().map((e) => e.value).join(',') === '120,240,310');
    ok('the latest phase is tracked', dash.getPhase() === 'emit');
    ok('the phase is shown on screen',
      /Phase: emit/.test(layout.querySelector('[data-role="phase"]').textContent));
    ok('the last compile time is a KPI',
      layout.querySelector('[data-kpi-value="compile"]').textContent === '310 ms',
      layout.querySelector('[data-kpi-value="compile"]').textContent);
    ok('the pruned node count is a KPI',
      layout.querySelector('[data-kpi-value="pruned"]').textContent === '940');
    ok('the number of charted phases is a KPI',
      layout.querySelector('[data-kpi-value="phases"]').textContent === '2',
      layout.querySelector('[data-kpi-value="phases"]').textContent);

    // --- CSS reduction derived from byte counts ---
    ok('css reduction is derived from byte counts', Math.abs(dash.getCssReduction() - 0.58) < 0.001,
      String(dash.getCssReduction()));
    ok('the reduction is shown as a percentage',
      layout.querySelector('[data-kpi-value="css"]').textContent === '58%',
      layout.querySelector('[data-kpi-value="css"]').textContent);
    const ringCircles = dash.getElement().querySelectorAll('[data-chart="css-reduction"] circle');
    ok('the reduction is drawn as a donut', ringCircles.length === 2, String(ringCircles.length));
    ok('the donut encodes the ratio in a dash array',
      ringCircles.some((c) => /^[\d.]+ [\d.]+$/.test(c.getAttribute('stroke-dasharray') || '')));
    ok('the donut arc starts at the top',
      /^rotate\(-90 /.test(ringCircles[1].getAttribute('transform') || ''),
      ringCircles[1].getAttribute('transform'));

    // 0..1 and 0..100 progress must both normalise.
    const asFraction = telemetry.normaliseBuildEvent({ progress: 0.5 });
    const asPercent = telemetry.normaliseBuildEvent({ progress: 50 });
    ok('progress accepts a 0..1 fraction', asFraction.progress === 0.5);
    ok('progress accepts a 0..100 percentage', asPercent.progress === 0.5);

    // --- charts ---
    const compileChart = dash.getElement().querySelector('[data-chart="compile-time"]');
    ok('the compile chart draws a polyline', compileChart.querySelectorAll('polyline').length === 1);
    ok('the compile chart draws a marker for the latest sample',
      compileChart.querySelectorAll('circle').length === 1);
    ok('the chart is an accessible SVG image',
      compileChart.querySelector('svg').getAttribute('role') === 'img' &&
      !!compileChart.querySelector('svg').getAttribute('aria-label'));

    const pruneChart = dash.getElement().querySelector('[data-chart="ast-pruned"]');
    const pruneBars = pruneChart.querySelectorAll('rect').length;
    ok('the tree-shaker chart draws a bar pair per phase', pruneBars === 4, String(pruneBars));
    ok('the tree-shaker chart shows per-phase work, not the running total',
      /812/.test(pruneChart.textContent) && /128/.test(pruneChart.textContent) && !/940/.test(pruneChart.textContent),
      pruneChart.textContent);
    ok('the tree-shaker chart labels each phase',
      /tree-shake/.test(pruneChart.textContent) && /emit/.test(pruneChart.textContent));

    // --- terminal log ---
    const log = dash.getLogElement();
    ok('log lines are captured', dash.getLogs().length === 3);
    ok('log lines render into the terminal', log.querySelectorAll('.pai-log-row').length === 3);
    ok('log lines keep their level',
      log.querySelectorAll('.pai-log-row')[1].getAttribute('data-level') === 'ok');
    ok('the terminal is announced as a log',
      log.getAttribute('role') === 'log' && log.getAttribute('aria-live') === 'polite');
    ok('log text is preserved verbatim', /wrote 12 files/.test(log.textContent));

    dash.appendLog('deploy: uploading bundle', 'warn');
    ok('appendLog adds a line', dash.getLogs().length === 4);
    ok('the new level is honoured',
      log.querySelectorAll('.pai-log-row')[3].getAttribute('data-level') === 'warn');
    dash.appendLog('x', 'not-a-level');
    ok('an unknown log level degrades to info',
      dash.getLogs().slice(-1)[0].level === 'info');

    dash.clearLog();
    ok('clearLog empties the terminal buffer', dash.getLogs().length === 0);
    ok('clearLog empties the rendered terminal', log.querySelectorAll('.pai-log-row').length === 0);

    // --- worker pool ---
    dom.window.pallettaiAPI.emitWorkerMetrics({
      workers: [
        { id: 'w1', cpu: 0.42, memoryMb: 128, status: 'busy' },
        { id: 'w2', cpu: 96, memory: 268435456, status: 'idle' }
      ]
    });
    ok('worker metrics are ingested', dash.getWorkers().length === 2);
    ok('a 0..1 cpu reading is normalised to a percentage',
      Math.abs(dash.getWorkers()[0].cpu - 42) < 0.001, String(dash.getWorkers()[0].cpu));
    ok('a 0..100 cpu reading is left alone', Math.abs(dash.getWorkers()[1].cpu - 96) < 0.001);
    ok('memory in bytes is converted to MB',
      Math.abs(dash.getWorkers()[1].memory - 256) < 1, String(dash.getWorkers()[1].memory));
    ok('worker metrics are shown as a KPI',
      layout.querySelector('[data-kpi-value="workers"]').textContent === '2');
    ok('each worker gets a card', dash.getElement().querySelectorAll('[data-worker]').length === 2);
    ok('worker status is surfaced', /busy/.test(dash.getElement().querySelector('[data-worker="w1"]').textContent));

    // A later partial update must merge, not duplicate.
    dom.window.pallettaiAPI.emitWorkerMetrics({ workers: [{ id: 'w1', cpu: 10, memoryMb: 64 }] });
    ok('a partial worker update merges by id', dash.getWorkers().length === 2, String(dash.getWorkers().length));
    ok('the merged worker takes the new reading',
      Math.abs(dash.getWorkers().filter((w) => w.id === 'w1')[0].cpu - 10) < 0.001);
    ok('the worker chart is rebuilt from the merged set',
      dash.getElement().querySelectorAll('[data-worker]').length === 2);

    // --- worker bars ---
    const workerSvg = dash.getElement().querySelector('[data-role="workers"] svg');
    ok('worker bars are drawn as SVG rects', workerSvg.querySelectorAll('rect').length === 4,
      String(workerSvg.querySelectorAll('rect').length));

    // --- reset ---
    dash.clearAll();
    ok('reset clears the series', dash.getCompileSeries().length === 0 && dash.getWorkers().length === 0);
    ok('reset clears the event counter', dash.getEventCount() === 0);
    ok('reset clears the css reduction', dash.getCssReduction() === null);

    // --- capacity ---
    const small = telemetry.createTelemetryDashboard({
      host: { document: dom.document, window: dom.window },
      api: dom.window.pallettaiAPI,
      capacity: 5
    });
    small.mount(dom.document.createElement('div'));
    for (let i = 1; i <= 20; i++) small.handleBuildProgress({ compileMs: i * 10, phase: 'emit' });
    ok('the series respects its capacity', small.getCompileSeries().length === 5);
    ok('the newest samples are retained',
      small.getCompileSeries().map((e) => e.value).join(',') === '160,170,180,190,200');
    small.destroy();

    dash.destroy();
    ok('destroy() unmounts the dashboard', dash.isMounted() === false);
    ok('destroy() unsubscribes from IPC',
      dom.window.pallettaiAPI.subscriptions.buildProgress.length === 0 &&
      dom.window.pallettaiAPI.subscriptions.workerMetrics.length === 0);
  }

  {
    // Telemetry against a bridge with no channels at all.
    const dom = createDom();
    const dash = telemetry.createTelemetryDashboard({ host: { document: dom.document, window: dom.window } });
    let threw = null;
    try {
      dash.mount(dom.document.body);
    } catch (err) {
      threw = err;
    }
    ok('telemetry mounts without an IPC bridge', threw === null, threw && threw.message);
    ok('the dashboard reports no workers rather than crashing',
      dash.getElement().querySelector('[data-kpi-value="workers"]').textContent === '0');

    dash.handleBuildProgress({ compileMs: 12, astNodesPruned: 3, message: 'offline build' });
    ok('events can still be pushed manually', dash.getEventCount() === 1);
    ok('manual events render', /offline build/.test(dash.getLogElement().textContent));

    const spark = telemetry.sparkline(
      { svg: (tag, attrs, ...kids) => makeStubSvg(tag, attrs, kids) },
      [1, 2, 3]
    );
    ok('chart primitives are exported for direct use', !!spark);
    dash.destroy();
  }

  // ----------------------------------------------------------
  group('Integration — all four views against both bridges');
  // ----------------------------------------------------------

  {
    // The dashboard the app actually builds: real module factories wired into
    // the shell, driven through the router.
    const dom = createDom();
    dom.window.pallettaiAPI = createMockBridge();
    const scope = { document: dom.document, window: dom.window };

    const shell = appShell.createAppShell({
      host: scope,
      views: [
        { id: 'workspace', mount: (container, ctx) => visualEditor.createVisualEditor({ host: scope, api: ctx.api }).mount(container) },
        { id: 'design-tokens', mount: (container, ctx) => tokenPanel.createTokenPanel({ host: scope, api: ctx.api }).mount(container) },
        { id: 'telemetry', mount: (container, ctx) => telemetry.createTelemetryDashboard({ host: scope, api: ctx.api }).mount(container) }
      ]
    });
    shell.mount(dom.document.body);

    let threw = null;
    try {
      ['workspace', 'design-tokens', 'seo-content', 'telemetry'].forEach((id) => shell.navigate(id));
    } catch (err) {
      threw = err;
    }
    ok('every view mounts through the router', threw === null, threw && threw.message);
    ok('navigating through all four views leaves the shell mounted',
      shell.isMounted() && shell.getActiveView() === 'telemetry');

    // The token panel's hot patch must reach the document root, which is what
    // makes the whole dashboard retheme without a reload.
    shell.navigate('design-tokens');
    const tokensPanelEl = shell.getViewHost();
    ok('the token panel mounted inside the shell', !!tokensPanelEl.querySelector('[data-role="token-panel"]'));
    ok('the shell stylesheet is installed once', dom.document.querySelectorAll('style').length === 2,
      String(dom.document.querySelectorAll('style').length));
    ok('the token block is OKLCH-only',
      !/#[0-9a-fA-F]{3,8}\b/.test(dom.document.getElementById('pai-dashboard-tokens').textContent));
    shell.destroy();
  }

  {
    // Every interaction, with no IPC bridge at all. This is the "without
    // throwing undefined errors" half of the contract.
    const dom = createDom();
    const scope = { document: dom.document, window: dom.window };
    const failures = [];

    try {
      const shell = appShell.createAppShell({ host: scope });
      shell.mount(dom.document.body);
      ['workspace', 'design-tokens', 'seo-content', 'telemetry'].forEach((id) => shell.navigate(id));
      shell.requestWindowAction('minimize');
      shell.setCollapsed(true);

      const editor = visualEditor.createVisualEditor({ host: scope });
      editor.mount(dom.document.createElement('div'));
      editor.addBlock('hero');
      await editor.build();
      await editor.applyIncrementalPatch({ type: 'html', html: '<p>x</p>' });

      const panel = tokenPanel.createTokenPanel({ host: scope });
      panel.mount(dom.document.createElement('div'));
      await panel.loadHarmony();
      await panel.patchPreview();
      panel.reset();

      const dash = telemetry.createTelemetryDashboard({ host: scope });
      dash.mount(dom.document.createElement('div'));
      dash.handleBuildProgress({ compileMs: 1 });
      dash.handleWorkerMetrics({ cpu: 0.5 });

      shell.destroy();
      editor.destroy();
      panel.destroy();
      dash.destroy();
    } catch (err) {
      failures.push(err);
    }

    ok('the whole dashboard runs with no IPC bridge', failures.length === 0,
      failures.map((e) => e.message).join(' | '));
  }

  {
    // Exported surface: the spec names these entry points.
    ok('app shell exports createAppShell', typeof appShell.createAppShell === 'function');
    ok('app shell exposes the four default views', appShell.DEFAULT_VIEWS.length === 4);
    ok('visual editor exports createVisualEditor', typeof visualEditor.createVisualEditor === 'function');
    ok('token panel exports createTokenPanel', typeof tokenPanel.createTokenPanel === 'function');
    ok('telemetry exports createTelemetryDashboard', typeof telemetry.createTelemetryDashboard === 'function');
    ok('runtime exports resolveBridge', typeof runtime.resolveBridge === 'function');
    ok('runtime exports installStyles', typeof runtime.installStyles === 'function');

    const src = {
      runtime: require('fs').readFileSync(path.join(ROOT, 'ui', 'runtime.js'), 'utf8'),
      shell: require('fs').readFileSync(path.join(ROOT, 'ui', 'app-shell.js'), 'utf8'),
      editor: require('fs').readFileSync(path.join(ROOT, 'ui', 'visual-editor.js'), 'utf8'),
      tokens: require('fs').readFileSync(path.join(ROOT, 'ui', 'token-panel.js'), 'utf8'),
      telemetry: require('fs').readFileSync(path.join(ROOT, 'ui', 'telemetry-dashboard.js'), 'utf8')
    };
    Object.keys(src).forEach((name) => {
      ok('ui/' + name + ' uses no innerHTML', !/\.innerHTML\s*=/.test(src[name]));
      ok('ui/' + name + ' requires no framework', !/from ['"](react|vue|svelte|lit|preact)/.test(src[name]));
    });
    ok('no ui module hard-codes a hex colour',
      !/['"]#[0-9a-fA-F]{3,8}['"]/.test(src.shell) &&
      !/['"]#[0-9a-fA-F]{3,8}['"]/.test(src.telemetry));
  }

  // ----------------------------------------------------------
  console.log('\n' + '='.repeat(58));
  console.log('ui-dashboard-v1-smoke: ' + passed + ' passed, ' + failed + ' failed');
  console.log('='.repeat(58));
  if (failed) {
    console.error('ui-dashboard-v1-smoke FAILED');
    process.exit(1);
  }
  console.log('ui-dashboard-v1-smoke PASSED');
}

/** Minimal SVG host for the exported chart primitives. */
function makeStubSvg(tag, attrs, kids) {
  return { tag, attrs, children: kids || [], appendChild(c) { this.children.push(c); } };
}

main().catch((err) => {
  console.error('ui-dashboard-v1-smoke CRASHED: ' + (err && err.stack ? err.stack : err));
  process.exit(1);
});
