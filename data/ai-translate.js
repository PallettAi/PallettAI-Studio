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

async function translateViaMyMemory(texts, target) {
  const lang = String(target || 'es').toLowerCase().slice(0, 2);
  const out = [];
  for (let i = 0; i < (texts || []).length; i++) {
    const q = encodeURIComponent(String(texts[i] || '').slice(0, 450));
    const res = await fetch('https://api.mymemory.translated.net/get?q=' + q + '&langpair=en|' + lang);
    const j = await res.json().catch(() => ({}));
    const t = j && j.responseData && j.responseData.translatedText;
    if (!t) throw new Error('mymemory-failed');
    out.push(t);
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

const AiTranslate = { LANGS, poweredByLabel, collectCopy, applyCopy, setAt, translateViaMyMemory };
if (typeof module !== 'undefined' && module.exports) module.exports = AiTranslate;
