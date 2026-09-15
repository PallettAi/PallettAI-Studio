'use strict';

const LANGS = [
  { id: 'en', name: 'English' },
  { id: 'es', name: 'Spanish' },
  { id: 'fr', name: 'French' },
  { id: 'de', name: 'German' },
  { id: 'it', name: 'Italian' },
  { id: 'pt', name: 'Portuguese' },
  { id: 'nl', name: 'Dutch' },
  { id: 'pl', name: 'Polish' }
];

const SKIP = { url: 1, email: 1, phone: 1, address: 1, image: 1, href: 1, src: 1, extra: 1, city: 1, type: 1, id: 1, layout: 1, animation: 1, slug: 1, imageSource: 1, bookingUrl: 1, bookingProvider: 1, alt: 1 };
const KEEP = { title: 1, subtitle: 1, text: 1, tagline: 1, eyebrow: 1, description: 1, ctaText: 1, name: 1 };

function poweredByLabel(provider) {
  if (provider === 'deepl') return 'Translations powered by DeepL';
  if (provider === 'mymemory') return 'Translations powered by MyMemory';
  return '';
}

function collectCopy(project, opts) {
  const translateName = !!(opts && opts.translateName);
  const out = [];
  const walk = (obj, path) => {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      obj.forEach((item, i) => walk(item, path.concat(i)));
      return;
    }
    Object.keys(obj).forEach((key) => {
      if (SKIP[key]) return;
      const val = obj[key];
      const next = path.concat(key);
      if (typeof val === 'string' && val.trim()) {
        if (!KEEP[key]) return;
        if (key === 'name' && path.join('.') === 'site' && !translateName) return;
        out.push({ path: next, text: val });
        return;
      }
      if (val && typeof val === 'object') walk(val, next);
    });
  };
  if (project && project.site) {
    ['tagline', 'eyebrow', 'description', 'ctaText'].forEach((key) => {
      if (project.site[key]) out.push({ path: ['site', key], text: project.site[key] });
    });
    if (translateName && project.site.name) out.push({ path: ['site', 'name'], text: project.site.name });
    walk(project.site.sections || [], ['site', 'sections']);
    (project.site.pages || []).forEach((pg, i) => {
      if (pg.name) out.push({ path: ['site', 'pages', i, 'name'], text: pg.name });
      walk(pg.sections || [], ['site', 'pages', i, 'sections']);
    });
  }
  return out;
}

// ------------------------------------------------------------
// MyMemory is free, keyless, and metered by a daily allowance
// shared by everyone behind our IP. It is also the fallback
// when the DeepL proxy is unavailable, so the requests that reach
// it must be the ones that genuinely need making:
//   * an identical string is asked for once, not once per occurrence
//     (a real site repeats "Learn more", "Home", "Contact" many times
//     — one bakery brief sent 9 copies of the same heading)
//   * a string already translated into this language is reused
//   * a string with nothing to translate — "24/7", "£55/mo", an e-mail
//     address, a URL — never leaves the machine
//   * concurrent callers asking for the same string share one request
//   * a hung request is abandoned rather than left open
// ------------------------------------------------------------
const MM_CACHE = new Map();
const MM_FLIGHTS = new Map();
const MM_CACHE_LIMIT = 600;
const MM_TIMEOUT_MS = 9000;

let mmFetch = (typeof fetch === 'function') ? fetch : null;

const mmStats = { requests: 0, reused: 0, collapsed: 0, skipped: 0 };
function resetTranslateStats() {
  mmStats.requests = 0; mmStats.reused = 0; mmStats.collapsed = 0; mmStats.skipped = 0;
}
// Tests inject a counting fetch so the request budget can be asserted offline.
function setTranslateFetch(fn) { if (typeof fn === 'function') mmFetch = fn; }
function clearTranslateCache() { MM_CACHE.clear(); MM_FLIGHTS.clear(); }

