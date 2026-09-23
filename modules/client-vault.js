'use strict';
// ============================================================
// PallettAI Studio — AES-GCM client password vault
// Password-gated content on a 100% static site: the HTML ships
// encrypted, the password never does, and the browser does the
// decryption with native Web Crypto. No server, no cookies.
// ------------------------------------------------------------
//   1. encryptSectionContent(htmlContent, password)
//      AES-256-GCM with a PBKDF2-SHA256 derived key
//      (100,000 iterations, fresh 16-byte salt, 12-byte IV).
//      Returns base64 fields ready to inline into a page, plus
//      a node-side decryptSectionContent() inverse for tests
//      and tooling.
//   2. generateVaultUnlockScript(encryptedData, salt, iv, tag)
//      A self-contained fragment: styled unlock card + a
//      browser-native decryptor built on window.crypto.subtle.
//      The decrypt core is one source string
//      (browserDecryptCore()) embedded verbatim — the smoke
//      runner evaluates THAT SAME source under Node's spec-
//      compliant WebCrypto, so the browser path is proven to
//      work, not merely eyeballed.
//   3. The card: labelled password input, role="alert" error
//      feedback (shake + aria-invalid + focus back on the
//      input), busy state on the button, and a smooth fade
//      into the decrypted DOM once the tag verifies.
//
// ---- what this file guarantees ----------------------------------
// 1. CONFIDENTIALITY IS AUTHENTICATED. AES-GCM's 16-byte tag
//    means a tampered ciphertext or a wrong password cannot
//    produce "close enough" output — subtle.decrypt rejects or
//    nothing is revealed.
// 2. THE PLAINTEXT IS NEVER IN THE PAGE SOURCE. Content exists
//    on disk only as ct||tag bytes; it enters the DOM after a
//    successful derive+decrypt.
// 3. KEY DERIVATION IS DELIBERATELY EXPENSIVE: 100k SHA-256
//    iterations per attempt (PBKDF2_ITERATIONS, exported and
//    interpolated into both sides) so weak passwords cost the
//    attacker the same work they cost us.
// 4. ALL CONFIG STRINGS reach the script through
//    JSON.stringify and the card markup through esc() — no
//    injection surface between project data and page source.
// ============================================================

const crypto = require('crypto');

const PBKDF2_ITERATIONS = 100000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BITS = 256;
const TAG_BYTES = 16;
const ALGO = 'AES-256-GCM';

// ---- node-side crypto ---------------------------------------------------

function deriveKey(password, salt, iterations) {
  return crypto.pbkdf2Sync(
    String(password), salt,
    iterations || PBKDF2_ITERATIONS, KEY_BITS / 8, 'sha256'
  );
}

function assertPassword(password) {
  if (password == null || String(password) === '') {
    const e = new Error('a password is required to encrypt a section');
    e.code = 'bad_input';
    throw e;
  }
  return String(password);
}

/**
 * Encrypt an HTML block for gated delivery.
 * Returns { encryptedData, salt, iv, tag, iterations, algo } — all
 * byte fields base64, ready to inline into generateVaultUnlockScript.
 */
function encryptSectionContent(htmlContent, password) {
  if (htmlContent == null || String(htmlContent) === '') {
    const e = new Error('htmlContent is required');
    e.code = 'bad_input';
    throw e;
  }
  const pw = assertPassword(password);
  const salt = crypto.randomBytes(SALT_BYTES);
  const iv = crypto.randomBytes(IV_BYTES);
  const key = deriveKey(pw, salt, PBKDF2_ITERATIONS);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(htmlContent), 'utf8'), cipher.final()]);
  return {
    encryptedData: ct.toString('base64'),
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    iterations: PBKDF2_ITERATIONS,
    algo: ALGO
  };
}

/**
 * Node-side inverse of encryptSectionContent — used by the smoke
 * runner to prove the full PBKDF2/AES-GCM cycle recovers the exact
 * payload, and by tooling that needs to re-read a section.
 */
function decryptSectionContent(payload, password) {
  const p = payload || {};
  try {
    const salt = Buffer.from(String(p.salt || ''), 'base64');
    const iv = Buffer.from(String(p.iv || ''), 'base64');
    const tag = Buffer.from(String(p.tag || ''), 'base64');
    const ct = Buffer.from(String(p.encryptedData || ''), 'base64');
    if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
      const e = new Error('payload fields are missing or truncated');
      e.code = 'bad_payload';
      throw e;
    }
    const key = deriveKey(assertPassword(password), salt, p.iterations || PBKDF2_ITERATIONS);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch (e) {
    if (e.code === 'bad_input' || e.code === 'bad_payload') throw e;
    const err = new Error('wrong password or tampered content');
    err.code = 'auth_failed';
    throw err;
  }
}

