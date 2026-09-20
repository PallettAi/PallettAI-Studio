#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');
const pkg = JSON.parse(read('package.json'));
const html = read('index.html');
const bridge = read('data/editor-bridge.js');
const css = read('data/editor-bridge.css');
let passed = 0;
function ok(condition, message) {
  if (!condition) { console.error('✗ ' + message); process.exitCode = 1; return; }
  passed += 1; console.log('✓ ' + message);
}
ok(pkg.dependencies && pkg.dependencies.grapesjs === '0.23.6', 'GrapesJS is pinned to a reviewed version');
ok(pkg.dependencies && pkg.dependencies.vvvebjs === '2.0.9', 'VvvebJS is pinned to a reviewed version');
ok(/node_modules\/grapesjs\/dist\/grapes\.min\.js/.test(bridge), 'GrapesJS loads from the local package on demand');
ok(/node_modules\/vvvebjs\/libs\/builder\/builder\.js/.test(bridge), 'VvvebJS loads from the local package on demand');
ok(/components-common\.js/.test(bridge) && /components-html\.js/.test(bridge), 'VvvebJS component catalog modules load locally');
ok(!/node_modules\/(grapesjs|vvvebjs)/.test(html), 'Optional editor runtimes are absent from the Studio boot path');
ok(!/https?:\/\/[^"']*(grapesjs|vvveb)/i.test(html), 'Editor runtimes are not loaded from a CDN');
ok(/telemetry:\s*false/.test(bridge), 'GrapesJS telemetry is disabled');
ok(/root\.grapesjs/.test(bridge) && /root\.Vvveb/.test(bridge), 'The bridge keeps both editor namespaces explicit');
ok(/storageManager:\s*false/.test(bridge), 'The visual canvas cannot write an external storage backend');
ok(/project\.editorCanvas/.test(bridge), 'Canvas changes are stored behind an explicit project snapshot boundary');
ok(/MAX_SNAPSHOT/.test(bridge), 'Canvas snapshots have a bounded size');
ok(/data-editor-block/.test(bridge), 'Vvveb vocabulary is exposed through a controlled block catalog');
ok(/prefers-reduced-motion/.test(css), 'Advanced canvas respects reduced motion');
ok(!/eval\s*\(|new Function\s*\(/.test(bridge), 'The PallettAI bridge adds no dynamic code execution');
console.log('\nEDITOR BRIDGE SMOKE PASSED: ' + passed + ' checks');
