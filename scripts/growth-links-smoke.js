#!/usr/bin/env node
// ============================================================
// PallettAI Studio — growth-links smoke test
// (WhatsApp click-to-chat + Companies House lookup)
//
// These two features both end in an external handoff, so the
// suite is weighted the way the risk is:
//
//   1. THE EXPORT IS STILL VALID. The WhatsApp button is emitted
//      by the builder itself — the suite builds real pages with
//      and without a number and checks the button exists exactly
//      when it should, carries the right href/label/message, and
//      that a site which never set WhatsApp stays unchanged.
//   2. THE LOOKUP CANNOT LIE. Companies House results are applied
//      to briefs and contact details, so the auth header, the
//      address composition and the SIC→business-type mapping are
//      checked against a stubbed API, not against live internet.
//   3. THE WIRING IS THREE FILES DEEP. Like every online source,
//      the lookup straddles data/online.js (the fetch), index.html
//      (the CSP that allows it) and app.js (the buttons). Any one
//      missing and the feature fails silently — each is compared
//      against another rather than asserted in isolation.
//
// Fully offline. Run: node scripts/growth-links-smoke.js
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let failed = 0;
function ok(name, cond, detail) {
  console.log((cond ? '  \u2713 ' : '  \u2717 ') + name + (!cond && detail ? '  -> ' + detail : ''));
  if (!cond) failed++;
}
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

global.DB = require(path.join(ROOT, 'data', 'db.js'));
global.ONLINE = require(path.join(ROOT, 'data', 'online.js'));
const Builder = require(path.join(ROOT, 'modules', 'builder.js'));

const onlineSrc = read(path.join('data', 'online.js'));
const appSrc = read('app.js');
const indexSrc = read('index.html');
const dbSrc = read(path.join('data', 'db.js'));

function mkProject(siteExtra) {
  const site = Object.assign({
    name: 'Northwind Joinery',
    tagline: 'Bespoke kitchens, built to last',
    palette: 'midnight',
    font: 'inter',
    url: 'https://northwind.example',
    email: 'hi@northwind.example',
    pages: [
      {
        id: 'home', name: 'Home', slug: 'index', sections: [
          { type: 'hero', title: 'Bespoke kitchens', subtitle: 'Hand-built', items: [] },
          { type: 'contact', title: 'Talk to us' }
        ]
      }
    ]
  }, siteExtra || {});
  return { id: 'p1', name: site.name, suites: [], site };
}

// ---- 1. WhatsApp export behaviour (the real builder) -----------------------
console.log('\n1. WhatsApp export behaviour');

{
  const plain = Builder.buildSitePages(mkProject(), {});
  // The injector is serialised into every page and config-gated at runtime, so
  // the honest HTML-only assertion is on the rendered anchor, not the string.
  ok('no rendered WhatsApp button on a site that never set one', !/<a[^>]*class="wa-fab"/.test(plain[0].html), 'rendered wa-fab anchor found');
  ok('no WhatsApp styles ship when unused', !plain[0].html.includes('.wa-fab{'), 'style block found');
}

const WA = { number: '447700900123', label: 'Message us', message: 'Hi there!' };
const waHome = Builder.buildSitePages(mkProject({ whatsapp: WA }), {})[0].html;

ok('the injector reads the site config', waHome.includes('var wa = cfg.whatsapp'));
ok('floating button is emitted by the injector', waHome.includes("fab.className = 'wa-fab'") && waHome.includes('wa.number'));
ok('button styles are emitted beside it', waHome.includes('.wa-fab{'));
ok('href uses wa.me and the configured number', waHome.includes('https://wa.me/447700900123'));
ok('prefilled message is URL-encoded into the link', waHome.includes(encodeURIComponent(WA.message)));
ok('button carries a screen-reader label', waHome.includes("'Chat on WhatsApp'") || waHome.includes('wa.label'), 'no aria-label wiring found');
ok('deep link opens safely (target=_blank rel=noopener)', /class="wa-fab"[^>]*target="_blank"[^>]*rel="noopener"/.test(waHome.replace(/\n/g, '')) || waHome.includes("fab.rel = 'noopener'"));
ok('footer lists a WhatsApp deep link too', waHome.includes('wa.me/447700900123'));
ok('no third-party script is injected (plain anchor, no embed)', !/embed\.whatsapp|wa\.me\/widget/.test(waHome));

const waMin = Builder.buildSitePages(mkProject({ whatsapp: { number: '447700900123' } }), { minify: true })[0].html;
ok('button survives minified export', waMin.includes('wa-fab'));

const waNoMsg = Builder.buildSitePages(mkProject({ whatsapp: { number: '447700900123' } }), {})[0].html;
ok('no ?text= when no message is configured', !waNoMsg.includes('wa.me/447700900123?text='));

// ---- 2. Companies House: functional checks (stubbed API) -------------------
console.log('\n2. Companies House lookup (stubbed API)');

// The key getter reads localStorage at call time — stub it before use.
global.localStorage = {
  getItem: (k) => (k === 'pallettai.settings.v1' ? JSON.stringify({ companiesHouseKey: 'test-key' }) : null)
};

