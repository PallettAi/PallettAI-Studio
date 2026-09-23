'use strict';
// ============================================================
// PallettAI Studio — incremental re-compiler & in-memory AST cache
// Studio preview edits are single-component: rebuilding the whole
// site for one keystroke is waste. This module keeps a flat,
// indexed AST cache, computes the exact sub-tree an edit touches,
// compiles ONLY those fragments and reports the wall-clock Δt so
// the sub-10ms preview budget is measurable, not aspirational.
// ------------------------------------------------------------
//   1. compileIncrementalDelta(modifiedNodeId, activeASTCache)
//        → {found, changed[], fragments{}, compiled, total,
//           partial, dtMs}
//      Walks the node + its descendants (cycle-safe), compiles one
//      fragment per affected node, and reports how much of the
//      cache it did NOT touch.
//   2. invalidateCacheKeys(dependencyGraph, changedFiles)
//        → {invalid[], remaining[], dtMs, changedFiles[]}
//      Graph: {cacheKey: [dependencies]} where a dependency is a
//      file path OR another cache key present in the graph — keys
//      depending on a changed file go stale, then stale-ness
//      propagates key→key to a fixed point (cycle-safe). Untouched
//      keys survive: no full-project recompilation.
//   3. nowMs() — high-resolution timestamp (performance.now) for
//      Δt benchmarking; every compile/invalidate result carries
//      its own dtMs measured with it.
//
// ---- what this file guarantees ----------------------------------
// 1. PRECISION: a single-node edit compiles 1 fragment regardless
//    of cache size — `compiled` counts exactly what ran, `total`
//    is the cache, `partial` is compiled < total. The claim the
//    runner checks is the RATIO, not a wall-clock number that a
//    loaded CI box could flake on.
// 2. NOTHING HANGS: sub-tree walks and invalidation propagation
//    both use visited-sets, so a malformed cyclic cache or graph
//    terminates instead of overflowing the stack.
// 3. UNKNOWN INPUT FAILS LOUD: an id not in the cache, a null
//    cache, a non-object graph — all typed bad_input errors at
//    the call site, never a silent "compiled nothing" that the
//    editor would render as a blank preview.
// 4. PURE OUTPUT: compiled fragments are deterministic strings of
//    node data, so a cache-hit preview and a cold build render the
//    same markup for the same tree.
// ============================================================

const { performance } = require('perf_hooks');

/** High-resolution clock in fractional milliseconds (Δt source). */
function nowMs() { return performance.now(); }

function fail(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

const escText = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/"/g, '&quot;');

// ============================================================
// Cache construction
// ============================================================

/**
 * createASTCache(tree) — flatten a nested component tree into the
 * indexed cache this module operates on.
 * tree = {id, type?: 'element'|'text'|'component', tag?, classes?,
 *         text?, name? (component), children?: [tree]}
 * → {root, total, nodes: {id: node-with-children-as-ids}}
 */
function createASTCache(tree) {
  if (!tree || typeof tree !== 'object' || typeof tree.id !== 'string' || !tree.id) {
    throw fail('bad_input', 'createASTCache needs a tree with a string id');
  }
  const nodes = {};
  const seen = new Set();
  const flatten = (node, parentId) => {
    if (!node || typeof node !== 'object') return;
    const id = String(node.id == null ? '' : node.id);
    if (!id) throw fail('bad_input', 'every AST node needs a string id');
    if (seen.has(id)) throw fail('bad_input', 'duplicate node id: ' + id);
    seen.add(id);
    const children = Array.isArray(node.children) ? node.children.map((c) => String(c.id)) : [];
    nodes[id] = {
      id,
      type: node.type || 'element',
      tag: node.tag || 'div',
      classes: node.classes || '',
      name: node.name || '',
      text: node.text == null ? '' : String(node.text),
      children,
      parent: parentId || null
    };
    if (Array.isArray(node.children)) node.children.forEach((c) => flatten(c, id));
  };
  flatten(tree, null);
  return { root: tree.id, total: Object.keys(nodes).length, nodes };
}

// ============================================================
// Compilation of one node (pure)
// ============================================================

function compileNode(cache, id, visited) {
  const node = cache.nodes[id];
  if (!node) return '';
  if (visited.has(id)) return ''; // cycle guard
  visited.add(id);
  const inner = node.children.map((c) => compileNode(cache, c, visited)).join('');
  if (node.type === 'text') return escText(node.text);
  if (node.type === 'component') {
    return '<!-- component ' + escAttr(node.name || 'anon') + ' -->' + inner;
  }
  const tag = node.tag || 'div';
  const cls = node.classes ? ' class="' + escAttr(node.classes) + '"' : '';
  return '<' + tag + cls + ' data-node="' + escAttr(node.id) + '">' + inner + '</' + tag + '>';
}

// ============================================================
// 1. compileIncrementalDelta
// ============================================================

function collectSubtree(cache, id) {
  const out = [];
  const visited = new Set();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    if (visited.has(cur)) continue;
    visited.add(cur);
    const node = cache.nodes[cur];
    if (!node) continue;
    out.push(cur);
    // push children in reverse so emission order is document order
    for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
  }
  return out;
}

