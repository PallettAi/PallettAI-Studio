#!/usr/bin/env node
// Registry-only entitlements, safe exported URLs, and public-host checks.
'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');

global.localStorage = {
  _d: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; }
};

const PLANS = require(path.join(ROOT, 'data', 'plans.js'));
const DB = require(path.join(ROOT, 'data', 'db.js'));
const ONLINE = require(path.join(ROOT, 'data', 'online.js'));
global.DB = DB;
global.ONLINE = ONLINE;
const Builder = require(path.join(ROOT, 'modules', 'builder.js'));

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function assert(cond, msg) { cond ? pass(msg) : fail(msg); }

console.log('== Entitlements (no local Pro unlock) ==');
{
  const before = PLANS.store.current();
  const r = PLANS.store.redeem('REF-HACK01');
  const after = PLANS.store.current();
  assert(r && r.ok === false, 'local referral redeem is rejected');
  assert(!(after.trialProUntil > Date.now()), 'local referral redeem does not grant Pro days');
  assert(before.plan === 'free' && after.plan === 'free', 'local referral redeem does not change plan');
}
{
  const r = PLANS.store.activate('pro', 'checkout');
  assert(PLANS.normalizePlan(r.plan) === 'free', 'demo checkout cannot activate Pro');
  assert(!PLANS.store.isPro(), 'demo checkout does not set isPro');
}
{
  const forged = PLANS.makeKey('PRO', 'HACKED');
  const check = PLANS.validateLicense(forged);
  assert(check.ok === true, 'checksum still recognises a well-formed key');
  PLANS.store.activate(check.plan, 'license', check.key);
  assert(!PLANS.store.isPro(), 'offline license checksum cannot unlock Pro');
}
{
  PLANS.store.applyRegistryPlan({ plan: 'pro', key: 'PAL-PRO-REG-TEST', expiresAt: Date.now() + 864e5 });
  assert(PLANS.store.isPro(), 'registry-verified plan still unlocks Pro');
  PLANS.store.downgrade();
  assert(!PLANS.store.isPro(), 'downgrade returns to Free');
}
{
  localStorage.setItem(PLANS.store.key, JSON.stringify({
    plan: 'free', source: 'trial', trialProUntil: Date.now() + 7 * 864e5, updatedAt: Date.now()
  }));
  assert(!PLANS.store.isPro(), 'leftover local trial days do not grant Pro');
  assert(!((PLANS.store.current().trialProUntil || 0) > Date.now()), 'leftover local trial expiry is cleared');
}
{
  PLANS.store.applyTrialUntil(Date.now() + 864e5);
  assert(PLANS.store.isPro(), 'registry-stamped trial still unlocks Pro');
  PLANS.store.downgrade();
  assert(!PLANS.store.isPro(), 'downgrade still clears a registry trial');
}

console.log('\n== Exported site URL schemes ==');
assert(typeof Builder.safeHref === 'function', 'Builder.safeHref is exported');
assert(Builder.safeHref('javascript:alert(1)', '#contact') === '#contact', 'javascript: href is rejected');
assert(Builder.safeHref('data:text/html,x', '#x') === '#x', 'data: href is rejected');
assert(Builder.safeHref('https://example.com/go', '#x') === 'https://example.com/go', 'https href is kept');
assert(Builder.safeHref('#sec-contact-0', '/no') === '#sec-contact-0', 'in-page hash href is kept');
assert(typeof Builder.safeEmbedUrl === 'function', 'Builder.safeEmbedUrl is exported');
assert(Builder.safeEmbedUrl('javascript:alert(1)') === '', 'javascript: embed is rejected');
assert(Builder.safeEmbedUrl('http://example.com/widget') === '', 'http embed is rejected');
assert(Builder.safeEmbedUrl('https://open.spotify.com/embed/playlist/1') === 'https://open.spotify.com/embed/playlist/1', 'https embed is kept');

