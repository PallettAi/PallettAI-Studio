'use strict';
// ============================================================
// PallettAI Studio — CSP policy synthesizer & SRI enforcer
// Locks a static export down against XSS/code injection: one
// strict, deterministic Content-Security-Policy built from the
// site's ACTUAL third-party dependencies (analytics, forms,
// widgets), a <meta> carrier for hosts where HTTP headers are not
// configurable, and sha384 Subresource Integrity on every matched
// external script/stylesheet.
// ------------------------------------------------------------
//   1. generateStrictCSP(options) → policy string.
//      options.analytics = 'plausible'|'fathom'|'simpleanalytics'|
//        'umami'|'ga'        → script+connect origins
//      options.forms = 'web3forms'|'formspree'|'formtorch'|
//        'netlify'           → connect + form-action origins
//      options.widgets = 'youtube'|'vimeo'|'stripe'|'maps'
//        → per-directive script/frame/img/connect origins
//      options.scriptSrc/styleSrc/imgSrc/connectSrc/fontSrc/
//        frameSrc            → extra origin arrays
//      options.scriptHashes/styleHashes → 'sha384-…' sources
//      options.unsafeInlineStyle / unsafeInlineScript / unsafeEval
//        (all default FALSE — 'unsafe-inline' never enters
//        script-src unless asked for explicitly)
//      options.unsafeHashes (default FALSE) → adds the 'unsafe-hashes'
//        keyword to a directive that already carries hash sources,
//        which is the ONLY way a hash can permit an inline event
//        handler attribute (onload=…) or a style= attribute
//      options.upgradeInsecureRequests (default TRUE)
//      options.frameAncestors (default "'none'"), options.reportUri
//      Unknown preset keys and malformed origins throw bad_input.
//   2. injectSRIAndCSPHeaders(htmlContent, shaHashes, options)
//      → {html, meta, policy, inlineHashes, inlineAttributes, sri}
//      · hashes EVERY non-empty inline <script>/<style> block with
//        sha384 and puts those hashes into the meta policy — this
//        is what makes strict CSP compatible with inlined code
//      · ALSO hashes inline event handler attributes (onload=…) and
//        style= attributes and allows them via 'unsafe-hashes' +
//        their exact digests. An element hash cannot cover an
//        ATTRIBUTE: without this, a page that async-loads its font
//        sheet with onload="this.media='all'" ships a policy that
//        blocks its own handler, the sheet stays media="print" and
//        the site renders in fallback fonts
//      · attaches integrity="sha384-…" to external
//        <script src>/<link rel=stylesheet> tags whose URL
//        matches a shaHashes key (existing integrity is replaced,
//        never duplicated)
//      · injects one <meta http-equiv="Content-Security-Policy">
//        immediately after <head> — REPLACING any existing one,
//        so regenerating a page twice cannot stack policies
//      shaHashes: {urlSubstring: hash} where hash may be raw
//      base64, raw sha384 HEX (96 chars) or already-prefixed
//      'sha384-…'.
//   3. sha384Hash(content) → 'sha384-<base64>' — the same helper
//      the inline path and tests both use (one hash definition).
//
// ---- what this file guarantees ----------------------------------
// 1. NO 'unsafe-inline' IN script-src BY DEFAULT. Inline code is
//    allowed by HASH instead, computed from the exact bytes in the
//    document — editing the script without regenerating the policy
//    breaks the page open, not closed. Inline ATTRIBUTES (onload=…,
//    style=…) are hashed the same way and carried by 'unsafe-hashes',
//    which still permits nothing beyond the bytes actually present.
// 2. ONE META TAG, EVER. Injection is idempotent: a pre-existing
//    CSP meta (double- or single-quoted) is removed first, so
//    repeated builds cannot accumulate conflicting policies —
//    browsers enforce the FIRST CSP they see, so stacking is a
//    silent correctness bug, not a hardening.
// 3. POLICY ORIGINS ARE VALIDATED AT BUILD TIME: an unquoted
//    origin, a stray header or an unknown preset throws here
//    instead of shipping a policy the browser ignores entirely
//    (CSP failures are silent by design — one typo means zero
//    protection).
// 4. DETERMINISTIC OUTPUT: directives emit in a fixed order with
//    insertion-ordered origins — same options, byte-identical
//    policy (safe for CI drift checks).
// ============================================================