/**
 * compileIncrementalDelta(modifiedNodeId, activeASTCache)
 * Compiles the node's sub-tree only. Throws bad_input when the id
 * is unknown (a silent empty delta would blank the preview).
 */
function compileIncrementalDelta(modifiedNodeId, activeASTCache) {
  const t0 = nowMs();
  const id = String(modifiedNodeId == null ? '' : modifiedNodeId);
  if (!id) throw fail('bad_input', 'modifiedNodeId is required');
  if (!activeASTCache || typeof activeASTCache !== 'object'
    || !activeASTCache.nodes || typeof activeASTCache.nodes !== 'object') {
    throw fail('bad_input', 'activeASTCache must be a cache from createASTCache()');
  }
  const cache = activeASTCache;
  if (!cache.nodes[id]) {
    throw fail('bad_input', 'unknown node id: ' + id);
  }
  const changed = collectSubtree(cache, id);
  const fragments = {};
  /*
    A FRESH visited set per fragment. Sharing one across this loop made the
    first (top-most) fragment consume every descendant, so every child and
    grandchild compiled to the empty string: `changed` listed five nodes and
    four of them carried nothing. A caller patching a single child's
    fragment — the whole point of a one-node edit — would have blanked that
    node. Each fragment must stand on its own.
  */
  changed.forEach((cid) => { fragments[cid] = compileNode(cache, cid, new Set()); });
  const total = cache.total != null ? cache.total : Object.keys(cache.nodes).length;
  const dtMs = nowMs() - t0;
  return {
    found: true,
    changed,
    fragments,
    compiled: changed.length,
    total,
    partial: changed.length < total,
    dtMs
  };
}

// ============================================================
// 2. invalidateCacheKeys
// ============================================================

/**
 * invalidateCacheKeys(dependencyGraph, changedFiles)
 * Phase 1 — keys with a DIRECT dependency on a changed file.
 * Phase 2 — propagate: a key whose dependency is itself invalid
 *           becomes invalid; repeat to a fixed point.
 * A dependency that names another key in the graph is followed;
 * anything else is treated as a file path.
 */
function invalidateCacheKeys(dependencyGraph, changedFiles) {
  const t0 = nowMs();
  if (!dependencyGraph || typeof dependencyGraph !== 'object' || Array.isArray(dependencyGraph)) {
    throw fail('bad_input', 'dependencyGraph must be an object of key → dependencies[]');
  }
  const changed = Array.isArray(changedFiles) ? changedFiles.map(String)
    : (changedFiles == null ? [] : [String(changedFiles)]);
  const changedSet = new Set(changed);
  const keys = Object.keys(dependencyGraph);

  const depsOf = (k) => {
    const d = dependencyGraph[k];
    if (Array.isArray(d)) return d.map(String);
    if (typeof d === 'string') return [d];
    if (d && typeof d === 'object') return Object.keys(d);
    return [];
  };

  const invalid = new Set();
  // phase 1: direct file hits
  keys.forEach((k) => {
    if (depsOf(k).some((d) => changedSet.has(d))) invalid.add(k);
  });
  // phase 2: propagate key → key to a fixed point (cycle-safe)
  let grew = true;
  while (grew) {
    grew = false;
    keys.forEach((k) => {
      if (invalid.has(k)) return;
      if (depsOf(k).some((d) => Object.prototype.hasOwnProperty.call(dependencyGraph, d)
        && invalid.has(d))) {
        invalid.add(k);
        grew = true;
      }
    });
  }

  const remaining = keys.filter((k) => !invalid.has(k));
  return {
    invalid: keys.filter((k) => invalid.has(k)),
    remaining,
    dtMs: nowMs() - t0,
    changedFiles: changed
  };
}

module.exports = {
  nowMs,
  createASTCache,
  compileIncrementalDelta,
  invalidateCacheKeys
};
