'use strict';

/*
  ============================================================
  SecuritySRI — integrity attributes and a CSP that can be strict
  ------------------------------------------------------------
  Two facts checked before writing this.

  The app's own shell loads 95 external subresources (`styles.css`,
  `data/*.js`, `modules/*`), so SRI has a real subject here. The
  *generated* sites mostly do not: their whole pitch is self-contained
  HTML/CSS/JS, so this is a shell-hardening tool that also covers the
  one external stylesheet the builder does emit.

  And a wrong integrity attribute is worse than no integrity
  attribute. SRI is fail-closed by design: get the digest wrong and
  the browser refuses the asset, so a site that had no SRI at all
  loads fine and a site with a stale digest is blank. Every rule below
  follows from that.

  Four rules the implementation keeps:

  1. Never invent a digest. If no hash was supplied for a URL, the tag
     is left alone and reported. Guessing, or hashing the wrong phase
     of a build, produces a page that cannot load its own JavaScript.

  2. Never hash a user-agent-dependent resource. The builder emits a
     Google Fonts `<link rel="stylesheet">`, and that response differs
     per browser, so a digest computed here can only ever be wrong on
     somebody's machine. Cross-origin UA-dependent stylesheets are
     skipped by name, with the reason recorded.

  3. A mismatch is reported, not overwritten. If a tag already carries
     an `integrity` that disagrees with the hash we were given, that is
     a signal — a stale build, or an asset swapped after hashing — and
     silently "fixing" it destroys the evidence.

  4. `crossorigin="anonymous"` is required for SRI to apply at all.
     Without it the browser does not perform the check, so a tag that
     gains an integrity attribute and keeps `crossorigin` absent has
     gained nothing but the appearance of security.

  The strict CSP is the other half, and it has an ordering constraint
  worth stating plainly: inline script hashes are computed over the
  script *as it will be served*, so a CSP built before minification
  describes code that no longer exists and blocks the site it was
  meant to protect. `hashInlineScripts` therefore takes the final
  HTML, and `buildStrictCSPHeader` warns when hashes are missing for
  inline scripts that are present.

  ---- meta or header, and why this file refuses the unsafe case ----

  `generateStrictCSP` synthesises a policy from the site's *declared*
  dependencies (analytics, forms, widgets) rather than from four hosts
  spelled out at a call site. Two CSP rules decide whether it may be
  delivered as a `<meta http-equiv>`:

  1. A nonce or hash in `script-src` makes the browser IGNORE
     `'unsafe-inline'` in that same list. So a policy carrying inline
     script hashes does NOT permit inline event handlers — it blocks
     them, and the only way back is `'unsafe-hashes'` plus a hash per
     handler. That matters here because the builder emits
     `onload="this.media='all'"` to async-load font stylesheets: under
     a hash-only policy the handler never runs, the sheet keeps
     `media="print"`, and the site silently renders in fallback fonts.
     This is the reason `modules/builder.js` deliberately ships a
     *commented* CSP starter instead of a meta tag.

  2. `frame-ancestors`, `report-uri`, `report-to` and `sandbox` are
     ignored in a `<meta>` policy by specification. A meta tag that
     appears to set `frame-ancestors 'none'` sets nothing, so those
     directives are stripped (and reported) rather than shipped as
     security theatre.

  `injectCSPMeta` therefore refuses — with a reason — when the policy
  would break the document it is protecting, and `injectSRIAndCSPHeaders`
  reports that refusal instead of emitting a page that cannot load its
  own fonts. The header form is the recommended delivery path, and it
  has no such limits.
  ============================================================
*/

let nodeCrypto = null;
// Guarded rather than try/catch on purpose: this file also loads as a plain
// renderer <script>, where `require` does not exist at all, and a bare call
// would throw a ReferenceError before the catch could ever run.
if (typeof require === 'function') {
  try { nodeCrypto = require('crypto'); } catch (e) { nodeCrypto = null; }
}