// A string worth sending: it must carry letters, and must not be a URL,
// e-mail address, phone number or bare figure — all of which translate to
// themselves and would spend allowance to learn nothing.
function translatable(value) {
  const t = String(value == null ? '' : value).trim();
  if (!t) return false;
  if (!/[a-z]/i.test(t)) return false;                       // "24/7", "2026", "£55"
  if (t.length < 2) return false;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return false;    // e-mail
  if (/^(?:https?:\/\/|www\.)/i.test(t)) return false;        // URL
  if (/^\+?[\d\s().-]{7,}$/.test(t)) return false;            // phone
  if (/^[\d\s£$€¥%.,:/–—-]+$/.test(t)) return false;          // figures + punctuation
  return true;
}

// One request per distinct (language, string), shared across callers.
async function mmOne(text, lang) {
  const key = lang + '|' + text;
  if (MM_CACHE.has(key)) { mmStats.reused++; return MM_CACHE.get(key); }
  if (MM_FLIGHTS.has(key)) { mmStats.reused++; return MM_FLIGHTS.get(key); }
  const flight = (async () => {
    const q = encodeURIComponent(text.slice(0, 450));
    const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    let timer = null;
    if (ctrl) timer = setTimeout(() => ctrl.abort(), MM_TIMEOUT_MS);
    try {
      mmStats.requests++;
      const res = await mmFetch(
        'https://api.mymemory.translated.net/get?q=' + q + '&langpair=en|' + lang,
        ctrl ? { signal: ctrl.signal } : undefined
      );
      const j = await res.json().catch(() => ({}));
      const t = j && j.responseData && j.responseData.translatedText;
      if (!t) throw new Error('mymemory-failed');
      MM_CACHE.set(key, t);
      // Bounded, oldest-first: a long session must not grow without limit.
      if (MM_CACHE.size > MM_CACHE_LIMIT) MM_CACHE.delete(MM_CACHE.keys().next().value);
      return t;
    } finally {
      if (timer) clearTimeout(timer);
    }
  })();
  MM_FLIGHTS.set(key, flight);
  const settle = () => { if (MM_FLIGHTS.get(key) === flight) MM_FLIGHTS.delete(key); };
  flight.then(settle, settle);
  return flight;
}

async function translateViaMyMemory(texts, target) {
  const lang = String(target || 'es').toLowerCase().slice(0, 2);
  const list = (Array.isArray(texts) ? texts : []).map((t) => String(t == null ? '' : t));
  const out = new Array(list.length);
  // Group by distinct string first, so repeated copy costs one request, not one
  // per occurrence, and the result is written back to every position it serves.
  const pending = new Map();
  list.forEach((text, i) => {
    if (!translatable(text)) { out[i] = text; mmStats.skipped++; return; }
    if (pending.has(text)) { mmStats.collapsed++; pending.get(text).push(i); return; }
    pending.set(text, [i]);
  });
  for (const entry of pending) {
    const text = entry[0];
    const idxs = entry[1];
    const t = await mmOne(text, lang); // sequential on purpose: polite to a free API
    idxs.forEach((i) => { out[i] = t; });
  }
  return out;
}

function setAt(root, path, value) {
  let cur = root;
  for (let i = 0; i < path.length - 1; i++) cur = cur[path[i]];
  cur[path[path.length - 1]] = value;
}

function applyCopy(project, pairs) {
  const clone = JSON.parse(JSON.stringify(project));
  (pairs || []).forEach((pair) => {
    if (!pair || !pair.path) return;
    setAt(clone, pair.path, pair.text);
  });
  return clone;
}

const AiTranslate = {
  LANGS, poweredByLabel, collectCopy, applyCopy, setAt, translateViaMyMemory,
  translatable, resetTranslateStats, setTranslateFetch, clearTranslateCache,
  get translateStats() { return { ...mmStats, cached: MM_CACHE.size, inFlight: MM_FLIGHTS.size }; }
};
if (typeof module !== 'undefined' && module.exports) module.exports = AiTranslate;
