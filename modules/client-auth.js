'use strict';
// ============================================================
// PallettAI Studio — zero-backend client content gating & vault
// Password-protected sections on a fully static export: the
// ciphertext ships with the page, the key is derived in the
// visitor's browser, and nothing ever touches a server. Built
// on WebCrypto (PBKDF2-SHA256 → AES-256-GCM) — the same
// primitives as modules/client-vault.js, with a payload-first
// composition: sections are self-describing, one shared unlock
// script owns the crypto, session resume and throttling.
// ------------------------------------------------------------
//   1. generateGatedSectionPayload(secretHTMLContent, passphrase)
//      → {html, saltHex, ivHex, cipherHex, tagHex, iterations, sectionId}
//      html = the gated <section> (ciphertext in data-pai-ct /
//      data-pai-tag) + an accessible password form (labelled
//      input, submit button, role="alert" error region) + a tiny
//      inline controller script that defers to window.paiGateAuth
//      on submit — zero dependencies, stopPropagation so the
//      shared document-level delegate never double-fires.
//   2. generateClientUnlockScript(saltHex, ivHex, options?)
//      → inline script defining window.paiGateAuth:
//        unlock(section, passphrase) → Promise<boolean>
//        lock()                      → wipe session key + re-render forms
//        attemptDelayMs(n)           → the throttle schedule, exposed
//      plus document-level submit delegation (works even if a
//      payload's own controller was stripped), automatic session
//      resume from sessionStorage, and failed-attempt throttling.
//   3. decryptCoreSource — the exact derive/decrypt core the
//      generated script embeds, exported as source so the smoke
//      runner can evaluate it under Node's spec-compliant
//      crypto.subtle: byte-exact recovery, wrong-password
//      rejection, tampered-ciphertext rejection.
//
// ---- what this file guarantees ----------------------------------
// 1. NOTHING MOUNTS UNTIL THE GCM TAG VERIFIES. A wrong
//    passphrase or a flipped ciphertext byte throws inside
//    crypto.subtle.decrypt — the section keeps showing only the
//    password form; no partial plaintext ever reaches the DOM.
// 2. EVERY FAILURE LOOKS THE SAME. Wrong password, tampered
//    ciphertext, missing unlock script and an insecure origin
//    (no crypto.subtle) all surface as one generic message —
//    the error channel reveals nothing about why.
// 3. THE PASSPHRASE IS NEVER PERSISTED. Only the derived key
//    bytes (32 B, exportable for resume) live in sessionStorage,
//    which dies with the tab; lock() removes them. No cookies,
//    no network, no logging.
// 4. THROTTLE SCHEDULE IS SHIPPED, NOT HIDDEN: attemptDelayMs —
//    two grace failures (0 ms), then 1s doubling to a 30s cap —
//    exists identically as module function and embedded script.
//    PBKDF2 runs 100,000 iterations by default.
// ============================================================

const crypto = require('crypto');

const PBKDF2_ITERATIONS = 100000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32; // AES-256

