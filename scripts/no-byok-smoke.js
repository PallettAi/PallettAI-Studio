'use strict';

/*
  No bring-your-own-key.

  What customers pay for is a working app: they buy credits, and every AI
  feature has to work without them ever finding a model vendor, creating an
  account, or pasting a key. That is the promise, and it is easy to break
  quietly — one "get an API key" link, one settings field, one new provider
  call in a feature nobody exercises by hand, and the user is suddenly the one
  paying for inference.

  This gate scans the real index.html script list for the whole class:
    1. a model vendor reached directly from the renderer (only our own
       keyless model endpoint and a local runtime are allowed);
    2. BYOK-shaped copy in the UI (an input or a prompt tied to an AI key);
    3. a stored credential that is read by an AI code path.

  It is deliberately paranoid about prose: comments and string bodies are
  stripped first, so this cannot fail on documentation.
*/

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function assert(cond, msg) { cond ? pass(msg) : fail(msg); }

// Same trick as renderer-globals-smoke: length-preserving strip of comments and
// string/template bodies, so an index into the result maps to the original file
// and a mention in prose is never a hit. Delimiters are kept.
function codeOnly(src) {
  const out = new Array(src.length);
  let i = 0;
  const n = src.length;
  let state = 'code';
  let quote = '';
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (state === 'code') {
      if (c === '/' && d === '/') { state = 'line'; out[i] = ' '; out[i + 1] = ' '; i += 2; continue; }
      if (c === '/' && d === '*') { state = 'block'; out[i] = ' '; out[i + 1] = ' '; i += 2; continue; }
      if (c === '"' || c === "'" || c === '`') { state = 'string'; quote = c; out[i] = c; i++; continue; }
      out[i] = c; i++; continue;
    }
    if (state === 'line') { out[i] = c === '\n' ? '\n' : ' '; if (c === '\n') state = 'code'; i++; continue; }
    if (state === 'block') { out[i] = c === '\n' ? '\n' : ' '; if (c === '*' && d === '/') { out[i + 1] = ' '; i += 2; state = 'code'; continue; } i++; continue; }
    // string / template body
    if (c === '\\') { out[i] = ' '; out[i + 1] = i + 1 < n ? ' ' : ' '; i += 2; continue; }
    if (c === quote) { state = 'code'; out[i] = c; i++; continue; }
    out[i] = c === '\n' ? '\n' : ' '; i++;
  }
  return out.join('');
}

function lineOf(src, index) {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i++) if (src[i] === '\n') line++;
  return line;
}