const crypto = require('crypto');

function fail(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

const asList = (v) => (v == null ? [] : (Array.isArray(v) ? v : [v]));

// ============================================================
// Third-party presets — per-directive origin sets
// ============================================================

const ANALYTICS_PRESETS = {
  plausible: {
    script: ['https://plausible.io'],
    connect: ['https://plausible.io']
  },
  fathom: {
    script: ['https://cdn.usefathom.com'],
    connect: ['https://cdn.usefathom.com']
  },
  simpleanalytics: {
    script: ['https://scripts.simpleanalyticscdn.com'],
    connect: ['https://queue.simpleanalyticscdn.com']
  },
  umami: {
    script: ['https://analytics.umami.is'],
    connect: ['https://analytics.umami.is']
  },
  ga: {
    script: ['https://www.google-analytics.com', 'https://www.googletagmanager.com'],
    connect: ['https://www.google-analytics.com', 'https://analytics.google.com'],
    img: ['https://www.google-analytics.com', 'https://www.google.com']
  }
};

const FORM_PRESETS = {
  web3forms: { connect: ['https://api.web3forms.com'], action: ['https://api.web3forms.com'] },
  formspree: { connect: ['https://formspree.io'], action: ['https://formspree.io'] },
  formtorch: { connect: ['https://formtorch.com'], action: ['https://formtorch.com'] },
  netlify: { connect: [], action: [] } // same-origin endpoint
};

const WIDGET_PRESETS = {
  youtube: {
    script: ['https://www.youtube.com', 'https://www.sandbox.youtube.com'],
    frame: ['https://www.youtube.com', 'https://www.youtube-nocookie.com']
  },
  vimeo: { script: ['https://player.vimeo.com'], frame: ['https://player.vimeo.com'] },
  stripe: {
    script: ['https://js.stripe.com'],
    frame: ['https://js.stripe.com'],
    connect: ['https://api.stripe.com']
  },
  maps: {
    script: ['https://maps.googleapis.com'],
    img: ['https://maps.gstatic.com', 'https://maps.googleapis.com'],
    connect: ['https://maps.googleapis.com']
  }
};

const ORIGIN_RE = /^(?:'(?:self|none|unsafe-inline|unsafe-eval|strict-dynamic|unsafe-hashes)'|https?:\/\/[^\s]+|(?:data|blob):[^\s]*|sha(?:256|384|512)-[A-Za-z0-9+/=]+)$/;

function assertOrigin(token, where) {
  const t = String(token);
  if (!ORIGIN_RE.test(t)) {
    throw fail('bad_input', 'malformed CSP origin in ' + where + ': ' + JSON.stringify(t)
      + " (quote keywords like 'self', use full https:// origins)");
  }
  return t;
}

function preset(table, name, allowed, where) {
  if (name == null) return {};
  const key = String(name).toLowerCase().trim();
  const entry = table[key];
  if (!entry) {
    throw fail('bad_input', 'unknown ' + where + ' preset ' + JSON.stringify(String(name))
      + ' — use one of: ' + allowed.join(', '));
  }
  return entry;
}

function collect(names, table, allowed, where) {
  const out = { script: [], connect: [], frame: [], img: [], action: [] };
  asList(names).forEach((n) => {
    const p = preset(table, n, allowed, where);
    ['script', 'connect', 'frame', 'img', 'action'].forEach((k) => {
      (p[k] || []).forEach((o) => out[k].push(o));
    });
  });
  return out;
}

const dedupe = (arr) => {
  const seen = new Set();
  const out = [];
  arr.forEach((v) => {
    if (!seen.has(v)) { seen.add(v); out.push(v); }
  });
  return out;
};

// ============================================================
// generateStrictCSP
// ============================================================

function generateStrictCSP(options) {
  const o = options || {};
  if (o.analytics != null && typeof o.analytics !== 'string' && !Array.isArray(o.analytics)) {
    throw fail('bad_input', 'options.analytics must be a preset name or array of names');
  }

  const analytics = collect(o.analytics, ANALYTICS_PRESETS,
    Object.keys(ANALYTICS_PRESETS), 'analytics');
  const forms = collect(o.forms, FORM_PRESETS, Object.keys(FORM_PRESETS), 'forms');
  const widgets = collect(o.widgets, WIDGET_PRESETS, Object.keys(WIDGET_PRESETS), 'widgets');

  // 'unsafe-hashes' is only meaningful where a hash source already
  // exists, so it is added per-directive and stays inert otherwise.
  const scriptHashes = asList(o.scriptHashes);
  const styleHashes = asList(o.styleHashes);
  const scriptSrc = ["'self'"]
    .concat(analytics.script, widgets.script, asList(o.scriptSrc))
    .concat(o.unsafeInlineScript ? ["'unsafe-inline'"] : [])
    .concat(o.unsafeEval ? ["'unsafe-eval'"] : [])
    .concat(o.unsafeHashes && scriptHashes.length ? ["'unsafe-hashes'"] : [])
    .concat(scriptHashes);
  const styleSrc = ["'self'"]
    .concat(o.unsafeInlineStyle ? ["'unsafe-inline'"] : [])
    .concat(o.unsafeHashes && styleHashes.length ? ["'unsafe-hashes'"] : [])
    .concat(asList(o.styleSrc), styleHashes);
  const imgSrc = ["'self'", 'data:', 'blob:']
    .concat(analytics.img, widgets.img, asList(o.imgSrc));
  const fontSrc = ["'self'", 'data:'].concat(asList(o.fontSrc));
  const connectSrc = ["'self'"]
    .concat(analytics.connect, forms.connect, widgets.connect, asList(o.connectSrc));
  const frameSrc = ["'self'"].concat(widgets.frame, asList(o.frameSrc));
  const formAction = ["'self'"].concat(forms.action, asList(o.formAction));

  const directives = [
    ['default-src', ["'self'"]],
    ['script-src', scriptSrc],
    ['style-src', styleSrc],
    ['img-src', imgSrc],
    ['font-src', fontSrc],
    ['connect-src', connectSrc],
    ['form-action', formAction],
    ['frame-src', frameSrc],
    ['base-uri', ["'self'"]],
    ['object-src', ["'none'"]],
    ['frame-ancestors', asList(o.frameAncestors).length
      ? asList(o.frameAncestors) : ["'none'"]]
  ];
  if (o.reportUri != null) {
    directives.push(['report-uri', [assertOrigin(o.reportUri, 'reportUri')]]);
  }

  const lines = directives.map(([name, tokens]) => {
    const clean = dedupe(tokens).map((t) => assertOrigin(t, name));
    return clean.length ? name + ' ' + clean.join(' ') : name;
  });
  if (o.upgradeInsecureRequests !== false) lines.push('upgrade-insecure-requests');
  return lines.join('; ');
}

// ============================================================
// sha384 helper — one hash definition for CSP sources and SRI
// ============================================================

function sha384Hash(content) {
  return 'sha384-' + crypto.createHash('sha384')
    .update(String(content == null ? '' : content), 'utf8').digest('base64');
}

function normalizeSriValue(value) {
  const v = String(value == null ? '' : value).trim();
  if (!v) return '';
  if (/^sha(256|384|512)-/.test(v)) return v;
  if (/^[0-9a-f]{96}$/i.test(v)) return 'sha384-' + v; // hex form, per SRI spec
  return 'sha384-' + v;
}

const escAttr = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function buildMetaTag(policy) {
  return '<meta http-equiv="Content-Security-Policy" content="' + escAttr(policy) + '">';
}

// ============================================================
// Inline ATTRIBUTE hashing — the case an element hash cannot cover
// ============================================================

// A loose /\son\w+=/ would match innocent attributes (one=, only=),
// so only names that are genuinely event handlers are accepted.
const HANDLER_EVENTS = new Set([
  'abort', 'afterprint', 'animationcancel', 'animationend', 'animationiteration', 'animationstart',
  'beforeinput', 'beforeprint', 'beforetoggle', 'beforeunload', 'blur', 'canplay', 'canplaythrough',
  'change', 'click', 'close', 'contextmenu', 'copy', 'cuechange', 'cut', 'dblclick', 'drag', 'dragend',
  'dragenter', 'dragleave', 'dragover', 'dragstart', 'drop', 'durationchange', 'ended', 'error',
  'focus', 'focusin', 'focusout', 'formdata', 'hashchange', 'input', 'invalid', 'keydown', 'keypress',
  'keyup', 'load', 'loadeddata', 'loadedmetadata', 'loadstart', 'message', 'mousedown', 'mouseenter',
  'mouseleave', 'mousemove', 'mouseout', 'mouseover', 'mouseup', 'offline', 'online', 'open', 'pagehide',
  'pageshow', 'paste', 'pause', 'play', 'playing', 'pointercancel', 'pointerdown', 'pointerenter',
  'pointerleave', 'pointermove', 'pointerout', 'pointerover', 'pointerup', 'popstate', 'progress',
  'ratechange', 'reset', 'resize', 'scroll', 'scrollend', 'search', 'seeked', 'seeking', 'select',
  'slotchange', 'stalled', 'storage', 'submit', 'suspend', 'timeupdate', 'toggle', 'touchcancel',
  'touchend', 'touchmove', 'touchstart', 'transitioncancel', 'transitionend', 'transitionrun',
  'transitionstart', 'unhandledrejection', 'unload', 'volumechange', 'waiting', 'wheel'
]);

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };

