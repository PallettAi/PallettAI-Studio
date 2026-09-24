'use strict';
// ============================================================
// PallettAI Studio — WidgetInjector
// ------------------------------------------------------------
// Puts generated widgets into a static export.
//
//   injectWidgetsIntoAST(htmlString, widgetRegistry, opts)
//     -> { ok, html, injected, skipped, warnings, runtimeEmitted }
//
// 1. Finds every `pallet-widget` placeholder in the document, in
//    source order, by its `id` attribute.
// 2. Emits the matching definitions immediately before `</body>`:
//    one small config block per widget, then the shared engine.
// 3. Emits the CLASS DEFINITION EXACTLY ONCE for the page. Ten
//    widgets — or the same widget ten times — share one custom
//    element; the per-widget blocks only register config, so
//    `customElements.define` is never reached twice.
//
// ---- what it will not do -----------------------------------
// * It never touches the placeholder. The tag stays in the markup
//   where it was authored; the Shadow DOM is built around it at
//   runtime. That keeps an export readable and diffable.
// * It never injects a widget the page does not reference. A
//   registry can hold the whole project's tools; only the ones with
//   a placeholder travel into this page.
// * It is idempotent. Running it twice over its own output adds
//   nothing, so an export pipeline stage can be re-run safely.
//
// Both spellings of the tag are recognised (`pallet-widget` and the
// product's `pallett-widget`) and the engine registers both, so no
// placeholder is ever silently inert over one letter.
//
// Pure string work: no DOM, no regex on the file system, no state.
//
// CommonJS + browser global, like the rest of modules/. It runs in the
// RENDERER too, because every export and preview is compiled there: the
// builder calls it once, at the single point where page HTML exists.
// ============================================================

