#!/usr/bin/env node
'use strict';

// Variety probe: generate the SAME brief many times with the same salt sequence
// the app uses, and report how many DISTINCT designs come out. Run this before
// and after any generator change.

const path = require('path');
const { loadAI } = require(path.join(__dirname, 'load-ai.js'));
const AI = loadAI();

const PROMPT = process.env.PROMPT || 'a family run café in Derby';
const N = Number(process.env.N || 40);
const TIER = process.env.TIER || 'pro';

const rows = [];
for (let i = 0; i < N; i++) {
  const salt = (i * 2654435761) >>> 0;
  const p = AI.generateSite(PROMPT, { salt, layouts: 'auto', tier: TIER });
  const s = p.site || {};
  rows.push({
    look: s.look || '',
    hero: s.heroLayout || (s.sections || []).find((x) => x.type === 'hero')?.layout || '',
    palette: s.palette || '',
    font: (s.font || '') + '/' + (s.fontDisplay || ''),
    radius: (s.design && s.design.radius),
    spacing: (s.design && s.design.spacing),
    shape: (s.sections || []).map((x) => x.type).join('>'),
    layouts: (s.sections || []).map((x) => x.type + ':' + (x.layout || '-')).join(','),
    motion: (s.sections || []).map((x) => x.animation || '-').join(','),
    count: (s.sections || []).length,
    tagline: s.tagline || '',
    heroTitle: ((s.sections || []).find((x) => x.type === 'hero') || {}).title || ''
  });
}

const distinct = (key) => new Set(rows.map((r) => r[key])).size;
const show = (key) => {
  const counts = {};
  rows.forEach((r) => { counts[r[key]] = (counts[r[key]] || 0) + 1; });
  return Object.entries(counts).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => v + '× ' + (String(k).length > 70 ? String(k).slice(0, 70) + '…' : k)).join('\n      ');
};

console.log('brief: ' + PROMPT + '   (' + N + ' generations, tier ' + TIER + ')');
console.log('\nsite keys: ' + Object.keys(rows[0]).join(', '));
const keys = ['look', 'hero', 'palette', 'font', 'radius', 'spacing', 'count', 'tagline', 'heroTitle'];
keys.forEach((k) => console.log('\n' + k.padEnd(10) + distinct(k) + ' distinct\n      ' + show(k)));
['shape', 'layouts', 'motion'].forEach((k) => console.log('\n' + k.padEnd(10) + distinct(k) + ' distinct\n      ' + show(k)));

// The headline: one design signature per site.
const sigs = new Set(rows.map((r) => [r.hero, r.palette, r.font, r.radius, r.spacing, r.shape, r.layouts, r.motion].join('|')));
console.log('\nDESIGN SIGNATURES: ' + sigs.size + ' distinct out of ' + N);
