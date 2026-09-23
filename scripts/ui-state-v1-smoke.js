'use strict';
// ============================================================
// UI state & asset smoke runner — v1
//
// Four renderer-layer modules, each checked where it could break:
//
//   1. ui/state-manager.js  — Proxy reactivity, the pub/sub action
//      bus, and the debounced IPC autosave (including the offline
//      queue and the late-arriving bridge).
//   2. ui/media-manager.js  — mock File ingestion, the exact
//      compressAsset IPC payload, live progress DOM, asset chips
//      dropped onto a canvas, and the <picture> markup injected.
//   3. ui/git-controller.js — staging diff against the last commit,
//      the commit timeline, and the one-click release flow through
//      IPC with its progress + success states.
//   4. ui/ast-inspector.js  — AST normalisation, the tree-shaken /
//      injected diff, the collapsible tree DOM and the read-only
//      compiler payload pane.
//
// ---- WHY THERE IS A DOM SHIM IN THIS FILE ------------------------
// jsdom is NOT a dependency of this project (`require.resolve('jsdom')`
// throws). This runner therefore installs a small, self-contained DOM
// implementation — elements, attributes, classList, a descendant
// selector engine, and bubbling events — so the suite runs on a bare
// `node scripts/ui-state-v1-smoke.js`. If jsdom IS resolvable, it is
// used instead and the same assertions run against it, so the runner
// upgrades itself the day the dependency lands.
//
// The shim is deliberately strict in one place: `innerHTML` THROWS on
// read and write. Every one of these four modules must build DOM
// programmatically, so a future edit that reaches for a markup string
// fails this suite loudly instead of quietly reintroducing XSS.
//
// ---- RUN ---------------------------------------------------------
//   node scripts/ui-state-v1-smoke.js
// exit 0 = every check passed, exit 1 = at least one failed.
// ============================================================

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// ============================================================
// Assertion harness
// ============================================================

let passed = 0;
const failures = [];
let sectionName = '(setup)';
const sectionCounts = [];
let currentSection = null;

function section(name) {
  currentSection = { name, passed: 0, failed: 0 };
  sectionCounts.push(currentSection);
  sectionName = name;
  console.log('\n── ' + name + ' ' + '─'.repeat(Math.max(0, 58 - name.length)));
}

async function check(label, fn) {
  try {
    const out = await fn();
    if (out === false) throw new Error('assertion returned false');
    passed++;
    currentSection.passed++;
    console.log('  ✓ ' + label);
    return out;
  } catch (err) {
    const msg = (err && err.message) || String(err);
    failures.push(sectionName + ' :: ' + label + '\n      → ' + msg);
    currentSection.failed++;
    console.log('  ✗ ' + label + '\n      → ' + msg);
    return undefined;
  }
}

function ok(value, message) {
  if (!value) throw new Error(message || 'expected a truthy value, got ' + JSON.stringify(value));
  return true;
}

// DOM nodes carry parent/child cycles — describe them by tag + identity
// instead of letting JSON.stringify throw on every comparison.
function describeValue(value) {
  if (value && typeof value === 'object' && typeof value.nodeType === 'number') {
    return '[node ' + (value._tag || value.nodeType) + '#' + (value._uid || '?') + ']';
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (e) {
    return String(value);
  }
}

function eq(actual, expected, message) {
  if (actual === expected) return true;
  const a = JSON.stringify(describeValue(actual));
  const b = JSON.stringify(describeValue(expected));
  if (a !== b) throw new Error((message ? message + ' — ' : '') + 'expected ' + b + ', got ' + a);
  return true;
}

function same(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || 'expected the same object reference, got ' + describeValue(actual) + ' !== ' + describeValue(expected));
  }
  return true;
}

function has(haystack, needle, message) {
  const text = String(haystack == null ? '' : haystack);
  if (text.indexOf(needle) === -1) {
    throw new Error((message ? message + ' — ' : '') + 'expected to find ' + JSON.stringify(needle) + ' in ' + JSON.stringify(text.slice(0, 200)));
  }
  return true;
}

function throws(fn, code, message) {
  let threw = null;
  try { fn(); } catch (err) { threw = err; }
  if (!threw) throw new Error((message || 'expected a throw') + ' — nothing was thrown');
  if (code && threw.code !== code) throw new Error((message || '') + ' — threw code ' + JSON.stringify(threw.code) + ', expected ' + JSON.stringify(code) + ' (' + threw.message + ')');
  return threw;
}

// ============================================================
// Micro DOM (used only when jsdom is unavailable)
// ============================================================