(function () {

// The injector is layered on the generator — the tag names, the markers
// and the shared engine have exactly one definition, over there. Resolved
// lazily so the module loads in Node and in the renderer, where the
// generator arrives as a <script> global instead of through require().
function generator() {
  if (typeof window !== 'undefined' && window.WidgetGenerator) return window.WidgetGenerator;
  if (typeof require === 'function') {
    try { return require('./widget-generator.js'); } catch (e) { return null; }
  }
  return null;
}

function requireGenerator() {
  const g = generator();
  if (!g) throw new Error('widget-generator.js is not loaded — the widget injector needs it for tag names, markers and the shared engine');
  return g;
}

const PLACEHOLDER_RE = /<(pallet-widget|pallett-widget)\b([^>]*)>/gi;
const OPAQUE_RE = /<(script|style|template|textarea)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
// Quote characters are written as \x22 / \x27: the renderer-globals gate reads
// a literal quote inside a REGEX as the start of a string and desynchronises.
const ID_ATTR_RE = /\bid\s*=\s*(?:\x22([^\x22]*)\x22|\x27([^\x27]*)\x27|([^\s>]+))/i;

function escapeRegExp(value) {
  return String(value == null ? '' : value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ============================================================
   Reading the document
   ============================================================ */

/**
 * listWidgetPlaceholders(html) -> [{ id, tag, index }]
 * Every placeholder outside a <script>/<style>/<template>/<textarea>,
 * in document order. A placeholder inside a template literal or a
 * stylesheet is not a placeholder — it is text about one.
 */
function listWidgetPlaceholders(html) {
  const source = String(html == null ? '' : html);
  const opaque = [];
  OPAQUE_RE.lastIndex = 0;
  let block;
  while ((block = OPAQUE_RE.exec(source))) opaque.push([block.index, block.index + block[0].length]);
  const insideOpaque = (at) => opaque.some((range) => at >= range[0] && at < range[1]);

  const found = [];
  PLACEHOLDER_RE.lastIndex = 0;
  let match;
  while ((match = PLACEHOLDER_RE.exec(source))) {
    if (insideOpaque(match.index)) continue;
    const attr = match[2] || '';
    const idMatch = attr.match(ID_ATTR_RE);
    const id = idMatch ? String(idMatch[1] != null ? idMatch[1] : (idMatch[2] != null ? idMatch[2] : idMatch[3]) || '').trim() : '';
    found.push({ id, tag: match[1].toLowerCase(), index: match.index });
  }
  return found;
}

function hasConfigScript(html, id) {
  return new RegExp('data-pallett-widget\\s*=\\s*["\']' + escapeRegExp(id) + '["\']').test(html);
}

function hasRuntimeScript(html) {
  return /data-pallett-widget-runtime\b/.test(html);
}

/**
 * Find where the injected block belongs: immediately before the last
 * `</body>`, falling back to `</html>`, falling back to end of file.
 */
function injectionPoint(html) {
  const lower = html.toLowerCase();
  const body = lower.lastIndexOf('</body>');
  if (body !== -1) return { at: body, label: '</body>', found: true };
  const htmlClose = lower.lastIndexOf('</html>');
  if (htmlClose !== -1) return { at: htmlClose, label: '</html>', found: true };
  return { at: html.length, label: 'end of document', found: false };
}

/* ============================================================
   Reading the registry
   ============================================================ */

function normalizeRegistry(widgetRegistry) {
  const Generator = requireGenerator();
  const out = new Map();
  const warnings = [];
  if (!widgetRegistry) return { entries: out, warnings };

  const push = (id, value) => {
    const key = Generator.normalizeId(id);
    if (!key) { warnings.push('a registry entry with an unusable id was ignored'); return; }
    if (out.has(key)) warnings.push('registry entry "' + key + '" was defined twice; the last one wins');
    out.set(key, value);
  };

  if (typeof Map === 'function' && widgetRegistry instanceof Map) {
    widgetRegistry.forEach((value, id) => push(id, value));
  } else if (Array.isArray(widgetRegistry)) {
    widgetRegistry.forEach((entry) => {
      if (!entry || typeof entry !== 'object') { warnings.push('an array registry entry was not an object'); return; }
      push(entry.id, entry);
    });
  } else if (typeof widgetRegistry === 'object') {
    Object.keys(widgetRegistry).forEach((id) => push(id, widgetRegistry[id]));
  }
  return { entries: out, warnings };
}

/**
 * resolveEntry(id, value) -> { kind, script | configScript } | null
 * Accepts anything a caller might plausibly hold: a ready definition
 * from generateWidget, a compiled {config,runtime}, or raw source
 * ({ html, css, js } / { code } / { tokens }) that still needs
 * compiling.
 */
function resolveEntry(id, value, warnings) {
  const Generator = requireGenerator();
  if (value == null) return null;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const unwrapped = Generator.unwrapScript(trimmed);
    if (unwrapped != null) {
      if (unwrapped.indexOf(Generator.ENGINE_MARKER) !== -1) return { kind: 'self', script: trimmed };
      if (unwrapped.indexOf(Generator.CONFIG_MARKER) !== -1) return { kind: 'config', configScript: trimmed };
      warnings.push('the definition for "' + id + '" is a <script> without a recognisable widget body');
      return null;
    }
    if (trimmed.indexOf(Generator.CONFIG_MARKER) !== -1 || trimmed.indexOf(Generator.REGISTRY_KEY) !== -1) {
      return { kind: 'config', configScript: Generator.scriptBlock('data-pallett-widget="' + id + '"', trimmed) };
    }
    warnings.push('the definition for "' + id + '" is a string that is not a widget definition');
    return null;
  }

  if (typeof value !== 'object') return null;

  if (typeof value.script === 'string' && value.script.trim()) {
    const trimmed = value.script.trim();
    const unwrapped = Generator.unwrapScript(trimmed);
    const inner = unwrapped != null ? unwrapped : trimmed;
    if (inner.indexOf(Generator.ENGINE_MARKER) !== -1) return { kind: 'self', script: trimmed };
    if (unwrapped != null && inner.indexOf(Generator.CONFIG_MARKER) !== -1) return { kind: 'config', configScript: trimmed };
  }

  try {
    const compiled = Generator.compileWidget(Object.assign({}, value, { id: value.id != null ? value.id : id }));
    (compiled.warnings || []).forEach((w) => warnings.push(w));
    if (compiled.kind === 'self') return { kind: 'self', script: compiled.script };
    return { kind: 'config', configScript: compiled.configScript, runtimeScript: compiled.runtimeScript };
  } catch (e) {
    warnings.push('the definition for "' + id + '" could not be compiled: ' + (e && e.message ? e.message : e));
    return null;
  }
}

/* ============================================================
   The pipeline stage
   ============================================================ */

/**
 * injectWidgetsIntoAST(htmlString, widgetRegistry, opts)
 *
 * @param {string} htmlString     a complete exported HTML document
 * @param {object|Array|Map} widgetRegistry  id -> definition
 * @param {object} [opts]         { tag } override for the engine's element name
 * @returns {{
 *   ok: boolean, html: string, injected: string[], skipped: string[],
 *   warnings: string[], runtimeEmitted: boolean, placeholderCount: number
 * }}
 *
 * `html` is the rewritten document. `injected` lists the ids that gained a
 * definition, `skipped` those that did not (unknown, or already present).
 */
function injectWidgetsIntoAST(htmlString, widgetRegistry, opts) {
  const o = opts || {};
  const warnings = [];
  const source = typeof htmlString === 'string' ? htmlString : '';

  if (!source) {
    return {
      ok: false,
      error: 'injectWidgetsIntoAST: htmlString must be a non-empty string',
      html: source,
      injected: [],
      skipped: [],
      warnings,
      runtimeEmitted: false,
      placeholderCount: 0
    };
  }

  let Generator;
  let normalized;
  try {
    Generator = requireGenerator();
    normalized = normalizeRegistry(widgetRegistry);
  } catch (e) {
    return {
      ok: false,
      error: String(e && e.message ? e.message : e),
      html: source,
      injected: [],
      skipped: [],
      warnings,
      runtimeEmitted: false,
      placeholderCount: 0
    };
  }
  normalized.warnings.forEach((w) => warnings.push(w));

  const placeholders = listWidgetPlaceholders(source);
  // Distinct ids in first-appearance order — a widget used three times on a
  // page is one definition, which is the whole point of the dedup.
  const ids = [];
  const seen = new Set();
  placeholders.forEach((p) => {
    if (!p.id) { warnings.push('a <' + p.tag + '> placeholder has no id and was ignored'); return; }
    if (seen.has(p.id)) return;
    seen.add(p.id);
    ids.push(p.id);
  });

  const injected = [];
  const skipped = [];
  const blocks = [];
  let needsRuntime = false;
  let engineIncluded = false;

  ids.forEach((id) => {
    if (hasConfigScript(source, id)) { skipped.push(id); return; }

    if (!normalized.entries.has(id)) {
      skipped.push(id);
      warnings.push('no definition found for the "<pallet-widget id=\"' + id + '\">" placeholder');
      return;
    }

    const resolved = resolveEntry(id, normalized.entries.get(id), warnings);
    if (!resolved) { skipped.push(id); return; }

    if (resolved.kind === 'self') {
      blocks.push(resolved.script);
      // A self-contained definition already carries the engine, so a second
      // copy would be dead weight.
      engineIncluded = true;
    } else {
      blocks.push(resolved.configScript);
      needsRuntime = true;
    }
    injected.push(id);
  });

  let runtimeEmitted = false;
  if (needsRuntime && !engineIncluded && !hasRuntimeScript(source)) {
    blocks.push(Generator.scriptBlock('data-pallett-widget-runtime', Generator.buildRuntimeSource(o.tag || Generator.DEFAULT_TAG)));
    runtimeEmitted = true;
  }

  if (!blocks.length) {
    return {
      ok: true,
      html: source,
      injected,
      skipped,
      warnings,
      runtimeEmitted: false,
      placeholderCount: placeholders.length
    };
  }

  const block = blocks.join('\n');
  const point = injectionPoint(source);
  if (!point.found) warnings.push('the document has no </body>; widget definitions were appended at the end');

  const html = source.slice(0, point.at) + block + '\n' + source.slice(point.at);

  return {
    ok: true,
    html,
    injected,
    skipped,
    warnings,
    runtimeEmitted,
    placeholderCount: placeholders.length
  };
}

const WidgetInjector = {
  injectWidgetsIntoAST,
  listWidgetPlaceholders,
  normalizeRegistry,
  resolveEntry,
  injectionPoint,
  hasConfigScript,
  hasRuntimeScript
};

if (typeof module !== 'undefined' && module.exports) module.exports = WidgetInjector;
if (typeof window !== 'undefined') window.WidgetInjector = WidgetInjector;

})();
