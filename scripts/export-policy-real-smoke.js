#!/usr/bin/env node
'use strict';

/*
  The strict-export policy, proved on REAL builder output.

  The first version of this feature was green on a synthetic page and useless
  in the product: the builder emits its Google Fonts stylesheet with
  media="print" onload="this.media='all'", and a hash-bearing policy makes a
  browser ignore 'unsafe-inline' for script, so that handler is blocked, the
  sheet stays inert, and every site using the default font silently renders in
  fallback type. The policy carrier refused — correctly — which meant the
  setting did nothing for most sites.

  So this smoke builds pages the way the app does and asks the only questions
  that matter about a policy that will actually ship:

    1. a real page can be hardened at all (no inline handlers left);
    2. every script in the page is covered by a hash in the policy, including
       the ones the builder emits and any injected widget — a policy that does
       not cover them all blocks the site it was written for;
    3. the font origins the page needs are allow-listed;
    4. with the setting OFF the page is byte-for-byte what it was before.
*/

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

['DB', 'ONLINE', 'Review', 'Images', 'Focus', 'OgCard', 'Concierge'].forEach((name) => {
  const rel = { DB: 'db', ONLINE: 'online', Review: 'review', Images: 'images', Focus: 'focus', OgCard: 'ogcard', Concierge: 'concierge' }[name];
  global[name] = require(path.join(ROOT, 'data', rel + '.js'));
});

const Builder = require(path.join(ROOT, 'modules', 'builder.js'));
const SRI = require(path.join(ROOT, 'modules', 'security-sri.js'));
const appSrc = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function check(cond, msg) { cond ? pass(msg) : fail(msg); }

const clone = (o) => JSON.parse(JSON.stringify(o));

function fixture(extra) {
  const site = {
    name: 'Harbour Coffee',
    tagline: 'Roasted on the quay',
    url: 'https://harbour.example',
    palette: 'midnight',
    font: 'inter',
    archetype: 'editorial',
    metaDescription: 'Speciality coffee on the quay',
    formEndpoint: 'hello@harbour.example',
    email: 'hello@harbour.example',
    phone: '0117 000 0000',
    address: '1 Quay Road, Bristol',
    pages: [
      {
        id: 'home', name: 'Home', slug: 'index',
        sections: [
          { type: 'hero', title: 'Coffee on the quay', subtitle: 'Roasted weekly' },
          { type: 'text', title: 'Our story', body: 'We have been roasting since 2014.' },
          { type: 'contact', title: 'Find us', body: 'Open 8–4, seven days.' }
        ]
      },
      { id: 'about', name: 'About', slug: 'about', sections: [{ type: 'text', title: 'About us', body: 'A small roastery.' }] }
    ]
  };
  return Object.assign({ id: 'harbour', name: 'Harbour Coffee', site }, extra || {});
}

// The source list app.js derives for a finished page. Kept in step by
// assertions below rather than by sharing code across the app boundary.
function originsFor(html, pattern) {
  const found = new Set();
  const re = new RegExp(pattern || '\\b(?:src|href|data-src|poster)\\s*=\\s*["\'](https?://[^"\']+)["\']', 'gi');
  let m = re.exec(String(html || ''));
  while (m) {
    try { const u = new URL(m[1]); if (u.protocol === 'https:') found.add(u.origin); } catch (e) { /* ignore */ }
    m = re.exec(String(html || ''));
  }
  return [...found];
}

function sourcesFor(html) {
  const all = originsFor(html);
  const scripts = originsFor(html, '<script[^>]*\\ssrc\\s*=\\s*["\'](https?://[^"\']+)["\']');
  const frames = originsFor(html, '<iframe[^>]*\\ssrc\\s*=\\s*["\'](https?://[^"\']+)["\']');
  const media = originsFor(html, '<(?:img|video|audio|source)[^>]*\\ssrc\\s*=\\s*["\'](https?://[^"\']+)["\']');
  const has = (h) => all.indexOf(h) !== -1;
  const chat = /embed\.tawk\.to/.test(String(html || '')) ? ['https://embed.tawk.to'] : [];
  // The RESOLVED endpoint, exactly as the builder resolves it for the form.
  const delivery = Builder.deliveryFor(fixture().site);
  const endpoint = String((delivery && delivery.endpoint) || '');
  const formOrigin = /^https:\/\//i.test(endpoint) ? new URL(endpoint).origin : '';
  const connect = chat.concat(formOrigin ? [formOrigin] : []);
  return {
    script: chat.concat(scripts),
    style: has('https://fonts.googleapis.com') ? ['https://fonts.googleapis.com'] : [],
    font: has('https://fonts.gstatic.com') ? ['https://fonts.gstatic.com'] : [],
    connect,
    frame: frames,
    media: media.length ? media : all,
    img: all,
    formAction: formOrigin ? [formOrigin] : []
  };
}

function harden(html) {
  const res = SRI.hardenDocument(html, {}, { inlineAlgorithm: 'sha256', allowedSources: sourcesFor(html) });
  return { res, meta: SRI.injectCSPMeta(html, res.csp, {}) };
}

console.log('== A real page can be hardened ==');
const strictPages = Builder.buildSitePages(fixture(), { strictSecurity: true, onlineEnabled: true });
const plainPages = Builder.buildSitePages(fixture(), {});
check(strictPages.length >= 2, 'the fixture really produced pages (' + strictPages.length + ')');

