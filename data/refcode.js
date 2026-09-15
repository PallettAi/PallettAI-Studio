'use strict';

// ============================================================
// Offline referral codes — a code that proves itself.
// ------------------------------------------------------------
// Today a referral code only means something if the registry is reachable:
// everything is checked server-side, which is correct but leaves the app
// unable to honour a code when the registry is down, paused, or over its free
// tier quota. That is the exact moment a customer is most likely to be trying.
//
// So a code can also carry its own proof. PallettAI signs the payload with a
// private key that never leaves PallettAI; the app carries only the matching
// public key and verifies it with WebCrypto, on the machine, with no network.
// A forged code cannot be minted without the private key, and a tampered one
// fails the signature, so the offline path is a real check rather than a
// checksum that tells you a string looks about right.
//
// The format is deliberately boring and copy-pasteable:
//
//   PAL-REF-<kind>-<issuedAt>-<validUntil>-<signature>
//
//   kind        a known reward, e.g. "pro30"
//   issuedAt    Unix seconds
//   validUntil  Unix seconds
//   signature   128 hex characters — ECDSA P-256 / SHA-256, over the
//               canonical payload "<kind>.<issuedAt>.<validUntil>"
//
// Hex rather than base64url on purpose: base64url uses "-", which is the field
// separator, so a signature could split its own code. Hex cannot.
//
// `PUBLIC_KEY` is set below from `npm run refcode:keygen`. If it is ever
// cleared (a fresh clone before the key is installed), the module stays honest
// about it — it reports "not-configured" rather than pretending a code failed.
// ============================================================

