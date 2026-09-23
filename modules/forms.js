'use strict';
// ============================================================
// PallettAI Studio — zero-backend client form router
// Static exports get working contact forms with no server of
// our own: the browser posts straight to the visitor's chosen
// serverless form backend.
// ------------------------------------------------------------
//   1. Provider routing — Web3Forms, Formspree, Netlify Forms,
//      Formtorch, and custom endpoints (Cloudflare Workers or
//      anything else that takes a POST). formEndpoint(cfg)
//      resolves {url, json, inject} for every provider; unknown
//      providers and missing credentials fail loudly HERE,
//      never in the exported page.
//   2. generateFormHandlerScript(config) — an inline script
//      under 1.5KB that intercepts submit, runs zero-dependency
//      validation (required / email / phone), honours the
//      invisible `botcheck` honeypot, and posts with fetch.
//   3. Accessible toast banners — success announces through
//      role="status" (implicit polite live region), failure
//      through role="alert" (implicit assertive); click or a
//      6s timer dismisses, so no page reload is ever needed.
//
// ---- what this file guarantees ----------------------------------
// 1. NOTHING LEAVES THE PAGE BEFORE VALIDATION PASSES — the
//    honeypot check runs first (a bot gets a fake success and
//    no request), then field validation focuses the first
//    offender and marks it aria-invalid before any fetch fires.
// 2. THE VALIDATION RULES EXIST ONCE. EMAIL_RE / PHONE_RE and
//    validateValues() are exported for tests and tooling, and
//    the generated script interpolates the SAME regex sources —
//    the mirror cannot drift from the original.
// 3. TOASTS ARE ACCESSIBLE BY CONSTRUCTION and dismissible
//    (click) with timers that clean up, so the DOM never
//    accumulates banners.
// 4. PURE STRING GENERATION — no network, no DOM access at
//    build time; every provider key/URL is validated up front.
//    The generated script uses only browser natives: fetch,
//    FormData, Object.fromEntries, URLSearchParams.
// ============================================================

// ---- shared escaping ---------------------------------------------------
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// ---- validation core (mirrored into the generated script) --------------
// Anchored but permissive: one local part, one dot before the TLD, no
// spaces. Phones accept +, spaces, dashes and parens over 6–20 chars;
// the digit floor (7+) is what actually distinguishes a number from a
// date or a word.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?[\d\s().-]{6,20}$/;

const HONEYPOT_DEFAULT = 'botcheck';

// Rule vocabulary (anything else — 'optional', 'text', … — is dropped
// by the generator and never constrains):
//   'required' → must be non-empty
//   'email'    → must be present AND match EMAIL_RE
//   'phone'    → must be present, PHONE_RE shape, ≥7 digits
function validateValues(values, rules) {
  const v = values && typeof values === 'object' ? values : {};
  const r = rules && typeof rules === 'object' ? rules : {};
  const errors = [];
  for (const field of Object.keys(r)) {
    const rule = r[field];
    const raw = v[field] == null ? '' : String(v[field]).trim();
    const mustBePresent = rule === 'required' || rule === 'email' || rule === 'phone';
    if (mustBePresent && !raw) {
      errors.push({ field, kind: 'required', message: '"' + field + '" is required' });
      continue;
    }
    if (!raw) continue;
    if (rule === 'email' && !EMAIL_RE.test(raw)) {
      errors.push({ field, kind: 'email', message: '"' + field + '" must be an email address' });
    } else if (rule === 'phone' && !phoneOK(raw)) {
      errors.push({ field, kind: 'phone', message: '"' + field + '" must be a phone number' });
    }
  }
  return errors;
}

// The single shared phone predicate: shape + digit floor. The generated
// script inlines exactly this expression.
function phoneOK(x) {
  return PHONE_RE.test(x) && String(x).replace(/\D/g, '').length >= 7;
}

// ---- provider routing ---------------------------------------------------
const PROVIDERS = {
  web3forms: 'web3forms', formspree: 'formspree', netlify: 'netlify',
  formtorch: 'formtorch', cloudflare: 'cloudflare', worker: 'cloudflare',
  custom: 'custom'
};

