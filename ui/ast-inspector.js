'use strict';
// ============================================================
// PallettAI Studio — live AST node inspector
// The power-user window into the compiler: the active page's
// Abstract Syntax Tree as a collapsible tree, nodes the optimizer
// tree-shook flagged red, nodes the compiler injected flagged
// green, and a read-only pane showing the exact schema payload
// handed to the backend.
// ------------------------------------------------------------
//   1. normalizeAst(input) → {root, nodes, count}
//        Accepts the compiler's page AST ({root}), a bare node,
//        an array of nodes, or {ast}. Every node gets a stable
//        key (see nodeKey) so renders and diffs line up.
//   2. diffAst(prev, next) → {removed: [keys], added: [keys],
//      kept, unchanged} — the red/green sets. Keys are matched
//      structurally when the compiler does not emit ids.
//   3. collectStats(tree) → node/type/depth/character counts for
//      the header, and schemaPayload(schema) → the pretty JSON +
//      byte size for the read-only pane.
//   4. DOM: mount(rootEl, {pages, ast, bridge, doc, onSelect})
//        the tree (role="tree"/"treeitem", aria-expanded,
//        Enter/Space + ArrowRight/ArrowLeft keyboard toggles),
//        the legend with diff counts, and the JSON pane.
//
// ---- BRIDGE -----------------------------------------------------
// window.pallettaiAPI.compiler (fallback window.pallettai.compiler)
//   inspect(pageId) → {ast, optimized?, removed?[], added?[]}
//   onAstUpdate(cb)  → unsubscribe (optional)
// The DeepSeek incremental compiler owns that channel; this module
// never compiles anything itself. With no bridge the inspector
// renders the AST it was handed and says so in the status line —
// an empty tree is never presented as "nothing to see".
//
// ---- what this file guarantees ----------------------------------
// 1. NO INNERHTML, EVER. Labels, tag names and payload JSON are
//    written with textContent, so a text node containing
//    `</script><img onerror>` is rendered as characters, not
//    markup — the inspector inspects hostile content safely.
// 2. THE DIFF CANNOT DOUBLE-COUNT. A key is classified once, and
//    a key present twice in one tree is collapsed by Map, so the
//    legend's numbers always add up to the node count.
// 3. COLLAPSE STATE SURVIVES RE-RENDER. Expanded keys are kept in
//    a Set and re-applied, so a live compiler update does not
//    yank the branch the operator is reading.
// 4. THE PANE IS READ-ONLY BY CONSTRUCTION: it renders text and
//    exposes no editor path — the payload shown is the payload
//    sent.
// ============================================================