// CSP hashes the handler source as the BROWSER sees it, so entities
// must be decoded before hashing or the digest never matches.
function unescapeAttribute(value) {
  return String(value).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (full, body) => {
    if (body.charAt(0) === '#') {
      const hex = /^#[xX]/.test(body);
      const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return full;
      try { return String.fromCodePoint(code); } catch (e) { return full; }
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named == null ? full : named;
  });
}

/*
  Find the inline event handlers and style attributes in a document
  and hash their sources. The scan blanks <script> and <style> bodies
  first, so a handler mentioned inside JavaScript (a string like
  "onclick=") is not mistaken for markup.
*/
function scanInlineAttributes(html) {
  const src = String(html == null ? '' : html)
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ');

  const handlers = [];
  const styles = [];
  const seen = new Set();
  let m;

  const HANDLER_RE = /\son([a-z]+)\s*=\s*("([^"]*)"|'([^']*)')/gi;
  while ((m = HANDLER_RE.exec(src))) {
    const event = m[1].toLowerCase();
    if (!HANDLER_EVENTS.has(event)) continue;
    const raw = m[3] != null ? m[3] : m[4];
    if (!raw.trim()) continue; // an empty handler cannot run
    const code = unescapeAttribute(raw);
    const hash = sha384Hash(code);
    const key = 'script:' + hash;
    if (seen.has(key)) continue;
    seen.add(key);
    handlers.push({ event: 'on' + event, code, hash });
  }

  const STYLE_RE = /\sstyle\s*=\s*("([^"]*)"|'([^']*)')/gi;
  while ((m = STYLE_RE.exec(src))) {
    const raw = m[2] != null ? m[2] : m[3];
    if (!raw.trim()) continue;
    const code = unescapeAttribute(raw);
    const hash = sha384Hash(code);
    const key = 'style:' + hash;
    if (seen.has(key)) continue;
    seen.add(key);
    styles.push({ attribute: 'style', code, hash });
  }

  return { handlers, styles };
}