const SecuritySRI = (() => {

  const ALGORITHMS = { sha256: 'sha256', sha384: 'sha384', sha512: 'sha512' };

  // Responses that differ per user agent cannot carry a fixed digest.
  const UA_DEPENDENT = [
    /^https?:\/\/fonts\.googleapis\.com/i,
    /^https?:\/\/fonts\.googleusercontent\.com/i
  ];

  function isUaDependent(url) {
    return UA_DEPENDENT.some((rx) => rx.test(String(url || '')));
  }

  function isCrossOrigin(url, base) {
    const s = String(url || '');
    if (/^(https?:)?\/\//i.test(s) || /^[a-z][a-z0-9+.-]*:/i.test(s)) {
      if (/^data:/i.test(s)) return false;
      return true;
    }
    return false;
  }

  /*
    The digest exactly as the `integrity` attribute wants it:
    `<algorithm>-<base64 of the raw bytes>`. Note the digest is over
    the *bytes*, not the text — hashing a decoded string and serving
    UTF-8 gives a different answer for any file with a multi-byte
    character.
  */
  /*
    Portable SHA-256, for the renderer.

    The export pass runs in the page, where Node's crypto does not exist and
    crypto.subtle is asynchronous while every caller here is synchronous — so
    sha256 is implemented directly. That is the algorithm the product needs
    there: it is what a CSP script-src hash is, and the strict export pass asks
    for exactly that.

    sha384 and sha512 are NOT implemented here, on purpose. They are the
    64-bit SHA-2 family with a different state, different block size and
    different constants, and a 32-bit imitation of them produces a digest that
    looks right and is wrong — which for an integrity attribute is worse than no
    attribute at all. Those two are used for SRI on EXTERNAL subresources, which
    a self-contained export does not have and the Node CLI build already hashes
    with the real thing. A caller that asks for one of them without Node crypto
    is told so, rather than handed a plausible lie.

    The round constants are derived from the primes rather than pasted as hex
    literals: they are the fractional parts of the cube roots (K) and the square
    roots (the initial hash) scaled by 2^32, which is exact in a double at this
    magnitude. scripts/strict-export-smoke.js pins the table against Node crypto
    across lengths and scripts, so a drift here fails the gate.
  */
  const PORTABLE_ALGOS = { sha256: { outBytes: 32, k: 64, rotr: [2, 13, 22], s1: [6, 11, 25] } };

  function firstPrimes(count) {
    const out = [];
    for (let n = 2; out.length < count; n++) {
      let prime = true;
      for (let i = 0; i < out.length && out[i] * out[i] <= n; i++) if (n % out[i] === 0) { prime = false; break; }
      if (prime) out.push(n);
    }
    return out;
  }

  const SHA_PRIMES = firstPrimes(64);
  const SHA_TABLES = {};
  Object.keys(PORTABLE_ALGOS).forEach((name) => {
    const spec = PORTABLE_ALGOS[name];
    const k = new Uint32Array(spec.k);
    for (let i = 0; i < spec.k; i++) k[i] = Math.floor(Math.cbrt(SHA_PRIMES[i]) * 4294967296) >>> 0;
    const h = new Uint32Array(8);
    for (let i = 0; i < 8; i++) h[i] = Math.floor(Math.sqrt(SHA_PRIMES[i]) * 4294967296) >>> 0;
    SHA_TABLES[name] = { k, h, spec };
  });

  const rotr32 = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0;

  function sha2(bytes, algo) {
    const table = SHA_TABLES[algo];
    if (!table) return null;
    const k = table.k;
    const spec = table.spec;
    // A COPY of the initial hash: the round adds into this array, so sharing the
    // table's own array would carry the previous message's state into this one.
    const h = Uint32Array.from(table.h);
    const block = 64;
    const padded = new Uint8Array((((bytes.length + 9 + block - 1) / block) | 0) * block);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    const view = new DataView(padded.buffer);
    const hi = Math.floor(bytes.length / 536870912); // high word of the bit length
    const lo = (bytes.length << 3) >>> 0;
    view.setUint32(padded.length - 8, hi, false);
    view.setUint32(padded.length - 4, lo, false);
    const w = new Uint32Array(64);
    for (let off = 0; off < padded.length; off += block) {
      for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
      for (let i = 16; i < 64; i++) {
        const s0 = (rotr32(w[i - 15], 7) ^ rotr32(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0;
        const s1 = (rotr32(w[i - 2], 17) ^ rotr32(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0;
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (let i = 0; i < spec.k; i++) {
        const S1 = (rotr32(e, spec.s1[0]) ^ rotr32(e, spec.s1[1]) ^ rotr32(e, spec.s1[2])) >>> 0;
        const ch = ((e & f) ^ (~e & g)) >>> 0;
        const t1 = (hh + S1 + ch + k[i] + w[i]) >>> 0;
        const S0 = (rotr32(a, spec.rotr[0]) ^ rotr32(a, spec.rotr[1]) ^ rotr32(a, spec.rotr[2])) >>> 0;
        const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
        const t2 = (S0 + maj) >>> 0;
        hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
      h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
    }
    const out = new Uint8Array(spec.outBytes);
    const outView = new DataView(out.buffer);
    for (let i = 0; i < spec.outBytes / 4; i++) outView.setUint32(i * 4, h[i], false);
    return out;
  }

  // One byte view for both worlds: Node's createHash accepts a typed array, so
  // the portable path and the Node path hash exactly the same bytes.
  function toBytes(input) {
    if (input == null) return new Uint8Array(0);
    if (typeof Uint8Array !== 'undefined' && input instanceof Uint8Array) return input;
    if (typeof ArrayBuffer !== 'undefined' && input instanceof ArrayBuffer) return new Uint8Array(input);
    if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView && ArrayBuffer.isView(input)) {
      return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    }
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(String(input));
    const str = String(input);
    const bytes = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 0xff;
    return bytes;
  }

  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function bytesToBase64(bytes) {
    if (typeof btoa === 'function') {
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin);
    }
    // No btoa and no Node: encode it here rather than return a wrong digest.
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const b0 = bytes[i];
      const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
      const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
      out += B64[b0 >> 2];
      out += B64[((b0 & 3) << 4) | (b1 >> 4)];
      out += i + 1 < bytes.length ? B64[((b1 & 15) << 2) | (b2 >> 6)] : '=';
      out += i + 2 < bytes.length ? B64[b2 & 63] : '=';
    }
    return out;
  }

  function generateSRIHash(fileBufferOrString, algorithm) {
    const algo = ALGORITHMS[String(algorithm || 'sha384').toLowerCase()];
    if (!algo) {
      return { ok: false, algorithm: String(algorithm), error: 'unsupported algorithm (use sha256, sha384 or sha512)' };
    }
    const bytes = toBytes(fileBufferOrString);
    if (nodeCrypto) {
      const base64 = nodeCrypto.createHash(algo).update(bytes).digest('base64');
      return { ok: true, algorithm: algo, base64, digest: algo + '-' + base64, bytes: bytes.length, hasher: 'node' };
    }
    const digest = sha2(bytes, algo);
    if (!digest) {
      return { ok: false, algorithm: algo, error: algo + ' needs Node crypto; the page-side hasher covers sha256' };
    }
    const base64 = bytesToBase64(digest);
    return { ok: true, algorithm: algo, base64, digest: algo + '-' + base64, bytes: bytes.length, hasher: 'portable' };
  }

  /*
    Append integrity + crossorigin to external `<script src>` and
    `<link rel="stylesheet" href>` tags. Inline scripts are not
    touched: they are not fetched, so integrity does not apply to
    them — they belong in the CSP, which is the section below.
  */
  function injectSRIAttributes(htmlContent, assetHashMap, opts) {
    const o = opts || {};
    const html = String(htmlContent == null ? '' : htmlContent);
    const map = assetHashMap || {};
    const injected = [];
    const skipped = [];
    const mismatched = [];
    const errors = [];

    const digestFor = (url) => {
      const direct = map[url];
      if (direct) return typeof direct === 'string' ? direct : (direct.digest || '');
      // An optional resolver lets a caller map a served URL to its build
      // path (`/app.js` → `dist/app.js`) without this module guessing.
      if (typeof o.resolve === 'function') {
        const key = o.resolve(url);
        const viaResolver = key && map[key];
        if (viaResolver) return typeof viaResolver === 'string' ? viaResolver : (viaResolver.digest || '');
      }
      return '';
    };

    const withAttributes = (tag, url, digest) => {
      // An existing integrity is respected or reported, never replaced.
      const existing = tag.match(/\sintegrity\s*=\s*("[^"]*"|'[^']*')/i);
      if (existing) {
        const value = existing[1].slice(1, -1);
        if (value !== digest) {
          mismatched.push({ url, found: value, expected: digest });
        }
        if (/\scrossorigin\b/i.test(tag)) return { tag, changed: false };
        return { tag: tag.replace(/>$/, ' crossorigin="anonymous">'), changed: true };
      }
      let out = tag;
      if (!/\scrossorigin\b/i.test(out)) out = out.replace(/>$/, ' crossorigin="anonymous">');
      out = out.replace(/\s*\/?>$/, (m) => ' integrity="' + digest + '"' + (m.indexOf('/') === 0 ? ' />' : '>'));
      return { tag: out, changed: true };
    };

    // <script src="...">
    let out = html.replace(/<script\b[^>]*\ssrc\s*=\s*("[^"]*"|'[^']*')[^>]*>/gi, (tag, quoted) => {
      const url = quoted.slice(1, -1);
      if (isUaDependent(url)) { skipped.push({ url, reason: 'response is user-agent dependent, so no fixed digest can be correct' }); return tag; }
      const digest = digestFor(url);
      if (!digest) { skipped.push({ url, reason: 'no hash supplied for this URL' }); return tag; }
      const res = withAttributes(tag, url, digest);
      if (res.changed) injected.push({ url, digest, kind: 'script' });
      return res.tag;
    });

    // <link rel="stylesheet" href="...">
    out = out.replace(/<link\b[^>]*>/gi, (tag) => {
      if (!/\srel\s*=\s*("[^"]*\bstylesheet\b[^"]*"|'[^']*\bstylesheet\b[^']*')/i.test(tag)) return tag;
      const hrefMatch = tag.match(/\shref\s*=\s*("[^"]*"|'[^']*')/i);
      if (!hrefMatch) return tag;
      const url = hrefMatch[1].slice(1, -1);
      if (isUaDependent(url)) { skipped.push({ url, reason: 'Google Fonts CSS varies per user agent — preconnect instead' }); return tag; }
      if (isCrossOrigin(url) && o.allowCrossOrigin !== true) {
        skipped.push({ url, reason: 'cross-origin stylesheet without an explicit opt-in' });
        return tag;
      }
      const digest = digestFor(url);
      if (!digest) { skipped.push({ url, reason: 'no hash supplied for this URL' }); return tag; }
      const res = withAttributes(tag, url, digest);
      if (res.changed) injected.push({ url, digest, kind: 'stylesheet' });
      return res.tag;
    });

    return {
      ok: errors.length === 0,
      html: out,
      injected,
      skipped,
      mismatched,
      errors,
      changed: injected.length
    };
  }

  /*
    Digests of every inline `<script>` that has no `src`. These are
    what make `'unsafe-inline'` unnecessary — and what must be
    recomputed after minification, because the hash is over the bytes
    that will actually be served.
  */
  function hashInlineScripts(htmlContent, algorithm) {
    const html = String(htmlContent == null ? '' : htmlContent);
    const hashes = [];
    const kinds = [];
    let count = 0;
    const rx = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = rx.exec(html))) {
      const attrs = m[1] || '';
      if (/\ssrc\s*=/i.test(attrs)) continue;
      const type = (attrs.match(/\stype\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i) || []);
      const value = String(type[2] != null ? type[2] : type[3] != null ? type[3] : type[4] || '').trim().toLowerCase();
      // Only executable scripts are covered by script-src. A JSON-LD data
      // island is not script, and adding its hash is harmless but noisy.
      const executable = value === '' || /javascript|ecmascript|^module$/.test(value);
      if (!executable) { kinds.push({ type: value || 'text/javascript', hashed: false }); continue; }
      const res = generateSRIHash(m[2], algorithm || 'sha256');
      if (res.ok) { hashes.push(res.digest); count++; kinds.push({ type: value || 'text/javascript', hashed: true }); }
    }

    // Inline handlers cannot be covered by a hash. A strict policy that
    // omits 'unsafe-inline' will silently break every one of them, so
    // they are counted and reported rather than discovered in production.
    const handlers = (html.match(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi) || []);
    const javascriptUrls = (html.match(/href\s*=\s*("javascript:[^"]*"|'javascript:[^']*')/gi) || []);

    return {
      hashes,
      count,
      scripts: kinds,
      unhashable: {
        handlers: handlers.length,
        javascriptUrls: javascriptUrls.length,
        note: handlers.length || javascriptUrls.length
          ? 'inline event handlers and javascript: URLs cannot be covered by a hash and will break under a policy without unsafe-inline'
          : ''
      }
    };
  }

  /*
    The hardened policy. Style is deliberately left permissive where
    the generated pages need it: they inline their entire stylesheet,
    so a strict `style-src` would blank them, and that is a real trade
    recorded here rather than an oversight.
  */
  function buildStrictCSPHeader(sriHashes, allowedSources, opts) {
    const o = opts || {};
    /*
      Hashes arrive either bare (`sha384-...`, what `generateSRIHash`
      returns) or already quoted (`'sha384-...'`, the form the attribute
      uses). Wrapping the quoted form again emits `''sha384-...''`, a
      token that matches nothing — a policy that looks strict and
      permits no script at all. The quotes are normalised here so both
      shapes mean the same thing.
    */
    const normaliseHash = (h) => String(h == null ? '' : h).trim().replace(/^'/, '').replace(/'$/, '');
    const hashes = (Array.isArray(sriHashes) ? sriHashes
      : (sriHashes && typeof sriHashes === 'object' ? Object.keys(sriHashes).map((k) => sriHashes[k]) : []))
      .map(normaliseHash).filter(Boolean);
    const src = allowedSources || {};

    const asList = (v) => (Array.isArray(v) ? v.slice() : (v ? [v] : []));
    const script = [];
    if (o.strictDynamic) script.push("'strict-dynamic'");
    if (o.nonce) script.push("'" + String(o.nonce) + "'");
    hashes.forEach((h) => script.push("'" + h + "'"));
    asList(src.script).forEach((s) => script.push(s));
    // `'self'` is only needed when a script is actually fetched from us.
    if (src.self !== false && asList(src.script).length) script.unshift("'self'");
    if (!script.length) script.push("'none'");

    const directives = [
      // `default-src 'none'` is the whole point of "strict": anything not
      // named below is refused, so a directive added later is a deliberate act.
      "default-src 'none'",
      'script-src ' + script.join(' '),
      'style-src ' + ['\'unsafe-inline\''].concat(asList(src.style)).join(' '),
      'img-src ' + [].concat(asList(src.img), ["'self'", 'data:']).join(' '),
      'font-src ' + [].concat(asList(src.font), ["'self'", 'data:']).join(' '),
      'media-src ' + [].concat(asList(src.media), ["'self'", 'data:', 'blob:']).join(' '),
      'connect-src ' + [].concat(asList(src.connect), ["'self'"]).join(' '),
      'frame-src ' + [].concat(asList(src.frame), ["'self'"]).join(' '),
      "object-src 'none'",
      "base-uri 'self'",
      // A static export usually posts its form to a third-party endpoint
      // (FormSubmit, Web3Forms, a client's own handler). Left at 'self' that
      // policy breaks the contact form on the site it was meant to protect, so
      // the endpoint's own origin has to be nameable.
      'form-action ' + (asList(src.formAction).length ? asList(src.formAction).concat(["'self'"]).join(' ') : "'self'"),
      'frame-ancestors ' + (o.frameAncestors ? asList(o.frameAncestors).join(' ') : "'none'")
    ];

    const policy = directives.join('; ');
    const warnings = [];
    if (!hashes.length && o.inlineScripts) {
      warnings.push('no inline script hashes were supplied, but the document contains inline scripts — a policy without them blocks those scripts');
    }
    if (o.unhashable && (o.unhashable.handlers || o.unhashable.javascriptUrls)) {
      warnings.push(o.unhashable.note);
    }
    if (!o.strictDynamic && /'unsafe-inline'/.test(policy) === false && hashes.length && o.expectedInline) {
      warnings.push('hashes cover ' + hashes.length + ' inline script(s); any script added later needs its hash added too, or it will be blocked');
    }

    return { policy, header: 'Content-Security-Policy: ' + policy, warnings, hashCount: hashes.length };
  }

  /*
    ---- external dependency profiles ----

    A caller names what the site actually uses, and only those hosts
    reach the policy. Naming a provider is both shorter and safer than
    naming hosts: `'google-analytics'` cannot forget
    `analytics.google.com`, and a provider that changes its endpoints
    changes them in one place.

    The widget hosts mirror exactly what `modules/builder.js` can emit
    into `frame-src`, so a synthesised policy describes a page the
    builder can actually produce.
  */
  const DEPENDENCIES = {
    'google-analytics': { script: ['https://www.googletagmanager.com'], connect: ['https://www.google-analytics.com', 'https://analytics.google.com'] },
    'google-tag-manager': { script: ['https://www.googletagmanager.com'], connect: ['https://www.google-analytics.com'] },
    plausible: { script: ['https://plausible.io'], connect: ['https://plausible.io'] },
    umami: { script: ['https://cloud.umami.is'], connect: ['https://cloud.umami.is'] },
    'google-fonts': { style: ['https://fonts.googleapis.com'], font: ['https://fonts.gstatic.com'] },
    formspree: { form: ['https://formspree.io'], connect: ['https://formspree.io'] },
    netlify: { form: ['https://netlify.com'], connect: ['https://api.netlify.com'] },
    youtube: { frame: ['https://www.youtube.com'] },
    vimeo: { frame: ['https://player.vimeo.com'] },
    spotify: { frame: ['https://open.spotify.com'] },
    calendly: { frame: ['https://calendly.com'] },
    coverr: { frame: ['https://coverr.co'] },
    'google-maps': { frame: ['https://www.google.com'], connect: ['https://maps.googleapis.com'] }
  };

  // Header-only directives. A <meta> policy cannot express these, so
  // including them would be a rule that silently does nothing.
  const META_UNSUPPORTED = ['frame-ancestors', 'report-uri', 'report-to', 'sandbox'];

  /*
    Inline event handlers and javascript: URLs, counted. These are the
    attributes a hash cannot cover, and therefore the reason a strict
    policy cannot be delivered in a meta tag on this app's output.
  */
  function detectInlineHandlers(htmlContent) {
    const html = String(htmlContent == null ? '' : htmlContent);
    const handlers = html.match(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi) || [];
    const javascriptUrls = html.match(/\shref\s*=\s*("javascript:[^"]*"|'javascript:[^']*')/gi) || [];
    return {
      handlers: handlers.length,
      names: handlers.map((h) => (h.trim().split(/\s|=/)[0] || '').toLowerCase()),
      javascriptUrls: javascriptUrls.length,
      present: handlers.length > 0 || javascriptUrls.length > 0
    };
  }

  /*
    Whether `script-src` in this policy actually permits inline code.

    The rule that trips people up: a nonce or a hash in the list makes
    `'unsafe-inline'` ignored. So `"'unsafe-inline' 'sha256-...'"` does
    NOT allow an inline handler — the hash's presence disables the broad
    permission. `'unsafe-hashes'` is the documented escape for handlers.
  */
  function inlineScriptPermissions(policy) {
    const p = String(policy || '');
    const match = p.match(/script-src([^;]*)/i);
    const list = match ? match[1] : '';
    const hasUnsafeInline = /'unsafe-inline'/.test(list);
    const hasUnsafeHashes = /'unsafe-hashes'/.test(list);
    const hasHash = /'sha(256|384|512)-/.test(list);
    const hasNonce = /'nonce-/.test(list);
    // The browser ignores 'unsafe-inline' once a nonce or hash is present.
    const broadInlineHonoured = hasUnsafeInline && !hasHash && !hasNonce;
    return {
      hasUnsafeInline,
      hasUnsafeHashes,
      hasHash,
      hasNonce,
      broadInlineHonoured,
      inlineScriptsAllowed: broadInlineHonoured || hasHash || hasNonce,
      inlineHandlersAllowed: broadInlineHonoured || hasUnsafeHashes
    };
  }

  /*
    Synthesise a policy from a dependency list.

    Composition, not a second implementation: the assembled directive
    lists are handed to `buildStrictCSPHeader`, so a generated policy and
    a hand-built one cannot drift apart. The additions here are the
    dependency profiles and the meta-tag safety judgement.
  */
  function generateStrictCSP(options) {
    const o = options || {};
    const wanted = Array.isArray(o.dependencies) ? o.dependencies : [];
    const buckets = { script: [], style: [], img: [], font: [], connect: [], frame: [], form: [], media: [] };
    const unknown = [];
    wanted.forEach((name) => {
      const profile = DEPENDENCIES[String(name == null ? '' : name).toLowerCase()];
      if (!profile) { unknown.push(String(name)); return; }
      Object.keys(profile).forEach((kind) => {
        if (buckets[kind]) buckets[kind] = buckets[kind].concat(profile[kind]);
      });
    });

    // Caller-supplied hosts are added to the profile hosts, never instead
    // of them, so a dependency and an extra host can coexist.
    const extra = o.allowedSources || {};
    const merged = {};
    Object.keys(buckets).forEach((k) => {
      const list = buckets[k].concat(Array.isArray(extra[k]) ? extra[k] : (extra[k] ? [extra[k]] : []));
      if (list.length) merged[k] = Array.from(new Set(list));
    });

    const hashes = Array.isArray(o.hashes) ? o.hashes
      : (Array.isArray(o.inlineHashes) ? o.inlineHashes : []);
    const built = buildStrictCSPHeader(hashes, merged, {
      strictDynamic: o.strictDynamic,
      nonce: o.nonce,
      inlineScripts: !!o.inlineScripts,
      unhashable: o.unhashable,
      frameAncestors: o.frameAncestors
    });

    const perms = inlineScriptPermissions(built.policy);
    const handlers = o.inlineHandlers || { handlers: 0, javascriptUrls: 0, present: false };
    const warnings = built.warnings.slice();

    // The meta-safety judgement. Two independent reasons to refuse:
    // unhashable inline handlers the policy would block, and directives
    // a meta tag cannot carry anyway.
    const headerOnly = META_UNSUPPORTED.filter((d) => new RegExp('(^|;\\s*)' + d + '\\s', 'i').test(built.policy + ' '));
    /*
      Two separate questions, kept separate because they have different
      answers and different advice:

        metaSafe        — injecting this as a <meta> will not BREAK the page
        metaEquivalent  — a <meta> carries the WHOLE policy

      A policy with `frame-ancestors` is perfectly safe to inject and
      simply loses that one directive; reporting that as "unsafe" would
      push a caller away from a working policy.
    */
    let metaSafe = true;
    let metaReason = '';
    if (handlers.present && !perms.inlineHandlersAllowed) {
      metaSafe = false;
      metaReason = 'the document has ' + handlers.handlers + ' inline event handler(s)'
        + (handlers.names && handlers.names.length ? ' (' + Array.from(new Set(handlers.names)).join(', ') + ')' : '')
        + (handlers.javascriptUrls ? ' and ' + handlers.javascriptUrls + ' javascript: URL(s)' : '')
        + ', and this policy does not permit them; a meta CSP would block them and the page would break silently. Use the header form.';
    }
    if (headerOnly.length) {
      warnings.push(headerOnly.join(', ') + ' is ignored in a <meta> policy — it only takes effect as a response header');
    }
    if (perms.hasUnsafeInline && perms.hasHash) {
      warnings.push("script-src carries both 'unsafe-inline' and a hash; browsers ignore 'unsafe-inline' when any nonce or hash is present, so only the hashed scripts will run");
    }

    // Strip what a meta tag cannot express, so the meta form is honest.
    const metaPolicy = built.policy
      .split(';')
      .map((d) => d.trim())
      .filter((d) => d && !META_UNSUPPORTED.some((x) => new RegExp('^' + x + '\\b', 'i').test(d)))
      .join('; ');

    return {
      ok: true,
      policy: built.policy,
      header: built.header,
      directives: built.policy.split('; '),
      allowedSources: merged,
      dependencies: wanted.map(String),
      unknownDependencies: unknown,
      hashCount: built.hashCount,
      permissions: perms,
      metaSafe,
      metaEquivalent: headerOnly.length === 0,
      metaPolicy,
      metaDropped: headerOnly,
      metaReason: metaReason || (headerOnly.length ? 'header-only directive(s) dropped from the meta form: ' + headerOnly.join(', ') : ''),
      warnings
    };
  }

  /*
    Deliver a policy as a `<meta http-equiv>`, or explain why not.

    Returns `injected: false` with a reason rather than a broken page.
    `force: true` injects anyway — for a caller who has added
    `'unsafe-hashes'` and per-handler hashes themselves and knows the
    policy is sufficient.
  */
  function injectCSPMeta(htmlContent, policy, opts) {
    const o = opts || {};
    const html = String(htmlContent == null ? '' : htmlContent);
    const p = String(policy == null ? '' : policy);
    if (!p) return { ok: false, html, injected: false, reason: 'no policy supplied' };

    const handlers = o.handlers || detectInlineHandlers(html);
    const perms = inlineScriptPermissions(p);
    if (handlers.present && !perms.inlineHandlersAllowed && o.force !== true) {
      return {
        ok: false,
        html,
        injected: false,
        reason: 'refused: the policy would block ' + handlers.handlers + ' inline handler(s) the document uses',
        handlers,
        permissions: perms
      };
    }

    const stripped = p.split(';').map((d) => d.trim())
      .filter((d) => d && !META_UNSUPPORTED.some((x) => new RegExp('^' + x + '\\b', 'i').test(d)))
      .join('; ');
    const tag = '<meta http-equiv="Content-Security-Policy" content="' + stripped.replace(/"/g, '&quot;') + '">';

    if (/<meta\s+http-equiv=["']Content-Security-Policy["']/i.test(html)) {
      return { ok: true, html, injected: false, reason: 'a policy meta tag is already present', tag };
    }
    const out = /<head[^>]*>/i.test(html)
      ? html.replace(/<head[^>]*>/i, (m) => m + '\n' + tag)
      : tag + '\n' + html;
    return { ok: true, html: out, injected: true, tag, reason: '' };
  }

  /*
    The Task 3 entry point: SRI attributes AND a CSP, one call.

    `shaHashes` maps a served URL to either a ready digest
    (`sha384-...`) or the content itself, which is hashed with sha384.
    Both forms are accepted because a build has the bytes and a
    manifest has the digest, and forcing one to become the other is
    where mistakes get made.

    Self-contained pages inline their whole stylesheet, so
    `'unsafe-inline'` for `style-src` is a real requirement here and is
    applied by `generateStrictCSP` through `buildStrictCSPHeader`.
  */
  function injectSRIAndCSPHeaders(htmlContent, shaHashes, opts) {
    const o = opts || {};
    const algorithm = o.algorithm || 'sha384';
    const map = {};
    const errors = [];
    const warnings = [];

    Object.keys(shaHashes || {}).forEach((url) => {
      const value = shaHashes[url];
      if (typeof value === 'string' && /^sha(256|384|512)-/.test(value)) { map[url] = value; return; }
      const computed = generateSRIHash(value != null ? value : '', algorithm);
      if (!computed.ok) { errors.push('could not hash ' + url + ': ' + computed.error); return; }
      map[url] = computed.digest;
    });

    const sri = injectSRIAttributes(htmlContent, map, o);
    const handlers = detectInlineHandlers(sri.html);
    const inline = hashInlineScripts(sri.html, o.inlineAlgorithm || 'sha256');

    const csp = generateStrictCSP({
      dependencies: o.dependencies,
      allowedSources: o.allowedSources,
      hashes: inline.hashes,
      inlineScripts: inline.count > 0,
      unhashable: inline.unhashable,
      inlineHandlers: handlers,
      frameAncestors: o.frameAncestors
    });

    let html = sri.html;
    let metaInjected = false;
    if (o.meta === true) {
      const res = injectCSPMeta(html, csp.metaPolicy, { handlers, force: o.forceMeta === true });
      if (res.injected) { html = res.html; metaInjected = true; }
      else warnings.push('meta CSP not injected — ' + res.reason + (o.headerRecommended !== false ? ' (deliver it as a response header instead)' : ''));
    }

    return {
      ok: sri.ok && errors.length === 0,
      html,
      sri: { injected: sri.injected, skipped: sri.skipped, mismatched: sri.mismatched, hashCount: sri.injected.length },
      csp,
      metaInjected,
      metaSafe: csp.metaSafe,
      handlers,
      inlineScripts: inline.count,
      warnings: warnings.concat(csp.warnings),
      errors: errors.concat(sri.errors)
    };
  }

  /*
    One call for the whole job, warning when the pieces disagree — for
    example asking for a strict policy on a document that has inline
    scripts the caller never hashed.
  */
  function hardenDocument(htmlContent, assets, opts) {
    const o = opts || {};
    const html = String(htmlContent == null ? '' : htmlContent);
    const inline = hashInlineScripts(html, o.inlineAlgorithm || 'sha256');
    const injected = injectSRIAttributes(html, assets, o);
    const csp = buildStrictCSPHeader(inline.hashes, o.allowedSources, {
      strictDynamic: o.strictDynamic,
      inlineScripts: inline.count > 0,
      unhashable: inline.unhashable
    });

    const warnings = csp.warnings.slice();
    injected.skipped.forEach((s) => {
      // A skipped stylesheet is normal; a skipped script usually means a
      // missing hash, which is worth saying out loud.
      if (s.reason === 'no hash supplied for this URL') warnings.push('no SRI hash for ' + s.url + ' — the tag was left without an integrity attribute rather than given a wrong one');
    });

    return {
      ok: injected.ok,
      html: injected.html,
      injected: injected.injected,
      skipped: injected.skipped,
      mismatched: injected.mismatched,
      inlineScripts: inline.count,
      csp: csp.policy,
      warnings,
      errors: injected.errors
    };
  }

  return {
    generateSRIHash,
    injectSRIAttributes,
    hashInlineScripts,
    buildStrictCSPHeader,
    hardenDocument,
    isUaDependent,
    DEPENDENCIES,
    META_UNSUPPORTED,
    detectInlineHandlers,
    inlineScriptPermissions,
    generateStrictCSP,
    injectCSPMeta,
    injectSRIAndCSPHeaders
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = SecuritySRI;
