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

/*
  The copilot can write to the client's site, so its write surface is a security
  boundary rather than a convenience. An action that can write an arbitrary key
  can write __proto__; an action that can write an arbitrary string can plant a
  javascript: URL in the client's own CTA. Both are refused at the source, and
  this asserts it from the outside.
*/
console.log('\n== Copilot write surface ==');
{
  const Copilot = require(path.join(ROOT, 'data', 'copilot.js'));
  assert(typeof Copilot.sanitiseSiteField === 'function', 'the copilot exposes a site-field sanitiser');
  assert(typeof Copilot.SITE_FIELDS === 'object' && Copilot.SITE_FIELDS !== null, 'the writable site fields are an explicit allowlist');

  ['__proto__', 'prototype', 'constructor'].forEach((k) => {
    const r = Copilot.sanitiseSiteField(k, 'x');
    assert(r.ok === false && r.value === '', 'a prototype key cannot be written: ' + k);
  });
  assert(!Object.prototype.polluted, 'the prototype chain is untouched after those refusals');
  assert(Copilot.sanitiseSiteField('tokens', 'x').ok === false, 'a field outside the allowlist cannot be written');
  assert(Copilot.sanitiseSiteField('pages', [1]).ok === false, 'the page model cannot be replaced from chat');

  assert(Copilot.sanitiseSiteField('url', 'javascript:alert(1)').ok === false, 'javascript: cannot be written into the public address');
  assert(Copilot.sanitiseSiteField('url', 'http://example.com').ok === false, 'a plain-http public address is refused');
  assert(Copilot.sanitiseSiteField('ctaLink', 'javascript:alert(1)').ok === false, 'javascript: cannot be written into the main button');
  assert(Copilot.sanitiseSiteField('ctaLink', 'data:text/html,<script>x</script>').ok === false, 'data: cannot be written into the main button');
  assert(Copilot.sanitiseSiteField('ctaLink', '//evil.example/x').ok === false, 'a protocol-relative button link is refused');
  assert(Copilot.sanitiseSiteField('email', '').ok === true, 'clearing an address is allowed');
  assert(Copilot.sanitiseSiteField('formEndpoint', 'https://api.web3forms.com/submit').ok === true, 'a real endpoint is accepted');

  assert(Copilot.sanitiseSectionField('__proto__', 'x').ok === false, 'a section field cannot be a prototype key');
  assert(Copilot.sanitiseSectionField('id', 'renamed').ok === false, 'a section id cannot be rewritten from chat');
  assert(Copilot.sanitiseSectionField('type', 'hero').ok === false, 'a section type cannot be rewritten from chat');
  assert(Copilot.sanitiseSectionType('bogus') === '', 'an unknown section type cannot be inserted');
  assert(Copilot.sanitiseSectionType('__proto__') === '', 'a prototype key is not a section type');
  assert(Copilot.sanitiseSectionType('hero') === 'hero', 'a real section type still passes');

  assert(Copilot.sanitiseSiteField('tagline', 'x'.repeat(4000)).value.length <= 300, 'written text is length-capped');
  assert(Copilot.sanitiseSectionField('text', 'x'.repeat(4000)).value.length <= 600, 'written section text is length-capped');
  assert(!/[\u0000-\u001f]/.test(Copilot.sanitiseSectionField('title', 'a\u0000b\u001fc').value), 'control characters are stripped from a written line');

  // Nothing the surface refuses can reach an export through it.
  const refusedLink = Copilot.sanitiseSiteField('ctaLink', 'javascript:alert(1)').value;
  const safeHtml = Builder.buildSiteHTML({
    id: 'surface', name: 'Surface', suites: [],
    site: {
      name: 'Surface', tagline: 't', palette: 'midnight', font: 'inter',
      ctaLink: refusedLink || '#top',
      sections: [{ type: 'hero', id: 'h', title: 'H' }]
    }
  }, { onlineEnabled: false });
  assert(!/javascript:/i.test(safeHtml), 'nothing the surface refused reaches the export');

  // A catalogue id is checked against the catalogue it will be looked up in, so
  // a made-up one cannot be stored and then reported as an unscorable palette.
  assert(typeof Copilot.sanitiseChoice === 'function', 'the copilot exposes a catalogue-choice sanitiser');
  assert(Copilot.sanitiseChoice('palette', 'midnight') === 'midnight', 'a real palette is accepted');
  assert(Copilot.sanitiseChoice('palette', 'nope') === '', 'a palette that does not exist is refused');
  assert(Copilot.sanitiseChoice('palette', '__proto__') === '', 'a prototype key is not a palette');
  assert(Copilot.sanitiseChoice('font', 'comic-sans') === '', 'a font that does not exist is refused');
  assert(Copilot.sanitiseChoice('layout:features', 'spiral') === '', 'a layout that does not exist for that section is refused');
  assert(Copilot.sanitiseChoice('hero', 'centered') === 'centered', 'the hero layout the product itself ships is still accepted');
  assert(Copilot.sanitiseChoice('navStyle', 'weird') === '', 'a nav style that is not one of the two is refused');

  // batchability is decided by the copilot, and it must not be mutable from out here
  const actSet = Copilot.BATCH_OPS;
  assert(actSet === undefined, 'the batch list is not exported as a mutable set');
  assert(typeof Copilot.batchable === 'function', 'batch eligibility is asked for through a function');
}

