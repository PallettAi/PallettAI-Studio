#!/usr/bin/env node
'use strict';

// ============================================================
// design-system-probe — measure the VISIBLE design language, not the structure.
//
// The render-variety probe proved the generator varies: forty generations gave
// forty distinct section orders and forty distinct tag+class shapes. And the
// sites still looked like the same site. That is possible because the variation
// lives in dimensions the eye does not read — wrapper classes and band order —
// while the dimensions the eye *does* read (button shape, card elevation,
// eyebrow case, heading treatment, hover motion, section air) are hardcoded once
// in siteCSS and shared by every site the app has ever built.
//
// This probe extracts those shared decisions out of the compiled stylesheet and
// counts how many distinct values they actually take across N generations. One
// distinct value across forty sites is the bug in numbers.
//
// Run: PROMPT='a family run café in Derby' N=40 node scripts/design-system-probe.js
// ============================================================

const path = require('path');
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..');

global.DB = require(path.join(ROOT, 'data', 'db.js'));
global.ONLINE = require(path.join(ROOT, 'data', 'online.js'));
global.Signature = require(path.join(ROOT, 'data', 'signature.js'));
const Builder = require(path.join(ROOT, 'modules', 'builder.js'));
const { loadAI } = require(path.join(__dirname, 'load-ai.js'));
const AI = loadAI();

const PROMPT = process.env.PROMPT || 'a family run café in Derby';
const N = Number(process.env.N || 40);
const TIER = process.env.TIER || 'pro';
const SETTINGS = { tier: TIER };

const hash = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 8);

// Every declaration block in the compiled <style> whose selector list ENDS in
// this selector, joined.
//
// Deliberately textual — the question is what the browser will be handed, not
// what the generator intended — and deliberately a join rather than a first
// match, because the design system arrives as a scoped override
// (`body.sys-atelier .btn{…}`) that a first-match regex silently skips. Reading
// only the base rule reported "button shape: CONSTANT" on a page whose button
// shape had in fact just changed, which is the same mistake in a probe that the
// probe exists to catch in the generator.
function rule(css, selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tail = new RegExp('(^|[\\s>+~,])' + esc + '$');
  const out = [];
  // A brace-matched walk, descending into @media and @supports bodies. A media
  // query is a condition on when a rule applies, not a different declaration, so
  // a layout that only changes above 900px is still a change of layout — a
  // regex stopping at the first `}` treats the whole block as one unparseable
  // selector and reports the layout as constant.
  (function scan(src) {
    let i = 0;
    let selStart = 0;
    while (i < src.length) {
      if (src[i] !== '{') { i++; continue; }
      const sel = src.slice(selStart, i).trim();
      let depth = 1;
      let j = i + 1;
      while (j < src.length && depth > 0) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') depth--;
        j++;
      }
      const body = src.slice(i + 1, j - 1);
      if (/^@/.test(sel)) {
        if (/^@media|^@supports/.test(sel)) scan(body);
      } else {
        const sels = sel.split(',').map((s) => s.trim());
        if (sels.some((s) => tail.test(s))) out.push(body);
      }
      i = j;
      selStart = j;
    }
  })(String(css));
  return out.join(';');
}
function token(css, name) {
  const m = String(css).match(new RegExp('--' + name + ':([^;}]+)'));
  return m ? m[1].trim() : '';
}

