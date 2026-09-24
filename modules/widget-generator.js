'use strict';
// ============================================================
// PallettAI Studio — WidgetGenerator (the Dynamic Widget Engine)
// ------------------------------------------------------------
// Turns a plain-English request ("build a roofing quote estimator")
// into a zero-dependency Vanilla JS web component that can be
// injected into a static export.
//
//   generateWidget(prompt, baseTokens, opts) -> Promise<string>
//     Builds the system prompt, asks the configured completer (an
//     LLM adapter), validates the answer hard, and returns the
//     COMPLETE, stringified component definition — a ready-to-inject
//     <script> block. This is the one function an IPC channel calls.
//
//   compileWidget(input, opts) -> { ok, config, runtime, script, … }
//     The compiler underneath: sanitises LLM code, resolves design
//     tokens, and emits the custom element definition.
//
// ---- what the generated component is -----------------------
// Every widget mounts as ONE shared custom element. The element is
// defined once per page (`class PallettWidget extends HTMLElement`)
// and each generated widget only registers a config object keyed by
// the placeholder's `id`. Two copies of a definition therefore never
// fight over `customElements.define`, which is what lets the
// injector emit the class once for any number of widgets.
//
// The element attaches a Shadow DOM so a widget's styles can neither
// leak into the client's site nor be broken by it. Behaviour is run
// as a real inline <script>, so the export never needs
// `script-src 'unsafe-eval'` — the builder already ships
// `'unsafe-inline'`.
//
// ---- what this file refuses ---------------------------------
// 1. FRAMEWORKS. React/Vue/Svelte/Angular/jQuery/Alpine/htmx and any
//    CDN <script src> are rejected outright — the whole point is
//    zero dependencies in the export.
// 2. CODE THAT REACHES OUT. eval, new Function, document.write,
//    import(), require(), document.cookie, window.top/parent and
//    iframe/object/embed/link/base tags are rejected. Generated code
//    runs in a client's live page; "the model would not do that" is
//    not a security model.
// 3. MALFORMED OUTPUT. Anything the parser cannot turn into
//    html+css+js becomes a FALLBACK UI inside the Shadow DOM — the
//    visitor sees an honest "widget unavailable" card rather than a
//    blank gap or a page-level exception.
//
// Pure string + token work: no DOM, no network here. The only
// network call lives in the completer seam at the bottom.
//
// CommonJS + browser global, like the rest of modules/ (see
// theme-injector.js and token-exporter.js). The IIFE keeps this file's
// helpers — clamp, round, safeJson, collect and friends — out of the
// renderer's global scope, where two files declaring the same common name
// means the last one loaded silently wins. The body is deliberately left at
// the outer indentation so it stays readable against its Node form.
// ============================================================

