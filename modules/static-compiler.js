'use strict';
// ============================================================
// PallettAI Studio — static compiler
// Compiles a project (theme tokens, page structure, widget
// choices) into a 100% self-contained, offline-ready static
// website folder. Zero runtime network calls: every reference in
// the export is a relative path, so the folder runs from
// file:// or any static host (Vercel/Netlify) unchanged.
// ------------------------------------------------------------
//   1. compileProject(projectData, options) → {ok, files,
//      manifest, warnings, stats}
//      The pure compile step — everything is generated in memory:
//        · master styles.css: the project's OKLCH design tokens
//          injected as root CSS variables
//          (`:root { --color-primary: oklch(…) }`, each with a hex
//          `-fallback` sibling for engines without oklch() — the
//          same duality theme-engine.js emits), @font-face blocks
//          for local fonts, a structural base layer, and the
//          project's own styles.
//        · index.html: critical styling inlined in the head, the
//          page's layout structural DOM nodes serialized into the
//          body, widget mounts + bundle reference at the end.
//        · scripts/widgets.js: the widget choice bundle — one
//          shared engine + one config per widget (reuses
//          widget-generator.js so exported widgets are the same
//          sanitized, Shadow-DOM components the app previews).
//        · assets/**: project files (images, fonts, …).
//        · manifest.json: the secure export manifest (below).
//   2. Offline asset manifest & export wrapper:
//        · every src/href/poster/srcset is forced onto a relative
//          path; remote URLs are rejected (options.allowRemote to
//          keep one, with a warning) and javascript:/vbscript:
//          URLs are rejected outright.
//        · generateManifest() records path, byte length and
//          sha256 for every shipped file plus a `digest` over the
//          canonical file list, so both the files and the manifest
//          itself can be integrity-checked later.
//        · writeExportTree(tree, outDir, options) writes the tree
//          with fs.promises, refusing any path that would escape
//          the output directory (path-traversal proof), with an
//          optional read-back verification pass.
//   3. The Electron bridge lives in main/index.js
//      (`project:compile-static`); this module is plain Node.
//
// Determinism: the same project compiles to byte-identical output
// (no timestamps unless the caller passes options.generatedAt),
// so exports are diffable and manifest checksums are stable.
//
// projectData shape (all keys optional except the structure):
//   {
//     meta:    { title?, description?, lang?, themeColor? }
//     theme:   {
//       tokens: { primary: 'oklch(…)' | '#rrggbb', … }   (any keys)
//       fonts:  [{ family, files: ['assets/fonts/x.woff2' | {path,
//                  format}], weight?, style?, role? }]
//     }
//     page:    { structure: [node, …] }   // or top-level `structure`
//     widgets: [{ id, title?, html?, css?, js?, script?, tag? }]
//     assets:  [{ path: 'assets/…', data, encoding?: 'base64' }]
//     styles:  'extra css for the master stylesheet'
//   }
//   node = 'text' | { tag, attrs?: {…}, text?, children?: [node] }
// ============================================================

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const ThemeEngine = require('./theme-engine.js');
const WidgetGenerator = require('./widget-generator.js');

