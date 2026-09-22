'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const Sitemap = require('../data/ai-sitemap.js');
const { loadAI } = require('./load-ai.js');

let passed = 0;
function ok(name, value) { assert.ok(value, name); passed++; console.log('  ✓ ' + name); }

console.log('== Offline brief-to-sitemap planner ==');
const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
ok('planner data module is loaded before the app', index.indexOf('data/ai-sitemap.js') < index.indexOf('app.js'));
ok('AI Studio exposes a free sitemap action', app.includes('id="aiSitemap"') && app.includes('openSitemapPlanner'));
ok('the staged plan can be cleared without mutating a project', app.includes('id="aiClearSitemap"') && app.includes('sitemapPlan = null'));
ok('the planner UI exposes direction selection', app.includes('data-sitemap-direction') && app.includes('sitemap-direction-list'));
const product = Sitemap.plan({ prompt: 'A software platform for small businesses', seed: 12 });
ok('plans a product journey from a plain prompt', product.family === 'product');
ok('always includes a home page', product.pages[0].id === 'home');
ok('uses purposeful page metadata', product.pages.every((page) => page.name && page.purpose && page.sections.length));
ok('returns a bounded plan', product.pages.length <= Sitemap.LIMITS.pages && Sitemap.validate(product));
ok('offers three selectable visitor journeys', Array.isArray(product.directions) && product.directions.length === 3 && new Set(product.directions.map((item) => item.direction)).size === 3);
ok('journey directions materially change the page order', new Set(product.directions.map((item) => item.pages.map((page) => page.id).join('>'))).size >= 2);
ok('every alternative remains independently valid', product.directions.every((item) => Sitemap.validate(item)));
const creative = Sitemap.plan({ prompt: 'An editorial magazine and culture journal', seed: 33 });
ok('different briefs produce different information architecture', creative.family !== product.family || creative.pages.map((p) => p.id).join('>') !== product.pages.map((p) => p.id).join('>'));
const explicit = Sitemap.plan({ prompt: 'a business', pages: ['home', 'work', 'faq', 'contact'], seed: 4 });
ok('respects an explicit page selection', explicit.pages.map((p) => p.id).join('>') === 'home>work>faq>contact');
ok('rejects malformed plans', Sitemap.validate({ pages: [] }) === false);

console.log('\n== Generator integration ==');
const AI = loadAI();
const planned = AI.generateSite('A software platform for small businesses', {
  salt: 51, tier: 'pro', layouts: 'auto',
  sitePlan: product, onePager: false
});
ok('generated site stores a bounded sitemap receipt', planned.site.sitemapPlan && planned.site.sitemapPlan.pages.length <= 6);
ok('generated site uses the planned page count', Array.isArray(planned.site.pages) && planned.site.pages.length === product.pages.length);
ok('planned home remains index', planned.site.pages[0].slug === 'index' && planned.site.activePageId === 'pg-home');
ok('planned pages still contain renderable heroes', planned.site.pages.every((page) => page.sections.some((section) => section.type === 'hero')));
ok('generated page slugs are safe', planned.site.pages.every((page) => /^[a-z0-9-]+$/.test(page.slug)));
const story = product.directions.find((item) => item.direction === 'story');
const storyBuild = AI.generateSite('A software platform for small businesses', { salt: 52, tier: 'pro', layouts: 'auto', sitePlan: story, onePager: false });
ok('a selected alternative changes the generated page structure', storyBuild.site.pages.length === story.pages.length && storyBuild.site.pages.map((p) => p.slug).join('>') === story.pages.map((p) => p.slug).join('>'));
ok('the selected direction is retained in the project receipt', storyBuild.site.sitemapPlan && storyBuild.site.sitemapPlan.signature === story.rationale.signature);

console.log('\nai-sitemap-smoke PASSED: ' + passed + ' checks');
