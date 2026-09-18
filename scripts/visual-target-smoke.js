#!/usr/bin/env node
'use strict';

// The Designer selects sections from the rendered export. Page-local ids such
// as sec-hero-0 repeat across pages, so the export must carry both its page id
// and its section index as explicit metadata.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const DB = require(path.join(__dirname, '..', 'data', 'db.js'));
const ONLINE = require(path.join(__dirname, '..', 'data', 'online.js'));

const sandbox = {
  console, URL, setTimeout, clearTimeout, Math, Date, JSON, Set, Promise, process,
  DB, ONLINE, Image: function Image() {},
  fetch: async () => { throw new Error('visual-target-smoke: network disabled'); }
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'modules', 'builder.js'), 'utf8') + '\n;globalThis.Builder = Builder;\n', sandbox);
const Builder = sandbox.Builder;

let failed = 0;
function assert(ok, message) {
  if (ok) console.log('  ✓ ' + message);
  else { failed++; console.error('  ✗ ' + message); }
}
function sections(html) { return String(html).match(/<section\b[^>]*>/gi) || []; }

const home = [
  { id: 'home-hero', type: 'hero', title: 'Home' },
  { id: 'home-features', type: 'features', title: 'Features' }
];
const project = {
  site: {
    name: 'Target Demo', palette: 'midnight', font: 'inter', design: {},
    sections: home,
    activePageId: 'home-page',
    pages: [
      { id: 'home-page', slug: 'index', name: 'Home', sections: home },
      { id: 'about-page', slug: 'about', name: 'About', sections: [
        { id: 'about-hero', type: 'hero', title: 'About' }
      ] }
    ]
  }
};

console.log('== Rendered sections carry an exact page and index ==');
const files = Builder.buildSitePages(project, {});
const tags = files.flatMap((file) => sections(file.html));
assert(files.length === 2, 'the fixture exports two pages');
assert(tags.length === 3, 'the fixture exports all three sections');
assert(tags.every((tag) => /\bdata-page-id="[^"]+"/.test(tag)), 'every section carries a page id');
assert(tags.every((tag) => /\bdata-section-index="\d+"/.test(tag)), 'every section carries its page-local index');
assert(tags.some((tag) => /data-page-id="home-page"[^>]*data-section-index="0"/.test(tag)), 'home hero is addressable as home-page / 0');
assert(tags.some((tag) => /data-page-id="home-page"[^>]*data-section-index="1"/.test(tag)), 'home features is addressable as home-page / 1');
assert(tags.some((tag) => /data-page-id="about-page"[^>]*data-section-index="0"/.test(tag)), 'about hero is addressable as about-page / 0');

console.log('== Target metadata does not rely on duplicate ids ==');
const ids = tags.map((tag) => (tag.match(/id="([^"]+)"/) || [])[1]).filter(Boolean);
assert(ids.filter((id) => id === 'sec-hero-0').length === 2, 'duplicate page-local hero ids remain harmless and expected');
assert(new Set(tags.map((tag) => (tag.match(/data-page-id="([^"]+)"/) || [])[1] + '/' + (tag.match(/data-section-index="(\d+)"/) || [])[1])).size === tags.length, 'page/index pairs are unique');

if (failed) process.exit(1);
console.log('VISUAL TARGET SMOKE PASSED');