// ---- browser-side decrypt core -----------------------------------------
/**
 * The exact source of the decryptor, exported so the smoke runner can
 * evaluate it under Node's spec-compliant crypto.subtle. WebCrypto's
 * AES-GCM takes ciphertext WITH the 16-byte tag appended — hence the
 * manual concat before decrypt().
 */
function browserDecryptCore(iterations) {
  const iters = Number(iterations) || PBKDF2_ITERATIONS;
  return 'function paiUnlock(ct,salt,iv,tag,pw){'
    + 'var u=function(b){var s=atob(b),a=new Uint8Array(s.length);'
    + 'for(var i=0;i<s.length;i++)a[i]=s.charCodeAt(i);return a;};'
    + 'var enc=new TextEncoder();'
    + 'return crypto.subtle.importKey("raw",enc.encode(pw),{name:"PBKDF2"},false,["deriveKey"])'
    + '.then(function(km){return crypto.subtle.deriveKey('
    + '{name:"PBKDF2",salt:u(salt),iterations:' + iters + ',hash:"SHA-256"},km,'
    + '{name:"AES-GCM",length:256},false,["decrypt"]);})'
    + '.then(function(k){var c=u(ct),t=u(tag);'
    + 'var both=new Uint8Array(c.length+t.length);both.set(c);both.set(t,c.length);'
    + 'return crypto.subtle.decrypt({name:"AES-GCM",iv:u(iv)},k,both);})'
    + '.then(function(p){return new TextDecoder().decode(p);});}';
}

// ---- unlock UI fragment -------------------------------------------------
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const DEFAULT_TITLE = 'Protected content';
const DEFAULT_HINT = 'Enter the password to unlock this section.';
const DEFAULT_ERR = 'Incorrect password — please try again.';
const DEFAULT_BTN = 'Unlock';
const DEFAULT_BUSY = 'Unlocking…';

function vaultStyles() {
  // Static layout only + one error shake. The keyframes and the
  // transform rule both ship behind a reduce guard so a visitor who
  // dislikes motion gets instant, silent feedback instead.
  return [
    '.pai-vault{transition:opacity .28s ease}',
    '.pai-vault-card{max-width:420px;margin:2rem auto;padding:1.6rem 1.4rem;',
    '  border:1px solid var(--line,rgba(127,127,127,.25));border-radius:16px;',
    '  background:var(--surface,rgba(127,127,127,.05));color:var(--text,inherit);',
    '  text-align:center;font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}',
    '.pai-vault-ic{display:inline-grid;place-items:center;width:44px;height:44px;border-radius:50%;',
    '  background:var(--primary,#2f6fed);color:#fff;margin-bottom:.5rem}',
    '.pai-vault-t{margin:0 0 .25rem;font-size:1.05rem;letter-spacing:-.01em}',
    '.pai-vault-h{margin:0 0 1rem;font-size:.85rem;color:var(--muted,#5f6b7a)}',
    '.pai-vault-row{display:flex;gap:.5rem}',
    '.pai-vault-in{flex:1 1 auto;min-width:0;padding:.6rem .75rem;border-radius:10px;',
    '  border:1px solid var(--line,rgba(127,127,127,.35));background:transparent;',
    '  color:inherit;font:inherit}',
    '.pai-vault-in:focus-visible{outline:2px solid var(--primary,#2f6fed);outline-offset:1px}',
    '.pai-vault-in[aria-invalid="true"]{border-color:#d64545}',
    '.pai-vault-btn{padding:.6rem 1.1rem;border:0;border-radius:10px;cursor:pointer;',
    '  background:var(--primary,#2f6fed);color:#fff;font:inherit;font-weight:650}',
    '.pai-vault-btn:disabled{opacity:.6;cursor:wait}',
    '.pai-vault-err{margin:.6rem 0 0;font-size:.8rem;color:#d64545;font-weight:600}',
    '.pai-vault-err[hidden]{display:none}',
    '.pai-vault-err.is-shake{animation:pai-vault-shake .32s ease}',
    '@keyframes pai-vault-shake{',
    '  0%,100%{transform:translateX(0)}25%{transform:translateX(-4px)}75%{transform:translateX(4px)}',
    '}',
    '@media (prefers-reduced-motion: reduce){',
    '  .pai-vault,.pai-vault-btn{transition:none !important}',
    '  .pai-vault-err.is-shake{animation:none !important}',
    '}'
  ].join('\n');
}

/**
 * generateVaultUnlockScript(encryptedData, salt, iv, tag, options?)
 * → self-contained HTML fragment: unlock card + decryptor script.
 * Accepts either four base64 strings or the object returned by
 * encryptSectionContent() passed as the first argument.
 */