(function (root) {
  const TYPE_GLYPH = { element: '◇', text: '“”', component: '⬡', comment: '//', root: '◆' };
  // Deep enough for any real page; the bound exists to stop an id-less
  // cyclic AST from recursing forever, and any nodes it hides are counted.
  const DEFAULT_MAX_DEPTH = 256;

  function isNode(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
  }

  function childList(node) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node.children)) return node.children;
    if (Array.isArray(node.nodes)) return node.nodes;
    if (Array.isArray(node.content)) return node.content;
    return [];
  }

  /** typeOf(node) — the compiler may omit `type`; infer it from the payload. */
  function typeOf(node) {
    if (!node || typeof node !== 'object') return 'node';
    if (node.type) return String(node.type);
    if (node.kind) return String(node.kind);
    if (node.text != null) return 'text';
    if (node.tag || node.name || node.selector) return 'element';
    if (node.component) return 'component';
    return 'node';
  }

  function labelOf(node) {
    if (!node || typeof node !== 'object') return '(invalid node)';
    if (node.tag || node.name || node.selector) {
      const base = String(node.tag || node.name || node.selector);
      const cls = node.classes || node.className;
      return cls ? base + '.' + String(cls).trim().replace(/\s+/g, '.') : base;
    }
    if (node.type === 'text' || node.text != null) {
      const text = String(node.text == null ? '' : node.text).replace(/\s+/g, ' ').trim();
      return text.length > 48 ? text.slice(0, 45) + '…' : (text || '(empty text)');
    }
    return String(node.type || node.kind || 'node');
  }

  /**
   * nodeKey(node, parentKey, index) — the diff identity.
   * Order of preference: an explicit id, then an explicit key, then
   * a structural signature (parent + tag/type + class list). The
   * index is only used when two siblings share a signature, so
   * inserting a paragraph does not renumber everything after it.
   */
  function nodeKey(node, parentKey, index) {
    if (node && typeof node.id === 'string' && node.id) return node.id;
    if (node && node.key != null) return String(node.key);
    const parent = parentKey || 'root';
    const owner = node && (node.tag || node.name || node.selector);
    // Signature order: explicit tag/name, else the inferred type. Two
    // sibling text nodes share a signature on purpose — the index
    // disambiguates them without making them indistinguishable.
    const sig = String(owner || typeOf(node))
      + '|' + String((node && (node.classes || node.className)) || '');
    return parent + '>' + sig + '#' + index;
  }

  /**
   * normalizeAst(input, options) → {root, nodes, count}
   * nodes is a flat, document-ordered array of:
   *   {key, parentKey, depth, index, node, type, label, children:[keys]}
   */
  function normalizeAst(input, options) {
    const o = options || {};
    const depthLimit = Number.isFinite(o.maxDepth) ? Math.max(1, Math.floor(o.maxDepth)) : DEFAULT_MAX_DEPTH;
    let tree = input;
    if (isNode(tree) && isNode(tree.ast)) tree = tree.ast;
    if (isNode(tree) && isNode(tree.root) && !Array.isArray(tree.root)) tree = tree.root;
    if (!isNode(tree) && !Array.isArray(tree)) {
      return { root: null, nodes: [], count: 0, truncated: 0, depthLimit };
    }

    const nodes = [];
    const seen = new Set();
    const ancestors = new Set();
    let truncated = 0;
    const walk = (node, parentKey, depth, index) => {
      if (!isNode(node)) return null;
      // A node that contains itself is a malformed AST. With ids the key
      // check catches it; without ids it used to walk to the depth bound
      // and render hundreds of phantom levels. Stop it at the repeat.
      if (ancestors.has(node)) { truncated += 1; return null; }
      const key = nodeKey(node, parentKey, index);
      // A duplicate key means a malformed AST (two nodes claiming one
      // id). Drop the repeat instead of linking it into the first
      // node's children, and keep the count honest.
      if (seen.has(key)) return null;
      seen.add(key);
      const children = childList(node);
      const entry = {
        key,
        parentKey: parentKey || null,
        depth,
        index,
        node,
        type: typeOf(node),
        label: labelOf(node),
        children: []
      };
      nodes.push(entry);
      ancestors.add(node);
      // A legitimately deep page can hit this bound, so the shortfall is
      // COUNTED and surfaced instead of quietly returning a smaller tree
      // than the page actually has.
      if (children.length && depth + 1 >= depthLimit) truncated += children.length;
      if (children.length && depth + 1 < depthLimit) {
        const counts = {};
        children.forEach((child) => {
          const owner = child && (child.tag || child.name || child.selector);
          const sig = String(owner || typeOf(child));
          counts[sig] = (counts[sig] || 0) + 1;
          const childKey = walk(child, key, depth + 1, counts[sig] > 1 ? counts[sig] - 1 : 0);
          if (childKey) entry.children.push(childKey);
        });
      }
      ancestors.delete(node);
      return key;
    };

    const list = Array.isArray(tree) ? tree : [tree];
    list.forEach((n, i) => walk(n, null, 0, i));
    return {
      root: nodes.length ? nodes[0].key : null,
      nodes,
      count: nodes.length,
      truncated,
      depthLimit
    };
  }

  const keySet = (keys) => {
    const out = new Set();
    (Array.isArray(keys) ? keys : []).forEach((k) => { if (k != null) out.add(String(k)); });
    return out;
  };

  /**
   * diffAst(prev, next, options) → {removed, added, kept, unchanged}
   * `prev`/`next` may be normalizeAst() results or raw ASTs.
   * removed = keys the optimizer tree-shook (rendered red)
   * added   = keys the compiler injected   (rendered green)
   */
  function diffAst(prev, next, options) {
    const before = prev && Array.isArray(prev.nodes) ? prev : normalizeAst(prev, options);
    const after = next && Array.isArray(next.nodes) ? next : normalizeAst(next, options);
    const beforeKeys = new Set(before.nodes.map((n) => n.key));
    const afterKeys = new Set(after.nodes.map((n) => n.key));
    // Document order, not alphabetical: the tree pane reads top-down
    // and a diff list that jumps around is unreadable. A key is
    // classified exactly once, so the counts stay exact.
    const removed = [];
    const added = [];
    const kept = [];
    before.nodes.forEach((n) => { if (!afterKeys.has(n.key)) removed.push(n.key); else kept.push(n.key); });
    after.nodes.forEach((n) => { if (!beforeKeys.has(n.key)) added.push(n.key); });
    const seenRemoved = new Set(removed);
    const seenAdded = new Set(added);
    // explicit hints from the compiler win over the structural diff
    keySet(options && options.removed).forEach((k) => {
      if (!seenRemoved.has(k) && !seenAdded.has(k)) { seenRemoved.add(k); removed.push(k); }
    });
    keySet(options && options.added).forEach((k) => {
      if (!seenAdded.has(k) && !seenRemoved.has(k)) { seenAdded.add(k); added.push(k); }
    });
    return {
      removed,
      added,
      kept: kept.length,
      unchanged: kept.length,
      beforeCount: beforeKeys.size,
      afterCount: afterKeys.size
    };
  }

  function collectStats(tree) {
    const normalized = tree && Array.isArray(tree.nodes) ? tree : normalizeAst(tree);
    const byType = {};
    let maxDepth = 0;
    let textChars = 0;
    normalized.nodes.forEach((n) => {
      byType[n.type] = (byType[n.type] || 0) + 1;
      if (n.depth > maxDepth) maxDepth = n.depth;
      if (n.type === 'text') textChars += String((n.node && n.node.text) || '').length;
    });
    return { nodes: normalized.count, byType, maxDepth, textChars };
  }

  function schemaPayload(schema) {
    let json = '';
    try {
      const out = JSON.stringify(schema == null ? null : schema, null, 2);
      // JSON.stringify yields UNDEFINED (not a throw) for a function or a
      // symbol, and the old code then read .length off it — one unusable
      // value in the payload took the whole pane down.
      json = typeof out === 'string' ? out : String(out);
    } catch (e) {
      json = '/* schema is not serialisable: ' + String((e && e.message) || e) + ' */';
    }
    return {
      json,
      bytes: json.length,
      keys: isNode(schema) ? Object.keys(schema).sort() : [],
      payload: schema == null ? null : schema
    };
  }

  function resolveAstBridge(explicit) {
    if (explicit) return explicit;
    if (typeof window === 'undefined' || !window) return null;
    const api = window.pallettaiAPI || window.pallettai;
    if (!api) return null;
    if (api.compiler && typeof api.compiler === 'object') return api.compiler;
    if (typeof api.inspectAst === 'function') return { inspect: api.inspectAst };
    return null;
  }

  function el(doc, tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  /**
   * buildTree(doc, normalized, {expanded, diff, onToggle, onSelect})
   * → {el, rows: Map(key → rowNode)}
   * Pure DOM construction: no string interpolation anywhere.
   */
  function buildTree(doc, normalized, options) {
    const o = options || {};
    const expanded = o.expanded instanceof Set ? o.expanded : new Set();
    const removed = keySet(o.diff && o.diff.removed);
    const added = keySet(o.diff && o.diff.added);
    const rows = new Map();
    const byKey = new Map(normalized.nodes.map((n) => [n.key, n]));

    const list = el(doc, 'ul', 'pai-ast__list');
    list.setAttribute('role', 'tree');
    list.setAttribute('aria-label', 'Page AST');

    const makeRow = (entry) => {
      const li = el(doc, 'li', 'pai-ast-node');
      li.setAttribute('role', 'treeitem');
      li.setAttribute('data-pai-ast-node', entry.key);
      li.setAttribute('data-node-type', entry.type);
      li.setAttribute('data-depth', String(entry.depth));
      li.setAttribute('aria-level', String(entry.depth + 1));
      if (entry.parentKey) li.setAttribute('data-parent', entry.parentKey);
      const hasChildren = entry.children.length > 0;
      li.setAttribute('aria-expanded', hasChildren ? (expanded.has(entry.key) ? 'true' : 'false') : 'false');
      if (removed.has(entry.key)) li.classList.add('pai-ast-node--shaken');
      if (added.has(entry.key)) li.classList.add('pai-ast-node--injected');
      if (removed.has(entry.key)) li.setAttribute('data-mark', 'shaken');
      else if (added.has(entry.key)) li.setAttribute('data-mark', 'injected');

      const row = el(doc, 'div', 'pai-ast-node__row');
      row.tabIndex = 0;
      const toggle = el(doc, 'button', 'pai-ast-node__toggle', hasChildren ? (expanded.has(entry.key) ? '▾' : '▸') : '·');
      toggle.type = 'button';
      toggle.setAttribute('data-pai-ast-toggle', entry.key);
      toggle.disabled = !hasChildren;
      toggle.setAttribute('aria-label', (hasChildren ? 'Toggle ' : 'Leaf ') + entry.label);
      const glyph = el(doc, 'span', 'pai-ast-node__glyph', TYPE_GLYPH[entry.type] || '◇');
      glyph.setAttribute('aria-hidden', 'true');
      const label = el(doc, 'code', 'pai-ast-node__label', entry.label);
      label.setAttribute('data-pai-ast-label', entry.key);
      const type = el(doc, 'span', 'pai-ast-node__type', entry.type);
      row.appendChild(toggle);
      row.appendChild(glyph);
      row.appendChild(label);
      row.appendChild(type);
      if (removed.has(entry.key)) {
        row.appendChild(el(doc, 'span', 'pai-ast-node__mark pai-ast-node__mark--shaken', 'tree-shaken'));
      } else if (added.has(entry.key)) {
        row.appendChild(el(doc, 'span', 'pai-ast-node__mark pai-ast-node__mark--injected', 'injected'));
      }
      li.appendChild(row);

      const setOpen = (open) => {
        if (!hasChildren) return;
        if (open) expanded.add(entry.key); else expanded.delete(entry.key);
        li.setAttribute('aria-expanded', open ? 'true' : 'false');
        toggle.textContent = open ? '▾' : '▸';
        const group = li.querySelector('[data-pai-ast-group]');
        if (group) group.hidden = !open;
        if (typeof o.onToggle === 'function') o.onToggle(entry.key, open);
      };
      const activate = () => { setOpen(!expanded.has(entry.key)); };
      toggle.addEventListener('click', (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        activate();
      });
      row.addEventListener('click', () => {
        if (typeof o.onSelect === 'function') o.onSelect(entry.key, entry.node);
        if (doc.activeElement !== row && row.focus) row.focus();
      });
      row.addEventListener('keydown', (e) => {
        const key = e && e.key;
        if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
          if (e.preventDefault) e.preventDefault();
          activate();
        } else if (key === 'ArrowRight') {
          if (e.preventDefault) e.preventDefault();
          setOpen(true);
        } else if (key === 'ArrowLeft') {
          if (e.preventDefault) e.preventDefault();
          setOpen(false);
        }
      });

      if (hasChildren) {
        const group = doc.createElement('ul');
        group.className = 'pai-ast__group';
        group.setAttribute('data-pai-ast-group', entry.key);
        group.setAttribute('role', 'group');
        group.hidden = !expanded.has(entry.key);
        li.appendChild(group);
      }
      rows.set(entry.key, li);
      return li;
    };

    normalized.nodes.forEach((entry) => {
      if (entry.depth === 0) { list.appendChild(makeRow(entry)); return; }
      const parentRow = rows.get(entry.parentKey);
      const group = parentRow ? parentRow.querySelector('[data-pai-ast-group]') : null;
      if (group) group.appendChild(makeRow(entry));
      else list.appendChild(makeRow(entry)); // orphan safety: still visible
    });

    return { el: list, rows, byKey, expanded };
  }

  /**
   * mount(rootEl, options) → controller
   * options: {doc, pages, pageId, ast, prevAst, optimized, removed,
   *           added, schema, bridge, expanded, onSelect, onToggle}
   */
  function mount(rootEl, options) {
    const o = options || {};
    const doc = o.doc || (typeof document !== 'undefined' ? document : null);
    if (!rootEl || !doc) return null;
    const bridge = resolveAstBridge(o.bridge);
    const expanded = o.expanded instanceof Set ? o.expanded : new Set(o.expanded || []);
    let current = {
      ast: o.ast || null,
      prev: o.prevAst || null,
      optimized: o.optimized || null,
      removed: o.removed || null,
      added: o.added || null,
      schema: o.schema || null,
      pageId: o.pageId || (Array.isArray(o.pages) && o.pages.length ? o.pages[0].id : null)
    };

    const wrap = el(doc, 'section', 'pai-ast');
    wrap.setAttribute('data-pai-ast', 'inspector');
    const head = el(doc, 'header', 'pai-ast__head');
    head.appendChild(el(doc, 'h3', 'pai-ast__title', 'AST inspector'));

    const pageSelect = doc.createElement('select');
    pageSelect.setAttribute('data-pai-ast-pages', '1');
    pageSelect.setAttribute('aria-label', 'Active page');
    (Array.isArray(o.pages) ? o.pages : []).forEach((p) => {
      const opt = doc.createElement('option');
      opt.value = String(p && p.id != null ? p.id : p);
      opt.textContent = String((p && (p.title || p.id)) || p);
      if (String(opt.value) === String(current.pageId)) opt.selected = true;
      pageSelect.appendChild(opt);
    });
    head.appendChild(pageSelect);

    const status = el(doc, 'span', 'pai-ast__status', bridge ? 'Compiler linked' : 'Compiler offline — showing local AST');
    status.setAttribute('data-pai-ast-status', '1');
    head.appendChild(status);
    wrap.appendChild(head);

    const legend = el(doc, 'div', 'pai-ast__legend');
    const shakenCount = el(doc, 'span', 'pai-ast__legend-item pai-ast__legend-item--shaken');
    shakenCount.setAttribute('data-pai-ast-count-removed', '1');
    const injectedCount = el(doc, 'span', 'pai-ast__legend-item pai-ast__legend-item--injected');
    injectedCount.setAttribute('data-pai-ast-count-added', '1');
    legend.appendChild(shakenCount);
    legend.appendChild(injectedCount);
    wrap.appendChild(legend);

    const statsLine = el(doc, 'p', 'pai-ast__stats');
    statsLine.setAttribute('data-pai-ast-stats', '1');
    wrap.appendChild(statsLine);

    const treeHost = el(doc, 'div', 'pai-ast__tree');
    wrap.appendChild(treeHost);

    const pane = el(doc, 'section', 'pai-ast__pane');
    const paneHead = el(doc, 'header', 'pai-ast__pane-head');
    paneHead.appendChild(el(doc, 'h4', 'pai-ast__pane-title', 'Compiler payload'));
    const paneMeta = el(doc, 'span', 'pai-ast__pane-meta');
    paneMeta.setAttribute('data-pai-ast-payload-meta', '1');
    const copyBtn = el(doc, 'button', 'pai-ast__copy', 'Copy JSON');
    copyBtn.type = 'button';
    copyBtn.setAttribute('data-pai-ast-copy', '1');
    paneHead.appendChild(paneMeta);
    paneHead.appendChild(copyBtn);
    pane.appendChild(paneHead);
    const pre = el(doc, 'pre', 'pai-ast__json');
    pre.setAttribute('data-pai-ast-json', '1');
    pre.setAttribute('readonly', 'readonly');
    pre.setAttribute('aria-readonly', 'true');
    pane.appendChild(pre);
    wrap.appendChild(pane);

    let treeHandle = null;

    function paintDiff(diff) {
      const removedCount = diff ? diff.removed.length : 0;
      const addedTotal = diff ? diff.added.length : 0;
      shakenCount.textContent = removedCount + ' tree-shaken';
      injectedCount.textContent = addedTotal + ' injected';
      legend.hidden = !diff || (!removedCount && !addedTotal);
    }

    function paintPane(schema) {
      const payload = schemaPayload(schema);
      pre.textContent = payload.json;
      paneMeta.textContent = payload.bytes + ' B' + (payload.keys.length ? ' · ' + payload.keys.join(', ') : '');
      return payload;
    }

    function render() {
      const limits = Number.isFinite(o.maxDepth) ? { maxDepth: o.maxDepth } : undefined;
      const normalized = normalizeAst(current.ast, limits);
      const prevNormalized = current.prev ? normalizeAst(current.prev, limits) : null;
      const diff = (prevNormalized && normalized.count)
        ? diffAst(prevNormalized, normalized, { removed: current.removed, added: current.added })
        : (current.removed || current.added
          ? diffAst({ nodes: [] }, normalized, { removed: current.removed, added: current.added })
          : null);
      treeHost.textContent = '';
      treeHandle = buildTree(doc, normalized, {
        expanded,
        diff,
        onToggle: o.onToggle,
        onSelect: o.onSelect
      });
      treeHost.appendChild(treeHandle.el);
      if (!normalized.count) {
        const empty = el(doc, 'p', 'pai-ast__empty', 'No AST for this page yet.');
        empty.setAttribute('data-pai-ast-empty', '1');
        treeHost.appendChild(empty);
      }
      const stats = collectStats(normalized);
      const truncation = normalized.truncated
        ? ' · +' + normalized.truncated + ' deeper node'
          + (normalized.truncated === 1 ? '' : 's') + ' hidden (depth ' + normalized.depthLimit + ')'
        : '';
      statsLine.textContent = stats.nodes
        ? stats.nodes + ' nodes · depth ' + stats.maxDepth + ' · '
          + Object.keys(stats.byType).sort().map((t) => t + ' ' + stats.byType[t]).join(' · ') + truncation
        : 'no nodes';
      if (normalized.truncated) wrap.setAttribute('data-pai-ast-truncated', String(normalized.truncated));
      else wrap.removeAttribute('data-pai-ast-truncated');
      paintDiff(diff);
      if (current.schema != null) paintPane(current.schema);
      return { normalized, diff, stats };
    }

    function loadPage(pageId) {
      current.pageId = pageId == null ? current.pageId : pageId;
      if (!bridge || typeof bridge.inspect !== 'function' || !current.pageId) {
        status.textContent = bridge ? 'Compiler linked — no page selected' : 'Compiler offline — showing local AST';
        return Promise.resolve(render());
      }
      status.textContent = 'Compiling ' + current.pageId + '…';
      return Promise.resolve()
        .then(() => bridge.inspect(current.pageId))
        .then((result) => {
          const r = result || {};
          // Remember the pass we were showing BEFORE overwriting it:
          // the red/green marks should describe what this compile
          // changed, so the structural diff stays meaningful even when
          // the compiler reports no removed/added hints of its own.
          if (r.ast || r.tree) current.prev = current.ast;
          current.ast = r.ast || r.tree || current.ast;
          current.removed = r.removed || r.shaken || null;
          current.added = r.added || r.injected || null;
          current.schema = r.schema != null ? r.schema : (r.payload != null ? r.payload : current.schema);
          if (typeof r.optimized === 'boolean') current.optimized = r.optimized;
          status.textContent = 'Compiler linked · ' + (current.optimized ? 'optimized output' : 'raw output');
          wrap.setAttribute('data-pai-ast-optimized', current.optimized ? '1' : '0');
          return render();
        })
        .catch((err) => {
          status.textContent = 'Compiler error: ' + String((err && err.message) || err);
          return render();
        });
    }

    copyBtn.addEventListener('click', () => {
      const text = pre.textContent || '';
      const nav = (typeof navigator !== 'undefined' && navigator) || null;
      if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
        Promise.resolve(nav.clipboard.writeText(text)).catch(() => {});
      }
      copyBtn.textContent = 'Copied';
      if (typeof o.onCopy === 'function') o.onCopy(text);
    });
    pageSelect.addEventListener('change', () => loadPage(pageSelect.value));

    render();
    rootEl.appendChild(wrap);

    let unsubscribe = null;
    if (bridge && typeof bridge.onAstUpdate === 'function') {
      try {
        unsubscribe = bridge.onAstUpdate((payload) => {
          if (!payload || typeof payload !== 'object') return;
          current.prev = current.ast;
          current.ast = payload.ast || current.ast;
          if (payload.removed) current.removed = payload.removed;
          if (payload.added) current.added = payload.added;
          if (payload.schema != null) current.schema = payload.schema;
          render();
        });
      } catch (e) { unsubscribe = null; }
    }

    return {
      el: wrap,
      refresh: () => render(),
      loadPage,
      update: (next) => {
        const patch = next || {};
        if ('ast' in patch) { current.prev = current.ast; current.ast = patch.ast; }
        if ('prevAst' in patch) current.prev = patch.prevAst;
        if ('removed' in patch) current.removed = patch.removed;
        if ('added' in patch) current.added = patch.added;
        if ('schema' in patch) current.schema = patch.schema;
        return render();
      },
      expandedKeys: () => Array.from(expanded),
      json: () => pre.textContent,
      status: () => status.textContent,
      nodes: () => (treeHandle ? Array.from(treeHandle.rows.keys()) : []),
      marks: () => ({
        shaken: Array.from((treeHandle ? treeHandle.rows : new Map()).entries())
          .filter(([, n]) => n.classList.contains('pai-ast-node--shaken')).map(([k]) => k),
        injected: Array.from((treeHandle ? treeHandle.rows : new Map()).entries())
          .filter(([, n]) => n.classList.contains('pai-ast-node--injected')).map(([k]) => k)
      }),
      destroy: () => {
        if (typeof unsubscribe === 'function') unsubscribe();
        if (wrap.remove) wrap.remove();
      }
    };
  }

  // Inspector styles. The two state colours that carry meaning — red for
  // a tree-shaken node, green for an injected one — come from the OKLCH
  // token set (ui/runtime.js injects --pai-*), never a literal hex, so
  // the marks stay in step with the studio theme.
  const CSS = [
    '.pai-ast{display:flex;flex-direction:column;gap:10px;color:var(--pai-text,oklch(.95 .01 260))}',
    '.pai-ast__head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
    '.pai-ast__title{margin:0;font:600 14px/1.3 var(--font,system-ui)}',
    '.pai-ast__status{font:500 11px/1 var(--font,system-ui);color:var(--pai-text-muted,oklch(.72 .02 260))}',
    '.pai-ast__legend{display:flex;gap:10px;font:500 11px/1 var(--font,system-ui)}',
    '.pai-ast__legend-item--shaken{color:var(--pai-error,oklch(.65 .2 25))}',
    '.pai-ast__legend-item--injected{color:var(--pai-ok,oklch(.72 .17 150))}',
    '.pai-ast__stats{margin:0;font:400 11px/1.4 var(--font,system-ui);',
    'color:var(--pai-text-muted,oklch(.72 .02 260))}',
    '.pai-ast__tree{max-height:46vh;overflow:auto;padding:6px;',
    'background:var(--pai-surface,oklch(.21 .016 260));border:1px solid var(--pai-border,oklch(.42 .02 260));',
    'border-radius:var(--pai-radius,10px)}',
    '.pai-ast__list,.pai-ast__group{margin:0;padding:0;list-style:none}',
    '.pai-ast__group{margin-left:14px;border-left:1px solid var(--pai-border,oklch(.42 .02 260))}',
    '.pai-ast__empty{color:var(--pai-text-muted,oklch(.72 .02 260))}',
    '.pai-ast-node__row{display:flex;align-items:center;gap:6px;padding:3px 6px;cursor:default;',
    'border-radius:calc(var(--pai-radius,10px) * .4)}',
    '.pai-ast-node__row:focus-visible{outline:2px solid var(--pai-accent,oklch(.7 .19 265));outline-offset:-2px}',
    '.pai-ast-node__toggle{width:16px;padding:0;border:0;cursor:pointer;color:inherit;background:none}',
    '.pai-ast-node__glyph{opacity:.6}',
    '.pai-ast-node__label{font:500 12px/1.3 var(--font-mono,ui-monospace);overflow-wrap:anywhere}',
    '.pai-ast-node__type{margin-left:auto;font:500 10px/1 var(--font,system-ui);',
    'color:var(--pai-text-muted,oklch(.72 .02 260))}',
    '.pai-ast-node__mark{font:600 10px/1 var(--font,system-ui)}',
    '.pai-ast-node--shaken .pai-ast-node__label{text-decoration:line-through;',
    'color:var(--pai-error,oklch(.65 .2 25))}',
    '.pai-ast-node--shaken .pai-ast-node__mark{color:var(--pai-error,oklch(.65 .2 25))}',
    '.pai-ast-node--injected .pai-ast-node__label{color:var(--pai-ok,oklch(.72 .17 150))}',
    '.pai-ast-node--injected .pai-ast-node__mark{color:var(--pai-ok,oklch(.72 .17 150))}',
    '.pai-ast__pane{display:flex;flex-direction:column;gap:6px}',
    '.pai-ast__pane-head{display:flex;align-items:baseline;gap:8px}',
    '.pai-ast__pane-title{margin:0;font:600 12px/1.3 var(--font,system-ui)}',
    '.pai-ast__pane-meta{font:500 10px/1 var(--font,system-ui);',
    'color:var(--pai-text-muted,oklch(.72 .02 260))}',
    '.pai-ast__copy{margin-left:auto;padding:4px 8px;cursor:pointer;font:500 11px/1 var(--font,system-ui);',
    'color:inherit;background:var(--pai-surface-alt,oklch(.26 .02 260));',
    'border:1px solid var(--pai-border,oklch(.42 .02 260));border-radius:calc(var(--pai-radius,10px) * .5)}',
    '.pai-ast__json{max-height:32vh;overflow:auto;margin:0;padding:10px;',
    'font:400 11px/1.5 var(--font-mono,ui-monospace);',
    'background:var(--pai-surface,oklch(.21 .016 260));border:1px solid var(--pai-border,oklch(.42 .02 260));',
    'border-radius:var(--pai-radius,10px)}'
  ].join('');

  const api = {
    CSS,
    TYPE_GLYPH,
    typeOf,
    labelOf,
    nodeKey,
    normalizeAst,
    diffAst,
    collectStats,
    schemaPayload,
    resolveAstBridge,
    buildTree,
    mount,
    DEFAULT_MAX_DEPTH
  };

  if (root) root.PallettAIAst = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null));