// ============================================================
// injectSRIAndCSPHeaders
// ============================================================

function injectSRIAndCSPHeaders(htmlContent, shaHashes, options) {
  const o = options || {};
  if (typeof htmlContent !== 'string' || !htmlContent) {
    throw fail('bad_input', 'htmlContent must be a non-empty string');
  }
  if (shaHashes != null && (typeof shaHashes !== 'object' || Array.isArray(shaHashes))) {
    throw fail('bad_input', 'shaHashes must be an object of {urlSubstring: hash}');
  }
  const hashMap = shaHashes || {};
  Object.keys(hashMap).forEach((k) => {
    if (!normalizeSriValue(hashMap[k])) throw fail('bad_input', 'empty hash for ' + JSON.stringify(k));
  });

  let html = htmlContent;

  // ---- 1. sha384 every non-empty inline script/style block ----
  const inlineHashes = { scripts: [], styles: [] };
  html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (full, attrs, body) => {
    if (/\ssrc\s*=/i.test(attrs)) return full; // external → integrity path
    if (!body.trim()) return full;
    inlineHashes.scripts.push(sha384Hash(body));
    return full;
  });
  html = html.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (full, _attrs, body) => {
    if (!body.trim()) return full;
    inlineHashes.styles.push(sha384Hash(body));
    return full;
  });

  // ---- 2. SRI on matching external scripts + stylesheets ----
  const sri = [];
  const applySri = (tag, url, attrsRaw) => {
    let matchedKey = '';
    Object.keys(hashMap).forEach((k) => { if (!matchedKey && url.indexOf(k) > -1) matchedKey = k; });
    if (!matchedKey) return tag;
    const integrity = normalizeSriValue(hashMap[matchedKey]);
    const cleaned = attrsRaw
      .replace(/\s*integrity\s*=\s*("[^"]*"|'[^']*')/gi, '')   // replace, never stack
      .replace(/\s+$/, '');
    sri.push({ url, integrity });
    return tag.slice(0, tag.indexOf(attrsRaw)) + cleaned + ' integrity="' + integrity + '">'
      .slice(0);
  };

  html = html.replace(/<script\b([^>]*)>/gi, (full, attrsRaw) => {
    const m = /\ssrc\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrsRaw);
    if (!m) return full;
    const url = m[2] != null ? m[2] : m[3];
    const patched = applySri(full, url, attrsRaw);
    return patched;
  });
  html = html.replace(/<link\b([^>]*)>/gi, (full, attrsRaw) => {
    const rel = /\srel\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrsRaw);
    if (!rel) return full;
    const relVal = (rel[2] != null ? rel[2] : rel[3]) || '';
    if (!/(^|\s)stylesheet(\s|$)/i.test(relVal)) return full;
    const h = /\shref\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrsRaw);
    if (!h) return full;
    const url = h[2] != null ? h[2] : h[3];
    return applySri(full, url, attrsRaw);
  });

  // ---- 2b. inline handler / style ATTRIBUTES ----
  // An element hash allows a <script> element; it cannot allow an
  // attribute. onload="this.media='all'" needs the handler's own
  // digest plus the 'unsafe-hashes' keyword, or the browser refuses
  // the handler and the font sheet never leaves media="print".
  const inlineAttributes = scanInlineAttributes(html);

  // ---- 3. policy: caller base (or strict default) + inline hashes ----
  const cspOptions = Object.assign({}, o.csp || {});
  if (inlineAttributes.handlers.length || inlineAttributes.styles.length) {
    cspOptions.unsafeHashes = true;
  }
  cspOptions.scriptHashes = dedupe(
    asList(cspOptions.scriptHashes)
      .concat(inlineHashes.scripts, inlineAttributes.handlers.map((h) => h.hash)));
  cspOptions.styleHashes = dedupe(
    asList(cspOptions.styleHashes)
      .concat(inlineHashes.styles, inlineAttributes.styles.map((s) => s.hash)));
  const policy = o.policy
    ? String(o.policy)
    : generateStrictCSP(cspOptions);

  // ---- 4. ONE meta tag, idempotently placed after <head> -------
  // stacking is a silent failure mode: browsers enforce the first
  // CSP they see and ignore later ones entirely
  const before = html;
  html = html.replace(/<meta\s+http-equiv\s*=\s*("Content-Security-Policy"|'Content-Security-Policy')[^>]*>/gi, '');
  const removedMeta = before !== html;

  const metaTag = buildMetaTag(policy);
  let injected = false;
  if (/<head\b[^>]*>/i.test(html)) {
    html = html.replace(/(<head\b[^>]*>)/i, (full) => {
      if (injected) return full;
      injected = true;
      return full + metaTag;
    });
  } else if (/<\/head>/i.test(html)) {
    html = html.replace(/<\/head>/i, () => {
      injected = true;
      return metaTag + '</head>';
    });
  } else {
    throw fail('bad_input', 'html must contain <head> or </head> to carry a CSP meta tag');
  }
  if (!injected) throw fail('bad_input', 'failed to place CSP meta tag');

  return {
    html,
    meta: metaTag,
    policy,
    inlineHashes,
    inlineAttributes,
    sri,
    replacedMeta: removedMeta
  };
}

module.exports = {
  ANALYTICS_PRESETS,
  FORM_PRESETS,
  WIDGET_PRESETS,
  HANDLER_EVENTS,
  generateStrictCSP,
  sha384Hash,
  unescapeAttribute,
  buildMetaTag,
  scanInlineAttributes,
  injectSRIAndCSPHeaders
};