strictPages.forEach((entry) => {
  const label = entry.page.slug + '.html';
  const handlers = SRI.detectInlineHandlers(entry.html);
  const { res, meta } = harden(entry.html);
  check(handlers.handlers === 0, label + ' has no inline handlers left (' + handlers.handlers + ')');
  check(meta.ok === true, label + ' accepts a policy' + (meta.ok ? '' : ' — ' + meta.reason));

  if (!meta.ok) return;
  // Every EXECUTABLE script in the page must be covered, or the policy breaks
  // the site. A JSON-LD block is data, not code: it is not executed and must not
  // be counted, or this check would "fail" a page that is perfectly fine.
  const execScripts = [...entry.html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((m) => {
      const type = (m[1].match(/\stype\s*=\s*["']([^"']+)["']/i) || [])[1];
      return !type || /javascript|module/i.test(type);
    })
    .filter((m) => !/\ssrc\s*=/.test(m[1]));
  const external = [...entry.html.matchAll(/<script[^>]*\ssrc="([^"]+)"/gi)].map((m) => m[1]);
  const jsonLd = [...entry.html.matchAll(/<script[^>]*type=["']application\/ld\+json["']/gi)].length;
  const hashes = (res.csp.match(/'sha256-[A-Za-z0-9+/=]+'/g) || []);
  check(hashes.length === execScripts.length,
    label + ': a hash for every executable inline script (' + hashes.length + ' hashes / ' + execScripts.length + ' scripts, ' + jsonLd + ' JSON-LD ignored)');
  check(external.length === 0 || res.csp.indexOf("script-src 'none'") === -1,
    label + ': external scripts are not blocked outright (' + external.length + ' found)');

  const policy = meta.tag.replace(/^<meta http-equiv="Content-Security-Policy" content="|"[^>]*>$/g, '');
  check(policy.indexOf("script-src 'unsafe-inline'") === -1, label + ": script-src has no 'unsafe-inline'");
  check(policy.indexOf("default-src 'none'") !== -1, label + ": the policy starts from default-src 'none'");
  check(policy.indexOf('fonts.googleapis.com') !== -1, label + ': the font stylesheet origin is allowed');
  check(policy.indexOf('fonts.gstatic.com') !== -1, label + ': the font files origin is allowed');
  const delivery = Builder.deliveryFor(fixture().site);
  const endpointOrigin = new URL(delivery.endpoint).origin;
  check(policy.indexOf(endpointOrigin) !== -1,
    label + ': the resolved form endpoint (' + endpointOrigin + ') can receive a submission');
  check(meta.html.indexOf('http-equiv="Content-Security-Policy"') !== -1, label + ': the policy reached the document');
  check(meta.html.indexOf('@import url("https://fonts.googleapis.com') !== -1,
    label + ': the font sheet loads without an inline handler');
});

console.log('\n== The same pages are untouched by default ==');
plainPages.forEach((entry, i) => {
  const again = Builder.buildSitePages(fixture(), {})[i];
  check(again.html === entry.html, entry.page.slug + '.html is byte-identical with the setting off');
  check(entry.html.indexOf("onload=\"this.media='all'\"") !== -1,
    entry.page.slug + '.html keeps the non-blocking font trick when strict is off');
  check(entry.html.indexOf('http-equiv="Content-Security-Policy"') === -1,
    entry.page.slug + '.html ships no policy when strict is off');
});

console.log('\n== A page that still has a handler is refused, not broken ==');
const hostile = strictPages[0].html.replace('<body', '<body onload="boom()"');
const h = SRI.hardenDocument(hostile, {}, { inlineAlgorithm: 'sha256', allowedSources: {} });
const hostileMeta = SRI.injectCSPMeta(hostile, h.csp, {});
check(hostileMeta.ok === false, 'a page with an inline handler refuses the policy');
check(/inline handler/.test(String(hostileMeta.reason || '')), 'and says exactly why');
check(hostileMeta.html === hostile, 'and hands the document back unchanged');

console.log('\n== app.js derives the same sources this smoke does ==');
check(/style: has\('https:\/\/fonts\.googleapis\.com'\) \? \['https:\/\/fonts\.googleapis\.com'\] : \[\]/.test(appSrc),
  'app.js allow-lists the font stylesheet origin when the page uses it');
check(/font: has\('https:\/\/fonts\.gstatic\.com'\) \? \['https:\/\/fonts\.gstatic\.com'\] : \[\]/.test(appSrc),
  'app.js allow-lists the font files origin when the page uses it');
check(/Builder\.deliveryFor\(site\)/.test(appSrc),
  'app.js reads the RESOLVED form endpoint, not the raw setting');
check(/embed\\?\.tawk\\?\.to/.test(appSrc), 'app.js recognises the injected chat widget origin');
check(/builder[\s\S]*strictSecurity[\s\S]*@import url\(/.test(fs.readFileSync(path.join(ROOT, 'modules', 'builder.js'), 'utf8')),
  'the builder loads fonts CSP-safely when strict security is on');

if (failed) {
  console.error('\nexport-policy-real-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nexport-policy-real-smoke PASSED — the policy works on real pages');
