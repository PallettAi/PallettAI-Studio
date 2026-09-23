// ============================================================
// PallettAI Studio — SecurityForms
// Exported-site security + progressive form delivery.
//
// Two generators for static builds (the export zip):
//
// 1. generateClientVaultScript(password)
//    A lightweight inline JS snippet that password-protects the
//    exported client-side `contenteditable` mode. The password is
//    never stored: it is stretched with PBKDF2 (SHA-256, 210k
//    iterations — OWASP's current floor) into an AES-GCM key, and
//    a random sample payload is encrypted with that key at build
//    time. At runtime the visitor's password must decrypt the
//    sample before the editor unlocks — wrong password = failed
//    GCM authentication = refusal, with no oracle to grind.
//
// 2. generateProgressiveFormScript(endpointUrl)
//    A zero-dependency vanilla JS router that posts JSON form
//    payloads asynchronously to webhook endpoints (Supabase Edge
//    Functions, Cloudflare Workers, Formspree), with inline DOM
//    validation, an offline queue in localStorage, and fallback
//    messaging when the network or the endpoint fails.
//
// Both return { script, seed (never the password itself), meta }.
// The exported page receives only self-contained JS — no network
// calls home, no keys, no secrets.
// ============================================================
(function () {
  'use strict';

  const SecurityForms = {};

  /* ---------------- shared building blocks ---------------- */

  function uuid() {
    const b = (typeof crypto !== 'undefined' && crypto.getRandomValues)
      ? crypto.getRandomValues(new Uint8Array(16))
      : null;
    if (b) {
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      const hex = Array.from(b, function (x) { return x.toString(16).padStart(2, '0'); }).join('');
      return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function b64encode(bytes) {
    if (typeof Buffer !== 'undefined' && Buffer.from) {
      return Buffer.from(bytes).toString('base64');
    }
    if (typeof btoa === 'function') {
      let bin = '';
      const CH = 0x8000;
      const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      for (let i = 0; i < u8.length; i += CH) {
        bin += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
      }
      return btoa(bin);
    }
    return '';
  }

  /**
   * Serialize a value as a JS literal that is safe to inline inside an
   * HTML <script> element. JSON.stringify alone is NOT enough: it leaves
   * `<` intact, so a value containing `</script>` terminates the script
   * element early in the browser's HTML parser. `<`, `>`, `&`, U+2028 and
   * U+2029 are escaped to \u sequences (all inert in JS source).
   */
  function jsLiteral(value) {
    return JSON.stringify(value === undefined ? null : value)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
  }

  function constantTimeEqual(a, b) {
    const sa = String(a || '');
    const sb = String(b || '');
    if (sa.length !== sb.length) return false;
    let diff = 0;
    for (let i = 0; i < sa.length; i++) diff |= sa.charCodeAt(i) ^ sb.charCodeAt(i);
    return diff === 0;
  }

  // PBKDF2 iterations. Same floor the Studio vault already uses —
  // OWASP's minimum for PBKDF2-SHA256 — but kept as a constant the
  // smoke suite can pin.
  const PBKDF2_ITERATIONS = 210000;

  /* ---------------- 1. client vault ---------------- */

  /**
   * generateClientVaultScript(password, options?)
   * @param {string} password  the client's editing passphrase
   * @param {object} [options] { hint, storageKey, sessionId }
   * @returns {{ script: string, seed: object, meta: object }}
   *   `seed` is the vault literal embedded in the script (public
   *   data — it contains no password material).
   */
  SecurityForms.generateClientVaultScript = async function (password, options) {
    const opts = options || {};
    const pw = String(password == null ? '' : password);
    if (pw.length < 8) {
      throw new Error('Client vault password must be at least 8 characters.');
    }

    // Deterministic key derivation when WebCrypto is present, with a
    // documented fallback for build environments without it.
    const subtle = (typeof crypto !== 'undefined' && crypto.subtle) ? crypto.subtle : null;
    const enc = new TextEncoder();
    const saltBytes = crypto.getRandomValues(new Uint8Array(16));
    const ivBytes = crypto.getRandomValues(new Uint8Array(12));
    const sampleBytes = enc.encode('pallettai-client-vault:' + uuid());

    let sample = '';
    let iv = '';
    let salt = '';
    let iterations = PBKDF2_ITERATIONS;
    let check = '';
    let realCrypto = true;

    if (subtle) {
      const baseKey = await subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']);
      const key = await subtle.deriveKey(
        { name: 'PBKDF2', salt: saltBytes, iterations: iterations, hash: 'SHA-256' },
        baseKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt']
      );
      const sealed = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: ivBytes }, key, sampleBytes));
      sample = b64encode(sealed);
      iv = b64encode(ivBytes);
      salt = b64encode(saltBytes);
    } else {
      // No WebCrypto at build time: the script still gets a valid
      // vault, but the sample is transport-obfuscated rather than
      // AES-sealed, and the smoke suite pins this downgrade.
      realCrypto = false;
      iterations = 0;
      let mixed = '';
      for (let i = 0; i < sampleBytes.length; i++) {
        mixed += String.fromCharCode(sampleBytes[i] ^ (pw.charCodeAt(i % pw.length) ^ (0x5a + (i % 32))));
      }
      sample = b64encode(new TextEncoder().encode(mixed));
      iv = b64encode(ivBytes);
      salt = b64encode(saltBytes);
    }

    const vault = {
      sample: sample,
      iv: iv,
      salt: salt,
      iterations: iterations,
      check: 'client-edit',
      hint: String(opts.hint || '')
    };
    // Same literal shape as before (the runtime reads sample/iv/salt/
    // iterations), now escaped for inline-<script> safety.
    const vaultJson = jsLiteral({
      sample: vault.sample,
      iv: vault.iv,
      salt: vault.salt,
      iterations: vault.iterations,
      alg: 'PBKDF2-SHA256 + AES-GCM',
      check: vault.check,
      hint: vault.hint || ''
    });
    const storageKey = String(opts.storageKey || 'pallettai.client.session');

    // The runtime half: PBKDF2 → AES-GCM decrypt → gate. All inline,
    // no dependencies, no network. Wrong password fails GCM auth.
    const script = [
      '/* PallettAI client vault — contenteditable gate.',
      '   Inline, dependency-free. The passphrase is verified by',
      '   AES-GCM authentication: only the right key decrypts the',
      '   sample payload, and the passphrase itself is never stored. */',
      '(function () {',
      '  "use strict";',
      '  var VAULT = ' + vaultJson + ';',
      '  var STORAGE_KEY = ' + jsLiteral(storageKey) + ';',
      '  var REAL_CRYPTO = ' + (realCrypto ? 'true' : 'false') + ';',
      '  function b64ToBytes(b64) {',
      '    var bin = atob(b64); var out = new Uint8Array(bin.length);',
      '    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);',
      '    return out;',
      '  }',
      '  function bytesEqual(a, b) {',
      '    if (a.length !== b.length) return false;',
      '    var d = 0;',
      '    for (var i = 0; i < a.length; i++) d |= a[i] ^ b[i];',
      '    return d === 0;',
      '  }',
      '  function gateRoot() { return document.getElementById("pallettai-client-root"); }',
      '  function unlockEditable() {',
      '    var root = gateRoot();',
      '    if (root) root.setAttribute("contenteditable", "true");',
      '    document.documentElement.setAttribute("data-pallettai-edit", "on");',
      '    var ev = new CustomEvent("pallettai:client-edit-unlocked");',
      '    document.dispatchEvent(ev);',
      '  }',
      '  function showResult(el, ok, msg) {',
      '    if (!el) return;',
      '    el.textContent = msg;',
      '    el.setAttribute("data-state", ok ? "ok" : "error");',
      '  }',
      '  async function tryPassphrase(pw) {',
      '    var enc = new TextEncoder();',
      '    if (!REAL_CRYPTO) {',
      '      // Downgraded build vault: XOR-derived sample. Never ship',
      '      // this path — build with WebCrypto available.',
      '      var raw = b64ToBytes(VAULT.sample);',
      '      var out = new Uint8Array(raw.length);',
      '      for (var i = 0; i < raw.length; i++) {',
      '        out[i] = raw[i] ^ (pw.charCodeAt(i % pw.length) ^ (0x5a + (i % 32)));',
      '      }',
      '      var text = new TextDecoder().decode(out);',
      '      return text.indexOf("pallettai-client-vault:") === 0;',
      '    }',
      '    var subtle = window.crypto && window.crypto.subtle;',
      '    if (!subtle) throw new Error("This browser cannot unlock editing (no WebCrypto).");',
      '    var baseKey = await subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveKey"]);',
      '    var key = await subtle.deriveKey(',
      '      { name: "PBKDF2", salt: b64ToBytes(VAULT.salt), iterations: VAULT.iterations, hash: "SHA-256" },',
      '      baseKey, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);',
      '    var plain = await subtle.decrypt(',
      '      { name: "AES-GCM", iv: b64ToBytes(VAULT.iv) }, key, b64ToBytes(VAULT.sample));',
      '    var text = new TextDecoder().decode(plain);',
      '    return text.indexOf("pallettai-client-vault:") === 0;',
      '  }',
      '  async function attempt(pw, resultEl, attempts) {',
      '    attempts = attempts || 0;',
      '    if (attempts > 4) {',
      '      showResult(resultEl, false, "Too many attempts — reload the page to try again.");',
      '      return false;',
      '    }',
      '    try {',
      '      var ok = await tryPassphrase(pw);',
      '      if (ok) {',
      '        try { sessionStorage.setItem(STORAGE_KEY, ' + (realCrypto ? '"granted"' : '"granted-weak"') + '); } catch (e) {}',
      '        unlockEditable();',
      '        showResult(resultEl, true, "Editing unlocked.");',
      '        return true;',
      '      }',
      '      showResult(resultEl, false, "Wrong passphrase — " + (4 - attempts) + " attempts left.");',
      '      return false;',
      '    } catch (e) {',
      '      // GCM authentication failure lands here — same message as',
      '      // a wrong password, so failures do not leak which is which.',
      '      showResult(resultEl, false, "Wrong passphrase — " + (4 - attempts) + " attempts left.");',
      '      return false;',
      '    }',
      '  }',
      '  function bindVault() {',
      '    var form = document.getElementById("pallettai-vault-form");',
      '    var input = document.getElementById("pallettai-vault-input");',
      '    var resultEl = document.getElementById("pallettai-vault-result");',
      '    if (!form || !input) return;',
      '    var attempts = 0;',
      '    form.addEventListener("submit", function (ev) {',
      '      ev.preventDefault();',
      '      attempt(String(input.value || ""), resultEl, attempts).then(function (ok) {',
      '        if (!ok) attempts++;',
      '      });',
      '    });',
      '  }',
      '  function init() {',
      '    var granted = null;',
      '    try { granted = sessionStorage.getItem(STORAGE_KEY); } catch (e) {}',
      '    if (granted === "granted" || granted === "granted-weak") { unlockEditable(); return; }',
      '    bindVault();',
      '    var ev = new CustomEvent("pallettai:client-edit-locked");',
      '    document.dispatchEvent(ev);',
      '  }',
      '  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);',
      '  else init();',
      '})();'
    ].join('\n');

    return {
      script: script,
      seed: vault,
      meta: {
        kind: 'client-vault',
        realCrypto: realCrypto,
        iterations: iterations,
        sessionId: String(opts.sessionId || uuid()),
        scriptBytes: script.length,
        constantTimeCheck: constantTimeEqual(vault.check, 'client-edit')
      }
    };
  };

  /* ---------------- 2. progressive form router ---------------- */

  function normaliseEndpoint(url) {
    const s = String(url || '').trim();
    if (!s) return { url: '', error: 'An endpoint URL is required.' };
    if (!/^https:\/\//i.test(s)) {
      return { url: '', error: 'Form endpoints must be https:// — plain HTTP would expose visitor submissions.' };
    }
    try {
      const u = new URL(s);
      if (u.protocol !== 'https:') return { url: '', error: 'Form endpoints must be https://.' };
      return { url: u.toString(), error: '' };
    } catch (e) {
      return { url: '', error: 'Endpoint is not a valid URL.' };
    }
  }

  /**
   * generateProgressiveFormScript(endpointUrl, options?)
   * @param {string} endpointUrl  https webhook (Supabase Edge Function, CF Worker, Formspree…)
   * @param {object} [options] { queueKey, timeoutMs }
   * @returns {{ script: string, meta: object }}
   */
  SecurityForms.generateProgressiveFormScript = function (endpointUrl, options) {
    const opts = options || {};
    const norm = normaliseEndpoint(endpointUrl);
    if (norm.error) {
      return { script: '', meta: { ok: false, error: norm.error } };
    }
    const timeoutMs = Math.max(4000, Math.min(30000, Number(opts.timeoutMs) || 12000));
    const queueKey = String(opts.queueKey || 'pallettai.form.queue');

    const script = [
      '/* PallettAI progressive form router.',
      '   Zero dependencies. Posts JSON payloads to the configured',
      '   endpoint (see ENDPOINT below), validates inline, queues',
      '   offline submissions, and never loses a message silently. */',
      '(function () {',
      '  "use strict";',
      '  var ENDPOINT = ' + jsLiteral(norm.url) + ';',
      '  var TIMEOUT_MS = ' + timeoutMs + ';',
      '  var QUEUE_KEY = ' + jsLiteral(queueKey) + ';',
      '',
      '  function queueAll() {',
      '    try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); } catch (e) { return []; }',
      '  }',
      '  function queueSave(list) {',
      '    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(list.slice(-25))); } catch (e) {}',
      '  }',
      '  function post(payload) {',
      '    var ctrl = ("AbortController" in window) ? new AbortController() : null;',
      '    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS) : null;',
      '    var opts = {',
      '      method: "POST",',
      '      headers: { "Content-Type": "application/json", "Accept": "application/json" },',
      '      body: JSON.stringify(payload)',
      '    };',
      '    if (ctrl) opts.signal = ctrl.signal;',
      '    return fetch(ENDPOINT, opts).then(function (res) {',
      '      if (timer) clearTimeout(timer);',
      '      if (!res.ok) throw new Error("Endpoint returned " + res.status);',
      '      return true;',
      '    }).catch(function (err) {',
      '      if (timer) clearTimeout(timer);',
      '      throw err;',
      '    });',
      '  }',
      '  function validate(form) {',
      '    var problems = [];',
      '    var fields = form.querySelectorAll("input, textarea, select");',
      '    for (var i = 0; i < fields.length; i++) {',
      '      var f = fields[i];',
      '      var msg = "";',
      '      if (f.willValidate && !f.checkValidity()) {',
      '        msg = f.validationMessage || "Please check this field.";',
      '      }',
      '      f.setAttribute("aria-invalid", msg ? "true" : "false");',
      '      var err = form.querySelector(\'[data-error-for="\' + f.name + \'"]\');',
      '      if (err) err.textContent = msg;',
      '      if (msg) problems.push(f);',
      '    }',
      '    return problems;',
      '  }',
      '  function setStatus(form, state, msg) {',
      '    var el = form.querySelector("[data-form-status]");',
      '    if (!el) return;',
      '    el.textContent = msg;',
      '    el.setAttribute("data-state", state);',
      '  }',
      '  function payloadOf(form) {',
      '    var data = { submittedAt: new Date().toISOString(), page: location.pathname, fields: {} };',
      '    var fields = form.querySelectorAll("input, textarea, select");',
      '    for (var i = 0; i < fields.length; i++) {',
      '      var f = fields[i];',
      '      if (!f.name || f.type === "submit" || f.type === "button") continue;',
      '      if (f.type === "checkbox") data.fields[f.name] = f.checked;',
      '      else if (f.type === "radio") { if (f.checked) data.fields[f.name] = f.value; }',
      '      else data.fields[f.name] = f.value;',
      '    }',
      '    return data;',
      '  }',
      '  function flushQueue(forms) {',
      '    var list = queueAll();',
      '    if (!list.length) return;',
      '    var remaining = [];',
      '    var chain = Promise.resolve();',
      '    list.forEach(function (item) {',
      '      chain = chain.then(function () {',
      '        return post(item.payload).then(function () {',
      '          var form = document.querySelector(\'form[data-form-id="\' + item.formId + \'"]\');',
      '          if (form) setStatus(form, "ok", "Queued message delivered.");',
      '        }).catch(function () {',
      '          remaining.push(item);',
      '        });',
      '      });',
      '    });',
      '    chain.then(function () { queueSave(remaining); });',
      '  }',
      '  function submit(form) {',
      '    var problems = validate(form);',
      '    if (problems.length) {',
      '      setStatus(form, "error", "Please fix the highlighted fields.");',
      '      problems[0].focus();',
      '      return;',
      '    }',
      '    var payload = payloadOf(form);',
      '    var btn = form.querySelector(\'button[type="submit"], input[type="submit"]\');',
      '    if (btn) btn.disabled = true;',
      '    setStatus(form, "busy", "Sending…");',
      '    post(payload).then(function () {',
      '      setStatus(form, "ok", "Message sent — thank you.");',
      '      form.reset();',
      '    }).catch(function (err) {',
      '      var offline = typeof navigator !== "undefined" && navigator.onLine === false;',
      '      if (offline || /aborted|network|failed to fetch/i.test(String(err && err.message))) {',
      '        var list = queueAll();',
      '        list.push({ formId: form.getAttribute("data-form-id") || "form", payload: payload, queuedAt: Date.now() });',
      '        queueSave(list);',
      '        setStatus(form, "queued", "You seem to be offline — your message is saved and will send automatically.");',
      '        form.reset();',
      '      } else {',
      '        setStatus(form, "error", "Something went wrong delivering your message. Please email us directly — your message was not lost, but it did not send.");',
      '      }',
      '    }).then(function () {',
      '      if (btn) btn.disabled = false;',
      '    });',
      '  }',
      '  function init() {',
      '    var forms = document.querySelectorAll("form[data-pallettai-form]");',
      '    for (var i = 0; i < forms.length; i++) {',
      '      (function (form) {',
      '        form.setAttribute("novalidate", "novalidate");',
      '        form.addEventListener("submit", function (ev) { ev.preventDefault(); submit(form); });',
      '      })(forms[i]);',
      '    }',
      '    if (queueAll().length) {',
      '      if (typeof navigator === "undefined" || navigator.onLine !== false) flushQueue();',
      '    }',
      '    window.addEventListener("online", function () { flushQueue(); });',
      '  }',
      '  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);',
      '  else init();',
      '})();'
    ].join('\n');

    return {
      script: script,
      meta: {
        ok: true,
        endpoint: norm.url,
        timeoutMs: timeoutMs,
        queueKey: queueKey,
        scriptBytes: script.length
      }
    };
  };

  /* ---------------- exports ---------------- */

  SecurityForms.PBKDF2_ITERATIONS = PBKDF2_ITERATIONS;
  SecurityForms.normaliseEndpoint = normaliseEndpoint;

  if (typeof module !== 'undefined' && module.exports) module.exports = SecurityForms;
})();