{
  const html = Builder.buildSiteHTML({
    id: 'xss-cta', name: 'CTA', suites: [],
    site: {
      name: 'CTA', tagline: 't', palette: 'midnight', font: 'inter',
      ctaLink: 'javascript:alert(1)', ctaText: 'Go',
      sections: [
        { type: 'hero', id: 'h', title: 'Hi', extra: 'javascript:alert(1)' },
        { type: 'cta', id: 'c', title: 'C', extra: 'javascript:alert(1)' },
        { type: 'embed', id: 'e', title: 'E', extra: 'javascript:alert(1)' }
      ]
    }
  }, { onlineEnabled: false });
  assert(!/href="javascript:/i.test(html), 'compiled HTML does not emit javascript: hrefs');
  assert(!/src="javascript:/i.test(html), 'compiled HTML does not emit javascript: iframe src');
}

console.log('\n== Widget HTML escaping ==');
{
  const src = Builder.buildSiteHTML({
    id: 'w', name: 'W', suites: ['datawidgets'],
    site: {
      name: 'W', tagline: 't', palette: 'midnight', font: 'inter',
      sections: [{ type: 'hero', id: 'h', title: 'H' }]
    }
  }, { onlineEnabled: false });
  assert(/function escHtml\(/.test(src) || /function esc\(/.test(src) && src.includes("replace(/</g, '&lt;')"), 'exported integrations include an HTML escaper');
}

(async () => {
  console.log('\n== Study-site private URL block ==');
  const AI = require(path.join(ROOT, 'modules', 'ai.js'));
  assert(typeof AI.isPublicFetchUrl === 'function', 'AI.isPublicFetchUrl is exported');
  assert(AI.isPublicFetchUrl('https://example.com') === true, 'public https host is allowed');
  assert(AI.isPublicFetchUrl('http://127.0.0.1/') === false, 'loopback IPv4 is blocked');
  assert(AI.isPublicFetchUrl('http://localhost/') === false, 'localhost is blocked');
  assert(AI.isPublicFetchUrl('http://10.0.0.4/') === false, 'RFC1918 is blocked');
  assert(AI.isPublicFetchUrl('http://169.254.169.254/') === false, 'link-local metadata IP is blocked');
  assert(AI.isPublicFetchUrl('file:///etc/passwd') === false, 'file: URLs are blocked');
  const fetched = [];
  const prevFetch = global.fetch;
  global.fetch = async (u) => { fetched.push(String(u)); return { ok: true, text: async () => '<html><title>x</title></html>' }; };
  try {
    const r = await AI.studySite('http://127.0.0.1/secret');
    assert(r == null, 'studySite returns null for a private URL');
    assert(fetched.length === 0, 'studySite does not fetch private URLs or the allorigins proxy');
  } catch (e) {
    fail('studySite private URL threw: ' + e.message);
  } finally {
    global.fetch = prevFetch;
  }

  console.log('\n== Electron secret store + openExternal ==');
  {
    const fs = require('fs');
    const mainSrc = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
    const preloadSrc = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
    assert(/function isSafeExternalUrl\s*\(/.test(mainSrc), 'main.js defines isSafeExternalUrl');
    assert(/safeStorage/.test(mainSrc) && /encryptString/.test(mainSrc), 'main.js encrypts secrets with safeStorage');
    assert(/secrets-get/.test(mainSrc) && /secrets-set/.test(mainSrc), 'main.js registers secrets IPC');
    assert(/secretsGet:/.test(preloadSrc) && /secretsSet:/.test(preloadSrc), 'preload exposes secretsGet/secretsSet');
  }

  if (failed) {
    console.error('\nsecurity-hardening-smoke FAILED — ' + failed + ' failure(s)');
    process.exit(1);
  }
  console.log('\nsecurity-hardening-smoke PASSED');
})().catch((e) => {
  console.error('security-hardening-smoke crashed:', e);
  process.exit(1);
});