function generateVaultUnlockScript(encryptedData, salt, iv, tag, options) {
  // Flexible arity: (payloadObject, options?) as well as
  // (ct, salt, iv, tag, options).
  let ct = encryptedData;
  let opts = options || {};
  if (ct && typeof ct === 'object') {
    const p = ct;
    opts = salt && typeof salt === 'object' ? salt : {};
    ct = p.encryptedData;
    iv = p.iv;
    tag = p.tag;
    salt = p.salt;
    if (!opts.iterations && p.iterations) opts.iterations = p.iterations;
  }
  if (ct == null || salt == null || iv == null || tag == null) {
    const e = new Error('encryptedData, salt, iv and tag are all required');
    e.code = 'bad_input';
    throw e;
  }
  const o = opts || {};
  const id = String(o.id || 'pai-vault').replace(/[^\w-]/g, '') || 'pai-vault';
  const cfg = {
    id,
    title: String(o.title || DEFAULT_TITLE),
    hint: String(o.hint || DEFAULT_HINT),
    err: String(o.errorMessage || DEFAULT_ERR),
    btn: String(o.buttonLabel || DEFAULT_BTN),
    busy: String(o.busyLabel || DEFAULT_BUSY)
  };
  const iterations = Number(o.iterations) || PBKDF2_ITERATIONS;
  const inputId = id + '-pw';
  const errId = id + '-err';

  const card = '<div class="pai-vault" id="' + id + '">'
    + '<style>' + vaultStyles() + '</style>'
    + '<form class="pai-vault-card" data-pai-vault-form>'
    + '<span class="pai-vault-ic" aria-hidden="true">'
    + '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" focusable="false">'
    + '<rect x="4" y="10" width="16" height="10" rx="2.5" stroke="currentColor" stroke-width="2"/>'
    + '<path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
    + '</svg></span>'
    + '<h3 class="pai-vault-t">' + esc(cfg.title) + '</h3>'
    + '<p class="pai-vault-h">' + esc(cfg.hint) + '</p>'
    + '<div class="pai-vault-row">'
    + '<label class="pai-vault-l" for="' + inputId + '" style="position:absolute;left:-100vw">Password</label>'
    + '<input class="pai-vault-in" id="' + inputId + '" name="password" type="password"'
    + ' autocomplete="current-password" required'
    + ' aria-describedby="' + errId + '" placeholder="Password">'
    + '<button class="pai-vault-btn" type="submit">' + esc(cfg.btn) + '</button>'
    + '</div>'
    + '<p class="pai-vault-err" id="' + errId + '" role="alert" hidden></p>'
    + '</form></div>';

  const script = '<script>(function(){'
    + 'var c=' + JSON.stringify(cfg) + ';'
    + 'var box=document.getElementById(c.id);if(!box)return;'
    + 'var form=box.querySelector("[data-pai-vault-form]");'
    + 'var input=document.getElementById(' + JSON.stringify(inputId) + ');'
    + 'var err=document.getElementById(' + JSON.stringify(errId) + ');'
    + 'var btn=form.querySelector("button");'
    // Payload lives only here — never in markup a crawler reads.
    + 'var CT=' + JSON.stringify(String(ct)) + ',SA=' + JSON.stringify(String(salt))
    + ',IV=' + JSON.stringify(String(iv)) + ',TG=' + JSON.stringify(String(tag)) + ';'
    + browserDecryptCore(iterations) + ';'
    + 'function fail(){input.setAttribute("aria-invalid","true");'
    + 'err.textContent=c.err;err.hidden=false;'
    + 'err.classList.remove("is-shake");void err.offsetWidth;err.classList.add("is-shake");'
    + 'input.focus();if(input.select)input.select();}'
    + 'form.addEventListener("submit",function(e){e.preventDefault();'
    + 'if(!input.value||form.busy)return;form.busy=1;'
    + 'btn.disabled=true;btn.textContent=c.busy;form.setAttribute("aria-busy","true");'
    + 'paiUnlock(CT,SA,IV,TG,input.value).then(function(html){'
    // Smooth hand-off: fade the card out, swap the DOM, fade back in.
    + 'box.style.opacity="0";'
    + 'var swap=function(){box.innerHTML=html;box.style.opacity="1";'
    + 'box.removeAttribute("data-locked");};'
    + 'var done=false,timer=setTimeout(function(){if(!done){done=true;swap();}},320);'
    + 'box.addEventListener("transitionend",function h(){if(done)return;done=true;'
    + 'clearTimeout(timer);box.removeEventListener("transitionend",h);swap();},{once:true});'
    + '}).catch(function(){'
    + 'form.busy=0;btn.disabled=false;btn.textContent=c.btn;'
    + 'form.removeAttribute("aria-busy");fail();});});'
    + 'if(input)input.focus();'
    + '})();</script>';

  return card + script;
}

module.exports = {
  PBKDF2_ITERATIONS,
  SALT_BYTES,
  IV_BYTES,
  TAG_BYTES,
  ALGO,
  deriveKey,
  encryptSectionContent,
  decryptSectionContent,
  browserDecryptCore,
  generateVaultUnlockScript,
  vaultStyles
};