function fail(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

function sha256Buf(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function asBuffer(data, encoding) {
  if (Buffer.isBuffer(data)) return data;
  const s = String(data == null ? '' : data);
  return encoding === 'base64' ? Buffer.from(s, 'base64') : Buffer.from(s, 'utf8');
}

/**
 * addFileRecord(files, seen, rel, data, encoding) → the recorded path.
 * The one place a file enters the tree: path-validated, collision-
 * checked (case-insensitively — macOS and Windows filesystems would
 * silently overwrite 'Index.html' onto 'index.html'), checksummed.
 */
function addFileRecord(files, seen, rel, data, encoding) {
  const p = safeRelPath(rel);
  const key = p.toLowerCase();
  if (seen.has(key)) throw fail('bad_input', 'duplicate export path "' + p + '"');
  seen.add(key);
  const buf = asBuffer(data, encoding);
  files.push({ path: p, data: buf, bytes: buf.length, sha256: sha256Buf(buf) });
  return p;
}

// ============================================================
// Path safety
// ------------------------------------------------------------
// A shipped path is a portable, relative, forward-slash URL path.
// The character allowlist is strict on purpose: these strings end
// up in HTML attributes, CSS url() references and on disk, and a
// project file is not above trying `../../etc/passwd`.
// ============================================================

const REL_PATH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

function safeRelPath(rel) {
  const p = String(rel == null ? '' : rel).trim();
  if (!p) throw fail('bad_input', 'file path is required');
  if (!REL_PATH_RE.test(p)) {
    throw fail('bad_input', 'file path "' + p + '" must be a relative, portable path '
      + '(letters, digits, dot, dash, underscore, slash; no leading slash)');
  }
  const segments = p.split('/');
  if (segments.some((seg) => seg === '' || seg === '.' || seg === '..')) {
    throw fail('bad_input', 'file path "' + p + '" escapes the export folder');
  }
  return p;
}

// Schemes that mean "never fetch anything" and are safe in exports.
const SAFE_SCHEMES = new Set(['data', 'mailto', 'tel', 'sms']);
const FORBIDDEN_SCHEMES = new Set(['javascript', 'vbscript', 'file', 'about']);

/**
 * toRelativeRef(ref, label, warnings, allowRemote) → normalized ref.
 * Local refs come back normalized (no ./ prefix, validated path);
 * data:/mailto:/tel:/#anchors pass through; remote URLs throw
 * unless allowRemote (then they pass with a warning).
 */
function toRelativeRef(ref, label, warnings, allowRemote) {
  const raw = String(ref == null ? '' : ref).trim();
  if (!raw) return raw;
  if (raw[0] === '#') return raw; // in-page anchor
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(raw);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (FORBIDDEN_SCHEMES.has(scheme)) {
      throw fail('bad_input', label + ' uses the forbidden "' + scheme + ':" scheme');
    }
    if (SAFE_SCHEMES.has(scheme)) return raw;
    if (allowRemote) {
      warnings.push(label + ' references a remote URL (' + scheme + ':) — '
        + 'the export will not be fully self-contained');
      return raw;
    }
    throw fail('bad_input', label + ' references a remote URL (' + scheme + ':) — '
      + 'exports must be self-contained; use a local asset (or options.allowRemote)');
  }
  // Local reference: split any ?query#suffix, validate the path part.
  const m = /^([^?#]*)([?#].*)?$/.exec(raw);
  let p = m[1].replace(/^\.\//, '');
  const suffix = m[2] || '';
  if (p.charAt(0) === '/') {
    throw fail('bad_input', label + ' must use a relative path (got "' + raw + '")');
  }
  p = safeRelPath(p);
  return p + suffix;
}

// ============================================================
// 1a. OKLCH token injection
// ============================================================

function kebab(name) {
  return String(name == null ? '' : name).trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * generateTokensCSS(tokens, warnings) → the `:root` variable block.
 *
 * Each token is read through theme-engine's OKLCH parser (accepts
 * hex or oklch() strings) and emitted twice — normalized oklch() in
 * --color-<name>, hex in --color-<name>-fallback — so engines
 * without oklch() still paint the theme. A value that is not a
 * colour (a length, a font stack, …) is emitted verbatim minus
 * declaration-breaking characters, with a warning.
 */
function generateTokensCSS(tokens, warnings) {
  const w = Array.isArray(warnings) ? warnings : []; // public helper: warnings arg is optional
  const map = (tokens && typeof tokens === 'object') ? tokens : {};
  const out = [':root {'];
  Object.keys(map).forEach((key) => {
    const name = 'color-' + kebab(key);
    // No empty dash segments: a key of "++" kebabs to nothing and must
    // not produce a half-variable like `--color-`.
    if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name)) {
      throw fail('bad_input', 'theme token "' + key + '" is not a usable CSS variable name');
    }
    const raw = String(map[key] == null ? '' : map[key]).trim();
    if (!raw) {
      w.push('theme token "' + key + '" is empty — skipped');
      return;
    }
    const lch = ThemeEngine.color.parseToOklch(raw);
    if (lch) {
      out.push('  --' + name + ': ' + ThemeEngine.color.oklchToCss(lch) + ';');
      out.push('  --' + name + '-fallback: ' + ThemeEngine.color.oklchToHex(lch) + ';');
      return;
    }
    // Not a colour: keep the author's value, but it must not be able
    // to close the declaration, the block it lives in, or the inline
    // <style> block the critical subset is served from.
    const safe = raw.replace(/[;{}<>]/g, '');
    if (!safe) {
      w.push('theme token "' + key + '" has no usable value — skipped');
      return;
    }
    if (safe !== raw) {
      w.push('theme token "' + key + '" had declaration-breaking characters stripped');
    }
    w.push('theme token "' + key + '" is not an oklch()/hex colour — '
      + 'emitted verbatim without a hex fallback');
    out.push('  --' + name + ': ' + safe + ';');
  });
  out.push('}');
  return out.join('\n');
}

// ============================================================
// 1b. Local fonts
// ============================================================

const FONT_FORMATS = { woff2: 'woff2', woff: 'woff', ttf: 'truetype', otf: 'opentype' };

function fontFormatOf(file) {
  const ext = String(file).slice(String(file).lastIndexOf('.') + 1).toLowerCase();
  return FONT_FORMATS[ext] || null;
}

/**
 * generateFontsCSS(fonts, warnings) → @font-face blocks + a :root
 * font-family variable per role (`--font-body`, `--font-heading`, …).
 * Every src is a validated relative path — fonts must ship inside
 * the export folder, never as a webfont URL.
 */
function generateFontsCSS(fonts, warnings) {
  const w = Array.isArray(warnings) ? warnings : []; // public helper: warnings arg is optional
  const list = Array.isArray(fonts) ? fonts : [];
  const out = [];
  const vars = [];
  list.forEach((font, i) => {
    const f = (font && typeof font === 'object') ? font : {};
    const family = String(f.family == null ? '' : f.family).trim()
      .replace(/[\\\"'{};]/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    if (!family) {
      w.push('font #' + (i + 1) + ' has no family name — skipped');
      return;
    }
    const files = (Array.isArray(f.files) ? f.files : []).map((entry) => {
      const spec = (entry && typeof entry === 'object') ? entry : { path: entry };
      let rel;
      try {
        rel = safeRelPath(spec.path);
      } catch (e) {
        // Fonts are assets of the export, never webfont URLs: a remote
        // @font-face src would break the offline guarantee at first paint.
        throw fail('bad_input', 'font "' + family + '" file must be a local, relative path '
          + '(got "' + String(spec.path) + '")');
      }
      const format = spec.format || fontFormatOf(rel);
      return { rel, format };
    });
    if (!files.length) {
      w.push('font "' + family + '" lists no local files — skipped');
      return;
    }
    const src = files
      .map((file) => 'url("' + file.rel + '")' + (file.format ? ' format("' + file.format + '")' : ''))
      .join(', ');
    out.push('@font-face {');
    out.push('  font-family: "' + family + '";');
    out.push('  src: ' + src + ';');
    if (f.weight != null) out.push('  font-weight: ' + String(f.weight).replace(/[;{}<>]/g, '') + ';');
    if (f.style != null) out.push('  font-style: ' + String(f.style).replace(/[;{}<>]/g, '') + ';');
    out.push('  font-display: swap;');
    out.push('}');
    const role = kebab(f.role || family) || 'body';
    vars.push('  --font-' + role + ': "' + family + '", ui-sans-serif, system-ui, sans-serif;');
  });
  if (vars.length) out.push(':root {\n' + vars.join('\n') + '\n}');
  return out.join('\n');
}

// ============================================================
// 1c. Structural DOM nodes → HTML
// ============================================================

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW_TEXT_TAGS = new Set(['script', 'style']); // code, not prose: not escaped
const TAG_RE = /^[a-z][a-z0-9-]*$/;
const ATTR_RE = /^[a-zA-Z][a-zA-Z0-9_:.-]*$/;
const URL_ATTRS = new Set(['src', 'href', 'poster']);
const MAX_DEPTH = 64;

function escapeText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// A RAWTEXT element is closed by the literal `</tag` sequence, so code
// containing that string would end its own element early and leak the
// rest as markup. The standard serialization fix: insert a backslash —
// `\/` is just `/` inside JS strings and regexes, and CSS error
// recovery drops the stray character — so the closer cannot form.
const RAW_CLOSERS = { script: /<\/script/gi, style: /<\/style/gi };
const RAW_CLOSERS_ESCAPED = { script: '<\\/script', style: '<\\/style' };

function rawText(tag, text) {
  return String(text).replace(RAW_CLOSERS[tag], RAW_CLOSERS_ESCAPED[tag]);
}

/**
 * renderStructure(nodes, ctx) → HTML text.
 *
 * node = 'text' | { tag, attrs?, text?, children? }.
 * Tag and attribute names are validated identifiers, text and
 * attribute values are escaped, and every URL attribute runs
 * through toRelativeRef so the offline guarantee holds even when
 * the project data was hand-edited or imported. script/style text
 * is emitted raw (it is code); everything else is escaped.
 */
function renderStructure(nodes, ctx, depth) {
  const d = depth || 0;
  if (d > MAX_DEPTH) {
    throw fail('bad_input', 'page structure nests deeper than ' + MAX_DEPTH + ' levels');
  }
  const out = [];
  (Array.isArray(nodes) ? nodes : [nodes]).forEach((node) => {
    if (node == null || node === false) return;
    if (typeof node === 'string' || typeof node === 'number') {
      out.push(escapeText(node));
      return;
    }
    if (typeof node !== 'object') {
      throw fail('bad_input', 'page structure nodes must be strings or objects');
    }
    const tag = String(node.tag == null ? '' : node.tag).trim().toLowerCase();
    if (!TAG_RE.test(tag)) {
      throw fail('bad_input', 'structure node has an invalid tag name: "' + String(node.tag) + '"');
    }
    const attrs = (node.attrs && typeof node.attrs === 'object') ? node.attrs : {};
    const attrText = Object.keys(attrs).map((name) => {
      const n = String(name).trim();
      if (!ATTR_RE.test(n)) {
        throw fail('bad_input', 'invalid attribute name "' + name + '" on <' + tag + '>');
      }
      const v = attrs[name];
      if (v == null || v === false) return ''; // dropped attribute
      if (v === true || v === '') return ' ' + n; // boolean attribute
      let value = String(v);
      if (URL_ATTRS.has(n.toLowerCase())) {
        value = toRelativeRef(value, '<' + tag + ' ' + n + '>', ctx.warnings, ctx.allowRemote);
      } else if (n.toLowerCase() === 'srcset') {
        // "a.png 2x, b.png 3x" — every candidate URL must stay local.
        value = value.split(',').map((cand) => {
          const parts = cand.trim().split(/\s+/);
          parts[0] = toRelativeRef(parts[0], '<' + tag + ' srcset>', ctx.warnings, ctx.allowRemote);
          return parts.join(' ');
        }).filter(Boolean).join(', ');
      }
      return ' ' + n + '="' + escapeAttr(value) + '"';
    }).join('');
    if (VOID_TAGS.has(tag)) {
      out.push('<' + tag + attrText + '>');
      return;
    }
    let inner = '';
    if (node.text != null) {
      inner += RAW_TEXT_TAGS.has(tag) ? rawText(tag, node.text) : escapeText(node.text);
    }
    if (node.children != null) {
      inner += renderStructure(node.children, ctx, d + 1);
    }
    out.push('<' + tag + attrText + '>' + inner + '</' + tag + '>');
  });
  return out.join('\n');
}

/** Walk the structure for a widget mount with the given id. */
function structureHasMount(nodes, tag, id) {
  let found = false;
  const walk = (list) => {
    (Array.isArray(list) ? list : [list]).forEach((node) => {
      if (found || !node || typeof node !== 'object') return;
      const attrs = (node.attrs && typeof node.attrs === 'object') ? node.attrs : {};
      if (String(node.tag).trim().toLowerCase() === tag && String(attrs.id) === id) found = true;
      if (node.children) walk(node.children);
    });
  };
  walk(nodes);
  return found;
}

// ============================================================
// 1d. Widget injection
// ============================================================

/**
 * buildWidgetBundle(widgets, tokens, warnings) → { source, mounts }
 *
 * Widget "choices" ride through widget-generator's compiler, so a
 * static export gets exactly the component the app previewed —
 * sanitized code, Shadow DOM isolation, honest fallback cards.
 * The bundle is ONE file: each widget's config (registry entry)
 * first, the shared engine last. Configs before the engine means a
 * mount finds its definition already registered — no fallback
 * flash — and the engine's own re-mount pass still handles widgets
 * injected later. The engine is emitted exactly once no matter how
 * many widgets ship.
 */
function buildWidgetBundle(widgets, tokens, warnings) {
  const list = Array.isArray(widgets) ? widgets : [];
  const configs = [];
  const mounts = []; // { id, tag, html } — id is the COMPILED id (it may be
  let runtime = ''; // derived from the title when the input has none)
  list.forEach((w, i) => {
    const input = (w && typeof w === 'object') ? w : {};
    let compiled;
    try {
      compiled = WidgetGenerator.compileWidget(input, { tokens });
    } catch (e) {
      throw fail('bad_input', 'widget #' + (i + 1) + ': ' + String((e && e.message) || e));
    }
    (compiled.warnings || []).forEach((msg) => warnings.push('widget "' + compiled.id + '": ' + msg));
    if (!compiled.id) {
      // A mount is keyed by id (the engine's registry lookup); an empty
      // one could never mount, so it is a configuration error.
      throw fail('bad_input', 'widget #' + (i + 1) + ' has no usable id ([A-Za-z0-9_-]{1,64})');
    }
    if (compiled.kind === 'self') {
      // A self-contained definition carries its own engine + config.
      configs.push(WidgetGenerator.unwrapScript(compiled.script) || compiled.script);
    } else {
      configs.push(compiled.config);
      if (!runtime) runtime = compiled.runtime;
    }
    mounts.push({
      id: compiled.id,
      tag: compiled.tag,
      html: '<' + compiled.tag + ' id="' + escapeAttr(compiled.id) + '"></' + compiled.tag + '>'
    });
  });
  if (!configs.length) return { source: '', mounts: [] };
  const source = ['/* PallettAI Studio — widget bundle (generated) */']
    .concat(configs)
    .concat(runtime ? [runtime] : [])
    .join('\n');
  return { source, mounts };
}

// ============================================================
// 2a. Stylesheets
// ============================================================

const BASE_CSS = [
  '/* structural base */',
  '*,*::before,*::after{box-sizing:border-box}',
  'html{-webkit-text-size-adjust:100%;scroll-padding-top:1rem}',
  'body{margin:0;line-height:1.5;'
  + 'font-family:var(--font-body, ui-sans-serif, system-ui, sans-serif);'
  + 'color:var(--color-text-fallback, #171717);'
  + 'background:var(--color-surface-fallback, #ffffff)}',
  'img,svg,video,canvas{max-width:100%;height:auto}',
  'h1,h2,h3,h4,h5,h6,p,figure,blockquote,dl,dd{margin:0}',
  'ul[role="list"],ol[role="list"]{list-style:none;margin:0;padding:0}',
  'a{color:var(--color-primary-fallback, #2f5bea)}',
  'button,input,select,textarea{font:inherit}',
  '/* oklch() upgrades where the engine understands it. The fallback',
  '   variables above stay in place for engines that do not. */',
  '@supports (color: oklch(0 0 0)){',
  '  body{color:var(--color-text, var(--color-text-fallback, #171717));'
  + 'background:var(--color-surface, var(--color-surface-fallback, #ffffff))}',
  '  a{color:var(--color-primary, var(--color-primary-fallback, #2f5bea))}',
  '}'
].join('\n');

/**
 * generateStylesheet(projectData, warnings) → the master styles.css.
 * Tokens → fonts → structural base → the project's own styles.
 */
function generateStylesheet(projectData, warnings) {
  const theme = (projectData.theme && typeof projectData.theme === 'object') ? projectData.theme : {};
  const parts = [
    '/* PallettAI Studio — static export stylesheet (generated; deterministic) */',
    '/* design tokens — oklch() with hex -fallback siblings */',
    generateTokensCSS(theme.tokens, warnings)
  ];
  const fontsCSS = generateFontsCSS(theme.fonts, warnings);
  if (fontsCSS) parts.push('/* local fonts */', fontsCSS);
  parts.push(BASE_CSS);
  const extra = projectData.styles == null ? '' : String(projectData.styles);
  if (extra.trim()) parts.push('/* project styles */', extra);
  return parts.join('\n') + '\n';
}

/**
 * generateCriticalCSS(projectData, warnings) → the subset inlined
 * into index.html's head: tokens + the first-paint essentials, so a
 * page is themed before the linked master sheet resolves (and a
 * bare index.html is still readable standalone).
 */
function generateCriticalCSS(projectData, warnings) {
  const theme = (projectData.theme && typeof projectData.theme === 'object') ? projectData.theme : {};
  return [
    generateTokensCSS(theme.tokens, warnings),
    'body{margin:0;line-height:1.5;'
    + 'font-family:var(--font-body, ui-sans-serif, system-ui, sans-serif);'
    + 'color:var(--color-text-fallback, #171717);'
    + 'background:var(--color-surface-fallback, #ffffff)}'
  ].join('\n');
}

// ============================================================
// 2b. Secure export manifest
// ============================================================

/**
 * generateManifest(fileRecords, options) → manifest object.
 *
 * Records path + byte length + sha256 for every shipped file
 * (everything except manifest.json itself — a manifest cannot hash
 * its own bytes), plus `digest`: a sha256 over the canonical,
 * path-sorted file list. Tampering with any file breaks its
 * checksum; tampering with the checksums breaks the digest, so the
 * manifest is self-verifying without a secret key.
 *
 * Byte-stable by default: pass options.generatedAt (ISO string) to
 * stamp a wall-clock time when a human-facing record matters more
 * than reproducible output.
 */
function generateManifest(fileRecords, options) {
  const o = (options && typeof options === 'object') ? options : {};
  const files = (Array.isArray(fileRecords) ? fileRecords : []).map((f) => ({
    path: f.path,
    bytes: f.bytes,
    sha256: f.sha256
  })).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const canonical = files.map((f) => f.path + '\n' + f.sha256 + '\n').join('');
  const manifest = {
    format: 'pallettai-static-export',
    version: 1,
    generator: 'pallettai-studio/static-compiler',
    algorithm: 'sha256',
    entry: 'index.html',
    offline: true,
    counts: {
      files: files.length,
      bytes: files.reduce((n, f) => n + (f.bytes || 0), 0)
    },
    files,
    digest: sha256Buf(Buffer.from(canonical, 'utf8'))
  };
  if (o.generatedAt != null) manifest.generatedAt = String(o.generatedAt);
  return manifest;
}

// ============================================================
// 1. compileProject
// ============================================================

/**
 * compileProject(projectData, options) →
 *   { ok, entry, files: [{path, data, bytes, sha256}], manifest,
 *     manifestJson, warnings, stats }
 *
 * Pure: nothing is written to disk here. files[] is the complete
 * export tree (manifest.json included, listed last); hand it to
 * writeExportTree() to materialize it. Throws coded errors
 * (`e.code === 'bad_input'`) on invalid project data — a compile
 * never half-succeeds.
 */
function compileProject(projectData, options) {
  const opts = (options && typeof options === 'object') ? options : {};
  const warnings = [];
  const project = (projectData && typeof projectData === 'object' && !Array.isArray(projectData))
    ? projectData : null;
  if (!project) throw fail('bad_input', 'compileProject requires a project object');

  // --- page structure (project.page.structure, or top-level `structure`)
  const page = (project.page && typeof project.page === 'object') ? project.page : {};
  const structure = Array.isArray(page.structure) ? page.structure
    : (Array.isArray(project.structure) ? project.structure : null);
  if (!structure || !structure.length) {
    throw fail('bad_input', 'project.page.structure must be a non-empty array of layout nodes');
  }

  const meta = (project.meta && typeof project.meta === 'object') ? project.meta : {};
  const ctx = { warnings, allowRemote: opts.allowRemote === true };
  const bodyHtml = renderStructure(structure, ctx);

  // --- widget choices → mounts + bundle
  const bundle = buildWidgetBundle(project.widgets, projectThemeTokens(project), warnings);

  // --- master + critical styles
  const stylesCss = generateStylesheet(project, warnings);
  // The critical subset regenerates the same token block; its warnings
  // were already reported by the master-sheet pass, so they go to a
  // scratch array rather than being duplicated in the report.
  const criticalCss = generateCriticalCSS(project, []);

  // --- document
  const title = String(meta.title == null ? '' : meta.title).trim() || 'Site';
  let lang = String(meta.lang == null ? 'en' : meta.lang).trim();
  if (!/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(lang)) {
    warnings.push('meta.lang "' + meta.lang + '" is not a valid language tag — using "en"');
    lang = 'en';
  }
  // meta.themeColor rides into <meta name="theme-color"> — hex only
  // there, since that meta tag predates oklch() support.
  const parsedThemeColor = meta.themeColor == null
    ? null : ThemeEngine.color.parseToOklch(meta.themeColor);
  const themeColor = parsedThemeColor ? ThemeEngine.color.oklchToHex(parsedThemeColor) : null;
  if (meta.themeColor != null && !themeColor) {
    warnings.push('meta.themeColor is not an oklch()/hex colour — theme-color meta skipped');
  }
  const head = [
    '<!doctype html>',
    '<html lang="' + escapeAttr(lang) + '">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>' + escapeText(title) + '</title>'
  ];
  if (meta.description) head.push('<meta name="description" content="' + escapeAttr(meta.description) + '">');
  if (themeColor) head.push('<meta name="theme-color" content="' + escapeAttr(themeColor) + '">');
  head.push('<link rel="stylesheet" href="styles.css">');
  head.push('<style data-critical>' + criticalCss + '</style>');
  head.push('</head>', '<body>');
  const tail = ['</body>', '</html>', ''];

  const mountHtml = bundle.mounts
    .filter((m) => !structureHasMount(structure, m.tag, m.id))
    .map((m) => m.html)
    .join('\n');
  const html = head.join('\n') + '\n'
    + bodyHtml + (mountHtml ? '\n' + mountHtml : '') + '\n'
    + (bundle.source ? '<script src="scripts/widgets.js" defer></script>\n' : '')
    + tail.join('\n');

  // --- assemble the export tree
  const files = [];
  const seen = new Set();

  addFileRecord(files, seen, 'index.html', html);
  addFileRecord(files, seen, 'styles.css', stylesCss);
  if (bundle.source) addFileRecord(files, seen, 'scripts/widgets.js', bundle.source);

  (Array.isArray(project.assets) ? project.assets : []).forEach((asset, i) => {
    const a = (asset && typeof asset === 'object') ? asset : {};
    if (a.data == null) {
      throw fail('bad_input', 'asset #' + (i + 1) + ' ("' + String(a.path) + '") has no data');
    }
    const rel = safeRelPath(a.path);
    if (rel === 'index.html' || rel === 'styles.css' || rel === 'manifest.json'
      || rel === 'scripts/widgets.js') {
      throw fail('bad_input', 'asset path "' + rel + '" collides with a generated file');
    }
    addFileRecord(files, seen, rel, a.data, a.encoding);
  });

  // --- manifest last: it records every other file's checksum
  const manifest = generateManifest(files, { generatedAt: opts.generatedAt });
  const manifestJson = JSON.stringify(manifest, null, 2) + '\n';
  addFileRecord(files, seen, 'manifest.json', manifestJson);

  return {
    ok: true,
    entry: 'index.html',
    files,
    manifest,
    manifestJson,
    warnings,
    stats: {
      files: files.length,
      bytes: files.reduce((n, f) => n + f.bytes, 0),
      widgets: bundle.mounts.length,
      assets: Array.isArray(project.assets) ? project.assets.length : 0
    }
  };
}

function projectThemeTokens(project) {
  return (project.theme && typeof project.theme === 'object') ? project.theme.tokens : null;
}

/**
 * compileFileTree(files, options) → the same result envelope as
 * compileProject, for producers that have ALREADY built their files —
 * the renderer's Builder output, an importer, a CLI pass.
 *
 * Entries are {path, data} or {name, content} (the renderer's delivery
 * file shape); each is path-validated and checksummed, and manifest.json
 * is appended, so pre-built trees get the same integrity story as
 * compiler-built ones. The one reserved path is manifest.json itself.
 */
function compileFileTree(files, options) {
  const opts = (options && typeof options === 'object') ? options : {};
  const list = Array.isArray(files) ? files : null;
  if (!list || !list.length) {
    throw fail('bad_input', 'compileFileTree requires a non-empty files array');
  }
  const warnings = [];
  const records = [];
  const seen = new Set();
  list.forEach((entry, i) => {
    const f = (entry && typeof entry === 'object') ? entry : {};
    const rel = f.path != null ? f.path : f.name;
    const data = f.data != null ? f.data : f.content;
    if (data == null) {
      throw fail('bad_input', 'file #' + (i + 1) + ' ("' + String(rel) + '") has no data');
    }
    if (String(rel).trim().toLowerCase() === 'manifest.json') {
      throw fail('bad_input', 'file path "' + String(rel)
        + '" is reserved for the generated integrity manifest');
    }
    addFileRecord(records, seen, rel, data, f.encoding);
  });

  const manifest = generateManifest(records, { generatedAt: opts.generatedAt });
  const manifestJson = JSON.stringify(manifest, null, 2) + '\n';
  addFileRecord(records, seen, 'manifest.json', manifestJson);

  return {
    ok: true,
    entry: records.some((r) => r.path === 'index.html') ? 'index.html' : records[0].path,
    files: records,
    manifest,
    manifestJson,
    warnings,
    stats: {
      files: records.length,
      bytes: records.reduce((n, r) => n + r.bytes, 0),
      widgets: 0,
      assets: 0
    }
  };
}

// ============================================================
// 2c. Export writer
// ============================================================

/**
 * writeExportTree(tree, outDir, options) →
 *   { ok, outDir, written: [{path, bytes}], count }
 *
 * fs.promises throughout — the write phase yields to the event loop
 * instead of blocking it. Every path is validated AND re-checked
 * against the resolved output directory, so nothing in the tree can
 * write outside the folder the user chose. options.verify re-reads
 * each file and compares its sha256 against the compile-time
 * checksum before the write is reported successful.
 */
async function writeExportTree(tree, outDir, options) {
  const o = (options && typeof options === 'object') ? options : {};
  const files = tree && Array.isArray(tree.files) ? tree.files : null;
  if (!files) throw fail('bad_input', 'writeExportTree needs a compile result (files[])');
  const target = String(outDir == null ? '' : outDir).trim();
  if (!target) throw fail('bad_input', 'writeExportTree needs an absolute output directory');
  if (!path.isAbsolute(target)) {
    throw fail('bad_input', 'output directory must be an absolute path (got "' + target + '")');
  }
  const root = path.resolve(target);
  if (root === path.parse(root).root) {
    throw fail('bad_input', 'refusing to write an export into a filesystem root');
  }

  await fs.promises.mkdir(root, { recursive: true });
  const written = [];
  for (const f of files) {
    const rel = safeRelPath(f.path);
    const full = path.resolve(root, rel);
    // Defense in depth: safeRelPath rejects traversal, and even if a
    // future path rule loosened, nothing may land outside root.
    if (full !== root && full.indexOf(root + path.sep) !== 0) {
      throw fail('bad_input', 'export path "' + rel + '" escapes the output directory');
    }
    await fs.promises.mkdir(path.dirname(full), { recursive: true });
    const buf = Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data == null ? '' : f.data), 'utf8');
    await fs.promises.writeFile(full, buf);
    written.push({ path: rel, bytes: buf.length });
    if (o.verify) {
      const back = await fs.promises.readFile(full);
      const expected = f.sha256 || sha256Buf(buf);
      if (sha256Buf(back) !== expected) {
        throw fail('write_failed', 'checksum mismatch after writing "' + rel + '"');
      }
    }
  }
  return { ok: true, outDir: root, written, count: written.length };
}

module.exports = {
  compileProject,
  compileFileTree,
  writeExportTree,
  generateTokensCSS,
  generateFontsCSS,
  generateStylesheet,
  generateCriticalCSS,
  generateManifest,
  renderStructure,
  toRelativeRef,
  safeRelPath
};