const rows = [];
for (let i = 0; i < N; i++) {
  const salt = (i * 2654435761) >>> 0;
  const p = AI.generateSite(PROMPT, { salt, layouts: 'auto', tier: TIER });
  let html = '';
  try { html = Builder.buildSiteHTML(p, SETTINGS) || ''; } catch (e) { html = ''; }
  // EVERY <style> block, concatenated. A page carries several — the base
  // stylesheet, the design system, a style pack, the schedule and concierge
  // sheets — and they all apply to the same document. Reading only the first
  // one measured the base stylesheet and nothing layered on it, so a page whose
  // button had genuinely changed still reported "constant".
  const css = (html.match(/<style[^>]*>[\s\S]*?<\/style>/gi) || [])
    .map((b) => b.replace(/^<style[^>]*>/i, '').replace(/<\/style>$/i, ''))
    .join('\n');
  rows.push({
    system: (p.site && p.site.system) || '',
    radius: token(css, 'radius'),
    secPad: token(css, 'sec-pad'),
    radixWidth: token(css, 'containerWidth'),
    typoScale: token(css, 'typo-scale'),
    typoTrack: token(css, 'typo-track'),
    font: token(css, 'font'),
    fontd: token(css, 'fontd'),
    grad: token(css, 'grad'),
    palette: (p.site && p.site.palette) || '',
    bg: token(css, 'bg'),
    primary: token(css, 'primary'),
    // the decisions the eye reads first
    btn: rule(css, '.btn'),
    card: rule(css, '.card'),
    eyebrow: rule(css, '.eyebrow'),
    h2: rule(css, '.sec-head h2'),
    section: rule(css, '.section'),
    grid3: rule(css, '.grid3'),
    nav: rule(css, '.nav'),
    hover: rule(css, '.card:hover'),
    container: rule(css, '.container')
  });
}

const distinct = (k) => new Set(rows.map((r) => hash(r[k]))).size;
const vals = (k) => new Set(rows.map((r) => r[k]));

// The two sets that decide whether two sites look related.
const SYSTEM_KEYS = ['btn', 'card', 'eyebrow', 'h2', 'section', 'grid3', 'nav', 'hover', 'container'];
const systemSig = rows.map((r) => hash(SYSTEM_KEYS.map((k) => r[k]).join('|')));
const FULL_KEYS = SYSTEM_KEYS.concat(['radius', 'secPad', 'typoScale', 'typoTrack', 'font', 'fontd', 'grad', 'bg', 'primary']);
const fullSig = rows.map((r) => hash(FULL_KEYS.map((k) => r[k]).join('|')));

console.log('\n=== VISIBLE DESIGN LANGUAGE — ' + PROMPT + ' (' + N + ' generations, tier ' + TIER + ') ===\n');
console.log('  full visual signature (system + paint)   ' + new Set(fullSig).size + '/' + N + ' distinct');
console.log('  DECISIONS ONLY (no colour, no type)      ' + new Set(systemSig).size + '/' + N + ' distinct   <-- what makes them read the same\n');

const LABEL = {
  btn: 'button shape (padding/radius/weight)',
  card: 'card elevation + radius',
  eyebrow: 'label/eyebrow treatment',
  h2: 'section heading treatment',
  section: 'section padding + rhythm',
  grid3: 'content grid columns',
  nav: 'navigation bar treatment',
  hover: 'hover motion',
  container: 'container width'
};

console.log('  every decision, how many distinct values it takes:\n');
Object.keys(LABEL).forEach((k) => {
  const d = distinct(k);
  const flag = d === 1 ? '   CONSTANT' : (d <= 3 ? '   nearly constant' : '');
  console.log('    ' + LABEL[k].padEnd(38) + String(d).padStart(3) + ' distinct' + flag);
});

console.log('\n  paint and type for comparison:\n');
[['radius', 'corner radius'], ['secPad', 'section air'], ['typoScale', 'type scale'],
  ['font', 'body font'], ['fontd', 'display font'], ['grad', 'gradient'], ['bg', 'page ground']].forEach(([k, label]) => {
  console.log('    ' + label.padEnd(38) + String(distinct(k)).padStart(3) + ' distinct');
});

console.log('\n  the constants, verbatim:\n');
['btn', 'eyebrow', 'card', 'nav', 'hover'].forEach((k) => {
  const v = rows[0][k];
  console.log('    ' + k.padEnd(10) + (v || '(missing)').slice(0, 92));
});

if (vals('system').size > 1) console.log('\n  design systems in play: ' + Array.from(vals('system')).join(', '));
console.log('');