const RefCode = (() => {

  // The rewards a code can carry. Anything not in here is rejected before the
  // signature is even checked, so a leaked private key still cannot be used to
  // mint an arbitrary entitlement.
  const KINDS = {
    ref7:   { label: '7 days of Pro',  proDays: 7 },
    ref30:  { label: '30 days of Pro', proDays: 30 },
    pro30:  { label: '30 days of Pro', proDays: 30 },
    pro90:  { label: '90 days of Pro', proDays: 90 }
  };

  // PallettAI's public key (SPKI, base64), matching the private key in
  // `.refcode-private-key.txt` (gitignored). Public keys are not secret, so this
  // one is safe to commit. Empty means the offline path is off, and it says so
  // rather than failing codes it never checked.
  //
  // Settable at runtime only so the suite can install a throwaway test key and
  // exercise the whole signature path. It is not a bypass: the build is local,
  // so anyone who can call this could edit the file instead — which is the same
  // documented trade-off as every other client-side check in the app, and the
  // reason the registry stays the real enforcement.
  let PUBLIC_KEY = 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEvG43QweDwhmG6XdxxojhmIOczL/hhDSi3jVH9V7AuVdkSxkAoo5wbRJsyaK511Kfo7r9pxRs4/JPbfWUVG2pYQ==';

  function configure(publicKey) {
    PUBLIC_KEY = String(publicKey == null ? '' : publicKey).trim();
  }

  const PREFIX = 'PAL-REF-';
  const SIG_HEX = /^[0-9a-f]{128}$/;
  const KIND_OK = /^[a-z0-9]{2,16}$/;
  const TIME_OK = /^\d{9,11}$/;
  // A little slack for a clock that is a few minutes out, so an honest code is
  // not rejected because a laptop drifted.
  const SKEW_SECONDS = 300;

  const nowSeconds = (opts) => {
    if (opts && opts.now != null) {
      const d = opts.now instanceof Date ? opts.now : new Date(opts.now);
      if (!isNaN(d.getTime())) return Math.floor(d.getTime() / 1000);
    }
    return Math.floor(Date.now() / 1000);
  };

  function subtle() {
    /* global globalThis */
    if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle) return globalThis.crypto.subtle;
    try { return require('crypto').webcrypto.subtle; } catch (e) { return null; }
  }

  const hexToBytes = (hex) => {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  };

  const bytesToHex = (bytes) => {
    let s = '';
    for (let i = 0; i < bytes.length; i += 1) s += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
    return s;
  };

  const bytesToB64 = (bytes) => {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
    if (typeof btoa === 'function') return btoa(bin);
    return Buffer.from(bytes).toString('base64');
  };

  const b64ToBytes = (b64) => {
    if (typeof atob === 'function') {
      const bin = atob(b64);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
      return out;
    }
    return new Uint8Array(Buffer.from(b64, 'base64'));
  };

  const utf8 = (s) => {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(s);
    return new Uint8Array(Buffer.from(s, 'utf8'));
  };

  // What the signature actually covers. Rebuilt from the parsed fields rather
  // than sliced out of the code, so the two can never drift apart.
  const payloadFor = (kind, issuedAt, validUntil) => kind + '.' + issuedAt + '.' + validUntil;

  const isConfigured = () => PUBLIC_KEY.length > 40;

  // ---- parsing --------------------------------------------------------------
  // Pure and synchronous: no crypto, so a caller can reject garbage cheaply and
  // so the shape can be tested without a key.
  function parse(code) {
    const raw = String(code == null ? '' : code).trim().toUpperCase();
    if (!raw) return { ok: false, reason: 'empty' };
    if (raw.indexOf(PREFIX) !== 0) return { ok: false, reason: 'prefix' };
    const parts = raw.slice(PREFIX.length).split('-');
    if (parts.length !== 4) return { ok: false, reason: 'malformed' };
    const kind = parts[0].toLowerCase();
    const issuedAt = parts[1];
    const validUntil = parts[2];
    const sig = parts[3].toLowerCase();
    if (!KIND_OK.test(kind)) return { ok: false, reason: 'malformed' };
    if (!TIME_OK.test(issuedAt) || !TIME_OK.test(validUntil)) return { ok: false, reason: 'malformed' };
    if (!SIG_HEX.test(sig)) return { ok: false, reason: 'malformed' };
    const from = parseInt(issuedAt, 10);
    const until = parseInt(validUntil, 10);
    if (!(until > from)) return { ok: false, reason: 'malformed' };
    return {
      ok: true,
      reason: '',
      kind: kind,
      issuedAt: from,
      validUntil: until,
      sig: sig,
      payload: payloadFor(kind, from, until)
    };
  }

  // ---- verification --------------------------------------------------------
  // Async because WebCrypto is. Every failure names itself, because "invalid
  // code" is the message that makes a customer email support.
  async function verify(code, opts) {
    const o = opts || {};
    const parsed = parse(code);
    if (!parsed.ok) return { ok: false, reason: parsed.reason, label: '' };
    const kind = KINDS[parsed.kind];
    if (!kind) return { ok: false, reason: 'unknown-kind', label: '' };

    if (!isConfigured()) return { ok: false, reason: 'not-configured', label: '' };

    const s = subtle();
    if (!s) return { ok: false, reason: 'no-crypto', label: '' };

    let verified = false;
    try {
      const key = await s.importKey('spki', b64ToBytes(PUBLIC_KEY), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      verified = await s.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, hexToBytes(parsed.sig), utf8(parsed.payload));
    } catch (e) {
      return { ok: false, reason: 'bad-signature', label: '' };
    }
    if (!verified) return { ok: false, reason: 'bad-signature', label: '' };

    const at = nowSeconds(o);
    if (at + SKEW_SECONDS < parsed.issuedAt) {
      return { ok: false, reason: 'not-yet-valid', label: kind.label, kind: parsed.kind, issuedAt: parsed.issuedAt, validUntil: parsed.validUntil };
    }
    if (at - SKEW_SECONDS > parsed.validUntil) {
      return { ok: false, reason: 'expired', label: kind.label, kind: parsed.kind, issuedAt: parsed.issuedAt, validUntil: parsed.validUntil };
    }

    return {
      ok: true,
      reason: '',
      kind: parsed.kind,
      label: kind.label,
      proDays: kind.proDays,
      issuedAt: parsed.issuedAt,
      validUntil: parsed.validUntil,
      daysLeft: Math.max(0, Math.ceil((parsed.validUntil - at) / 86400))
    };
  }

  // ---- minting (PallettAI only) --------------------------------------------
  // Kept here rather than in the script so the signer and the verifier can
  // never disagree about the payload: they call the same function for it.
  async function sign(kind, issuedAt, validUntil, privateKeyB64) {
    const k = String(kind || '').toLowerCase();
    if (!KINDS[k]) throw new Error('unknown kind: ' + kind);
    if (!(validUntil > issuedAt)) throw new Error('validUntil must be after issuedAt');
    const s = subtle();
    if (!s) throw new Error('no WebCrypto in this runtime');
    const key = await s.importKey('pkcs8', b64ToBytes(privateKeyB64), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    const sig = await s.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(payloadFor(k, issuedAt, validUntil)));
    return PREFIX + k + '-' + issuedAt + '-' + validUntil + '-' + bytesToHex(new Uint8Array(sig));
  }

  // Keygen, for the admin script. Returns base64 PKCS#8 and SPKI.
  async function generateKeyPair() {
    const s = subtle();
    if (!s) throw new Error('no WebCrypto in this runtime');
    const pair = await s.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const pkcs8 = new Uint8Array(await s.exportKey('pkcs8', pair.privateKey));
    const spki = new Uint8Array(await s.exportKey('spki', pair.publicKey));
    return { privateKey: bytesToB64(pkcs8), publicKey: bytesToB64(spki) };
  }

  // The reason strings a caller should show a human.
  const REASONS = {
    empty: 'No code was entered.',
    prefix: 'That does not look like a PallettAI referral code.',
    malformed: 'That code is incomplete or mistyped.',
    'unknown-kind': 'That code carries a reward this version does not know about.',
    'not-configured': 'This build cannot check offline codes — connect to the registry, or update Studio.',
    'no-crypto': 'This device has no WebCrypto, so the code cannot be verified here.',
    'bad-signature': 'That code did not verify. It may have been altered in transit.',
    expired: 'That code has expired.',
    'not-yet-valid': 'That code is not valid yet — check the date on your device.'
  };
  const explain = (reason) => REASONS[reason] || 'That code could not be accepted.';

  return {
    KINDS, PREFIX, configure, isConfigured, parse, verify, sign, generateKeyPair,
    payloadFor, explain, REASONS, nowSeconds,
    get publicKey() { return PUBLIC_KEY; }
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = RefCode;