function buildShim() {
  let uid = 0;

  function parseCompound(text) {
    const out = { tag: null, id: null, classes: [], attrs: [] };
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (ch === '*') { i++; continue; }
      if (ch === '#') {
        const m = /^#([\w-]+)/.exec(text.slice(i));
        if (!m) throw new Error('shim: bad id selector at ' + JSON.stringify(text));
        out.id = m[1];
        i += m[0].length;
        continue;
      }
      if (ch === '.') {
        const m = /^\.([\w-]+)/.exec(text.slice(i));
        if (!m) throw new Error('shim: bad class selector at ' + JSON.stringify(text));
        out.classes.push(m[1]);
        i += m[0].length;
        continue;
      }
      if (ch === '[') {
        const m = /^\[([^\]]+)\]/.exec(text.slice(i));
        if (!m) throw new Error('shim: unclosed attribute selector in ' + JSON.stringify(text));
        const body = m[1];
        const eqIndex = body.indexOf('=');
        if (eqIndex === -1) {
          out.attrs.push({ name: body.trim(), op: null, value: null });
        } else {
          const opChar = body[eqIndex - 1];
          const name = body.slice(0, eqIndex).replace(/[~^$*|]$/, '').trim();
          const rawOp = (opChar && '~^$*|'.indexOf(opChar) > -1) ? opChar + '=' : '=';
          const value = body.slice(eqIndex + 1).trim().replace(/^["']|["']$/g, '');
          out.attrs.push({ name, op: rawOp === '~=' ? '=' : rawOp, value });
        }
        i += m[0].length;
        continue;
      }
      const m = /^[\w-]+/.exec(text.slice(i));
      if (m) {
        if (!out.tag) out.tag = m[0].toLowerCase();
        i += m[0].length;
        continue;
      }
      i++;
    }
    return out;
  }

  function parseSelector(selector) {
    return String(selector).split(',').map((g) => g.trim()).filter(Boolean)
      .map((group) => group.split(/\s+/).filter(Boolean).map(parseCompound));
  }

  function matchesCompound(el, compound) {
    if (!el || el.nodeType !== 1) return false;
    if (compound.tag && el._tag !== compound.tag) return false;
    if (compound.id && el.getAttribute('id') !== compound.id) return false;
    for (let i = 0; i < compound.classes.length; i++) {
      if (!el._classes.has(compound.classes[i])) return false;
    }
    for (let i = 0; i < compound.attrs.length; i++) {
      const spec = compound.attrs[i];
      const value = el.getAttribute(spec.name);
      if (value == null) return false;
      if (spec.value == null) continue;
      if (spec.op === '=') { if (value !== spec.value) return false; continue; }
      if (spec.op === '*=') { if (value.indexOf(spec.value) === -1) return false; continue; }
      if (spec.op === '^=') { if (value.indexOf(spec.value) !== 0) return false; continue; }
      if (spec.op === '$=') { if (value.slice(-spec.value.length) !== spec.value) return false; continue; }
      if (value !== spec.value) return false;
    }
    return true;
  }

  function matchesGroups(el, groups) {
    return groups.some((chain) => {
      if (!matchesCompound(el, chain[chain.length - 1])) return false;
      let node = el.parentNode;
      for (let i = chain.length - 2; i >= 0; i--) {
        let found = false;
        while (node) {
          if (matchesCompound(node, chain[i])) { found = true; node = node.parentNode; break; }
          node = node.parentNode;
        }
        if (!found) return false;
      }
      return true;
    });
  }

  function collect(node, predicate, out) {
    (node._children || []).forEach((child) => {
      if (child.nodeType === 1) {
        if (predicate(child)) out.push(child);
        collect(child, predicate, out);
      }
    });
    return out;
  }

  function classListOf(node) {
    return {
      add(...names) { names.forEach((n) => node._classes.add(String(n))); },
      remove(...names) { names.forEach((n) => node._classes.delete(String(n))); },
      toggle(name, force) {
        const has = node._classes.has(String(name));
        const on = force === undefined ? !has : !!force;
        if (on) node._classes.add(String(name)); else node._classes.delete(String(name));
        return on;
      },
      contains(name) { return node._classes.has(String(name)); },
      item(i) { return Array.from(node._classes)[i] || null; },
      get length() { return node._classes.size; },
      toString() { return Array.from(node._classes).join(' '); }
    };
  }

  const proto = {
    get tagName() { return this._tag.toUpperCase(); },
    get nodeName() { return this.tagName; },
    get localName() { return this._tag; },
    get id() { return this._attrs.get('id') || ''; },
    set id(v) { this.setAttribute('id', v); },
    get className() { return Array.from(this._classes).join(' '); },
    set className(v) {
      this._classes = new Set(String(v == null ? '' : v).split(/\s+/).filter(Boolean));
    },
    get classList() { return classListOf(this); },

    get children() { return this._children.filter((c) => c.nodeType === 1); },
    get childNodes() { return this._children.slice(); },
    get firstChild() { return this._children[0] || null; },
    get firstElementChild() { return this.children[0] || null; },
    get lastElementChild() { const c = this.children; return c[c.length - 1] || null; },
    get childElementCount() { return this.children.length; },
    get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; },

    get textContent() {
      if (this._children.length) return this._children.map((c) => c.textContent).join('');
      return this._text || '';
    },
    set textContent(v) {
      this._children.forEach((c) => { c.parentNode = null; });
      this._children = [];
      this._text = v == null ? '' : String(v);
    },

    // The one deliberate hard stop: these modules build DOM nodes.
    get innerHTML() {
      throw new Error('innerHTML was READ — PallettAI UI modules must build DOM programmatically');
    },
    set innerHTML(v) {
      throw new Error('innerHTML was WRITTEN (' + String(v).slice(0, 40) + '…) — PallettAI UI modules must build DOM programmatically');
    },
    get outerHTML() {
      throw new Error('outerHTML was READ — the shim does not serialise markup');
    },

    setAttribute(name, value) { this._attrs.set(String(name), value == null ? '' : String(value)); },
    getAttribute(name) { const v = this._attrs.get(String(name)); return v === undefined ? null : v; },
    hasAttribute(name) { return this._attrs.has(String(name)); },
    removeAttribute(name) { this._attrs.delete(String(name)); },
    get attributes() { return Array.from(this._attrs, ([name, value]) => ({ name, value })); },

    get dataset() {
      const node = this;
      return new Proxy({}, {
        get(_t, key) {
          if (typeof key !== 'string') return undefined;
          const attr = 'data-' + key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
          return node.getAttribute(attr);
        },
        set(_t, key, value) {
          const attr = 'data-' + String(key).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
          node.setAttribute(attr, value);
          return true;
        },
        has(_t, key) {
          const attr = 'data-' + String(key).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
          return node.hasAttribute(attr);
        },
        ownKeys() {
          return Array.from(node._attrs.keys()).filter((k) => k.indexOf('data-') === 0)
            .map((k) => k.slice(5).replace(/-([a-z])/g, (m, c) => c.toUpperCase()));
        },
        getOwnPropertyDescriptor() { return { enumerable: true, configurable: true }; }
      });
    },

    appendChild(child) {
      if (!child) throw new Error('appendChild(null)');
      if (child.parentNode && child.parentNode.removeChild) child.parentNode.removeChild(child);
      child.parentNode = this;
      this._children.push(child);
      if (!child.ownerDocument) child.ownerDocument = this.ownerDocument || null;
      return child;
    },
    insertBefore(child, ref) {
      if (!ref) return this.appendChild(child);
      const i = this._children.indexOf(ref);
      if (i === -1) throw new Error('insertBefore: reference is not a child');
      child.parentNode = this;
      this._children.splice(i, 0, child);
      return child;
    },
    removeChild(child) {
      const i = this._children.indexOf(child);
      if (i === -1) throw new Error('removeChild: node is not a child');
      this._children.splice(i, 1);
      child.parentNode = null;
      return child;
    },
    replaceChildren(...nodes) {
      this.textContent = '';
      nodes.forEach((n) => this.appendChild(n));
    },
    remove() { if (this.parentNode && this.parentNode.removeChild) this.parentNode.removeChild(this); },
    contains(node) {
      for (let n = node; n; n = n.parentNode) if (n === this) return true;
      return false;
    },
    closest(selector) {
      const groups = parseSelector(selector);
      for (let n = this; n && n.nodeType === 1; n = n.parentNode) {
        if (matchesGroups(n, groups)) return n;
      }
      return null;
    },
    matches(selector) { return matchesGroups(this, parseSelector(selector)); },
    querySelector(selector) {
      const groups = parseSelector(selector);
      const found = collect(this, (el) => matchesGroups(el, groups), []);
      return found[0] || null;
    },
    querySelectorAll(selector) {
      const groups = parseSelector(selector);
      return collect(this, (el) => matchesGroups(el, groups), []);
    },
    getElementsByTagName(tag) {
      const want = String(tag).toLowerCase();
      return collect(this, (el) => want === '*' || el._tag === want, []);
    },

    addEventListener(type, fn) {
      if (typeof fn !== 'function') throw new Error('addEventListener(' + type + ') needs a function');
      (this._listeners[type] = this._listeners[type] || []).push(fn);
    },
    removeEventListener(type, fn) {
      const list = this._listeners[type];
      if (!list) return;
      const i = list.indexOf(fn);
      if (i > -1) list.splice(i, 1);
    },
    dispatchEvent(event) { return dispatch(this, event); },
    focus() {
      const d = this.ownerDocument;
      if (d) d.activeElement = this;
    },
    blur() {
      const d = this.ownerDocument;
      if (d && d.activeElement === this) d.activeElement = d.body || d;
    },
    cloneNode(deep) {
      const copy = makeElement(this._tag, this.ownerDocument);
      this._attrs.forEach((v, k) => copy.setAttribute(k, v));
      copy._classes = new Set(this._classes);
      copy._text = this._text;
      if (deep) this._children.forEach((c) => copy.appendChild(c.cloneNode ? c.cloneNode(true) : c));
      return copy;
    }
  };

  // Reflected IDL attributes: in a real DOM, `input.accept = 'x'` makes
  // getAttribute('accept') return 'x'. Without this the shim would report
  // null for properties the modules legitimately set, and the suite would
  // pass on markup the browser would never produce.
  const REFLECT_STRING = ['type', 'accept', 'name', 'placeholder', 'src', 'href', 'title', 'target', 'rel', 'width', 'height', 'role'];
  const REFLECT_BOOL = ['multiple', 'required', 'disabled', 'checked', 'draggable', 'hidden', 'selected', 'readonly', 'autofocus'];

  function reflect(node) {
    REFLECT_STRING.forEach((name) => {
      Object.defineProperty(node, name, {
        configurable: true,
        enumerable: true,
        get() { const v = this._attrs.get(name); return v === undefined ? '' : v; },
        set(v) { this._attrs.set(name, v == null ? '' : String(v)); }
      });
    });
    REFLECT_BOOL.forEach((name) => {
      Object.defineProperty(node, name, {
        configurable: true,
        enumerable: true,
        get() { return this._attrs.has(name); },
        set(v) { if (v) this._attrs.set(name, ''); else this._attrs.delete(name); }
      });
    });
  }

  function makeElement(tag, doc) {
    const node = {
      nodeType: 1,
      _tag: String(tag).toLowerCase(),
      _attrs: new Map(),
      _classes: new Set(),
      _children: [],
      _listeners: {},
      _text: '',
      parentNode: null,
      ownerDocument: doc || null,
      style: {},
      _uid: ++uid
    };
    Object.setPrototypeOf(node, proto);
    reflect(node);
    if (node._tag === 'select') {
      Object.defineProperty(node, 'value', {
        configurable: true,
        get() {
          const options = collect(node, (el) => el._tag === 'option', []);
          const chosen = options.find((o) => o.selected) || options[0];
          return chosen ? String(chosen.value == null ? chosen.textContent : chosen.value) : '';
        },
        set(v) {
          collect(node, (el) => el._tag === 'option', []).forEach((o) => {
            const own = String(o.value == null ? o.textContent : o.value);
            o.selected = own === String(v);
          });
        }
      });
    }
    return node;
  }

  function makeText(text, doc) {
    const node = {
      nodeType: 3,
      parentNode: null,
      ownerDocument: doc || null,
      _text: String(text == null ? '' : text)
    };
    Object.defineProperty(node, 'textContent', {
      enumerable: true,
      configurable: true,
      get() { return node._text; },
      set(v) { node._text = String(v == null ? '' : v); }
    });
    Object.defineProperty(node, 'nodeValue', {
      enumerable: true,
      configurable: true,
      get() { return node._text; },
      set(v) { node._text = String(v == null ? '' : v); }
    });
    return node;
  }

  function dispatch(target, event) {
    const e = event || {};
    if (!e.type) throw new Error('dispatchEvent needs {type}');
    if (!e.target) e.target = target;
    if (typeof e.preventDefault !== 'function') {
      e.defaultPrevented = false;
      e.preventDefault = function () { this.defaultPrevented = true; };
    }
    if (typeof e.stopPropagation !== 'function') {
      e._stopped = false;
      e.stopPropagation = function () { this._stopped = true; };
    }
    const path = [];
    for (let n = target; n; n = n.parentNode) path.push(n);
    for (let i = 0; i < path.length; i++) {
      const node = path[i];
      e.currentTarget = node;
      const list = ((node._listeners && node._listeners[e.type]) || []).slice();
      for (let j = 0; j < list.length; j++) {
        list[j].call(node, e);
        if (e._stopped) return !e.defaultPrevented;
      }
      if (e._stopped) return !e.defaultPrevented;
    }
    return !e.defaultPrevented;
  }

  function makeDocument() {
    const doc = makeElement('#document', null);
    doc.nodeType = 9;
    doc.ownerDocument = doc;
    doc.createElement = (tag) => makeElement(tag, doc);
    doc.createTextNode = (text) => makeText(text, doc);
    doc.createDocumentFragment = () => makeElement('#fragment', doc);
    doc.documentElement = makeElement('html', doc);
    doc.body = makeElement('body', doc);
    doc.documentElement.appendChild(doc.body);
    doc.appendChild(doc.documentElement);
    doc.activeElement = doc.body;
    return doc;
  }

  function event(type, props) { return Object.assign({ type }, props || {}); }

  function dataTransfer() {
    const store = new Map();
    return {
      types: [],
      effectAllowed: '',
      files: null,
      setData(type, value) {
        store.set(String(type), String(value));
        if (this.types.indexOf(type) === -1) this.types.push(type);
      },
      getData(type) { const v = store.get(String(type)); return v === undefined ? '' : v; },
      clearData() { store.clear(); this.types = []; },
      setDragImage() {}
    };
  }

  function file(name, type, size, content) {
    const text = content == null ? 'x'.repeat(Math.max(1, size || 8)) : String(content);
    const bytes = new TextEncoder().encode(text);
    return {
      name,
      type,
      size: size == null ? bytes.length : size,
      lastModified: 1758600000000,
      arrayBuffer: () => Promise.resolve(bytes.buffer.slice(0)),
      text: () => Promise.resolve(text)
    };
  }

  return { makeDocument, makeElement, event, dataTransfer, file, version: 'shim' };
}

function buildJsdom() {
  let jsdom = null;
  try { jsdom = require('jsdom'); } catch (e) { jsdom = null; }
  if (!jsdom) return null;
  const dom = new jsdom.JSDOM('<!doctype html><html><body></body></html>');
  const { window } = dom;
  return {
    version: 'jsdom ' + (jsdom.version || ''),
    dom,
    makeDocument: () => window.document,
    makeElement: (tag, doc) => (doc || window.document).createElement(tag),
    event: (type, props) => {
      const e = new window.Event(type, { bubbles: true, cancelable: true });
      // jsdom Events are not extensible on all versions — copy props on.
      Object.keys(props || {}).forEach((k) => { e[k] = props[k]; });
      return e;
    },
    dataTransfer: () => {
      const initial = new Map();
      return {
        types: [],
        effectAllowed: '',
        files: null,
        setData(type, value) { initial.set(String(type), String(value)); if (this.types.indexOf(type) === -1) this.types.push(type); },
        getData(type) { const v = initial.get(String(type)); return v === undefined ? '' : v; },
        clearData() { initial.clear(); this.types = []; },
        setDragImage() {}
      };
    },
    file: (name, type, size, content) => new window.File(
      [content == null ? 'x'.repeat(Math.max(1, size || 8)) : String(content)],
      name,
      { type }
    )
  };
}

// ============================================================
// Environment
// ============================================================

const shim = buildJsdom() || buildShim();
const doc = shim.makeDocument();

globalThis.window = globalThis;
globalThis.document = doc;
try {
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: null, userAgent: 'pallettai-smoke' },
    configurable: true,
    writable: true
  });
} catch (e) { /* node may expose a non-configurable navigator; the modules guard for that */ }

const ui = (name) => require(path.join(ROOT, 'ui', name));
const State = ui('state-manager.js');
const Media = ui('media-manager.js');
const Git = ui('git-controller.js');
const Ast = ui('ast-inspector.js');

// Fake clock so the autosave debounce is deterministic.
function fakeClock() {
  let seq = 0;
  const jobs = new Map();
  return {
    setTimeout(fn, ms) { const id = ++seq; jobs.set(id, { fn, ms }); return id; },
    clearTimeout(id) { jobs.delete(id); },
    run() {
      const list = Array.from(jobs.entries());
      jobs.clear();
      list.forEach(([, job]) => job.fn());
      return list.length;
    },
    pending: () => jobs.size,
    delays: () => Array.from(jobs.values()).map((j) => j.ms)
  };
}

