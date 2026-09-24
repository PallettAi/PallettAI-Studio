#!/usr/bin/env node
'use strict';

/*
  SSRF: the whole hop, not just the first URL.

  A guard that only inspects the URL it was handed is bypassable with a single
  302, and "study this site" hands attacker-chosen URLs straight to fetch. So
  this gate pins three things:

    1. the address classifier refuses every private/local form, including the
       IPv4-mapped IPv6 spellings the URL parser canonicalises to hex;
    2. a redirect INTO private space is refused, and in the Node path the
       request is never issued at all;
    3. a public redirect still resolves, so the guard is not just refusing
       everything and breaking the feature.
*/

const assert = require('assert');
const path = require('path');

const ONLINE = require(path.join(__dirname, '..', 'data', 'online.js'));

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function check(cond, msg) { cond ? pass(msg) : fail(msg); }

console.log('== Private address space is refused ==');
[
  ['http://127.0.0.1/', 'loopback'],
  ['http://127.1/', 'loopback shorthand'],
  ['http://2130706433/', 'decimal loopback'],
  ['http://0x7f000001/', 'hex loopback'],
  ['http://localhost/', 'localhost'],
  ['http://foo.localhost/', 'a .localhost name'],
  ['http://10.0.0.4/', 'RFC1918 10/8'],
  ['http://192.168.1.1/', 'RFC1918 192.168/16'],
  ['http://172.16.0.1/', 'RFC1918 172.16/12'],
  ['http://100.64.0.1/', 'CGNAT 100.64/10'],
  ['http://169.254.169.254/latest/meta-data/', 'cloud instance metadata'],
  ['http://[::1]/', 'IPv6 loopback'],
  ['http://[::]/', 'IPv6 unspecified'],
  ['http://[::ffff:127.0.0.1]/', 'IPv4-mapped loopback in hex groups'],
  ['http://[::ffff:a9fe:a9fe]/', 'IPv4-mapped metadata in hex groups'],
  ['http://[::ffff:169.254.169.254]/', 'IPv4-mapped metadata in dotted form'],
  ['http://[fd00::1]/', 'IPv6 unique-local'],
  ['http://[fe80::1]/', 'IPv6 link-local'],
  ['http://[2001:db8::1]/', 'documentation range'],
  ['http://nas.internal/', 'a .internal name'],
  ['http://box.local/', 'a .local name'],
  ['http://service.onion/', 'a .onion name'],
  ['file:///etc/passwd', 'a file: URL'],
  ['https://user:pass@example.com/', 'credentials in the URL'],
  ['not a url', 'something that is not a URL']
].forEach(([url, what]) => {
  check(ONLINE.isPrivateTarget(url) === true, what + ' is private (' + url + ')');
});

console.log('\n== Public addresses still pass ==');
[
  'https://example.com/',
  'https://picsum.photos/1200/800',
  'https://api.mymemory.translated.net/get?q=hi',
  'https://8.8.8.8/',
  'https://[2606:4700:4700::1111]/'
].forEach((url) => {
  check(ONLINE.isPrivateTarget(url) === false, 'public host is allowed (' + url + ')');
});

console.log('\n== A redirect into private space is refused ==');

async function redirectChecks() {
  const realFetch = global.fetch;
  const asked = [];
  try {
    // Node honours redirect:'manual', so the guard must look at the hop BEFORE
    // the request is made — the metadata request must never appear in `asked`.
    global.fetch = async (url, init) => {
      asked.push(String(url));
      if (String(url) === 'https://redirector.example/') {
        return { status: 302, ok: false, url: String(url), headers: { get: () => 'http://169.254.169.254/latest/meta-data/' } };
      }
      return { status: 200, ok: true, url: String(url), headers: { get: () => null }, text: async () => 'ok' };
    };
    let blocked = null;
    try {
      await ONLINE.guardedFetch('https://redirector.example/');
    } catch (e) {
      blocked = e;
    }
    check(blocked && blocked.code === 'blocked_host', 'a public URL that redirects to metadata is refused');
    check(asked.length === 1 && asked[0] === 'https://redirector.example/',
      'the internal request was never issued (asked: ' + JSON.stringify(asked) + ')');

    // A public redirect chain must still work, or the guard has broken the
    // feature it exists to protect.
    asked.length = 0;
    global.fetch = async (url, init) => {
      asked.push(String(url));
      if (String(url) === 'https://a.example/') {
        return { status: 301, ok: false, url: String(url), headers: { get: () => 'https://b.example/final' } };
      }
      return { status: 200, ok: true, url: String(url), headers: { get: () => null }, text: async () => 'ok' };
    };
    const res = await ONLINE.guardedFetch('https://a.example/');
    check(res && res.status === 200, 'a public redirect is followed to the end');
    check(asked.length === 2 && asked[1] === 'https://b.example/final', 'both hops were requested in order');

    // A private first hop is refused before anything is sent.
    asked.length = 0;
    let blocked2 = null;
    try {
      await ONLINE.guardedFetch('http://127.0.0.1:8080/admin');
    } catch (e) {
      blocked2 = e;
    }
    check(blocked2 && blocked2.code === 'blocked_host', 'a private first hop is refused');
    check(asked.length === 0, 'nothing was requested for a private URL');

    // The documented opt-out still works, for a deliberate LAN/self-hosted fetch.
    global.fetch = async (url) => ({ status: 200, ok: true, url: String(url), headers: { get: () => null }, text: async () => 'ok' });
    const lan = await ONLINE.guardedFetch('http://192.168.1.50/fonts.css', undefined, { allowPrivate: true });
    check(lan && lan.status === 200, 'allowPrivate lets a deliberate LAN fetch through');

    // The shared boundary uses the guard: ONLINE.request must refuse too.
    let blocked3 = null;
    try {
      await ONLINE.request('http://169.254.169.254/latest/meta-data/');
    } catch (e) {
      blocked3 = e;
    }
    check(blocked3 && blocked3.code === 'blocked_host', 'ONLINE.request refuses a metadata address');
  } finally {
    global.fetch = realFetch;
  }
}

redirectChecks().then(() => {
  if (failed) {
    console.error('\nssrf-redirect-smoke FAILED — ' + failed + ' failure(s)');
    process.exit(1);
  }
  console.log('\nssrf-redirect-smoke PASSED');
}).catch((e) => {
  console.error('\nssrf-redirect-smoke ERROR — ' + (e && e.message ? e.message : e));
  process.exit(1);
});