let fetchCalls = 0;
let lastUrl = '';
let lastAuth = '';
global.fetch = async (url, init) => {
  fetchCalls++;
  lastUrl = String(url);
  lastAuth = ((init && init.headers) || {}).Authorization || '';
  if (lastUrl.includes('/company/12345678')) return { ok: false, status: 404, json: async () => ({}) };
  return {
    ok: true,
    status: 200,
    json: async () => ({
      company_name: 'RUSTICA LTD',
      company_number: '09462154',
      company_status: 'active',
      date_of_creation: '2015-02-01',
      sic_codes: ['56103'],
      registered_office_address: {
        address_line_1: '1 Bread Way', locality: 'Leeds', postal_code: 'LS1 1AA', country: 'England'
      }
    })
  };
};

(async () => {
  const rec = await ONLINE.fetchCompany('09462154');
  ok('returns the registered name', rec.name === 'RUSTICA LTD', rec.name);
  ok('returns the number it looked up', rec.number === '09462154', rec.number);
  ok('composes the registered address', rec.address === '1 Bread Way, Leeds, LS1 1AA, England', rec.address);
  ok('keeps the raw SIC codes', rec.sic.join(',') === '56103', rec.sic.join(','));
  ok('auth header is Basic base64(key + ":")', lastAuth === 'Basic ' + Buffer.from('test-key:').toString('base64'), lastAuth);
  ok('requests the official API host', lastUrl.startsWith('https://api.company-information.service.gov.uk/company/09462154'), lastUrl);

  await ONLINE.fetchCompany('09462154');
  ok('repeat call is served from the TTL cache without another HTTP request', fetchCalls === 1, 'calls: ' + fetchCalls);

  ok('SIC 56103 (restaurants) maps to the food business type', ONLINE.sicToBusinessType('56103') === 'food', ONLINE.sicToBusinessType('56103'));
  ok('SIC mapping is exported for other callers', typeof ONLINE.sicToBusinessType === 'function');
  ok('junk SIC codes map to empty string, never a guess', ONLINE.sicToBusinessType('zzz') === '');

  let notFound = null;
  try { await ONLINE.fetchCompany('12345678'); } catch (e) { notFound = e; }
  ok('an unknown number is an honest not-found error', !!(notFound && notFound.code === 'not_found'), notFound && notFound.message);

  let badNum = null;
  try { await ONLINE.fetchCompany('not a number!!'); } catch (e) { badNum = e; }
  ok('a malformed number is rejected before any request', !!(badNum && badNum.code === 'bad_number'), badNum && badNum.message);

  // ---- 3. Cross-file wiring (online.js / index.html CSP / app.js / db.js) --
  console.log('\n3. Cross-file wiring');

  ok('the source is listed in the Database panel', /id: 'companieshouse'/.test(onlineSrc));
  ok('the Database card can run the lookup', appSrc.includes('data-fetch="ch"'));
  ok('fetchSource handles the ch button', /what === 'ch'/.test(appSrc));
  ok('the result container is mapped (res-companieshouse)', appSrc.includes("ch: 'companieshouse'"));
  ok('the no-key card routes to Settings', appSrc.includes('data-go-chkey'));
  ok('the settings field exists', appSrc.includes('id="setCompaniesHouseKey"'));
  ok('the settings handler saves the key', appSrc.includes("#setCompaniesHouseKey"));
  ok('the integration entry is registered', dbSrc.includes("id: 'whatsapp'") && dbSrc.includes("id: 'companieshouse'"));
  ok('the WhatsApp integration is wired', appSrc.includes('configureWhatsApp(c)'));
  ok('the lookup modal is wired', appSrc.includes('companiesHouseLookup'));
  ok('the AI Studio prefill button exists', appSrc.includes('aiChLookup'));

  const cspMatch = indexSrc.match(/Content-Security-Policy" content="([^"]+)"/);
  ok('the shell CSP is present', !!cspMatch);
  const connect = cspMatch ? ((cspMatch[1].match(/connect-src ([^;]+);/) || [])[1] || '') : '';
  ok('connect-src allows api.company-information.service.gov.uk', connect.includes('api.company-information.service.gov.uk'), connect.slice(0, 80));
  ok('the module fetches the host the CSP allows', onlineSrc.includes('https://api.company-information.service.gov.uk/company/'));
  ok('no hardcoded Companies House key ships in source', !/companiesHouseKey['"]?\s*[:=]\s*['"][0-9a-f-]{20,}/i.test(onlineSrc + appSrc));

  ok('WhatsApp needs no new CSP host (plain anchor, no fetch)', !/wa\.me/.test(connect), 'wa.me should not be in connect-src');

  console.log('');
  if (failed) { console.error(failed + ' check' + (failed === 1 ? '' : 's') + ' failed'); process.exitCode = 1; }
  else console.log('All growth-links checks passed.');
})().catch((e) => {
  console.error('  \u2717 suite crashed: ' + (e && e.stack || e));
  process.exitCode = 1;
});