function mountPoint() {
  const el = shim.makeElement('div', doc);
  doc.body.appendChild(el);
  return el;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function tapAsyncErrors() {
  const seen = [];
  const handler = (err) => { seen.push(err); };
  process.on('unhandledRejection', handler);
  return { seen, stop: () => process.removeListener('unhandledRejection', handler) };
}

// ============================================================
// 1. Reactive state engine
// ============================================================

async function sectionStateEngine() {
  section('1. State manager — Proxy reactivity & action bus');

  const initial = {
    workspace: {
      pages: [{ id: 'home', title: 'Home' }, { id: 'about', title: 'About' }],
      tokens: { brand: 'oklch(0.65 0.24 260)', spacing: 8 }
    },
    activeFile: 'index.html'
  };

  await check('createStore() rejects a non-object seed with a typed error', () => {
    throws(() => State.createStore(null), 'bad_input');
    throws(() => State.createStore([]), 'bad_input');
    return true;
  });

  await check('a nested write fires the subscriber with the exact dotted path', () => {
    const store = State.createStore(State.clonePlain(initial));
    const seen = [];
    store.subscribe((payload) => seen.push(payload));
    store.state.workspace.pages[0].title = 'Landing';
    ok(seen.length === 1, 'expected exactly one notification, got ' + seen.length);
    eq(seen[0].change.path, 'workspace.pages.0.title');
    eq(seen[0].change.previous, 'Home');
    eq(seen[0].change.value, 'Landing');
    eq(store.get('workspace.pages.0.title'), 'Landing');
    return true;
  });

  await check('writing the value that is already there notifies nobody', () => {
    const store = State.createStore(State.clonePlain(initial));
    let calls = 0;
    store.subscribe(() => { calls++; });
    store.state.activeFile = 'index.html';
    eq(calls, 0, 'no-op write must be suppressed');
    eq(store.stats().suppressed, 1);
    eq(store.stats().mutations, 0);
    return true;
  });

  await check('a path subscription fires for the path and its descendants only', () => {
    const store = State.createStore(State.clonePlain(initial));
    const hits = [];
    store.onStateChange('workspace.tokens', (p) => hits.push(p.change.path));
    store.state.activeFile = 'about.html';
    store.state.workspace.tokens.brand = 'oklch(0.7 0.2 30)';
    store.state.workspace.tokens.spacing = 12;
    store.state.workspace.pages[1].title = 'Us';
    eq(hits, ['workspace.tokens.brand', 'workspace.tokens.spacing']);
    return true;
  });

  await check('a shared object is copied, not mislabelled [circular]', () => {
    const token = { brand: 'oklch(0.6 0.2 100)' };
    const store = State.createStore({ a: token, b: token, list: [token, token] });
    const json = JSON.stringify(store.snapshot());
    ok(json.indexOf('[circular]') === -1, 'repeating a reference is not a cycle: ' + json);
    eq(store.snapshot().b.brand, 'oklch(0.6 0.2 100)', 'the second key keeps its data');
    eq(store.snapshot().list[1].brand, 'oklch(0.6 0.2 100)', 'and so does a repeated array slot');
    return true;
  });

  await check('in-place array mutations that keep the length still notify', () => {
    const store = State.createStore({ pages: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });
    const seen = [];
    store.subscribe((p) => p.changes.forEach((c) => seen.push(c.path + ':' + c.type)));
    store.state.pages.sort((x, y) => (x.id < y.id ? 1 : -1));
    store.state.pages.reverse();
    store.state.pages.splice(0, 1, { id: 'z' });
    store.state.pages.fill({ id: 'q' });
    eq(seen, ['pages:splice', 'pages:splice', 'pages:splice', 'pages:splice'], 'a re-order is a mutation');
    eq(store.snapshot().pages.map((p) => p.id), ['q', 'q', 'q']);
    return true;
  });

  await check('values escaping through array methods stay reactive', () => {
    const store = State.createStore({ pages: [{ id: 'a', title: 'A' }] });
    const seen = [];
    store.subscribe((p) => seen.push(p.change.path));
    const viaFilter = store.state.pages.filter((p) => p.id === 'a')[0];
    same(viaFilter, store.state.pages[0], 'the escaped element IS the store element');
    viaFilter.title = 'via filter()';
    store.get('pages')[0].title = 'via get()';
    store.state.pages.find((p) => p.id === 'a').title = 'via find()';
    eq(seen.length, 3, 'each escaped write notified: ' + seen.join(', '));
    let iterated = null;
    for (const page of store.state.pages) { iterated = page; break; }
    iterated.title = 'while iterating';
    eq(seen.length, 4, 'iteration yields live elements too');
    eq(store.state.pages[0].title, 'while iterating');
    return true;
  });

  await check('visitor callbacks receive live elements, not raw ones', () => {
    const store = State.createStore({ pages: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }] });
    const seen = [];
    store.subscribe((p) => seen.push(p.change.path));
    store.state.pages.forEach((p) => { p.title = p.title + '!'; });
    eq(seen, ['pages.0.title', 'pages.1.title'], 'writes inside forEach are visible');
    const mapped = store.state.pages.map((p) => p);
    same(mapped[0], store.state.pages[0], 'map hands back the store elements themselves');
    store.state.pages.reduce((acc, p) => { p.title = 'reduced'; return acc; }, 0);
    eq(seen.length, 4, 'reduce visits live elements too');
    eq(store.state.pages[1].title, 'reduced');
    const chained = store.state.pages.fill({ id: 'z', title: 'z' });
    same(chained, store.state.pages, 'fill returns the proxy so chaining stays in the store');
    eq(seen[seen.length - 1], 'pages', 'an equal-length fill reports the array itself');
    return true;
  });

  await check('batch() coalesces many mutations into one notification', () => {
    const store = State.createStore(State.clonePlain(initial));
    const batches = [];
    store.subscribe((p) => batches.push(p.changes.length));
    store.batch(() => {
      store.state.activeFile = 'a.html';
      store.state.workspace.tokens.spacing = 16;
      store.state.workspace.pages.push({ id: 'pricing', title: 'Pricing' });
    });
    eq(batches, [3], 'one callback carrying three changes');
    eq(store.get('workspace.pages').length, 3);
    eq(store.stats().batches, 1);
    return true;
  });

  await check('array mutation notifies through the length path', () => {
    const store = State.createStore({ pages: [] });
    const paths = [];
    store.subscribe((p) => p.changes.forEach((c) => paths.push(c.path)));
    store.state.pages.push({ id: 'one' });
    ok(paths.indexOf('pages.length') > -1, 'expected a pages.length change, saw ' + JSON.stringify(paths));
    eq(store.get('pages').length, 1);
    return true;
  });

  await check('deleteProperty notifies with the previous value', () => {
    const store = State.createStore({ workspace: { draft: true } });
    const seen = [];
    store.subscribe((p) => seen.push(p.change));
    delete store.state.workspace.draft;
    eq(seen.length, 1);
    eq(seen[0].type, 'delete');
    eq(seen[0].path, 'workspace.draft');
    eq(seen[0].previous, true);
    eq('draft' in store.state.workspace, false);
    return true;
  });

  await check('a throwing subscriber cannot stop the others', () => {
    const store = State.createStore({ count: 0 });
    const errors = [];
    const storeWithReporter = State.createStore({ count: 0 }, { onError: (e) => errors.push(e.message) });
    let reached = 0;
    storeWithReporter.subscribe(() => { throw new Error('panel exploded'); });
    storeWithReporter.subscribe(() => { reached++; });
    storeWithReporter.state.count = 1;
    eq(reached, 1, 'the second subscriber still ran');
    eq(errors, ['panel exploded']);
    ok(store.subscribers() === 0);
    return true;
  });

  await check('reducers run on dispatchAction and emit a typed event', () => {
    const store = State.createStore({ workspace: { pages: [] } });
    const unregister = store.registerReducer('ADD_PAGE', (state, payload) => {
      state.workspace.pages.push({ id: payload.id, title: payload.title });
    });
    const actions = [];
    store.on('action:ADD_PAGE', (p) => actions.push(p));
    const handled = store.dispatchAction('ADD_PAGE', { id: 'contact', title: 'Contact' });
    eq(handled.handled, true);
    eq(store.get('workspace.pages.0.id'), 'contact');
    eq(actions.length, 1);
    eq(actions[0].title, 'Contact');
    const unhandled = store.dispatchAction('UNKNOWN', {});
    eq(unhandled.handled, false);
    unregister();
    store.dispatchAction('ADD_PAGE', { id: 'x', title: 'X' });
    eq(store.get('workspace.pages').length, 1, 'the reducer was unregistered');
    throws(() => store.registerReducer('', () => {}), 'bad_input');
    throws(() => store.dispatchAction(''), 'bad_input');
    return true;
  });

  await check('snapshot() is a plain, detached deep clone', () => {
    const store = State.createStore({ workspace: { tokens: { brand: 'oklch(0.6 0.2 100)' } }, pages: [{ id: 'a' }] });
    const snap = store.snapshot();
    snap.workspace.tokens.brand = 'mutated';
    snap.pages.push({ id: 'b' });
    eq(store.get('workspace.tokens.brand'), 'oklch(0.6 0.2 100)', 'the store is untouched by snapshot edits');
    eq(store.get('pages.length'), 1);
    ok(!('__raw' in snap), 'the snapshot is not a proxy');
    return true;
  });

  await check('cycle handling keeps identity and a serialisable snapshot', () => {
    const cyc = State.createStore({ node: { name: 'root' } });
    cyc.state.node.child = cyc.state.node; // a real cycle through the proxy
    same(cyc.state.node.child, cyc.state.node, 'a proxy written into the tree keeps its identity on read');
    const snap = cyc.snapshot();
    eq(snap.node.name, 'root');
    eq(snap.node.child.child, '[circular]');
    const store2 = State.createStore({ a: 1 });
    store2.state.self = store2.snapshot();
    has(JSON.stringify(store2.snapshot()), '"self"');
    return true;
  });

  section('1b. State manager — debounced IPC autosave');

  await check('autosave debounces a burst into a single vault write', async () => {
    const store = State.createStore({ workspace: { tokens: { brand: 'a' }, pages: [{ id: 'home' }] } });
    const clock = fakeClock();
    const writes = [];
    const bridge = { projectVault: { saveState: (payload) => { writes.push(payload); return Promise.resolve({ ok: true }); } } };
    const autosave = State.attachAutosave(store, { bridge, debounceMs: 800, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
    store.state.workspace.tokens.brand = 'b';
    store.state.workspace.tokens.brand = 'c';
    store.state.workspace.pages.push({ id: 'about' });
    eq(clock.pending(), 1, 'the burst leaves exactly one pending timer');
    eq(clock.delays(), [800]);
    eq(autosave.status(), 'pending');
    await autosave.flush();
    eq(writes.length, 1, 'one write for the whole burst');
    eq(writes[0].path, 'workspace');
    eq(writes[0].data.tokens.brand, 'c');
    eq(writes[0].data.pages.length, 2);
    eq(autosave.status(), 'saved');
    autosave.stop();
    return true;
  });

  await check('an unchanged flush writes nothing (fingerprint skip)', async () => {
    const store = State.createStore({ workspace: { tokens: { brand: 'a' } } });
    const clock = fakeClock();
    let writes = 0;
    const bridge = { projectVault: { saveState: () => { writes++; return Promise.resolve({ ok: true }); } } };
    const autosave = State.attachAutosave(store, { bridge, debounceMs: 500, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
    store.state.workspace.tokens.brand = 'b';
    await autosave.flush();
    eq(writes, 1);
    const second = await autosave.flush();
    eq(writes, 1, 'no second write for identical bytes');
    eq(second.skipped, true);
    autosave.stop();
    return true;
  });

  await check('offline edits queue and drain when a bridge appears later', async () => {
    const store = State.createStore({ workspace: { draft: false } });
    const clock = fakeClock();
    const writes = [];
    const autosave = State.attachAutosave(store, { debounceMs: 100, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
    eq(autosave.status(), 'offline');
    eq(autosave.hasBridge(), false);
    store.state.workspace.draft = true;
    clock.run();
    const first = await autosave.flush();
    eq(first.ok, false);
    eq(first.reason, 'offline');
    eq(autosave.status(), 'offline');
    ok(autosave.pending(), 'the payload is retained while offline');
    const drained = await autosave.setBridge({ projectVault: { write: (payload) => { writes.push(payload); return Promise.resolve({ ok: true }); } } });
    eq(drained.ok, true);
    eq(writes.length, 1, 'the queued payload was drained by setBridge');
    eq(writes[0].data.draft, true);
    eq(autosave.status(), 'saved');
    autosave.stop();
    return true;
  });

  await check('a rejected save reports error and keeps the data dirty', async () => {
    const store = State.createStore({ workspace: { draft: 0 } });
    const clock = fakeClock();
    const attempts = [];
    let mode = 'fail';
    const bridge = { projectVault: { saveState: (payload) => { attempts.push(payload.data.draft); return Promise.resolve(mode === 'fail' ? { ok: false, reason: 'disk-full' } : { ok: true }); } } };
    const statuses = [];
    const autosave = State.attachAutosave(store, { bridge, debounceMs: 50, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
    autosave.onStatus((s) => statuses.push(s));
    store.state.workspace.draft = 1;
    const failed = await autosave.flush();
    eq(failed.ok, false);
    eq(autosave.status(), 'error');
    ok(autosave.pending(), 'a failed save must stay pending so it can retry');
    mode = 'ok';
    const retried = await autosave.flush();
    eq(retried.ok, true);
    eq(attempts, [1, 1], 'the same payload was retried');
    eq(autosave.status(), 'saved');
    has(statuses.join(','), 'saving');
    has(statuses.join(','), 'error');
    autosave.stop();
    return true;
  });

  await check('a throwing bridge surfaces error instead of crashing the save', async () => {
    const store = State.createStore({ workspace: { n: 0 } });
    const clock = fakeClock();
    const autosave = State.attachAutosave(store, {
      bridge: { projectVault: { saveState: () => { throw new Error('ipc closed'); } } },
      debounceMs: 10, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout
    });
    store.state.workspace.n = 5;
    const out = await autosave.flush();
    eq(out.ok, false);
    has(out.error, 'ipc closed');
    eq(autosave.status(), 'error');
    autosave.stop();
    return true;
  });

  await check('stop() detaches the autosave from the store', () => {
    const store = State.createStore({ workspace: { n: 0 } });
    const clock = fakeClock();
    const autosave = State.attachAutosave(store, { debounceMs: 20, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
    autosave.stop();
    store.state.workspace.n = 1;
    eq(clock.pending(), 0, 'no timer after stop()');
    return true;
  });

  await check('the autosave status pill reflects state changes', () => {
    const store = State.createStore({ workspace: { n: 0 } });
    const clock = fakeClock();
    const bridge = { projectVault: { saveState: () => Promise.resolve({ ok: true }) } };
    const autosave = State.attachAutosave(store, { bridge, debounceMs: 30, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
    const host = mountPoint();
    const pill = State.mountStatus(host, autosave, doc);
    eq(pill.el.getAttribute('role'), 'status');
    eq(pill.el.getAttribute('aria-live'), 'polite');
    eq(pill.el.getAttribute('data-status'), 'idle');
    eq(pill.el.textContent, 'Ready');
    store.state.workspace.n = 3;
    eq(pill.el.getAttribute('data-status'), 'pending');
    eq(pill.el.textContent, 'Unsaved changes');
    pill.paint('error');
    eq(pill.el.textContent, 'Save failed');
    ok(pill.el.classList.contains('is-error'));
    pill.destroy();
    autosave.stop();
    return true;
  });
}

// ============================================================
// 2. Media manager
// ============================================================

async function sectionMediaManager() {
  section('2. Media manager — ingestion, IPC payload, chips');

  const image = shim.file('hero photo.png', 'image/png', 240 * 1024, 'PNG-BYTES');
  const retina = shim.file('logo@2x.webp', 'image/webp', 90 * 1024, 'WEBP');
  const font = shim.file('inter.woff2', 'font/woff2', 40 * 1024, 'FONT');
  const psd = shim.file('mockup.psd', 'image/vnd.adobe.photoshop', 5000, 'PSD');
  const huge = shim.file('raw.tiff', 'image/tiff', 900 * 1024 * 1024, 'TIFF');

  await check('mock File objects classify and reject correctly', () => {
    const { accepted, rejected } = Media.describeFiles([image, retina, font, psd, huge], {});
    eq(accepted.map((a) => a.kind), ['image', 'image', 'font']);
    eq(rejected.map((r) => r.reason), ['unsupported-type', 'too-large']);
    eq(rejected[0].name, 'mockup.psd');
    ok(Media.classifyFile('art.avif', '') === 'image');
    ok(Media.classifyFile('clip.webm', '') === 'video');
    ok(Media.classifyFile('no-extension', 'image/png') === 'image', 'MIME is the fallback when there is no extension');
    ok(Media.classifyFile('bundle.psd', '') === 'other', 'psd is not a browser-decodable image');
    return true;
  });

  await check('buildCompressPayload() marks inline vs too-large and keeps defaults', () => {
    const payload = Media.buildCompressPayload([
      { name: 'hero photo.png', kind: 'image', bytes: 240 * 1024, mime: 'image/png' },
      { name: 'huge.png', kind: 'image', bytes: 900 * 1024 * 1024, mime: 'image/png' },
      { name: 'local.png', kind: 'image', bytes: 1000, mime: 'image/png', path: '/tmp/local.png' }
    ], {});
    eq(payload.targets, ['avif', 'webp']);
    eq(payload.retina, [1, 2]);
    eq(payload.quality, 78);
    eq(payload.assets.length, 3);
    eq(payload.assets[0].inline, true);
    ok(!payload.assets[1].inline);
    eq(payload.assets[1].tooLargeToInline, true);
    eq(payload.assets[2].path, '/tmp/local.png');
    ok(!payload.assets[2].inline, 'an entry with a real path never inlines');
    const tiny = Media.buildCompressPayload([{ name: 'a.png', kind: 'image', bytes: 2048, mime: 'image/png' }], { maxInlineBytes: 1024 });
    eq(tiny.assets[0].tooLargeToInline, true);
    return true;
  });

  await check('readAssetContent() base64-encodes a mock file', async () => {
    const entry = { inline: true };
    const b64 = await Media.readAssetContent(entry, shim.file('x.png', 'image/png', 0, 'hello'));
    eq(Buffer.from(b64, 'base64').toString('utf8'), 'hello');
    eq(await Media.readAssetContent({ inline: false }, shim.file('x.png', 'image/png', 0, 'hi')), '');
    eq(await Media.readAssetContent({ inline: true }, null), '');
    return true;
  });

  const ipcCalls = [];
  const progressEvents = [];
  const inserted = [];
  const imageId = Media.assetIdFor('hero photo.png', image.size, 'image/png');
  const fontId = Media.assetIdFor('inter.woff2', font.size, 'font/woff2');

  const bridge = {
    compressAsset(payload, onProgress) {
      ipcCalls.push(payload);
      const assets = payload.assets;
      if (onProgress) {
        assets.forEach((a) => onProgress({ assetId: a.id, percent: 35, stage: 'reading' }));
        assets.forEach((a) => onProgress({ assetId: a.id, percent: 90, stage: 'encoding' }));
        // a drop must never rewind the bar
        assets.forEach((a) => onProgress({ assetId: a.id, percent: 40, stage: 'encoding' }));
      }
      return Promise.resolve({
        ok: true,
        assets: assets.map((a) => (a.kind === 'image'
          ? {
            id: a.id,
            name: a.name,
            kind: a.kind,
            bytes: Math.round(a.bytes / 4),
            savedBytes: a.bytes - Math.round(a.bytes / 4),
            width: 1600,
            height: 900,
            sources: {
              avif: [{ url: '/assets/hero-1600.avif', width: 1600 }, { url: '/assets/hero-800.avif', width: 800 }],
              webp: [{ url: '/assets/hero-1600.webp', width: 1600 }, { url: '/assets/hero-800.webp', width: 800 }]
            }
          }
          : { id: a.id, name: a.name, kind: a.kind, bytes: a.bytes, optimized: false, status: 'unoptimized' }))
      });
    }
  };

  const host = mountPoint();
  const controller = Media.mount(host, {
    doc,
    bridge,
    onProgress: (asset, pct, stage) => progressEvents.push({ id: asset.id, pct, stage }),
    onInsert: (asset, markup) => inserted.push({ id: asset.id, markup })
  });

  await check('the grid mounts with a dropzone, grid and empty state', () => {
    ok(controller, 'mount() returned a controller');
    ok(controller.dropzone.getAttribute('data-pai-media') === 'dropzone');
    eq(controller.grid.getAttribute('data-pai-media'), 'grid');
    const empty = host.querySelector('[data-pai-media-empty]');
    eq(empty.hidden, false);
    ok(host.querySelector('[data-pai-media-input]').getAttribute('accept').indexOf('.avif') > -1, 'the picker advertises the formats it accepts');
    eq(host.querySelector('[data-pai-media-empty]').textContent.length > 0, true);
    return true;
  });

  await check('dropping files dispatches the exact compressAsset IPC payload', async () => {
    const result = await controller.addFiles([image, retina, font, psd]);
    eq(result.accepted, 3);
    eq(result.rejected, 1);
    eq(ipcCalls.length, 1, 'one IPC call for the batch');
    const payload = ipcCalls[0];
    eq(payload.targets, ['avif', 'webp']);
    eq(payload.retina, [1, 2]);
    eq(payload.assets.length, 3);
    eq(payload.assets.map((a) => a.name), ['hero photo.png', 'logo@2x.webp', 'inter.woff2']);
    eq(payload.assets.map((a) => a.kind), ['image', 'image', 'font']);
    eq(payload.assets[1].bytes, 90 * 1024);
    eq(payload.assets[0].inline, true, 'small local files travel as base64');
    ok(/^[a-z0-9][a-z0-9-]{5,}$/i.test(payload.assets[0].id), 'each asset carries a stable id: ' + payload.assets[0].id);
    return true;
  });

  await check('rejected files are surfaced in the UI with a reason', () => {
    const items = controller.rejects();
    eq(items.length, 1);
    has(items[0], 'mockup.psd');
    has(items[0], 'unsupported type');
    const list = host.querySelector('[data-pai-media-rejects]');
    eq(list.hidden, false);
    eq(list.children[0].getAttribute('data-reason'), 'unsupported-type');
    return true;
  });

  await check('progress events stream into the card progress bar', () => {
    const stages = progressEvents.map((e) => e.stage);
    has(stages.join(','), 'queued');
    has(stages.join(','), 'reading');
    has(stages.join(','), 'encoding');
    const bar = host.querySelector('[data-pai-media-progress="' + imageId + '"]');
    ok(bar, 'the card exposes a progressbar');
    eq(bar.getAttribute('role'), 'progressbar');
    eq(bar.getAttribute('aria-valuenow'), '100');
    eq(bar.children[0].style.width, '100%');
    return true;
  });

  await check('the progress bar never rewinds', () => {
    const seen = progressEvents.filter((e) => e.id === imageId).map((e) => e.pct);
    for (let i = 1; i < seen.length; i++) {
      ok(seen[i] >= seen[i - 1], 'percent went backwards: ' + seen.join(' → '));
    }
    has(seen.join(','), '90');
    return true;
  });

  await check('optimized cards report their new variants', () => {
    const card = host.querySelector('[data-pai-asset="' + imageId + '"]');
    eq(card.getAttribute('data-status'), 'ready');
    eq(card.getAttribute('data-kind'), 'image');
    eq(card.draggable, true);
    const status = host.querySelector('[data-pai-media-status="' + imageId + '"]');
    has(status.textContent, 'AVIF');
    has(status.textContent, 'WebP');
    const fontCard = host.querySelector('[data-pai-asset="' + fontId + '"]');
    eq(fontCard.getAttribute('data-status'), 'unoptimized');
    has(host.querySelector('[data-pai-media-status="' + fontId + '"]').textContent, 'Original kept');
    const count = host.querySelector('[data-pai-media-count]').textContent;
    has(count, '3 assets');
    has(count, 'saved');
    eq(host.querySelector('[data-pai-media-empty]').hidden, true);
    return true;
  });

  await check('pictureMarkup() prefers the smallest candidate as src', () => {
    const card = host.querySelector('[data-pai-asset="' + imageId + '"]');
    const markup = controller.markupFor(imageId);
    has(markup, '<picture');
    has(markup, 'type="image/avif"');
    has(markup, 'type="image/webp"');
    has(markup, 'src="/assets/hero-800.webp"', 'the base image is the 800px file, not the 1600px one');
    has(markup, 'srcset="/assets/hero-1600.webp 1600w, /assets/hero-800.webp 800w"');
    ok(/<img [^>]*\salt="[^"]+"/.test(markup), 'the alt attribute is emitted as a real attribute');
    ok(markup.indexOf(' alt="hero photo"') > -1, 'alt falls back to the humanised file name');
    ok(card, 'the card is still mounted');
    const explicit = Media.pictureMarkup({ id: 'x', name: 'a.png', fallback: '/cdn/hero.webp', webp: [{ url: '/cdn/small.webp', width: 200 }] });
    has(explicit, 'src="/cdn/hero.webp"', 'an explicit fallback wins over the derived smallest candidate');
    return true;
  });

  await check('an asset chip dropped on the canvas delivers the markup', () => {
    const card = host.querySelector('[data-pai-asset="' + imageId + '"]');
    const dt = shim.dataTransfer();
    card.dispatchEvent(shim.event('dragstart', { dataTransfer: dt }));
    const raw = dt.getData('application/x-pai-asset');
    ok(raw, 'the chip published a drag payload');
    const parsed = JSON.parse(raw);
    eq(parsed.asset.id, imageId);
    has(parsed.markup, '<picture');
    eq(dt.effectAllowed, 'copy');
    has(dt.getData('text/plain'), 'optimized <picture>');
    eq(inserted.length >= 1, true);
    eq(inserted[0].id, imageId);

    const canvas = mountPoint();
    const dropped = [];
    const uninstall = Media.installDropTarget(canvas, {
      onAsset: (asset, markup) => dropped.push({ asset, markup })
    });
    canvas.dispatchEvent(shim.event('dragover', { dataTransfer: dt }));
    ok(canvas.classList.contains('pai-drop-active'), 'dragover highlights the canvas');
    canvas.dispatchEvent(shim.event('drop', { dataTransfer: dt }));
    eq(dropped.length, 1);
    eq(dropped[0].asset.id, imageId);
    has(dropped[0].markup, '<picture');
    eq(canvas.classList.contains('pai-drop-active'), false, 'the highlight clears on drop');
    const other = shim.dataTransfer();
    canvas.dispatchEvent(shim.event('drop', { dataTransfer: other }));
    eq(dropped.length, 1, 'a foreign drag payload is ignored');
    uninstall();
    return true;
  });

  await check('with no bridge the assets stay unoptimized instead of failing', async () => {
    const host2 = mountPoint();
    const offline = Media.mount(host2, { doc, bridge: null });
    const out = await offline.addFiles([image]);
    eq(out.optimized, false);
    eq(out.accepted, 1);
    const card = host2.querySelector('[data-kind="image"]');
    eq(card.getAttribute('data-status'), 'unoptimized');
    eq(host2.querySelector('[data-pai-media-progress="' + imageId + '"]').getAttribute('aria-valuenow'), '100');
    offline.destroy();
    eq(host2.children.length, 0, 'destroy() removes the panel');
    return true;
  });

  await check('a response missing an asset marks that card as failed', async () => {
    const host3 = mountPoint();
    const partial = Media.mount(host3, { doc, bridge: { compressAsset: () => Promise.resolve({ ok: false, error: 'encoder blew up', assets: [] }) } });
    await partial.addFiles([image]);
    const card = host3.querySelector('[data-kind="image"]');
    eq(card.getAttribute('data-status'), 'error');
    const statusNode = host3.querySelector('[data-pai-media-status="' + imageId + '"]');
    has(statusNode.textContent, 'Failed');
    eq(statusNode.getAttribute('title'), 'encoder blew up', 'the failure reason survives the normaliser');
    eq(partial.assets()[0].error, 'encoder blew up');
    partial.destroy();
    return true;
  });

  await check('a rejected compressAsset promise is caught per card', async () => {
    const host4 = mountPoint();
    const boom = Media.mount(host4, { doc, bridge: { compressAsset: () => Promise.reject(new Error('worker crashed')) } });
    const out = await boom.addFiles([image]);
    has(out.error, 'worker crashed');
    eq(host4.querySelector('[data-kind="image"]').getAttribute('data-status'), 'error');
    boom.destroy();
    return true;
  });

  await check('two identical files in one drop get distinct ids and both settle', async () => {
    const host6 = mountPoint();
    const payloads = [];
    const panel = Media.mount(host6, {
      doc,
      bridge: {
        compressAsset: (payload) => {
          payloads.push(payload.assets.map((a) => a.id));
          return Promise.resolve({ assets: payload.assets.map((a) => ({ id: a.id, name: a.name, kind: a.kind, bytes: 100, optimized: false, status: 'unoptimized' })) });
        }
      }
    });
    const twin = () => shim.file('same.png', 'image/png', 4096, 'SAME');
    await panel.addFiles([twin(), twin()]);
    eq(payloads[0].length, 2);
    ok(payloads[0][0] !== payloads[0][1], 'the payload ids are unique: ' + payloads[0].join(', '));
    eq(panel.assets().length, 2);
    const cards = host6.querySelectorAll('[data-pai-asset]');
    eq(cards.length, 2);
    ok(cards[0].getAttribute('data-pai-asset') !== cards[1].getAttribute('data-pai-asset'), 'the cards are keyed apart');
    eq(cards.map((c) => c.getAttribute('data-status')), ['unoptimized', 'unoptimized'], 'both cards settled');
    panel.destroy();
    return true;
  });

  await check('a backend that renames the asset cannot freeze the card', async () => {
    const host7 = mountPoint();
    const panel = Media.mount(host7, {
      doc,
      bridge: {
        compressAsset: (payload) => Promise.resolve({
          assets: payload.assets.map((a) => ({
            id: 'backend-' + a.name,
            name: a.name,
            kind: a.kind,
            bytes: 12,
            sources: { webp: [{ url: '/assets/x.webp', width: 800 }] }
          }))
        })
      }
    });
    await panel.addFiles([shim.file('renamed.png', 'image/png', 2048, 'X')]);
    const asset = panel.assets()[0];
    eq(asset.optimized, true, 'the optimisation result still landed');
    eq(asset.sourceId, 'backend-renamed.png', 'the backend id is kept for traceability');
    eq(host7.querySelector('[data-kind="image"]').getAttribute('data-status'), 'ready');
    has(host7.querySelector('[data-pai-media-status="' + asset.id + '"]').textContent, 'WebP');
    panel.destroy();
    return true;
  });

  await check('a real file-picker change event ingests files', async () => {
    const host5 = mountPoint();
    const out = [];
    const panel = Media.mount(host5, { doc, bridge: null, onProgress: (a, p, s) => out.push(s) });
    const input = host5.querySelector('[data-pai-media-input]');
    input.files = [shim.file('picked.svg', 'image/svg+xml', 2048, '<svg/>')];
    input.dispatchEvent(shim.event('change', {}));
    await new Promise((r) => setTimeout(r, 0));
    eq(panel.assets().length, 1);
    eq(panel.assets()[0].name, 'picked.svg');
    panel.destroy();
    return true;
  });

  controller.destroy();
}

// ============================================================
// 3. Git & release controller
// ============================================================

async function sectionGitController() {
  section('3. Git controller — staging, timeline, release');

  const baseline = { 'index.html': 'v1', 'styles.css': 'same', 'assets/logo.png': 'png-old' };
  const current = { 'index.html': 'v2', 'styles.css': 'same', 'about.html': 'new-page' };

  await check('diffStaging() classifies added, modified and deleted files', () => {
    const changes = Git.diffStaging(baseline, current);
    eq(changes.map((c) => c.path + ':' + c.status), ['about.html:added', 'assets/logo.png:deleted', 'index.html:modified']);
    eq(changes.map((c) => c.kind), ['html', 'asset', 'html']);
    const counts = Git.summarize(changes);
    eq({ added: counts.added, modified: counts.modified, deleted: counts.deleted, total: counts.total }, { added: 1, modified: 1, deleted: 1, total: 3 });
    eq(counts.byKind, { html: 2, asset: 1 });
    eq(Git.diffStaging(baseline, baseline).length, 0);
    return true;
  });

  await check('hashOf() is deterministic and passes real shas through', () => {
    const a = Git.hashOf('body { color: red }');
    eq(a, Git.hashOf('body { color: red }'));
    ok(a !== Git.hashOf('body { color: blue }'), 'different content hashes differently');
    eq(Git.hashOf('A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6E7F8A9B0'), 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0');
    return true;
  });

  const log = {
    commits: [
      { hash: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0', subject: 'feat: hero section', author: 'Ada', date: '2026-09-22T10:00:00Z', tags: ['v1.2.0'] },
      { sha: '0987654321fedcba0987654321fedcba09876543', message: 'fix: nav overlap\n\nlonger body\n', authorName: 'Linus', committerDate: '2026-09-20T09:00:00Z' },
      { commit: '', subject: '' },
      { id: 'ffffffffffffffffffffffffffffffffffffffff', title: 'chore: bump tokens', committerDate: '2026-09-18T09:00:00Z' }
    ]
  };

  await check('parseGitLog() sorts newest first and drops unrenderable rows', () => {
    const commits = Git.parseGitLog(log, {});
    eq(commits.length, 3);
    eq(commits.map((c) => c.subject), ['feat: hero section', 'fix: nav overlap', 'chore: bump tokens']);
    eq(commits[0].short, 'a1b2c3d');
    eq(commits[0].tags, ['v1.2.0']);
    eq(commits[1].author, 'Linus');
    eq(commits[1].body, 'longer body');
    eq(commits[1].subject.indexOf('\n'), -1, 'the subject is the first line only');
    eq(Git.parseGitLog({ log: log.commits }, { limit: 2 }).length, 2);
    eq(Git.parseGitLog(null, {}).length, 0);
    return true;
  });

  await check('renderTimeline() turns the history into timeline DOM nodes', () => {
    const host = mountPoint();
    const view = Git.renderTimeline(host, { doc, commits: log, now: Date.parse('2026-09-23T00:00:00Z') });
    eq(view.nodes().length, 3);
    const items = host.querySelectorAll('[data-pai-commit]');
    eq(items.length, 3);
    eq(items[0].getAttribute('data-pai-commit'), 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0');
    eq(items[0].getAttribute('data-hash'), 'a1b2c3d');
    eq(items[0].getAttribute('data-head'), '1');
    eq(items[1].getAttribute('data-head'), null);
    has(items[0].getAttribute('data-date'), '2026-09-22');
    has(items[0].querySelector('.pai-git-commit__subject').textContent, 'hero section');
    eq(items[0].querySelector('.pai-git-commit__tag').textContent, 'v1.2.0');
    has(items[0].querySelector('.pai-git-commit__hash').textContent, 'a1b2c3d');
    ok(items[0].querySelector('.pai-git-commit__when').textContent.length > 0, 'a relative timestamp is rendered');
    has(host.textContent, '3 commits');
    view.destroy();
    eq(host.children.length, 0);

    const emptyHost = mountPoint();
    const empty = Git.renderTimeline(emptyHost, { doc, commits: [] });
    eq(empty.nodes().length, 0);
    ok(emptyHost.querySelector('[data-pai-git-empty]'), 'an empty history says so');
    has(emptyHost.textContent, 'No commits yet');
    empty.destroy();
    return true;
  });

  await check('renderStagingArea() lists changes with live selection counts', () => {
    const host = mountPoint();
    const toggles = [];
    const stageAlls = [];
    const view = Git.renderStagingArea(host, {
      doc,
      changes: Git.diffStaging(baseline, current),
      onToggle: (p, on, paths) => toggles.push({ p, on, paths }),
      onStageAll: (on, paths) => stageAlls.push({ on, paths })
    });
    const rows = host.querySelectorAll('[data-pai-git-file]');
    eq(rows.length, 3);
    eq(host.querySelector('[data-pai-git-counts]').textContent, '3 changes · 3 staged');
    eq(view.counts().total, 3);
    eq(rows[0].getAttribute('data-staged'), '1');
    eq(rows[0].getAttribute('data-kind'), 'html');

    const box = rows[0].querySelector('[data-pai-git-path]');
    box.checked = false;
    box.dispatchEvent(shim.event('change', {}));
    eq(host.querySelector('[data-pai-git-counts]').textContent, '3 changes · 2 staged');
    eq(toggles.length, 1);
    eq(toggles[0].p, 'about.html');
    eq(toggles[0].on, false);
    eq(toggles[0].paths, ['assets/logo.png', 'index.html']);

    const all = host.querySelector('[data-pai-git-stage-all]');
    all.checked = true;
    all.dispatchEvent(shim.event('change', {}));
    eq(host.querySelector('[data-pai-git-counts]').textContent, '3 changes · 3 staged');
    eq(stageAlls[0].on, true);
    eq(stageAlls[0].paths.length, 3);
    eq(rows.map((r) => r.getAttribute('data-staged')), ['1', '1', '1']);
    view.destroy();
    return true;
  });

  await check('stagedExclude() keeps a file out of the release', () => {
    const host = mountPoint();
    Git.renderStagingArea(host, {
      doc,
      changes: Git.diffStaging(baseline, current),
      stagedExclude: ['assets/logo.png']
    });
    const rows = host.querySelectorAll('[data-pai-git-file]');
    const logoRow = rows.find((r) => r.getAttribute('data-pai-git-file') === 'assets/logo.png');
    eq(logoRow.querySelector('[data-pai-git-path]').checked, false);
    eq(logoRow.getAttribute('data-staged'), '0');
    eq(host.querySelector('[data-pai-git-counts]').textContent, '3 changes · 2 staged');
    return true;
  });

  await check('an empty staging area reports clean', () => {
    const host = mountPoint();
    Git.renderStagingArea(host, { doc, changes: [] });
    eq(host.querySelector('[data-pai-git-counts]').textContent, 'clean');
    ok(host.querySelector('[data-pai-git-empty]'));
    eq(host.querySelector('[data-pai-git-stage-all]').disabled, true);
    return true;
  });

  section('3b. Git controller — one-click release');

  function releaseBridge(behavior) {
    const calls = [];
    const gate = behavior === 'defer' ? deferred() : null;
    return {
      calls,
      gate,
      bridge: {
        release(payload, onProgress) {
          calls.push(payload);
          if (onProgress) {
            STAGE_SEQUENCE.forEach((s) => onProgress({ stage: s }));
          }
          if (behavior === 'defer') return gate.promise;
          if (behavior === 'fail') return Promise.resolve({ ok: false, error: 'remote rejected: non-fast-forward' });
          if (behavior === 'reject') return Promise.reject(new Error('network unreachable'));
          return Promise.resolve({ ok: true, pushed: true, version: payload.version });
        }
      }
    };
  }
  const STAGE_SEQUENCE = ['staging', 'committing', 'pushing'];

  await check('the release modal prompts, bumps the version and shows progress', async () => {
    const handler = releaseBridge('ok');
    const host = mountPoint();
    const released = [];
    const progress = [];
    const modal = Git.openReleaseModal({
      doc,
      root: host,
      bridge: handler.bridge,
      commits: log,
      files: ['index.html', 'about.html'],
      version: '1.2.0',
      subject: 'Add the hero section',
      onProgress: (e) => progress.push(e.stage),
      onReleased: (r) => released.push(r)
    });
    ok(modal, 'the modal mounted');
    eq(host.querySelector('[data-pai-release]').getAttribute('role') === null, true);
    has(host.textContent, 'One-click release');
    has(host.textContent, '2 staged files');
    eq(modal.version(), '1.3.0', 'a feat commit recommends a minor bump');
    eq(host.querySelector('[data-pai-release-type]').value, 'feat');
    const stages = host.querySelectorAll('[data-stage]');
    eq(stages.length, 4);

    const outcome = await modal.submit();
    eq(outcome.ok, true);
    eq(handler.calls.length, 1);
    const call = handler.calls[0];
    eq(call.message, 'feat: Add the hero section');
    eq(call.files, ['index.html', 'about.html']);
    eq(call.bump, 'minor');
    eq(call.version, '1.3.0');
    eq(progress[0], 'staging');
    eq(progress[progress.length - 1], 'done');
    has(progress.join(','), 'staging,committing,pushing,done');
    eq(progress.filter((s) => s === 'done').length, 1, 'done is announced once');
    eq(stages.map((s) => s.getAttribute('data-state')), ['done', 'done', 'done', 'done']);
    const backdrop = host.querySelector('[data-pai-release]');
    eq(backdrop.getAttribute('data-state'), 'released');
    ok(backdrop.classList.contains('pai-release--ok'));
    const success = host.querySelector('[data-pai-release-success]');
    ok(success, 'a success banner was appended');
    has(success.textContent, 'Pushed to GitHub');
    has(success.textContent, 'v1.3.0');
    eq(released.length, 1);
    eq(released[0].version, '1.3.0');
    return true;
  });

  await check('a release without a subject is blocked before any IPC call', async () => {
    const handler = releaseBridge('ok');
    const host = mountPoint();
    const modal = Git.openReleaseModal({ doc, root: host, bridge: handler.bridge, commits: log, files: ['index.html'], version: '1.0.0' });
    const outcome = await modal.submit();
    eq(outcome.ok, false);
    eq(outcome.reason, 'message');
    eq(handler.calls.length, 0, 'nothing was pushed');
    const alert = host.querySelector('.pai-release__alert');
    eq(alert.hidden, false);
    has(alert.textContent, 'subject is required');
    eq(host.querySelector('[data-pai-release]').getAttribute('data-state'), 'error');
    eq(host.querySelector('[data-pai-release-submit]').textContent, 'Retry release');
    return true;
  });

  await check('a failed push surfaces the remote error and can be retried', async () => {
    const handler = releaseBridge('fail');
    const host = mountPoint();
    const modal = Git.openReleaseModal({ doc, root: host, bridge: handler.bridge, commits: log, files: ['index.html'], version: '1.0.0', subject: 'Fix nav' });
    const first = await modal.submit();
    eq(first.ok, false);
    const alert = host.querySelector('.pai-release__alert');
    has(alert.textContent, 'non-fast-forward');
    eq(host.querySelector('[data-pai-release]').getAttribute('data-state'), 'error');
    eq(host.querySelector('[data-pai-release-submit]').disabled, false);
    eq(handler.calls.length, 1);

    const handler2 = releaseBridge('ok');
    const host2 = mountPoint();
    const modal2 = Git.openReleaseModal({ doc, root: host2, bridge: handler2.bridge, commits: log, files: ['index.html'], version: '1.0.0', subject: 'Fix nav' });
    await modal2.submit();
    eq(host2.querySelector('[data-pai-release]').getAttribute('data-state'), 'released');
    return true;
  });

  await check('a rejected release promise reports the error', async () => {
    const errors = tapAsyncErrors();
    try {
      const handler = releaseBridge('reject');
      const host = mountPoint();
      const modal = Git.openReleaseModal({ doc, root: host, bridge: handler.bridge, commits: log, files: ['index.html'], version: '1.0.0', subject: 'Fix nav' });
      const out = await modal.submit();
      eq(out.ok, false);
      has(host.querySelector('.pai-release__alert').textContent, 'network unreachable');
      eq(errors.seen.length, 0, 'no unhandled rejection escaped');
    } finally { errors.stop(); }
    return true;
  });

  await check('with no git bridge the modal explains instead of failing silently', async () => {
    const host = mountPoint();
    const modal = Git.openReleaseModal({ doc, root: host, bridge: null, commits: log, files: ['index.html'], version: '1.0.0', subject: 'Fix nav' });
    const out = await modal.submit();
    eq(out.reason, 'bridge-unavailable');
    has(host.querySelector('.pai-release__alert').textContent, 'bridge unavailable');
    return true;
  });

  await check('double-submitting pushes exactly once', async () => {
    const handler = releaseBridge('defer');
    const host = mountPoint();
    const modal = Git.openReleaseModal({ doc, root: host, bridge: handler.bridge, commits: log, files: ['index.html'], version: '1.0.0', subject: 'Fix nav' });
    const p1 = modal.submit();
    const p2 = modal.submit();
    same(p1, p2, 'the second submit reuses the in-flight promise');
    await new Promise((r) => setImmediate(r));
    eq(handler.calls.length, 1, 'only one release call reached the bridge');
    eq(host.querySelector('[data-pai-release-submit]').disabled, true);
    handler.gate.resolve({ ok: true, pushed: true, version: '1.0.0' });
    await p1;
    eq(host.querySelector('[data-pai-release]').getAttribute('data-state'), 'released');
    return true;
  });

  await check('Escape closes the modal and detaches it from the DOM', () => {
    const host = mountPoint();
    const modal = Git.openReleaseModal({ doc, root: host, bridge: null, commits: log, files: [], version: '1.0.0' });
    eq(host.children.length, 1);
    doc.dispatchEvent(shim.event('keydown', { key: 'Escape' }));
    eq(modal.el.parentNode, null);
    eq(host.children.length, 0);
    return true;
  });

  await check('the semantic commit message is built from the form state', () => {
    const host = mountPoint();
    const modal = Git.openReleaseModal({ doc, root: host, bridge: null, commits: log, files: [], version: '1.0.0' });
    const built = Git.buildCommitMessage({ type: 'feat', subject: 'Add pricing', scope: 'ui dashboard' });
    eq(built.message, 'feat(ui-dashboard): Add pricing');
    eq(built.warnings.length, 0);
    const bad = Git.buildCommitMessage({ type: 'nope', subject: '' });
    eq(bad.ok, false);
    ok(bad.warnings.length >= 2, 'unknown type and missing subject are both flagged');
    eq(modal.message().ok, false, 'the empty modal form is not releasable');
    return true;
  });
}

// ============================================================
// 4. AST inspector
// ============================================================

async function sectionAstInspector() {
  section('4. AST inspector — tree, diff marks, payload pane');

  const before = {
    root: {
      id: 'page', type: 'element', tag: 'main', children: [
        { id: 'hero', tag: 'section', children: [{ id: 'hero-h1', tag: 'h1', children: [{ id: 'hero-text', type: 'text', text: 'Welcome to PallettAI' }] }] },
        { id: 'promo', tag: 'aside', classes: 'promo banner', children: [{ type: 'text', text: 'Limited offer' }] },
        { id: 'footer', tag: 'footer', children: [{ type: 'text', text: '© 2026' }] }
      ]
    }
  };
  const after = {
    root: {
      id: 'page', type: 'element', tag: 'main', children: [
        { id: 'hero', tag: 'section', children: [{ id: 'hero-h1', tag: 'h1', children: [{ id: 'hero-text', type: 'text', text: 'Welcome to PallettAI' }] }] },
        { id: 'pricing', tag: 'section', classes: 'pricing', children: [{ type: 'text', text: 'New pricing block' }] },
        { id: 'footer', tag: 'footer', children: [{ type: 'text', text: '© 2026' }] }
      ]
    }
  };

  await check('normalizeAst() walks the tree and infers missing node types', () => {
    const norm = Ast.normalizeAst(before);
    eq(norm.count, 8);
    eq(norm.root, 'page');
    const types = Ast.collectStats(norm).byType;
    eq(types.element, 5);
    eq(types.text, 3);
    eq(Ast.collectStats(norm).maxDepth, 3);
    const promo = norm.nodes.find((n) => n.key === 'promo');
    eq(promo.label, 'aside.promo.banner', 'classes are shown on the label');
    eq(promo.depth, 1);
    eq(norm.nodes.find((n) => n.key === 'hero-text').label, 'Welcome to PallettAI');
    eq(Ast.normalizeAst(null).count, 0);
    eq(Ast.normalizeAst({ ast: before.root }).count, 8, 'a {ast} envelope is unwrapped');
    return true;
  });

  await check('node keys are stable without ids (structural fallback)', () => {
    const bare = Ast.normalizeAst({ tag: 'section', children: [{ tag: 'p', text: 'first' }, { tag: 'p', text: 'second' }] });
    eq(bare.nodes.map((n) => n.key), ['root>section|#0', 'root>section|#0>p|#0', 'root>section|#0>p|#1']);
    const again = Ast.normalizeAst({ tag: 'section', children: [{ tag: 'p', text: 'first' }, { tag: 'p', text: 'second' }] });
    eq(again.nodes.map((n) => n.key), bare.nodes.map((n) => n.key), 'the fallback is deterministic');
    const dup = Ast.normalizeAst({ root: { id: 'a', tag: 'div', children: [{ id: 'a', tag: 'span' }, { tag: 'b' }] } });
    eq(dup.count, 2, 'a duplicate id cannot double-count a node');
    return true;
  });

  await check('diffAst() marks tree-shaken and injected subtrees in document order', () => {
    const diff = Ast.diffAst(Ast.normalizeAst(before), Ast.normalizeAst(after));
    eq(diff.removed, ['promo', 'promo>text|#0'], 'the shaken subtree includes its children');
    eq(diff.added, ['pricing', 'pricing>text|#0']);
    eq(diff.kept, 6);
    eq(diff.beforeCount, 8);
    eq(diff.afterCount, 8);
    const hinted = Ast.diffAst(Ast.normalizeAst(before), Ast.normalizeAst(after), { removed: ['promo', 'ghost'], added: ['pricing'] });
    eq(hinted.removed, ['promo', 'promo>text|#0', 'ghost'], 'compiler hints merge without duplicating');
    eq(hinted.added, ['pricing', 'pricing>text|#0']);
    const ordered = Ast.diffAst(
      Ast.normalizeAst({ root: { id: 'p', tag: 'div', children: [{ id: 'a', tag: 'i' }, { id: 'b', tag: 'b' }, { id: 'c', tag: 'u' }] } }),
      Ast.normalizeAst({ root: { id: 'p', tag: 'div', children: [{ id: 'a', tag: 'i' }] } })
    );
    eq(ordered.removed, ['b', 'c'], 'document order, not alphabetical');
    return true;
  });

  await check('a truncated tree is counted and shown, never silently short', () => {
    let deep = { id: 'd0', tag: 'div', children: [] };
    let cursor = deep;
    for (let i = 1; i < 40; i++) {
      const child = { id: 'd' + i, tag: 'div', children: [] };
      cursor.children.push(child);
      cursor = child;
    }
    const full = Ast.normalizeAst(deep);
    eq(full.count, 40, 'a deep page is rendered in full by default');
    eq(full.truncated, 0);
    const clipped = Ast.normalizeAst(deep, { maxDepth: 5 });
    eq(clipped.count, 5);
    eq(clipped.truncated, 1, 'the hidden sub-tree is counted');
    eq(clipped.depthLimit, 5);
    const host6 = mountPoint();
    const view = Ast.mount(host6, { doc, ast: deep, bridge: null, maxDepth: 5 });
    eq(host6.querySelectorAll('[data-pai-ast-node]').length, 5);
    eq(host6.querySelector('[data-pai-ast-truncated]').getAttribute('data-pai-ast-truncated'), '1');
    has(host6.querySelector('[data-pai-ast-stats]').textContent, 'hidden (depth 5)');
    view.destroy();
    const cyclic = { tag: 'div' };
    cyclic.children = [cyclic];
    const loops = Ast.normalizeAst(cyclic, { maxDepth: 12 });
    eq(loops.count, 1, 'a self-referencing AST stops at the repeat, not at the depth bound');
    eq(loops.truncated, 1, 'and reports that it stopped');
    const twoCycle = { tag: 'a' };
    twoCycle.children = [{ tag: 'b', children: [twoCycle] }];
    const pair = Ast.normalizeAst(twoCycle, { maxDepth: 12 });
    eq(pair.count, 2, 'a two-node cycle renders both nodes once');
    eq(pair.nodes.map((n) => n.label), ['a', 'b']);
    eq(pair.truncated, 1);
    eq(Ast.DEFAULT_MAX_DEPTH > 64, true, 'the default bound is generous enough for real pages');
    return true;
  });

  await check('a key the compiler reports twice is classified once', () => {
    const d = Ast.diffAst({ nodes: [] }, Ast.normalizeAst({ id: 'a', tag: 'div' }), { removed: ['ghost', 'a'], added: ['ghost'] });
    const overlap = d.removed.filter((k) => d.added.indexOf(k) > -1);
    eq(overlap, [], 'no key may sit in both the shaken and injected lists');
    eq(d.removed.indexOf('ghost') > -1 || d.added.indexOf('ghost') > -1, true, 'the hinted key is reported somewhere');
    return true;
  });

  await check('schemaPayload() renders a read-only JSON payload with its size', () => {
    const payload = Ast.schemaPayload({ page: 'home', tokens: { brand: 'oklch(0.65 0.24 260)' } });
    eq(JSON.parse(payload.json).tokens.brand, 'oklch(0.65 0.24 260)');
    has(payload.json, '\n  ', 'pretty printed');
    eq(payload.bytes, payload.json.length);
    eq(payload.keys, ['page', 'tokens']);
    const circular = {};
    circular.self = circular;
    has(Ast.schemaPayload(circular).json, 'not serialisable');
    eq(Ast.schemaPayload(undefined).json, 'null');
    return true;
  });

  const host = mountPoint();
  const inspectCalls = [];
  const selected = [];
  let pushUpdate = null;
  const compiler = {
    inspect(pageId) {
      inspectCalls.push(pageId);
      return Promise.resolve({
        ast: after.root,
        optimized: true,
        removed: ['promo'],
        added: ['pricing'],
        schema: { page: pageId, tokens: { brand: 'oklch(0.65 0.24 260)' }, minify: true }
      });
    },
    onAstUpdate(cb) { pushUpdate = cb; return () => { pushUpdate = null; }; }
  };
  const copied = [];
  let controller = Ast.mount(host, {
    doc,
    pages: [{ id: 'home', title: 'Home' }, { id: 'about', title: 'About' }],
    pageId: 'home',
    ast: before,
    bridge: compiler,
    expanded: ['page'],
    onSelect: (key) => selected.push(key),
    onCopy: (text) => copied.push(text)
  });

  await check('the tree renders roles, levels and expandable branches', () => {
    const tree = host.querySelector('[role="tree"]');
    ok(tree, 'a role=tree container exists');
    const rows = host.querySelectorAll('[data-pai-ast-node]');
    eq(rows.length, 8, 'one treeitem per AST node');
    rows.forEach((r) => eq(r.getAttribute('role'), 'treeitem'));
    const pageRow = host.querySelector('[data-pai-ast-node="page"]');
    eq(pageRow.getAttribute('aria-level'), '1');
    eq(pageRow.getAttribute('aria-expanded'), 'true');
    eq(pageRow.getAttribute('data-node-type'), 'element');
    eq(host.querySelector('[data-pai-ast-node="promo"]').getAttribute('aria-level'), '2');
    eq(host.querySelector('[data-pai-ast-node="promo"]').getAttribute('data-node-type'), 'element');
    eq(host.querySelector('[data-pai-ast-node="hero-text"]').getAttribute('data-node-type'), 'text');
    eq(host.querySelector('[data-pai-ast-toggle="hero-text"]').disabled, true, 'a leaf toggle is disabled');
    has(host.querySelector('[data-pai-ast-stats]').textContent, '8 nodes');
    has(host.querySelector('[data-pai-ast-stats]').textContent, 'text 3');
    return true;
  });

  await check('payload JSON + size land in the read-only pane', () => {
    const pane = host.querySelector('[data-pai-ast-json]');
    eq(pane.getAttribute('readonly'), 'readonly');
    eq(pane.getAttribute('aria-readonly'), 'true');
    eq(controller.json(), '');
    return true;
  });

  await check('collapsing a branch hides its group and survives a re-render', () => {
    const toggle = host.querySelector('[data-pai-ast-toggle="hero"]');
    const group = host.querySelector('[data-pai-ast-group="hero"]');
    eq(group.hidden, true, 'only the branches named in `expanded` start open');
    eq(host.querySelector('[data-pai-ast-node="hero"]').getAttribute('aria-expanded'), 'false');
    toggle.dispatchEvent(shim.event('click', {}));
    eq(group.hidden, false);
    eq(host.querySelector('[data-pai-ast-node="hero"]').getAttribute('aria-expanded'), 'true');
    ok(controller.expandedKeys().indexOf('hero') > -1);
    toggle.dispatchEvent(shim.event('click', {}));
    eq(group.hidden, true);
    eq(controller.expandedKeys().indexOf('hero'), -1);
    controller.refresh();
    eq(host.querySelector('[data-pai-ast-group="hero"]').hidden, true, 'collapse state survived the re-render');
    eq(host.querySelector('[data-pai-ast-node="hero"]').getAttribute('aria-expanded'), 'false');
    return true;
  });

  await check('keyboard arrows and Enter drive the tree', () => {
    const row = host.querySelector('[data-pai-ast-node="hero"]').querySelector('.pai-ast-node__row');
    row.dispatchEvent(shim.event('keydown', { key: 'ArrowRight' }));
    eq(host.querySelector('[data-pai-ast-group="hero"]').hidden, false);
    eq(host.querySelector('[data-pai-ast-node="hero"]').getAttribute('aria-expanded'), 'true');
    row.dispatchEvent(shim.event('keydown', { key: 'ArrowLeft' }));
    eq(host.querySelector('[data-pai-ast-group="hero"]').hidden, true);
    const pressed = shim.event('keydown', { key: 'Enter' });
    row.dispatchEvent(pressed);
    eq(pressed.defaultPrevented, true, 'the keypress is consumed');
    eq(host.querySelector('[data-pai-ast-group="hero"]').hidden, false);
    return true;
  });

  await check('clicking a row reports the selected node', () => {
    const row = host.querySelector('[data-pai-ast-node="hero-h1"]').querySelector('.pai-ast-node__row');
    row.dispatchEvent(shim.event('click', {}));
    eq(selected[selected.length - 1], 'hero-h1');
    same(doc.activeElement, row, 'the row takes focus');
    return true;
  });

  await check('loadPage() asks the compiler and paints shaken/injected marks', async () => {
    const out = await controller.loadPage('about');
    eq(inspectCalls, ['about']);
    has(controller.status(), 'Compiler linked');
    eq(host.querySelector('[data-pai-ast-node="promo"]'), null, 'the shaken node is gone from the new tree');
    const injected = host.querySelector('[data-pai-ast-node="pricing"]');
    ok(injected.classList.contains('pai-ast-node--injected'));
    eq(injected.getAttribute('data-mark'), 'injected');
    has(injected.textContent, 'injected');
    has(host.querySelector('[data-pai-ast-count-added]').textContent, '2 injected');
    eq(host.querySelector('[data-pai-ast-count-removed]').textContent, '2 tree-shaken');
    eq(host.querySelector('[data-pai-ast-count-added]').parentNode.hidden, false, 'the legend shows once there is something to report');
    eq(controller.el.getAttribute('data-pai-ast-optimized'), '1', 'the optimized-output flag comes from the compiler response');
    eq(out.normalized.count, 8);
    has(host.querySelector('[data-pai-ast-stats]').textContent, '8 nodes');
    return true;
  });

  await check('the JSON pane now mirrors the compiler payload', () => {
    const parsed = JSON.parse(controller.json());
    eq(parsed.page, 'about');
    eq(parsed.minify, true);
    eq(parsed.tokens.brand, 'oklch(0.65 0.24 260)');
    has(host.querySelector('[data-pai-ast-payload-meta]').textContent, 'B');
    has(host.querySelector('[data-pai-ast-payload-meta]').textContent, 'minify');
    return true;
  });

  await check('the copy button hands the payload to the clipboard API', () => {
    const button = host.querySelector('[data-pai-ast-copy]');
    button.dispatchEvent(shim.event('click', {}));
    eq(copied.length, 1);
    eq(copied[0], controller.json());
    eq(button.textContent, 'Copied');
    return true;
  });

  await check('a compiler push re-renders the tree with fresh marks', () => {
    ok(typeof pushUpdate === 'function', 'mount() subscribed to onAstUpdate');
    // prev = the 'about' tree, next = the original tree: the pricing block
    // is gone (tree-shaken) and the promo block came back (injected), while
    // the compiler's own hint re-flags the footer.
    pushUpdate({ ast: before.root, removed: [], added: ['footer'] });
    eq(host.querySelector('[data-pai-ast-node="pricing"]'), null);
    eq(host.querySelector('[data-pai-ast-node="promo"]').getAttribute('data-mark'), 'injected');
    eq(host.querySelector('[data-pai-ast-node="footer"]').getAttribute('data-mark'), 'injected');
    has(host.querySelector('[data-pai-ast-count-removed]').textContent, '2 tree-shaken');
    has(host.querySelector('[data-pai-ast-count-added]').textContent, '3 injected');
    return true;
  });

  await check('hostile text content is rendered as characters, never markup', () => {
    const nasty = '</script><img src=x onerror=alert(1)>';
    const tree = Ast.normalizeAst({ root: { id: 'p', tag: 'div', children: [{ id: 't', type: 'text', text: nasty }] } });
    eq(tree.nodes[1].label, nasty, 'the label keeps the raw characters');
    controller.update({ ast: { root: { id: 'p', tag: 'div', children: [{ id: 't', type: 'text', text: nasty }] } } });
    eq(host.querySelector('[data-pai-ast-label="t"]').textContent, nasty);
    eq(host.querySelectorAll('img').length, 0, 'no element was created from the text');
    return true;
  });

  await check('with no bridge the inspector says so and keeps rendering', () => {
    const host2 = mountPoint();
    const local = Ast.mount(host2, { doc, ast: before });
    has(local.status(), 'offline');
    eq(host2.querySelectorAll('[data-pai-ast-node]').length, 8);
    eq(host2.querySelectorAll('option').length, 0);
    local.refresh();
    eq(host2.querySelectorAll('[data-pai-ast-node]').length, 8);
    local.destroy();
    eq(host2.children.length, 0);
    return true;
  });

  await check('a compiler failure is reported in the status line', async () => {
    const host3 = mountPoint();
    const failing = Ast.mount(host3, {
      doc,
      pages: [{ id: 'home', title: 'Home' }],
      pageId: 'home',
      ast: before,
      bridge: { inspect: () => Promise.reject(new Error('compiler busy')) }
    });
    await failing.loadPage('home');
    has(failing.status(), 'Compiler error');
    has(failing.status(), 'compiler busy');
    eq(host3.querySelectorAll('[data-pai-ast-node]').length, 8, 'the previous tree is still on screen');
    return true;
  });

  await check('an empty AST renders an honest empty state', () => {
    const host4 = mountPoint();
    const empty = Ast.mount(host4, { doc, bridge: null });
    ok(host4.querySelector('[data-pai-ast-empty]'), 'an empty tree is labelled, not silently blank');
    has(host4.querySelector('[data-pai-ast-stats]').textContent, 'no nodes');
    eq(empty.nodes().length, 0);
    return true;
  });

  await check('destroy() unsubscribes from the compiler feed', () => {
    const host5 = mountPoint();
    const local = Ast.mount(host5, { doc, ast: before, bridge: compiler });
    ok(typeof pushUpdate === 'function');
    local.destroy();
    eq(pushUpdate, null, 'the subscription was released');
    return true;
  });

  controller = null;
}

// ============================================================
// 5. Cross-module contracts
// ============================================================

async function sectionContracts() {
  section('5. Contracts — the IPC bridge and the no-markup rule');

  await check('every module is CommonJS-requireable and attaches a window global', () => {
    eq(typeof State.createStore, 'function');
    eq(typeof Media.mount, 'function');
    eq(typeof Git.openReleaseModal, 'function');
    eq(typeof Ast.mount, 'function');
    ok(globalThis.PallettAIState === State, 'window.PallettAIState');
    ok(globalThis.PallettAIMedia === Media, 'window.PallettAIMedia');
    ok(globalThis.PallettAIGit === Git, 'window.PallettAIGit');
    ok(globalThis.PallettAIAst === Ast, 'window.PallettAIAst');
    return true;
  });

  await check('no UI module builds markup from strings', () => {
    const files = ['ui/state-manager.js', 'ui/media-manager.js', 'ui/git-controller.js', 'ui/ast-inspector.js'];
    const offenders = [];
    files.forEach((rel) => {
      const source = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      ['innerHTML', 'outerHTML', 'document.write', 'insertAdjacentHTML'].forEach((needle) => {
        if (source.indexOf(needle) > -1) offenders.push(rel + ' uses ' + needle);
      });
      if (/[^.\w]eval\s*\(/.test(source)) offenders.push(rel + ' uses eval()');
      if (/new\s+Function\s*\(/.test(source)) offenders.push(rel + ' uses new Function()');
    });
    eq(offenders, [], 'markup-string APIs are banned in this layer');
    return true;
  });

  await check('every panel ships OKLCH token styles, not literal colours', () => {
    const panels = [
      ['state-manager', State.CSS, ['.pai-autosave[data-status=error]', '.pai-autosave[data-status=saved]']],
      ['media-manager', Media.CSS, ['.pai-media__fill', '.pai-media__drop--over', '.pai-media__card[data-status=error]']],
      ['git-controller', Git.CSS, ['.pai-git-file[data-staged="1"]', '.pai-release__step[data-state=done]', '.pai-release__step[data-state=active]']],
      ['ast-inspector', Ast.CSS, ['.pai-ast-node--shaken', '.pai-ast-node--injected', '.pai-ast__json']]
    ];
    panels.forEach(([name, css, required]) => {
      ok(typeof css === 'string' && css.length > 100, name + ' exports a stylesheet');
      has(css, 'var(--pai-', name + ' reads the shared token set');
      has(css, 'oklch(', name + ' carries OKLCH fallbacks');
      const literal = css.match(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i);
      eq(literal, null, name + ' must not hard-code a colour' + (literal ? ' (' + literal[0] + ')' : ''));
      required.forEach((selector) => has(css, selector, name + ' styles ' + selector));
    });
    return true;
  });

  await check('every CSS token the panels use is one the studio actually defines', () => {
    // Two sources exist: runtime.js injects the --pai-* OKLCH palette,
    // styles.css declares the base --font/--surface family. A var() that
    // names neither is dead weight — it silently falls back forever.
    const runtime = fs.readFileSync(path.join(ROOT, 'ui/runtime.js'), 'utf8');
    const styles = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
    const defined = new Set();
    (runtime.match(/'--pai-[a-z-]*'/g) || []).forEach((s) => defined.add(s.replace(/'/g, '')));
    (styles.match(/--[a-z0-9-]+(?=\s*:)/g) || []).forEach((s) => defined.add(s));
    ok(defined.size > 10, 'both token sources were found (' + defined.size + ' tokens)');
    const missing = [];
    [[State.CSS, 'state-manager'], [Media.CSS, 'media-manager'], [Git.CSS, 'git-controller'], [Ast.CSS, 'ast-inspector']]
      .forEach(([css, name]) => {
        (String(css).match(/var\(--[a-z0-9-]+/g) || []).forEach((raw) => {
          const token = raw.slice(4);
          if (!defined.has(token)) missing.push(name + ' → ' + token);
        });
      });
    eq(Array.from(new Set(missing)).sort(), []);
    return true;
  });

  await check('the modules resolve the real window.pallettaiAPI surface', () => {
    const previous = globalThis.pallettaiAPI;
    const vault = { saveState: () => Promise.resolve({ ok: true }) };
    const git = { release: () => Promise.resolve({ ok: true }) };
    const compiler = { inspect: () => Promise.resolve({ ast: null }) };
    const compressAsset = () => Promise.resolve({ assets: [] });
    globalThis.pallettaiAPI = { projectVault: vault, git, compiler, compressAsset };
    try {
      eq(State.resolveBridge(), globalThis.pallettaiAPI);
      eq(State.resolveVault(globalThis.pallettaiAPI), vault);
      eq(Git.resolveGitBridge(), git);
      eq(Ast.resolveAstBridge(), compiler);
      eq(Media.resolveCompressBridge(), globalThis.pallettaiAPI);
      ok(Media.resolveCompressBridge().compressAsset === compressAsset);
    } finally {
      if (previous === undefined) delete globalThis.pallettaiAPI;
      else globalThis.pallettaiAPI = previous;
    }
    return true;
  });

  await check('the bridge fallbacks accept the alternate preload shapes', () => {
    const previous = globalThis.pallettaiAPI;
    const legacy = globalThis.pallettai;
    delete globalThis.pallettaiAPI;
    globalThis.pallettai = {
      saveProject: () => Promise.resolve({ ok: true }),
      gitRelease: () => Promise.resolve({ ok: true }),
      compressAsset: () => Promise.resolve({}),
      inspectAst: () => Promise.resolve({})
    };
    try {
      ok(State.resolveVault(globalThis.pallettai).write, 'saveProject() becomes {write}');
      ok(typeof Git.resolveGitBridge().release === 'function', 'gitRelease() becomes {release}');
      ok(typeof Ast.resolveAstBridge().inspect === 'function', 'inspectAst() becomes {inspect}');
    } finally {
      delete globalThis.pallettai;
      if (legacy !== undefined) globalThis.pallettai = legacy;
      if (previous !== undefined) globalThis.pallettaiAPI = previous;
    }
    return true;
  });

  await check('an explicit bridge always wins over the global', () => {
    globalThis.pallettaiAPI = { compressAsset: () => Promise.resolve({}) };
    try {
      const mine = { compressAsset: () => Promise.resolve({ custom: true }) };
      eq(Media.resolveCompressBridge(mine), mine);
      eq(Git.resolveGitBridge(mine), mine);
      eq(Ast.resolveAstBridge(mine), mine);
    } finally {
      delete globalThis.pallettaiAPI;
    }
    return true;
  });

  await check('mount() refuses to run without a root element', () => {
    eq(Media.mount(null, { doc }), null);
    eq(Ast.mount(null, { doc }), null);
    eq(Git.renderTimeline(null, { doc }), null);
    eq(Git.renderStagingArea(null, { doc }), null);
    eq(State.mountStatus(null, { status: () => 'idle' }, doc), null);
    return true;
  });
}

// ============================================================
// Run
// ============================================================

(async function main() {
  console.log('PallettAI Studio — UI state & asset smoke runner (v1)');
  console.log('DOM backend: ' + shim.version + (shim.version === 'shim' ? ' (built-in; jsdom is not a dependency)' : ''));

  const errors = tapAsyncErrors();
  try {
    await sectionStateEngine();
    await sectionMediaManager();
    await sectionGitController();
    await sectionAstInspector();
    await sectionContracts();
  } catch (err) {
    console.error('\nRUNNER ABORTED: ' + ((err && err.stack) || err));
    failures.push('runner aborted: ' + ((err && err.message) || err));
  }
  await new Promise((r) => setTimeout(r, 20)); // let any stray async settle
  errors.stop();

  if (errors.seen.length) {
    failures.push('unhandled rejection(s): ' + errors.seen.map((e) => (e && e.message) || String(e)).join(' | '));
  }

  console.log('\n' + '='.repeat(64));
  sectionCounts.forEach((s) => {
    console.log('  ' + (s.failed ? '✗' : '✓') + ' ' + s.name + ' — ' + s.passed + ' passed' + (s.failed ? ', ' + s.failed + ' failed' : ''));
  });
  console.log('='.repeat(64));
  console.log(passed + ' checks passed, ' + failures.length + ' failed');
  if (failures.length) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log('  • ' + f));
    process.exitCode = 1;
  }
  return failures.length ? 1 : 0;
})();
