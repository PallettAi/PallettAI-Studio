'use strict';

// Compare what a visitor receives, not only the generator's JSON. Two projects
// can have different metadata while compiling to the same page; this catches
// that regression at the HTML boundary.
const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const { loadAI } = require('./load-ai.js');

global.DB = require(path.join(__dirname, '..', 'data', 'db.js'));
global.ONLINE = require(path.join(__dirname, '..', 'data', 'online.js'));
global.Signature = require(path.join(__dirname, '..', 'data', 'signature.js'));
const Builder = require(path.join(__dirname, '..', 'modules', 'builder.js'));
const AI = loadAI();

const BRIEF = 'an independent ceramics studio in Bristol making sculptural tableware and running weekend workshops';
const hash = (value) => crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 12);

function structuralShape(html) {
  const clean = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '<script>')
    .replace(/<style[\s\S]*?<\/style>/gi, '<style>');
  return (clean.match(/<[a-z][^>]*>/gi) || []).map((tag) => {
    const name = (tag.match(/^<([a-z0-9]+)/i) || [])[1] || '?';
    const classes = (tag.match(/class="([^"]*)"/) || [])[1] || '';
    return name + '.' + classes.split(/\s+/).filter(Boolean).sort().join('.');
  }).join('>');
}

function render(salt) {
  const project = AI.generateSite(BRIEF, {
    salt,
    tier: 'pro',
    layouts: 'auto',
    onePager: true,
    photoMode: 'none'
  });
  const html = Builder.buildSiteHTML(project, { tier: 'pro' });
  return { project, html, shape: hash(structuralShape(html)) };
}

const first = render(1103);
const second = render(8841);
const firstSections = first.project.site.sections || [];
const secondSections = second.project.site.sections || [];
const firstOrder = firstSections.map((s) => s.type).join('>');
const secondOrder = secondSections.map((s) => s.type).join('>');
const firstMotion = firstSections.map((s) => s.animation || '').join('>');
const secondMotion = secondSections.map((s) => s.animation || '').join('>');

assert.notStrictEqual(first.shape, second.shape, 'same brief must compile to different structural HTML');
assert.notStrictEqual(first.html, second.html, 'same brief must not compile to identical HTML');
assert.notStrictEqual(firstOrder, secondOrder, 'same brief must vary section order');
assert.notStrictEqual(firstMotion, secondMotion, 'same brief must vary motion treatment');
assert.notStrictEqual(first.project.site.system, second.project.site.system, 'same brief should usually vary the visual system');
assert(first.html.includes('<!DOCTYPE html>') && second.html.includes('<!DOCTYPE html>'), 'both outputs are complete documents');
assert(!/<script[^>]*>[^<]*(?:javascript:|data:)/i.test(first.html + second.html), 'rendered outputs contain no unsafe script URLs');

console.log('AI RENDER COMPARISON PASSED');
console.log('  brief: ' + BRIEF);
console.log('  first:  ' + first.project.site.system + ' / ' + firstOrder + ' / ' + first.shape);
console.log('  second: ' + second.project.site.system + ' / ' + secondOrder + ' / ' + second.shape);
console.log('  output bytes: ' + first.html.length + ' vs ' + second.html.length);