/**
 * Resolve the POST target for a provider config.
 *   web3forms  → https://api.web3forms.com/submit   (JSON + access_key)
 *   formspree  → https://formspree.io/f/{formId}    (JSON)
 *   formtorch  → https://formtorch.com/f/{formId}   (JSON)
 *   netlify    → endpoint or the current path        (urlencoded + form-name)
 *   cloudflare → the Worker endpoint you supply      (JSON; cfg.json overrides)
 *   custom     → any URL you supply                  (same)
 * Returns { url, json, inject }. Throws Error {code} on bad config.
 */
function formEndpoint(cfg) {
  const c = cfg || {};
  const key = PROVIDERS[String(c.provider || '').toLowerCase().trim()];
  if (!key) {
    const err = new Error('Unknown form provider "' + String(c.provider || '')
      + '". Use web3forms, formspree, netlify, formtorch, cloudflare, or custom.');
    err.code = 'unknown_provider';
    throw err;
  }
  const need = (v, what) => {
    if (!v) {
      const e = new Error(key + ' requires ' + what);
      e.code = 'missing_credential';
      throw e;
    }
    return String(v);
  };
  const idOf = (v, who) => {
    const id = need(v, 'formId');
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      const e = new Error(who + ' formId looks malformed');
      e.code = 'bad_input';
      throw e;
    }
    return id;
  };

  if (key === 'web3forms') {
    return {
      url: 'https://api.web3forms.com/submit', json: true,
      inject: { access_key: need(c.accessKey, 'accessKey') }
    };
  }
  if (key === 'formspree') {
    return { url: 'https://formspree.io/f/' + idOf(c.formId, 'formspree'), json: true, inject: {} };
  }
  if (key === 'formtorch') {
    return { url: 'https://formtorch.com/f/' + idOf(c.formId, 'formtorch'), json: true, inject: {} };
  }
  if (key === 'netlify') {
    // '' → the script falls back to location.pathname, which is where
    // Netlify expects the form-name POST for AJAX submissions.
    return {
      url: c.endpoint ? String(c.endpoint) : '',
      json: false,
      inject: { 'form-name': String(c.formName || c.id || 'contact') }
    };
  }
  // cloudflare / custom
  const url = need(c.endpoint, 'endpoint (your Worker/endpoint URL)');
  if (!/^https?:\/\//i.test(url)) {
    const e = new Error('endpoint must be an http(s) URL');
    e.code = 'bad_input';
    throw e;
  }
  return { url, json: c.json !== false, inject: c.inject && typeof c.inject === 'object' ? c.inject : {} };
}

// ---- honeypot -----------------------------------------------------------
/**
 * The invisible field. Off-screen (never display:none, which some
 * autofill/bot heuristics treat differently), tabindex="-1" so keyboard
 * users never land in it, aria-hidden so assistive tech never meets it.
 */
function honeypotFieldHTML(name) {
  const n = String(name || HONEYPOT_DEFAULT).replace(/[^\w-]/g, '') || HONEYPOT_DEFAULT;
  const id = 'pai-hp-' + n;
  return '<div class="pai-hp" aria-hidden="true"'
    + ' style="position:absolute;left:-100vw;top:auto;width:1px;height:1px;overflow:hidden">'
    + '<label for="' + id + '">Leave this field empty</label>'
    + '<input type="text" id="' + id + '" name="' + esc(n) + '"'
    + ' tabindex="-1" autocomplete="off" value="">'
    + '</div>';
}

// ---- the handler script -------------------------------------------------
const DEFAULT_OK = 'Thank you! Your message has been sent.';
const DEFAULT_ERR = 'Please check the highlighted fields.';
const DEFAULT_NET = 'Network error — please try again.';

/**
 * generateFormHandlerScript(config) → inline JS (< 1.5KB).
 *
 * config = {
 *   id            form element id (leading # tolerated)
 *   provider      see PROVIDERS + formEndpoint()
 *   accessKey / formId / endpoint / formName / inject / json
 *   fields        { name: 'required'|'email'|'phone'|'optional' }
 *   honeypot      field name (default 'botcheck'; false disables)
 *   successMessage / errorMessage / networkMessage
 * }
 */
