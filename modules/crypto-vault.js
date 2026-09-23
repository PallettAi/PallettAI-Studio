// ============================================================
// PallettAI Studio — CryptoVault
// Encrypted credential storage for deployment tokens
// (Netlify, Cloudflare, GitHub, Formspree, Supabase…).
//
// encryptSecret(plainTextSecret, masterPassphrase)
//   AES-256-GCM with PBKDF2-HMAC-SHA256 (100,000 iterations,
//   16-byte random salt, 8-byte random IV). Authentication tag
//   included — wrong passphrases fail GCM auth, they do not
//   yield garbage. Output is a self-describing JSON payload:
//     { v, kdf:'pbkdf2-sha256', iter, salt, iv, tag, ct }
//   Passing a previously-encrypted payload back in is rejected —
//   double encryption is a bug, not a feature.
//
// decryptSecret(encryptedPayload, masterPassphrase)
//   Reverse path; returns the UTF-8 plaintext or throws a
//   precise error ('auth failed' never leaks into 'bad format').
//
// safeStorage bridge (Electron):
//   isSafeStorageAvailable() / encryptWithSafeStorage() /
//   decryptWithSafeStorage() wrap Electron's OS-keychain
//   protection when running inside Electron. AWT/os_crypt/
//   Keychain services are used instead of (or as a wrapper
//   around) the passphrase-derived key when present.
//
// Memory hygiene: plaintext buffers are zero-filled after use
// where the runtime allows (Buffer#fill(0)) — best-effort in JS,
// stated honestly.
//
// Zero dependencies beyond Node crypto. CommonJS + browser global
// (crypto.subtle path for the browser build).
// ============================================================
(function () {
  'use strict';

  // Node's crypto in CommonJS; browsers (classic script) fall back to
  // the global webcrypto — the SYNC passphrase path is Node-only by
  // design, the async subtle path covers browsers.
  var crypto;
  try { crypto = require('crypto'); } catch (e) {
    crypto = (typeof globalThis !== 'undefined' && globalThis.crypto) ? globalThis.crypto : undefined;
  }

  const vault = {};

  var PBKDF2_ITERATIONS = 100000;
  var SALT_BYTES = 16;
  var IV_BYTES = 12;
  var KEY_BYTES = 32; // AES-256

  vault.PBKDF2_ITERATIONS = PBKDF2_ITERATIONS;

  /* ============================================================
     safeStorage bridge (Electron)
     ============================================================ */

  var _electron;

  function getElectron() {
    if (_electron !== undefined) return _electron;
    _electron = null;
    try {
      // In the main process Electron exposes safeStorage directly.
      if (typeof require === 'function') {
        var electron = require('electron');
        if (electron && electron.safeStorage) {
          _electron = electron;
          return _electron;
        }
      }
    } catch (e) { /* not in Electron */ }
    try {
      // In a renderer with nodeIntegration, remote access is the
      // historical path — intentionally NOT used; renderers should
      // go through IPC instead. Plain require fails outside Electron.
    } catch (e) { /* ignore */ }
    return _electron;
  }

  /**
   * isSafeStorageAvailable()
   * True when the OS-level secret store is ready to use.
   */
  vault.isSafeStorageAvailable = function () {
    var e = getElectron();
    if (!e || !e.safeStorage) return false;
    try {
      return typeof e.safeStorage.isEncryptionAvailable === 'function'
        ? e.safeStorage.isEncryptionAvailable()
        : false;
    } catch (err) {
      return false;
    }
  };

  /**
   * encryptWithSafeStorage(plainTextSecret)
   * OS-keychain-backed encryption (DPAPI on Windows, Keychain on
   * macOS, libsecret on Linux). Returns Buffer or null.
   */
  vault.encryptWithSafeStorage = function (plainTextSecret) {
    var e = getElectron();
    if (!e || !e.safeStorage || !vault.isSafeStorageAvailable()) return null;
    try {
      return e.safeStorage.encryptString(String(plainTextSecret));
    } catch (err) {
      return null;
    }
  };

  /**
   * decryptWithSafeStorage(encryptedBuffer)
   * Returns plaintext string or null.
   */
  vault.decryptWithSafeStorage = function (encryptedBuffer) {
    var e = getElectron();
    if (!e || !e.safeStorage) return null;
    try {
      return e.safeStorage.decryptString(encryptedBuffer);
    } catch (err) {
      return null;
    }
  };

  /* ============================================================
     passphrase-derived path (AES-256-GCM + PBKDF2)
     ============================================================ */

  function bufferFromB64(s) { return Buffer.from(String(s), 'base64'); }

  function isEncryptedPayload(p) {
    if (!p) return false;
    if (typeof p === 'object' && !Buffer.isBuffer(p)) {
      return typeof p.ct === 'string' && typeof p.iv === 'string' &&
        typeof p.salt === 'string' && typeof p.tag === 'string';
    }
    if (typeof p === 'string') {
      // Strings that parse into an envelope shape count too — catching
      // an encrypted-JSON string passed back in as "plaintext".
      try {
        var o = JSON.parse(p);
        return isEncryptedPayload(o);
      } catch (e) { return false; }
    }
    return false;
  }

  function zero(buf) {
    try { if (buf && buf.fill) buf.fill(0); } catch (e) { /* best effort */ }
  }

  function deriveKeyBuffer(passphrase, saltBuf, iterations) {
    return crypto.pbkdf2Sync(String(passphrase), saltBuf, iterations, KEY_BYTES, 'sha256');
  }

  /**
   * encryptSecret(plainTextSecret, masterPassphrase, options)
   * @param {string} plainTextSecret
   * @param {string} masterPassphrase
   * @param {object} [options] { iterations, preferSafeStorage }
   * @returns {{ ok, payload, envelope: string, meta: {kdf, iterations, safeStorage} } |
   *           { ok: false, error }}
   */
  vault.encryptSecret = function (plainTextSecret, masterPassphrase, options) {
    if (typeof plainTextSecret !== 'string' || !plainTextSecret.length) {
      return { ok: false, error: 'plainTextSecret must be a non-empty string.' };
    }
    if (typeof masterPassphrase !== 'string' || masterPassphrase.length < 8) {
      return { ok: false, error: 'masterPassphrase must be at least 8 characters.' };
    }
    var opts = options || {};

    // Optional OS-level path: wrap the secret with the OS keychain
    // instead of a passphrase. Returned separately — never mixed
    // into the passphrase payload.
    if (opts.preferSafeStorage && vault.isSafeStorageAvailable()) {
      var enc = vault.encryptWithSafeStorage(plainTextSecret);
      if (enc) {
        return {
          ok: true,
          payload: null,
          envelope: enc.toString('base64'),
          meta: { kdf: 'safeStorage', iterations: 0, safeStorage: true }
        };
      }
      // fall through to passphrase path if OS encryption refused
    }

    if (isEncryptedPayload(plainTextSecret)) {
      return { ok: false, error: 'Refusing to double-encrypt an existing payload.' };
    }

    var iter = Math.max(100000, Number(opts.iterations) || PBKDF2_ITERATIONS);
    var salt = crypto.randomBytes(SALT_BYTES);
    var iv = crypto.randomBytes(IV_BYTES);
    var key = deriveKeyBuffer(masterPassphrase, salt, iter);

    var cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    var pt = Buffer.from(plainTextSecret, 'utf8');
    var ct = Buffer.concat([cipher.update(pt), cipher.final()]);
    var tag = cipher.getAuthTag();

    zero(pt);
    zero(key);

    var payload = {
      v: 1,
      kdf: 'pbkdf2-sha256',
      iter: iter,
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      ct: ct.toString('base64')
    };

    return {
      ok: true,
      payload: payload,
      envelope: JSON.stringify(payload),
      meta: { kdf: 'pbkdf2-sha256', iterations: iter, safeStorage: false }
    };
  };

  /**
   * decryptSecret(encryptedPayload, masterPassphrase, options)
   * @param {object|string} encryptedPayload  payload object or JSON envelope
   * @param {string} masterPassphrase
   * @param {object} [options] { safeStorage: true (try OS keychain first) }
   * @returns {{ ok, secret, meta: {kdf, iterations} } |
   *           { ok: false, error }}
   */
  vault.decryptSecret = function (encryptedPayload, masterPassphrase, options) {
    var opts = options || {};

    // safeStorage envelopes: { kdf:'safeStorage', data:<base64> }
    if (encryptedPayload && typeof encryptedPayload === 'object' && encryptedPayload.kdf === 'safeStorage') {
      var buf = Buffer.from(String(encryptedPayload.data || ''), 'base64');
      var s = vault.decryptWithSafeStorage(buf);
      if (s == null) return { ok: false, error: 'safeStorage decryption failed.' };
      return { ok: true, secret: s, meta: { kdf: 'safeStorage', iterations: 0 } };
    }

    var payload = encryptedPayload;
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload); } catch (e) {
        return { ok: false, error: 'Payload is not valid JSON.' };
      }
    }
    if (!isEncryptedPayload(payload)) {
      return { ok: false, error: 'Payload is not a recognizable encrypted envelope.' };
    }
    if (payload.kdf !== 'pbkdf2-sha256' || payload.v !== 1) {
      return { ok: false, error: 'Unsupported payload format (kdf ' + payload.kdf + ', v ' + payload.v + ').' };
    }

    var iter = Number(payload.iter);
    if (!isFinite(iter) || iter < 100000) {
      return { ok: false, error: 'Payload iteration count is implausible — refusing.' };
    }

    var salt, iv, tag, ct;
    try {
      salt = bufferFromB64(payload.salt);
      iv = bufferFromB64(payload.iv);
      tag = bufferFromB64(payload.tag);
      ct = bufferFromB64(payload.ct);
    } catch (e) {
      return { ok: false, error: 'Payload fields are not valid base64.' };
    }
    if (salt.length !== SALT_BYTES) return { ok: false, error: 'Salt length mismatch.' };
    if (iv.length !== IV_BYTES) return { ok: false, error: 'IV length mismatch.' };
    if (tag.length !== 16) return { ok: false, error: 'Auth tag length mismatch.' };
    if (!ct.length) return { ok: false, error: 'Ciphertext is empty.' };

    var key = deriveKeyBuffer(String(masterPassphrase), salt, iter);
    var out = null;
    try {
      var decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      out = Buffer.concat([decipher.update(ct), decipher.final()]); // throws on auth failure
      var secret = out.toString('utf8');
      zero(out);
      zero(key);
      return { ok: true, secret: secret, meta: { kdf: 'pbkdf2-sha256', iterations: iter } };
    } catch (err) {
      zero(out);
      zero(key);
      return { ok: false, error: 'Authentication failed — wrong passphrase or corrupted payload.' };
    }
  };

  /* ============================================================
     vault file helpers
     ============================================================ */

  var VAULT_VERSION = 1;

  /**
   * writeVault(vaultPath, secrets, masterPassphrase)
   * One envelope per secret, keyed by service label. Atomic write.
   * @param {object} secrets  { 'netlify': 'nfp_...', 'cloudflare': '...' }
   * @returns {{ ok, count, envelopeBytes }} | { ok: false, error }
   */
  vault.writeVault = function (vaultPath, secrets, masterPassphrase) {
    if (!vaultPath) return { ok: false, error: 'vaultPath is required.' };
    if (!secrets || typeof secrets !== 'object') return { ok: false, error: 'secrets map is required.' };
    var fs = require('fs');
    var path = require('path');
    var entries = {};
    var count = 0;
    for (var label in secrets) {
      if (!Object.prototype.hasOwnProperty.call(secrets, label)) continue;
      var value = secrets[label];
      if (value == null || value === '') continue;
      var r = vault.encryptSecret(String(value), masterPassphrase);
      if (!r.ok) return { ok: false, error: label + ': ' + r.error };
      entries[label] = r.payload;
      count++;
    }
    var envelope = JSON.stringify({ v: VAULT_VERSION, created: new Date().toISOString(), secrets: entries }, null, 2);
    try {
      fs.mkdirSync(path.dirname(path.resolve(vaultPath)), { recursive: true });
      var tmp = vaultPath + '.tmp-' + require('crypto').randomBytes(4).toString('hex');
      fs.writeFileSync(tmp, envelope);
      fs.renameSync(tmp, vaultPath);
    } catch (e) {
      return { ok: false, error: 'vault write failed: ' + (e && e.message ? e.message : String(e)) };
    }
    return { ok: true, count: count, envelopeBytes: Buffer.byteLength(envelope) };
  };

  /**
   * readVault(vaultPath, masterPassphrase)
   * Decrypts every entry; per-entry failures are reported without
   * aborting the rest.
   * @returns {{ ok, secrets: {label: plaintext}, errors: {label: reason} } |
   *           { ok: false, error }}
   */
  vault.readVault = function (vaultPath, masterPassphrase) {
    if (!vaultPath) return { ok: false, error: 'vaultPath is required.' };
    var fs = require('fs');
    var raw;
    try { raw = fs.readFileSync(vaultPath, 'utf8'); } catch (e) {
      return { ok: false, error: 'vault file unreadable: ' + (e && e.code ? e.code : String(e)) };
    }
    var box;
    try { box = JSON.parse(raw); } catch (e) {
      return { ok: false, error: 'vault file is not valid JSON.' };
    }
    if (!box || box.v !== VAULT_VERSION || !box.secrets) {
      return { ok: false, error: 'Unsupported vault envelope.' };
    }
    var secrets = {}, errors = {};
    Object.keys(box.secrets).forEach(function (label) {
      var r = vault.decryptSecret(box.secrets[label], masterPassphrase);
      if (r.ok) secrets[label] = r.secret;
      else errors[label] = r.error;
    });
    return { ok: Object.keys(errors).length === 0, secrets: secrets, errors: errors };
  };

  /* ============================================================
     Web-crypto async path — identical envelope, no Buffer.
     Available in Electron renderers without nodeIntegration and
     in browsers. The payload it emits decrypts with decryptSecret,
     and vice versa — one envelope, two runtimes.
     ============================================================ */

  function abToB64(ab) {
    var bytes = new Uint8Array(ab);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return typeof btoa === 'function' ? btoa(bin) : Buffer.from(bytes).toString('base64');
  }

  function subtleCrypto() {
    if (typeof crypto !== 'undefined' && crypto.subtle) return crypto;
    return null;
  }

  vault.encryptSecretAsync = function (plainTextSecret, masterPassphrase, iterations) {
    var c = subtleCrypto();
    if (!c) return Promise.reject(new Error('crypto.subtle is unavailable in this context.'));
    if (typeof plainTextSecret !== 'string' || !plainTextSecret.length) {
      return Promise.reject(new Error('plainTextSecret must be a non-empty string.'));
    }
    if (typeof masterPassphrase !== 'string' || masterPassphrase.length < 8) {
      return Promise.reject(new Error('masterPassphrase must be at least 8 characters.'));
    }
    var iter = Math.max(100000, Number(iterations) || PBKDF2_ITERATIONS);
    var salt = c.getRandomValues(new Uint8Array(SALT_BYTES));
    var iv = c.getRandomValues(new Uint8Array(IV_BYTES));
    var enc = new TextEncoder();
    return c.subtle.importKey(
      'raw', enc.encode(masterPassphrase), 'PBKDF2', false, ['deriveKey']
    ).then(function (baseKey) {
      return c.subtle.deriveKey(
        { name: 'PBKDF2', salt: salt, iterations: iter, hash: 'SHA-256' },
        baseKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt']
      );
    }).then(function (aesKey) {
      // webcrypto AES-GCM output is ct || tag (tag is the last 16 bytes).
      return c.subtle.encrypt({ name: 'AES-GCM', iv: iv }, aesKey, enc.encode(plainTextSecret));
    }).then(function (ctAndTag) {
      var all = new Uint8Array(ctAndTag);
      var ct = all.slice(0, all.length - 16);
      var tag = all.slice(all.length - 16);
      return {
        v: 1,
        kdf: 'pbkdf2-sha256',
        iter: iter,
        salt: abToB64(salt),
        iv: abToB64(iv),
        tag: abToB64(tag),
        ct: abToB64(ct)
      };
    });
  };

  vault.decryptSecretAsync = function (encryptedPayload, masterPassphrase) {
    var c = subtleCrypto();
    if (!c) return Promise.reject(new Error('crypto.subtle is unavailable in this context.'));
    var payload = encryptedPayload;
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload); } catch (e) {
        return Promise.reject(new Error('Payload is not valid JSON.'));
      }
    }
    if (!isEncryptedPayload(payload)) {
      return Promise.reject(new Error('Payload is not a recognizable encrypted envelope.'));
    }
    var iter = Number(payload.iter);
    if (!isFinite(iter) || iter < 100000) {
      return Promise.reject(new Error('Payload iteration count is implausible — refusing.'));
    }
    var salt = bufferFromB64(payload.salt);
    var iv = bufferFromB64(payload.iv);
    var tag = bufferFromB64(payload.tag);
    var ct = bufferFromB64(payload.ct);
    var enc = new TextEncoder();
    return c.subtle.importKey(
      'raw', enc.encode(String(masterPassphrase)), 'PBKDF2', false, ['deriveKey']
    ).then(function (baseKey) {
      return c.subtle.deriveKey(
        { name: 'PBKDF2', salt: salt, iterations: iter, hash: 'SHA-256' },
        baseKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt']
      );
    }).then(function (aesKey) {
      var joined = new Uint8Array(ct.length + tag.length);
      joined.set(ct, 0);
      joined.set(tag, ct.length);
      return c.subtle.decrypt({ name: 'AES-GCM', iv: iv }, aesKey, joined);
    }).then(function (ptBuf) {
      return new TextDecoder().decode(ptBuf);
    });
  };

  /* ---------------- exports ---------------- */

  vault._internals = { SALT_BYTES: SALT_BYTES, IV_BYTES: IV_BYTES, KEY_BYTES: KEY_BYTES };

  if (typeof module !== 'undefined' && module.exports) module.exports = vault;
})();