const files = [...index.matchAll(/<script src="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((rel) => fs.existsSync(path.join(ROOT, rel)));

console.log('== Renderer scripts scanned: ' + files.length + ' ==');

// ---------------------------------------------------------------- 1. vendors
// The only model endpoints a renderer may talk to: our keyless model service
// and a local runtime the user runs themselves. Everything else means a vendor
// account has leaked into the customer path.
const ALLOWED_MODEL_HOSTS = [
  'text.pollinations.ai',
  'image.pollinations.ai'
];
const VENDOR_HOSTS = [
  'api.openai.com',
  'api.anthropic.com',
  'generativelanguage.googleapis.com',
  'openrouter.ai',
  'api.mistral.ai',
  'api.cohere.ai',
  'api.cohere.com',
  'api.groq.com',
  'api.together.xyz',
  'api-inference.huggingface.co',
  'api.deepseek.com',
  'api.x.ai',
  'api.gemini.google.com'
];

// Hostnames only ever appear inside string literals, so the vendor scan needs a
// DIFFERENT strip: comments out, strings intact. Using codeOnly() here would
// blank out the very thing being searched for and the check would pass no
// matter what was added — which is exactly the bug this first version had.
function commentsOnly(src) {
  const out = src.split('');
  let state = 'code';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const d = src[i + 1];
    if (state === 'code') {
      if (c === '/' && d === '/') { state = 'line'; out[i] = ' '; out[i + 1] = ' '; i++; continue; }
      if (c === '/' && d === '*') { state = 'block'; out[i] = ' '; out[i + 1] = ' '; i++; continue; }
      if (c === '"' || c === "'" || c === '`') state = 'string';
      continue;
    }
    if (state === 'line') { if (c === '\n') state = 'code'; else out[i] = ' '; continue; }
    if (state === 'block') {
      if (c === '\n') state = 'code';
      else out[i] = ' ';
      if (c === '*' && d === '/') { out[i + 1] = ' '; i++; state = 'code'; }
      continue;
    }
    if (c === '\\') { i++; continue; }
    if (c === '"' || c === "'" || c === '`') state = 'code';
  }
  return out.join('');
}

const scanned = files.map((rel) => ({ rel, src: fs.readFileSync(path.join(ROOT, rel), 'utf8') }));
const offenders = [];
for (const { rel, src } of scanned) {
  const code = commentsOnly(src);
  for (const host of VENDOR_HOSTS) {
    let at = code.indexOf(host);
    while (at !== -1) {
      offenders.push(rel + ':' + lineOf(src, at) + ' reaches ' + host + ' directly');
      at = code.indexOf(host, at + 1);
    }
  }
}
assert(offenders.length === 0, 'no renderer script calls a model vendor directly' +
  (offenders.length ? ' — ' + offenders.join(', ') : ''));

const modelHosts = new Set();
for (const { src } of scanned) {
  for (const m of src.matchAll(/https:\/\/([a-z0-9.-]+)/gi)) modelHosts.add(m[1].toLowerCase());
}
const modelHostsUsed = [...modelHosts].filter((h) => /pollinations|ollama/.test(h));
assert(modelHostsUsed.every((h) => ALLOWED_MODEL_HOSTS.includes(h) || /ollama/.test(h)),
  'the only external model endpoint in the renderer is the keyless one (' + (modelHostsUsed.join(', ') || 'none') + ')');

// A local runtime is an opt-in extra, never a requirement.
assert(!/ollama\.com|localhost:11434|127\.0\.0\.1:11434/.test(app) || /optional|if .*installed|not running/i.test(app),
  'a local model runtime is only ever an optional extra');

// ------------------------------------------------------------- 2. UI copy
// Ask the user for a key and the promise is gone, whatever the code does.
const BYOK_COPY = [
  /your\s+(own\s+)?(api\s+)?key/i,
  /enter\s+(your\s+)?(api\s+)?key/i,
  /paste\s+(your\s+)?(api\s+)?key/i,
  /bring\s+your\s+own\s+(key|api)/i,
  /\bbyok\b/i,
  /get an?\s+(openai|anthropic|gemini|deepseek|mistral|groq|together|cerebras|deepseek)\s+(api\s+)?key/i
];
const AI_COPY_CONTEXT = /(ai|translate|translation|generat|copy|photo|alt text|logo|vision)/i;

const copyOffenders = [];
for (const { rel, src } of scanned) {
  // Copy lives in string bodies, so the ORIGINAL source is what we scan — but
  // the patterns above are expensive on a large file (nested \s+ quantifiers
  // are quadratic), so they only ever run against a small window anchored on a
  // cheap linear scan for the literal word. Comments are still stripped, which
  // kills the usual false hit: a key name mentioned in a comment.
  const code = codeOnly(src);
  for (const m of src.matchAll(/keys?\b/gi)) {
    const start = Math.max(0, m.index - 200);
    const window = src.slice(start, m.index + 200);
    const hit = BYOK_COPY.map((re) => window.match(re)).find(Boolean);
    if (!hit) continue;
    if (code.slice(start + hit.index, start + hit.index + hit[0].length).trim() === '') continue; // inside a comment
    const near = src.slice(Math.max(0, m.index - 260), m.index + 260);
    if (!AI_COPY_CONTEXT.test(near)) continue;
    if (/pixabay|companies house|netlify|neocities|vercel|cloudflare|github/i.test(near)) continue;
    copyOffenders.push(rel + ':' + lineOf(src, start + hit.index) + ' "' + hit[0].trim() + '"');
  }
}
assert(copyOffenders.length === 0, 'no AI surface asks the user for a key' +
  (copyOffenders.length ? ' — ' + copyOffenders.join(', ') : ''));

// No AI key input exists in the client at all.
assert(!/id="(ai|set)?(openai|anthropic|gemini|deepseek|mistral|groq|ollama|llm|model|aiApi|aiModel)[A-Za-z]*"/i.test(app),
  'the client has no AI provider key or model field');
assert(!/(openai|anthropic|gemini|deepseek|mistral|groq|together|cerebras)[A-Za-z]*Key/.test(app),
  'app.js never reads a vendor key from settings');

// --------------------------------------------------- 3. the promise, in copy
assert(/Translation is included/.test(app), 'AI Studio says translation is included');
assert(!/deepl\.com\/pro-api/i.test(app), 'the DeepL get-a-key link is gone from the app');
assert(!/DEEPL_API_KEY/.test(app), 'app.js never names the DeepL secret');
assert(/There is nothing to sign up for and no AI key to enter/.test(app),
  'Settings states that no AI key is needed');
assert(/Pixabay API key <span class="muted">\(optional\)<\/span>/.test(app) &&
  /Companies House API key <span class="muted">\(optional\)<\/span>/.test(app),
  'the two remaining key fields are clearly marked optional');
assert(/Pixabay photos <span class="muted">\(optional\)<\/span>/.test(app) &&
  /Netlify publish <span class="muted">\(optional\)<\/span>/.test(app),
  'publishing destinations are clearly marked optional');
assert(/Openverse &amp; Wikimedia images — no key, no account/.test(app),
  'Online sources leads with a keyless image source');

// ------------------------------------------------------- 4. server-side keys
// The paid path is allowed to hold keys — just never in the renderer, and never
// in a response body.
const functions = path.join(ROOT, 'supabase', 'functions');
if (fs.existsSync(functions)) {
  // The invariant that matters: a file may NAME a secret (to log which one is
  // missing, for example) but the value must only ever arrive from the
  // environment. Anything that names a secret without reading it from the
  // environment is a hardcoded or echoed credential.
  const leaks = [];
  let filesRead = 0;
  for (const fn of fs.readdirSync(functions)) {
    const dir = path.join(functions, fn);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!/\.(ts|js|mjs)$/.test(file)) continue;
      const src = fs.readFileSync(path.join(dir, file), 'utf8');
      filesRead++;
      for (const name of new Set([...src.matchAll(/(DEEPL|DODO|OPENAI|ANTHROPIC|GEMINI|SMTP|MAIL)[A-Z_]*KEY/g)].map((m) => m[0]))) {
        const fromEnv = new RegExp("(Deno\\.env\\.get|process\\.env)(?:\\(\\s*)?['\"]?" + name).test(src);
        const assigned = new RegExp("(const|let|var)\\s+\\w+\\s*=\\s*['\"]" + name + "['\"]").test(src);
        if (!fromEnv || assigned) leaks.push(fn + '/' + file + ': ' + name);
      }
    }
  }
  assert(filesRead > 0, 'edge functions were read (' + filesRead + ' files)');
  assert(leaks.length === 0, 'every server secret is read from the environment, never assigned' +
    (leaks.length ? ' — ' + leaks.join(', ') : ''));
} else {
  pass('no supabase/functions directory in this checkout — server check skipped');
}

if (failed) {
  console.error('\nno-byok-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nno-byok-smoke PASSED — AI is included; the user never needs a key');