function generateFormHandlerScript(config) {
  const c = config || {};
  const id = String(c.id || '').replace(/^#/, '');
  if (!id) {
    const e = new Error('generateFormHandlerScript requires config.id (the form\'s id)');
    e.code = 'bad_input';
    throw e;
  }
  const route = formEndpoint(c);
  const rules = {};
  const rawRules = c.fields && typeof c.fields === 'object' ? c.fields : {};
  for (const k of Object.keys(rawRules)) {
    const r = String(rawRules[k] || '').toLowerCase();
    if (r === 'required' || r === 'email' || r === 'phone') rules[k] = r;
    // 'optional'/'text'/unknown → left out entirely: no constraint.
  }

  const cfg = {
    id,
    inject: route.inject,
    r: rules,
    hp: c.honeypot === false ? ''
      : (String(c.honeypot || HONEYPOT_DEFAULT).replace(/[^\w-]/g, '') || HONEYPOT_DEFAULT),
    ok: String(c.successMessage || DEFAULT_OK),
    err: String(c.errorMessage || DEFAULT_ERR),
    net: String(c.networkMessage || DEFAULT_NET)
  };
  // Everything known at BUILD time is emitted as a literal — the
  // runtime cfg only carries what actually varies between visitors'
  // submissions. This is most of how the script stays under 1.5KB.
  const urlExpr = route.url ? JSON.stringify(route.url) : 'location.pathname';
  const bodyExpr = route.json ? 'JSON.stringify(v)' : '""+new URLSearchParams(v)';
  const contentType = route.json ? 'application/json' : 'application/x-www-form-urlencoded';

  // Regex sources come from the SAME exported constants the tests
  // assert against — script and module cannot drift apart.
  return '(function(){'
    + 'var c=' + JSON.stringify(cfg) + ',f=document.getElementById(c.id);if(!f)return;'
    + 'var EM=/' + EMAIL_RE.source + '/,PH=/' + PHONE_RE.source + '/;'
    // Toast: role FIRST so assistive tech has the announcement even if
    // the timer removes the node a moment later.
    + 'function say(m,ok){var d=document.createElement("div");'
    + 'd.setAttribute("role",ok?"status":"alert");'
    + 'd.style.cssText="position:fixed;left:0;right:0;bottom:0;text-align:center;'
    + 'z-index:9999;padding:12px 16px;font:14px system-ui;'
    + 'color:#fff;background:"+(ok?"#117a3e":"#b3261e")+";";'
    + 'd.textContent=m;d.onclick=d.remove;document.body.appendChild(d);'
    + 'setTimeout(d.remove.bind(d),6e3);}'
    + 'f.addEventListener("submit",function(e){e.preventDefault();if(f.busy)return;'
    + 'var v=Object.fromEntries(new FormData(f)),k,x,el;'
    // Honeypot first: a filled botcheck gets a fake success, no request.
    + 'if(c.hp&&v[c.hp]){say(c.ok,1);f.reset();return;}'
    // First violating field, in config order: empty → format → shape.
    + 'for(k in c.r){x=String(v[k]||"").trim();'
    + 'if(!x||(c.r[k]==="email"&&!EM.test(x))'
    + '||(c.r[k]==="phone"&&!(PH.test(x)&&x.replace(/\\D/g,"").length>6))){'
    + 'el=f.elements[k];if(el){el.setAttribute("aria-invalid","true");el.focus();}'
    + 'say(c.err,0);return;}}'
    + 'for(k in c.inject)v[k]=c.inject[k];'
    + 'f.busy=1;'
    + 'fetch(' + urlExpr + ',{method:"POST",headers:{"Content-Type":"' + contentType + '"},'
    + 'body:' + bodyExpr + '})'
    + '.then(function(r){if(!r.ok)throw 0;say(c.ok,1);f.reset();})'
    + '.catch(function(){say(c.net,0);})'
    + '.then(function(){f.busy=0;});});})();';
}

module.exports = {
  esc,
  EMAIL_RE,
  PHONE_RE,
  HONEYPOT_DEFAULT,
  PROVIDERS,
  DEFAULT_OK,
  DEFAULT_ERR,
  DEFAULT_NET,
  formEndpoint,
  validateValues,
  phoneOK,
  honeypotFieldHTML,
  generateFormHandlerScript
};
