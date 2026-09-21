'use strict';

/*
  Signed hotfix data contract.

  Hotfixes are intentionally DATA ONLY. This module accepts feature flags,
  release copy, AI copy overrides and template metadata; it never evaluates a
  string as JavaScript and never accepts a file path, URL or script body.
*/
const Hotfix = (() => {
  const MAX_BYTES = 180000;
  const MAX_KEYS = 50;
  const MAX_ITEMS = 60;
  const ALLOWED = new Set(['featureFlags', 'releaseNote', 'aiCopy', 'templateHints']);
  const SAFE_KEY = /^[a-zA-Z][a-zA-Z0-9._-]{0,64}$/;

  function clone(value) {
    try { return JSON.parse(JSON.stringify(value)); } catch (e) { return null; }
  }
  function canonicalPayload(manifest) {
    const m = manifest && typeof manifest === 'object' ? manifest : {};
    const copy = {};
    Object.keys(m).sort().forEach((key) => { if (key !== 'signature') copy[key] = m[key]; });
    return JSON.stringify(copy);
  }
  function text(value, max) { return String(value == null ? '' : value).trim().slice(0, max); }
  function validVersion(value) { return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(String(value || '')); }
  function versionParts(value) { return String(value || '').split(/[.+-]/)[0].split('.').map((x) => Number(x) || 0); }
  function atLeast(a, b) {
    const aa = versionParts(a), bb = versionParts(b);
    for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return aa[i] > bb[i];
    return true;
  }
  function cleanFlags(value) {
    const out = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
    Object.keys(value).slice(0, MAX_KEYS).forEach((key) => { if (SAFE_KEY.test(key) && typeof value[key] === 'boolean') out[key] = value[key]; });
    return out;
  }
  function cleanCopy(value) {
    const out = [];
    if (!Array.isArray(value)) return out;
    value.slice(0, MAX_ITEMS).forEach((item) => {
      if (!item || typeof item !== 'object' || !SAFE_KEY.test(String(item.id || ''))) return;
      const line = text(item.text, 500);
      if (line) out.push({ id: String(item.id), text: line });
    });
    return out;
  }
  function cleanHints(value) {
    const out = [];
    if (!Array.isArray(value)) return out;
    value.slice(0, MAX_ITEMS).forEach((item) => {
      if (!item || typeof item !== 'object' || !SAFE_KEY.test(String(item.id || ''))) return;
      const label = text(item.label, 120), category = text(item.category, 60);
      if (label) out.push({ id: String(item.id), label, category });
    });
    return out;
  }
  function sanitize(manifest, appVersion) {
    const m = manifest && typeof manifest === 'object' ? manifest : null;
    if (!m || typeof m.signature !== 'string' || !m.signature || !validVersion(m.version)) return { ok: false, error: 'invalid hotfix envelope' };
    if (m.minAppVersion && (!validVersion(m.minAppVersion) || !atLeast(appVersion || m.minAppVersion, m.minAppVersion))) return { ok: false, error: 'hotfix requires a newer app' };
    if (m.maxAppVersion && validVersion(m.maxAppVersion) && !atLeast(m.maxAppVersion, appVersion || m.maxAppVersion)) return { ok: false, error: 'hotfix is for an older app' };
    const expires = Date.parse(m.expiresAt || '');
    if (!Number.isFinite(expires) || expires <= Date.now()) return { ok: false, error: 'hotfix is expired or has no expiry' };
    const patches = {};
    const raw = m.patches && typeof m.patches === 'object' && !Array.isArray(m.patches) ? m.patches : {};
    Object.keys(raw).forEach((key) => {
      if (!ALLOWED.has(key)) return;
      if (key === 'featureFlags') patches[key] = cleanFlags(raw[key]);
      if (key === 'releaseNote') patches[key] = text(raw[key], 2000);
      if (key === 'aiCopy') patches[key] = cleanCopy(raw[key]);
      if (key === 'templateHints') patches[key] = cleanHints(raw[key]);
    });
    const safe = { version: m.version, minAppVersion: m.minAppVersion || '', expiresAt: new Date(expires).toISOString(), patches };
    if (Buffer.byteLength(JSON.stringify(safe), 'utf8') > MAX_BYTES) return { ok: false, error: 'hotfix is too large' };
    return { ok: true, value: safe };
  }
  function merge(target, patch) {
    const base = target && typeof target === 'object' ? target : {};
    const next = clone(base) || {};
    const p = patch && patch.patches ? patch.patches : {};
    next.featureFlags = Object.assign({}, next.featureFlags || {}, p.featureFlags || {});
    if (p.releaseNote) next.releaseNote = p.releaseNote;
    if (Array.isArray(p.aiCopy)) next.aiCopy = p.aiCopy.slice();
    if (Array.isArray(p.templateHints)) next.templateHints = p.templateHints.slice();
    next.version = patch.version;
    next.expiresAt = patch.expiresAt;
    return next;
  }
  return { MAX_BYTES, ALLOWED: Array.from(ALLOWED), canonicalPayload, sanitize, merge, validVersion };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Hotfix;
if (typeof window !== 'undefined') window.Hotfix = Hotfix;