(function () {

/* ============================================================
   Constants
   ============================================================ */

const DEFAULT_TAG = 'pallet-widget';
// The brief spells the placeholder `pallet-widget` while the product
// is "PallettAI". Both spellings are registered from the same class so
// a single missing letter can never leave a placeholder inert.
const ALIAS_TAG = 'pallett-widget';
const REGISTRY_KEY = '__pallettWidgets';
const ENGINE_MARKER = 'pallett-engine';
const CONFIG_MARKER = 'pallett-config';

// Budgets. A widget is a component, not a page: these caps keep one
// careless model response from doubling an export's weight.
const MAX_HTML = 120 * 1024;
const MAX_CSS = 80 * 1024;
const MAX_JS = 120 * 1024;
const MAX_TITLE = 120;
const MAX_ERROR = 240;

/* ============================================================
   Small helpers
   ============================================================ */

function clamp(value, min, max) {
  const n = Number(value);
  if (!isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function round(value, places) {
  const factor = Math.pow(10, places === undefined ? 3 : places);
  return Math.round(value * factor) / factor;
}

// Same OKLCH serialisation the Studio's GLM design DNA uses, so a
// widget's palette is perceptually identical to the site around it.
function oklch(l, c, h) {
  const lightness = clamp(l, 0, 1);
  const chroma = Math.max(0, Number(c) || 0);
  const hue = ((Number(h) || 0) % 360 + 360) % 360;
  return 'oklch(' + round(lightness, 4) + ' ' + round(chroma, 4) + ' ' + round(hue, 2) + ')';
}

function htmlEscape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * JSON that is safe to drop inside an HTML <script>. Escaping every `<`
 * as \u003c makes `</script>`, `<!--` and `<script` impossible in the
 * serialized output while staying valid JSON and valid JS — the value
 * decodes back to the original string at runtime.
 */
function safeJson(value) {
  return JSON.stringify(value == null ? null : value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

// A CSS custom-property VALUE may never close its declaration or block,
// open a comment, or carry an escape. Legitimate token values (hex,
// oklch(), clamp(), shadows, font stacks) never need those.
const UNSAFE_CSS_VALUE = /[;{}]|\\|\/\*|[\u0000-\u001f\u007f]/;
function cssValue(value) {
  const s = (typeof value === 'number' && isFinite(value)) ? String(value) : String(value == null ? '' : value).trim();
  if (!s || UNSAFE_CSS_VALUE.test(s)) return null;
  return s;
}

function djb2(parts) {
  const text = parts.join('\u0000');
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function truncate(value, max) {
  const s = String(value == null ? '' : value);
  return s.length > max ? s.slice(0, max) : s;
}

/* ============================================================
   Design tokens — every widget paints with --color-*
   ------------------------------------------------------------
   The brief asks for `--color-*` variables, so the whole contract is
   flattened to that one namespace regardless of which shape the
   caller has: a GLM OKLCH seed, the canonical tokenMap, the derived
   `--pai-*` map, or explicit `--color-*` entries.
   ============================================================ */

const COLOR_VARS = [
  'primary', 'primary-hover', 'primary-soft', 'accent', 'background', 'surface',
  'surface-alt', 'border', 'text', 'muted', 'on-primary', 'success', 'warning',
  'danger', 'info', 'radius'
];

// Neutral defaults so the generated CSS can rely on every contract
// variable existing — a widget never paints with an unresolved var().
const FALLBACK_COLORS = {
  primary: '#5b8cff',
  'primary-hover': '#4a7bf0',
  'primary-soft': 'rgba(91,140,255,.16)',
  accent: '#5b8cff',
  background: '#0f1116',
  surface: 'rgba(255,255,255,.04)',
  'surface-alt': 'rgba(255,255,255,.08)',
  border: 'rgba(127,127,127,.28)',
  text: '#e9edf5',
  muted: '#9aa6bb',
  'on-primary': '#ffffff',
  success: '#12a150',
  warning: '#d9a534',
  danger: '#e5484d',
  info: '#3b82f6',
  radius: '12px'
};

// canonical tokenMap colour roles -> --color-* names
const ROLE_ALIASES = {
  primary: 'primary', brand: 'primary',
  primaryhover: 'primary-hover', 'primary-hover': 'primary-hover', primary_hover: 'primary-hover',
  secondary: 'primary-soft',
  accent: 'accent',
  background: 'background', bg: 'background', canvas: 'background',
  surface: 'surface', card: 'surface',
  surfacealt: 'surface-alt', 'surface-alt': 'surface-alt', surface_alt: 'surface-alt',
  border: 'border', line: 'border',
  text: 'text', ink: 'text', foreground: 'text', fg: 'text',
  muted: 'muted', mutedtext: 'muted', 'muted-text': 'muted', textmuted: 'muted',
  onprimary: 'on-primary', 'on-primary': 'on-primary', on_primary: 'on-primary', onbrand: 'on-primary',
  danger: 'danger', error: 'danger',
  warning: 'warning', warn: 'warning',
  success: 'success', ok: 'success',
  info: 'info'
};

// the Studio's derived token map (ui/runtime.js deriveTokenSet)
const PAI_TO_COLOR = {
  '--pai-bg': 'background',
  '--pai-surface': 'surface',
  '--pai-surface-alt': 'surface-alt',
  '--pai-border': 'border',
  '--pai-text': 'text',
  '--pai-text-muted': 'muted',
  '--pai-accent': 'primary',
  '--pai-accent-hover': 'primary-hover',
  '--pai-accent-soft': 'primary-soft',
  '--pai-ok': 'success',
  '--pai-warn': 'warning',
  '--pai-error': 'danger',
  '--pai-info': 'info',
  '--pai-radius': 'radius'
};

// GLM Design DNA seed -> the same palette ui/runtime.js derives, so a
// widget matches a site built from the identical OKLCH seed.
function deriveFromSeed(seed) {
  const l = clamp(seed && seed.l, 0, 1) || 0.62;
  const chroma = isFinite(Number(seed && seed.c)) && Number(seed.c) >= 0 ? Number(seed.c) : 0.16;
  const hue = Number(seed && seed.h) || 262;
  return {
    primary: oklch(l, chroma, hue),
    'primary-hover': oklch(clamp(l + 0.06, 0, 1), chroma, hue),
    'primary-soft': oklch(clamp(l + 0.22, 0, 0.98), chroma * 0.5, hue),
    accent: oklch(l, chroma, hue),
    background: oklch(0.16, 0.012, hue),
    surface: oklch(0.21, 0.016, hue),
    'surface-alt': oklch(0.26, 0.02, hue),
    border: oklch(0.34, 0.024, hue),
    text: oklch(0.96, 0.006, hue),
    muted: oklch(0.74, 0.014, hue),
    'on-primary': oklch(0.14, 0.01, hue),
    success: oklch(0.72, 0.15, 152),
    warning: oklch(0.80, 0.15, 85),
    danger: oklch(0.62, 0.19, 25),
    info: oklch(0.72, 0.13, 235)
  };
}

/**
 * resolveColorTokens(baseTokens) -> { vars, decls, warnings }
 * Accepts any of: null, a GLM seed map, the canonical tokenMap, the
 * derived --pai-* map, a flat --color-* map, or a mix. Precedence is
 * most-explicit first, so a caller can override one colour without
 * restating the palette.
 */
function resolveColorTokens(baseTokens) {
  const warnings = [];
  const vars = {};
  const t = (baseTokens && typeof baseTokens === 'object') ? baseTokens : {};

  const set = (role, value) => {
    const name = ROLE_ALIASES[String(role).toLowerCase()] || null;
    if (!name) return;
    const v = cssValue(value);
    if (v == null) { warnings.push('colour "' + role + '" dropped — value contains CSS-structural characters'); return; }
    vars['--color-' + name] = v;
  };

  // 1) explicit --color-* passthrough
  Object.keys(t).forEach((key) => {
    if (/^--color-/.test(key)) {
      const v = cssValue(t[key]);
      if (v == null) warnings.push('token "' + key + '" dropped — unsafe value');
      else vars[key] = v;
    }
  });

  // 2) canonical tokenMap colours
  if (t.colors && typeof t.colors === 'object') {
    Object.keys(t.colors).forEach((role) => set(role, t.colors[role]));
  }

  // 3) derived --pai-* map (ui/runtime.js)
  if (t.css && typeof t.css === 'object') {
    Object.keys(t.css).forEach((key) => {
      const role = PAI_TO_COLOR[key];
      if (!role) return;
      const v = cssValue(t.css[key]);
      if (v == null) return;
      if (vars['--color-' + role] == null) vars['--color-' + role] = v;
    });
  }

  // 4) GLM OKLCH seed
  if (t.seed && typeof t.seed === 'object') {
    const derived = deriveFromSeed(t.seed);
    Object.keys(derived).forEach((role) => {
      if (vars['--color-' + role] == null) vars['--color-' + role] = derived[role];
    });
    if (vars['--color-radius'] == null && t.radius != null) {
      const r = cssValue(Number(t.radius) + 'px');
      if (r != null) vars['--color-radius'] = r;
    }
  }

  // 5) plain radius
  if (vars['--color-radius'] == null) {
    const r = cssValue(t.radius != null ? (isFinite(Number(t.radius)) ? Number(t.radius) + 'px' : t.radius) : null);
    if (r != null) vars['--color-radius'] = r;
  }

  // 6) fill every contract variable, then derive the two that are
  //    computed from another colour rather than stored.
  COLOR_VARS.forEach((role) => {
    if (vars['--color-' + role] == null) vars['--color-' + role] = FALLBACK_COLORS[role];
  });
  if (vars['--color-accent'] === FALLBACK_COLORS.accent && vars['--color-primary'] !== FALLBACK_COLORS.primary) {
    vars['--color-accent'] = vars['--color-primary'];
  }
  if (vars['--color-primary-soft'] === FALLBACK_COLORS['primary-soft'] && vars['--color-primary'] !== FALLBACK_COLORS.primary) {
    vars['--color-primary-soft'] = 'color-mix(in oklab, ' + vars['--color-primary'] + ' 18%, transparent)';
  }

  const decls = Object.keys(vars).map((key) => key + ':' + vars[key]).join(';') + ';';
  return { vars, decls, warnings };
}

/* ============================================================
   The instruction contract
   ============================================================ */

function tokenSummary(baseTokens) {
  const resolved = resolveColorTokens(baseTokens);
  return COLOR_VARS.map((role) => '  --color-' + role + ': ' + resolved.vars['--color-' + role] + ';').join('\n');
}

/**
 * buildSystemPrompt(baseTokens) -> string
 * The rules the model is held to, stated once and strictly. Every
 * prohibition here is enforced again in sanitizeCode() — the prompt
 * teaches, the parser enforces.
 */
function buildSystemPrompt(baseTokens) {
  return [
    'You are PallettAI Studio\'s widget compiler. You build ONE self-contained interactive',
    'lead-generation widget as a plain web component. The visitor sees it on a live client site.',
    '',
    'OUTPUT FORMAT — return exactly one JSON object and nothing else:',
    '{',
    '  "id": "kebab-case-id",',
    '  "title": "Human readable name",',
    '  "html": "markup for the widget",',
    '  "css": "stylesheet for the widget",',
    '  "js": "vanilla JavaScript behaviour"',
    '}',
    'No markdown fences. No commentary before or after the object.',
    '',
    'HARD RULES',
    '- Vanilla only. No React, Vue, Angular, Svelte, Solid, Preact, jQuery, Alpine, htmx,',
    '  Bootstrap or Tailwind. Zero dependencies, zero CDN <script>/<link> tags.',
    '- "html" must contain NO <script>, <style>, <link>, <iframe>, <object> or <embed> tags',
    '  and no inline on* handlers. CSS belongs in "css"; behaviour belongs in "js".',
    '- "css" must use the design tokens below (var(--color-primary), var(--color-surface), …).',
    '  Never hard-code a brand colour. A neutral fallback after the comma is fine,',
    '  e.g. var(--color-primary, #5b8cff).',
    '- "css" must be scoped with class names you define. The widget renders inside a Shadow DOM,',
    '  so page styles cannot leak in and your styles cannot leak out — but do not target :root,',
    '  body or bare element selectors that would fight the host page.',
    '- "js" is an IIFE body that runs once when the widget mounts. The locals `root`, `host` and',
    '  `shadow` are already in scope: `root` is the element containing "html" inside the shadow',
    '  root, `host` is the <pallet-widget> element, `shadow` is the ShadowRoot. Query within',
    '  `root`. Never use document.getElementById or document.querySelector for widget internals.',
    '- "js" must not use eval, new Function, document.write, import, require, cookies,',
    '  window.top, window.parent, or fetch to a third-party host.',
    '- Accessibility: real <label for> inputs, aria-live on results, keyboard operable controls,',
    '  visible focus styles, and a result rendered immediately (never a blank state that needs a',
    '  click to say anything).',
    '- Motion: animate transform and opacity only, and honour prefers-reduced-motion.',
    '- Copy must be specific and honest. No lorem ipsum, no invented prices or testimonials.',
    '',
    'DESIGN TOKENS (already defined on :host — use these names)',
    tokenSummary(baseTokens)
  ].join('\n');
}

function buildUserPrompt(prompt) {
  return [
    'Build this widget: ' + String(prompt == null ? '' : prompt).trim(),
    '',
    'Reply with the JSON object described in the system prompt and nothing else.'
  ].join('\n');
}

/* ============================================================
   Model output parsing
   ============================================================ */

function firstString() {
  for (let i = 0; i < arguments.length; i++) {
    const v = arguments[i];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return null;
}

// First balanced {...} in the text, respecting string literals so a
// brace inside "css" cannot close the envelope early.
function extractJsonObject(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function extractFences(text) {
  const out = { html: null, css: null, js: null };
  const re = /```([a-zA-Z0-9_+-]*)[ \t]*\r?\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text))) {
    const lang = String(m[1] || '').toLowerCase();
    const body = m[2];
    if (!body.trim()) continue;
    if (lang === 'js' || lang === 'javascript' || lang === 'mjs') { if (!out.js) out.js = body; continue; }
    if (lang === 'css' || lang === 'scss') { if (!out.css) out.css = body; continue; }
    if (lang === 'html' || lang === 'htm' || lang === 'markup') { if (!out.html) out.html = body; continue; }
    if (!lang) {
      if (out.html == null && /<[a-z]/i.test(body)) out.html = body;
      else if (out.js == null && /(function|=>|addEventListener|document\.|const |let |var )/.test(body)) out.js = body;
      else if (out.css == null && /\{/.test(body)) out.css = body;
    }
  }
  return out;
}

/**
 * parseModelOutput(raw) -> { ok, code: {html,css,js}, warnings } | { ok:false, error, warnings }
 * Three accepted shapes, in order of preference: a JSON envelope, fenced
 * code blocks, and — last — a bare markup response with no behaviour.
 */
function parseModelOutput(raw) {
  const warnings = [];
  let text = String(raw == null ? '' : raw).trim();
  if (!text) return { ok: false, error: 'the model returned an empty response', warnings };

  // one fence around the entire payload (```json … ```)
  const whole = text.match(/^```[a-zA-Z0-9_+-]*[ \t]*\r?\n([\s\S]*?)\r?\n?```$/);
  if (whole) text = whole[1].trim();

  const jsonText = extractJsonObject(text);
  if (jsonText) {
    let parsed = null;
    try { parsed = JSON.parse(jsonText); } catch (e) { parsed = null; }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const html = firstString(parsed.html, parsed.markup, parsed.template, parsed.body);
      const css = firstString(parsed.css, parsed.styles, parsed.style);
      const js = firstString(parsed.js, parsed.script, parsed.javascript, parsed.behavior);
      if (html != null || css != null || js != null) {
        return {
          ok: true,
          code: { html: html || '', css: css || '', js: js || '' },
          meta: { title: firstString(parsed.title, parsed.name) || '', id: firstString(parsed.id) || '' },
          warnings
        };
      }
      warnings.push('the model returned JSON without html/css/js keys — falling back to fenced extraction');
    } else if (jsonText) {
      warnings.push('the model response looked like JSON but did not parse');
    }
  }

  const fences = extractFences(text);
  if (fences.html != null || fences.css != null || fences.js != null) {
    return { ok: true, code: { html: fences.html || '', css: fences.css || '', js: fences.js || '' }, meta: { title: '', id: '' }, warnings };
  }

  if (/<(section|div|form|button|fieldset|article|main|input|select|p|h[1-6])\b/i.test(text)) {
    warnings.push('the model returned unfenced markup — used as HTML with no behaviour');
    return { ok: true, code: { html: text, css: '', js: '' }, meta: { title: '', id: '' }, warnings };
  }

  return {
    ok: false,
    error: 'the model response was not usable HTML/CSS/JS (no JSON envelope, no fenced blocks, no markup)',
    warnings
  };
}

/* ============================================================
   Code sanitising — the enforcement half of the prompt
   ============================================================ */

/*
  Quotes inside these literals are written as \x22 and \x27 on purpose. The
  renderer-globals gate strips comments and string bodies before it scans for
  Node-only globals, and its state machine reads a literal quote inside a
  REGEX as the start of a string — which desynchronises the rest of the file
  and reports string contents as live code. Escaped quotes keep this file
  scannable without weakening either check.
*/
const FRAMEWORK_RE = /(\bReact\s*\.\s*createElement|\bReactDOM\b|from\s*[\x22\x27]react[\x22\x27]|\bnew\s+Vue\b|\bVue\s*\.\s*createApp|createApp\s*\(|\bangular\s*\.\s*module|\bSvelte\b|\bAlpine\s*\.\s*data|\bhtmx\b|\bjQuery\b|\$\(\s*[\x22\x27])/;
const CDN_RE = /\b(unpkg\.com|jsdelivr\.net|cdnjs\.cloudflare\.com|cdn\.jsdelivr|bootstrapcdn|tailwindcss\.com)\b/i;
const HTML_FORBIDDEN_TAG_RE = /<\s*(iframe|object|embed|link|base)\b/i;
const INLINE_HANDLER_RE = /\son[a-z]+\s*=\s*(?:\x22[^\x22]*\x22|\x27[^\x27]*\x27|[^\s>]+)/i;

const JS_FORBIDDEN = [
  { re: /\beval\s*\(/, why: 'eval()' },
  { re: /\bnew\s+Function\s*\(/, why: 'new Function()' },
  { re: /(^|[^.\w$])Function\s*\(/, why: 'Function()' },
  { re: /\bdocument\s*\.\s*write(?:ln)?\s*\(/, why: 'document.write()' },
  { re: /(^|[^.\w$])import\s*\(/, why: 'dynamic import()' },
  { re: /(^|[^.\w$])import\s+[\w{*]/, why: 'an ES module import' },
  { re: /(^|[^.\w$])require\s*\(/, why: 'require()' },
  { re: /\bwindow\s*\.\s*(top|parent)\b/, why: 'window.top / window.parent access' },
  { re: /(^|[^.\w$])(top|parent)\s*\.\s*(location|document|postMessage)\b/, why: 'cross-frame access' },
  { re: /\bdocument\s*\.\s*cookie\b/, why: 'document.cookie access' },
  // A widget ships onto a client's public page, so anything that can TALK to
  // the network turns generated behaviour into a beacon: it could report who
  // visited, when, and with what referrer. The exported site has no CSP that
  // would stop a connect-src request, so the code itself has to refuse.
  // Any fetch, however it is reached: `window.fetch(`, `globalThis.fetch(` and
  // `self.fetch(` are the same call, and a rule that only matched a bare
  // `fetch(` would be walked straight past by writing the qualified form.
  { re: /\bfetch\s*\(/, why: 'fetch()' },
  { re: /\bXMLHttpRequest\b/, why: 'XMLHttpRequest' },
  { re: /\bWebSocket\b/, why: 'a WebSocket' },
  { re: /\bEventSource\b/, why: 'an EventSource' },
  { re: /\bsendBeacon\s*\(/, why: 'navigator.sendBeacon()' },
  { re: /\bimportScripts\s*\(/, why: 'importScripts()' },
  { re: /\bRTCPeerConnection\b/, why: 'a WebRTC connection' },
  { re: /\bserviceWorker\b/, why: 'a service worker' },
  { re: /\bnew\s+Worker\s*\(|\bSharedWorker\b/, why: 'a Web Worker' },
  // Dynamic script/frame creation is a remote-code-load path with no allowlist.
  { re: /createElement\s*\(\s*['"`](script|iframe|frame|object|embed)['"`]/i, why: 'a dynamically created script or frame' },
  { re: /\bset(Timeout|Interval)\s*\(\s*['"`]/, why: 'a timer running a string of code' },
  // Navigation: a widget must not be able to send a visitor somewhere else.
  // `location.hash =` is deliberately NOT here — an in-page anchor is how a
  // widget does tabs and accordions, and it cannot leave the page. Everything
  // else that assigns to location is refused, including the bare
  // `window.location =` form that a `.href` rule would miss.
  { re: /\blocation\s*\.\s*(assign|replace)\s*\(/, why: 'location.assign() / location.replace()' },
  { re: /\blocation\s*(\.\s*(?!hash\b)[A-Za-z_$][\w$]*|\[\s*['"](?!hash['"])[^'"]+['"]\s*\])\s*(=|\+=)/, why: 'a location assignment' },
  { re: /\blocation\s*=(?!=)/, why: 'a location assignment' },
  { re: /\bdocument\s*\.\s*location\b/, why: 'document.location' },
  { re: /\bwindow\s*\.\s*open\s*\(/, why: 'window.open()' },
  // Reading client-side state is personal data on a page we do not control.
  { re: /\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b|\bcaches\s*\./, why: 'browser storage access' },
  { re: /\bnavigator\s*\.\s*(geolocation|mediaDevices|clipboard|credentials)\b/, why: 'a device or credential API' },
  { re: /\bgetUserMedia\s*\(/, why: 'camera or microphone access' },
  { re: /\bdocument\s*\.\s*referrer\b/, why: 'document.referrer' }
];

function collect(code, max, label, warnings) {
  let value = String(code == null ? '' : code);
  if (!value) return '';
  if (value.length > max) {
    warnings.push(label + ' was truncated to ' + Math.round(max / 1024) + 'KB');
    value = value.slice(0, max);
  }
  return value;
}

/**
 * sanitizeCode(code) -> { ok, html, css, js, warnings } | { ok:false, error, warnings }
 * Folds <style>/<script> blocks the model embedded in the markup into
 * the css/js fields, strips javascript: URLs, then enforces the
 * framework/network/cross-frame prohibitions. A contract violation is
 * a hard failure (the caller renders a fallback UI); a recoverable
 * problem (JS that will not parse) degrades to a static widget.
 */
function sanitizeCode(code) {
  const warnings = [];
  const src = code || {};
  let html = collect(src.html, MAX_HTML, 'html', warnings);
  let css = collect(src.css, MAX_CSS, 'css', warnings);
  let js = collect(src.js, MAX_JS, 'js', warnings);

  // ---- fold embedded <style> / <script> out of the markup ----
  const styleRe = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
  html = html.replace(styleRe, (m, body) => {
    css += (css ? '\n' : '') + body;
    warnings.push('an embedded <style> block was moved into the widget stylesheet');
    return '';
  });

  const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let remote = '';
  html = html.replace(scriptRe, (m, attrs, body) => {
    if (/\bsrc\s*=/i.test(attrs || '')) { remote = String(attrs).trim(); return ''; }
    js += (js ? '\n' : '') + body;
    warnings.push('an embedded <script> block was moved into the widget behaviour');
    return '';
  });
  if (remote) {
    return { ok: false, error: 'the widget referenced an external script (' + truncate(remote, 80) + '); every widget must be dependency-free', warnings };
  }

  // ---- hard contract violations ----
  if (/<\s*script\b/i.test(html) || /<\s*style\b/i.test(html)) {
    return { ok: false, error: 'the widget markup contains an unclosed <script> or <style> tag', warnings };
  }
  if (HTML_FORBIDDEN_TAG_RE.test(html)) {
    return { ok: false, error: 'the widget markup embeds a framed or external resource (iframe/object/embed/link/base)', warnings };
  }
  if (INLINE_HANDLER_RE.test(html)) {
    return { ok: false, error: 'the widget markup used inline on* event handlers; behaviour must live in the js block', warnings };
  }
  if (FRAMEWORK_RE.test(html) || FRAMEWORK_RE.test(js)) {
    return { ok: false, error: 'the widget used a front-end framework; widgets must be dependency-free Vanilla JS', warnings };
  }
  if (CDN_RE.test(html) || CDN_RE.test(css) || CDN_RE.test(js)) {
    return { ok: false, error: 'the widget pointed at a CDN; widgets must be dependency-free', warnings };
  }
  // A remote url() in CSS is a request the visitor's browser makes on every
  // page view — a tracking pixel by another name. data: and blob: stay allowed.
  if (/(^|[^"')\s])url\(\s*['"]?(https?:)?\/\//i.test(css) || /@import\s+(url\()?['"]?(https?:)?\/\//i.test(css)) {
    return { ok: false, error: 'the widget stylesheet fetched a remote resource; widgets must be self-contained', warnings };
  }
  for (let i = 0; i < JS_FORBIDDEN.length; i++) {
    if (JS_FORBIDDEN[i].re.test(js)) {
      return { ok: false, error: 'the widget behaviour used ' + JS_FORBIDDEN[i].why + ', which is not allowed in an exported site', warnings };
    }
  }

  // ---- recoverable cleanups ----
  if (/javascript\s*:/i.test(html)) {
    html = html.replace(/javascript\s*:[^"')\s]*/gi, '#');
    warnings.push('a javascript: URL was neutralised');
  }
  css = css.replace(/javascript\s*:/gi, '');
  if (/expression\s*\(/i.test(css)) {
    css = css.replace(/expression\s*\([^)]*\)/gi, '');
    warnings.push('a CSS expression() was removed');
  }
  if (/<\/\s*(script|style)\b/i.test(css) || /<\/\s*(script|style)\b/i.test(js)) {
    return { ok: false, error: 'the widget code contained a tag that would break out of its injection point', warnings };
  }

  // ---- syntax check the behaviour ----
  if (js.trim()) {
    try {
      // Parse only — never called. A syntax error here would surface in a
      // client's console with no way for them to fix it.
      // eslint-disable-next-line no-new-func
      new Function(js);
    } catch (e) {
      warnings.push('the widget behaviour did not parse and was dropped: ' + truncate(e && e.message, 120));
      js = '';
    }
  }

  if (!html.trim()) {
    return { ok: false, error: 'the widget definition contained no usable markup', warnings };
  }
  return { ok: true, html: html.trim(), css: css.trim(), js: js.trim(), warnings };
}

/* ============================================================
   The component definition
   ============================================================ */

// Base styles for every widget's shadow root: the reset, the fallback
// card, and the reduced-motion neutraliser. Kept here (not in the
// generated CSS) so a widget can never lose its fallback by omission.
const ENGINE_CSS = [
  ':host{display:block;font:inherit;color:var(--color-text,inherit);}',
  ':host([hidden]){display:none;}',
  '*{box-sizing:border-box;}',
  '.pw-root{display:block;}',
  '.pw-fallback{display:grid;gap:.35rem;padding:1rem 1.1rem;border:1px dashed var(--color-border,rgba(127,127,127,.4));border-radius:var(--color-radius,12px);background:var(--color-surface,rgba(127,127,127,.06));color:var(--color-text,inherit);}',
  '.pw-fallback-title{font-size:.78rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--color-muted,#8a94a6);}',
  '.pw-fallback-note{font-size:.86rem;line-height:1.45;}',
  '@media (prefers-reduced-motion: reduce){:host *{animation-duration:.001ms !important;animation-iteration-count:1 !important;transition-duration:.001ms !important;scroll-behavior:auto !important;}}'
].join('\n');

/**
 * buildRuntimeSource(tag) -> string
 * The shared engine. Emitted once per page; a second copy is harmless
 * because the readiness flag makes it a no-op that only asks for a
 * re-mount, so the element is never defined twice.
 */
function buildRuntimeSource(tag) {
  const elementTag = normalizeTag(tag);
  return '/* ' + ENGINE_MARKER + ' v1 */\n'
    + '(function () {\n'
    + "  'use strict';\n"
    + '  var KEY = ' + JSON.stringify(REGISTRY_KEY) + ';\n'
    + '  var TAG = ' + JSON.stringify(elementTag) + ';\n'
    + '  var ALIAS = ' + JSON.stringify(ALIAS_TAG) + ';\n'
    + '  var ENGINE_CSS = ' + safeJson(ENGINE_CSS) + ';\n'
    + '  var registry = window[KEY] || (window[KEY] = {});\n'
    + '\n'
    + '  window.__pallettWidgetMountAll = function () {\n'
    + '    var nodes = document.querySelectorAll(TAG + (ALIAS === TAG ? "" : "," + ALIAS));\n'
    + '    for (var i = 0; i < nodes.length; i++) {\n'
    + "      if (nodes[i] && typeof nodes[i].__pallettMount === 'function') nodes[i].__pallettMount();\n"
    + '    }\n'
    + '  };\n'
    + '\n'
    + '  // One engine per page. A later copy only triggers a re-mount, which is\n'
    + '  // what lets a widget injected after the first one still render.\n'
    + '  if (window.__pallettWidgetEngineReady) {\n'
    + '    window.__pallettWidgetMountAll();\n'
    + '    return;\n'
    + '  }\n'
    + '  window.__pallettWidgetEngineReady = true;\n'
    + '  var hostSeq = 0;\n'
    + '\n'
    + '  function fallback(shadow, title, note) {\n'
    + "    var wrap = document.createElement('div');\n"
    + "    wrap.className = 'pw-fallback';\n"
    + "    wrap.setAttribute('data-pallett-fallback', '');\n"
    + "    wrap.setAttribute('role', 'status');\n"
    + "    var strong = document.createElement('strong');\n"
    + "    strong.className = 'pw-fallback-title';\n"
    + "    strong.textContent = String(title || 'Widget unavailable');\n"
    + "    var span = document.createElement('span');\n"
    + "    span.className = 'pw-fallback-note';\n"
    + '    span.textContent = String(note || "");\n'
    + '    wrap.appendChild(strong);\n'
    + '    wrap.appendChild(span);\n'
    + '    shadow.appendChild(wrap);\n'
    + '  }\n'
    + '\n'
    + '  class PallettWidget extends HTMLElement {\n'
    + '    static get observedAttributes() { return ["id"]; }\n'
    + '\n'
    + '    connectedCallback() { this.__pallettMount(); }\n'
    + '    attributeChangedCallback(name) { if (name === "id" && this.shadowRoot) this.__pallettMount(); }\n'
    + '    disconnectedCallback() { this.__pallettRev = null; }\n'
    + '\n'
    + '    __pallettFail(error) {\n'
    + '      if (!this.shadowRoot) return;\n'
    + "      fallback(this.shadowRoot, 'Widget error', 'This widget failed to start: ' + String((error && error.message) || error || 'unknown error'));\n"
    + '    }\n'
    + '\n'
    + '    __pallettMount() {\n'
    + '      var id = String(this.getAttribute("id") || "");\n'
    + '      if (!this.shadowRoot) this.attachShadow({ mode: "open" });\n'
    + '      var shadow = this.shadowRoot;\n'
    + '      var config = id ? registry[id] : null;\n'
    + '\n'
    + '      if (!config) {\n'
    + '        // Definitions are emitted immediately before </body>, so a placeholder\n'
    + '        // parsed earlier is upgraded before its config exists. Wait a bounded\n'
    + '        // number of ticks — but never forever: a retry with no ceiling is an\n'
    + '        // infinite timer on any page with a placeholder nobody defined, which\n'
    + '        // is exactly the mistake a missing registry entry produces.\n'
    + '        this.__pallettTries = (this.__pallettTries || 0) + 1;\n'
    + '        if (this.__pallettTries <= 20) {\n'
    + '          var self = this;\n'
    + '          setTimeout(function () { self.__pallettMount(); }, 0);\n'
    + '          return;\n'
    + '        }\n'
    + '        if (!shadow.querySelector("[data-pallett-fallback]")) {\n'
    + '          fallback(shadow, "Widget unavailable", "No definition was found for \\\"" + id + "\\\".");\n'
    + '        }\n'
    + '        return;\n'
    + '      }\n'
    + '      this.__pallettTries = 0;\n'
    + '      if (this.__pallettRev === config.rev && shadow.firstChild) return;\n'
    + '      this.__pallettRev = config.rev;\n'
    + '      while (shadow.firstChild) shadow.removeChild(shadow.firstChild);\n'
    + '\n'
    + '      var style = document.createElement("style");\n'
    + '      style.setAttribute("data-pallett-style", id);\n'
    + '      style.textContent = ":host{" + String(config.tokenDecls || "") + "}\\n" + ENGINE_CSS\n'
    + '        + (config.css ? "\\n" + String(config.css) : "");\n'
    + '      shadow.appendChild(style);\n'
    + '\n'
    + '      if (config.error) { fallback(shadow, "Widget unavailable", config.error); return; }\n'
    + '\n'
    + '      var root = document.createElement("div");\n'
    + '      root.className = "pw-root";\n'
    + '      root.setAttribute("data-pallett-root", "");\n'
    + '      root.innerHTML = String(config.html || "");\n'
    + '      shadow.appendChild(root);\n'
    + '\n'
    + '      if (!config.js) return;\n'
    + '\n'
    + '      // Behaviour runs as a real inline script element: allowed by the\n'
    + '      // "unsafe-inline" every Studio export already carries, and unlike\n'
    + '      // new Function it never needs "unsafe-eval".\n'
    + '      hostSeq += 1;\n'
    + '      var key = "h" + hostSeq;\n'
    + '      registry.__hosts = registry.__hosts || {};\n'
    + '      registry.__hosts[key] = this;\n'
    + '      var source = "(function(){"\n'
    + '        + "var R=window[" + JSON.stringify(KEY) + "];"\n'
    + '        + "var host=R&&R.__hosts?R.__hosts[" + JSON.stringify(key) + "]:null;"\n'
    + '        + "if(R&&R.__hosts)delete R.__hosts[" + JSON.stringify(key) + "];"\n'
    + '        + "if(!host||!host.shadowRoot)return;"\n'
    + '        + "var shadow=host.shadowRoot;"\n'
    + '        + "var root=shadow.querySelector(\\"[data-pallett-root]\\");"\n'
    + '        + "try{" + String(config.js) + "\\n}catch(e){host.__pallettFail(e);}"\n'
    + '        + "})();";\n'
    + '      try {\n'
    + '        var behavior = document.createElement("script");\n'
    + '        behavior.setAttribute("data-pallett-behavior", id);\n'
    + '        behavior.textContent = source;\n'
    + '        var head = document.head || document.documentElement;\n'
    + '        head.appendChild(behavior);\n'
    + '        if (behavior.parentNode) behavior.parentNode.removeChild(behavior);\n'
    + '      } catch (error) {\n'
    + '        this.__pallettFail(error);\n'
    + '      }\n'
    + '    }\n'
    + '  }\n'
    + '\n'
    + '  customElements.define(TAG, PallettWidget);\n'
    + '  if (ALIAS !== TAG) {\n'
    + '    class PallettWidgetAlias extends PallettWidget {}\n'
    + '    customElements.define(ALIAS, PallettWidgetAlias);\n'
    + '  }\n'
    + '\n'
    + '  window.__pallettWidgetMountAll();\n'
    + '})();';
}

function normalizeTag(tag) {
  const raw = String(tag == null ? '' : tag).trim().toLowerCase();
  if (!/^[a-z][a-z0-9._-]*-[a-z0-9._-]*$/.test(raw)) return DEFAULT_TAG;
  return raw;
}

function normalizeId(id) {
  const raw = String(id == null ? '' : id).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(raw)) return null;
  return raw;
}

function idFromPrompt(prompt) {
  const slug = String(prompt == null ? '' : prompt)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 44)
    .replace(/-+$/g, '');
  const body = slug.replace(/^[^a-z]+/, '');
  return normalizeId('widget-' + (body || 'app'));
}

function scriptBlock(attrs, js) {
  return '<script ' + attrs + '>\n' + js + '\n</script>';
}

/**
 * buildConfigSource(entry) -> string
 * The per-widget half of the definition: registers the widget under its
 * placeholder id and asks whatever engine is present to mount it. It never
 * defines the custom element, so N widgets share one class.
 */
function buildConfigSource(entry) {
  return '/* ' + CONFIG_MARKER + ' v1 */\n'
    + '(function () {\n'
    + "  'use strict';\n"
    + '  var REGISTRY = ' + JSON.stringify(REGISTRY_KEY) + ';\n'
    + '  var registry = window[REGISTRY] || (window[REGISTRY] = {});\n'
    + '  registry[' + JSON.stringify(entry.id) + '] = ' + safeJson({
      id: entry.id,
      tag: entry.tag,
      title: entry.title,
      rev: entry.rev,
      error: entry.error,
      html: entry.html,
      css: entry.css,
      js: entry.js,
      tokenDecls: entry.tokenDecls
    }) + ';\n'
    + '  if (typeof window.__pallettWidgetMountAll === "function") window.__pallettWidgetMountAll();\n'
    + '})();';
}

/**
 * compileWidget(input, opts)
 * @param {object} input  { id?, tag?, title?, code:{html,css,js} | html/css/js,
 *                           tokens?, tokenDecls?, error?, warnings?, script? }
 * @returns {{ ok, id, tag, rev, warnings, fallback, config, runtime,
 *             configScript, runtimeScript, script, kind }}
 *
 * `script` is the complete, self-contained component definition (config +
 * engine) — what generateWidget returns. `configScript`/`runtimeScript`
 * are the two halves the injector splits so a page defines the element
 * once no matter how many widgets it carries.
 */
function compileWidget(input, opts) {
  const o = opts || {};
  const src = (input && typeof input === 'object') ? input : {};
  const warnings = Array.isArray(src.warnings) ? src.warnings.map(String) : [];

  // A definition that was already compiled by this module is passed through
  // rather than recompiled, so a registry can hold generateWidget output.
  if (typeof src.script === 'string' && src.script.trim()) {
    const raw = src.script.trim();
    const unwrapped = unwrapScript(raw);
    const inner = unwrapped != null ? unwrapped : raw;
    if (unwrapped == null) warnings.push('a definition string without a <script> wrapper was used as-is');
    const selfContained = inner.indexOf(ENGINE_MARKER) !== -1;
    const familiar = inner.indexOf(CONFIG_MARKER) !== -1 || selfContained || inner.indexOf(REGISTRY_KEY) !== -1;
    if (familiar) {
      const tag = normalizeTag(src.tag || o.tag);
      const runtime = buildRuntimeSource(tag);
      const configScript = selfContained ? raw : scriptBlock('data-pallett-widget="' + (normalizeId(src.id) || '') + '"', inner);
      return {
        ok: true,
        kind: selfContained ? 'self' : 'config',
        id: normalizeId(src.id) || normalizeId(o.id) || '',
        tag,
        rev: src.rev || '',
        warnings,
        fallback: false,
        config: selfContained ? null : inner,
        runtime: selfContained ? null : runtime,
        configScript: selfContained ? null : configScript,
        runtimeScript: selfContained ? null : scriptBlock('data-pallett-widget-runtime', runtime),
        script: raw
      };
    }
  }

  const rawId = src.id != null ? src.id : (o.id != null ? o.id : idFromPrompt(src.title || ''));
  const id = normalizeId(rawId);
  if (!id) throw new Error('compileWidget: a usable widget id is required ([A-Za-z0-9_-]{1,64})');
  const tag = normalizeTag(src.tag || o.tag || DEFAULT_TAG);

  const tokenSet = src.tokenDecls != null
    ? { decls: String(src.tokenDecls), vars: {}, warnings: [] }
    : resolveColorTokens(src.tokens != null ? src.tokens : o.tokens);
  warnings.push.apply(warnings, tokenSet.warnings || []);

  let html = '';
  let css = '';
  let js = '';
  let error = src.error ? truncate(src.error, MAX_ERROR) : '';

  const hasCode = src.code || src.html != null || src.css != null || src.js != null;
  if (hasCode) {
    const cleaned = sanitizeCode(src.code || { html: src.html, css: src.css, js: src.js });
    warnings.push.apply(warnings, cleaned.warnings);
    if (!cleaned.ok) {
      error = error || truncate(cleaned.error, MAX_ERROR);
    } else {
      html = cleaned.html;
      css = cleaned.css;
      js = cleaned.js;
    }
  } else if (!error) {
    error = 'no widget definition was produced';
  }

  const meta = (src.meta && typeof src.meta === 'object') ? src.meta : {};
  const title = truncate(src.title || meta.title || '', MAX_TITLE);
  const rev = djb2([id, tag, error, html, css, js, tokenSet.decls]);

  const entry = {
    id, tag, title, rev,
    error: truncate(error, MAX_ERROR),
    html, css, js,
    tokenDecls: String(tokenSet.decls || '')
  };

  const config = buildConfigSource(entry);
  const runtime = buildRuntimeSource(tag);
  const runtimeScript = scriptBlock('data-pallett-widget-runtime', runtime);
  const configScript = scriptBlock('data-pallett-widget="' + id + '"', config);

  return {
    ok: !entry.error,
    kind: 'config',
    id,
    tag,
    rev,
    warnings,
    fallback: !!error,
    config,
    runtime,
    configScript,
    runtimeScript,
    // Complete and ready to inject: the widget's config followed by the
    // shared engine that mounts it.
    script: configScript + '\n' + runtimeScript
  };
}

function unwrapScript(value) {
  const text = String(value == null ? '' : value).trim();
  if (!/^<script\b/i.test(text)) return null;
  // A self-contained definition is TWO blocks (config then engine), so every
  // block's body is collected rather than greedy-matching one span, which
  // would leave the intervening tags in the result.
  const re = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi;
  const parts = [];
  let m;
  while ((m = re.exec(text))) parts.push(m[1]);
  return parts.length ? parts.join('\n') : null;
}

/* ============================================================
   The front door
   ============================================================ */

// ------------------------------------------------------------
// The LLM seam. The actual model call lives behind one function so a
// deployment can swap providers without touching the compiler. The default
// is the PLACEHOLDER: it reuses the same free, keyless text-model host the
// Studio already talks to for online copy (modules/ai.js onlinePolish), so
// the engine has a working end-to-end path before a paid provider is wired
// in. Replace it with setCompleter(fn) from the main process.
// ------------------------------------------------------------

const DEFAULT_MODEL_ENDPOINT = 'https://text.pollinations.ai/';
const DEFAULT_TIMEOUT_MS = 30000;

async function defaultCompleter(request) {
  const req = request || {};
  if (typeof fetch !== 'function') return null;
  const timeoutMs = Math.max(1000, Number(req.timeoutMs) || DEFAULT_TIMEOUT_MS);
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const url = DEFAULT_MODEL_ENDPOINT + encodeURIComponent([
      req.system || '',
      '',
      req.user || ''
    ].join('\n')) + '?json=true&model=openai&max_tokens=4000';
    const response = await fetch(url, {
      method: 'GET',
      signal: controller ? controller.signal : undefined,
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    try {
      const data = await response.json();
      return String(data.content || data.output || data.text || '');
    } catch (e) {
      return await response.text().catch(() => '');
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}

let registeredCompleter = null;

/**
 * setCompleter(fn) — install the LLM adapter once (used by the main
 * process). `fn({ system, user, prompt, tokens })` resolves to the raw
 * model text. Kept as a seam so this module never hardcodes a provider.
 */
function setCompleter(fn) {
  registeredCompleter = typeof fn === 'function' ? fn : null;
  return registeredCompleter;
}

function getCompleter() {
  return registeredCompleter || defaultCompleter;
}

/**
 * generateWidgetCompiled(prompt, baseTokens, opts) -> Promise<compile result>
 * The structured half of generateWidget: the same work, plus the warnings,
 * the rev hash and the split config/runtime scripts.
 *
 * @param {string} prompt      what the visitor-facing tool should do
 * @param {object} [baseTokens] GLM OKLCH seed / tokenMap / --pai-* map
 * @param {object} [opts]      { complete, model, id, title, tag, tokens, timeoutMs }
 */
async function generateWidgetCompiled(prompt, baseTokens, opts) {
  const o = opts || {};
  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw new TypeError('generateWidget: prompt must be a non-empty string');
  }

  const warnings = [];
  const id = normalizeId(o.id) || idFromPrompt(prompt);
  const tag = normalizeTag(o.tag || DEFAULT_TAG);

  let code = null;
  let error = '';
  let meta = { title: '', id: '' };

  // `opts.complete` wins, then an installed completer, then the built-in
  // placeholder — so the engine has a real path out of the box and a
  // deployment can still point it anywhere with setCompleter().
  const completer = (typeof o.complete === 'function' ? o.complete : null) || getCompleter();

  try {
    const raw = await completer({
      system: buildSystemPrompt(baseTokens),
      user: buildUserPrompt(prompt),
      prompt,
      tokens: baseTokens,
      model: o.model,
      timeoutMs: o.timeoutMs
    });
    if (raw == null) {
      error = 'the model returned nothing';
    } else {
      const parsed = parseModelOutput(raw);
      warnings.push.apply(warnings, parsed.warnings);
      if (parsed.ok) {
        code = parsed.code;
        meta = parsed.meta || meta;
      } else {
        error = parsed.error;
      }
    }
  } catch (e) {
    error = 'the model call failed: ' + truncate(e && e.message ? e.message : e, MAX_ERROR);
  }
  if (error) warnings.push(error);

  const compiled = compileWidget({
    id: normalizeId(o.id) || normalizeId(meta.id) || id,
    tag,
    title: o.title || meta.title || prompt,
    tokens: baseTokens,
    code,
    error,
    warnings
  }, { tag });

  if (compiled.fallback) warnings.push('a fallback widget was generated for "' + compiled.id + '"');
  compiled.meta = meta;
  return compiled;
}

/**
 * generateWidget(prompt, baseTokens, opts) -> Promise<string>
 *
 * The complete, stringified component definition (<script>…</script>),
 * ready for injection. Any failure on the LLM's side — an unreachable
 * model, malformed output, a forbidden framework — resolves to a
 * definition whose Shadow DOM renders an honest fallback card. It rejects
 * only for programmer error (a missing prompt), because a thrown error
 * here would abort a whole export for one bad sentence.
 */
async function generateWidget(prompt, baseTokens, opts) {
  const compiled = await generateWidgetCompiled(prompt, baseTokens, opts);
  return compiled.script;
}

const WidgetGenerator = {
  DEFAULT_TAG,
  ALIAS_TAG,
  REGISTRY_KEY,
  ENGINE_MARKER,
  CONFIG_MARKER,
  COLOR_VARS,
  ENGINE_CSS,
  buildSystemPrompt,
  buildUserPrompt,
  parseModelOutput,
  sanitizeCode,
  compileWidget,
  buildConfigSource,
  buildRuntimeSource,
  resolveColorTokens,
  deriveFromSeed,
  normalizeId,
  normalizeTag,
  idFromPrompt,
  unwrapScript,
  scriptBlock,
  safeJson,
  htmlEscape,
  oklch,
  defaultCompleter,
  DEFAULT_MODEL_ENDPOINT,
  DEFAULT_TIMEOUT_MS,
  setCompleter,
  getCompleter,
  generateWidgetCompiled,
  generateWidget
};

if (typeof module !== 'undefined' && module.exports) module.exports = WidgetGenerator;
if (typeof window !== 'undefined') window.WidgetGenerator = WidgetGenerator;

})();
