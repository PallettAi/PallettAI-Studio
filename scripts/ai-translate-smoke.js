#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const trans = require(path.join(ROOT, 'data', 'ai-translate.js'));

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function assert(cond, msg) { cond ? pass(msg) : fail(msg); }

console.log('== Languages + label ==');
const ids = trans.LANGS.map((l) => l.id).join(' ');
assert(ids === 'en es fr de it pt nl pl', 'language ids are en es fr de it pt nl pl');
assert(trans.poweredByLabel('deepl') === 'Translations powered by DeepL', 'DeepL label');
assert(trans.poweredByLabel('mymemory') === 'Translations powered by MyMemory', 'MyMemory label');

const project = {
  site: {
    name: 'Rustica',
    tagline: 'Sourdough daily',
    email: 'hello@rustica.test',
    phone: '0113 000 0000',
    address: '12 Kirkgate, Leeds',
    url: 'https://rustica.test/',
    ctaText: 'Book a loaf',
    sections: [
      { type: 'hero', title: 'Warm bread', text: 'Baked every morning.', image: 'https://img.test/loaf.jpg' },
      { type: 'features', items: [{ title: '48h dough', text: 'Slow ferment.', extra: 'skip-me' }] }
    ],
    pages: [{ name: 'About', slug: 'about', sections: [{ type: 'about', title: 'Our story', text: 'A bakery in Leeds.' }] }]
  }
};

console.log('\n== collectCopy ==');
const pairs = trans.collectCopy(project, { translateName: false });
const texts = pairs.map((p) => p.text);
assert(texts.indexOf('Sourdough daily') !== -1, 'collects tagline');
assert(texts.indexOf('Book a loaf') !== -1, 'collects CTA');
assert(texts.indexOf('Warm bread') !== -1, 'collects section title');
assert(texts.indexOf('About') !== -1, 'collects page name');
assert(texts.indexOf('Rustica') === -1, 'skips brand name by default');
assert(texts.indexOf('hello@rustica.test') === -1, 'skips email');
assert(texts.indexOf('0113 000 0000') === -1, 'skips phone');
assert(texts.indexOf('12 Kirkgate, Leeds') === -1, 'skips address');
assert(texts.indexOf('https://rustica.test/') === -1, 'skips url');
assert(texts.indexOf('https://img.test/loaf.jpg') === -1, 'skips image');
assert(pairs.every((p) => p.path[p.path.length - 1] !== 'type'), 'does not collect section type ids');

const named = trans.collectCopy(project, { translateName: true });
assert(named.some((p) => p.path.join('.') === 'site.name' && p.text === 'Rustica'), 'translateName includes the brand');

console.log('\n== applyCopy is all-or-nothing clone ==');
const out = trans.applyCopy(project, pairs.map((p) => ({ path: p.path, text: 'ES:' + p.text })));
assert(out !== project && project.site.tagline === 'Sourdough daily', 'original project is untouched');
assert(out.site.tagline === 'ES:Sourdough daily', 'tagline is replaced');
assert(out.site.email === 'hello@rustica.test', 'email is unchanged');
assert(out.site.name === 'Rustica', 'name is unchanged when not in pairs');

console.log('\n== Builder lang + footer ==');
const DB = require(path.join(ROOT, 'data', 'db.js'));
const ONLINE = require(path.join(ROOT, 'data', 'online.js'));
global.DB = DB;
global.ONLINE = ONLINE;
const Builder = require(path.join(ROOT, 'modules', 'builder.js'));
const translated = {
  id: 'tr', name: 'Rustica', suites: [],
  site: {
    name: 'Rustica', tagline: 'Pan de masa madre', lang: 'es',
    translation: { lang: 'es', provider: 'deepl', at: Date.now() },
    palette: 'midnight', font: 'inter',
    sections: [{ type: 'hero', id: 's-hero', title: 'Hola', text: 'Pan.' }],
    design: { containerWidth: 1140, radius: 20, spacing: 96 }
  }
};
const html = Builder.buildSiteHTML(translated, {});
assert(/<html lang="es">/.test(html), 'exported html lang follows site.lang');
assert(/Translations powered by DeepL/.test(html), 'footer shows DeepL credit');

const mm = JSON.parse(JSON.stringify(translated));
mm.site.translation.provider = 'mymemory';
assert(/Translations powered by MyMemory/.test(Builder.buildSiteHTML(mm, {})), 'footer shows MyMemory credit');

console.log('\n== Edge Function never returns the key ==');
const fnPath = path.join(ROOT, 'supabase', 'functions', 'translate', 'index.ts');
assert(fs.existsSync(fnPath), 'supabase/functions/translate/index.ts exists');
const src = fs.existsSync(fnPath) ? fs.readFileSync(fnPath, 'utf8') : '';
assert(/DEEPL/.test(src), 'function talks to DeepL');
assert(/Deno\.env\.get/.test(src) && /DEEPL_API_KEY/.test(src), 'key is read from secrets');
assert(!/json\([^)]*DEEPL_API_KEY/.test(src) && !/JSON\.stringify\([^)]*DEEPL_API_KEY/.test(src), 'key is not assigned into a JSON body');
assert(!/whsec_/.test(src), 'no Stripe webhook secret in translate');
const cfg = fs.readFileSync(path.join(ROOT, 'supabase', 'config.toml'), 'utf8');
assert(/\[functions\.translate\]/.test(cfg) && /verify_jwt\s*=\s*true/.test(cfg.split('[functions.translate]')[1] || ''), 'translate requires JWT');

const client = fs.readFileSync(path.join(ROOT, 'modules', 'supabase.js'), 'utf8');
assert(/translateSite/.test(client), 'SUPABASE.translateSite exists');
assert(!/DEEPL_API_KEY/.test(client), 'client never embeds the DeepL key');

if (failed) {
  console.error('\nai-translate-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nai-translate-smoke PASSED');
