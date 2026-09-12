// ============================================================
// PallettAI Studio — Reviews + Events suites smoke test (offline)
// Verifies the full pipeline: catalog → applySuite → exported HTML
// contains the expected markup, forms post via data-form delivery,
// and removeSuite cleanly takes it back out.
// Run: node scripts/suites-reviews-events-smoke.js
// ============================================================
'use strict';
const DB = require('../data/db.js');
global.DB = DB; // builder.js reads DB as a browser global
global.ONLINE = require('../data/online.js');
const Builder = require('../modules/builder.js');

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label); }
}

function mkProject() {
  return {
    id: 'smoke_' + Math.random().toString(36).slice(2, 8),
    name: 'Smoke Site',
    site: {
      name: 'Smoke Café',
      tagline: 'Test tagline',
      palette: 'midnight',
      font: 'inter',
      heroLayout: 'centered',
      design: { radius: 20, spacing: 96, containerWidth: 1140 },
      sections: [
        { type: 'hero', title: 'Smoke Café', subtitle: 'Test tagline', items: [] },
        { type: 'features', title: 'Why us', items: [{ title: 'Fast', text: 'Very quick' }] }
      ]
    },
    suites: []
  };
}

console.log('Catalog: suites registered');
{
  ok(DB.getSuite('reviews'), 'reviews suite exists');
  ok(DB.getSuite('events'), 'events suite exists');
  ok(DB.sectionTypes.reviews, 'reviews section type exists');
  ok(DB.sectionTypes.events, 'events section type exists');
}

console.log('Pipeline: apply → export → remove');
{
  const p = mkProject();
  const r1 = Builder.applySuite(p, 'reviews');
  ok(r1.ok, 'reviews suite applies');
  ok(p.suites.includes('reviews') && p.site.sections.some((s) => s.type === 'reviews'), 'reviews section added');

  const r2 = Builder.applySuite(p, 'events');
  ok(r2.ok, 'events suite applies');

  const html = Builder.buildSiteHTML(p, { exportMeta: true, onlineEnabled: false, cookieBanner: false, brandFooter: true, brandFooterText: 'Made by PallettAI', brandLink: 'https://pallettai.org', analyticsProvider: 'none', analyticsId: '' });
  ok(/data-form="Customer review"/.test(html), 'review form uses the delivery pipeline');
  ok(/rv-form/.test(html), 'review form class present');
  ok(/data-form="RSVP"/.test(html), 'RSVP form present');
  ok(/data-rsvp="0"/.test(html), 'RSVP buttons rendered');
  ok(/rsvpPanel/.test(html), 'RSVP panel present');
  ok(/review-grid/.test(html), 'review cards rendered');
  ok(/review-stars/.test(html) && /★/.test(html), 'stars rendered');
  ok(/event-date/.test(html), 'event dates rendered');
  ok(/sec-reviews-/.test(html), 'reviews section shell id');
  ok(/sec-events-/.test(html), 'events section shell id');
  // no stray template leakage
  ok(html.indexOf('undefined') === -1 || !/>undefined</.test(html), 'no undefined text nodes');
  ok(!/<script>\/\* escaped js \*\//.test(html), 'script tag intact');

  // remove
  Builder.removeSuite(p, 'reviews');
  ok(!p.suites.includes('reviews') && !p.site.sections.some((s) => s.type === 'reviews'), 'removeSuite removes reviews section');
  Builder.removeSuite(p, 'events');
  ok(!p.suites.includes('events') && !p.site.sections.some((s) => s.type === 'events'), 'removeSuite removes events section');
}

console.log('Gating: Pro plan check surfaces in chat copilot (app-side)');
{
  // PLANS.suitePlan is app.js's gate; here we just verify the map includes them
  const PLANS = require('../data/plans.js');
  ok(PLANS.suitePlan.reviews === 'pro', 'reviews gated to Pro');
  ok(PLANS.suitePlan.events === 'pro', 'events gated to Pro');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