function fail(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

/**
 * Throttle after the n-th consecutive failure:
 * failures 1–2 are free, then 1s · 2^(n-3), capped at 30s.
 * The generated script embeds this exact formula.
 */
function attemptDelayMs(failedAttempts) {
  const n = Math.max(0, Math.floor(Number(failedAttempts) || 0));
  if (n < 3) return 0;
  return Math.min(30000, Math.pow(2, n - 3) * 1000);
}

const toHex = (buf) => Buffer.from(buf).toString('hex');

function fromHex(value, bytes, label) {
  const s = String(value == null ? '' : value);
  if (!/^[0-9a-fA-F]+$/.test(s) || s.length % 2 || s.length !== bytes * 2) {
    throw fail('bad_input', label + ' must be ' + bytes + ' bytes of hex');
  }
  return Buffer.from(s, 'hex');
}

// ---- the decrypt core (shared by generated script + runner) -------

/**
 * The browser-side derive/decrypt path, as source. Signature:
 *   paiGateDecrypt(crypto, auth, saltHex, ivHex, ctHex, tagHex, iterations)
 *   auth = {passphrase} | {key: Uint8Array}   (key = session resume)
 *   → {text, key}   key = base64 raw bytes for sessionStorage
 * Evaluated by the runner under Node's crypto.subtle to prove the
 * in-browser path recovers the payload byte-for-byte.
 */
const decryptCoreSource = [
  'async function paiGateDecrypt(crypto, auth, saltHex, ivHex, ctHex, tagHex, iterations) {',
  '  function u8(h) {',
  '    if (!h || h.length % 2) throw new Error("hex");',
  '    var b = new Uint8Array(h.length / 2), i, c;',
  '    for (i = 0; i < b.length; i++) {',
  '      c = parseInt(h.substr(i * 2, 2), 16);',
  '      if (c !== c) throw new Error("hex");',
  '      b[i] = c;',
  '    }',
  '    return b;',
  '  }',
  '  var km;',  '  if (auth && auth.key) {',
    // extractable: the tail always exportKeys the key back for
    // sessionStorage — and the key came FROM sessionStorage, so
    // extractability is already its provenance (false would throw
    // InvalidAccessException here and silently kill session resume)
    '    km = await crypto.subtle.importKey("raw", auth.key, {name: "AES-GCM"}, true, ["decrypt"]);',
  '  } else {',
  '    var base = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(auth && auth.passphrase || "")), {name: "PBKDF2"}, false, ["deriveBits"]);',
  '    var bits = await crypto.subtle.deriveBits({name: "PBKDF2", salt: u8(saltHex), iterations: iterations, hash: "SHA-256"}, base, 256);',
  '    km = await crypto.subtle.importKey("raw", bits, {name: "AES-GCM"}, true, ["decrypt"]);',
  '  }',
  '  var data = u8(ctHex), tag = u8(tagHex),',
  '    full = new Uint8Array(data.length + tag.length);',
  '  full.set(data); full.set(tag, data.length);',
  '  var pt = await crypto.subtle.decrypt({name: "AES-GCM", iv: u8(ivHex)}, km, full);',
  '  var raw = new Uint8Array(await crypto.subtle.exportKey("raw", km));',
  '  var s = "", i;',
  '  for (i = 0; i < raw.length; i++) s += String.fromCharCode(raw[i]);',
  '  return {text: new TextDecoder().decode(pt), key: btoa(s)};',
  '}'
].join('\n');

// ---- payload -------------------------------------------------------

/**
 * generateGatedSectionPayload(secretHTMLContent, passphrase, options?)
 * options: {sectionId, iterations (tests), saltHex, ivHex (reproducible builds)}
 * → {html, saltHex, ivHex, cipherHex, tagHex, iterations, sectionId}
 * Throws bad_input / missing_credential.
 */
function generateGatedSectionPayload(secretHTMLContent, passphrase, options) {
  const secret = String(secretHTMLContent == null ? '' : secretHTMLContent);
  if (!secret) throw fail('bad_input', 'secretHTMLContent is required');
  const pw = String(passphrase == null ? '' : passphrase);
  if (!pw) throw fail('missing_credential', 'passphrase is required');
  const o = options || {};
  const iterationsRaw = Number(o.iterations);
  const iterations = Number.isFinite(iterationsRaw) && iterationsRaw >= 1
    ? Math.floor(iterationsRaw) : PBKDF2_ITERATIONS;

  const salt = o.saltHex != null ? fromHex(o.saltHex, SALT_BYTES, 'saltHex')
    : crypto.randomBytes(SALT_BYTES);
  const iv = o.ivHex != null ? fromHex(o.ivHex, IV_BYTES, 'ivHex')
    : crypto.randomBytes(IV_BYTES);

  const key = crypto.pbkdf2Sync(pw, salt, iterations, KEY_BYTES, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  const sectionId = String(o.sectionId || '').replace(/[^\w-]/g, '')
    || 'pai-gate-' + toHex(salt).slice(0, 8);
  const html = '<section class="pai-gate" id="' + sectionId + '" data-pai-gate="1"'
    + ' data-pai-ct="' + toHex(ct) + '" data-pai-tag="' + toHex(tag) + '">'
    + '<form class="pai-gate-form" data-pai-form novalidate>'
    + '<label class="pai-gate-label" for="' + sectionId + '-pw">Password</label>'
    + '<input class="pai-gate-input" id="' + sectionId + '-pw" type="password"'
    + ' data-pai-pw autocomplete="current-password" required>'
    + '<button class="pai-gate-btn" type="submit">Unlock</button>'
    + '<p class="pai-gate-error" data-pai-error role="alert" hidden></p>'
    + '</form>'
    + '<script>(function(){var s=document.getElementById(' + JSON.stringify(sectionId) + ');'
      + 'if(!s)return;'
      + 's.addEventListener("submit",function(e){e.preventDefault();e.stopPropagation();'
      + 'var p=s.querySelector("[data-pai-pw]"),a=window.paiGateAuth;'
      + 'if(a&&a.unlock)a.unlock(s,p?p.value:"");})})();<\/script>'
    + '</section>';
  return {
    html,
    saltHex: toHex(salt),
    ivHex: toHex(iv),
    cipherHex: toHex(ct),
    tagHex: toHex(tag),
    iterations,
    sectionId
  };
}

// ---- the unlock script --------------------------------------------

/**
 * generateClientUnlockScript(saltHex, ivHex, options?) → inline JS.
 * salt/iv are build-time constants (they are public parameters —
 * confidentiality comes from the passphrase, not their secrecy);
 * per-section ciphertext rides in each section's data attributes.
 */
function generateClientUnlockScript(saltHex, ivHex, options) {
  const salt = fromHex(saltHex, SALT_BYTES, 'saltHex');
  const iv = fromHex(ivHex, IV_BYTES, 'ivHex');
  const o = options || {};
  const iterationsRaw = Number(o.iterations);
  const iterations = Number.isFinite(iterationsRaw) && iterationsRaw >= 1
    ? Math.floor(iterationsRaw) : PBKDF2_ITERATIONS;
  const cfg = JSON.stringify({ s: toHex(salt), i: toHex(iv), n: iterations })
    .replace(/<\//g, '<\\/')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

  return '(function(){'
    + 'var C=' + cfg + ',K="pai-gate-key",A=K+":att";'
    // -- embedded decrypt core (byte-identical to decryptCoreSource)
    + decryptCoreSource + ';'
    // -- base64 helpers (key is 32 bytes — apply() is safe)
    + 'function b64(u){var s="",i;for(i=0;i<u.length;i++)s+=String.fromCharCode(u[i]);return btoa(s)}'
    + 'function unb(s){var d=atob(s),u=new Uint8Array(d.length),i;'
      + 'for(i=0;i<d.length;i++)u[i]=d.charCodeAt(i);return u}'
    // -- session key (dies with the tab; lock() removes it)
    + 'function getK(){try{var s=sessionStorage.getItem(K);return s?unb(s):null}catch(e){return null}}'
    + 'function setK(b){try{sessionStorage.setItem(K,b)}catch(e){}}'
    + 'function clrK(){try{sessionStorage.removeItem(K)}catch(e){}}'
    // -- throttle state: {n: consecutive failures, u: locked-until ms}
    + 'function DELAY(n){return n<3?0:Math.min(3e4,1e3*Math.pow(2,n-3))}'
    + 'function att(){try{var a=JSON.parse(sessionStorage.getItem(A));'
      + 'return a&&typeof a==="object"?a:{n:0,u:0}}catch(e){return{n:0,u:0}}}'
    + 'function remember(a){try{sessionStorage.setItem(A,JSON.stringify(a))}catch(e){}}'
    // -- one generic message for every failure mode
    + 'function say(el,msg){var e=el.querySelector&&el.querySelector("[data-pai-error]");'
      + 'if(e){e.textContent=msg;e.hidden=false}}'
    + 'function mount(el,r){if(!el._restore)el._restore=el.innerHTML;'
      + 'el.innerHTML=r.text;el.dataset.paiUnlocked="1";setK(r.key);'
      + 'if(el.dispatchEvent)el.dispatchEvent(new CustomEvent("pai:gate-unlocked",{bubbles:true}))}'
    + 'async function unlock(el,pass){'
      + 'if(!el||!el.dataset||el.dataset.paiUnlocked)return true;'
      + 'var a=att();'
      + 'if(a.u>Date.now()){say(el,"Too many attempts — try again in "+'
        + 'Math.max(1,Math.ceil((a.u-Date.now())/1e3))+"s");return false}'
      + 'if(!(self.crypto&&crypto.subtle)||!el.dataset.paiCt){say(el,"Unlock unavailable");return false}'
      + 'try{var r=await paiGateDecrypt(crypto,{passphrase:String(pass||"")},'
        + 'C.s,C.i,el.dataset.paiCt,el.dataset.paiTag,C.n);mount(el,r);'
        + 'remember({n:0,u:0});return true}'
      + 'catch(err){a=att();a.n++;a.u=Date.now()+DELAY(a.n);remember(a);'
        + 'say(el,a.u>Date.now()&&a.n>2?"Too many attempts — try again in "+'
          + 'Math.max(1,Math.ceil((a.u-Date.now())/1e3))+"s":"Incorrect password");return false}}'
    // -- session resume: silent decrypt with the stored key
    + 'function resume(){var k=getK();if(!k)return;'
      + 'var els=document.querySelectorAll("[data-pai-gate]"),i;'
      + 'for(i=0;i<els.length;i++)(function(el){'
        + 'if(el.dataset.paiUnlocked)return;'
        + 'paiGateDecrypt(crypto,{key:k},C.s,C.i,el.dataset.paiCt,el.dataset.paiTag,C.n)'
        + '.then(function(r){mount(el,r)})'
        + '.catch(function(){clrK()})})(els[i])}'
    + 'function lock(){clrK();var els=document.querySelectorAll("[data-pai-gate]"),i,el;'
      + 'for(i=0;i<els.length;i++){el=els[i];'
        + 'if(el.dataset.paiUnlocked&&el._restore){el.innerHTML=el._restore;'
          + 'delete el.dataset.paiUnlocked}}}'
    // -- document-level fallback binding (payloads without their controller)
    + 'document.addEventListener("submit",function(e){'
      + 'var f=e.target;if(!f||!f.matches||!f.matches("[data-pai-form]"))return;'
      + 'e.preventDefault();'
      + 'var el=f.closest&&f.closest("[data-pai-gate]");if(!el)return;'
      + 'var p=f.querySelector("[data-pai-pw]");unlock(el,p?p.value:"")});'
    + 'window.paiGateAuth={'
      + 'unlock:function(el,pass){if(typeof el==="string")el=document.querySelector(el);'
        + 'return unlock(el,pass)},'
      + 'lock:lock,attemptDelayMs:DELAY};'
    + 'if(document.readyState==="loading")'
      + 'document.addEventListener("DOMContentLoaded",resume);else resume()'
    + '})();';
}

module.exports = {
  PBKDF2_ITERATIONS,
  SALT_BYTES,
  IV_BYTES,
  TAG_BYTES,
  attemptDelayMs,
  decryptCoreSource,
  generateGatedSectionPayload,
  generateClientUnlockScript
};