console.log('\n== Widget HTML escaping ==');
{
  // Two layers, because the first one alone is what was missing. The previous
  // version of this section asserted only that an escaper EXISTS in the bundle
  // — so it passed while the crypto and FX widgets interpolated attributed text
  // straight into innerHTML, which is script execution on a client's live site.
  const HOSTILE = '<img src=x onerror=alert(1)>';
  const build = (section) => Builder.buildSiteHTML({
    id: 'w', name: 'W', suites: ['datawidgets'],
    site: {
      name: 'W', tagline: 't', palette: 'midnight', font: 'inter',
      sections: [{ type: 'hero', id: 'h', title: 'H' }, section]
    }
  }, { onlineEnabled: false });

  const cryptoHtml = build({ type: 'crypto', id: 'c', extra: 'bitcoin,' + HOSTILE });
  const fxHtml = build({ type: 'fx', id: 'f', extra: HOSTILE });
  const plainHtml = build({ type: 'crypto', id: 'c', extra: 'bitcoin,ethereum' });

  assert(/function escHtml\(/.test(plainHtml) || /function esc\(/.test(plainHtml) && plainHtml.includes("replace(/</g, '&lt;')"), 'exported integrations include an HTML escaper');

  // Layer 1 — it must never reach the page, in any form. Asserting only that the
  // raw string is absent is not enough: the emitter HTML-escapes every attribute,
  // so that assertion passes even with the filter removed. The truth is in the
  // attribute VALUES, so read them back the way the widget will.
  const attrValues = (html, name) => {
    const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    return [...html.matchAll(new RegExp(name + '="([^"]*)"', 'g'))].map((m) => unesc(m[1]));
  };
  const slugOk = (v) => /^[a-z0-9][a-z0-9-]{0,39}$/.test(v);
  const coinIds = attrValues(cryptoHtml, 'data-id');
  assert(coinIds.length === 1 && coinIds.every(slugOk), 'only a real slug reaches the page as a coin id (' + JSON.stringify(coinIds) + ')');
  assert(attrValues(cryptoHtml, 'data-coins').every((v) => v.split(',').every((x) => x === '' || slugOk(x))), 'and the list the widget fetches is slugs too');
  const bases = attrValues(fxHtml, 'data-base');
  assert(bases.length === 1 && bases.every((v) => /^[A-Z]{3}$/.test(v)), 'a currency code that reaches the page is three letters (' + JSON.stringify(bases) + ')');
  assert(!cryptoHtml.includes('<img src=x') && !fxHtml.includes('<img src=x'), 'and no widget field puts markup in the document either');
  assert(/data-id="bitcoin"/.test(plainHtml) && /data-coins="bitcoin,ethereum"/.test(plainHtml), 'a real coin list still renders');
  assert(/data-base="GBP"/.test(fxHtml), 'an unusable currency code falls back to GBP');

  // Layer 2 — and if one ever did reach it (an older export, a hand-edited file),
  // the runtime escapes it at the sink. attr-value escaping does NOT survive the
  // trip back out through getAttribute(), which is the trap here.
  assert(!/\+ \(names\[id\] \|\| id\) \+/.test(plainHtml), 'the crypto widget no longer interpolates a raw coin id');
  assert(/escHtml\(names\[id\] \|\| id\)/.test(plainHtml), 'the crypto widget escapes the coin id it writes');
  assert(/'<\/span><b>1 ' \+ escHtml\(base\) \+ ' = '/.test(plainHtml), 'the FX widget escapes the base currency it writes');
  assert(/escHtml\(code\)/.test(plainHtml), 'and the currency codes it writes');

  // The cart persists through localStorage, which throws in an opaque origin —
  // so it is guarded like every other storage touch in the export.
  assert(/const save = \(\) => \{ try \{ localStorage\.setItem/.test(plainHtml), 'the cart save cannot throw when storage is unavailable');
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

    // A WebContents is not a frame. The Designer renders the exported site in a
    // same-origin srcdoc iframe, so a widget inside it shares this WebContents
    // and can see window.pallettai through `parent`; only senderFrame separates
    // the two. Asserting on `event.sender` alone is what let that path exist.
    assert(/const fromMainFrame = \(event, target\)/.test(mainSrc), 'main.js has a main-frame sender check');
    assert(/event\.sender !== target\.webContents/.test(mainSrc) && /const frame = event\.senderFrame/.test(mainSrc), 'and it inspects the actual senderFrame, not just the WebContents');
    assert(/frame\.parent == null/.test(mainSrc), 'a subframe is refused by its parent, which is what a preview iframe always has');
    assert(!/event\.sender !== win\.webContents/.test(mainSrc), 'no privileged channel still trusts the WebContents alone');
    const frameChecks = (mainSrc.match(/fromMainFrame\(event, (win|startupWindow)\)/g) || []).length;
    assert(frameChecks >= 8, 'every privileged channel goes through it (' + frameChecks + ' sites)');

    // The template preview modal is sandboxed because nothing reads back into
    // that frame; the Designer preview is NOT, because renderPreview() reads
    // contentDocument to wire page navigation — so its safety comes from the
    // frame check above, not from the attribute.
    const appSrc = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
    assert(/sandbox="allow-scripts allow-forms allow-modals allow-popups"[^>]*srcdoc=/.test(appSrc), 'the template preview iframe is sandboxed');
    assert(/<iframe id="previewFrame" title="Live site preview"><\/iframe>/.test(appSrc), 'the Designer preview frame stays same-origin for contentDocument');
    assert(/f\.contentDocument/.test(appSrc), 'and the Designer does read into it, so that trade-off is real');
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
